import { spawnSync } from "node:child_process";
import type { ProcessTreeTerminal } from "../../shared/types.ts";
import { observeWindowsProcesses, observeWindowsProcessesAsync, signalRetainedWindowsProcesses, releaseWindowsProcesses, type RetainedWindowsProcess, type WindowsProcessSnapshot } from "./windows-process-identity.ts";
export type { WindowsProcessSnapshot } from "./windows-process-identity.ts";

const DEFAULT_TERM_GRACE_MS = 3000;
const DEFAULT_KILL_VERIFY_MS = 1000;
const VERIFY_INTERVAL_MS = 25;
const PROCESS_SNAPSHOT_TIMEOUT_MS = 5000;

type SignalResult = "sent" | "absent" | { diagnostic: string };


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
	const result = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf-8", timeout: PROCESS_SNAPSHOT_TIMEOUT_MS });
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

function knownDetachedDescendants(processGroupId: number): number[] | { diagnostic: string } {
	const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf-8", timeout: PROCESS_SNAPSHOT_TIMEOUT_MS });
	if (result.error || result.status !== 0) return { diagnostic: result.error ? diagnostic(result.error) : (result.stderr.trim() || `ps exited with ${result.status}`) };
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
	const detached = new Set<number>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of outside) {
			if (!owned.has(row.ppid) || owned.has(row.pid)) continue;
			owned.add(row.pid);
			detached.add(row.pid);
			changed = true;
		}
	}
	return [...detached];
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

function windowsCreationTime(value: string): bigint | undefined {
	// Native FILETIME keeps all 100ns identity precision; do not round it through Number.
	if (/^\d+$/.test(value)) return BigInt(value);
	const fileTime = (milliseconds: number) => BigInt(Math.trunc(milliseconds)) * 10_000n + 116_444_736_000_000_000n;
	const serializedDate = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
	if (serializedDate) return fileTime(Number(serializedDate[1]));
	const cim = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-]\d{3})$/.exec(value);
	if (cim) {
		const [, year, month, day, hour, minute, second, micros, offset] = cim;
		const local = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(micros) / 1000);
		return fileTime(local - Number(offset) * 60_000);
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? fileTime(parsed) : undefined;
}

export function discoverVerifiedOwnedWindowsProcesses(
	processes: WindowsProcessSnapshot[],
	identities: ReadonlyMap<number, string>,
	excludedParentIds: ReadonlySet<number> = new Set(),
): WindowsProcessSnapshot[] | { diagnostic: string } {
	const currentByPid = new Map(processes.map((process) => [process.pid, process]));
	const verifiedParents = new Set<number>();
	for (const [ownedPid, creationDate] of identities) {
		const current = currentByPid.get(ownedPid);
		if (!current) continue;
		if (windowsCreationTime(creationDate) === undefined || windowsCreationTime(current.creationDate) === undefined) {
			return { diagnostic: `Windows owned PID ${ownedPid} has no verifiable creation identity (expected=${JSON.stringify(creationDate)}, observed=${JSON.stringify(current.creationDate)}).` };
		}
		if (current.creationDate !== creationDate) {
			return { diagnostic: `Windows owned PID ${ownedPid} was reused during termination (expected=${JSON.stringify(creationDate)}, observed=${JSON.stringify(current.creationDate)}).` };
		}
		if (!excludedParentIds.has(ownedPid)) verifiedParents.add(ownedPid);
	}
	for (const process of processes) {
		if (
			!identities.has(process.pid) &&
			(identities.has(process.parentPid) || excludedParentIds.has(process.parentPid)) &&
			!verifiedParents.has(process.parentPid)
		) {
			return { diagnostic: `Windows descendant PID ${process.pid} has an unverified parent ${process.parentPid} (child=${JSON.stringify(process.creationDate)}, expectedParent=${JSON.stringify(identities.get(process.parentPid))}, observedParent=${JSON.stringify(currentByPid.get(process.parentPid)?.creationDate)}).` };
		}
	}
	const discovered = new Map<number, WindowsProcessSnapshot>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const process of processes) {
			if (verifiedParents.has(process.pid) || !verifiedParents.has(process.parentPid)) continue;
			const parent = currentByPid.get(process.parentPid);
			const parentCreated = parent ? windowsCreationTime(parent.creationDate) : undefined;
			const childCreated = windowsCreationTime(process.creationDate);
			if (parentCreated === undefined || childCreated === undefined) {
				return { diagnostic: `Windows descendant PID ${process.pid} has no verifiable creation identity (child=${JSON.stringify(process.creationDate)}, parent=${JSON.stringify(parent?.creationDate)}).` };
			}
			if (childCreated < parentCreated) {
				return { diagnostic: `Windows descendant PID ${process.pid} predates parent PID ${process.parentPid}; ownership is unverified (child=${JSON.stringify(process.creationDate)}, parent=${JSON.stringify(parent?.creationDate)}).` };
			}
			verifiedParents.add(process.pid);
			discovered.set(process.pid, process);
			changed = true;
		}
	}
	return [...discovered.values()];
}

/** Only a signaled retained kernel handle can retire an identity, never a missing/reused row. */
export function reconcileWindowsProcessSnapshot(
	processes: WindowsProcessSnapshot[],
	retained: ReadonlyMap<number, RetainedWindowsProcess>,
	identities: ReadonlyMap<number, string>,
): WindowsProcessSnapshot[] {
	return processes.filter((row) => !hasWindowsProcessExitProof(identities.get(row.pid), retained.get(row.pid)));
}

export function hasWindowsProcessExitProof(identity: string | undefined, proof: RetainedWindowsProcess | undefined): boolean {
	return identity !== undefined && proof?.creationDate === identity && proof.exited;
}

async function terminateWindowsTree(
	pid: number,
	identities: Map<number, string>,
	retained: Map<number, RetainedWindowsProcess>,
	rootObserved: boolean,
	writerClosed: boolean,
	verifyMs: number,
	priorDiagnostic?: string,
): Promise<ProcessTreeTerminal> {
	if (!writerClosed && !rootObserved) {
		return { state: "unknown", reason: "verification-failed", diagnostic: `Windows root process ${pid} was not observed when ownership began.` };
	}

	let deadline: number | undefined;
	while (true) {
		const snapshot = observeWindowsProcesses(retained);
		if (!Array.isArray(snapshot)) return { state: "unknown", reason: "verification-failed", diagnostic: snapshot.diagnostic };
		const current = reconcileWindowsProcessSnapshot(snapshot, retained, identities);
		const discovered = discoverVerifiedOwnedWindowsProcesses(
			current,
			identities,
			rootObserved || !writerClosed ? undefined : new Set([pid]),
		);
		if (!Array.isArray(discovered)) {
			return { state: "unknown", reason: "verification-failed", diagnostic: discovered.diagnostic };
		}
		for (const process of discovered) {
			identities.set(process.pid, process.creationDate);
		}
		const active = current.filter((process) => identities.get(process.pid) === process.creationDate);
		if (active.length === 0) {
			const unresolved = [...identities].filter(([id, identity]) => {
				return !hasWindowsProcessExitProof(identity, retained.get(id));
			});
			if (unresolved.length) return { state: "unknown", reason: "verification-failed", diagnostic: `Windows retained identity has no exit proof: ${unresolved.map(([id, identity]) => `${id} (expected=${JSON.stringify(identity)}, retained=${JSON.stringify(retained.get(id)?.creationDate)})`).join(", ")}.` };
			return priorDiagnostic
				? { state: "unknown", reason: "verification-failed", diagnostic: priorDiagnostic }
				: { state: "observed", mechanism: "windows-process-snapshot", rootProcessId: pid, verifiedAt: Date.now() };
		}
		if (deadline !== undefined && Date.now() >= deadline) {
			return { state: "unknown", reason: "verification-failed", diagnostic: `Windows process tree ${pid} still has active members: ${active.map((process) => `${process.pid} (expected=${JSON.stringify(identities.get(process.pid))}, observed=${JSON.stringify(process.creationDate)})`).join(", ")}.` };
		}
		const targets = new Map<number, RetainedWindowsProcess>();
		for (const process of active) {
			const proof = retained.get(process.pid);
			if (!proof || proof.creationDate !== process.creationDate) {
				return { state: "unknown", reason: "verification-failed", diagnostic: `Windows owned PID ${process.pid} has no retained handle (expected=${JSON.stringify(identities.get(process.pid))}, observed=${JSON.stringify(process.creationDate)}, retained=${JSON.stringify(proof?.creationDate)}).` };
			}
			targets.set(process.pid, proof);
		}
		// The verification budget is shared by the whole batch, not restarted per PID.
		deadline ??= Date.now() + verifyMs;
		const failure = signalRetainedWindowsProcesses(targets, Math.max(0, deadline - Date.now()));
		if (failure) return { state: "unknown", reason: "signal-failed", diagnostic: failure.diagnostic };

		const remaining = deadline - Date.now();
		if (remaining > 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, Math.min(VERIFY_INTERVAL_MS, remaining)));
		}
	}
}

function observed(processGroupId: number): ProcessTreeTerminal {
	return { state: "observed", mechanism: "posix-process-group", processGroupId, verifiedAt: Date.now() };
}

function observedUnlessLiveDetached(processGroupId: number, detached: readonly number[] | { diagnostic: string }): ProcessTreeTerminal {
	if ("diagnostic" in detached) return { state: "unknown", reason: "verification-failed", diagnostic: detached.diagnostic };
	const live: number[] = [];
	for (const pid of detached) {
		const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf-8", timeout: PROCESS_SNAPSHOT_TIMEOUT_MS });
		if (result.error || (result.status !== 0 && !(result.status === 1 && !result.stderr.trim()))) {
			return { state: "unknown", reason: "verification-failed", diagnostic: result.error ? diagnostic(result.error) : `Cannot inspect detached PID ${pid}: ${result.stderr.trim()}` };
		}
		if (result.status === 0 && result.stdout.trim() && !result.stdout.trim().startsWith("Z")) live.push(pid);
	}
	if (live.length === 0) return observed(processGroupId);
	return { state: "unknown", reason: "verification-failed", diagnostic: `Owned detached descendant(s) still active: ${live.join(", ")}.` };
}

/** Owns one writer process tree and arbitrates its cleanup exactly once. */
export interface OwnedProcessTreeController {
	terminate(): Promise<ProcessTreeTerminal>;
	finishAfterWriterClose(): Promise<ProcessTreeTerminal>;
	/** Stop observation without signaling or certifying cleanup; no later termination is allowed.
	 * Throws if native ownership-handle release fails; the cached terminal result remains UNKNOWN. */
	dispose(): void;
}

export function createOwnedProcessTreeController(
	pid: number,
	options: { termGraceMs?: number; killVerifyMs?: number } = {},
): OwnedProcessTreeController {
	let termination: Promise<ProcessTreeTerminal> | undefined;
	let releaseDiagnostic: string | undefined;
	const windows = process.platform === "win32";
	const target = windows ? pid : -pid;
	const retainedWindowsProcesses = new Map<number, RetainedWindowsProcess>();
	const initialWindowsProcesses = windows ? observeWindowsProcesses(retainedWindowsProcesses, pid) : undefined;
	const windowsIdentities = new Map<number, string>();
	let ownershipMonitorFailure: string | undefined;
	const initialWindowsRoot = Array.isArray(initialWindowsProcesses)
		? initialWindowsProcesses.find((candidate) => candidate.pid === pid)
		: undefined;
	if (initialWindowsRoot) {
		windowsIdentities.set(pid, initialWindowsRoot.creationDate);
		const descendants = discoverVerifiedOwnedWindowsProcesses(initialWindowsProcesses as WindowsProcessSnapshot[], windowsIdentities);
		if (Array.isArray(descendants)) {
			for (const descendant of descendants) windowsIdentities.set(descendant.pid, descendant.creationDate);
		} else {
			ownershipMonitorFailure = descendants.diagnostic;
		}
	}
	// Async and non-overlapping: a synchronous PowerShell snapshot blocks the event loop for ~0.5-1 s.
	let monitorTick: Promise<void> | undefined;
	let monitorStopped = false;
	const observeOwnership = async (): Promise<void> => {
		const observedSnapshot = await observeWindowsProcessesAsync(retainedWindowsProcesses);
		const snapshot = Array.isArray(observedSnapshot) ? reconcileWindowsProcessSnapshot(observedSnapshot, retainedWindowsProcesses, windowsIdentities) : observedSnapshot;
		if (!Array.isArray(snapshot)) {
			ownershipMonitorFailure ??= snapshot.diagnostic;
			return;
		}
		if (!windowsIdentities.has(pid)) return;
		const descendants = discoverVerifiedOwnedWindowsProcesses(snapshot, windowsIdentities);
		if (!Array.isArray(descendants)) {
			ownershipMonitorFailure ??= descendants.diagnostic;
			return;
		}
		for (const descendant of descendants) windowsIdentities.set(descendant.pid, descendant.creationDate);
	};
	const ownershipMonitor = windows
		? setInterval(() => {
			if (monitorTick || monitorStopped) return;
			monitorTick = observeOwnership()
				.catch((error: unknown) => { ownershipMonitorFailure ??= error instanceof Error ? error.message : String(error); })
				.finally(() => { monitorTick = undefined; });
		}, 250)
		: undefined;
	ownershipMonitor?.unref();
	const initialPosixMembers = windows ? undefined : activeProcessGroupMembers(pid);
	const initialDetached = windows ? undefined : knownDetachedDescendants(pid);

	const settleWithRelease = (terminal: ProcessTreeTerminal): ProcessTreeTerminal => {
		if (!windows) return terminal;
		releaseDiagnostic = releaseWindowsProcesses(retainedWindowsProcesses)?.diagnostic;
		if (!releaseDiagnostic) return terminal;
		return {
			state: "unknown", reason: "verification-failed",
			diagnostic: terminal.state === "unknown" && terminal.diagnostic
				? `${terminal.diagnostic} ${releaseDiagnostic}` : releaseDiagnostic,
		};
	};

	const finish = (writerClosed: boolean): Promise<ProcessTreeTerminal> => {
		if (termination) return termination;
		if (ownershipMonitor) clearInterval(ownershipMonitor);
		monitorStopped = true;
		termination = (async (): Promise<ProcessTreeTerminal> => {
			if (windows) {
				// Let an in-flight observation finish updating retained handles before termination uses them.
				await monitorTick;
				if (!Array.isArray(initialWindowsProcesses)) {
					return { state: "unknown", reason: "verification-failed", diagnostic: initialWindowsProcesses!.diagnostic };
				}
				return terminateWindowsTree(
					pid,
					windowsIdentities,
					retainedWindowsProcesses,
					initialWindowsRoot !== undefined,
					writerClosed,
					options.killVerifyMs ?? DEFAULT_KILL_VERIFY_MS,
					ownershipMonitorFailure,
				);
			}
			if (!Array.isArray(initialPosixMembers) || !initialPosixMembers.includes(pid)) {
				const detail = Array.isArray(initialPosixMembers)
					? `POSIX root process ${pid} was not observed when ownership began; detached ancestry may already be lost.`
					: initialPosixMembers!.diagnostic;
				return { state: "unknown", reason: "verification-failed", diagnostic: detail };
			}
			if (!Array.isArray(initialDetached)) {
				return { state: "unknown", reason: "verification-failed", diagnostic: initialDetached!.diagnostic };
			}
			const currentDetached = knownDetachedDescendants(pid);
			const detached = Array.isArray(currentDetached)
				? [...new Set([...initialDetached, ...currentDetached])]
				: currentDetached;
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
		})().then(settleWithRelease, (error: unknown) => {
			if (!windows) throw error;
			return settleWithRelease({ state: "unknown", reason: "verification-failed", diagnostic: diagnostic(error) });
		});
		return termination;
	};

	return {
		terminate: () => finish(false),
		finishAfterWriterClose: () => finish(true),
		dispose: () => {
			if (ownershipMonitor) clearInterval(ownershipMonitor);
			monitorStopped = true;
			// An observation still in flight may retain new handles after this release; release those too.
			if (windows && monitorTick) void monitorTick.then(() => { releaseWindowsProcesses(retainedWindowsProcesses); });
			if (!termination) {
				termination = Promise.resolve(settleWithRelease({
					state: "unknown", reason: "verification-failed",
					diagnostic: "Process-tree observation was released without cleanup proof.",
				}));
			}
			// Keep the void interface, but make failed disposal observable and cache its
			// UNKNOWN result. Repeated calls never retry potentially recycled handles.
			if (releaseDiagnostic) throw new Error(releaseDiagnostic);
		},
	};
}
