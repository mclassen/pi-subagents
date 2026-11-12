import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { prepareMissionLaunch, syncMissionFromAsyncCompletion, writeMissionAsyncBinding } from "../../src/missions/lifecycle.ts";
import { readMission, updateMission } from "../../src/missions/store.ts";
import type { AcceptanceLedger } from "../../src/shared/types.ts";

// SYNTHETIC unit boundary: supplied completion payloads test selection only.
// The registered integration regression separately proves real runner delivery.
function ledger(status: "rejected" | "verified"): AcceptanceLedger {
	return {
		status, evidenceStatus: status, explicit: true,
		effectiveAcceptance: { level: "verified", explicit: true, inferredReason: [], criteria: [], evidence: [], verify: [], stopRules: [] },
		inferredReason: [], criteria: [], runtimeChecks: [],
		verifyRuns: [{ id: "synthetic-gate", command: "synthetic-command-not-executed-in-unit-test", cwd: "synthetic-cwd", durationMs: 1, exitCode: status === "verified" ? 0 : 7, status: status === "verified" ? "passed" : "failed" }],
	};
}

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-async-selection-"));
	const projectRoot = path.join(root, "project");
	let asyncDir = path.join(root, "run");
	let runId = "synthetic-workflow";
	let runCount = 1;
	fs.mkdirSync(projectRoot);
	fs.mkdirSync(asyncDir);
	const binding = prepareMissionLaunch({
		params: { mission: { title: "Synthetic selection fixture", goal: true, maxIterations: 4 } },
		projectRoot, config: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") }, ownerSessionId: "synthetic-owner",
	});
	assert.ok(binding);
	updateMission(binding.location, binding.missionId, { acceptanceLaunch: { launchId: binding.acceptanceLaunchId!, runId: "synthetic-workflow" } });
	writeMissionAsyncBinding(asyncDir, binding);
	const complete = (results: unknown, success = true) => syncMissionFromAsyncCompletion({
		runId, asyncDir, mode: "workflow", state: success ? "complete" : "failed", success, results,
	});
	const admit = () => {
		// A distinct terminal outcome needs a new launch, not a contradictory
		// replacement of a previously observed no-producer/ambiguous payload.
		const next = prepareMissionLaunch({ params: { missionId: binding.missionId }, projectRoot, config: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") }, ownerSessionId: "synthetic-owner" })!;
		runId = `synthetic-workflow-${++runCount}`;
		asyncDir = path.join(root, `run-${runCount}`); fs.mkdirSync(asyncDir);
		updateMission(binding.location, binding.missionId, { acceptanceLaunch: { launchId: next.acceptanceLaunchId!, runId } });
		writeMissionAsyncBinding(asyncDir, next);
	};
	return { root, binding, complete, admit };
}

for (const success of [true, false]) {
	it(`persists the exact sole explicit runtime ledger independently of workflow success=${success}`, () => {
		const f = fixture();
		try {
			const before = readMission(f.binding.location, f.binding.missionId);
			const acceptance = ledger(success ? "rejected" : "verified");
			const completed = f.complete([{ runId: "synthetic-producer", acceptance }], success)!;
			assert.deepEqual(completed.acceptance, acceptance);
			assert.deepEqual(readMission(f.binding.location, f.binding.missionId).acceptance, acceptance);
			assert.equal(completed.status, "active");
			assert.equal(completed.ownerSessionId, before.ownerSessionId);
			assert.deepEqual(completed.goal, before.goal);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
}

const verified = ledger("verified");
for (const [name, results] of [
	["missing results", undefined],
	["empty results", []],
	["missing ledger", [{}]],
	["child PASS claim without runtime ledger", [{ output: '```acceptance-report\n{"status":"passed"}\n```' }]],
	["implicit ledger", [{ acceptance: { ...verified, explicit: false } }]],
	["ledger without explicit flag", [{ acceptance: { status: "verified" } }]],
	["null child", [null]],
	["array child", [[]]],
	["null ledger", [{ acceptance: null }]],
	["array ledger", [{ acceptance: [] }]],
	["two explicit producers", [{ acceptance: verified }, { acceptance: verified }]],
	["one explicit producer plus another child", [{ acceptance: verified }, {}]],
] as const) {
	it(`does not replace recorded rejection for ${name}`, () => {
		const f = fixture();
		try {
			assert.equal(f.complete(results)!.acceptance, undefined, "missing or ambiguous producer does not create acceptance");
			f.admit();
			const rejection = ledger("rejected");
			f.complete([{ runId: "synthetic-producer", acceptance: rejection }], false);
			const completed = f.complete(results)!;
			assert.deepEqual(completed.acceptance, rejection);
			assert.deepEqual(readMission(f.binding.location, f.binding.missionId).acceptance, rejection);
			assert.equal(completed.status, "active");
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
}

for (const status of ["waiting", "cancelled"] as const) {
	it(`preserves ${status} goal restrictions and counters when acceptance arrives`, () => {
		const f = fixture();
		try {
			updateMission(f.binding.location, f.binding.missionId, status === "waiting"
				? { goal: { status: "paused" } }
				: { status });
			const before = readMission(f.binding.location, f.binding.missionId);
			const completed = f.complete([{ runId: "synthetic-producer", acceptance: verified }])!;
			assert.deepEqual(completed.acceptance, verified);
			assert.equal(completed.status, before.status);
			assert.equal(completed.ownerSessionId, before.ownerSessionId);
			assert.deepEqual(completed.goal, before.goal);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
}
