import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
	createOwnedProcessTreeController,
	discoverVerifiedOwnedWindowsProcesses,
	reconcileWindowsProcessSnapshot,
	hasWindowsProcessExitProof,
} from "../../src/runs/background/owned-process-tree.ts";
import { observeWindowsProcesses, signalRetainedWindowsProcesses, releaseWindowsProcesses, type RetainedWindowsProcess } from "../../src/runs/background/windows-process-identity.ts";
import { WINDOWS_HIDDEN_PROCESS_OPTIONS } from "../../src/shared/windows-launch-safety.ts";

function processIsActive(pid: number): boolean {
	if (process.platform === "win32") {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
	const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf-8" });
	return result.status === 0 && Boolean(result.stdout.trim()) && !result.stdout.trim().startsWith("Z");
}

async function waitForPidFiles(paths: string[]): Promise<number[]> {
	for (let attempt = 0; attempt < 200 && paths.some((filePath) => !fs.existsSync(filePath)); attempt++) {
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(paths.every((filePath) => fs.existsSync(filePath)), "the harmless Node fixture process tree started");
	return paths.map((filePath) => Number(fs.readFileSync(filePath, "utf-8")));
}

test("Windows child launches use hidden direct execution", () => {
	assert.deepEqual(WINDOWS_HIDDEN_PROCESS_OPTIONS, { windowsHide: true, shell: false });
	assert.equal(Object.isFrozen(WINDOWS_HIDDEN_PROCESS_OPTIONS), true);
});

test("Windows ownership fails closed when a non-root PID is reused", () => {
	const identities = new Map([[10, "2026-01-01T00:00:00.000Z"], [20, "2026-01-01T00:00:01.000Z"]]);
	const snapshot = [
		{ pid: 20, parentPid: 1, creationDate: "2026-01-02T00:00:00.000Z" },
		{ pid: 30, parentPid: 20, creationDate: "2026-01-02T00:00:01.000Z" },
	];

	assert.deepEqual(discoverVerifiedOwnedWindowsProcesses(snapshot, identities), {
		diagnostic: 'Windows owned PID 20 was reused during termination (expected="2026-01-01T00:00:01.000Z", observed="2026-01-02T00:00:00.000Z").',
	});
});

test("Windows exit reconciliation requires retained exit proof, not a reused or absent row", () => {
	const identity = "2026-01-01T00:00:00.000Z";
	const replacement = { pid: 20, parentPid: 1, creationDate: "2026-01-02T00:00:00.000Z" };
	const identities = new Map([[20, identity]]);
	for (const retained of [new Map(), new Map([[20, { handle: "123", creationDate: identity, exited: false }]])]) {
		const rows = reconcileWindowsProcessSnapshot([replacement], retained, identities);
		assert.equal(Array.isArray(discoverVerifiedOwnedWindowsProcesses(rows, identities)), false);
	}
	const retained = new Map([[20, { handle: "123", creationDate: identity, exited: true }]]);
	assert.equal(hasWindowsProcessExitProof(identity, undefined), false, "absence is not exit proof");
	assert.equal(hasWindowsProcessExitProof(identity, { handle: "123", creationDate: identity, exited: false }), false);
	assert.equal(hasWindowsProcessExitProof(identity, { handle: "123", creationDate: replacement.creationDate, exited: true }), false);
	assert.deepEqual(reconcileWindowsProcessSnapshot([replacement], retained, new Map()), [replacement], "an unowned retained candidate is not owned exit proof");
	const rows = reconcileWindowsProcessSnapshot([replacement], retained, identities);
	assert.deepEqual(rows, []);
	assert.deepEqual(discoverVerifiedOwnedWindowsProcesses(rows, identities), []);
	assert.equal(Array.isArray(discoverVerifiedOwnedWindowsProcesses([
		...rows, { pid: 30, parentPid: 20, creationDate: "2026-01-03T00:00:00.000Z" },
	], identities)), false, "exit proof cannot confer ownership on a replacement's descendants");
});

test("Windows retained-handle signaling cannot target a replacement numeric PID", { skip: process.platform !== "win32", timeout: 10_000 }, async () => {
	const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	const retained = new Map<number, RetainedWindowsProcess>();
	try {
		assert.ok(owned.pid);
		assert.ok(survivor.pid);
		const snapshot = observeWindowsProcesses(retained, owned.pid);
		assert.ok(Array.isArray(snapshot), JSON.stringify(snapshot));
		const identity = retained.get(owned.pid);
		assert.ok(identity);
		// Deterministically substitute a live unrelated PID between observation and signal.
		// The native operation must use the retained object, never reopen that number.
		const replacementNumber = new Map([[survivor.pid, identity]]);
		const ownedClosed = once(owned, "close");
		assert.equal(signalRetainedWindowsProcesses(replacementNumber, 1000), undefined);
		await ownedClosed;
		const refreshed = observeWindowsProcesses(replacementNumber);
		assert.ok(Array.isArray(refreshed), JSON.stringify(refreshed));
		assert.equal(replacementNumber.get(survivor.pid)?.exited, true, JSON.stringify({ original: identity, refreshed: [...replacementNumber] }));
		assert.equal(processIsActive(survivor.pid), true);
		assert.equal(processIsActive(owned.pid), false);
	} finally {
		signalRetainedWindowsProcesses(retained, 1000);
		releaseWindowsProcesses(retained);
		owned.kill("SIGKILL");
		survivor.kill("SIGKILL");
	}
});

test("Windows ownership can discover descendants through a verified surviving child", () => {
	const identities = new Map([[10, "2026-01-01T00:00:00.000Z"], [20, "2026-01-01T00:00:01.000Z"]]);
	const snapshot = [
		{ pid: 20, parentPid: 1, creationDate: "2026-01-01T00:00:01.000Z" },
		{ pid: 30, parentPid: 20, creationDate: "2026-01-01T00:00:02.000Z" },
	];

	assert.deepEqual(discoverVerifiedOwnedWindowsProcesses(snapshot, identities), [snapshot[1]]);
});

test("Windows ownership fails closed for a newly observed orphan", () => {
	const identities = new Map([[10, "2026-01-01T00:00:00.000Z"], [20, "2026-01-01T00:00:01.000Z"]]);
	for (const parentPid of [10, 20]) {
		const result = discoverVerifiedOwnedWindowsProcesses([
			{ pid: 30, parentPid, creationDate: "2026-01-01T00:00:02.000Z" },
		], identities);
		assert.equal(Array.isArray(result), false, "an unverified orphan cannot certify an empty tree");
		if (!Array.isArray(result)) {
			assert.ok(result.diagnostic.includes(`expectedParent=${JSON.stringify(identities.get(parentPid))}`));
			assert.ok(result.diagnostic.includes("observedParent=undefined"));
		}
	}
	assert.deepEqual(discoverVerifiedOwnedWindowsProcesses([], identities), []);
});

test("Windows ownership rejects missing creation identities", () => {
	const result = discoverVerifiedOwnedWindowsProcesses([
		{ pid: 10, parentPid: 1, creationDate: "" },
		{ pid: 20, parentPid: 10, creationDate: "child" },
	], new Map([[10, ""]]));
	assert.equal(Array.isArray(result), false);
	if (!Array.isArray(result)) assert.ok(result.diagnostic.includes('expected="", observed=""'));
});

test("Windows native creation identities retain 100ns ordering precision", () => {
	const parent = { pid: 10, parentPid: 1, creationDate: "134116992000000001" };
	const child = { pid: 20, parentPid: 10, creationDate: "134116992000000000" };
	assert.deepEqual(discoverVerifiedOwnedWindowsProcesses([parent, child], new Map([[10, parent.creationDate]])), {
		diagnostic: 'Windows descendant PID 20 predates parent PID 10; ownership is unverified (child="134116992000000000", parent="134116992000000001").',
	});
});

test("Windows ownership rejects a child older than its reused parent PID", () => {
	const snapshot = [
		{ pid: 10, parentPid: 1, creationDate: "2026-01-02T00:00:00.000Z" },
		{ pid: 20, parentPid: 10, creationDate: "2026-01-01T00:00:00.000Z" },
	];
	const result = discoverVerifiedOwnedWindowsProcesses(snapshot, new Map([[10, snapshot[0].creationDate]]));
	assert.deepEqual(result, { diagnostic: 'Windows descendant PID 20 predates parent PID 10; ownership is unverified (child="2026-01-01T00:00:00.000Z", parent="2026-01-02T00:00:00.000Z").' });
});

test("normal Windows close accepts a root that exited before its ownership snapshot", { skip: process.platform !== "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", ""], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	assert.ok(writer.pid);
	await once(writer, "close");
	const proof = await createOwnedProcessTreeController(writer.pid).finishAfterWriterClose();
	assert.equal(proof.state, "observed", JSON.stringify(proof));
	if (proof.state === "observed") assert.equal(proof.mechanism, "windows-process-snapshot");
});

test("explicit Windows termination fails closed when the root identity was never observed", { skip: process.platform !== "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", ""], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	assert.ok(writer.pid);
	await once(writer, "close");
	const proof = await createOwnedProcessTreeController(writer.pid).terminate();
	assert.deepEqual(proof, {
		state: "unknown",
		reason: "verification-failed",
		diagnostic: `Windows root process ${writer.pid} was not observed when ownership began.`,
	});
});

for (const killVerifyMs of [0, 3000]) {
	test(`owned Windows tree termination uses an honest ${killVerifyMs}ms verification budget`, { skip: process.platform !== "win32" }, async () => {
		const writer = spawn(process.execPath, ["-e", `
			const { spawn } = require("node:child_process");
			const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30000); setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, shell: false });
			process.stdout.write(String(child.pid) + "\\n");
			setTimeout(() => process.exit(0), 30000);
			setInterval(() => {}, 1000);
		`], { stdio: ["ignore", "pipe", "ignore"], ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
		const childPidPromise = new Promise<number>((resolve, reject) => {
			writer.once("error", reject);
			writer.stdout!.once("end", () => reject(new Error("fixture exited before reporting its child")));
			writer.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
		});
		const cleanup = new Map<number, RetainedWindowsProcess>();
		try {
			assert.ok(writer.pid);
			const snapshot = observeWindowsProcesses(cleanup, writer.pid);
			assert.ok(Array.isArray(snapshot), JSON.stringify(snapshot));
			const childPid = await childPidPromise;
			assert.ok(Array.isArray(observeWindowsProcesses(cleanup)));
			const proof = await createOwnedProcessTreeController(writer.pid, { killVerifyMs }).terminate();
			if (killVerifyMs === 0 && proof.state === "unknown") {
				assert.equal(proof.reason, "verification-failed", JSON.stringify(proof));
				return; // Zero means no exit wait, not a promise of immediate OS completion.
			}
			assert.equal(proof.state, "observed", JSON.stringify(proof));
			if (proof.state === "observed") assert.equal(proof.mechanism, "windows-process-snapshot");
			assert.throws(() => process.kill(writer.pid!, 0));
			assert.throws(() => process.kill(childPid, 0));
		} finally {
			if (cleanup.size) observeWindowsProcesses(cleanup);
			signalRetainedWindowsProcesses(cleanup, 3000);
			releaseWindowsProcesses(cleanup);
			writer.kill("SIGKILL");
		}
	});
}

test("writer close reaps only its harmless Node descendants without invoking unrelated applications", { skip: process.platform !== "win32" }, async () => {
	const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-process-tree-close-"));
	const helperPath = path.join(fixtureDir, "owned-tree-helper.mjs");
	const childPidPath = path.join(fixtureDir, "child.pid");
	const grandchildPidPath = path.join(fixtureDir, "grandchild.pid");
	fs.writeFileSync(helperPath, [
		'import { spawn } from "node:child_process";',
		'import fs from "node:fs";',
		'import { fileURLToPath } from "node:url";',
		'const [role, childPidPath, grandchildPidPath] = process.argv.slice(2);',
		'const helperPath = fileURLToPath(import.meta.url);',
		'setTimeout(() => process.exit(0), 30_000);',
		'if (role === "root") {',
		'  spawn(process.execPath, [helperPath, "child", childPidPath, grandchildPidPath], { stdio: "ignore", windowsHide: true, shell: false });',
		'  process.on("message", () => process.exit(0));',
		'} else if (role === "child") {',
		'  fs.writeFileSync(childPidPath, String(process.pid));',
		'  spawn(process.execPath, [helperPath, "grandchild", childPidPath, grandchildPidPath], { stdio: "ignore", windowsHide: true, shell: false });',
		'  setInterval(() => {}, 60_000);',
		'} else {',
		'  fs.writeFileSync(grandchildPidPath, String(process.pid));',
		'  setInterval(() => {}, 60_000);',
		'}',
	].join("\n"));
	const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
		stdio: "ignore",
		...WINDOWS_HIDDEN_PROCESS_OPTIONS,
	});
	const writer = spawn(process.execPath, [helperPath, "root", childPidPath, grandchildPidPath], {
		stdio: ["ignore", "ignore", "ignore", "ipc"],
		...WINDOWS_HIDDEN_PROCESS_OPTIONS,
	});
	assert.ok(writer.pid);
	assert.ok(unrelated.pid);
	const controller = createOwnedProcessTreeController(writer.pid, { killVerifyMs: 3000 });
	const cleanup = new Map<number, RetainedWindowsProcess>();
	let ownedPids: number[] = [];
	try {
		assert.ok(Array.isArray(observeWindowsProcesses(cleanup, writer.pid)));
		ownedPids = await waitForPidFiles([childPidPath, grandchildPidPath]);
		const snapshot = observeWindowsProcesses(cleanup);
		assert.ok(Array.isArray(snapshot), JSON.stringify(snapshot));
		writer.send("close");
		await once(writer, "close");
		const proof = await controller.finishAfterWriterClose();
		assert.equal(proof.state, "observed", JSON.stringify(proof));
		assert.equal(ownedPids.some(processIsActive), false);
		assert.equal(processIsActive(unrelated.pid), true, "an unrelated concurrent process must survive");
	} finally {
		if (cleanup.size) observeWindowsProcesses(cleanup);
		await controller.terminate();
		signalRetainedWindowsProcesses(cleanup, 3000);
		releaseWindowsProcesses(cleanup);
		try { unrelated.kill("SIGKILL"); } catch {}
		try { writer.kill("SIGKILL"); } catch {}
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
});

test("owned process tree kills descendants and verifies a TERM-resistant POSIX group", { skip: process.platform === "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", `
		const { spawn } = require("node:child_process");
		const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
		process.on("SIGTERM", () => {});
		process.stdout.write(String(child.pid) + "\\n");
		setInterval(() => {}, 1000);
	`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
	assert.ok(writer.pid);
	const grandchildPid = await new Promise<number>((resolve, reject) => {
		writer.once("error", reject);
		writer.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
	});
	const proof = await createOwnedProcessTreeController(writer.pid, { termGraceMs: 50, killVerifyMs: 1000 }).terminate();
	assert.equal(proof.state, "observed", JSON.stringify(proof));
	assert.equal(processIsActive(writer.pid), false);
	assert.equal(processIsActive(grandchildPid), false);

	const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-process-tree-ps-"));
	const realPs = spawnSync("sh", ["-c", "command -v ps"], { encoding: "utf-8" }).stdout.trim();
	const marker = path.join(fixtureDir, "failed-once");
	const originalPath = process.env.PATH;
	try {
		fs.writeFileSync(path.join(fixtureDir, "ps"), `#!/bin/sh\nif [ ! -e "$PI_TEST_PS_MARKER" ]; then\n  : > "$PI_TEST_PS_MARKER"\n  exit 1\nfi\nexec "$PI_TEST_REAL_PS" "$@"\n`);
		fs.chmodSync(path.join(fixtureDir, "ps"), 0o755);
		process.env.PATH = `${fixtureDir}${path.delimiter}${originalPath ?? ""}`;
		process.env.PI_TEST_PS_MARKER = marker;
		process.env.PI_TEST_REAL_PS = realPs;
		const enumerationFailureWriter = spawn(process.execPath, ["-e", `
			process.on("SIGTERM", () => {});
			process.stdout.write("ready\\n");
			setInterval(() => {}, 1000);
		`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
		assert.ok(enumerationFailureWriter.pid);
		await new Promise<void>((resolve, reject) => {
			enumerationFailureWriter.once("error", reject);
			enumerationFailureWriter.stdout!.once("data", () => resolve());
		});
		const termGraceMs = 50;
		const startedAt = Date.now();
		const failedProof = await createOwnedProcessTreeController(enumerationFailureWriter.pid, { termGraceMs, killVerifyMs: 1000 }).terminate();
		assert.ok(Date.now() - startedAt >= termGraceMs, "enumeration failure still waits through the TERM grace before SIGKILL");
		assert.equal(failedProof.state, "unknown", "failed ancestry inspection cannot certify cleanup even after the group exits");
		assert.equal(processIsActive(enumerationFailureWriter.pid), false);
	} finally {
		process.env.PATH = originalPath;
		delete process.env.PI_TEST_PS_MARKER;
		delete process.env.PI_TEST_REAL_PS;
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
});

test("owned process tree does not claim observed while a detached descendant remains", { skip: process.platform === "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", `
		const { spawn } = require("node:child_process");
		const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
		process.stdout.write(String(child.pid) + "\\n");
		setInterval(() => {}, 1000);
	`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
	assert.ok(writer.pid);
	const grandchildPid = await new Promise<number>((resolve, reject) => {
		writer.once("error", reject);
		writer.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
	});
	try {
		const proof = await createOwnedProcessTreeController(writer.pid, { termGraceMs: 50, killVerifyMs: 1000 }).terminate();
		assert.equal(proof.state, "unknown", JSON.stringify(proof));
		assert.equal(processIsActive(writer.pid), false);
		assert.equal(processIsActive(grandchildPid), true);
	} finally {
		for (const pid of [grandchildPid, writer.pid]) {
			try { process.kill(-pid, "SIGKILL"); } catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EPERM") {
					try { process.kill(pid, "SIGKILL"); } catch (fallbackError) {
						if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") throw fallbackError;
					}
				} else if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
	}
});

function runFreshWindowsControllerFixture(body: string, environment: NodeJS.ProcessEnv = process.env): void {
	const controllerUrl = new URL("../../src/runs/background/owned-process-tree.ts", import.meta.url).href;
	const script = `
		import assert from "node:assert/strict";
		import childProcess, { spawn } from "node:child_process";
		import { syncBuiltinESMExports } from "node:module";
		import { once } from "node:events";
		import { createOwnedProcessTreeController } from ${JSON.stringify(controllerUrl)};
		const writers = [];
		const spawnWriter = () => {
			const writer = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30000); setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, shell: false });
			writers.push(writer);
			assert.ok(writer.pid);
			return writer;
		};
		try { ${body} } finally {
			for (const writer of writers) {
				if (writer.exitCode !== null || writer.signalCode !== null) continue;
				const closed = once(writer, "close");
				writer.kill("SIGKILL");
				await closed;
			}
		}
	`;
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
		encoding: "utf8", timeout: 25_000, env: environment, ...WINDOWS_HIDDEN_PROCESS_OPTIONS,
	});
	assert.equal(result.error, undefined, result.error?.message);
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("Windows release attempts remaining identities and never retries uncertain handle numbers", { skip: process.platform !== "win32" }, () => {
	const writer = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore", ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	const retained = new Map<number, RetainedWindowsProcess>();
	const otherRetained = new Map<number, RetainedWindowsProcess>();
	try {
		assert.ok(writer.pid);
		assert.ok(Array.isArray(observeWindowsProcesses(retained, writer.pid)));
		assert.ok(other.pid);
		assert.ok(Array.isArray(observeWindowsProcesses(otherRetained, other.pid)));
		const identity = retained.get(writer.pid);
		assert.ok(identity);
		// NULL cannot designate a real host handle. Exercise success before and after failure.
		const batch = new Map([...retained, [-1, { handle: "0", creationDate: "forced-invalid", exited: false }], ...otherRetained]);
		const expectedReleased = [...retained, ...otherRetained].map(([pid, proof]) => `${pid}@${proof.creationDate}`).join(", ");
		assert.equal(signalRetainedWindowsProcesses(new Map([...retained, ...otherRetained]), 1000), undefined);
		const failure = releaseWindowsProcesses(batch);
		assert.ok(failure, "forced release failure must be reported");
		assert.match(failure.diagnostic, /uncertain.*forced-invalid/);
		assert.ok(failure.diagnostic.includes(`released=${expectedReleased}; uncertain identities=-1@forced-invalid`), failure.diagnostic);
		assert.equal(batch.size, 0, "attempted source handles must not be retried even if their close result is uncertain");
		assert.equal(releaseWindowsProcesses(batch), undefined);
		retained.clear(); // The batch attempted these same handles; never retry these aliases either.
		otherRetained.clear();
	} finally {
		// No retry of possibly consumed source handles. ChildProcess retains its separate native handle.
		retained.clear();
		otherRetained.clear();
		writer.kill("SIGKILL");
		other.kill("SIGKILL");
	}
});

test("Windows settlement and dispose surface forced release failure", { skip: process.platform !== "win32" }, () => {
	runFreshWindowsControllerFixture(`
		const original = childProcess.spawnSync;
		let releases = 0;
		childProcess.spawnSync = (...args) => {
			if (args[2]?.input && JSON.parse(args[2].input).action === "release") {
				releases++;
				return { status: 1, stdout: "", stderr: "forced release launch failure" };
			}
			return original(...args);
		};
		syncBuiltinESMExports();
		const writer = spawnWriter();
		const controller = createOwnedProcessTreeController(writer.pid, { killVerifyMs: 3000 });
		const proof = await controller.terminate();
		assert.equal(proof.state, "unknown");
		assert.match(proof.diagnostic, /forced release launch failure/);
		assert.match(proof.diagnostic, /uncertain/);
		assert.equal(await controller.terminate(), proof);
		assert.equal(releases, 1);
		const other = spawnWriter();
		const disposable = createOwnedProcessTreeController(other.pid);
		assert.throws(() => disposable.dispose(), /forced release launch failure/);
		assert.equal((await disposable.terminate()).state, "unknown");
		assert.throws(() => disposable.dispose(), /forced release launch failure/);
		assert.equal(releases, 2, "neither settlement nor repeated dispose retries ambiguous source handles");
	`);
});

test("Windows cold-cache temp directory failure becomes UNKNOWN after writer spawn", { skip: process.platform !== "win32" }, () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-owned-process-cold-cache-"));
	const notDirectory = path.join(directory, "not-a-directory");
	fs.writeFileSync(notDirectory, "fixture");
	try {
		runFreshWindowsControllerFixture(`
			const writer = spawnWriter();
			const controller = createOwnedProcessTreeController(writer.pid);
			const proof = await controller.terminate();
			assert.equal(proof.state, "unknown");
			assert.match(proof.diagnostic, /Windows identity helper.*(ENOTDIR|ENOENT|EACCES)/);
		`, { ...process.env, TEMP: notDirectory, TMP: notDirectory });
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("Windows thrown helper launch failure becomes UNKNOWN after writer spawn", { skip: process.platform !== "win32" }, () => {
	runFreshWindowsControllerFixture(`
		childProcess.spawnSync = () => { throw new Error("forced helper launch exception"); };
		syncBuiltinESMExports();
		const writer = spawnWriter();
		const controller = createOwnedProcessTreeController(writer.pid);
		const proof = await controller.terminate();
		assert.equal(proof.state, "unknown");
		assert.ok(proof.diagnostic.includes("Windows identity helper setup/launch failed: forced helper launch exception"));
	`);
});
