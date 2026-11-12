import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createMission, listGlobalMissions, listMissions, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";
import { missionStatePath } from "../../src/missions/workflow-state.ts";
import { withFileLock } from "../../src/shared/file-lock.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-retention-"));
	roots.push(root);
	const projectRoot = path.join(root, "project");
	fs.mkdirSync(projectRoot, { recursive: true });
	return { root, location: resolveMissionStoreLocation({ projectRoot, agentDir: path.join(root, "agent") }) };
}

function create(location: ReturnType<typeof setup>["location"]) {
	return createMission(location, { title: "Retention test", objective: "Protect concurrently updated missions", status: "active" });
}

describe("mission retention concurrency", () => {
	it("revalidates an enumerated terminal record under its writer lock before deletion", () => {
		const { location } = setup();
		const reopening = create(location);
		const newest = create(location);
		updateMission(location, reopening.id, { status: "completed" }, new Date("2026-01-01T00:00:00Z"), 100);
		updateMission(location, newest.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 100);

		const originalRead = fs.readFileSync;
		const targetPath = path.resolve(location.missionDir, `${reopening.id}.json`);
		let interleaved = false;
		fsDefault.readFileSync = function (filePath: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) {
			const value = (originalRead as (...values: unknown[]) => unknown)(filePath, ...args);
			if (!interleaved && typeof filePath === "string" && path.resolve(filePath) === targetPath) {
				interleaved = true;
				updateMission(location, reopening.id, { status: "active" }, new Date("2026-01-03T00:00:00Z"), 100);
			}
			return value as ReturnType<typeof fs.readFileSync>;
		};
		syncBuiltinESMExports();
		try {
			updateMission(location, newest.id, { summary: "Trigger pruning" }, new Date("2026-01-04T00:00:00Z"), 1);
		} finally {
			fsDefault.readFileSync = originalRead;
			syncBuiltinESMExports();
		}

		assert.equal(interleaved, true, "the reopen occurred after the prune enumeration read");
		assert.equal(readMission(location, reopening.id).status, "active");
		assert.equal(listMissions(location).records.some((record) => record.id === reopening.id), true);
	});

	it("preserves a terminal update made at the same timestamp as its enumeration snapshot", () => {
		const { location } = setup();
		const candidate = create(location);
		const trigger = create(location);
		const timestamp = new Date("2026-01-01T00:00:00Z");
		updateMission(location, candidate.id, { status: "completed", summary: "Original" }, timestamp, 100);
		updateMission(location, trigger.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 100);
		const originalRead = fsDefault.readFileSync;
		const targetPath = path.join(location.missionDir, `${candidate.id}.json`);
		let interleaved = false;
		fsDefault.readFileSync = function (filePath: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) {
			const value = (originalRead as (...values: unknown[]) => unknown)(filePath, ...args);
			if (!interleaved && filePath === targetPath) {
				interleaved = true;
				updateMission(location, candidate.id, { summary: "Concurrent terminal checkpoint" }, timestamp, 100);
			}
			return value as ReturnType<typeof fs.readFileSync>;
		};
		syncBuiltinESMExports();
		try {
			updateMission(location, trigger.id, { summary: "Trigger pruning" }, new Date("2026-01-03T00:00:00Z"), 1);
		} finally {
			fsDefault.readFileSync = originalRead;
			syncBuiltinESMExports();
		}
		assert.equal(interleaved, true);
		assert.equal(readMission(location, candidate.id).summary, "Concurrent terminal checkpoint");
	});

	it("prunes an unchanged ordinary record and its pointer without deleting separately locked state", () => {
		const { location } = setup();
		const oldest = create(location);
		updateMission(location, oldest.id, { status: "completed" }, new Date("2026-01-01T00:00:00Z"), 100);
		const statePath = missionStatePath(location, oldest.id);
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		fs.writeFileSync(statePath, JSON.stringify({ retained: true }));
		const newest = create(location);
		updateMission(location, newest.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 1);
		assert.equal(fs.existsSync(path.join(location.missionDir, `${oldest.id}.json`)), false);
		assert.equal(fs.readFileSync(statePath, "utf8"), JSON.stringify({ retained: true }));
		assert.deepEqual(listGlobalMissions(location.globalIndexDir).entries.map((entry) => entry.missionId), [newest.id]);
	});

	it("does not prune an owned goal and preserves its separately locked workflow state", () => {
		const { location } = setup();
		const goal = createMission(location, { title: "Owned goal", objective: "Preserve owner lifecycle", goal: true, ownerSessionId: "saved-goal-owner" });
		updateMission(location, goal.id, { status: "completed", expectedGoalOwnerSessionId: "saved-goal-owner" }, new Date("2026-01-01T00:00:00Z"), 100);
		const statePath = missionStatePath(location, goal.id);
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		fs.writeFileSync(statePath, JSON.stringify({ retained: true }));
		const ordinary = create(location);
		updateMission(location, ordinary.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 1);
		assert.equal(readMission(location, goal.id).status, "completed");
		assert.equal(fs.existsSync(statePath), true);
	});

	it("skips a locked candidate and prunes it on a later uncontended update", () => {
		const { location } = setup();
		const oldest = create(location);
		const newest = create(location);
		updateMission(location, oldest.id, { status: "completed" }, new Date("2026-01-01T00:00:00Z"), 100);
		updateMission(location, newest.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 100);
		const candidatePath = path.join(location.missionDir, `${oldest.id}.json`);
		withFileLock(candidatePath, () => {
			const updated = updateMission(location, newest.id, { summary: "Committed while candidate is locked" }, new Date("2026-01-03T00:00:00Z"), 1);
			assert.equal(updated.summary, "Committed while candidate is locked");
			assert.equal(readMission(location, oldest.id).status, "completed");
		});
		updateMission(location, newest.id, { summary: "Retry retention after release" }, new Date("2026-01-04T00:00:00Z"), 1);
		assert.equal(fs.existsSync(candidatePath), false);
	});

	it("keeps the primary update successful when best-effort pruning cannot remove a candidate", () => {
		const { location } = setup();
		const oldest = create(location);
		const newest = create(location);
		updateMission(location, oldest.id, { status: "completed" }, new Date("2026-01-01T00:00:00Z"), 100);
		updateMission(location, newest.id, { status: "completed" }, new Date("2026-01-02T00:00:00Z"), 100);
		const originalRemove = fsDefault.rmSync;
		fsDefault.rmSync = function (target: Parameters<typeof fs.rmSync>[0], ...args: unknown[]) {
			if (String(target) === path.join(location.missionDir, `${oldest.id}.json`)) throw new Error("simulated retention removal failure");
			return (originalRemove as (...values: unknown[]) => unknown)(target, ...args) as ReturnType<typeof fs.rmSync>;
		};
		syncBuiltinESMExports();
		try {
			const updated = updateMission(location, newest.id, { summary: "Committed despite retention contention" }, new Date("2026-01-03T00:00:00Z"), 1);
			assert.equal(updated.summary, "Committed despite retention contention");
			assert.equal(readMission(location, newest.id).summary, updated.summary);
		} finally {
			fsDefault.rmSync = originalRemove;
			syncBuiltinESMExports();
		}
	});
});
