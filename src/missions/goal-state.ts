import { DEFAULT_GOAL_MAX_ITERATIONS, GOAL_MAX_STALLED_ITERATIONS, type MissionGoal, type MissionGoalUpdate, type MissionRecord, type MissionUpdateInput } from "./types.ts";

const ACTIVE_RUNS = new Set(["queued", "running", "active", "paused"]);

function integer(value: unknown, label: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
	return value as number;
}

export function createMissionGoal(maxIterations = DEFAULT_GOAL_MAX_ITERATIONS): MissionGoal {
	return { status: "active", maxIterations: integer(maxIterations, "goal.maxIterations", 1), iterationsStarted: 0, iterationActive: false };
}

export function parseMissionGoal(value: unknown, label: string): MissionGoal {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	const input = value as Record<string, unknown>;
	// Old token caps are no longer execution controls. Missing historical iteration
	// counts still require reconciliation; never infer that an existing goal is new.
	const status = input.status === "budget-exhausted" ? "active" : input.status;
	if (status !== "active" && status !== "paused" && status !== "iteration-limit") throw new Error(`${label}.status is invalid`);
	const goal: MissionGoal = { status };
	if (input.maxIterations !== undefined || input.iterationsStarted !== undefined || input.iterationActive !== undefined) {
		goal.maxIterations = integer(input.maxIterations, `${label}.maxIterations`, 1);
		goal.iterationsStarted = integer(input.iterationsStarted, `${label}.iterationsStarted`, 0);
		if (goal.iterationsStarted > goal.maxIterations) throw new Error(`${label}.iterationsStarted exceeds maxIterations`);
		if (input.iterationActive !== undefined && typeof input.iterationActive !== "boolean") throw new Error(`${label}.iterationActive must be boolean`);
		goal.iterationActive = input.iterationActive === true;
	}
	if (input.stalledIterations !== undefined) goal.stalledIterations = integer(input.stalledIterations, `${label}.stalledIterations`, 0);
	if (input.lastContinuation !== undefined) {
		const last = input.lastContinuation as Record<string, unknown> | null;
		if (!last || typeof last !== "object" || Array.isArray(last) || typeof last.turnId !== "string" || !last.turnId || typeof last.progressKey !== "string" || !last.progressKey) {
			throw new Error(`${label}.lastContinuation is invalid`);
		}
		if (last.delivery !== undefined && last.delivery !== "pending" && last.delivery !== "observed") throw new Error(`${label}.lastContinuation.delivery is invalid`);
		goal.lastContinuation = { turnId: last.turnId, progressKey: last.progressKey, ...(last.delivery !== undefined ? { delivery: last.delivery } : {}) };
	}
	return goal;
}

export function updateMissionGoal(record: MissionRecord, patch: MissionGoalUpdate | false | undefined, continuation: MissionUpdateInput["goalContinuation"]): MissionGoal | undefined {
	if (patch === false) return undefined;
	let goal = record.goal ? { ...record.goal } : patch ? createMissionGoal() : undefined;
	if (!goal) return undefined;
	if (patch) {
		if (patch.maxIterations !== undefined) goal.maxIterations = integer(patch.maxIterations, "goal.maxIterations", 1);
		if (patch.iterationsStarted !== undefined) {
			const started = integer(patch.iterationsStarted, "goal.iterationsStarted", 0);
			if (record.goal?.iterationsStarted !== undefined && started !== record.goal.iterationsStarted) throw new Error("Goal iteration counts cannot be rewritten or reset");
			goal.iterationsStarted = started;
			goal.iterationActive ??= false;
		}
		if (patch.iterationActive !== undefined) {
			if (!record.goal || record.goal.iterationsStarted !== undefined || patch.maxIterations === undefined || patch.iterationsStarted === undefined || patch.iterationActive && patch.iterationsStarted < 1) throw new Error("iterationActive can only reconcile an existing goal's missing counters with a valid iteration count");
			goal.iterationActive = patch.iterationActive;
		}
		if ((goal.maxIterations === undefined) !== (goal.iterationsStarted === undefined)) throw new Error("Reconcile both goal.maxIterations and goal.iterationsStarted from the existing checkpoint");
		if (goal.maxIterations !== undefined && goal.iterationsStarted! > goal.maxIterations) throw new Error("Goal maxIterations cannot be below iterationsStarted");
		if (patch.status) {
			goal.status = patch.status;
			// Explicit resumption permits a fresh attempt without erasing iteration history.
			delete goal.lastContinuation;
			if (patch.status === "active") delete goal.stalledIterations;
		}
		if (patch.progress !== undefined && patch.iteration !== "complete") throw new Error("goal.progress is reported only with iteration: complete");
		if (patch.iteration === "complete") {
			if (!goal.iterationActive) throw new Error("No goal iteration is active");
			if (record.runs.some((run) => run.status && ACTIVE_RUNS.has(run.status))) throw new Error("Settle linked runs before completing the goal iteration");
			goal.iterationActive = false;
			if (patch.progress === "advanced") delete goal.stalledIterations;
			if (patch.progress === "none") goal.stalledIterations = (goal.stalledIterations ?? 0) + 1;
			// Iterations that move no acceptance criterion are the loop this guard stops.
			if ((goal.stalledIterations ?? 0) >= GOAL_MAX_STALLED_ITERATIONS) goal.status = "paused";
		}
	}
	if (continuation) {
		if (record.ownerSessionId !== continuation.ownerSessionId || goal.status !== "active" || !["active", "planned"].includes(record.status) || record.decisions.some((decision) => decision.status === "open") || record.runs.some((run) => run.status && ACTIVE_RUNS.has(run.status))) return goal;
		if (continuation.delivery === "observed") {
			if (goal.lastContinuation?.turnId === continuation.turnId && goal.lastContinuation.progressKey === continuation.progressKey && goal.lastContinuation.delivery === "pending") {
				goal.lastContinuation = { ...goal.lastContinuation, delivery: "observed" };
			}
			return goal;
		}
		if (goal.lastContinuation?.turnId === continuation.turnId || goal.lastContinuation && goal.lastContinuation.delivery !== "observed") return goal;
		if (goal.maxIterations === undefined || goal.iterationsStarted === undefined || goal.lastContinuation?.progressKey === continuation.progressKey) {
			goal.status = "paused";
			return goal;
		}
		goal.lastContinuation = { turnId: continuation.turnId, progressKey: continuation.progressKey, delivery: "pending" };
	}
	if (goal.maxIterations !== undefined && goal.iterationsStarted !== undefined && !goal.iterationActive && goal.iterationsStarted >= goal.maxIterations) goal.status = goal.status === "paused" ? "paused" : "iteration-limit";
	if (patch?.iteration === "begin") {
		if (goal.status !== "active" || !["active", "planned"].includes(record.status) || record.decisions.some((decision) => decision.status === "open")) throw new Error("Goal iteration is paused, blocked, closed, or at its iteration limit");
		if (goal.maxIterations === undefined || goal.iterationsStarted === undefined) throw new Error("Reconcile the existing goal's iteration limit and count before beginning work");
		if (!goal.iterationActive) {
			if (record.runs.some((run) => run.status && ACTIVE_RUNS.has(run.status))) throw new Error("Settle linked runs before beginning another goal iteration");
			goal.iterationsStarted += 1;
			goal.iterationActive = true;
		}
	}
	return parseMissionGoal(goal, "goal");
}
