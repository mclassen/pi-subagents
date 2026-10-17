import { randomUUID } from "node:crypto";
import type {
	SubagentDelegationRequest,
	SubagentDelegationResponse,
	SubagentDelegationThinking,
	SubagentDelegationUsage,
} from "./delegation.ts";

export type FastWorkProfile = "normal" | "fast" | "deep";
export type FastWorkRole = "ORCHESTRATOR" | "WORKER_STANDARD" | "WORKER_STRONG";
export interface FastWorkModel {
	model: string;
	thinking: "medium" | "high";
}
export type FastWorkRoles = Record<FastWorkRole, FastWorkModel>;
export const DEFAULT_FAST_WORK_ROLES = {
	ORCHESTRATOR: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" },
	WORKER_STANDARD: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" },
	WORKER_STRONG: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" },
} as const satisfies Readonly<Record<FastWorkRole, Readonly<FastWorkModel>>>;

export interface FastWorkRegistryModel {
	provider: string;
	id: string;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<SubagentDelegationThinking, string | null>>;
}

export interface FastWorkTask {
	id: string;
	dependsOn: string[];
	goal: string;
	context: string;
	inputs: string[];
	acceptance: string;
	nonGoals: string[];
	role: "WORKER_STANDARD" | "WORKER_STRONG";
	/** Strong workers require a concrete insufficiency or correctness reason. */
	escalationReason?: string;
	/** Explicit caller selection wins over role defaults. No fuzzy/provider fallback. */
	model?: string;
	thinking?: "medium" | "high";
}

export type FastWorkTaskState = "pending" | "running" | "awaiting_acceptance" | "accepted" | "failed" | "rejected" | "cancelled" | "blocked";
export interface FastWorkTaskResult {
	id: string;
	state: FastWorkTaskState;
	response?: SubagentDelegationResponse;
	error?: string;
}
export interface FastWorkTaskMetrics {
	index: number;
	dependencies: number[];
	role: FastWorkTask["role"];
	model: string;
	thinking: string;
	state: FastWorkTaskState;
	dispatchMs?: number;
	terminalMs?: number;
	usage?: SubagentDelegationUsage;
}
export interface FastWorkMetrics {
	version: 1;
	ownerRunId: string;
	profile: FastWorkProfile;
	elapsedMs: number;
	peakActive: number;
	tasks: FastWorkTaskMetrics[];
}
export type FastWorkDelegate = (request: SubagentDelegationRequest, signal: AbortSignal) => Promise<SubagentDelegationResponse>;

interface Node {
	task: FastWorkTask;
	selection: FastWorkModel;
	state: FastWorkTaskState;
	response?: SubagentDelegationResponse;
	error?: string;
	acceptedSummary?: string;
	dispatchMs?: number;
	terminalMs?: number;
}

export function resolveFastWorkModel(selection: FastWorkModel, models: readonly FastWorkRegistryModel[]): FastWorkModel {
	const model = models.find((entry) => `${entry.provider}/${entry.id}` === selection.model);
	if (!model) throw new Error(`Fast-work model is unavailable in the live registry: ${selection.model}`);
	if (model.reasoning !== true || model.thinkingLevelMap?.[selection.thinking] === null) {
		throw new Error(`Fast-work thinking level is unsupported: ${selection.model}:${selection.thinking}`);
	}
	return { ...selection };
}

function boundedText(value: string, field: string): void {
	if (!value.trim() || value.includes("\0") || Buffer.byteLength(value, "utf8") > 8_192) {
		throw new Error(`${field} must contain 1–8192 UTF-8 bytes without NUL.`);
	}
}

/** Policy only: the delegate remains the existing pi-subagents owned-leaf runner. */
export class FastWorkPlan {
	readonly ownerRunId = randomUUID();
	private readonly profile: FastWorkProfile;
	private readonly cwd: string;
	private readonly agent: string;
	private readonly nodes: Map<string, Node>;
	private readonly now: () => number;
	private readonly createdAt: number;
	private busy = false;
	private peakActive = 0;

	constructor(options: {
		profile: FastWorkProfile;
		cwd: string;
		agent: string;
		tasks: readonly FastWorkTask[];
		models: readonly FastWorkRegistryModel[];
		roles?: FastWorkRoles;
		now?: () => number;
	}) {
		if (!["normal", "fast", "deep"].includes(options.profile)) throw new Error("Unknown fast-work profile.");
		if (!options.tasks.length || options.tasks.length > 16) throw new Error("Fast-work supports 1–16 tasks.");
		boundedText(options.cwd, "cwd");
		boundedText(options.agent, "agent");
		this.profile = options.profile;
		this.cwd = options.cwd;
		this.agent = options.agent;
		this.now = options.now ?? (() => performance.now());
		this.createdAt = this.now();
		this.nodes = new Map();
		for (const original of options.tasks) {
			const task = { ...original, dependsOn: [...original.dependsOn], inputs: [...original.inputs], nonGoals: [...original.nonGoals] };
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(task.id) || this.nodes.has(task.id)) throw new Error("Task IDs must be unique safe identifiers.");
			if (task.role !== "WORKER_STANDARD" && task.role !== "WORKER_STRONG") throw new Error("Unsupported worker role.");
			if (task.thinking !== undefined && task.thinking !== "medium" && task.thinking !== "high") throw new Error("Unsupported thinking level.");
			for (const field of ["goal", "context", "acceptance"] as const) boundedText(task[field], field);
			for (const field of ["inputs", "nonGoals"] as const) {
				if (task[field].length > 16) throw new Error(`${field} supports at most 16 entries.`);
				for (const entry of task[field]) boundedText(entry, field);
			}
			if (task.dependsOn.length > 16 || new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error("Invalid dependency list.");
			if (task.role === "WORKER_STRONG") boundedText(task.escalationReason ?? "", "escalationReason");
			const configured = (options.roles ?? DEFAULT_FAST_WORK_ROLES)[task.role];
			const selection = resolveFastWorkModel({ model: task.model ?? configured.model, thinking: task.thinking ?? configured.thinking }, options.models);
			this.nodes.set(task.id, { task, selection, state: "pending" });
		}
		if (this.profile === "fast" && [...this.nodes.values()].filter((node) => node.task.role === "WORKER_STRONG").length > 1) throw new Error("Fast mode permits at most one strong worker per plan; use deep for justified additional depth.");
		if (Buffer.byteLength(JSON.stringify(options.tasks), "utf8") > 65_536) throw new Error("Task capsules exceed 64 KiB in aggregate.");
		const visited = new Set<string>();
		const visiting = new Set<string>();
		const visit = (id: string): void => {
			if (visiting.has(id)) throw new Error("Task dependencies contain a cycle.");
			if (visited.has(id)) return;
			const node = this.nodes.get(id);
			if (!node) throw new Error(`Unknown dependency: ${id}`);
			visiting.add(id);
			for (const dependency of node.task.dependsOn) visit(dependency);
			visiting.delete(id);
			visited.add(id);
		};
		for (const id of this.nodes.keys()) visit(id);
	}

	/** Explicit parent acceptance is separate from a child's successful exit. */
	decide(id: string, decision: "accept" | "reject", evidenceSummary?: string): void {
		if (this.busy) throw new Error("Wait for the current frontier before accepting results.");
		const node = this.nodes.get(id);
		if (!node || node.state !== "awaiting_acceptance") throw new Error("Only captured completed results can be accepted or rejected.");
		if (decision !== "accept" && decision !== "reject") throw new Error("Unknown acceptance decision.");
		if (decision === "accept") {
			boundedText(evidenceSummary ?? "", "accepted evidence summary");
			node.acceptedSummary = evidenceSummary;
		}
		node.state = decision === "accept" ? "accepted" : "rejected";
		this.blockDependents();
	}

	private blockDependents(): void {
		let changed = true;
		while (changed) {
			changed = false;
			for (const node of this.nodes.values()) {
				if (node.state !== "pending") continue;
				if (node.task.dependsOn.some((id) => ["failed", "rejected", "cancelled", "blocked"].includes(this.nodes.get(id)!.state))) {
					node.state = "blocked";
					changed = true;
				}
			}
		}
	}

	async runReady(delegate: FastWorkDelegate, signal: AbortSignal): Promise<FastWorkTaskResult[]> {
		if (this.profile === "normal") throw new Error("Normal mode does not fan out; enable fast or deep explicitly.");
		if (this.busy) throw new Error("A fast-work frontier is already running.");
		this.busy = true;
		let active = 0;
		const pending = new Set<Promise<void>>();
		try {
			for (;;) {
				this.blockDependents();
				if (signal.aborted) {
					for (const node of this.nodes.values()) if (node.state === "pending") node.state = "cancelled";
				}
				for (const node of this.nodes.values()) {
					if (active >= 3 || signal.aborted) break;
					if (node.state !== "pending" || !node.task.dependsOn.every((id) => this.nodes.get(id)!.state === "accepted")) continue;
					// Fast mode admits one strong worker at a time; independent standard leaves can still overlap.
					if (this.profile === "fast" && node.task.role === "WORKER_STRONG" && [...this.nodes.values()].some((other) => other.state === "running" && other.task.role === "WORKER_STRONG")) continue;
					node.state = "running";
					node.dispatchMs = this.now() - this.createdAt;
					active++;
					this.peakActive = Math.max(this.peakActive, active);
					const task = node.task;
					const request: SubagentDelegationRequest = {
						requestId: randomUUID(), ownerRunId: this.ownerRunId, nodeId: task.id,
						agent: this.agent, cwd: this.cwd, context: "fresh", ...node.selection,
						task: JSON.stringify({ authority: "Read-only. No edits, commands, nested delegation, or publication.", goal: task.goal, context: task.context, inputs: task.inputs, acceptance: task.acceptance, nonGoals: task.nonGoals, acceptedDependencies: task.dependsOn.map((id) => ({ id, evidence: this.nodes.get(id)!.acceptedSummary })) }),
						skill: false, artifacts: true, timeoutMs: 300_000,
						toolBudget: { hard: 40, block: "*" }, intercomBridge: { mode: "off" }, result: { kind: "text" },
					};
					let work: Promise<void>;
					work = (async () => {
						try {
							const response = await delegate(request, signal);
							if (response.requestId !== request.requestId || response.ownerRunId !== request.ownerRunId || response.nodeId !== request.nodeId) throw new Error("Delegation response identity mismatch.");
							node.response = response;
							node.state = response.status === "completed" && response.result?.kind === "text" && response.result.text.trim() ? "awaiting_acceptance" : response.status === "cancelled" ? "cancelled" : "failed";
							if (response.status === "completed" && node.state === "failed") node.error = "Completed child returned no captured nonempty text evidence.";
						} catch (error) {
							node.error = error instanceof Error ? error.message : String(error);
							node.state = signal.aborted ? "cancelled" : "failed";
						} finally {
							node.terminalMs = this.now() - this.createdAt;
							active--;
						}
					})();
					pending.add(work);
					void work.then(() => pending.delete(work));
				}
				if (!pending.size) break;
				await Promise.race(pending);
			}
			return this.snapshot();
		} finally {
			this.busy = false;
		}
	}

	snapshot(): FastWorkTaskResult[] {
		return [...this.nodes.values()].map((node) => {
			const result: FastWorkTaskResult = { id: node.task.id, state: node.state };
			if (node.response) result.response = structuredClone(node.response);
			if (node.error) result.error = node.error;
			return result;
		});
	}

	/** Deliberate whitelist: no task IDs, prompts, source paths, responses or error text. */
	metrics(): FastWorkMetrics {
		const nodes = [...this.nodes.values()];
		return {
			version: 1, ownerRunId: this.ownerRunId, profile: this.profile,
			elapsedMs: this.now() - this.createdAt, peakActive: this.peakActive,
			tasks: nodes.map((node, index) => {
				const metrics: FastWorkTaskMetrics = {
					index, dependencies: node.task.dependsOn.map((id) => nodes.findIndex((other) => other.task.id === id)),
					role: node.task.role, model: node.selection.model, thinking: node.selection.thinking, state: node.state,
					dispatchMs: node.dispatchMs, terminalMs: node.terminalMs,
				};
				if (node.response && "usage" in node.response && node.response.usage) metrics.usage = {
					input: node.response.usage.input, output: node.response.usage.output, cacheRead: node.response.usage.cacheRead,
					cacheWrite: node.response.usage.cacheWrite, cost: node.response.usage.cost, turns: node.response.usage.turns,
					toolCalls: node.response.usage.toolCalls, durationMs: node.response.usage.durationMs,
				};
				return metrics;
			}),
		};
	}
}
