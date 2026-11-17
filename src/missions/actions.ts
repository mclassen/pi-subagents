import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Details } from "../shared/types.ts";
import {
	MISSION_STATUSES,
	GOAL_MAX_STALLED_ITERATIONS,
	type MissionArtifact,
	type MissionArtifactKind,
	type MissionGoalProgress,
	type MissionReceipt,
	type MissionReceiptKind,
	type MissionReceiptStatus,
	type MissionRecord,
	type MissionRunMode,
	type MissionStatus,
	type MissionStoreConfig,
	type MissionStoreLocation,
	type MissionUpdateInput,
} from "./types.ts";
import { missionStatePath } from "./workflow-state.ts";
import { finishedMissionStatus, missionAcceptanceStatus, readMissionBinding } from "./lifecycle.ts";
import {
	createMission,
	createSessionGoal,
	listGlobalMissions,
	listMissions,
	missionRecordPath,
	readMission,
	resolveMissionStoreLocation,
	updateMission,
	validateMissionId,
} from "./store.ts";

export const MISSION_ACTIONS = [
	"mission.create",
	"mission.list",
	"mission.show",
	"mission.update",
	"mission.resolve-decision",
	"mission.attach-run",
	"mission.close",
] as const;

export type MissionAction = typeof MISSION_ACTIONS[number];

export interface MissionLaunchInput {
	title: string;
	objective?: string;
	goal?: true;
	maxIterations?: number;
	labels?: string[];
}

export interface MissionUpdateToolInput {
	title?: string;
	objective?: string;
	goal?: boolean | { paused?: boolean; maxIterations?: number; iterationsStarted?: number; iterationActive?: boolean; iteration?: "begin" | "complete"; progress?: MissionGoalProgress };
	status?: MissionStatus;
	summary?: string;
	labels?: string[];
	artifacts?: MissionArtifact[];
	receipts?: Array<Omit<MissionReceipt, "createdAt">>;
	decisions?: Array<{
		title: string;
		prompt?: string;
		options?: string[];
		recommendation?: string;
	}>;
}

export interface MissionActionParams {
	missionId?: string;
	mission?: unknown;
	missionUpdate?: unknown;
	missionStatus?: string;
	missionScope?: string;
	id?: string;
	runId?: string;
	dir?: string;
	runMode?: string;
	runStatus?: string;
	agent?: string;
	summary?: string;
}

interface MissionActionContext {
	cwd: string;
	currentSessionId?: string;
	beforeMissionShowRefresh?: () => void;
	config?: MissionStoreConfig;
	agentDir?: string;
}

function textResult(text: string, details: Details): AgentToolResult<Details> {
	return { content: [{ type: "text", text }], details };
}

function requireMissionId(params: MissionActionParams): string {
	return validateMissionId(params.missionId, "missionId");
}

function validateStatus(value: unknown, label: string): MissionStatus {
	if (typeof value !== "string" || !(MISSION_STATUSES as readonly string[]).includes(value)) {
		throw new Error(`${label} must be one of ${MISSION_STATUSES.join(", ")}`);
	}
	return value as MissionStatus;
}

export function validateMissionLaunch(value: unknown): MissionLaunchInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mission must be an object");
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (key !== "title" && key !== "summary" && key !== "objective" && key !== "goal" && key !== "maxIterations" && key !== "labels") throw new Error(`mission.${key} is unknown`);
	}
	if (input.title !== undefined && input.summary !== undefined) throw new Error("mission.title and mission.summary cannot both be set");
	const title = input.title ?? input.summary;
	if (typeof title !== "string" || !title.trim()) throw new Error("mission.title or mission.summary must be a non-empty string");
	if (input.objective !== undefined && (typeof input.objective !== "string" || !input.objective.trim())) throw new Error("mission.objective must be a non-empty string");
	if (input.goal !== undefined && input.goal !== true) throw new Error("mission.goal must be true when supplied");
	if (input.maxIterations !== undefined && (input.goal !== true || !Number.isSafeInteger(input.maxIterations) || (input.maxIterations as number) < 1)) {
		throw new Error("mission.maxIterations requires goal: true and a positive integer");
	}
	if (input.labels !== undefined && (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string" || !label.trim()))) {
		throw new Error("mission.labels must contain only non-empty strings");
	}
	return {
		title: title.trim(),
		...(typeof input.objective === "string" ? { objective: input.objective.trim() } : {}),
		...(input.goal === true ? { goal: true as const } : {}),
		...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations as number } : {}),
		...(input.labels !== undefined ? { labels: input.labels.map((label) => label.trim()) } : {}),
	};
}

function validateArtifact(value: unknown, index: number): MissionArtifact {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`missionUpdate.artifacts[${index}] must be an object`);
	const input = value as Record<string, unknown>;
	const kinds: MissionArtifactKind[] = ["status", "output", "patch", "manifest", "review", "note", "other"];
	if (typeof input.kind !== "string" || !kinds.includes(input.kind as MissionArtifactKind)) throw new Error(`missionUpdate.artifacts[${index}].kind is invalid`);
	if (typeof input.path !== "string" || !input.path.trim()) throw new Error(`missionUpdate.artifacts[${index}].path must be a non-empty string`);
	if (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim())) throw new Error(`missionUpdate.artifacts[${index}].description must be a non-empty string`);
	return {
		kind: input.kind as MissionArtifactKind,
		path: input.path,
		...(typeof input.description === "string" ? { description: input.description } : {}),
	};
}

function validateReceipt(value: unknown, index: number): Omit<MissionReceipt, "createdAt"> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`missionUpdate.receipts[${index}] must be an object`);
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (!['kind', 'status', 'title', 'url', 'description'].includes(key)) throw new Error(`missionUpdate.receipts[${index}].${key} is unknown`);
	}
	const kinds: MissionReceiptKind[] = ["pull_request", "ci", "deployment", "release"];
	const statuses: MissionReceiptStatus[] = ["pending", "ready", "succeeded", "failed"];
	if (typeof input.kind !== "string" || !kinds.includes(input.kind as MissionReceiptKind)) throw new Error(`missionUpdate.receipts[${index}].kind is invalid`);
	if (typeof input.status !== "string" || !statuses.includes(input.status as MissionReceiptStatus)) throw new Error(`missionUpdate.receipts[${index}].status is invalid`);
	for (const field of ["title", "url"] as const) {
		if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`missionUpdate.receipts[${index}].${field} must be a non-empty string`);
	}
	try {
		new URL(input.url as string);
	} catch {
		throw new Error(`missionUpdate.receipts[${index}].url must be an absolute URL`);
	}
	if (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim())) throw new Error(`missionUpdate.receipts[${index}].description must be a non-empty string`);
	return {
		kind: input.kind as MissionReceiptKind,
		status: input.status as MissionReceiptStatus,
		title: (input.title as string).trim(),
		url: (input.url as string).trim(),
		...(typeof input.description === "string" ? { description: input.description.trim() } : {}),
	};
}

function validateMissionUpdate(value: unknown): MissionUpdateInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missionUpdate must be an object");
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (!["title", "objective", "goal", "status", "summary", "labels", "artifacts", "receipts", "decisions"].includes(key)) throw new Error(`missionUpdate.${key} is unknown`);
	}
	const update: MissionUpdateInput = {};
	for (const field of ["title", "objective", "summary"] as const) {
		const candidate = input[field];
		if (candidate === undefined) continue;
		if (typeof candidate !== "string" || !candidate.trim()) throw new Error(`missionUpdate.${field} must be a non-empty string`);
		update[field] = candidate.trim();
	}
	if (input.goal !== undefined) {
		if (typeof input.goal === "boolean") update.goal = input.goal ? { status: "active" } : false;
		else {
			if (!input.goal || typeof input.goal !== "object" || Array.isArray(input.goal)) throw new Error("missionUpdate.goal must be boolean or an iteration-control object");
			const goal = input.goal as Record<string, unknown>;
			if (!Object.keys(goal).length || Object.keys(goal).some((key) => !["paused", "maxIterations", "iterationsStarted", "iterationActive", "iteration", "progress"].includes(key))) throw new Error("missionUpdate.goal contains unknown or no controls");
			if (goal.paused !== undefined && typeof goal.paused !== "boolean") throw new Error("missionUpdate.goal.paused must be boolean");
			for (const key of ["maxIterations", "iterationsStarted"] as const) {
				if (goal[key] !== undefined && (!Number.isSafeInteger(goal[key]) || (goal[key] as number) < (key === "maxIterations" ? 1 : 0))) throw new Error(`missionUpdate.goal.${key} is invalid`);
			}
			if (goal.iterationActive !== undefined && typeof goal.iterationActive !== "boolean") throw new Error("missionUpdate.goal.iterationActive must be boolean");
			if (goal.iteration !== undefined && goal.iteration !== "begin" && goal.iteration !== "complete") throw new Error("missionUpdate.goal.iteration must be begin or complete");
			// The model must judge each completed iteration; that judgment drives the stall stop.
			if (goal.iteration === "complete" && goal.progress !== "advanced" && goal.progress !== "none") throw new Error('missionUpdate.goal.iteration "complete" requires progress: "advanced" (an acceptance criterion moved) or "none"');
			if (goal.iteration !== "complete" && goal.progress !== undefined) throw new Error("missionUpdate.goal.progress is reported only with iteration: complete");
			update.goal = {
				...(goal.paused !== undefined ? { status: goal.paused ? "paused" as const : "active" as const } : {}),
				...(goal.maxIterations !== undefined ? { maxIterations: goal.maxIterations as number } : {}),
				...(goal.iterationsStarted !== undefined ? { iterationsStarted: goal.iterationsStarted as number } : {}),
				...(goal.iterationActive !== undefined ? { iterationActive: goal.iterationActive as boolean } : {}),
				...(goal.iteration !== undefined ? { iteration: goal.iteration as "begin" | "complete" } : {}),
				...(goal.progress !== undefined ? { progress: goal.progress as MissionGoalProgress } : {}),
			};
		}
		if (update.goal && update.goal.status === "active") update.status = "active";
	}
	if (input.status !== undefined) update.status = validateStatus(input.status, "missionUpdate.status");
	if (input.labels !== undefined) {
		if (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string" || !label.trim())) throw new Error("missionUpdate.labels must contain only non-empty strings");
		update.labels = input.labels as string[];
	}
	if (input.artifacts !== undefined) {
		if (!Array.isArray(input.artifacts)) throw new Error("missionUpdate.artifacts must be an array");
		update.addArtifacts = input.artifacts.map(validateArtifact);
	}
	if (input.receipts !== undefined) {
		if (!Array.isArray(input.receipts)) throw new Error("missionUpdate.receipts must be an array");
		update.addReceipts = input.receipts.map(validateReceipt);
	}
	if (input.decisions !== undefined) {
		if (!Array.isArray(input.decisions)) throw new Error("missionUpdate.decisions must be an array");
		update.addDecisions = input.decisions.map((value, index) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`missionUpdate.decisions[${index}] must be an object`);
			const decision = value as Record<string, unknown>;
			if (typeof decision.title !== "string" || !decision.title.trim()) throw new Error(`missionUpdate.decisions[${index}].title must be a non-empty string`);
			if (decision.options !== undefined && (!Array.isArray(decision.options) || decision.options.some((option) => typeof option !== "string" || !option.trim()))) throw new Error(`missionUpdate.decisions[${index}].options must contain only non-empty strings`);
			return {
				title: decision.title.trim(),
				...(typeof decision.prompt === "string" && decision.prompt.trim() ? { prompt: decision.prompt } : {}),
				...(Array.isArray(decision.options) ? { options: decision.options as string[] } : {}),
				...(typeof decision.recommendation === "string" && decision.recommendation.trim() ? { recommendation: decision.recommendation } : {}),
			};
		});
	}
	if (Object.keys(update).length === 0) throw new Error("missionUpdate must include at least one supported field");
	return update;
}

const STOPPED_GOAL_RUN_STATUSES = new Set(["stopped", "cancelled", "rejected"]);

function refreshLinkedRunStatus(location: MissionStoreLocation, record: MissionRecord, ownerSessionId?: string): { record: MissionRecord; warnings: string[] } {
	const warnings: string[] = [];
	const runAcceptance: Array<{ runId: string; status: string | undefined }> = [];
	const updates = record.runs.flatMap((run) => {
		if (!run.asyncDir) return [];
		const statusPath = path.join(run.asyncDir, "status.json");
		if (!fs.existsSync(statusPath)) return [];
		let status: unknown;
		try {
			status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
		} catch (error) {
			warnings.push(`Failed to read linked run status '${statusPath}': ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
		if (!status || typeof status !== "object" || Array.isArray(status)) {
			warnings.push(`Linked run status '${statusPath}' must be an object`);
			return [];
		}
		const state = (status as { state?: unknown }).state;
		if (typeof state !== "string" || !state.trim()) {
			warnings.push(`Linked run status '${statusPath}' is missing state`);
			return [];
		}
		runAcceptance.push({ runId: run.runId, status: missionAcceptanceStatus((status as { steps?: unknown }).steps) });
		if (state === run.status) return [];
		return [{
			...run,
			status: state,
			...(!["queued", "running"].includes(state) && !run.completedAt ? { completedAt: new Date().toISOString() } : {}),
		}];
	});
	const merged = record.runs.map((run) => updates.find((update) => update.runId === run.runId && update.childIndex === run.childIndex) ?? run);
	const states = merged.map((run) => run.status);
	const latestRunStopped = !!record.goal && STOPPED_GOAL_RUN_STATUSES.has(merged.at(-1)?.status ?? "");
	if (updates.length === 0 && !latestRunStopped) return { record, warnings };
	const preserveParentStatus = record.goal?.status === "paused"
		|| record.status === "waiting"
		|| record.status === "needs_decision"
		|| record.status === "completed"
		|| record.status === "failed"
		|| record.status === "cancelled";
	const status: MissionStatus = latestRunStopped
		? preserveParentStatus ? record.status : "waiting"
		: record.status === "completed" || record.status === "failed" || record.status === "cancelled"
			? record.status
			: record.goal && !states.some((state) => state === "queued" || state === "running" || state === "active")
			? "active"
			: states.some((state) => state === "queued" || state === "running" || state === "active")
			? "active"
			: states.some((state) => state === "paused")
				? "waiting"
				: states.some((state) => state === "failed")
					? "failed"
					: states.some((state) => state === "stopped" || state === "rejected" || state === "cancelled")
						? "cancelled"
						: states.length > 0 && states.every((state) => state === "complete" || state === "completed")
							// A run without a binding counts as auto-created.
							? finishedMissionStatus(record, !merged.some((run) => run.asyncDir && readMissionBinding(run.asyncDir)?.autoCreated === false), runAcceptance)
							: record.status;
	if (updates.length === 0 && status === record.status) return { record, warnings };
	return { record: updateMission(location, record.id, { status, addRuns: updates, expectedGoalOwnerSessionId: ownerSessionId }), warnings };
}

function formatMission(record: MissionRecord): string {
	const lines = [
		`Mission: ${record.id}`,
		`Title: ${record.title}`,
		`Status: ${record.status}`,
		`Objective: ${record.objective}`,
		`Updated: ${record.updatedAt}`,
	];
	if (record.goal) lines.push(`Goal mode: ${record.goal.status}`);
	if (record.goal) lines.push(record.goal.maxIterations === undefined
		? "Goal iterations: reconcile the existing limit and count before continuing"
		: `Goal iterations: ${record.goal.iterationsStarted}/${record.goal.maxIterations}${record.goal.iterationActive ? " (iteration active)" : ""}`);
	if (record.goal?.stalledIterations) lines.push(record.goal.stalledIterations >= GOAL_MAX_STALLED_ITERATIONS
		? `Goal stalled: ${record.goal.stalledIterations} consecutive iterations without progress; paused. Report one consolidated diagnosis and the single decision needed.`
		: `Goal no-progress iterations: ${record.goal.stalledIterations}/${GOAL_MAX_STALLED_ITERATIONS}; the next iteration needs a different hypothesis.`);
	if (record.summary) lines.push(`Summary: ${record.summary}`);
	if (record.labels?.length) lines.push(`Labels: ${record.labels.join(", ")}`);
	if (record.runs.length) {
		lines.push("Runs:");
		for (const run of record.runs) lines.push(`  ${run.runId} (${run.mode}${run.status ? `, ${run.status}` : ""})${run.asyncDir ? ` — ${run.asyncDir}` : ""}`);
	}
	if (record.workflowChildren.length) {
		lines.push("Workflow children:");
		for (const child of record.workflowChildren) {
			const identity = child.runId ? `${child.key} (${child.runId})` : child.key;
			const heartbeat = child.heartbeat ? `; heartbeat ${child.heartbeat.status ?? child.status}${child.heartbeat.phase ? `/${child.heartbeat.phase}` : ""} at ${child.heartbeat.updatedAt}` : "";
			const recovery = child.sessionPath ? `; session ${child.sessionPath}` : child.artifactPaths.length ? `; artifacts ${child.artifactPaths.length}` : "";
			const acceptance = child.acceptanceStatus ? `; acceptance ${child.acceptanceStatus}` : "";
			lines.push(`  ${identity}: ${child.status}${child.agent ? ` — ${child.agent}` : ""}${child.phase ? ` [${child.phase}]` : ""}${acceptance}; updated ${child.updatedAt}${heartbeat}${recovery}`);
		}
	}
	if (record.decisions.length) {
		lines.push("Decisions:");
		for (const decision of record.decisions) {
			lines.push(`  ${decision.id}: ${decision.status} — ${decision.title}${decision.resolution ? `; resolution: ${decision.resolution}` : ""}`);
		}
	}
	if (record.artifacts.length) {
		lines.push("Artifacts:");
		for (const artifact of record.artifacts) lines.push(`  ${artifact.kind}: ${artifact.path}`);
	}
	if (record.receipts.length) {
		lines.push("Delivery receipts:");
		for (const receipt of record.receipts) lines.push(`  ${receipt.kind} (${receipt.status}): ${receipt.title} — ${receipt.url}`);
	}
	return lines.join("\n");
}

export function handleMissionAction(
	action: MissionAction,
	params: MissionActionParams,
	ctx: MissionActionContext,
): AgentToolResult<Details> {
	const location = resolveMissionStoreLocation({
		projectRoot: ctx.cwd,
		...(ctx.config ? { config: ctx.config } : {}),
		...(ctx.agentDir ? { agentDir: ctx.agentDir } : {}),
	});
	if (action === "mission.create") {
		const mission = validateMissionLaunch(params.mission);
		if (mission.goal && !ctx.currentSessionId) throw new Error("Creating a goal mission requires a current session");
		const record = (mission.goal ? createSessionGoal : createMission)(location, {
			title: mission.title,
			objective: mission.objective ?? mission.title,
			...(mission.goal === true ? { goal: true as const } : {}),
			...(mission.maxIterations !== undefined ? { maxIterations: mission.maxIterations } : {}),
			status: params.missionStatus ? validateStatus(params.missionStatus, "missionStatus") : "planned",
			...(mission.labels ? { labels: mission.labels } : {}),
			...(ctx.currentSessionId ? { ownerSessionId: ctx.currentSessionId } : {}),
		}, new Date());
		return textResult(`Created mission ${record.id}: ${record.title}`, { mode: "management", results: [], missionId: record.id, missionPath: pathFor(record.id), mission: record });
	}
	if (action === "mission.list") {
		if (params.missionScope !== undefined && params.missionScope !== "project" && params.missionScope !== "global") {
			throw new Error("missionScope must be \"project\" or \"global\"");
		}
		if (params.missionScope === "global") {
			const listed = listGlobalMissions(location.globalIndexDir);
			const lines = listed.entries.length === 0
				? ["No indexed missions."]
				: listed.entries.map((entry) => `${entry.missionId}  ${entry.status}${entry.stale ? " [stale]" : ""}  ${entry.title}  ${entry.projectRoot}`);
			if (listed.warnings.length) lines.push("", ...listed.warnings.map((warning) => `Warning: ${warning}`));
			return textResult(lines.join("\n"), { mode: "management", results: [], missions: { globalEntries: listed.entries, warnings: listed.warnings } });
		}
		const listed = listMissions(location);
		const visibleRecords = listed.records.filter((record) => !record.goal || (!!ctx.currentSessionId && record.ownerSessionId === ctx.currentSessionId));
		const lines = visibleRecords.length === 0
			? ["No project missions."]
			: visibleRecords.map((record) => {
				const open = record.decisions.filter((decision) => decision.status === "open").length;
				const resolved = record.decisions.length - open;
				return `${record.id}  ${record.status}  ${record.title}  ${record.updatedAt}${record.decisions.length ? `  decisions: ${open} open, ${resolved} resolved` : ""}`;
			});
		if (listed.warnings.length) lines.push("", ...listed.warnings.map((warning) => `Warning: ${warning}`));
		return textResult(lines.join("\n"), { mode: "management", results: [], missions: { records: visibleRecords, warnings: listed.warnings } });
	}
	if (action === "mission.show") {
		const record = readMission(location, requireMissionId(params));
		ctx.beforeMissionShowRefresh?.();
		const foreignGoal = !!record.goal && (!ctx.currentSessionId || record.ownerSessionId !== ctx.currentSessionId);
		const refreshed = foreignGoal ? { record, warnings: [] as string[] } : refreshLinkedRunStatus(location, record, ctx.currentSessionId);
		const lines = [formatMission(refreshed.record), `State: ${missionStatePath(location, refreshed.record.id)}`];
		if (foreignGoal) lines.push("Ownership: read-only; goal belongs to a different or unknown session.");
		if (refreshed.warnings.length) lines.push("", ...refreshed.warnings.map((warning) => `Warning: ${warning}`));
		return textResult(lines.join("\n"), {
			mode: "management",
			results: [],
			missionId: refreshed.record.id,
			missionPath: pathFor(refreshed.record.id),
			mission: refreshed.record,
			missions: { warnings: refreshed.warnings },
		});
	}
	if (action === "mission.update") {
		const update = validateMissionUpdate(params.missionUpdate);
		const record = updateMission(location, requireMissionId(params), { ...update, expectedGoalOwnerSessionId: ctx.currentSessionId });
		return textResult(`Updated mission ${record.id}.\n\n${formatMission(record)}`, { mode: "management", results: [], missionId: record.id, missionPath: pathFor(record.id), mission: record });
	}
	if (action === "mission.resolve-decision") {
		const missionId = requireMissionId(params);
		const decisionId = validateMissionId(params.id, "id");
		if (typeof params.summary !== "string" || !params.summary.trim()) throw new Error("mission.resolve-decision requires a non-empty summary");
		const record = updateMission(location, missionId, { resolveDecision: { id: decisionId, resolution: params.summary.trim() }, expectedGoalOwnerSessionId: ctx.currentSessionId });
		return textResult(`Resolved decision ${decisionId} for mission ${record.id}.\n\n${formatMission(record)}`, { mode: "management", results: [], missionId: record.id, missionPath: pathFor(record.id), mission: record });
	}
	if (action === "mission.attach-run") {
		const missionId = requireMissionId(params);
		const runId = params.runId ?? params.id;
		if (typeof runId !== "string" || !runId.trim()) throw new Error("mission.attach-run requires runId or id");
		const rawMode = params.runMode ?? "external";
		if (!["single", "parallel", "chain", "workflow", "scheduled", "external"].includes(rawMode)) throw new Error("runMode is invalid");
		const mode = rawMode as MissionRunMode;
		if (params.dir !== undefined && !params.dir.trim()) throw new Error("dir must be a non-empty string");
		if (params.runStatus !== undefined && !params.runStatus.trim()) throw new Error("runStatus must be a non-empty string");
		const record = updateMission(location, missionId, {
			expectedGoalOwnerSessionId: ctx.currentSessionId,
			status: "active",
			addRuns: [{
				runId: runId.trim(),
				mode,
				...(params.dir ? { asyncDir: params.dir } : {}),
				...(params.agent ? { agent: params.agent } : {}),
				...(params.runStatus ? { status: params.runStatus } : {}),
				startedAt: new Date().toISOString(),
			}],
		});
		return textResult(`Attached run ${runId} to mission ${record.id}.`, { mode: "management", results: [], missionId: record.id, missionPath: pathFor(record.id), mission: record });
	}
	const missionId = requireMissionId(params);
	const status = params.missionStatus ?? "completed";
	if (status !== "completed" && status !== "failed" && status !== "cancelled") throw new Error("mission.close missionStatus must be completed, failed, or cancelled");
	if (params.summary !== undefined && !params.summary.trim()) throw new Error("summary must be a non-empty string");
	const record = updateMission(location, missionId, {
		expectedGoalOwnerSessionId: ctx.currentSessionId,
		status,
		...(params.summary !== undefined ? { summary: params.summary.trim() } : {}),
	});
	return textResult(`Closed mission ${record.id} as ${record.status}.`, { mode: "management", results: [], missionId: record.id, missionPath: pathFor(record.id), mission: record });

	function pathFor(missionId: string): string {
		return missionRecordPath(location, missionId);
	}
}
