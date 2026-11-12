import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { cancelCurrentGoal } from "../../src/missions/goal-cancel.ts";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { cancelGoalMission, createMission, listMissions, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-goal-cancel-"));
	const location = resolveMissionStoreLocation({ projectRoot: root, agentDir: path.join(root, "agent") });
	return { root, location };
}

describe("/goal cancel", () => {
	it("cancels an exact owned goal without adoption, counter reset, evidence loss or retention", () => {
		const test = fixture();
		try {
			const goal = createMission(test.location, { title: "Foreign", objective: "Work", goal: true, ownerSessionId: "other", maxIterations: 14 });
			updateMission(test.location, goal.id, { goal: { iteration: "begin" } });
			const before = updateMission(test.location, goal.id, {
				summary: "Previous evidence\nKeep this checkpoint.",
				addRuns: [{ runId: "running-job", mode: "single", status: "running" }],
				addArtifacts: [{ kind: "note", path: "evidence.md" }], acceptance: { status: "rejected", evidence: "keep" },
			});
			const ordinary = createMission(test.location, { title: "Terminal", objective: "Keep", status: "completed" });
			const ordinaryPath = missionRecordPath(test.location, ordinary.id);
			const ordinaryBytes = fs.readFileSync(ordinaryPath, "utf8");
			const result = cancelGoalMission({ ...test.location, retainTerminal: 0 }, goal.id, "other");
			assert.equal(result.status, "cancelled");
			assert.deepEqual(result, { ...before, status: "cancelled", updatedAt: result.updatedAt, summary: `${before.summary}\nGoal cancelled by operator /goal cancel. Running jobs are NOT stopped.` });
			assert.equal(fs.readFileSync(ordinaryPath, "utf8"), ordinaryBytes);
			const cancelledBytes = fs.readFileSync(missionRecordPath(test.location, goal.id), "utf8");
			assert.deepEqual(cancelGoalMission(test.location, goal.id, "other"), result);
			assert.equal(fs.readFileSync(missionRecordPath(test.location, goal.id), "utf8"), cancelledBytes);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("rejects invalid, missing, ordinary, terminal and other-project records without changing bytes", () => {
		const test = fixture();
		try {
			for (const id of ["../escape", "", "missing", "prefix*"]) assert.throws(() => cancelGoalMission(test.location, id, "other"));
			for (const status of ["planned", "completed", "failed"] as const) {
				const record = createMission(test.location, { title: status, objective: "Keep", goal: status !== "planned", status, ownerSessionId: "other" });
				const file = missionRecordPath(test.location, record.id);
				const bytes = fs.readFileSync(file, "utf8");
				assert.throws(() => cancelGoalMission(test.location, record.id, "other"), /not a goal|already/);
				assert.equal(fs.readFileSync(file, "utf8"), bytes);
			}
			const foreignProject = createMission(test.location, { title: "Project boundary", objective: "Keep", goal: true });
			const file = missionRecordPath(test.location, foreignProject.id);
			const bytes = fs.readFileSync(file, "utf8");
			assert.throws(() => cancelGoalMission({ ...test.location, projectRoot: path.join(test.root, "elsewhere") }, foreignProject.id, "other"), /another project/);
			assert.equal(fs.readFileSync(file, "utf8"), bytes);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("leaves ordinary mission.close foreign-owner rejection unchanged", () => {
		const test = fixture();
		try {
			const goal = createMission(test.location, { title: "Foreign", objective: "Keep", goal: true, ownerSessionId: "other" });
			const bytes = fs.readFileSync(missionRecordPath(test.location, goal.id), "utf8");
			assert.throws(() => handleMissionAction("mission.close", { missionId: goal.id, missionStatus: "cancelled" }, { cwd: test.root, agentDir: path.join(test.root, "agent"), currentSessionId: "operator-session" }), /owning session|another session/);
			assert.equal(fs.readFileSync(missionRecordPath(test.location, goal.id), "utf8"), bytes);
			assert.equal(readMission(test.location, goal.id).status, "planned");
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("preserves no-ID summary, counters and artifacts and checks expected owner under lock", () => {
		const test = fixture();
		try {
			const own = createMission(test.location, { title: "Own", objective: "Work", goal: true, ownerSessionId: "owner" });
			const before = updateMission(test.location, own.id, { summary: "Evidence checkpoint", goal: { iteration: "begin" }, addArtifacts: [{ kind: "note", path: "keep.md" }] });
			const file = missionRecordPath(test.location, own.id);
			const bytes = fs.readFileSync(file, "utf8");
			for (const owner of ["foreign", "", undefined, null]) {
				assert.throws(() => cancelGoalMission(test.location, own.id, owner), /owning session/);
				assert.equal(fs.readFileSync(file, "utf8"), bytes);
			}
			const result = cancelCurrentGoal(test.location, "owner");
			assert.equal(result.cancelled, true);
			const saved = readMission(test.location, own.id);
			assert.equal(saved.ownerSessionId, before.ownerSessionId);
			assert.deepEqual(saved.goal, before.goal);
			assert.deepEqual(saved.artifacts, before.artifacts);
			assert.match(saved.summary!, /^Evidence checkpoint\nGoal cancelled by operator/);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("cancels only the current session's open goal and preserves other records", () => {
		const test = fixture();
		try {
			const own = createMission(test.location, { title: "Own goal", objective: "Work", goal: true, ownerSessionId: "owner" });
			const foreign = createMission(test.location, { title: "Foreign goal", objective: "Other", goal: true, ownerSessionId: "other" });
			const ordinary = createMission(test.location, { title: "Ordinary", objective: "Keep" });
			const result = cancelCurrentGoal(test.location, "owner");
			assert.equal(result.cancelled, true);
			const records = listMissions(test.location).records;
			assert.equal(records.find((item) => item.id === own.id)?.status, "cancelled");
			assert.equal(records.find((item) => item.id === foreign.id)?.status, "planned");
			assert.equal(records.find((item) => item.id === ordinary.id)?.status, "planned");
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("fails closed for missing or ambiguous ownership and is idempotent after cancellation", () => {
		const test = fixture();
		try {
			assert.deepEqual(cancelCurrentGoal(test.location, null), { cancelled: false, reason: "no-session" });
			assert.deepEqual(cancelCurrentGoal(test.location, "owner"), { cancelled: false, reason: "none" });
			createMission(test.location, { title: "First", objective: "One", goal: true, ownerSessionId: "owner" });
			createMission(test.location, { title: "Second", objective: "Two", goal: true, ownerSessionId: "owner" });
			assert.deepEqual(cancelCurrentGoal(test.location, "owner"), { cancelled: false, reason: "ambiguous" });
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});
});
