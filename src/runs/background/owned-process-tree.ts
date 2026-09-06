import { spawnSync } from "node:child_process";
import type { ProcessTreeTerminal } from "../../shared/types.ts";
import { WINDOWS_HIDDEN_PROCESS_OPTIONS, windowsSystemExecutable } from "../../shared/windows-launch-safety.ts";

const DEFAULT_TERM_GRACE_MS = 3000;
const DEFAULT_KILL_VERIFY_MS = 1000;
const VERIFY_INTERVAL_MS = 25;
const PROCESS_SNAPSHOT_TIMEOUT_MS = 5000;

type SignalResult = "sent" | "absent" | { diagnostic: string };
interface WindowsProcessSnapshot { pid: number; parentPid: number; creationDate: string }

function diagnostic(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function signalProcess(id: number, signal: NodeJS.Signals): SignalResult {
	try {
		process.kill(id, signal);
		return "sent";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return "absent";
		return { diagnostic: diagnostic(error) };
	}
}

function activeProcessGroupMembers(processGroupId: number): number[] | { diagnostic: string } {
	const result = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf-8" });
	if (result.error || result.status !== 0) {
		return { diagnostic: result.error ? diagnostic(result.error) : (result.stderr.trim() || `ps exited with ${result.status}`) };
	}
	const members: number[] = [];
	for (const line of result.stdout.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
		if (!match || Number(match[2]) !== processGroupId || match[3]!.startsWith("Z")) continue;
		members.push(Number(match[1]));
	}
	return members;
}

function knownDetachedDescendants(processGroupId: number): number[] {
	const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf-8" });
	if (result.error || result.status !== 0) return [];
	const owned = new Set<number>();
	const outside: { pid: number; ppid: number }[] = [];
	for (const line of result.stdout.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/.exec(line);
		if (!match || match[4]!.startsWith("Z")) continue;
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const pgid = Number(match[3]);
		if (pgid === processGroupId) owned.add(pid);
		else outside.push({ pid, ppid });
	}
	return outside.filter((row) => owned.has(row.ppid)).map((row) => row.pid);
}

async function waitUntilGroupTerminal(
	processGroupId: number,
	timeoutMs: number,
): Promise<false | { state: "enumeration-failed" | "still-active"; diagnostic: string }> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const members = activeProcessGroupMembers(processGroupId);
		if (Array.isArray(members) && members.length === 0) return false;
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			if (!Array.isArray(members)) return { state: "enumeration-failed", diagnostic: members.diagnostic };
			return { state: "still-active", diagnostic: `Process group ${processGroupId} still has active members: ${members.join(", ")}.` };
		}
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(VERIFY_INTERVAL_MS, remaining)));
	}
}

function enumerateWindowsProcesses(): WindowsProcessSnapshot[] | { diagnostic: string } {
	const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress";
	const result = spawnSync(
		windowsSystemExecutable("WindowsPowerShell", "v1.0", "powershell.exe"),
		["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
		{
			encoding: "utf-8",
			timeout: PROCESS_SNAPSHOT_TIMEOUT_MS,
			...WINDOWS_HIDDEN_PROCESS_OPTIONS,
		},
	);
	if (result.error || result.status !== 0) {
		return { diagnostic: result.error ? diagnostic(result.error) : (result.stderr.trim() || `PowerShell exited with ${result.status}`) };
	}
	try {
		const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
		const values = Array.isArray(parsed) ? parsed : [parsed];
		return values.flatMap((value) => {
			if (!value || typeof value !== "object") return [];
			const item = value as { ProcessId?: unknown; ParentProcessId?: unknown; CreationDate?: unknown };
			if (typeof item.ProcessId !== "number" || typeof item.ParentProcessId !== "number") return [];
			return [{ pid: item.ProcessId, parentPid: item.ParentProcessId, creationDate: String(item.CreationDate ?? "") }];
		});
	} catch (error) {
		return { diagnostic: `Invalid Windows process snapshot: ${diagnostic(error)}` };
	}
}

function discoverOwnedWindowsProcesses(processes: WindowsProcessSnapshot[], ownedIds: Set<number>): WindowsProcessSnapshot[] {
	const discovered = new Map<number, WindowsProcessSnapshot>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const process of processes) {
			if (ownedIds.has(process.pid) || !ownedIds.has(process.parentPid)) continue;
			ownedIds.add(process.pid);
			discovered.set(process.pid, process);
			changed = true;
		}
	}
	return [...discovered.values()];
}

function terminateWindowsPid(pid: number): void {
	spawnSync(windowsSystemExecutable("taskkill.exe"), ["/PID", String(pid), "/F"], {
		encoding: "utf-8",
		timeout: PROCESS_SNAPSHOT_TIMEOUT_MS,
		...WINDOWS_HIDDEN_PROCESS_OPTIONS,
	});
}

async function terminateWindowsTree(
	pid: number,
	initial: WindowsProcessSnapshot[],
	writerClosed: boolean,
	verifyMs: number,
): Promise<ProcessTreeTerminal> {
	const initialRoot = initial.find((process) => process.pid === pid);
	if (!writerClosed && !initialRoot) {
		return { state: "unknown", reason: "verification-failed", diagnostic: `Windows root process ${pid} was not observed when ownership began.` };
	}
	const ownedIds = new Set<number>([pid]);
	const identities = new Map<number, string>();
	if (initialRoot) identities.set(pid, initialRoot.creationDate);
	for (const process of discoverOwnedWindowsProcesses(initial, ownedIds)) identities.set(process.pid, process.creationDate);

	let deadline: number | undefined;
	while (true) {
		const current = enumerateWindowsProcesses();
		if (!Array.isArray(current)) return { state: "unknown", reason: "verification-failed", diagnostic: current.diagnostic };
		const currentRoot = current.find((process) => process.pid === pid);
		if (initialRoot && currentRoot && currentRoot.creationDate !== initialRoot.creationDate) {
			return { state: "unknown", reason: "verification-failed", diagnostic: `Windows root PID ${pid} was reused during termination.` };
		}
		const discoveryParents = initialRoot || !writerClosed
			? ownedIds
			: new Set([...ownedIds].filter((ownedPid) => ownedPid !== pid));
		for (const process of discoverOwnedWindowsProcesses(current, discoveryParents)) {
			ownedIds.add(process.pid);
			identities.set(process.pid, process.creationDate);
		}
		const active = current.filter((process) => identities.get(process.pid) === process.creationDate);
		if (active.length === 0) {
			return { state: "observed", mechanism: "windows-process-snapshot", rootProcessId: pid, verifiedAt: Date.now() };
		}
		if (deadline !== undefined && Date.now() >= deadline) {
			return { state: "unknown", reason: "verification-failed", diagnostic: `Windows process tree ${pid} still has active members: ${active.map((process) => process.pid).join(", ")}.` };
		}
		for (const process of active) terminateWindowsPid(process.pid);
		// Start the grace period after signaling so slow enumeration cannot consume it before cleanup begins.
		deadline ??= Date.now() + verifyMs;
		const remaining = deadline - Date.now();
		if (remaining > 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, Math.min(VERIFY_INTERVAL_MS, remaining)));
		}
	}
}

function observed(processGroupId: number): ProcessTreeTerminal {
	return { state: "observed", mechanism: "posix-process-group", processGroupId, verifiedAt: Date.now() };
}

function observedUnlessLiveDetached(processGroupId: number, detached: readonly number[]): ProcessTreeTerminal {
	const live = detached.filter((pid) => {
		const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf-8" });
		return result.status === 0 && Boolean(result.stdout.trim()) && !result.stdout.trim().startsWith("Z");
	});
	if (live.length === 0) return observed(processGroupId);
	return { state: "unknown", reason: "verification-failed", diagnostic: `Owned detached descendant(s) still active: ${live.join(", ")}.` };
}

/** Owns one writer process tree and arbitrates its cleanup exactly once. */
export interface OwnedProcessTreeController {
	terminate(): Promise<ProcessTreeTerminal>;
	finishAfterWriterClose(): Promise<ProcessTreeTerminal>;
}

export function createOwnedProcessTreeController(
	pid: number,
	options: { termGraceMs?: number; killVerifyMs?: number } = {},
): OwnedProcessTreeController {
	let termination: Promise<ProcessTreeTerminal> | undefined;
	const windows = process.platform === "win32";
	const target = windows ? pid : -pid;
	const initialWindowsProcesses = windows ? enumerateWindowsProcesses() : undefined;

	const finish = (writerClosed: boolean): Promise<ProcessTreeTerminal> => {
		if (termination) return termination;
		termination = (async () => {
			if (windows) {
				if (!Array.isArray(initialWindowsProcesses)) {
					return { state: "unknown", reason: "verification-failed", diagnostic: initialWindowsProcesses!.diagnostic };
				}
				return terminateWindowsTree(pid, initialWindowsProcesses, writerClosed, options.killVerifyMs ?? DEFAULT_KILL_VERIFY_MS);
			}
			const detached = knownDetachedDescendants(pid);
			const term = signalProcess(target, "SIGTERM");
			if (term !== "sent" && term !== "absent") {
				return { state: "unknown", reason: "signal-failed", diagnostic: term.diagnostic };
			}
			const termExit = await waitUntilGroupTerminal(pid, options.termGraceMs ?? DEFAULT_TERM_GRACE_MS);
			if (termExit === false) return observedUnlessLiveDetached(pid, detached);

			const kill = signalProcess(target, "SIGKILL");
			if (kill !== "sent" && kill !== "absent") {
				const members = activeProcessGroupMembers(pid);
				if (!Array.isArray(members) || members.length > 0) {
					return { state: "unknown", reason: "signal-failed", diagnostic: kill.diagnostic };
				}
			}
			const killExit = await waitUntilGroupTerminal(pid, options.killVerifyMs ?? DEFAULT_KILL_VERIFY_MS);
			if (killExit !== false) {
				return { state: "unknown", reason: "verification-failed", diagnostic: killExit.diagnostic };
			}
			return observedUnlessLiveDetached(pid, detached);
		})();
		return termination;
	};

	return {
		terminate: () => finish(false),
		finishAfterWriterClose: () => finish(true),
	};
}
