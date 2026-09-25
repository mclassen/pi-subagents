import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { runSetupCommand } from "../../src/runs/shared/worktree-setup-command.ts";

for (const exitCode of [0, 1, 3]) {
	test(`releases Windows ownership monitoring after setup exit ${exitCode} without certifying tree cleanup`, { skip: process.platform !== "win32" }, async (t) => {
		const intervals = new Set<ReturnType<typeof setInterval>>();
		const start = globalThis.setInterval;
		const stop = globalThis.clearInterval;
		t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
			const timer = start(...args);
			intervals.add(timer);
			return timer;
		});
		t.mock.method(globalThis, "clearInterval", (timer: ReturnType<typeof setInterval>) => {
			intervals.delete(timer);
			stop(timer);
		});
		// Scripted empty snapshots isolate resource lifetime from OS enumeration latency.
		t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "[]", stderr: "" }));
		syncBuiltinESMExports();
		try {
			const result = await runSetupCommand(process.execPath, ["-e", `process.exit(${exitCode})`], { acceptedExitCodes: [0, 1] });
			assert.equal(result.status, exitCode);
			assert.equal(intervals.size, 0, "settled setup commands must not retain polling timers");
			if (exitCode === 3) assert.equal(result.processTree?.state, "unknown");
			else assert.equal(result.processTree, undefined, "command completion is not tree proof");
		} finally {
			for (const timer of intervals) stop(timer);
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
	});
}

test("preserves exact setup-command stdout bytes alongside decoded stdout", async () => {
	const result = await runSetupCommand(process.execPath, ["-e", "process.stdout.write(Buffer.from([0, 255, 10]))"], {});

	assert.deepEqual(result.stdoutBuffer, Buffer.from([0, 255, 10]));
	assert.equal(result.stdout, Buffer.from([0, 255, 10]).toString("utf8"));
});
