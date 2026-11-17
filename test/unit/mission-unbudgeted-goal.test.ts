import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { collectGoalContinuationNotices } from "../../src/missions/goal-driver.ts";
import { resolveMissionStoreLocation } from "../../src/missions/store.ts";

it("creates and continues an unbudgeted goal with explicit pause, iteration, and close controls", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbudgeted-goal-api-"));
	try {
		const projectRoot = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(projectRoot);
		const ctx = { cwd: projectRoot, agentDir, currentSessionId: "goal-session" };
		const location = resolveMissionStoreLocation({ projectRoot, agentDir });
		const created = handleMissionAction("mission.create", {
			mission: { title: "Verify iteration-only goal", objective: "Exercise unbudgeted mission controls", goal: true, maxIterations: 2 },
			missionStatus: "active",
		}, ctx);
		const mission = created.details?.mission;
		assert.ok(mission);
		assert.equal(mission.goal?.status, "active");
		assert.equal(mission.goal?.iterationsStarted, 0);
		assert.equal(Object.hasOwn(mission, "budget"), false);
		assert.equal(mission.ownerSessionId, ctx.currentSessionId);

		const shown = handleMissionAction("mission.show", { missionId: mission.id }, ctx);
		const text = shown.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
		assert.match(text, /Goal mode: active/);
		assert.doesNotMatch(text, /Budget:/i);
		const notices = collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 1 });
		assert.equal(notices.length, 1);
		assert.equal(notices[0]!.triggerTurn, true);
		assert.match(notices[0]!.message, /Next ready action:/);
		assert.match(notices[0]!.message, /top unmet acceptance criterion/i);
		assert.equal(mission.goal?.iterationsStarted, 0, "automatic notice does not spend an iteration");

		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { iteration: "begin" } } }, ctx);
		assert.equal(handleMissionAction("mission.show", { missionId: mission.id }, ctx).details?.mission?.goal?.iterationsStarted, 1);
		const asyncDir = path.join(root, "linked-run");
		fs.mkdirSync(asyncDir);
		fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({ state: "running" }));
		handleMissionAction("mission.attach-run", { missionId: mission.id, runId: "iteration-run", runMode: "single", dir: asyncDir }, ctx);
		assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 2 }), [], "a linked live run suppresses automatic continuation");
		fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({ state: "complete" }));
		const settled = handleMissionAction("mission.show", { missionId: mission.id }, ctx).details?.mission;
		assert.equal(settled?.runs[0]?.status, "complete", "mission.show refreshes the linked run through the production path");
		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { iteration: "complete", progress: "advanced" } } }, ctx);
		assert.equal(handleMissionAction("mission.show", { missionId: mission.id }, ctx).details?.mission?.goal?.iterationsStarted, 1);

		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { paused: true }, status: "waiting", summary: "Iteration checkpoint" } }, ctx);
		assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 3 }), []);
		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { paused: false }, status: "active" } }, ctx);
		assert.equal(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 4 }).length, 1);
		handleMissionAction("mission.close", { missionId: mission.id, missionStatus: "completed", summary: "Mission controls verified" }, ctx);
		assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 5 }), []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
