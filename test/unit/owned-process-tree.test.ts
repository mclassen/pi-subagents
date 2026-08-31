import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createOwnedProcessTreeController } from "../../src/runs/background/owned-process-tree.ts";

function processIsActive(pid: number): boolean {
	const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf-8" });
	return result.status === 0 && Boolean(result.stdout.trim()) && !result.stdout.trim().startsWith("Z");
}

test("owned process tree kills descendants and verifies a Windows process snapshot", { skip: process.platform !== "win32" }, async () => {
	const writer = spawn(process.execPath, ["-e", `
		const { spawn } = require("node:child_process");
		const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
		process.stdout.write(String(child.pid) + "\\n");
		setInterval(() => {}, 1000);
	`], { stdio: ["ignore", "pipe", "ignore"] });
	assert.ok(writer.pid);
	const childPid = await new Promise<number>((resolve, reject) => {
		writer.once("error", reject);
		writer.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
	});
	const proof = await createOwnedProcessTreeController(writer.pid, { killVerifyMs: 3000 }).terminate();
	assert.equal(proof.state, "observed", JSON.stringify(proof));
	if (proof.state === "observed") assert.equal(proof.mechanism, "windows-process-snapshot");
	assert.throws(() => process.kill(writer.pid!, 0));
	assert.throws(() => process.kill(childPid, 0));
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
