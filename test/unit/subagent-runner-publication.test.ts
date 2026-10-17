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
import { DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS } from "../../src/shared/file-system-retry.ts";

for (const code of ["EPERM", "EBUSY", "EACCES"] as const) {
	test(`running progress rename exhaustion does not discard the child: ${code}`, { timeout: 15_000 }, async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-runner-progress-lock-"));
		const queue = path.join(root, "queue");
		const asyncDir = path.join(root, "async");
		const resultsDir = path.join(root, "results");
		const statusPath = path.join(asyncDir, "status.json");
		fs.mkdirSync(queue, { recursive: true });
		const message = (text: string) => ({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
		fs.writeFileSync(path.join(queue, "default-response.json"), JSON.stringify({ steps: [
			{ jsonl: [message("progress before lock")] },
			{ delay: 300, jsonl: [message("finished after lock")] },
		] }));
		const fake = createFakeChildSessions(() => queue);
		const originalRename = fsDefault.renameSync;
		const originalWait = Atomics.wait;
		let blockedAttempts = 0;
		let oldStatus: string | undefined;
		// Exhaust the existing synchronous ladder without spending host time.
		Atomics.wait = () => "timed-out";
		fsDefault.renameSync = ((from, to) => {
			if (String(to) === statusPath) {
				const payload = JSON.parse(fs.readFileSync(String(from), "utf-8"));
				if (payload.state === "running" && payload.turnCount === 1) {
					const previous = fs.readFileSync(statusPath, "utf-8");
					oldStatus ??= previous;
					assert.equal(previous, oldStatus, "failed atomic publication changed the last durable status");
					blockedAttempts += 1;
					throw Object.assign(new Error("injected progress rename lock"), { code });
				}
			}
			return originalRename(from, to);
		}) as typeof fsDefault.renameSync;
		syncBuiltinESMExports();
		const config: SubagentRunConfig = {
			id: "progress-lock", steps: [{ agent: "worker", task: "finish despite a progress lock" }],
			resultPath: path.join(resultsDir, "progress-lock.json"), cwd: root, placeholder: "{previous}", asyncDir,
			sessionId: "progress-lock-session", runnerProcessInstanceId: "progress-lock-runner",
			artifactConfig: { enabled: false }, share: false,
		};
		const settled = runSubagent(config, fake.factory).then(() => undefined, (error: unknown) => error);
		try {
			assert.equal(await settled, undefined);
			assert.ok(blockedAttempts >= DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS.length + 1);
			assert.ok(fake.sessions.every((session) => session.settled && session.disposed));
			assert.equal(fake.sessions.length, 1, "the child was replaced instead of preserved");
			const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
			assert.equal(status.state, "complete");
			assert.equal(status.turnCount, 2, "latest progress was not recovered");
			assert.equal(status.steps[0].status, "complete");
			assert.ok(fs.existsSync(processTerminalCandidatePath(asyncDir)));
			assert.deepEqual(resultCandidateFilesForSession(resultsDir, config.sessionId!), ["progress-lock.json"]);
			const result = JSON.parse(fs.readFileSync(config.resultPath, "utf-8"));
			assert.equal(result.state, "complete");
			assert.match(result.results[0].output, /finished after lock/);
		} finally {
			fsDefault.renameSync = originalRename;
			Atomics.wait = originalWait;
			syncBuiltinESMExports();
			await settled;
			await fake.factory.dispose();
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
}

for (const barrier of ["startup", "terminal"] as const) {
	test(`runner ${barrier} status rename exhaustion remains fail-closed`, { timeout: 15_000 }, async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-runner-status-barrier-"));
		const queue = path.join(root, "queue");
		const asyncDir = path.join(root, "async");
		const resultsDir = path.join(root, "results");
		const statusPath = path.join(asyncDir, "status.json");
		fs.mkdirSync(queue, { recursive: true });
		fs.writeFileSync(path.join(queue, "default-response.json"), JSON.stringify({ output: "done" }));
		const fake = createFakeChildSessions(() => queue);
		const originalRename = fsDefault.renameSync;
		const originalWait = Atomics.wait;
		let blockedAttempts = 0;
		Atomics.wait = () => "timed-out";
		fsDefault.renameSync = ((from, to) => {
			if (String(to) === statusPath) {
				const payload = JSON.parse(fs.readFileSync(String(from), "utf-8"));
				if (barrier === "startup" || (payload.state !== "running" && payload.state !== "queued")) {
					blockedAttempts += 1;
					throw Object.assign(new Error("injected status publication lock"), { code: "EPERM" });
				}
			}
			return originalRename(from, to);
		}) as typeof fsDefault.renameSync;
		syncBuiltinESMExports();
		const config: SubagentRunConfig = {
			id: "status-barrier", steps: [{ agent: "worker", task: "finish" }],
			resultPath: path.join(resultsDir, "status-barrier.json"), cwd: root, placeholder: "{previous}", asyncDir,
			sessionId: "status-barrier-session", runnerProcessInstanceId: "status-barrier-runner",
			artifactConfig: { enabled: false }, share: false,
		};
		const settled = runSubagent(config, fake.factory).then(() => undefined, (error: unknown) => error);
		try {
			const error = await settled;
			assert.ok(error instanceof Error);
			assert.match(error.message, /injected status publication lock/);
			assert.ok(blockedAttempts >= DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS.length + 1);
			assert.equal(fs.existsSync(processTerminalCandidatePath(asyncDir)), false);
			// Pending payloads may exist after disposal; neither a public result
			// nor writer-terminal proof may be committed after this barrier fails.
			assert.equal(fs.existsSync(config.resultPath), false);
			if (barrier === "startup") assert.equal(fake.sessions.length, 0);
		} finally {
			fsDefault.renameSync = originalRename;
			Atomics.wait = originalWait;
			syncBuiltinESMExports();
			await settled;
			await fake.factory.dispose();
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
}

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
