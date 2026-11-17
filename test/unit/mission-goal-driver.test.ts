import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { collectGoalContinuationNotices } from "../../src/missions/goal-driver.ts";
import { prepareMissionLaunch } from "../../src/missions/lifecycle.ts";
import { createMission, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";
import type { RetainedChild } from "../../src/runs/background/retained-children.ts";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-goal-mission-"));
	const projectRoot = path.join(root, "project");
	fs.mkdirSync(projectRoot, { recursive: true });
	const location = resolveMissionStoreLocation({ projectRoot });
	const ctx = { cwd: projectRoot, currentSessionId: "session-1" };
	return { root, projectRoot, location, ctx };
}

function goal(test: ReturnType<typeof fixture>, options: { maxIterations?: number; status?: "active" | "planned"; ownerSessionId?: string } = {}) {
	return createMission(test.location, {
		title: "Ship auth refresh",
		objective: "Implement and validate token refresh",
		goal: true,
		...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
		status: options.status ?? "active",
		ownerSessionId: options.ownerSessionId ?? "session-1",
	});
}

function collect(test: ReturnType<typeof fixture>, turnId: string | number, extras: { ownerSessionId?: string; pendingMessages?: boolean; aborted?: boolean; retainedChildren?: RetainedChild[] } = {}) {
	const notices = collectGoalContinuationNotices({
		location: test.location,
		ownerSessionId: extras.ownerSessionId ?? "session-1",
		retainedChildren: extras.retainedChildren ?? [],
		turnId,
		...(extras.pendingMessages !== undefined ? { pendingMessages: extras.pendingMessages } : {}),
		...(extras.aborted !== undefined ? { aborted: extras.aborted } : {}),
	});
	// Synthetic successful-delivery fixture for the pre-existing iteration tests.
	for (const notice of notices) {
		const last = readMission(test.location, notice.missionId).goal?.lastContinuation;
		if (notice.triggerTurn && last) updateMission(test.location, notice.missionId, { goalContinuation: { ownerSessionId: extras.ownerSessionId ?? "session-1", ...last, delivery: "observed" } });
	}
	return notices;
}

function updateGoal(test: ReturnType<typeof fixture>, missionId: string, goal: Record<string, unknown>) {
	return handleMissionAction("mission.update", { missionId, missionUpdate: { goal } }, test.ctx).details!.mission!;
}

function linkStoppedRun(test: ReturnType<typeof fixture>, missionId: string, status: "stopped" | "cancelled" | "rejected") {
	const asyncDir = path.join(test.root, `linked-${status}`);
	fs.mkdirSync(asyncDir);
	fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({ state: status }));
	updateMission(test.location, missionId, {
		addRuns: [{ runId: `run-${status}`, mode: "single", asyncDir, status: "running" }],
	});
}

describe("goal mission continuation", () => {
	it("never recovers a pending claim through owner, input, active-run or restriction guards", () => {
		for (const guard of ["foreign", "pending", "running", "paused", "cancelled", "completed", "waiting", "decision", "limit"] as const) {
			const test = fixture();
			try {
				const mission = goal(test);
				const input = { location: test.location, ownerSessionId: "session-1", retainedChildren: [], turnId: "claim" };
				collectGoalContinuationNotices(input);
				if (guard === "running") updateMission(test.location, mission.id, { addRuns: [{ runId: "running", mode: "workflow", status: "running" }] });
				if (guard === "paused") updateGoal(test, mission.id, { paused: true });
				if (["cancelled", "completed", "waiting"].includes(guard)) updateMission(test.location, mission.id, { status: guard as "cancelled" | "completed" | "waiting" });
				if (guard === "decision") updateMission(test.location, mission.id, { addDecisions: [{ title: "Choose", options: ["A"] }] });
				if (guard === "limit") {
					updateGoal(test, mission.id, { iteration: "begin" });
					updateGoal(test, mission.id, { maxIterations: 1 });
					updateGoal(test, mission.id, { iteration: "complete", progress: "advanced" });
				}
				const before = readMission(test.location, mission.id);
				assert.deepEqual(collectGoalContinuationNotices({ ...input, turnId: "resumed", ownerSessionId: guard === "foreign" ? "foreign" : "session-1", pendingMessages: guard === "pending", deliveryHistory: new Set<string>() }), [], guard);
				assert.deepEqual(readMission(test.location, mission.id), before, `${guard}: recovery must not mutate restrictions or counters`);
			} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
		}
	});

	it("preserves unknown legacy delivery explicitly and rejects invalid delivery values", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			collectGoalContinuationNotices({ location: test.location, ownerSessionId: "session-1", retainedChildren: [], turnId: "old" });
			const file = missionRecordPath(test.location, mission.id);
			const raw = JSON.parse(fs.readFileSync(file, "utf8"));
			delete raw.goal.lastContinuation.delivery;
			fs.writeFileSync(file, JSON.stringify(raw));
			assert.equal(readMission(test.location, mission.id).goal?.lastContinuation?.delivery, undefined);
			const before = fs.readFileSync(file, "utf8");
			assert.throws(() => collectGoalContinuationNotices({ location: test.location, ownerSessionId: "session-1", retainedChildren: [], turnId: "new", deliveryHistory: new Set<string>() }), /delivery is unknown/);
			assert.equal(fs.readFileSync(file, "utf8"), before);
			raw.goal.lastContinuation.delivery = "assumed";
			fs.writeFileSync(file, JSON.stringify(raw));
			assert.throws(() => readMission(test.location, mission.id), /delivery is invalid/);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});
	it("wakes an idle eligible goal without spending iterations on notices or status checks", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 3 });
			const first = collect(test, "turn-1");
			assert.equal(first.length, 1);
			assert.equal(first[0]!.triggerTurn, true);
			assert.match(first[0]!.message, /Next ready action: Continue objective:/);
			assert.match(first[0]!.message, /top unmet acceptance criterion.*progress advanced or none/i);
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 0);

			assert.deepEqual(collect(test, "turn-1"), [], "same-turn duplicate is suppressed");
			handleMissionAction("mission.show", { missionId: mission.id }, test.ctx);
			const unchanged = collect(test, "turn-2");
			assert.equal(unchanged.length, 1);
			assert.equal(unchanged[0]!.triggerTurn, false, "unchanged progress emits no automatic wake");
			assert.equal(readMission(test.location, mission.id).goal?.status, "paused");
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 0);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("increments only through explicit mission.update iteration begin and completes without another increment", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 3 });
			collect(test, 1);
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 0);
			let updated = updateGoal(test, mission.id, { iteration: "begin" });
			assert.equal(updated.goal?.iterationsStarted, 1);
			assert.equal(updated.goal?.iterationActive, true);
			updated = updateGoal(test, mission.id, { iteration: "begin" });
			assert.equal(updated.goal?.iterationsStarted, 1, "begin is idempotent while an iteration is active");
			updated = updateGoal(test, mission.id, { iteration: "complete", progress: "advanced" });
			assert.equal(updated.goal?.iterationsStarted, 1);
			assert.equal(updated.goal?.iterationActive, false);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("honors the explicit iteration maximum and blocks an N+1 launch", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 2 });
			for (let iteration = 1; iteration <= 2; iteration += 1) {
				if (iteration > 1) updateMission(test.location, mission.id, { summary: `Verified checkpoint ${iteration - 1}` });
				const notice = collect(test, `turn-${iteration}`);
				assert.equal(notice.length, 1);
				assert.equal(notice[0]!.triggerTurn, true);
				const begun = updateGoal(test, mission.id, { iteration: "begin" });
				assert.equal(begun.goal?.iterationsStarted, iteration);
				const completed = updateGoal(test, mission.id, { iteration: "complete", progress: "advanced" });
				assert.equal(completed.goal?.iterationsStarted, iteration);
			}
			const finished = readMission(test.location, mission.id);
			assert.equal(finished.goal?.status, "iteration-limit");
			assert.deepEqual(collect(test, "turn-3"), []);
			assert.throws(() => updateGoal(test, mission.id, { iteration: "begin" }), /iteration limit/i);
			assert.throws(() => prepareMissionLaunch({ params: { missionId: mission.id }, projectRoot: test.projectRoot, ownerSessionId: test.ctx.currentSessionId }), /iteration limit/i);
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 2);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("preserves planned and waiting goal status on mission.show when no linked run refreshed", () => {
		for (const initialStatus of ["planned", "waiting"] as const) {
			const test = fixture();
			try {
				const mission = goal(test, { maxIterations: 3, status: initialStatus === "planned" ? "planned" : "active" });
				if (initialStatus === "waiting") updateGoal(test, mission.id, { iteration: "begin" });
				updateMission(test.location, mission.id, {
					status: initialStatus,
					summary: `Parent-authored ${initialStatus} checkpoint`,
				});

				const shown = handleMissionAction("mission.show", { missionId: mission.id }, test.ctx).details!.mission!;
				assert.equal(shown.status, initialStatus);
				assert.equal(shown.summary, `Parent-authored ${initialStatus} checkpoint`);
				assert.equal(shown.goal?.iterationsStarted, initialStatus === "waiting" ? 1 : 0);
			} finally {
				fs.rmSync(test.root, { recursive: true, force: true });
			}
		}
	});

	it("reconciles a latest stopped linked run after mission.show before collecting a continuation", () => {
		for (const status of ["stopped", "cancelled", "rejected"] as const) {
			const test = fixture();
			try {
				const mission = goal(test, { maxIterations: 3 });
				const begun = updateGoal(test, mission.id, { iteration: "begin" });
				assert.equal(begun.goal?.iterationsStarted, 1);
				updateMission(test.location, mission.id, { summary: "Parent-authored checkpoint" });
				linkStoppedRun(test, mission.id, status);

				const shown = handleMissionAction("mission.show", { missionId: mission.id }, test.ctx).details!.mission!;
				assert.equal(shown.runs.at(-1)?.status, status);
				assert.equal(shown.status, "waiting", `${status} latest run must leave the goal waiting after show`);
				assert.equal(shown.summary, "Parent-authored checkpoint");
				assert.equal(shown.goal?.iterationsStarted, 1);
				assert.equal(shown.goal?.iterationActive, true);
				assert.deepEqual(collect(test, `after-show-${status}`), [], "mission.show reconciliation suppresses automatic continuation");
			} finally {
				fs.rmSync(test.root, { recursive: true, force: true });
			}
		}
	});

	it("reconciles a latest stopped linked run when collection refreshes it first", () => {
		for (const status of ["stopped", "cancelled", "rejected"] as const) {
			const test = fixture();
			try {
				const mission = goal(test, { maxIterations: 3 });
				updateGoal(test, mission.id, { iteration: "begin" });
				updateMission(test.location, mission.id, { summary: "Parent-authored checkpoint" });
				linkStoppedRun(test, mission.id, status);

				assert.deepEqual(collect(test, `collect-first-${status}`), []);
				const refreshed = readMission(test.location, mission.id);
				assert.equal(refreshed.status, "waiting");
				assert.equal(refreshed.summary, "Parent-authored checkpoint");
				assert.equal(refreshed.goal?.iterationsStarted, 1);
				assert.equal(refreshed.goal?.iterationActive, true);
			} finally {
				fs.rmSync(test.root, { recursive: true, force: true });
			}
		}
	});

	it("preserves parent waiting, paused, and closed states when showing a stopped linked run", () => {
		for (const authority of ["waiting", "paused", "completed"] as const) {
			const test = fixture();
			try {
				const mission = goal(test, { maxIterations: 3 });
				updateGoal(test, mission.id, { iteration: "begin" });
				if (authority === "waiting") updateMission(test.location, mission.id, { status: "waiting", summary: "Parent is waiting" });
				else if (authority === "paused") {
					updateGoal(test, mission.id, { paused: true });
					updateMission(test.location, mission.id, { summary: "Parent paused the goal" });
				} else updateMission(test.location, mission.id, { status: "completed", summary: "Parent closed the goal" });
				const expectedStatus = authority === "completed" ? "completed" : "waiting";
				const expectedGoalStatus = authority === "paused" ? "paused" : "active";
				linkStoppedRun(test, mission.id, "stopped");

				const shown = handleMissionAction("mission.show", { missionId: mission.id }, test.ctx).details!.mission!;
				assert.equal(shown.status, expectedStatus);
				assert.equal(shown.goal?.status, expectedGoalStatus);
				assert.equal(shown.summary, authority === "waiting" ? "Parent is waiting" : authority === "paused" ? "Parent paused the goal" : "Parent closed the goal");
				assert.equal(shown.goal?.iterationsStarted, 1);
				assert.deepEqual(collect(test, `parent-authority-${authority}`), []);
			} finally {
				fs.rmSync(test.root, { recursive: true, force: true });
			}
		}
	});

	it("suppresses wakes for linked active or paused runs, pause/wait/closure, open decisions, wrong owner and pending input", () => {
		const test = fixture();
		try {
			for (const status of ["queued", "running", "active", "paused"]) {
				const mission = goal(test, { maxIterations: 4 });
				updateMission(test.location, mission.id, { addRuns: [{ runId: `run-${status}`, mode: "workflow", status }] });
				assert.deepEqual(collect(test, 1), [], `${status} linked run must suppress wake`);
			}
			for (const status of ["waiting", "needs_decision", "completed", "failed", "cancelled"] as const) {
				const mission = goal(test, { maxIterations: 4 });
				updateMission(test.location, mission.id, { status });
				assert.deepEqual(collect(test, 1), [], `${status} mission must suppress wake`);
			}
			const paused = goal(test, { maxIterations: 4 });
			updateGoal(test, paused.id, { paused: true });
			assert.deepEqual(collect(test, 1), []);
			const decision = goal(test, { maxIterations: 4 });
			updateMission(test.location, decision.id, { addDecisions: [{ title: "Choose rollout", options: ["A", "B"] }] });
			assert.deepEqual(collect(test, 1), []);
			const owned = goal(test, { maxIterations: 4 });
			assert.deepEqual(collect(test, 1, { ownerSessionId: "other-session" }), []);
			assert.deepEqual(collect(test, 1, { pendingMessages: true }), []);
			assert.equal(readMission(test.location, owned.id).goal?.iterationsStarted, 0);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("pauses owned goals on abort/error input without emitting a wake", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 4 });
			assert.deepEqual(collect(test, 1, { aborted: true }), []);
			assert.equal(readMission(test.location, mission.id).goal?.status, "paused");
			assert.deepEqual(collect(test, 2), []);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("recovers collect-and-interrupt with the stable identity only on authoritative absence", async () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 4 });
			updateGoal(test, mission.id, { iteration: "begin" });
			const first = collectGoalContinuationNotices({ location: test.location, ownerSessionId: "session-1", retainedChildren: [], turnId: "stable-turn", now: 100 });
			assert.equal(first.length, 1);
			assert.equal(first[0]!.triggerTurn, true);
			const restartedDriver = await import(`../../src/missions/goal-driver.ts?restart=${Date.now()}`);
			const input = { location: test.location, ownerSessionId: "session-1", retainedChildren: [], turnId: "new-runtime" };
			assert.equal(readMission(test.location, mission.id).goal?.lastContinuation?.delivery, "pending");
			assert.throws(() => restartedDriver.collectGoalContinuationNotices(input), /delivery is unknown/);
			const retry = restartedDriver.collectGoalContinuationNotices({ ...input, now: 200, deliveryHistory: new Set<string>() });
			assert.equal(retry[0]?.event.runId, first[0]?.event.runId);
			assert.equal(first[0]!.event.ts, 100);
			assert.equal(retry[0]!.event.ts, 200, "retry records its current notification-attempt time");
			assert.equal(retry[0]?.message, first[0]?.message);
			assert.deepEqual(restartedDriver.collectGoalContinuationNotices({ ...input, deliveryHistory: new Set<string>(), queuedNoticeIds: new Set([first[0]!.event.runId]) }), []);
			assert.deepEqual(restartedDriver.collectGoalContinuationNotices({ ...input, recoveryOnly: true, deliveryHistory: new Set([first[0]!.event.runId]) }), []);
			assert.equal(readMission(test.location, mission.id).goal?.lastContinuation?.delivery, "observed");
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 1);
			assert.equal(readMission(test.location, mission.id).goal?.iterationActive, true);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("passively pauses unchanged checkpoints but wakes an active iteration on changed progress without incrementing", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 4 });
			const first = collect(test, 1);
			assert.equal(first[0]!.triggerTurn, true);
			const begun = updateGoal(test, mission.id, { iteration: "begin" });
			assert.equal(begun.goal?.iterationsStarted, 1);
			const noProgress = collect(test, 2);
			assert.equal(noProgress.length, 1);
			assert.equal(noProgress[0]!.triggerTurn, false, "passive stop is not an automatic wake");
			assert.match(noProgress[0]!.message, /No persisted progress/);
			assert.equal(readMission(test.location, mission.id).goal?.status, "paused");
			assert.equal(readMission(test.location, mission.id).goal?.iterationActive, true);

			updateGoal(test, mission.id, { paused: false });
			updateMission(test.location, mission.id, { summary: "Checkpoint: implementation verified; review remains" });
			const changedCheckpoint = collect(test, 3);
			assert.equal(changedCheckpoint.length, 1);
			assert.equal(changedCheckpoint[0]!.triggerTurn, true, "active iteration may wake on real checkpoint progress");
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 1, "continuation does not increment an active iteration");

			updateGoal(test, mission.id, { paused: false });
			updateMission(test.location, mission.id, {
				addRuns: [{ runId: "verification-run", mode: "single", status: "complete" }],
			});
			const changedRunState = collect(test, 4);
			assert.equal(changedRunState.length, 1);
			assert.equal(changedRunState[0]!.triggerTurn, true);
			assert.equal(readMission(test.location, mission.id).goal?.iterationsStarted, 1);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("reports linked token usage without old token caps and pauses legacy goals missing iteration history", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			const asyncDir = path.join(test.root, "legacy-run");
			fs.mkdirSync(asyncDir);
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({ state: "complete", totalTokens: { input: 30, output: 70, total: 100 } }));
			updateMission(test.location, mission.id, { addRuns: [{ runId: "legacy-run", mode: "workflow", asyncDir, status: "complete" }] });
			const recordPath = missionRecordPath(test.location, mission.id);
			const raw = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
			delete raw.goal.maxIterations;
			delete raw.goal.iterationsStarted;
			delete raw.goal.iterationActive;
			raw.goal.status = "budget-exhausted";
			raw.budget = { tokens: 100 };
			fs.writeFileSync(recordPath, JSON.stringify(raw));

			const notices = collect(test, "legacy-turn");
			assert.equal(notices.length, 1);
			assert.equal(notices[0]!.triggerTurn, false);
			assert.match(notices[0]!.message, /Reconcile the existing iteration limit and count/);
			const refreshed = readMission(test.location, mission.id);
			assert.equal(refreshed.goal?.status, "paused");
			assert.equal(refreshed.goal?.iterationsStarted, undefined);
			assert.equal(refreshed.usage?.tokens, 100, "token usage remains informational and is not blocked by a legacy cap");
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("resumes retained children from the latest linked run and ignores unrelated/non-resumable children", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 4 });
			updateMission(test.location, mission.id, {
				addRuns: [
					{ runId: "workflow-old", mode: "workflow", status: "complete" },
					{ runId: "workflow-new", mode: "workflow", status: "complete" },
				],
			});
			const retainedChildren: RetainedChild[] = [
				...Array.from({ length: 10 }, (_, offset) => {
					const index = 10 - offset;
					return { runId: `child-${index}`, parentRunId: `workflow-unrelated-${index}`, state: "complete" as const, agent: "worker", taskSummary: "Unrelated", completedAt: index, resumability: { state: "resumable" as const, sessionPath: `/tmp/child-${index}.jsonl` } };
				}),
				{ runId: "child-old", parentRunId: "workflow-old", state: "complete", agent: "reviewer", taskSummary: "Old", completedAt: 2, sessionPath: "/tmp/old.jsonl", resumability: { state: "resumable", sessionPath: "/tmp/old.jsonl" } },
				{ runId: "child-new", parentRunId: "workflow-new", state: "complete", agent: "reviewer", taskSummary: "New", completedAt: 1, sessionPath: "/tmp/new.jsonl", resumability: { state: "resumable", sessionPath: "/tmp/new.jsonl" } },
				{ runId: "child-stopped", parentRunId: "workflow-new", state: "stopped", agent: "worker", taskSummary: "Stopped", completedAt: 0, resumability: { state: "not-resumable", reason: "stopped run" } },
			];
			const notices = collect(test, 1, { retainedChildren });
			assert.equal(retainedChildren.length, 13);
			assert.equal(notices.length, 1);
			assert.equal(notices[0]!.triggerTurn, true);
			assert.match(notices[0]!.message, /Resume retained child child-new \(reviewer\)/);
			assert.doesNotMatch(notices[0]!.message, /child-old|child-stopped|child-10/);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});
});

describe("goal stall stop", () => {
	function iterate(test: ReturnType<typeof fixture>, missionId: string, progress: "advanced" | "none") {
		updateGoal(test, missionId, { iteration: "begin" });
		return updateGoal(test, missionId, { iteration: "complete", progress });
	}

	it("pauses after two consecutive no-progress iterations and stops waking the parent", () => {
		const test = fixture();
		try {
			const mission = goal(test, { maxIterations: 8 });
			const first = iterate(test, mission.id, "none");
			assert.equal(first.goal?.status, "active");
			assert.equal(first.goal?.stalledIterations, 1);
			const second = iterate(test, mission.id, "none");
			assert.equal(second.goal?.status, "paused");
			assert.equal(second.goal?.stalledIterations, 2);
			assert.equal(second.goal?.iterationsStarted, 2);
			assert.deepEqual(collect(test, "after-stall"), []);
			assert.throws(() => updateGoal(test, mission.id, { iteration: "begin" }), /paused/);
			const shown = handleMissionAction("mission.show", { missionId: mission.id }, test.ctx).content[0];
			assert.match(shown?.type === "text" ? shown.text : "", /Goal stalled: 2 consecutive iterations without progress; paused/);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("resets the stall count when an iteration advances", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			iterate(test, mission.id, "none");
			const advanced = iterate(test, mission.id, "advanced");
			assert.equal(advanced.goal?.stalledIterations, undefined);
			const again = iterate(test, mission.id, "none");
			assert.equal(again.goal?.status, "active");
			assert.equal(again.goal?.stalledIterations, 1);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("clears the stall on explicit resumption without resetting iteration history", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			iterate(test, mission.id, "none");
			iterate(test, mission.id, "none");
			const resumed = updateGoal(test, mission.id, { paused: false });
			assert.equal(resumed.goal?.status, "active");
			assert.equal(resumed.goal?.stalledIterations, undefined);
			assert.equal(resumed.goal?.iterationsStarted, 2);
			assert.equal(updateGoal(test, mission.id, { iteration: "begin" }).goal?.iterationsStarted, 3);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("requires a progress judgment on completion and rejects it anywhere else", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			updateGoal(test, mission.id, { iteration: "begin" });
			assert.throws(() => updateGoal(test, mission.id, { iteration: "complete" }), /requires progress/);
			assert.throws(() => updateGoal(test, mission.id, { iteration: "complete", progress: "some" }), /requires progress/);
			assert.throws(() => updateGoal(test, mission.id, { paused: true, progress: "none" }), /only with iteration: complete/);
			assert.equal(readMission(test.location, mission.id).goal?.iterationActive, true, "rejected updates leave the iteration open");
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});

	it("carries the objective, checkpoint and stall count in the continuation notice", () => {
		const test = fixture();
		try {
			const mission = goal(test);
			iterate(test, mission.id, "none");
			updateMission(test.location, mission.id, { summary: "Criteria 2/4 pass; refresh retry still drops the token." });
			const notice = collect(test, "turn-1");
			assert.equal(notice[0]!.triggerTurn, true);
			assert.match(notice[0]!.message, /No-progress iterations: 1\/2; the next attempt needs a different hypothesis/);
			assert.match(notice[0]!.message, /Checkpoint: Criteria 2\/4 pass; refresh retry still drops the token\./);
			assert.match(notice[0]!.message, /Objective: Implement and validate token refresh/);
		} finally { fs.rmSync(test.root, { recursive: true, force: true }); }
	});
});
