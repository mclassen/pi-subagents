import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { DIRS, type Details, type SingleResult, type WorkflowChildSummary } from "../../src/shared/types.ts";
import { resultFilePath } from "../../src/runs/background/result-files.ts";
import { reconcileAsyncRun } from "../../src/runs/background/stale-run-reconciler.ts";
import { attachMissionToLaunchResult, prepareMissionLaunch, syncMissionFromAsyncCompletion, writeMissionAsyncBinding } from "../../src/missions/lifecycle.ts";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { createMission, missionRecordPath, readMission, updateMission } from "../../src/missions/store.ts";
import { evaluateAcceptance, resolveEffectiveAcceptance } from "../../src/runs/shared/acceptance.ts";
import type { AcceptanceLedger } from "../../src/shared/types.ts";

// SYNTHETIC unit completions only; the separate registered integration executes
// the real workflow/watcher. Ledgers here are generated with real shell checks.
async function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-identity-"));
	const projectRoot = path.join(root, "project");
	fs.mkdirSync(projectRoot);
	fs.writeFileSync(path.join(projectRoot, "input"), "candidate");
	const binding = prepareMissionLaunch({ params: { mission: { title: "Synthetic acceptance identity", goal: true, maxIterations: 4 } }, projectRoot, ownerSessionId: "owner", config: { directory: path.join(root, "missions"), globalIndex: false } })!;
	const policy = resolveEffectiveAcceptance({ agentName: "synthetic", agentContract: { version: 1 }, explicit: { level: "verified", candidate: { files: ["input"] }, verify: [{ id: "real-shell", command: `"${process.execPath}" -e "process.exit(0)"` }] } });
	let count = 0;
	const launch = (existing = false) => {
		const current = existing ? binding : prepareMissionLaunch({ params: { missionId: binding.missionId }, projectRoot, ownerSessionId: "owner", config: { directory: path.join(root, "missions"), globalIndex: false } })!;
		const runId = `workflow-${++count}`;
		const asyncDir = path.join(root, runId); fs.mkdirSync(asyncDir);
		updateMission(binding.location, binding.missionId, { acceptanceLaunch: { launchId: current.acceptanceLaunchId!, runId }, addRuns: [{ runId, mode: "workflow", status: "running" }] });
		writeMissionAsyncBinding(asyncDir, current);
		const complete = (results: unknown[], id = runId, fields: Record<string, unknown> = {}) => syncMissionFromAsyncCompletion({ asyncDir, runId: id, mode: "workflow", state: "complete", results, ...fields })!;
		return { runId, asyncDir, complete, binding: current };
	};
	const ledger = async (runId: string, exitCode = 0): Promise<AcceptanceLedger> => {
		const acceptance = structuredClone(policy);
		acceptance.verify[0]!.command = `"${process.execPath}" -e "process.exit(${exitCode})"`;
		return JSON.parse(JSON.stringify(await evaluateAcceptance({ acceptance, cwd: projectRoot, output: "", reportOptional: true, runId })));
	};
	const noProducer = () => evaluateAcceptance({ acceptance: resolveEffectiveAcceptance({ agentName: "synthetic-read-only", agentContract: { version: 1 } }), cwd: projectRoot, output: "" });
	const read = () => readMission(binding.location, binding.missionId);
	const close = () => updateMission(binding.location, binding.missionId, { status: "completed", expectedGoalOwnerSessionId: "owner" });
	return { root, projectRoot, binding, launch, ledger, noProducer, read, close, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// SYNTHETIC foreground boundary: native result rows have workflowKey but no
// runId. The existing complete workflow inventory supplies the actual child ID.
function foregroundWorkflowResult(runId: string, acceptance: AcceptanceLedger) {
	const row: SingleResult & { runId?: unknown } = {
		index: 0, agent: "synthetic", task: "Synthetic foreground completion", workflowKey: "sole-child", exitCode: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, acceptance,
	};
	const inventory: WorkflowChildSummary = {
		version: 1, parentToolCallId: "synthetic-tool", workflowRunId: runId, inventoryComplete: true, workflowState: "completed",
		children: [{ childId: "sole-child", runId: "actual-inventory-child", state: "completed" }],
	};
	const result: AgentToolResult<Details> = { content: [], details: { mode: "workflow", runId, results: [row], workflowChildren: inventory } };
	return { row, inventory, result };
}

for (const policy of ["disabled", "implicit-not-required", "implicit-attested"] as const) {
	it(`foreground workflow ${policy} completion binds matching inventory without a row runId`, async () => {
		const f = await fixture();
		try {
			const run = f.launch(true);
			const acceptance = policy === "implicit-not-required" ? await f.noProducer() : await evaluateAcceptance({
				acceptance: resolveEffectiveAcceptance({ agentName: "synthetic", ...(policy === "disabled" ? { explicit: false as const } : {}) }),
				cwd: f.projectRoot, output: "", report: { manualNotes: "SYNTHETIC unit evidence", residualRisks: [] },
			});
			const completion = foregroundWorkflowResult(run.runId, acceptance);
			assert.equal(Object.hasOwn(completion.row, "runId"), false);
			const before = f.read();
			attachMissionToLaunchResult({ binding: run.binding, result: completion.result });
			assert.equal(f.read().acceptanceAuthority?.completion, "observed");
			assert.equal(f.read().acceptance, undefined, "known none does not invent a persisted ledger");
			assert.equal(f.read().ownerSessionId, before.ownerSessionId);
			assert.deepEqual(f.read().goal, before.goal);
			assert.equal(f.close().status, "completed");
		} finally { f.cleanup(); }
	});
}

it("foreground workflow verification binds the actual inventory child, not the outer workflow or ledger-selected identity", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const ledger = await f.ledger("actual-inventory-child");
		const completion = foregroundWorkflowResult(run.runId, ledger);
		const before = f.read();
		attachMissionToLaunchResult({ binding: run.binding, result: completion.result });
		assert.equal(f.read().acceptanceAuthority?.completion, "observed");
		assert.equal(f.read().acceptanceAuthority?.producerRunId, "actual-inventory-child");
		assert.notEqual(f.read().acceptanceAuthority?.producerRunId, run.runId);
		assert.equal(f.read().acceptanceAuthority?.identityDigest, ledger.identity!.digest);
		assert.deepEqual(f.read().acceptance, ledger);
		assert.deepEqual(f.read().goal, before.goal);
		fs.writeFileSync(path.join(f.projectRoot, "input"), "changed declared candidate");
		assert.throws(f.close, /missing or stale/i);
		fs.writeFileSync(path.join(f.projectRoot, "input"), "candidate");
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

it("foreground inventory binding never lets ledger identity choose the producer", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const completion = foregroundWorkflowResult(run.runId, await f.ledger("ledger-selected-child"));
		attachMissionToLaunchResult({ binding: run.binding, result: completion.result });
		assert.equal(f.read().acceptanceAuthority?.producerRunId, "actual-inventory-child");
		assert.equal(f.read().acceptanceAuthority?.identityDigest, undefined);
		assert.throws(f.close, /missing or stale/i);
	} finally { f.cleanup(); }
});

it("foreground known-none inventory completion cannot refresh historic runtime acceptance", async () => {
	const f = await fixture();
	try {
		const previous = f.launch(true);
		const ledger = await f.ledger("previous-producer");
		previous.complete([{ runId: "previous-producer", acceptance: ledger }]);
		const before = f.read();
		const current = f.launch();
		const completion = foregroundWorkflowResult(current.runId, await f.noProducer());
		attachMissionToLaunchResult({ binding: current.binding, result: completion.result });
		assert.equal(f.read().acceptanceAuthority?.completion, "observed");
		assert.equal(f.read().acceptanceAuthority?.runtime, true);
		assert.equal(f.read().acceptanceAuthority?.identityDigest, undefined);
		assert.deepEqual(f.read().acceptance, ledger);
		assert.deepEqual(f.read().goal, before.goal);
		assert.throws(f.close, /missing or stale/i);
	} finally { f.cleanup(); }
});

it("async synchronization and saved recovery do not borrow a missing row ID from foreground-style inventory", async () => {
	const f = await fixture();
	let payloadPath: string | undefined;
	try {
		const run = f.launch(true);
		const completion = foregroundWorkflowResult(run.runId, await f.noProducer());
		const payload = { mode: "workflow", runId: run.runId, asyncDir: run.asyncDir, state: "complete", results: [completion.row], workflowChildren: completion.inventory };
		syncMissionFromAsyncCompletion(payload);
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		fs.mkdirSync(DIRS.results, { recursive: true });
		payloadPath = resultFilePath(DIRS.results, run.runId);
		fs.writeFileSync(payloadPath, JSON.stringify(payload));
		fs.writeFileSync(path.join(run.asyncDir, "status.json"), JSON.stringify({ state: "complete" }));
		attachMissionToLaunchResult({ binding: run.binding, result: { content: [], details: { mode: "workflow", runId: run.runId, asyncId: run.runId, asyncDir: run.asyncDir, results: [] } } });
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		assert.equal(f.read().acceptance, undefined);
		assert.throws(f.close, /pending|unknown|missing or stale/i);
	} finally { if (payloadPath) fs.rmSync(payloadPath, { force: true }); f.cleanup(); }
});

for (const invalid of ["missing-inventory", "wrong-outer-inventory", "incomplete-inventory", "running-inventory", "multiple-inventory", "missing-child-id", "empty-child-id", "missing-key", "mismatched-key", "empty-row-id", "undefined-row-id", "null-row-id", "numeric-row-id", "conflicting-row-id", "multiple-rows", "running-child", "paused-child", "detached-child", "detached-row", "missing-ledger"] as const) {
	it(`foreground inventory binding rejects ${invalid} without sealing unknown authority`, async () => {
		const f = await fixture();
		try {
			const run = f.launch(true);
			const completion = foregroundWorkflowResult(run.runId, await f.noProducer());
			const { row, inventory, result } = completion;
			if (invalid === "missing-inventory") delete result.details.workflowChildren;
			if (invalid === "wrong-outer-inventory") inventory.workflowRunId = "unrelated-workflow";
			if (invalid === "incomplete-inventory") inventory.inventoryComplete = false;
			if (invalid === "running-inventory") inventory.workflowState = "running";
			if (invalid === "multiple-inventory") inventory.children.push({ childId: "other-child", runId: "other-run", state: "completed" });
			if (invalid === "missing-child-id") delete inventory.children[0]!.runId;
			if (invalid === "empty-child-id") inventory.children[0]!.runId = "";
			if (invalid === "missing-key") delete row.workflowKey;
			if (invalid === "mismatched-key") row.workflowKey = "unrelated-key";
			if (invalid === "empty-row-id") row.runId = "";
			if (invalid === "undefined-row-id") row.runId = undefined;
			if (invalid === "null-row-id") row.runId = null;
			if (invalid === "numeric-row-id") row.runId = 7;
			if (invalid === "conflicting-row-id") row.runId = "unrelated-row-child";
			if (invalid === "multiple-rows") result.details.results.push({ ...row, index: 1 });
			if (invalid === "running-child") inventory.children[0]!.state = "running";
			if (invalid === "paused-child") inventory.children[0]!.state = "paused";
			if (invalid === "detached-child") inventory.children[0]!.state = "detached";
			if (invalid === "detached-row") row.detached = true;
			if (invalid === "missing-ledger") delete row.acceptance;
			const before = f.read();
			attachMissionToLaunchResult({ binding: run.binding, result });
			assert.equal(f.read().acceptanceAuthority?.completion, "pending");
			assert.equal(f.read().acceptance, undefined);
			assert.equal(f.read().ownerSessionId, before.ownerSessionId);
			assert.deepEqual(f.read().goal, before.goal);
			assert.throws(f.close, /pending|unknown|missing or stale/i);
		} finally { f.cleanup(); }
	});
}

for (const state of ["missing-ledger", "bare-ledger", "malformed-ledger", "running", "queued", "paused", "detached", "interrupted", "progress-running", "empty", "multiple-implicit"] as const) {
	it(`keeps ${state} completion evidence unknown instead of sealing no producer`, async () => {
		const f = await fixture();
		try {
			const run = f.launch(true);
			const none = await f.noProducer();
			const row = { runId: "uncollected-child", acceptance: none };
			const results = state === "empty" ? [] : state === "missing-ledger" ? [{ runId: "uncollected-child", success: true }]
				: state === "bare-ledger" ? [{ ...row, acceptance: { explicit: false, status: "not-required" } }]
				: state === "malformed-ledger" ? [{ ...row, acceptance: { ...none, runtimeChecks: [{}] } }]
				: state === "multiple-implicit" ? [row, { ...row, runId: "second-child" }]
				: state === "interrupted" ? [{ ...row, interrupted: true }]
				: state === "progress-running" ? [{ ...row, progress: { status: "running" } }] : [{ ...row, state }];
			const before = f.read();
			run.complete(results);
			assert.equal(f.read().acceptanceAuthority?.completion, "pending");
			assert.equal(f.read().acceptance, undefined);
			assert.throws(f.close, /pending|unknown|missing or stale/i);
			assert.deepEqual(f.read().goal, before.goal);
		} finally { f.cleanup(); }
	});
}

it("a later uncollected native child completion cannot authorize its already-finished dispatcher", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const childRunId = "uncollected-child";
		run.complete([{ runId: childRunId, state: "running" }]);
		const pending = f.read();
		const childDir = path.join(f.root, childRunId); fs.mkdirSync(childDir);
		writeMissionAsyncBinding(childDir, run.binding);
		const childLedger = await f.ledger(childRunId);
		syncMissionFromAsyncCompletion({ asyncDir: childDir, id: childRunId, mode: "single", state: "complete", results: [{ acceptance: childLedger, success: true }] });
		assert.deepEqual(f.read().acceptanceAuthority, pending.acceptanceAuthority);
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		assert.equal(f.read().acceptance, undefined);
		assert.deepEqual(f.read().goal, pending.goal);
		assert.equal(f.read().ownerSessionId, pending.ownerSessionId);
		assert.throws(f.close, /pending|unknown|missing or stale/i);
	} finally { f.cleanup(); }
});

it("keeps actual stale-reconciler status reconstruction unknown even when status retained a computed ledger", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		fs.writeFileSync(path.join(run.asyncDir, "status.json"), JSON.stringify({ runId: run.runId, mode: "single", state: "running", pid: 999999999, sessionId: "synthetic-stale-owner", startedAt: 1, lastUpdate: 1, steps: [{ agent: "synthetic", status: "running", acceptance: await f.ledger(run.runId) }] }));
		const repair = reconcileAsyncRun(run.asyncDir, { resultsDir: path.join(f.root, "results"), now: () => 1000, kill: () => { throw Object.assign(new Error("SYNTHETIC dead test runner"), { code: "ESRCH" }); } });
		assert.equal(repair.repaired, true);
		const payload = JSON.parse(fs.readFileSync(repair.resultPath!, "utf8"));
		assert.equal(payload.results[0].acceptance, undefined, "the real reconciler deliberately reconstructs no acceptance");
		const before = f.read();
		syncMissionFromAsyncCompletion(payload);
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		assert.throws(f.close, /pending|unknown|missing or stale/i);
		assert.deepEqual(f.read().goal, before.goal);
	} finally { f.cleanup(); }
});

it("binds native single async acceptance to its actual outer run ID without a row-level ID", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const ledger = await f.ledger(run.runId);
		run.complete([{ acceptance: ledger, success: true }], run.runId, { mode: "single" });
		assert.equal(f.read().acceptanceAuthority?.producerRunId, run.runId);
		assert.equal(f.read().acceptanceAuthority?.identityDigest, ledger.identity!.digest);
		fs.writeFileSync(path.join(f.projectRoot, "input"), "later declared bytes");
		assert.throws(f.close, /missing or stale/i);
		fs.writeFileSync(path.join(f.projectRoot, "input"), "candidate");
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

it("does not let native single rows or ledgers choose a different producer, or infer terminal authority from success", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const ledger = await f.ledger("unrelated-producer");
		run.complete([{ runId: "unrelated-producer", acceptance: ledger }], run.runId, { mode: "single", state: undefined, success: true });
		assert.equal(f.read().acceptanceAuthority?.completion, "pending", "success without actual terminal state is unknown");
		run.complete([{ runId: "unrelated-producer", acceptance: ledger }], run.runId, { mode: "single" });
		assert.equal(f.read().acceptanceAuthority?.producerRunId, run.runId, "native input.runId is authoritative, not row/ledger run IDs");
		assert.equal(f.read().acceptanceAuthority?.identityDigest, undefined);
		assert.throws(f.close, /missing or stale/i);
	} finally { f.cleanup(); }
});

it("foreground native single preserves positive no-producer completion without inventing a persisted ledger", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		attachMissionToLaunchResult({ binding: run.binding, result: { content: [], details: { mode: "single", runId: run.runId, results: [{ index: 0, agent: "synthetic", task: "known final fixture", exitCode: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, acceptance: await f.noProducer() }] } } });
		assert.equal(f.read().acceptanceAuthority?.completion, "observed");
		assert.equal(f.read().acceptance, undefined);
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

for (const state of ["missing-ledger", "running", "empty"] as const) {
	it(`foreground attachment cannot seal ${state} receipts as known no producer`, async () => {
		const f = await fixture();
		try {
			const run = f.launch(true);
			const rows = state === "empty" ? [] : [{ index: 0, agent: "synthetic", task: "synthetic receipt", exitCode: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, ...(state === "running" ? { state: "running", acceptance: await f.noProducer() } : {}) }];
			attachMissionToLaunchResult({ binding: run.binding, result: { content: [], details: { mode: "single", runId: run.runId, results: rows } } });
			assert.equal(f.read().acceptanceAuthority?.completion, "pending");
			assert.throws(f.close, /pending|unknown|missing or stale/i);
		} finally { f.cleanup(); }
	});
}

it("published-payload recovery cannot turn a running child inventory into terminal no-producer evidence", async () => {
	const f = await fixture();
	let payloadPath: string | undefined;
	try {
		const run = f.launch(true);
		fs.mkdirSync(DIRS.results, { recursive: true });
		payloadPath = resultFilePath(DIRS.results, run.runId);
		fs.writeFileSync(payloadPath, JSON.stringify({ runId: run.runId, asyncDir: run.asyncDir, mode: "workflow", state: "complete", results: [{ runId: "running-child", state: "running", acceptance: await f.noProducer() }] }));
		fs.writeFileSync(path.join(run.asyncDir, "status.json"), JSON.stringify({ state: "complete" }));
		attachMissionToLaunchResult({ binding: run.binding, result: { content: [], details: { mode: "workflow", runId: run.runId, asyncId: run.runId, asyncDir: run.asyncDir, results: [] } } });
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		assert.throws(f.close, /pending|unknown|missing or stale/i);
	} finally { if (payloadPath) fs.rmSync(payloadPath, { force: true }); f.cleanup(); }
});

it("distinguishes a positively complete matching empty workflow inventory from a bare empty result list", async () => {
	const f = await fixture();
	try {
		const run = f.launch(true);
		const inventory = { version: 1, parentToolCallId: "synthetic-tool", workflowRunId: run.runId, inventoryComplete: true, workflowState: "completed", children: [] };
		run.complete([], run.runId, { workflowChildren: { ...inventory, workflowRunId: "unrelated" } });
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		run.complete([], run.runId, { workflowChildren: { ...inventory, inventoryComplete: false } });
		assert.equal(f.read().acceptanceAuthority?.completion, "pending");
		run.complete([], run.runId, { workflowChildren: inventory });
		assert.equal(f.read().acceptanceAuthority?.completion, "observed");
		assert.equal(f.read().acceptance, undefined);
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

for (const phase of ["before receipt binding", "running", "terminal status without results", "malformed terminal rows", "nonterminal payload with results"] as const) {
	it(`fails closed for an admitted goal ${phase}`, async () => {
		const f = await fixture();
		try {
			if (phase !== "before receipt binding") {
				const run = f.launch(true);
				if (phase === "terminal status without results") syncMissionFromAsyncCompletion({ asyncDir: run.asyncDir, runId: run.runId, state: "complete", success: true });
				if (phase === "malformed terminal rows") syncMissionFromAsyncCompletion({ asyncDir: run.asyncDir, runId: run.runId, state: "complete", results: [null] });
				if (phase === "nonterminal payload with results") syncMissionFromAsyncCompletion({ asyncDir: run.asyncDir, runId: run.runId, state: "running", results: [{ runId: "producer", acceptance: await f.ledger("producer") }] });
			}
			const before = f.read();
			const bytes = fs.readFileSync(missionRecordPath(f.binding.location, f.binding.missionId), "utf8");
			assert.throws(f.close, /acceptance.*(pending|unknown|missing or stale)/i);
			const ctx = { cwd: f.projectRoot, currentSessionId: "owner", config: { directory: path.join(f.root, "missions"), globalIndex: false } };
			assert.throws(() => handleMissionAction("mission.close", { missionId: f.binding.missionId }, ctx), /acceptance/i);
			assert.throws(() => handleMissionAction("mission.update", { missionId: f.binding.missionId, missionUpdate: { status: "completed" } }, ctx), /acceptance/i);
			assert.equal(fs.readFileSync(missionRecordPath(f.binding.location, f.binding.missionId), "utf8"), bytes);
			assert.deepEqual(f.read().goal, before.goal);
		} finally { f.cleanup(); }
	});
}

it("retains truly unlaunched/manual closure and resolves known current no-producer completion without claiming verification", async () => {
	const f = await fixture();
	try {
		const manual = createMission(f.binding.location, { title: "Manual synthetic goal", objective: "Parent-controlled", goal: true, ownerSessionId: "owner", status: "active" });
		assert.equal(updateMission(f.binding.location, manual.id, { status: "completed", expectedGoalOwnerSessionId: "owner" }).status, "completed");
		const run = f.launch(true);
		assert.throws(f.close, /acceptance/i);
		const none = await f.noProducer();
		run.complete([{ runId: "read-only-child", acceptance: none }]);
		assert.equal(f.read().acceptance, undefined);
		const authority = f.read().acceptanceAuthority;
		run.complete([{ runId: "read-only-child", acceptance: none }]);
		assert.deepEqual(f.read().acceptanceAuthority, authority, "known no-producer replay is idempotent");
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

it("does not demote current explicit authority on implicit or empty late replay, nor resurrect historic authority after a no-producer continuation", async () => {
	const f = await fixture();
	try {
		const first = f.launch(true);
		const ledger = await f.ledger("producer");
		first.complete([{ runId: "producer", acceptance: ledger }]);
		const accepted = f.read();
		first.complete([{ runId: "producer", acceptance: { ...ledger, explicit: false } }]);
		first.complete([]);
		assert.deepEqual(f.read().acceptance, accepted.acceptance);
		assert.deepEqual(f.read().acceptanceAuthority, accepted.acceptanceAuthority);
		const current = f.launch();
		const pending = f.read().acceptanceAuthority;
		first.complete([{ runId: "producer", acceptance: { ...ledger, explicit: false } }]);
		assert.deepEqual(f.read().acceptanceAuthority, pending);
		assert.throws(f.close, /missing or stale|pending|unknown/i);
		current.complete([{ runId: "read-only-child", acceptance: await f.noProducer() }]);
		assert.deepEqual(f.read().acceptance, accepted.acceptance, "historic runtime evidence retained, not reauthorized");
		assert.throws(f.close, /missing or stale/i);
	} finally { f.cleanup(); }
});

it("does not replace an observed rejection with a contradictory same-launch PASS; a new matching correction is required", async () => {
	const f = await fixture();
	try {
		const rejectedRun = f.launch(true);
		const rejected = await f.ledger("rejected-producer", 7);
		assert.equal(rejected.status, "rejected");
		rejectedRun.complete([{ runId: "rejected-producer", acceptance: rejected }]);
		const recorded = f.read();
		const pass = await f.ledger("late-producer");
		rejectedRun.complete([{ runId: "late-producer", acceptance: pass }]);
		assert.deepEqual(f.read().acceptance, rejected);
		assert.deepEqual(f.read().acceptanceAuthority, recorded.acceptanceAuthority);
		assert.throws(f.close, /recorded acceptance is rejected/);
		const correctedRun = f.launch();
		const corrected = await f.ledger("corrected-producer");
		correctedRun.complete([{ runId: "corrected-producer", acceptance: corrected }]);
		assert.equal(f.close().status, "completed");
		assert.deepEqual(f.read().goal, recorded.goal);
	} finally { f.cleanup(); }
});

it("only the current matching launch and sole actual producer can authorize closure; late evidence cannot replace it", async () => {
	const f = await fixture();
	try {
		const first = f.launch(true);
		const old = await f.ledger("old-producer");
		first.complete([{ runId: "old-producer", acceptance: old }]);
		const before = f.read();
		const second = f.launch();
		assert.deepEqual(f.read().acceptance, old, "historic ledger remains available");
		const bytes = fs.readFileSync(missionRecordPath(f.binding.location, f.binding.missionId), "utf8");
		assert.throws(f.close, /missing or stale/);
		assert.equal(fs.readFileSync(missionRecordPath(f.binding.location, f.binding.missionId), "utf8"), bytes);
		first.complete([{ runId: "old-producer", acceptance: old }]);
		assert.equal(f.read().acceptanceAuthority?.runId, second.runId);
		assert.throws(f.close, /missing or stale/);
		const current = await f.ledger("current-producer");
		second.complete([{ runId: "current-producer", acceptance: current }], "unrelated-workflow");
		assert.deepEqual(f.read().acceptance, old);
		assert.throws(f.close, /missing or stale/);
		second.complete([{ runId: "current-producer", acceptance: current }]);
		const accepted = f.read();
		assert.equal(accepted.acceptanceAuthority?.producerRunId, "current-producer");
		assert.equal(accepted.acceptanceAuthority?.identityDigest, current.identity!.digest);
		updateMission(f.binding.location, f.binding.missionId, { acceptanceLaunch: { launchId: accepted.acceptanceAuthority!.launchId, runId: second.runId } });
		assert.deepEqual(f.read().acceptanceAuthority, accepted.acceptanceAuthority, "same launch receipt replay does not invalidate current acceptance");
		first.complete([{ runId: "old-producer", acceptance: old }]);
		assert.deepEqual(f.read().acceptance, current);
		assert.deepEqual(f.read().goal, before.goal);
		assert.equal(f.close().status, "completed");
	} finally { f.cleanup(); }
});

for (const kind of ["missing identity", "wrong producer", "multiple producers", "extra child", "changed candidate", "changed criteria", "changed command"] as const) {
	it(`cannot close with ${kind}`, async () => {
		const f = await fixture();
		try {
			const run = f.launch(true);
			const ledger = await f.ledger("producer");
			const results: Array<{ runId?: string; acceptance?: AcceptanceLedger }> = [{ runId: "producer", acceptance: ledger }];
			if (kind === "missing identity") delete ledger.identity;
			if (kind === "wrong producer") results[0]!.runId = "unrelated-producer";
			if (kind === "multiple producers") results.push({ runId: "other", acceptance: ledger });
			if (kind === "extra child") results.push({});
			if (kind === "changed candidate") fs.writeFileSync(path.join(f.projectRoot, "input"), "different untracked bytes");
			if (kind === "changed criteria") ledger.effectiveAcceptance.criteria.push({ id: "changed", must: "new criterion", evidence: [], severity: "required" });
			if (kind === "changed command") ledger.effectiveAcceptance.verify[0]!.command += " changed";
			run.complete(results);
			assert.throws(f.close, /missing or stale/);
			assert.equal(f.read().status, "active");
		} finally { f.cleanup(); }
	});
}

it("does not treat a historic runtime ledger without launch authority as manual verified closure", async () => {
	const f = await fixture();
	try {
		const ledger = await f.ledger("historic-producer");
		updateMission(f.binding.location, f.binding.missionId, { acceptance: ledger });
		assert.throws(f.close, /missing or stale/);
		const withoutIdentity = structuredClone(ledger); delete withoutIdentity.identity;
		updateMission(f.binding.location, f.binding.missionId, { acceptance: withoutIdentity });
		assert.throws(f.close, /missing or stale/);
	} finally { f.cleanup(); }
});

it("a previously bound PASS becomes stale at closure and a new correction restores authority without resetting goal history", async () => {
	const f = await fixture();
	try {
		const first = f.launch(true);
		const ledger = await f.ledger("producer-1");
		first.complete([{ runId: "producer-1", acceptance: ledger }]);
		const initial = f.read();
		fs.writeFileSync(path.join(f.projectRoot, "input"), "corrected bytes after the first check");
		assert.throws(f.close, /missing or stale/);
		const corrected = f.launch();
		const next = await f.ledger("producer-2");
		corrected.complete([{ runId: "producer-2", acceptance: next }]);
		const closed = f.close();
		assert.equal(closed.status, "completed");
		assert.equal(closed.ownerSessionId, initial.ownerSessionId);
		assert.deepEqual(closed.goal, initial.goal);
		assert.ok(closed.runs.some((run) => run.runId === first.runId));
	} finally { f.cleanup(); }
});
