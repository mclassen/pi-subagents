import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { prepareMissionLaunch } from "../../src/missions/lifecycle.ts";
import { createMission, missionRecordPath, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";

it("rejects a stale ordinary-show refresh when another session enables the mission as a goal", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-refresh-race-"));
	try {
		const projectRoot = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(projectRoot);
		const location = resolveMissionStoreLocation({ projectRoot, agentDir });
		const ordinaryRefresh = createMission(location, { title: "Ordinary refresh", objective: "Ordinary show remains live" });
		const ordinaryRunDir = path.join(root, "ordinary-run");
		fs.mkdirSync(ordinaryRunDir);
		fs.writeFileSync(path.join(ordinaryRunDir, "status.json"), JSON.stringify({ state: "complete" }));
		updateMission(location, ordinaryRefresh.id, { addRuns: [{ runId: "ordinary-linked", mode: "single", status: "running", asyncDir: ordinaryRunDir }] });
		const ordinaryShow = handleMissionAction("mission.show", { missionId: ordinaryRefresh.id }, { cwd: projectRoot, agentDir, currentSessionId: "session-B" });
		assert.equal(ordinaryShow.details?.mission?.runs[0]?.status, "complete", "ordinary mission show still refreshes");

		const record = createMission(location, { title: "Ordinary", objective: "Read before concurrent enable" });
		const runDir = path.join(root, "run");
		fs.mkdirSync(runDir);
		fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify({ state: "complete" }));
		updateMission(location, record.id, { addRuns: [{ runId: "linked", mode: "single", status: "running", asyncDir: runDir }] });
		const recordPath = missionRecordPath(location, record.id);
		let enabledBytes: string | undefined;
		assert.throws(() => handleMissionAction("mission.show", { missionId: record.id }, {
			cwd: projectRoot,
			agentDir,
			currentSessionId: "session-B",
			beforeMissionShowRefresh: () => {
				handleMissionAction("mission.update", { missionId: record.id, missionUpdate: { goal: true } }, { cwd: projectRoot, agentDir, currentSessionId: "session-A" });
				enabledBytes = fs.readFileSync(recordPath, "utf8");
			},
		}), /owning session|another session/i);
		assert.equal(enabledBytes !== undefined, true, "A's goal enable occurs after B read the ordinary mission and before B's refresh write");
		assert.equal(fs.readFileSync(recordPath, "utf8"), enabledBytes, "B's rejected stale refresh leaves A's exact goal bytes unchanged");
		const freshOwnerShow = handleMissionAction("mission.show", { missionId: record.id }, { cwd: projectRoot, agentDir, currentSessionId: "session-A" });
		assert.equal(freshOwnerShow.details?.mission?.runs[0]?.status, "complete", "same-owner show still refreshes");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

it("isolates goal operations by saved session and preserves foreign records", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-session-owner-"));
	try {
		const projectRoot = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(projectRoot);
		const location = resolveMissionStoreLocation({ projectRoot, agentDir });
		const config = { directory: location.missionDir, globalIndexDir: location.globalIndexDir };
		const ctxA = { cwd: projectRoot, agentDir, currentSessionId: "saved-session-A" };
		const ctxB = { cwd: projectRoot, agentDir, currentSessionId: "saved-session-B" };
		const recordBytes = (id: string) => fs.readFileSync(missionRecordPath(location, id), "utf8");
		const assertRejectedWithoutWrite = (id: string, action: () => unknown, pattern = /owning session|another session/i) => {
			const before = recordBytes(id);
			assert.throws(action, pattern);
			assert.equal(recordBytes(id), before, "rejected operation must not change persisted bytes");
		};

		assert.throws(() => handleMissionAction("mission.create", { mission: { title: "No session", goal: true } }, { cwd: projectRoot, agentDir }), /current session/i);
		const ordinary = createMission(location, { title: "Ordinary", objective: "Existing ordinary mission", ownerSessionId: "preexisting-owner" });
		assertRejectedWithoutWrite(ordinary.id, () => handleMissionAction("mission.update", { missionId: ordinary.id, missionUpdate: { goal: true } }, { cwd: projectRoot, agentDir }), /current owning session/i);

		const enabled = handleMissionAction("mission.update", { missionId: ordinary.id, missionUpdate: { goal: true } }, ctxA).details?.mission;
		assert.equal(enabled?.ownerSessionId, ctxA.currentSessionId, "enabling a goal binds the current session");

		const created = handleMissionAction("mission.create", {
			mission: { title: "Owned goal", objective: "Session scoped", goal: true },
		}, ctxA).details?.mission;
		assert.ok(created);
		const runDir = path.join(root, "run");
		fs.mkdirSync(runDir);
		const statusPath = path.join(runDir, "status.json");
		fs.writeFileSync(statusPath, JSON.stringify({ state: "complete" }));
		// A running linked-run record should be refreshed only by its owner.
		const recordPath = missionRecordPath(location, created.id);
		const persisted = JSON.parse(recordBytes(created.id));
		persisted.runs.push({ runId: "linked", mode: "single", status: "running", asyncDir: runDir });
		fs.writeFileSync(recordPath, JSON.stringify(persisted));
		const beforeForeignRead = recordBytes(created.id);
		const listing = handleMissionAction("mission.list", {}, ctxB).details?.missions as { records: unknown[] };
		assert.equal(listing.records.length, 0);
		const globalListing = handleMissionAction("mission.list", { missionScope: "global" }, ctxB).details?.missions as { globalEntries: unknown[] };
		assert.ok(globalListing.globalEntries.length >= 1, "global index remains available as explicit discovery");
		const shown = handleMissionAction("mission.show", { missionId: created.id }, ctxB);
		assert.match(shown.content.map((part) => part.type === "text" ? part.text : "").join("\n"), /read-only/);
		assert.equal(recordBytes(created.id), beforeForeignRead, "foreign show leaves goal bytes unchanged despite terminal status file");
		const ownerShow = handleMissionAction("mission.show", { missionId: created.id }, ctxA);
		assert.equal(ownerShow.details?.mission?.runs[0]?.status, "complete", "owner show refreshes linked-run status");
		handleMissionAction("mission.update", { missionId: created.id, missionUpdate: { goal: { iteration: "begin" } } }, ctxA);

		for (const actionAndParams of [
			["mission.update", { missionId: created.id, missionUpdate: { title: "Tampered" } }],
			["mission.update", { missionId: created.id, missionUpdate: { receipts: [{ kind: "ci", status: "ready", title: "Foreign", url: "https://example.test/ci" }] } }],
			["mission.update", { missionId: created.id, missionUpdate: { goal: false } }],
			["mission.close", { missionId: created.id }],
			["mission.attach-run", { missionId: created.id, runId: "foreign-run" }],
			["mission.resolve-decision", { missionId: created.id, id: "missing", summary: "resolve" }],
		] as const) {
			assertRejectedWithoutWrite(created.id, () => handleMissionAction(actionAndParams[0], actionAndParams[1], ctxB));
		}
		assertRejectedWithoutWrite(created.id, () => handleMissionAction("mission.update", { missionId: created.id, missionUpdate: { summary: "No session" } }, { cwd: projectRoot, agentDir }));
		assertRejectedWithoutWrite(created.id, () => prepareMissionLaunch({ params: { missionId: created.id }, projectRoot, config }), /current owning session/i);
		assertRejectedWithoutWrite(created.id, () => prepareMissionLaunch({ params: { missionId: created.id }, projectRoot, config, ownerSessionId: ctxB.currentSessionId }));
		const sameSessionRestart = prepareMissionLaunch({ params: { missionId: created.id }, projectRoot, config, ownerSessionId: ctxA.currentSessionId });
		assert.equal(sameSessionRestart?.missionId, created.id);

		const legacyGoal = createMission(location, { title: "Legacy unowned", objective: "No silent adoption", goal: true });
		assert.equal(legacyGoal.ownerSessionId, undefined);
		assertRejectedWithoutWrite(legacyGoal.id, () => handleMissionAction("mission.update", { missionId: legacyGoal.id, missionUpdate: { summary: "adopt" } }, ctxA));
		assertRejectedWithoutWrite(legacyGoal.id, () => prepareMissionLaunch({ params: { missionId: legacyGoal.id }, projectRoot, config, ownerSessionId: ctxA.currentSessionId }));

		const unrelatedOrdinary = createMission(location, { title: "Unrelated", objective: "Visible to all sessions" });
		assert.ok((handleMissionAction("mission.list", {}, ctxB).details?.missions as { records: Array<{ id: string }> }).records.some((record) => record.id === unrelatedOrdinary.id));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

it("starts a fresh session goal independently beside an unchanged paused foreign goal", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-independent-goals-"));
	try {
		const projectRoot = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(projectRoot);
		const location = resolveMissionStoreLocation({ projectRoot, agentDir });
		const a = { cwd: projectRoot, agentDir, currentSessionId: "session-A" };
		const b = { cwd: projectRoot, agentDir, currentSessionId: "session-B" };
		const foreign = handleMissionAction("mission.create", { mission: { title: "Historical", goal: true, maxIterations: 20 } }, a).details?.mission;
		assert.ok(foreign);
		for (let i = 0; i < 9; i++) {
			handleMissionAction("mission.update", { missionId: foreign.id, missionUpdate: { goal: { iteration: "begin" } } }, a);
			handleMissionAction("mission.update", { missionId: foreign.id, missionUpdate: { goal: { iteration: "complete" } } }, a);
		}
		const paused = handleMissionAction("mission.update", { missionId: foreign.id, missionUpdate: { goal: { paused: true } } }, a).details?.mission;
		assert.equal(paused?.goal?.iterationsStarted, 9);
		assert.equal(paused?.goal?.maxIterations, 20);
		assert.equal(paused?.goal?.status, "paused");
		const foreignPath = missionRecordPath(location, foreign.id);
		const before = fs.readFileSync(foreignPath);
		const fresh = handleMissionAction("mission.create", { mission: { title: "Fresh", goal: true } }, b).details?.mission;
		assert.ok(fresh);
		assert.equal(fresh.goal?.iterationsStarted, 0);
		assert.equal(fresh.goal?.maxIterations, 8);
		const listing = handleMissionAction("mission.list", {}, b).details?.missions as { records: Array<{ id: string }> };
		assert.ok(listing.records.some((record) => record.id === fresh.id));
		assert.ok(!listing.records.some((record) => record.id === foreign.id));
		const begun = handleMissionAction("mission.update", { missionId: fresh.id, missionUpdate: { goal: { iteration: "begin" } } }, b).details?.mission;
		assert.equal(begun?.goal?.iterationsStarted, 1);
		assert.equal(begun?.goal?.iterationActive, true);
		assert.throws(() => handleMissionAction("mission.close", { missionId: foreign.id, missionStatus: "cancelled", summary: "Foreign cancellation" }, b), /owning session|another session/i);
		assert.deepEqual(fs.readFileSync(foreignPath), before);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

it("preserves an existing owner when internal code enables a goal without an ownership check", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-owner-preserve-"));
	try {
		const location = resolveMissionStoreLocation({ projectRoot: root, agentDir: path.join(root, "agent") });
		const existing = createMission(location, { title: "Existing", objective: "Preserve owner", ownerSessionId: "saved-session" });
		const enabled = updateMission(location, existing.id, { goal: { status: "active" } });
		assert.equal(enabled.ownerSessionId, "saved-session");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
