import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RetainedChild } from "../runs/background/retained-children.ts";
import type { ControlEvent } from "../shared/types.ts";
import { listMissions, readMission, updateMission } from "./store.ts";
import type { MissionRecord, MissionRunLink, MissionStoreLocation } from "./types.ts";
import { missionStatePath } from "./workflow-state.ts";

const TERMINAL_MISSION_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "active", "paused"]);
const STOPPED_GOAL_RUN_STATUSES = new Set(["stopped", "cancelled", "rejected"]);
const MAX_ACTION_LENGTH = 180;

export interface GoalContinuationNotice {
	missionId: string;
	message: string;
	triggerTurn: boolean;
	event: ControlEvent;
}

function bounded(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > MAX_ACTION_LENGTH ? `${normalized.slice(0, MAX_ACTION_LENGTH - 1)}…` : normalized;
}

function tokenUsage(value: unknown): number | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const total = (value as { total?: unknown }).total;
	return Number.isSafeInteger(total) && (total as number) >= 0 ? total as number : undefined;
}

function readLinkedRun(run: MissionRunLink): MissionRunLink {
	if (!run.asyncDir) return run;
	const statusPath = path.join(run.asyncDir, "status.json");
	if (!fs.existsSync(statusPath)) return run;
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
	} catch (error) {
		throw new Error(`Failed to read linked run status '${statusPath}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Linked run status '${statusPath}' must be an object`);
	const status = parsed as Record<string, unknown>;
	if (typeof status.state !== "string" || !status.state.trim()) throw new Error(`Linked run status '${statusPath}' is missing state`);
	const tokens = tokenUsage(status.totalTokens)
		?? (Array.isArray(status.steps)
			? status.steps.reduce((total, step) => {
				if (!step || typeof step !== "object") return total;
				return total + (tokenUsage((step as { tokens?: unknown }).tokens) ?? 0);
			}, 0)
			: undefined);
	return {
		...run,
		status: status.state,
		...(!ACTIVE_RUN_STATUSES.has(status.state) && !run.completedAt ? { completedAt: new Date().toISOString() } : {}),
		...(tokens !== undefined ? { usage: { tokens } } : {}),
	};
}

function refreshGoalMission(location: MissionStoreLocation, record: MissionRecord): MissionRecord {
	const runs = record.runs.map(readLinkedRun);
	const changed = runs.some((run, index) => JSON.stringify(run) !== JSON.stringify(record.runs[index]));
	const latestRunStopped = !!record.goal && STOPPED_GOAL_RUN_STATUSES.has(runs.at(-1)?.status ?? "");
	const preserveParentStatus = record.goal?.status === "paused"
		|| record.status === "waiting"
		|| record.status === "needs_decision"
		|| TERMINAL_MISSION_STATUSES.has(record.status);
	const status = latestRunStopped && !preserveParentStatus ? "waiting" : record.status;
	if (!changed && status === record.status) return record;
	return updateMission(location, record.id, {
		status,
		addRuns: changed ? runs : [],
	});
}

function readyActionFromValue(value: unknown, pathLabel = "state", depth = 0): string | undefined {
	if (depth > 8 || !value || typeof value !== "object") return undefined;
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const found = readyActionFromValue(value[index], `${pathLabel}[${index}]`, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	const input = value as Record<string, unknown>;
	for (const key of ["nextReadyAction", "nextAction"] as const) {
		if (typeof input[key] === "string" && input[key].trim()) return bounded(input[key]);
	}
	if (input.status === "ready") {
		for (const key of ["action", "task", "title", "summary"] as const) {
			if (typeof input[key] === "string" && input[key].trim()) return bounded(input[key]);
		}
		return `Continue ready mission state at ${pathLabel}`;
	}
	for (const [key, child] of Object.entries(input)) {
		const found = readyActionFromValue(child, `${pathLabel}.${key}`, depth + 1);
		if (found) return found;
	}
	return undefined;
}

function missionStateAction(location: MissionStoreLocation, record: MissionRecord): string | undefined {
	const statePath = missionStatePath(location, record.id);
	if (fs.existsSync(statePath)) {
		const action = readyActionFromValue(JSON.parse(fs.readFileSync(statePath, "utf-8")));
		if (action) return action;
	}
	const decision = record.decisions.find((item) => item.status === "open");
	if (decision) return bounded(decision.recommendation ?? `Resolve decision: ${decision.title}`);
	return undefined;
}

function retainedResumeTarget(record: MissionRecord, retainedChildren: RetainedChild[]): RetainedChild | undefined {
	const latestRun = record.runs.at(-1);
	if (!latestRun) return undefined;
	return retainedChildren.find((child) =>
		child.resumability.state === "resumable" && (child.runId === latestRun.runId || child.parentRunId === latestRun.runId)
	);
}

function nextReadyAction(location: MissionStoreLocation, record: MissionRecord, retainedChildren: RetainedChild[]): string {
	const stateAction = missionStateAction(location, record);
	const latestRun = record.runs.at(-1);
	const action = stateAction
		?? (latestRun?.status === "failed" || latestRun?.status === "paused"
			? `Inspect linked run ${latestRun.runId} and continue the mission`
			: `Continue objective: ${record.objective}`);
	const retained = retainedResumeTarget(record, retainedChildren);
	return retained
		? `Resume retained child ${retained.runId} (${retained.agent}) for: ${bounded(action)}`
		: bounded(action);
}

export function goalContinuationRunId(missionId: string, turnId: string): string {
	return `goal-${missionId}-turn-${turnId}`;
}

// Read disk, not getEntries(): SessionManager updates memory before _persist can
// fail, and streaming message_end hooks run before the custom-message append.
export function readGoalDeliveryHistory(sessionFile: string | null | undefined, sessionId: string): ReadonlySet<string> | undefined {
	if (!sessionFile || !fs.existsSync(sessionFile)) return undefined;
	const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n");
	const entries = lines.map((line) => JSON.parse(line));
	if (entries[0]?.type !== "session" || entries[0]?.id !== sessionId) throw new Error("Goal delivery history has a mismatched saved-session identity");
	const observed = new Set<string>();
	for (const entry of entries.slice(1)) {
		if (!entry || typeof entry.type !== "string" || typeof entry.id !== "string") throw new Error("Goal delivery history is incomplete");
		if (entry.type === "custom_message" && entry.customType === "subagent_control_notice" && entry.details?.source === "goal" && entry.details?.goalContinuation === true && typeof entry.details.event?.runId === "string") observed.add(entry.details.event.runId);
	}
	return observed;
}

export function collectGoalContinuationNotices(input: {
	location: MissionStoreLocation;
	ownerSessionId: string;
	retainedChildren: RetainedChild[];
	turnId: string | number;
	now?: number;
	aborted?: boolean;
	pendingMessages?: boolean;
	// Undefined means unknown evidence, not proof of absence.
	deliveryHistory?: ReadonlySet<string>;
	readDeliveryHistory?: () => ReadonlySet<string> | undefined;
	queuedNoticeIds?: ReadonlySet<string>;
	recoveryOnly?: boolean;
}): GoalContinuationNotice[] {
	const turnId = String(input.turnId);
	let deliveryHistory = input.deliveryHistory;
	let historyRead = deliveryHistory !== undefined;
	for (const listed of listMissions(input.location).records) {
		if (listed.ownerSessionId !== input.ownerSessionId || !listed.goal || TERMINAL_MISSION_STATUSES.has(listed.status)) continue;
		if (input.aborted) {
			if (listed.goal.status === "active") updateMission(input.location, listed.id, { goal: { status: "paused" } });
			continue;
		}
		if (input.pendingMessages || listed.goal.status !== "active" || !["active", "planned"].includes(listed.status)) continue;
		let record = refreshGoalMission(input.location, readMission(input.location, listed.id));
		if (record.goal?.status !== "active" || !["active", "planned"].includes(record.status) || record.decisions.some((decision) => decision.status === "open")) continue;
		if (record.runs.some((run) => run.status && ACTIVE_RUN_STATUSES.has(run.status))) continue;
		const action = nextReadyAction(input.location, record, input.retainedChildren);
		const progressKey = createHash("sha256").update(JSON.stringify({
			summary: record.summary,
			action,
			runs: record.runs.map((run) => [run.runId, run.status]),
		})).digest("hex");
		const previous = record.goal.lastContinuation;
		let noticeTurnId = turnId;
		if (previous && previous.delivery !== "observed") {
			if (!historyRead) {
				deliveryHistory = input.readDeliveryHistory?.();
				historyRead = true;
			}
			if (previous.delivery !== "pending" || !deliveryHistory) {
				throw new Error(`Goal ${record.id} continuation delivery is unknown; inspect the saved session before explicit resumption`);
			}
			const runId = goalContinuationRunId(record.id, previous.turnId);
			if (deliveryHistory.has(runId)) {
				record = updateMission(input.location, record.id, { goalContinuation: { ownerSessionId: input.ownerSessionId, ...previous, delivery: "observed" } });
				// Startup only reconciles. An ordinary completed turn must still
				// evaluate its work, or acknowledging the preceding notice stalls it.
				if (input.recoveryOnly || previous.turnId === turnId) continue;
				record = updateMission(input.location, record.id, { goalContinuation: { ownerSessionId: input.ownerSessionId, turnId, progressKey } });
			} else {
				if (input.queuedNoticeIds?.has(runId)) continue;
				if (previous.progressKey !== progressKey) throw new Error(`Goal ${record.id} pending continuation checkpoint changed; inspect before explicit resumption`);
				noticeTurnId = previous.turnId;
			}
		} else {
			if (input.recoveryOnly || previous?.turnId === turnId) continue;
			record = updateMission(input.location, record.id, { goalContinuation: { ownerSessionId: input.ownerSessionId, turnId, progressKey } });
		}
		const triggerTurn = record.goal?.status === "active" && record.goal.lastContinuation?.turnId === noticeTurnId;
		const reason = record.goal?.maxIterations === undefined
			? "Reconcile the existing iteration limit and count from PLAN.md and preserved evidence; do not reset history."
			: record.goal?.status === "iteration-limit"
				? "Iteration limit reached. Checkpoint remaining work; do not start another iteration."
				: "No persisted progress since the last continuation, or the mission is paused/blocked. Inspect the checkpoint before explicit resumption.";
		const message = [
			`${triggerTurn ? "Goal continuation" : "Goal stopped"}: ${bounded(record.title)}`,
			`Mission: ${record.id}`,
			...(record.goal?.maxIterations !== undefined ? [`Iterations started: ${record.goal.iterationsStarted}/${record.goal.maxIterations}${record.goal.iterationActive ? " (current iteration active)" : ""}`] : []),
			...(triggerTurn ? [
				`Next ready action: ${action}`,
				"Use exact-ID mission.show to recheck pause/closure and linked runs. Before a new iteration, reassess PLAN.md against the original goal; update active steps/dependencies and archive obsolete steps with reasons and evidence. Begin an inactive iteration with mission.update goal.iteration=begin only when implementation/verification starts; do not increment an already active iteration. Checkpoint and complete it after verification, then continue automatically within the limit. Close only with full acceptance evidence.",
			] : [reason]),
		].join("\n");
		// Persist the wakeup claim before delivery. Only explicit implementation/
		// verification admission spends an iteration, never a notice or status check.
		return [{
			missionId: record.id,
			message,
			triggerTurn,
			event: {
				type: "needs_attention", to: "needs_attention", ts: input.now ?? Date.now(),
				runId: goalContinuationRunId(record.id, noticeTurnId), agent: "goal mission", message, reason: "idle",
			},
		}];
	}
	return [];
}
