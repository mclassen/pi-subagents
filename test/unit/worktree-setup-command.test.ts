import assert from "node:assert/strict";
import test from "node:test";
import { runSetupCommand } from "../../src/runs/shared/worktree-setup-command.ts";

test("preserves exact setup-command stdout bytes alongside decoded stdout", async () => {
	const result = await runSetupCommand(process.execPath, ["-e", "process.stdout.write(Buffer.from([0, 255, 10]))"], {});

	assert.deepEqual(result.stdoutBuffer, Buffer.from([0, 255, 10]));
	assert.equal(result.stdout, Buffer.from([0, 255, 10]).toString("utf8"));
});
