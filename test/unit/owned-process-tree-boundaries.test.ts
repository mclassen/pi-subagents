import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createOwnedProcessTreeController } from "../../src/runs/background/owned-process-tree.ts";

// Scripted OS snapshots exercise the real controller without signaling OS processes.
for (const scenario of [
	"initial-orphan",
	"detached-grandchild",
	"missing-posix-root",
	"inspection-failure",
] as const) {
	test(`process-tree proof fails closed for ${scenario}`, async () => {
		const spawn = childProcess.spawnSync;
		const kill = process.kill;
		const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
		const killed: string[] = [];
		const result = (stdout: string, status = 0, stderr = "") => ({
			status,
			stdout,
			stderr,
			pid: 0,
			output: [],
			signal: null,
		});
		try {
			Object.defineProperty(process, "platform", {
				...platform,
				value: scenario === "initial-orphan" ? "win32" : "linux",
			});
			process.kill = () => true;
			childProcess.spawnSync = ((_file: string, args: string[]) => {
				if (scenario === "initial-orphan") {
					if (String(_file).endsWith("taskkill.exe")) {
						killed.push(args[1]!);
						return result("");
					}
					return result(
						JSON.stringify([
							{ ProcessId: 200, ParentProcessId: 100, CreationDate: "child" },
						]),
					);
				}
				if (args.includes("pid=,ppid=,pgid=,stat=")) {
					if (scenario === "inspection-failure") return result("", 1, "inspection failed");
					if (scenario === "missing-posix-root") return result("200 1 100 S\n");
					return result("100 1 100 S\n200 100 200 S\n300 200 300 S\n");
				}
				if (args.includes("pid=,pgid=,stat=")) {
					return scenario === "missing-posix-root" ? result("200 100 S\n") : result("300 300 S\n");
				}
				if (args.includes("stat="))
					return args.at(-1) === "300" ? result("S\n") : result("", 1);
				throw new Error(`Unexpected process inspection: ${args.join(" ")}`);
			}) as typeof childProcess.spawnSync;
			syncBuiltinESMExports();
			const controller = createOwnedProcessTreeController(100, {
				killVerifyMs: 0,
			});
			const proof = await controller.finishAfterWriterClose();
			assert.equal(proof.state, "unknown", JSON.stringify(proof));
			assert.deepEqual(
				killed,
				[],
				"unverified ancestry never authorizes a signal",
			);
		} finally {
			childProcess.spawnSync = spawn;
			process.kill = kill;
			Object.defineProperty(process, "platform", platform);
			syncBuiltinESMExports();
		}
	});
}
