import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { handleSubagentControlNotice } from "../../src/extension/control-notices.ts";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { collectGoalContinuationNotices } from "../../src/missions/goal-driver.ts";
import { readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";
import type { ControlEvent, SubagentState } from "../../src/shared/types.ts";

function makeState(): SubagentState {
	return {
		baseCwd: "/tmp/project",
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function needsAttentionEvent(overrides: Partial<ControlEvent> = {}): ControlEvent {
	return {
		type: "needs_attention",
		to: "needs_attention",
		ts: 1,
		runId: "run-1",
		agent: "worker",
		index: 0,
		message: "worker needs attention",
		reason: "idle",
		...overrides,
	};
}

function makeRecorder() {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	return {
		sent,
		pi: {
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		},
	};
}

describe("subagent control notice delivery", () => {
	it("releases in-memory dedup after synchronous send failure", () => {
		const visible = new Set<string>();
		const details = { source: "goal" as const, event: needsAttentionEvent(), goalContinuation: true };
		const state = makeState();
		assert.throws(() => handleSubagentControlNotice({ pi: { sendMessage() { throw new Error("synthetic send failure"); } }, state, visibleControlNotices: visible, details }), /synthetic send failure/);
		assert.equal(visible.size, 0);
		const recorder = makeRecorder();
		handleSubagentControlNotice({ pi: recorder.pi, state, visibleControlNotices: visible, details });
		assert.equal(recorder.sent.length, 1);
	});
	it("delivers async needs-attention notices immediately", () => {
		const state = makeState();
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "async", event: needsAttentionEvent() },
		});

		assert.equal(recorder.sent.length, 1);
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: true });
	});

	it("delivers goal notices without starting a new turn", () => {
		const state = makeState();
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "goal", event: needsAttentionEvent(), noticeText: "Goal is ready." },
		});

		assert.equal(recorder.sent.length, 1);
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: false });
	});

	it("requests automatic turns only for an explicitly admitted goal continuation", () => {
		const recorder = makeRecorder();
		const state = makeState();
		const visible = new Set<string>();
		const details = { source: "goal" as const, event: needsAttentionEvent(), goalContinuation: true };
		handleSubagentControlNotice({ pi: recorder.pi, state, visibleControlNotices: visible, details });
		handleSubagentControlNotice({ pi: recorder.pi, state, visibleControlNotices: visible, details });
		assert.equal(recorder.sent.length, 1);
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: true });
	});

	it("connects bounded mission cycles to automatic notice delivery without charging notices", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-notice-loop-"));
		try {
			const ctx = { cwd: path.join(root, "project"), agentDir: path.join(root, "agent"), currentSessionId: "session-1" };
			fs.mkdirSync(ctx.cwd);
			const location = resolveMissionStoreLocation({ projectRoot: ctx.cwd, agentDir: ctx.agentDir });
			const created = handleMissionAction("mission.create", { mission: { title: "Bounded goal", goal: true, maxIterations: 2 }, missionStatus: "active" }, ctx);
			const missionId = created.details!.missionId!;
			const recorder = makeRecorder();
			const state = makeState();
			const visible = new Set<string>();
			for (let iteration = 1; iteration <= 2; iteration++) {
				const notice = collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: `runtime:${iteration}` })[0];
				assert.ok(notice?.triggerTurn);
				assert.equal(readMission(location, missionId).goal?.iterationsStarted, iteration - 1);
				handleSubagentControlNotice({ pi: recorder.pi, state, visibleControlNotices: visible, details: { source: "goal", event: notice.event, goalContinuation: notice.triggerTurn } });
				// Synthetic durable-delivery acknowledgment; actual disk reconciliation is tested separately.
				const last = readMission(location, missionId).goal!.lastContinuation!;
				updateMission(location, missionId, { goalContinuation: { ownerSessionId: ctx.currentSessionId, ...last, delivery: "observed" } });
				handleMissionAction("mission.update", { missionId, missionUpdate: { goal: { iteration: "begin" } } }, ctx);
				assert.equal(readMission(location, missionId).goal?.iterationsStarted, iteration);
				handleMissionAction("mission.update", { missionId, missionUpdate: { goal: { iteration: "complete" }, summary: `Verified cycle ${iteration}; PLAN.md updated` } }, ctx);
			}
			assert.deepEqual(recorder.sent.map((entry) => entry.options), [{ triggerTurn: true }, { triggerTurn: true }]);
			assert.equal(readMission(location, missionId).goal?.status, "iteration-limit");
			assert.deepEqual(collectGoalContinuationNotices({ location, ownerSessionId: ctx.currentSessionId, retainedChildren: [], turnId: "runtime:3" }), []);
			assert.throws(() => handleMissionAction("mission.update", { missionId, missionUpdate: { goal: { iteration: "begin" } } }, ctx), /iteration limit/);
			assert.equal(readMission(location, missionId).goal?.iterationsStarted, 2);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("sends nothing for a deferred supervisor-request status event", () => {
		const recorder = makeRecorder();
		handleSubagentControlNotice({ pi: recorder.pi, state: makeState(), visibleControlNotices: new Set(), details: { source: "async", event: needsAttentionEvent({ reason: "supervisor_request" }), noticeDeferred: true } });
		assert.deepEqual(recorder.sent, []);
	});

	it("does not queue a foreground notice that Pi could flush after completion", () => {
		const state = makeState();
		state.foregroundControls.set("run-1", {
			runId: "run-1",
			mode: "parallel",
			startedAt: 0,
			updatedAt: 0,
			currentAgent: "worker",
			currentIndex: 0,
			currentActivityState: "needs_attention",
		});
		const queued: Array<{ message: unknown; options: unknown }> = [];
		const visible: Array<{ message: unknown; options: unknown }> = [];
		const pi = {
			sendMessage(message: unknown, options: unknown) {
				queued.push({ message, options });
			},
		};

		handleSubagentControlNotice({
			pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "foreground", event: needsAttentionEvent() },
		});
		state.foregroundControls.delete("run-1");
		visible.push(...queued);

		assert.deepEqual(visible, []);
	});
});
