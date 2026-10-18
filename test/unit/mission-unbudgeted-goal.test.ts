import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { collectGoalContinuationNotices } from "../../src/missions/goal-driver.ts";
import { resolveMissionStoreLocation } from "../../src/missions/store.ts";

it("creates, displays, pauses, resumes and closes a goal without a token budget through mission actions", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbudgeted-goal-api-"));
	try {
		const ctx = { cwd: path.join(root, "project"), agentDir: path.join(root, "agent"), currentSessionId: "goal-session" };
		fs.mkdirSync(ctx.cwd);
		const location = resolveMissionStoreLocation({ projectRoot: ctx.cwd, agentDir: ctx.agentDir });
		const created = handleMissionAction("mission.create", {
			mission: { title: "Verify iteration-only goal", objective: "Exercise unbudgeted mission controls", goal: true },
			missionStatus: "active",
		}, ctx);
		const mission = created.details?.mission;
		assert.ok(mission);
		assert.equal(mission.goal?.status, "active");
		assert.equal(mission.budget, undefined);
		assert.equal(mission.ownerSessionId, ctx.currentSessionId);

		const shown = handleMissionAction("mission.show", { missionId: mission.id }, ctx);
		const text = shown.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
		assert.match(text, /Goal mode: active/);
		assert.doesNotMatch(text, /Budget:/i);
		const notices = collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 1 });
		assert.equal(notices.length, 1);
		assert.doesNotMatch(notices[0]!.message, /^Remaining budget:|\$/im);

		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { paused: true }, status: "waiting", summary: "Iteration limit reached" } }, ctx);
		assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 2 }), []);
		handleMissionAction("mission.update", { missionId: mission.id, missionUpdate: { goal: { paused: false }, status: "active" } }, ctx);
		assert.equal(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 3 }).length, 1);
		handleMissionAction("mission.close", { missionId: mission.id, missionStatus: "completed", summary: "Mission controls verified" }, ctx);
		assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: 4 }), []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
