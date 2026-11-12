import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { withFileLock } from "../../src/shared/file-lock.ts";

const childFixture = fileURLToPath(new URL("../fixtures/mission-lock/lock-child.mjs", import.meta.url));

function startHolder(filePath: string): ChildProcess {
	const child = spawn(process.execPath, ["--experimental-strip-types", childFixture, "hold", filePath], {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	return child;
}

async function waitForLine(child: ChildProcess): Promise<void> {
	let output = "";
	const signal = AbortSignal.timeout(10_000);
	while (!output.includes("locked\n")) {
		const [chunk] = await once(child.stdout!, "data", { signal });
		output += chunk.toString();
	}
}

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryPath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lock-"));
	roots.push(root);
	return path.join(root, "record.json");
}

function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	child.kill();
	return once(child, "exit", { signal: AbortSignal.timeout(10_000) }).then(() => undefined);
}

test("live owner is not reclaimed and contention timeout is bounded", () => {
	const filePath = temporaryPath();
	withFileLock(filePath, () => {
		assert.throws(() => withFileLock(filePath, () => undefined, { retryDelaysMs: [] }), /Timed out acquiring mission state lock/);
		assert.equal(fs.existsSync(`${filePath}.lock/owner.json`), true);
	});
	assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test("a killed lock holder is reclaimed by a separate process", async () => {
	const filePath = temporaryPath();
	const child = startHolder(filePath);
	try {
		await waitForLine(child);
		assert.equal(fs.existsSync(`${filePath}.lock/owner.json`), true);
		assert.throws(() => withFileLock(filePath, () => assert.fail("entered a live child's lock"), { retryDelaysMs: [] }), /Timed out acquiring mission state lock/);
		child.kill();
		await once(child, "exit", { signal: AbortSignal.timeout(10_000) });
		let entered = false;
		withFileLock(filePath, () => { entered = true; }, { retryDelaysMs: [1, 2, 3] });
		assert.equal(entered, true);
		assert.equal(fs.existsSync(`${filePath}.lock`), false);
	} finally {
		await stopChild(child);
		fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
	}
});

test("release preserves a replacement lock with a different owner token", () => {
	const filePath = temporaryPath();
	const lockPath = `${filePath}.lock`;
	withFileLock(filePath, () => {
		fs.rmSync(lockPath, { recursive: true, force: true });
		fs.mkdirSync(lockPath);
		fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 999999, token: "replacement", createdAt: Date.now() }));
	});
	assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).token, "replacement");
	fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("an unresolved start key for this live PID fails closed", () => {
	const filePath = temporaryPath();
	const lockPath = `${filePath}.lock`;
	fs.mkdirSync(lockPath);
	fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token: "held", createdAt: Date.now(), processKey: "unavailable-key" }));
	assert.throws(() => withFileLock(filePath, () => undefined, {
		isProcessAlive: () => true,
		getProcessStartKey: () => undefined,
		retryDelaysMs: [],
	}), /Timed out acquiring mission state lock/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).token, "held");
	fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});
