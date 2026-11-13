import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { writePrivateAtomicJson } from "../shared/atomic-json.ts";
import { PROMPT_REDACTED } from "../shared/utils.ts";
import { DIRS, type AcceptanceLedger, type AcceptanceLedgerStatus, type Details, type SubagentRunMode } from "../shared/types.ts";
import { resultFilePath } from "../runs/background/result-files.ts";
import { validateMissionLaunch } from "./actions.ts";
import { parseWorkflowChildSummary } from "../workflows/workflow-child-summary.ts";
import type { MissionArtifact, MissionCreateInput, MissionRecord, MissionRunLink, MissionRunMode, MissionStatus, MissionStoreConfig, MissionStoreLocation } from "./types.ts";
import { createMission, createSessionGoal, MissionNotFoundError, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission, validateMissionId } from "./store.ts";

export const MISSION_BINDING_FILE = "mission.json";

export interface MissionLaunchParams {
	missionId?: string;
	mission?: unknown;
	task?: string;
	tasks?: Array<{ task?: string }>;
	chain?: Array<{ task?: string; parallel?: Array<{ task?: string }> | { task?: string } }>;
}

export interface MissionLaunchBinding {
	missionId: string;
	location: MissionStoreLocation;
	/** True when the launch made the mission without a `mission` or `missionId` request. */
	autoCreated: boolean;
	announceInContent?: boolean;
	acceptanceLaunchId?: string;
}

interface PersistedMissionBinding {
	acceptanceLaunchId?: string;
	schemaVersion: 1;
	missionId: string;
	projectRoot: string;
	missionDir: string;
	globalIndexDir: string;
	writeGlobalIndex: boolean;
	retainTerminal?: number;
	autoCreated: boolean;
}

function workflowObjective(params: MissionLaunchParams): string | undefined {
	const objective = params.task?.trim()
		|| params.tasks?.find((task) => task.task?.trim())?.task?.trim()
		|| params.chain?.find((step) => step.task?.trim())?.task?.trim();
	if (objective) return objective;
	for (const step of params.chain ?? []) {
		const parallel = Array.isArray(step.parallel) ? step.parallel : step.parallel ? [step.parallel] : [];
		const task = parallel.find((child) => child.task?.trim())?.task?.trim();
		if (task) return task;
	}
	return undefined;
}

export function prepareMissionLaunch(input: {
	params: MissionLaunchParams;
	projectRoot: string;
	config?: MissionStoreConfig;
	ownerSessionId?: string;
}): MissionLaunchBinding | undefined {
	const hasMissionId = input.params.missionId !== undefined;
	if (hasMissionId && input.params.mission !== undefined) throw new Error("Use missionId or mission, not both");
	if (input.params.mission === false) return undefined;
	const objective = workflowObjective(input.params);
	const missionsEnabled = input.config?.enabled !== false;
	const shouldCreate = input.params.mission !== undefined || (missionsEnabled && objective !== undefined);
	if (!hasMissionId && !shouldCreate) return undefined;
	const location = resolveMissionStoreLocation({ projectRoot: input.projectRoot, ...(input.config ? { config: input.config } : {}) });
	if (hasMissionId) {
		const missionId = validateMissionId(input.params.missionId);
		const acceptanceLaunchId = randomUUID();
		updateMission(location, missionId, {
			acceptanceLaunch: { launchId: acceptanceLaunchId },
			status: "active",
			requireActiveGoal: true,
			expectedGoalOwnerSessionId: input.ownerSessionId,
		});
		return { missionId, location, autoCreated: false, announceInContent: true, acceptanceLaunchId };
	}
	const mission = input.params.mission !== undefined ? validateMissionLaunch(input.params.mission) : undefined;
	if (mission?.goal && !input.ownerSessionId) throw new Error("Creating a goal mission requires a current session");
	const promptDerivedObjective = mission?.objective ?? (mission ? mission.title : objective ? PROMPT_REDACTED : undefined);
	const title = mission?.title || PROMPT_REDACTED;
	const missionInput: MissionCreateInput = {
		title,
		objective: promptDerivedObjective || title,
		...(mission?.goal === true ? { goal: true as const } : {}),
		...(mission?.maxIterations !== undefined ? { maxIterations: mission.maxIterations } : {}),
		status: "active",
		...(mission?.labels ? { labels: mission.labels } : {}),
		...(input.ownerSessionId ? { ownerSessionId: input.ownerSessionId } : {}),
	};
	const record = mission?.goal ? createSessionGoal(location, missionInput, new Date()) : createMission(location, missionInput, new Date(), input.config?.retainTerminal);
	if (record.goal) updateMission(location, record.id, { goal: { iteration: "begin" }, expectedGoalOwnerSessionId: input.ownerSessionId });
	const acceptanceLaunchId = randomUUID();
	updateMission(location, record.id, { acceptanceLaunch: { launchId: acceptanceLaunchId } });
	return { missionId: record.id, location, autoCreated: input.params.mission === undefined, announceInContent: true, acceptanceLaunchId };
}

function toolResultIsError(result: AgentToolResult<Details>): boolean {
	return "isError" in result && result.isError === true;
}

function missionRunModeForResult(mode: Details["mode"]): MissionRunMode {
	return mode === "management" ? "external" : mode;
}

function runStatusForResult(result: AgentToolResult<Details>): string {
	if (result.details.asyncDir) return "active";
	if (result.details.results.some((child) => child.interrupted || child.detached)) return "paused";
	if (toolResultIsError(result) || result.details.results.some((child) => child.exitCode !== 0)) return "failed";
	return "completed";
}

/** Acceptance statuses that mean nobody accepted the child's result. */
const UNACCEPTED_ACCEPTANCE_STATUSES = new Set<string | undefined>(["pending", "claimed", "review-required", "rejected"] satisfies AcceptanceLedgerStatus[]);

/** The first unaccepted acceptance status among child results, else the first status found. */
export function missionAcceptanceStatus(results: unknown): string | undefined {
	const statuses = (Array.isArray(results) ? results : [])
		.map((result) => (result as { acceptance?: { status?: unknown } } | null | undefined)?.acceptance?.status)
		.filter((status): status is string => typeof status === "string" && status.trim() !== "");
	return statuses.find((status) => UNACCEPTED_ACCEPTANCE_STATUSES.has(status)) ?? statuses[0];
}

/**
 * The status of a mission whose runs all finished successfully. Every path that
 * completes a mission from run state goes through here.
 */
export function finishedMissionStatus(record: MissionRecord, autoCreated: boolean, runAcceptance: ReadonlyArray<{ runId: string; status: string | undefined }>): "completed" | "waiting" {
	// Nobody is expected to close a mission made by default for an ordinary launch.
	if (autoCreated) return "completed";
	if (runAcceptance.some((run) => UNACCEPTED_ACCEPTANCE_STATUSES.has(run.status))) return "waiting";
	// A run reported here supersedes its older workflow child record.
	const reported = new Set<string | undefined>(runAcceptance.map((run) => run.runId));
	return record.workflowChildren.some((child) => !reported.has(child.runId) && UNACCEPTED_ACCEPTANCE_STATUSES.has(child.acceptanceStatus)) ? "waiting" : "completed";
}

function missionStatusForRun(record: MissionRecord, runId: string, runStatus: string, acceptanceStatus: string | undefined, autoCreated: boolean): MissionStatus {
	if (record.status === "completed" || record.status === "failed" || record.status === "cancelled") return record.status;
	if (record.goal && (record.status === "waiting" || record.status === "needs_decision")) return record.status;
	if (runStatus === "active" || runStatus === "queued" || runStatus === "running") return "active";
	if (record.goal) return ["paused", "stopped", "cancelled", "rejected"].includes(runStatus) ? "waiting" : "active";
	if (runStatus === "paused") return "waiting";
	const otherActive = record.runs.some((run) => run.runId !== runId && (run.status === "active" || run.status === "queued" || run.status === "running"));
	if (otherActive) return "active";
	if (runStatus === "completed" || runStatus === "complete") return finishedMissionStatus(record, autoCreated, [{ runId, status: acceptanceStatus }]);
	if (runStatus === "stopped" || runStatus === "rejected" || runStatus === "cancelled") return "cancelled";
	return "failed";
}

function terminalMissionRunStatus(status: string): boolean {
	return ["complete", "completed", "failed", "stopped", "rejected", "cancelled", "partial"].includes(status);
}

function acceptanceObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A missing or partial envelope cannot positively establish absence of a producer. */
function finalRuntimeLedger(value: unknown): value is AcceptanceLedger {
	if (!acceptanceObject(value) || typeof value.explicit !== "boolean" || !acceptanceObject(value.effectiveAcceptance)) return false;
	const policy = value.effectiveAcceptance;
	if (policy.explicit !== value.explicit || !["none", "attested", "checked", "verified"].includes(String(policy.level))) return false;
	if (!["not-required", "attested", "checked", "verified", "rejected", "review-required", "reviewed", "accepted"].includes(String(value.status))) return false;
	if (!["not-required", "attested", "checked", "verified", "rejected"].includes(String(value.evidenceStatus))) return false;
	if ((policy.level === "none") !== (value.status === "not-required") || (value.status === "not-required" && value.evidenceStatus !== "not-required")) return false;
	if (![value.criteria, value.inferredReason, value.runtimeChecks, value.verifyRuns, policy.criteria, policy.inferredReason, policy.evidence, policy.verify, policy.stopRules].every(Array.isArray)) return false;
	const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
	const criteria = (items: unknown): boolean => Array.isArray(items) && items.every((item) => acceptanceObject(item) && typeof item.id === "string" && typeof item.must === "string" && strings(item.evidence) && ["required", "recommended"].includes(String(item.severity)));
	return [value.inferredReason, policy.inferredReason, policy.evidence, policy.stopRules].every(strings)
		&& [value.criteria, policy.criteria].every(criteria)
		&& (value.runtimeChecks as unknown[]).every((check) => acceptanceObject(check) && typeof check.id === "string" && typeof check.message === "string" && ["passed", "failed", "not-applicable"].includes(String(check.status)))
		&& (value.verifyRuns as unknown[]).every((run) => acceptanceObject(run) && typeof run.id === "string" && typeof run.command === "string" && (run.exitCode === null || typeof run.exitCode === "number") && typeof run.durationMs === "number" && ["passed", "failed", "timed-out", "allowed-failure"].includes(String(run.status)))
		&& (policy.verify as unknown[]).every((command) => acceptanceObject(command) && typeof command.id === "string" && typeof command.command === "string");
}

function settledAcceptanceRow(row: Record<string, unknown>): boolean {
	if (row.detached === true || row.interrupted === true || row.paused === true) return false;
	for (const status of [row.state, row.status, acceptanceObject(row.execution) ? row.execution.status : undefined, acceptanceObject(row.progress) ? row.progress.status : undefined]) {
		if (status !== undefined && (typeof status !== "string" || !terminalMissionRunStatus(status))) return false;
	}
	return true;
}

function completionAcceptance(input: { source: "foreground" | "async"; runId: string; mode: unknown; results: unknown; workflowChildren?: unknown }): {
	hasExplicitProducer: boolean;
	producerRunId?: string;
	acceptance?: AcceptanceLedger;
} | undefined {
	if (!Array.isArray(input.results) || input.results.length > 1) return undefined;
	let inventory: ReturnType<typeof parseWorkflowChildSummary>;
	if (input.workflowChildren !== undefined) {
		try { inventory = parseWorkflowChildSummary(input.workflowChildren); } catch { return undefined; }
		if (!inventory || inventory.workflowRunId !== input.runId || !inventory.inventoryComplete || !["completed", "failed", "stopped"].includes(inventory.workflowState)
			|| inventory.children.some((child) => !["completed", "failed", "stopped", "rejected"].includes(child.state))) return undefined;
	}
	if (input.results.length === 0) {
		return input.mode === "workflow" && inventory?.children.length === 0 ? { hasExplicitProducer: false } : undefined;
	}
	// One final child and one actual ledger only; do not select among child results.
	if (inventory && inventory.children.length !== 1) return undefined;
	const row: unknown = input.results[0];
	if (!acceptanceObject(row) || !settledAcceptanceRow(row) || !finalRuntimeLedger(row.acceptance)) return undefined;
	const inventoryChild = inventory?.children[0];
	let producerRunId: string;
	if (input.mode === "single") producerRunId = input.runId;
	else if (input.mode === "workflow" && typeof row.runId === "string" && row.runId.trim()) producerRunId = row.runId;
	// Native foreground rows omit runId; only their exact key in the already
	// validated sole-child inventory can supply it. Never replace a present ID.
	else if (input.source === "foreground" && input.mode === "workflow" && !("runId" in row)
		&& typeof inventoryChild?.runId === "string" && inventoryChild.runId.trim() && row.workflowKey === inventoryChild.childId) producerRunId = inventoryChild.runId;
	else return undefined;
	if (inventory && ((inventory.children[0]?.runId !== undefined && inventory.children[0].runId !== producerRunId)
		|| (row.workflowKey !== undefined && row.workflowKey !== inventory.children[0]?.childId))) return undefined;
	const hasExplicitProducer = row.acceptance.explicit && row.acceptance.status !== "not-required";
	return { hasExplicitProducer, ...(hasExplicitProducer ? { acceptance: row.acceptance, producerRunId } : {}) };
}

/** The original published result retains acceptance; slim completion replay does not. */
function savedMissionCompletion(asyncDir: string, runId: string): Record<string, unknown> | undefined {
	try {
		const payloadPath = resultFilePath(DIRS.results, runId);
		// Read only the existing public file. Indexed lookup can promote pending
		// data as a side effect; receipt recovery must not publish anything.
		if (path.dirname(path.resolve(payloadPath)) !== path.resolve(DIRS.results)) return undefined;
		const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")) as Record<string, unknown>;
		if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload.runId ?? payload.id) !== runId || typeof payload.asyncDir !== "string" || path.resolve(payload.asyncDir) !== path.resolve(asyncDir)) return undefined;
		return typeof payload.state === "string" && terminalMissionRunStatus(payload.state) && completionAcceptance({ source: "async", runId, mode: payload.mode, results: payload.results, workflowChildren: payload.workflowChildren }) ? payload : undefined;
	} catch {
		// The watcher may already have consumed the payload. Status/summary/slim
		// replay cannot resolve producer identity: leave the launch unknown.
		return undefined;
	}
}

function usageForResult(result: AgentToolResult<Details>): { tokens: number } | undefined {
	const tokens = result.details.results.reduce((total, child) => total + child.usage.input + child.usage.output, 0);
	return tokens > 0 ? { tokens } : undefined;
}

function usageFromUnknown(value: unknown): { tokens: number } | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const total = (value as { total?: unknown }).total;
	return Number.isSafeInteger(total) && (total as number) >= 0 ? { tokens: total as number } : undefined;
}

function artifactsForResult(result: AgentToolResult<Details>): MissionArtifact[] {
	const artifacts: MissionArtifact[] = [];
	if (result.details.asyncDir) {
		artifacts.push(
			{ kind: "status", path: path.join(result.details.asyncDir, "status.json") },
			{ kind: "other", path: path.join(result.details.asyncDir, "events.jsonl"), description: "Lifecycle events" },
		);
	}
	for (const child of result.details.results) {
		if (child.artifactPaths?.outputPath) artifacts.push({ kind: "output", path: child.artifactPaths.outputPath });
		if (child.savedOutputPath) artifacts.push({ kind: "output", path: child.savedOutputPath });
		if (child.transcriptPath) artifacts.push({ kind: "other", path: child.transcriptPath, description: "Child transcript" });
		if (child.structuredOutputPath) artifacts.push({ kind: "output", path: child.structuredOutputPath, description: "Structured output" });
	}
	if (result.details.parallelHandoff?.path) artifacts.push({ kind: "manifest", path: result.details.parallelHandoff.path });
	return artifacts;
}

function firstText(result: AgentToolResult<Details>): string | undefined {
	const text = result.content.find((item) => item.type === "text")?.text.trim();
	if (!text) return undefined;
	return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

function persistedBinding(binding: MissionLaunchBinding): PersistedMissionBinding {
	return {
		schemaVersion: 1,
		...(binding.acceptanceLaunchId ? { acceptanceLaunchId: binding.acceptanceLaunchId } : {}),
		missionId: binding.missionId,
		projectRoot: binding.location.projectRoot,
		missionDir: binding.location.missionDir,
		globalIndexDir: binding.location.globalIndexDir,
		writeGlobalIndex: binding.location.writeGlobalIndex,
		...(binding.location.retainTerminal !== undefined ? { retainTerminal: binding.location.retainTerminal } : {}),
		autoCreated: binding.autoCreated,
	};
}

export function writeMissionAsyncBinding(asyncDir: string, binding: MissionLaunchBinding): void {
	writePrivateAtomicJson(path.join(asyncDir, MISSION_BINDING_FILE), persistedBinding(binding));
}

export function attachMissionToLaunchResult(input: {
	binding: MissionLaunchBinding;
	result: AgentToolResult<Details>;
}): AgentToolResult<Details> {
	const runId = input.result.details.runId ?? input.result.details.asyncId;
	if (!runId) {
		const current = readMission(input.binding.location, input.binding.missionId);
		const activeRunExists = current.runs.some((run) => run.status === "active" || run.status === "queued" || run.status === "running");
		const mission = toolResultIsError(input.result)
			? updateMission(input.binding.location, input.binding.missionId, {
					status: current.goal ? current.status : activeRunExists ? "active" : "failed",
					...(!current.goal && firstText(input.result) ? { summary: firstText(input.result)! } : {}),
				})
			: current;
		return {
			...input.result,
			details: {
				...input.result.details,
				missionId: input.binding.missionId,
				missionPath: missionRecordPath(input.binding.location, input.binding.missionId),
				mission,
			},
		};
	}
	const runStatus = runStatusForResult(input.result);
	const current = readMission(input.binding.location, input.binding.missionId);
	const startedAt = new Date().toISOString();
	const usage = usageForResult(input.result);
	const run: MissionRunLink = {
		runId,
		mode: missionRunModeForResult(input.result.details.mode),
		status: runStatus,
		startedAt,
		...(input.result.details.asyncDir ? { asyncDir: input.result.details.asyncDir } : {}),
		...(input.result.details.results.length === 1 && input.result.details.results[0]?.agent ? { agent: input.result.details.results[0].agent } : {}),
		...(runStatus !== "active" ? { completedAt: startedAt } : {}),
		...(usage ? { usage } : {}),
		...(firstText(input.result) && runStatus !== "active" ? { summary: firstText(input.result)! } : {}),
	};
	const completion = !input.result.details.asyncDir && terminalMissionRunStatus(runStatus)
		? completionAcceptance({ source: "foreground", runId, mode: input.result.details.mode, results: input.result.details.results, workflowChildren: input.result.details.workflowChildren })
		: undefined;
	let mission = updateMission(input.binding.location, input.binding.missionId, {
		status: missionStatusForRun(current, runId, runStatus, missionAcceptanceStatus(input.result.details.results), input.binding.autoCreated),
		...(input.binding.acceptanceLaunchId ? { acceptanceLaunch: { launchId: input.binding.acceptanceLaunchId, runId } } : {}),
		addRuns: [run],
		addArtifacts: artifactsForResult(input.result),
		...(!current.goal && firstText(input.result) && runStatus !== "active" ? { summary: firstText(input.result)! } : {}),
		...(completion ? {
			...(completion.acceptance ? { acceptance: completion.acceptance } : {}),
			acceptanceCompletion: { launchId: input.binding.acceptanceLaunchId ?? "", runId, hasExplicitProducer: completion.hasExplicitProducer, producerRunId: completion.producerRunId },
		} : {}),
	});
	if (input.result.details.asyncDir) {
		writeMissionAsyncBinding(input.result.details.asyncDir, input.binding);
		const statusPath = path.join(input.result.details.asyncDir, "status.json");
		if (fs.existsSync(statusPath)) {
			try {
				const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as { state?: unknown; steps?: unknown };
				if (typeof status.state === "string" && !["queued", "running"].includes(status.state)) {
					mission = syncMissionFromAsyncCompletion(savedMissionCompletion(input.result.details.asyncDir, runId) ?? {
						runId,
						asyncDir: input.result.details.asyncDir,
						mode: input.result.details.mode,
						state: status.state,
						// A run that finished before this launch result was attached keeps its acceptance in the status steps.
						...(Array.isArray(status.steps) ? { results: status.steps.map((step) => ({ acceptance: (step as { acceptance?: unknown } | null)?.acceptance })) } : {}),
						...(firstText(input.result) ? { summary: firstText(input.result) } : {}),
					}) ?? mission;
				}
			} catch (error) {
				throw new Error(`Failed to reconcile mission from terminal async status '${statusPath}': ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	const lastTextIndex = input.result.content.findLastIndex((item) => item.type === "text");
	const hasStructuredOutput = input.result.details.results.some((child) => child.structuredOutputPath !== undefined);
	const textIsJson = lastTextIndex >= 0 && (() => {
		try {
			JSON.parse((input.result.content[lastTextIndex] as { type: "text"; text: string }).text);
			return true;
		} catch {
			return false;
		}
	})();
	return {
		...input.result,
		content: input.binding.announceInContent === true && lastTextIndex >= 0 && !hasStructuredOutput && !textIsJson
			? input.result.content.map((item, index) => index === lastTextIndex && item.type === "text"
				? { ...item, text: `${item.text}\nMission: ${mission.id} (${mission.status})` }
				: item)
			: input.result.content,
		details: {
			...input.result.details,
			missionId: mission.id,
			missionPath: missionRecordPath(input.binding.location, mission.id),
			mission,
		},
	};
}

function parsePersistedBinding(value: unknown, source: string): MissionLaunchBinding {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
	const input = value as Record<string, unknown>;
	if (input.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
	for (const field of ["projectRoot", "missionDir", "globalIndexDir"] as const) {
		if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`${source}.${field} must be a non-empty string`);
	}
	if (typeof input.writeGlobalIndex !== "boolean") throw new Error(`${source}.writeGlobalIndex must be boolean`);
	if (input.retainTerminal !== undefined && (!Number.isInteger(input.retainTerminal) || (input.retainTerminal as number) < 1)) throw new Error(`${source}.retainTerminal must be a positive integer`);
	if (input.autoCreated !== undefined && typeof input.autoCreated !== "boolean") throw new Error(`${source}.autoCreated must be boolean`);
	return {
		...(typeof input.acceptanceLaunchId === "string" ? { acceptanceLaunchId: input.acceptanceLaunchId } : {}),
		missionId: validateMissionId(input.missionId, `${source}.missionId`),
		// Bindings saved before this field existed belong to runs that completed their mission without an acceptance check.
		autoCreated: input.autoCreated !== false,
		location: {
			projectRoot: input.projectRoot as string,
			missionDir: input.missionDir as string,
			globalIndexDir: input.globalIndexDir as string,
			writeGlobalIndex: input.writeGlobalIndex,
			...(input.retainTerminal !== undefined ? { retainTerminal: input.retainTerminal as number } : {}),
		},
	};
}

export function readMissionBinding(asyncDir: string): MissionLaunchBinding | undefined {
	const bindingPath = path.join(asyncDir, MISSION_BINDING_FILE);
	if (!fs.existsSync(bindingPath)) return undefined;
	const raw = fs.readFileSync(bindingPath, "utf-8");
	try {
		return parsePersistedBinding(JSON.parse(raw), bindingPath);
	} catch (error) {
		throw new Error(`Invalid mission binding file '${bindingPath}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}

export function syncMissionFromAsyncCompletion(value: unknown): MissionRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const event = value as Record<string, unknown>;
	if (typeof event.asyncDir !== "string" || !event.asyncDir.trim()) return undefined;
	const binding = readMissionBinding(event.asyncDir);
	if (!binding) return undefined;
	const runId = typeof event.runId === "string" ? event.runId : typeof event.id === "string" ? event.id : undefined;
	if (!runId) throw new Error("Async mission completion is missing runId");
	const runStatus = typeof event.state === "string" ? event.state : event.success === true ? "completed" : "failed";
	let current: MissionRecord;
	try {
		current = readMission(binding.location, binding.missionId);
	} catch (error) {
		if (!(error instanceof MissionNotFoundError)) throw error;
		const reason = "mission-record-missing";
		const markerId = createHash("sha256").update(JSON.stringify([runId, binding.missionId, reason])).digest("hex");
		const markerPath = path.join(event.asyncDir, `.mission-sync-skipped-${markerId}.json`);
		try {
			fs.writeFileSync(markerPath, `${JSON.stringify({ runId, missionId: binding.missionId, reason })}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
			fs.appendFileSync(path.join(event.asyncDir, "events.jsonl"), `${JSON.stringify({
				type: "subagent.mission.sync.skipped",
				ts: Date.now(),
				runId,
				missionId: binding.missionId,
				reason,
				missionPath: missionRecordPath(binding.location, binding.missionId),
			})}\n`, "utf-8");
		} catch {
			// Mission bookkeeping is secondary to preserving the completed async result.
		}
		return undefined;
	}
	const completedAt = new Date().toISOString();
	const artifacts: MissionArtifact[] = [
		{ kind: "status", path: path.join(event.asyncDir, "status.json") },
		{ kind: "other", path: path.join(event.asyncDir, "events.jsonl"), description: "Lifecycle events" },
	];
	if (event.parallelHandoff && typeof event.parallelHandoff === "object" && typeof (event.parallelHandoff as { path?: unknown }).path === "string") {
		artifacts.push({ kind: "manifest", path: (event.parallelHandoff as { path: string }).path });
	}
	if (Array.isArray(event.results)) {
		for (const result of event.results) {
			if (!result || typeof result !== "object") continue;
			const child = result as Record<string, unknown>;
			if (typeof child.artifactPath === "string") artifacts.push({ kind: "output", path: child.artifactPath });
			if (child.artifactPaths && typeof child.artifactPaths === "object" && typeof (child.artifactPaths as { outputPath?: unknown }).outputPath === "string") {
				artifacts.push({ kind: "output", path: (child.artifactPaths as { outputPath: string }).outputPath });
			}
		}
	}
	const summary = typeof event.summary === "string" && event.summary.trim() ? event.summary.slice(0, 2000) : undefined;
	const usage = usageFromUnknown(event.totalTokens)
		?? (Array.isArray(event.results)
			? { tokens: event.results.reduce((total, result) => {
				if (!result || typeof result !== "object") return total;
				return total + (usageFromUnknown((result as { tokens?: unknown }).tokens)?.tokens ?? 0);
			}, 0) }
			: undefined);
	const workflowRunId = typeof event.parentWorkflowRunId === "string" && event.parentWorkflowRunId.trim() ? event.parentWorkflowRunId.trim() : undefined;
	const workflowKey = typeof event.workflowKey === "string" && event.workflowKey.trim() ? event.workflowKey.trim() : undefined;
	const workflowChildStatus = runStatus === "complete" || runStatus === "completed" || event.success === true
		? "completed"
		: runStatus === "paused"
			? "paused"
			: runStatus === "stopped"
				? "stopped"
				: "failed";
	const workflowChildTerminal = !["running", "queued", "active", "paused"].includes(workflowChildStatus);
	// This slice has no multi-producer aggregation policy. Missing or ambiguous
	// evidence leaves the recorded ledger untouched, regardless of run success.
	const completion = typeof event.state === "string" && terminalMissionRunStatus(event.state)
		? completionAcceptance({ source: "async", runId, mode: event.mode, results: event.results, workflowChildren: event.workflowChildren })
		: undefined;
	const acceptanceStatus = missionAcceptanceStatus(event.results);
	return updateMission(binding.location, binding.missionId, {
		status: missionStatusForRun(current, runId, runStatus, acceptanceStatus, binding.autoCreated),
		addRuns: [{ runId, mode: typeof event.mode === "string" && ["single", "parallel", "chain", "workflow"].includes(event.mode) ? event.mode as SubagentRunMode : "external", asyncDir: event.asyncDir, status: runStatus, completedAt, ...(summary ? { summary } : {}), ...(usage && usage.tokens > 0 ? { usage } : {}) }],
		addArtifacts: artifacts,
		...(completion ? {
			...(completion.acceptance ? { acceptance: completion.acceptance } : {}),
			acceptanceCompletion: { launchId: binding.acceptanceLaunchId ?? "", runId, hasExplicitProducer: completion.hasExplicitProducer, producerRunId: completion.producerRunId },
		} : {}),
		...(workflowRunId && workflowKey ? { upsertWorkflowChildren: [{
			workflowRunId,
			key: workflowKey,
			runId,
			status: workflowChildStatus,
			artifactPaths: artifacts.map((artifact) => artifact.path),
			...(workflowChildTerminal ? { completedAt } : {}),
			...(acceptanceStatus ? { acceptanceStatus } : {}),
			heartbeat: { status: workflowChildStatus, ...(summary ? { message: summary } : {}) },
		}] } : {}),
		...(!current.goal && summary ? { summary } : {}),
	});
}
