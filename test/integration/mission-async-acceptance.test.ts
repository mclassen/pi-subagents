import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { DIRS, type Details } from "../../src/shared/types.ts";
import { attachMissionToLaunchResult, prepareMissionLaunch } from "../../src/missions/lifecycle.ts";
import { readMission, updateMission } from "../../src/missions/store.ts";
import { resultFilePath, resultPayloadPathForIndexedRun, writeAsyncResultFile, writePendingAsyncResultFile } from "../../src/runs/background/result-files.ts";
import { reconcileAsyncRun } from "../../src/runs/background/stale-run-reconciler.ts";
import { createEventBus, createMockPi, makeMinimalCtx } from "../support/helpers.ts";

// SYNTHETIC fixture: child session/model output and selected ordering, status,
// and liveness inputs are scripted as labeled below. Tool registration, runners,
// shell verification, watcher, mission binding and persistence are real. No
// completion events or acceptance records are fabricated by this test.
it("registered async workflow persists rejection, then corrected acceptance before parent closure", { timeout: 240_000 }, async (t) => {
	const root = fs.mkdtempSync(path.join(process.env.PI_BOUNDARY_EVIDENCE ?? os.tmpdir(), "mission-async-acceptance-"));
	const project = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	const sessionFile = path.join(agentDir, "sessions", "synthetic-owner.jsonl");
	const keys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "PI_SUBAGENTS_HERDR_BRIDGE", "PI_OFFLINE"];
	const previousEnv = new Map(keys.map((key) => [key, process.env[key]]));
	const mock = createMockPi();
	const events = createEventBus();
	const completions: Array<Record<string, unknown>> = [];
	const savedRuntimePayloads = new Map<string, string>();
	events.on("subagent:async-complete", (event) => {
		const completion = event as Record<string, unknown>;
		completions.push(completion);
		if (typeof completion.runId === "string" && completion.mode === "workflow") {
			// Preserve the actual runtime's indexed payload before the normal watcher
			// removes it. No event or ledger is fabricated for the ordering regression.
			const payloadPath = resultPayloadPathForIndexedRun(DIRS.results, completion.runId);
			if (payloadPath) savedRuntimePayloads.set(completion.runId, fs.readFileSync(payloadPath, "utf8"));
		}
	});
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	type Execute = (id: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: undefined, ctx: ExtensionContext) => Promise<AgentToolResult<Details>>;
	let execute: Execute | undefined;
	let ctx: ExtensionContext | undefined;
	let passed = false;
	let completedSubtests = 0;
	const processes: Array<{ proc: ChildProcess; closed: boolean }> = [];
	const onProcess = (message: unknown) => {
		const proc = (message as { process?: unknown }).process;
		if (!(proc instanceof ChildProcess)) return;
		const entry = { proc, closed: false };
		processes.push(entry);
		proc.once("close", () => { entry.closed = true; });
	};
	channel("child_process").subscribe(onProcess);
	const waitFor = async (label: string, predicate: () => boolean, timeoutMs = 60_000) => {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			assert.ok(Date.now() < deadline, `${label} timed out; fixture retained at ${root}; processes=${JSON.stringify(processes.map(({ proc, closed }) => ({ pid: proc.pid, exitCode: proc.exitCode, signalCode: proc.signalCode, closed })))}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	};
	try {
		fs.mkdirSync(project, { recursive: true });
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(sessionFile, "");
		process.env.PI_CODING_AGENT_DIR = agentDir;
		delete process.env.PI_SUBAGENT_CHILD;
		delete process.env.PI_SUBAGENTS_HERDR_BRIDGE;
		process.env.PI_OFFLINE = "1";
		const configPath = path.join(agentDir, "extensions", "subagent", "config.json");
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, JSON.stringify({
			asyncByDefault: true, forceTopLevelAsync: true, fleetView: false,
			artifactDir: "temp", scheduledRuns: { storeRoot: path.join(root, "scheduled") },
			missions: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") },
		}));
		const agents = path.join(project, ".pi", "agents");
		fs.mkdirSync(agents, { recursive: true });
		fs.writeFileSync(path.join(agents, "acceptance-fixture.md"), "---\nname: acceptance-fixture\ndescription: Synthetic scripted acceptance fixture\nmodel: mock/test-model\n---\nReturn the supplied synthetic report.\n");
		fs.writeFileSync(path.join(project, "verify.cjs"), "const fs = require('node:fs');\nconst pass = fs.existsSync('ready');\nfs.appendFileSync('verification.log', pass ? 'pass\\n' : 'fail\\n');\nprocess.exit(pass ? 0 : 7);\n");
		const command = `"${process.execPath}" verify.cjs`;
		const acceptance = { candidate: { files: ["verify.cjs", "ready"] }, level: "verified", criteria: ["Run the synthetic fixture gate"], verify: [{ id: "fixture-gate", command, timeoutMs: 10_000 }] };
		const report = "```acceptance-report\n" + JSON.stringify({
			criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "Synthetic child claim; actual shell gate decides" }],
			changedFiles: ["verify.cjs"], testsAddedOrUpdated: ["verify.cjs"],
			commandsRun: [{ command, result: "passed", summary: "Synthetic claim identical for both runs" }],
			validationOutput: ["Runtime must execute shell verification independently"], residualRisks: [], noStagedFiles: true,
		}) + "\n```";
		mock.install();
		const pi = new Proxy({
			events,
			on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
				const list = handlers.get(name) ?? [];
				list.push(handler);
				handlers.set(name, list);
			},
			registerTool(tool: { name: string; execute: Execute }) { if (tool.name === "subagent") execute = tool.execute; },
			registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() {},
		}, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => undefined; } });
		ctx = {
			...makeMinimalCtx(project),
			isIdle: () => true,
			hasPendingMessages: () => false,
			sessionManager: { getSessionId: () => "synthetic-async-owner", getSessionFile: () => sessionFile, getEntries: () => [] },
			modelRegistry: { getAvailable: () => [{ provider: "mock", id: "test-model", reasoning: true }] },
		} as unknown as ExtensionContext;
		const { default: register } = await import("../../index.ts");
		register(pi as unknown as ExtensionAPI);
		assert.ok(execute, "package entrypoint registered public subagent tool");
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		let callId = 0;
		// The public tool takes an inline script as options.script.
		const call = ({ workflowScript, ...params }: Record<string, unknown>) => execute!(String(++callId), workflowScript === undefined ? params : { ...params, options: { script: workflowScript } }, new AbortController().signal, undefined, ctx!);
		const created = await call({ action: "mission.create", mission: { title: "Synthetic async acceptance recovery", goal: true, maxIterations: 4 } });
		assert.notEqual(created.isError, true, JSON.stringify(created));
		const missionId = created.details.missionId!;
		const missionPath = created.details.missionPath!;
		assert.ok(missionId);
		await call({ action: "mission.update", missionId, missionUpdate: { goal: { iteration: "begin" } } });
		const readRecord = () => JSON.parse(fs.readFileSync(missionPath, "utf8"));
		const initial = readRecord();
		const launch = async (missionParams: Record<string, unknown> = { missionId }) => {
			mock.onCall({ output: report });
			const receipt = await call({
				workflowScript: `return await runs.run("acceptance", ${JSON.stringify({ agent: "acceptance-fixture", task: "Run the synthetic gate and report evidence", acceptance })});`,
				agentScope: "project", async: true, ...missionParams,
			});
			assert.notEqual(receipt.isError, true, JSON.stringify(receipt));
			assert.equal(receipt.details.mode, "workflow");
			assert.ok(receipt.details.asyncId);
			assert.ok(receipt.details.asyncDir);
			await waitFor("actual watcher completion", () => completions.some((event) => event.runId === receipt.details.asyncId));
			await waitFor("runner process close", () => processes.every((entry) => entry.closed), 30_000);
			return { receipt, completion: completions.find((event) => event.runId === receipt.details.asyncId)! };
		};
		const rejected = await launch();
		await t.test("real async child rejects despite scripted PASS claim", () => {
			assert.equal(mock.callCount(), 1);
			assert.equal(mock.sessions.length, 0, "no foreground substitute was used");
			assert.ok(processes.length > 0, "actual runner process launched");
			assert.equal(fs.readFileSync(path.join(project, "verification.log"), "utf8"), "fail\n");
			const children = rejected.completion.results as Array<{ runId?: string; success?: boolean }>;
			assert.equal(children.length, 1, "exactly one explicit acceptance-producing child");
			assert.equal(children[0]?.success, false);
			assert.ok(children[0]?.runId);
			// Observe the actual runner's durable ledger, not the workflow's lossy
			// completion projection. This is characterization, not reconciliation.
			const childDir = path.join(path.dirname(rejected.receipt.details.asyncDir!), children[0].runId!);
			const childStatus = JSON.parse(fs.readFileSync(path.join(childDir, "status.json"), "utf8"));
			assert.equal(childStatus.steps.length, 1);
			assert.equal(childStatus.steps[0].acceptance.status, "rejected");
			assert.equal(childStatus.steps[0].acceptance.explicit, true);
			assert.equal(childStatus.steps[0].acceptance.identity.producerRunId, children[0].runId);
			assert.match(childStatus.steps[0].acceptance.identity.digest, /^[a-f0-9]{64}$/);
			assert.equal(childStatus.steps[0].acceptance.verifyRuns[0].exitCode, 7);
			assert.deepEqual((children[0] as { acceptance?: unknown }).acceptance, childStatus.steps[0].acceptance, "workflow transports the actual runtime ledger unchanged");
			assert.equal(childStatus.processTerminal.state, "observed", "runner close is durably observed too");
			completedSubtests++;
		});
		const before = readRecord(); // Read authoritative bytes, never trigger reconciliation manually.
		assert.equal(before.runs.find((run: { runId: string }) => run.runId === rejected.receipt.details.asyncId)?.status, "failed");
		assert.equal(before.acceptance?.status, "rejected", "async completion must persist the explicit child's rejected acceptance on its bound mission");
		assert.deepEqual(before.acceptance, (rejected.completion.results as Array<{ acceptance?: unknown }>)[0]?.acceptance, "mission persists the transported rejected ledger unchanged");
		assert.equal(before.status, "active");
		assert.equal(before.ownerSessionId, sessionFile);
		assert.deepEqual(before.goal, initial.goal);
		const recordBytes = fs.readFileSync(missionPath, "utf8");
		const indexFiles = fs.readdirSync(path.join(root, "index"));
		assert.equal(indexFiles.length, 1);
		const indexPath = path.join(root, "index", indexFiles[0]!);
		const indexBytes = fs.readFileSync(indexPath, "utf8");
		await assert.rejects(call({ action: "mission.close", missionId, summary: "Premature closure" }), /recorded acceptance is rejected/i);
		assert.equal(fs.readFileSync(missionPath, "utf8"), recordBytes);
		assert.equal(fs.readFileSync(indexPath, "utf8"), indexBytes);
		fs.writeFileSync(path.join(project, "ready"), "synthetic corrected input");
		const corrected = await launch(); // New workflow, never resume/reuse the rejected producer.
		assert.notEqual(corrected.receipt.details.asyncId, rejected.receipt.details.asyncId);
		assert.equal(mock.callCount(), 2);
		assert.equal(fs.readFileSync(path.join(project, "verification.log"), "utf8"), "fail\npass\n");
		const correctedChildren = corrected.completion.results as Array<{ runId?: string; acceptance?: unknown }>;
		assert.equal(correctedChildren.length, 1);
		assert.ok(correctedChildren[0]?.runId);
		const correctedStatus = JSON.parse(fs.readFileSync(path.join(path.dirname(corrected.receipt.details.asyncDir!), correctedChildren[0].runId!, "status.json"), "utf8"));
		assert.deepEqual(correctedChildren[0].acceptance, correctedStatus.steps[0].acceptance, "corrected workflow also transports the runtime ledger unchanged");
		assert.equal(correctedStatus.processTerminal.state, "observed");
		const recovered = readRecord();
		assert.equal(recovered.acceptance?.status, "verified");
		assert.equal(recovered.acceptance?.verifyRuns?.[0]?.exitCode, 0);
		assert.deepEqual(recovered.acceptance, (corrected.completion.results as Array<{ acceptance?: unknown }>)[0]?.acceptance, "mission persists the transported verified ledger unchanged");
		assert.equal(recovered.status, "active", "successful child does not close parent goal");
		assert.equal(recovered.ownerSessionId, sessionFile);
		assert.deepEqual(recovered.goal, initial.goal);
		assert.ok(recovered.runs.some((run: { runId: string }) => run.runId === rejected.receipt.details.asyncId), "rejected workflow history retained");
		assert.ok(recovered.runs.some((run: { runId: string }) => run.runId === corrected.receipt.details.asyncId));
		const declaredInput = path.join(project, "ready");
		fs.writeFileSync(declaredInput, "changed declared untracked bytes after verification");
		const staleBytes = fs.readFileSync(missionPath, "utf8");
		await assert.rejects(call({ action: "mission.close", missionId, summary: "Stale candidate must not close" }), /identity is missing or stale/i);
		assert.equal(fs.readFileSync(missionPath, "utf8"), staleBytes, "stale closure leaves authoritative bytes unchanged");
		fs.writeFileSync(declaredInput, "synthetic corrected input"); // Exact bytes restored; no transient-change claim.
		assert.equal(recovered.acceptance.identity.producerRunId, correctedChildren[0].runId);
		assert.equal(recovered.acceptanceAuthority.producerRunId, correctedChildren[0].runId);
		assert.equal(recovered.acceptanceAuthority.runId, corrected.receipt.details.asyncId);
		assert.equal(recovered.acceptanceAuthority.identityDigest, recovered.acceptance.identity.digest);
		const closed = await call({ action: "mission.close", missionId, summary: "Synthetic runtime gate verified" });
		assert.notEqual(closed.isError, true, JSON.stringify(closed));
		const final = readRecord();
		assert.equal(final.status, "completed");
		assert.equal(final.ownerSessionId, sessionFile);
		assert.equal(final.goal.iterationsStarted, initial.goal.iterationsStarted);
		assert.equal(final.goal.maxIterations, initial.goal.maxIterations);
		assert.deepEqual(final.runs, recovered.runs);
		assert.deepEqual(final.acceptance, recovered.acceptance);
		await t.test("real completion before mission binding stays unknown without payload and recovers from exact saved runtime evidence", async () => {
			// SYNTHETIC ordering only: admit through the production lifecycle, launch
			// through the registered tool without binding, then attach its actual receipt
			// after the normal watcher has delivered and consumed the real result.
			const lateBinding = prepareMissionLaunch({
				params: { mission: { title: "Synthetic late-binding recovery", goal: true, maxIterations: 4 } },
				projectRoot: project, ownerSessionId: sessionFile,
				config: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") },
			})!;
			const late = await launch({ mission: false });
			const runId = late.receipt.details.asyncId!;
			const original = savedRuntimePayloads.get(runId);
			assert.ok(original, "the normal watcher exposed the actual saved runtime payload");
			await waitFor("watcher consumes original runtime payload", () => !resultPayloadPathForIndexedRun(DIRS.results, runId));
			assert.equal(fs.existsSync(path.join(late.receipt.details.asyncDir!, "mission.json")), false);
			const closeLate = () => updateMission(lateBinding.location, lateBinding.missionId, { status: "completed", expectedGoalOwnerSessionId: sessionFile });
			assert.throws(closeLate, /acceptance/i, "admission is unknown even before receipt binding");
			attachMissionToLaunchResult({ binding: lateBinding, result: late.receipt });
			const unknown = readMission(lateBinding.location, lateBinding.missionId);
			assert.equal(unknown.acceptance, undefined, "terminal status and slim replay must not invent acceptance");
			assert.throws(closeLate, /acceptance/i, "terminal-status-only fallback must stay unknown");
			fs.writeFileSync(path.join(root, "saved-actual-runtime-completion.json"), original);
			// Replay the exact saved runtime payload through its existing publication
			// primitive. Attach reads durable evidence; no runtime event is synthesized.
			const payload = JSON.parse(original);
			writePendingAsyncResultFile(resultFilePath(DIRS.results, runId), payload);
			attachMissionToLaunchResult({ binding: lateBinding, result: late.receipt });
			assert.equal(readMission(lateBinding.location, lateBinding.missionId).acceptance, undefined, "receipt recovery must not bypass pending publication");
			assert.throws(closeLate, /acceptance/i);
			writeAsyncResultFile(resultFilePath(DIRS.results, runId), payload);
			attachMissionToLaunchResult({ binding: lateBinding, result: late.receipt });
			const recoveredLate = readMission(lateBinding.location, lateBinding.missionId);
			assert.deepEqual(recoveredLate.acceptance, payload.results[0].acceptance);
			assert.equal(recoveredLate.acceptanceAuthority?.producerRunId, payload.results[0].runId);
			assert.deepEqual(recoveredLate.goal, unknown.goal);
			assert.equal(closeLate().status, "completed");
			await waitFor("watcher settles replayed payload", () => !resultPayloadPathForIndexedRun(DIRS.results, runId));
			t.diagnostic(JSON.stringify({ syntheticOrdering: true, lateRunId: runId, producerRunId: payload.results[0].runId, completionBeforeBinding: true, terminalOnlyAndPendingStayedUnknown: true, recovery: "exact saved published runtime payload", identityDigest: recoveredLate.acceptanceAuthority?.identityDigest, allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
			completedSubtests++;
		});
		await t.test("synthetic barrier: dispatched async child keeps both public closures blocked", { timeout: 100_000 }, async (boundary) => {
			const entered = path.join(project, "synthetic-gate-entered");
			const release = path.join(project, "synthetic-gate-release");
			const gate = path.join(project, "synthetic-hold.cjs");
			fs.writeFileSync(gate, "const fs=require('node:fs'); fs.writeFileSync('synthetic-gate-entered','entered'); const until=Date.now()+60000; while(!fs.existsSync('synthetic-gate-release')) { if(Date.now()>until) process.exit(9); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); } process.exit(0);\n");
			const gateCommand = `"${process.execPath}" synthetic-hold.cjs`;
			const gateAcceptance = { candidate: { files: ["synthetic-hold.cjs"] }, level: "verified", criteria: ["Synthetic bounded barrier"], verify: [{ id: "held-gate", command: gateCommand, timeoutMs: 70_000 }] };
			const freshGoal = await call({ action: "mission.create", mission: { title: "Synthetic running child boundary", goal: true, maxIterations: 4 } });
			assert.notEqual(freshGoal.isError, true, JSON.stringify(freshGoal));
			const id = freshGoal.details.missionId!;
			const goalPath = freshGoal.details.missionPath!;
			await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { iteration: "begin" } } });
			mock.onCall({ output: report });
			try {
				const receipt = await call({ workflowScript: `return await runs.run("held", ${JSON.stringify({ agent: "acceptance-fixture", task: "Synthetic child held in real shell", acceptance: gateAcceptance, async: true })});`, agentScope: "project", async: true, missionId: id });
				assert.notEqual(receipt.isError, true, JSON.stringify(receipt));
				await waitFor("held shell entered", () => fs.existsSync(entered));
				await waitFor("workflow dispatch completion", () => completions.some((event) => event.runId === receipt.details.asyncId));
				const completion = completions.find((event) => event.runId === receipt.details.asyncId)!;
				const rows = completion.results as Array<{ state?: string; runId?: string }>;
				assert.ok(rows.some((row) => row.state === "running"), JSON.stringify(completion));
				fs.writeFileSync(path.join(root, "synthetic-dispatch-completion.json"), JSON.stringify(completion, null, 2));
				assert.equal(fs.existsSync(release), false);
				const beforeBytes = fs.readFileSync(goalPath, "utf8");
				const before = JSON.parse(beforeBytes);
				const indexDir = path.join(root, "index");
				const indexPath = fs.readdirSync(indexDir).map((file) => path.join(indexDir, file)).find((file) => JSON.parse(fs.readFileSync(file, "utf8")).missionId === id)!;
				const indexBytes = fs.readFileSync(indexPath, "utf8");
				const results = await Promise.allSettled([
					call({ action: "mission.close", missionId: id, summary: "Synthetic premature close" }),
					call({ action: "mission.update", missionId: id, missionUpdate: { status: "completed" } }),
				]);
				boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "running-child", runId: receipt.details.asyncId, rows, authority: before.acceptanceAuthority, closureResults: results.map((r) => r.status), processStates: processes.map(({ proc, closed }) => ({ pid: proc.pid, closed })) }));
				assert.ok([undefined, "pending"].includes(before.acceptanceAuthority?.completion), "dispatch is not terminal acceptance evidence");
				assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
				assert.equal(fs.readFileSync(goalPath, "utf8"), beforeBytes);
				assert.equal(fs.readFileSync(indexPath, "utf8"), indexBytes);
			} finally {
				fs.writeFileSync(release, "synthetic release");
				await waitFor("held child processes settle", () => processes.every((entry) => entry.closed), 80_000);
				boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "running-child-cleanup", allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
			}
			completedSubtests++;
		});
		await t.test("synthetic runner disappearance cannot make reconstructed rows authoritative", { timeout: 100_000 }, async (boundary) => {
			const release = path.join(project, "synthetic-recovery-release");
			const entered = path.join(project, "synthetic-recovery-entered");
			fs.writeFileSync(path.join(project, "synthetic-recovery.cjs"), "const fs=require('node:fs'); fs.writeFileSync('synthetic-recovery-entered','entered'); const until=Date.now()+60000; while(!fs.existsSync('synthetic-recovery-release')) { if(Date.now()>until) process.exit(9); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); } process.exit(0);\n");
			const recoveryCommand = `"${process.execPath}" synthetic-recovery.cjs`;
			const recoveryAcceptance = { candidate: { files: ["synthetic-recovery.cjs"] }, level: "verified", criteria: ["Synthetic recovery gate"], verify: [{ id: "recovery-gate", command: recoveryCommand, timeoutMs: 70_000 }] };
			const goal = await call({ action: "mission.create", mission: { title: "Synthetic stale repair boundary", goal: true, maxIterations: 4 } });
			assert.notEqual(goal.isError, true, JSON.stringify(goal));
			const id = goal.details.missionId!;
			const goalPath = goal.details.missionPath!;
			await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { iteration: "begin" } } });
			mock.onCall({ output: report });
			try {
				const receipt = await call({ agent: "acceptance-fixture", task: "Synthetic interrupted verification", acceptance: recoveryAcceptance, agentScope: "project", async: true, missionId: id });
				assert.notEqual(receipt.isError, true, JSON.stringify(receipt));
				await waitFor("recovery gate entered", () => fs.existsSync(entered));
				const realDir = receipt.details.asyncDir!;
				const syntheticDir = path.join(root, "synthetic-disappeared-runner");
				fs.mkdirSync(syntheticDir);
				const status = JSON.parse(fs.readFileSync(path.join(realDir, "status.json"), "utf8"));
				status.state = "running";
				status.pid = 987654321; // Synthetic liveness only; no process is signaled or killed.
				status.steps = status.steps.map((step: Record<string, unknown>) => ({ ...step, status: "completed" }));
				fs.writeFileSync(path.join(syntheticDir, "status.json"), JSON.stringify(status));
				fs.copyFileSync(path.join(realDir, "mission.json"), path.join(syntheticDir, "mission.json"));
				await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { paused: true } } });
				const before = JSON.parse(fs.readFileSync(goalPath, "utf8"));
				assert.equal(before.goal.status, "paused");
				const repaired = reconcileAsyncRun(syntheticDir, { resultsDir: DIRS.results, kill: () => { throw Object.assign(new Error("synthetic dead PID"), { code: "ESRCH" }); } });
				assert.equal(repaired.repaired, true);
				await waitFor("normal watcher delivers reconstructed result", () => completions.some((event) => event.runId === receipt.details.asyncId));
				const completion = completions.find((event) => event.runId === receipt.details.asyncId)!;
				const afterBytes = fs.readFileSync(goalPath, "utf8");
				const after = JSON.parse(afterBytes);
				const indexDir = path.join(root, "index");
				const indexPath = fs.readdirSync(indexDir).map((file) => path.join(indexDir, file)).find((file) => JSON.parse(fs.readFileSync(file, "utf8")).missionId === id)!;
				const indexBytes = fs.readFileSync(indexPath, "utf8");
				fs.writeFileSync(path.join(syntheticDir, "watcher-completion.json"), JSON.stringify(completion, null, 2));
				const closures = await Promise.allSettled([
					call({ action: "mission.close", missionId: id, summary: "Synthetic stale repair must not close" }),
					call({ action: "mission.update", missionId: id, missionUpdate: { status: "completed" } }),
				]);
				boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "reconstructed-result", injected: "copied real status and mission binding; synthetic completed row and dead-PID liveness; original runner remains gated", runId: receipt.details.asyncId, syntheticDir, repair: repaired, completion, authority: after.acceptanceAuthority, closures: closures.map((r) => r.status) }));
				assert.equal(completion.state, "failed");
				assert.ok(Array.isArray(completion.results) && completion.results.length > 0);
				assert.ok([undefined, "pending"].includes(after.acceptanceAuthority?.completion), "reconstructed rows do not prove no producer");
				assert.deepEqual(closures.map((r) => r.status), ["rejected", "rejected"]);
				assert.equal(fs.readFileSync(goalPath, "utf8"), afterBytes);
				assert.equal(fs.readFileSync(indexPath, "utf8"), indexBytes);
				assert.equal(after.ownerSessionId, before.ownerSessionId);
				assert.deepEqual(after.goal, before.goal);
				for (const artifact of before.artifacts) assert.ok(after.artifacts.some((item: unknown) => JSON.stringify(item) === JSON.stringify(artifact)), "existing evidence remains present");
			} finally {
				fs.writeFileSync(release, "synthetic release");
				await waitFor("recovery runner settles", () => processes.every((entry) => entry.closed), 80_000);
				boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "recovery-cleanup", allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
			}
			completedSubtests++;
		});
		await t.test("registered direct single async verifies actual producer and current candidate", { timeout: 100_000 }, async (boundary) => {
			const directGoal = await call({ action: "mission.create", mission: { title: "Synthetic direct single boundary", goal: true, maxIterations: 4 } });
			assert.notEqual(directGoal.isError, true, JSON.stringify(directGoal));
			const id = directGoal.details.missionId!;
			const goalPath = directGoal.details.missionPath!;
			await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { iteration: "begin" } } });
			mock.onCall({ output: report });
			const receipt = await call({ agent: "acceptance-fixture", task: "Synthetic direct verification", acceptance, agentScope: "project", async: true, missionId: id });
			assert.notEqual(receipt.isError, true, JSON.stringify(receipt));
			assert.equal(receipt.details.mode, "single");
			await waitFor("direct watcher completion", () => completions.some((event) => event.runId === receipt.details.asyncId));
			await waitFor("direct runner closed", () => processes.every((entry) => entry.closed), 30_000);
			const actual = JSON.parse(fs.readFileSync(goalPath, "utf8"));
			const status = JSON.parse(fs.readFileSync(path.join(receipt.details.asyncDir!, "status.json"), "utf8"));
			fs.writeFileSync(path.join(root, "synthetic-direct-status.json"), JSON.stringify(status, null, 2));
			boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "direct-single", runId: receipt.details.asyncId, authority: actual.acceptanceAuthority, ledger: actual.acceptance, runtimeStep: status.steps?.[0], allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
			assert.equal(actual.acceptance?.status, "verified");
			assert.equal(actual.acceptance?.identity?.producerRunId, receipt.details.asyncId);
			const declared = path.join(project, "ready");
			const original = fs.readFileSync(declared);
			try {
				fs.writeFileSync(declared, "synthetic changed candidate");
				const before = fs.readFileSync(goalPath, "utf8");
				await assert.rejects(call({ action: "mission.close", missionId: id, summary: "stale direct candidate" }), /identity is missing or stale/i);
				assert.equal(fs.readFileSync(goalPath, "utf8"), before);
			} finally { fs.writeFileSync(declared, original); }
			const [closedDirect] = await Promise.allSettled([call({ action: "mission.close", missionId: id, summary: "Synthetic direct verification complete" })]);
			boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "direct-restored-closure", outcome: closedDirect.status, error: closedDirect.status === "rejected" ? String(closedDirect.reason) : undefined }));
			assert.equal(actual.acceptanceAuthority?.producerRunId, receipt.details.asyncId, "bind actual direct runner as producer");
			assert.equal(closedDirect.status, "fulfilled", "restored verified bytes must permit parent closure");
			assert.equal(JSON.parse(fs.readFileSync(goalPath, "utf8")).status, "completed");
			completedSubtests++;
		});
		await t.test("registered implicit workflow ledger permits owner closure", { timeout: 100_000 }, async (boundary) => {
			const goal = await call({ action: "mission.create", mission: { title: "Synthetic implicit acceptance boundary", goal: true, maxIterations: 4 } });
			assert.notEqual(goal.isError, true, JSON.stringify(goal));
			const id = goal.details.missionId!;
			const goalPath = goal.details.missionPath!;
			await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { iteration: "begin" } } });
			const before = JSON.parse(fs.readFileSync(goalPath, "utf8"));
			const release = path.join(project, "synthetic-implicit-release");
			mock.onCall({ output: "Synthetic implicit child result", waitForPath: release });
			try {
				const receipt = await call({ workflowScript: `return await runs.run("implicit", ${JSON.stringify({ agent: "acceptance-fixture", task: "Return a synthetic implicit child result" })});`, agentScope: "project", async: true, missionId: id });
				assert.notEqual(receipt.isError, true, JSON.stringify(receipt));
				const runId = receipt.details.asyncId!;
				assert.ok(runId);
				const pending = JSON.parse(fs.readFileSync(goalPath, "utf8"));
				assert.equal(pending.acceptanceAuthority?.completion, "pending");
				assert.equal(completions.some((event) => event.runId === runId), false);
				fs.writeFileSync(release, "synthetic release");
				await waitFor("implicit workflow completion", () => completions.some((event) => event.runId === runId));
				await waitFor("implicit runner processes closed", () => processes.every((entry) => entry.closed), 30_000);
				const completion = completions.find((event) => event.runId === runId)!;
				const rows = completion.results as Array<{ runId?: string; acceptance?: { explicit?: boolean } }>;
				assert.equal(rows.length, 1);
				assert.ok(rows[0]?.runId);
				const childStatus = JSON.parse(fs.readFileSync(path.join(path.dirname(receipt.details.asyncDir!), rows[0].runId!, "status.json"), "utf8"));
				const ledger = childStatus.steps[0].acceptance;
				assert.equal(ledger.explicit, false, "actual child ledger is implicit");
				assert.deepEqual(rows[0].acceptance, ledger, "watcher transports actual implicit ledger unchanged");
				assert.equal(childStatus.processTerminal.state, "observed");
				const observed = JSON.parse(fs.readFileSync(goalPath, "utf8"));
				boundary.diagnostic(JSON.stringify({ synthetic: true, boundary: "implicit-workflow", runId, producer: rows[0].runId, ledger, authority: observed.acceptanceAuthority, allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
				assert.equal(observed.acceptanceAuthority?.completion, "observed");
				assert.notEqual(observed.acceptanceAuthority?.runtime, true);
				assert.equal(observed.acceptance, undefined, "implicit completion must not invent a verified mission ledger");
				assert.equal(observed.ownerSessionId, before.ownerSessionId);
				assert.deepEqual(observed.goal, before.goal);
				for (const run of before.runs) assert.ok(observed.runs.some((item: { runId: string }) => item.runId === run.runId), "prior run history retained");
				const closed = await call({ action: "mission.close", missionId: id, summary: "Synthetic implicit child completed" });
				assert.notEqual(closed.isError, true, JSON.stringify(closed));
				const finalImplicit = JSON.parse(fs.readFileSync(goalPath, "utf8"));
				assert.equal(finalImplicit.status, "completed");
				assert.equal(finalImplicit.ownerSessionId, before.ownerSessionId);
				assert.deepEqual(finalImplicit.goal, before.goal);
				assert.deepEqual(finalImplicit.runs, observed.runs);
			} finally {
				if (!fs.existsSync(release)) fs.writeFileSync(release, "synthetic release");
				await waitFor("implicit fixture subprocesses settle", () => processes.every((entry) => entry.closed), 30_000);
			}
			completedSubtests++;
		});
		t.diagnostic(JSON.stringify({ synthetic: true, missionId, rejectedWorkflow: rejected.receipt.details.asyncId, correctedWorkflow: corrected.receipt.details.asyncId, verification: "fail then pass", finalStatus: final.status, iterationsStarted: final.goal.iterationsStarted, allCapturedSubprocessesClosed: processes.every((entry) => entry.closed) }));
		passed = completedSubtests === 6;
	} finally {
		try {
			if (ctx) for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
			await waitFor("terminal subprocesses before fixture cleanup", () => processes.every((entry) => entry.closed), 30_000);
		} finally {
			channel("child_process").unsubscribe(onProcess);
			const terminal = processes.every((entry) => entry.closed);
			if (terminal) mock.uninstall(); // Never remove a live runner's scripted queue.
			for (const [key, value] of previousEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
			if (passed && terminal) fs.rmSync(root, { recursive: true, force: true });
			else t.diagnostic(`Synthetic failure evidence retained: ${root}; all captured subprocesses closed=${terminal}`);
		}
	}
});
