import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createOwnedProcessTreeController } from "../../src/runs/background/owned-process-tree.ts";
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

test("owned process tree kills descendants and verifies a Windows process snapshot", { skip: process.platform !== "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", `
		const { spawn } = require("node:child_process");
		const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, shell: false });
		process.stdout.write(String(child.pid) + "\\n");
		setInterval(() => {}, 1000);
	`], { stdio: ["ignore", "pipe", "ignore"], ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
	assert.ok(writer.pid);
	const childPid = await new Promise<number>((resolve, reject) => {
		writer.once("error", reject);
		writer.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
	});
	const proof = await createOwnedProcessTreeController(writer.pid, { killVerifyMs: 0 }).terminate();
	assert.equal(proof.state, "observed", JSON.stringify(proof));
	if (proof.state === "observed") assert.equal(proof.mechanism, "windows-process-snapshot");
	assert.throws(() => process.kill(writer.pid!, 0));
	assert.throws(() => process.kill(childPid, 0));
});

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
		'if (role === "root") {',
		'  spawn(process.execPath, [helperPath, "child", childPidPath, grandchildPidPath], { stdio: "ignore", windowsHide: true, shell: false });',
		'  const timer = setInterval(() => { if (fs.existsSync(grandchildPidPath)) { clearInterval(timer); setTimeout(() => process.exit(0), 3000); } }, 10);',
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
		stdio: "ignore",
		...WINDOWS_HIDDEN_PROCESS_OPTIONS,
	});
	assert.ok(writer.pid);
	assert.ok(unrelated.pid);
	const controller = createOwnedProcessTreeController(writer.pid, { killVerifyMs: 3000 });
	let ownedPids: number[] = [];
	try {
		ownedPids = await waitForPidFiles([childPidPath, grandchildPidPath]);
		await once(writer, "close");
		const proof = await controller.finishAfterWriterClose();
		assert.equal(proof.state, "observed", JSON.stringify(proof));
		assert.equal(ownedPids.some(processIsActive), false);
		assert.equal(processIsActive(unrelated.pid), true, "an unrelated concurrent process must survive");
	} finally {
		for (const pid of ownedPids) {
			try { process.kill(pid, "SIGKILL"); } catch {}
		}
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
		assert.equal(failedProof.state, "observed", JSON.stringify(failedProof));
		assert.equal(processIsActive(enumerationFailureWriter.pid), false);
	} finally {
		process.env.PATH = originalPath;
		delete process.env.PI_TEST_PS_MARKER;
		delete process.env.PI_TEST_REAL_PS;
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
});
