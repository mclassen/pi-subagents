import assert from "node:assert/strict";
import fsDefault, * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { interruptRequestPath } from "../../src/runs/background/control-channel.ts";
import { processTerminalCandidatePath } from "../../src/runs/background/process-terminal.ts";
import { resultCandidateFilesForSession } from "../../src/runs/background/result-files.ts";
import { runSubagent, type SubagentRunConfig } from "../../src/runs/background/subagent-runner.ts";
import type { ChildSessionFactory } from "../../src/runs/shared/child-session.ts";
import { createFakeChildSessions } from "../support/fake-child-session.ts";

for (const outcome of ["complete", "budget", "interrupt", "capacity", "disposal-failure"] as const) {
	test(`runner publication waits for successful disposal: ${outcome}`, { timeout: 15_000 }, async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-runner-publication-order-"));
		const queue = path.join(root, "queue");
		const asyncDir = path.join(root, "async");
		const resultsDir = path.join(root, "results");
		const resultPath = path.join(resultsDir, "publication-order.json");
		const sessionId = "publication-order-session";
		fs.mkdirSync(queue, { recursive: true });
		fs.writeFileSync(path.join(queue, "default-response.json"), JSON.stringify({ output: "done" }));
		const fake = createFakeChildSessions(() => queue);
		let releaseDisposal!: () => void;
		let disposalStarted!: () => void;
		const disposalGate = new Promise<void>((resolve) => { releaseDisposal = resolve; });
		const disposalObserved = new Promise<void>((resolve) => { disposalStarted = resolve; });
		const factory: ChildSessionFactory = {
			async create(launch) {
				if (outcome === "interrupt") {
					const requestPath = interruptRequestPath(asyncDir);
					fs.mkdirSync(path.dirname(requestPath), { recursive: true });
					fs.writeFileSync(requestPath, "{}");
					fs.writeFileSync(path.join(queue, "default-response.json"), JSON.stringify({ hangUntilAbort: true }));
				}
				return fake.factory.create(launch);
			},
			async dispose() {
				disposalStarted();
				await disposalGate;
				if (outcome === "disposal-failure") throw new Error("injected disposal failure");
				await fake.factory.dispose();
			},
		};
		const config: SubagentRunConfig = {
			id: "publication-order",
			steps: outcome === "budget"
				? [{ agent: "worker", task: "first" }, { agent: "worker", task: "second" }]
				: [{ agent: "worker", task: "finish" }],
			...(outcome === "budget" ? { usageBudget: { tokens: { hard: 1 } } } : {}),
			resultPath,
			cwd: root,
			placeholder: "{previous}",
			asyncDir,
			sessionId,
			runnerProcessInstanceId: "publication-runner",
			artifactConfig: { enabled: false },
			share: false,
		};
		const originalRename = fsDefault.renameSync;
		let storageFull = outcome === "capacity";
		let capacityFailureObserved!: () => void;
		const capacityFailure = new Promise<void>((resolve) => { capacityFailureObserved = resolve; });
		if (outcome === "capacity") {
			fsDefault.renameSync = ((from, to) => {
				if (storageFull && String(to).startsWith(resultsDir)) {
					capacityFailureObserved();
					throw Object.assign(new Error("injected result capacity failure"), { code: "ENOSPC" });
				}
				return originalRename(from, to);
			}) as typeof fsDefault.renameSync;
			syncBuiltinESMExports();
		}
		const run = runSubagent(config, factory);
		// Observe rejection immediately, even if an earlier assertion fails.
		const settled = run.then(() => undefined, (error: unknown) => error);
		try {
			await disposalObserved;
			assert.equal(fs.existsSync(resultPath), false);
			assert.deepEqual(resultCandidateFilesForSession(resultsDir, sessionId), []);
			assert.equal(fs.existsSync(processTerminalCandidatePath(asyncDir)), false);
			releaseDisposal();
			if (outcome === "capacity") {
				await capacityFailure;
				assert.deepEqual(resultCandidateFilesForSession(resultsDir, sessionId), []);
				storageFull = false;
			}
			const error = await settled;
			if (outcome === "disposal-failure") {
				assert.ok(error instanceof Error);
				assert.match(error.message, /injected disposal failure/);
				assert.equal(fs.existsSync(resultPath), false);
				assert.deepEqual(resultCandidateFilesForSession(resultsDir, sessionId), []);
				assert.equal(fs.existsSync(processTerminalCandidatePath(asyncDir)), false);
				const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8"));
				assert.equal(status.state, "failed");
				assert.match(status.error, /dispos/i);
			} else {
				assert.equal(error, undefined);
				assert.equal(fs.existsSync(resultPath), true);
				assert.deepEqual(resultCandidateFilesForSession(resultsDir, sessionId), ["publication-order.json"]);
				const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
				assert.equal(result.state, outcome === "budget" ? "failed" : outcome === "interrupt" ? "paused" : "complete");
			}
		} finally {
			storageFull = false;
			fsDefault.renameSync = originalRename;
			syncBuiltinESMExports();
			releaseDisposal();
			await settled;
			await fake.factory.dispose();
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
}
