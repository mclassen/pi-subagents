import type { FastWorkMetrics, FastWorkProfile } from "../api/fast-work.ts";

export interface FastWorkParentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}
export interface FastWorkObservation {
	version: 1;
	profile: FastWorkProfile;
	parentModel?: string;
	parentThinking: string;
	wallMs: number;
	firstTextMs?: number;
	firstToolMs?: number;
	parentUsage?: FastWorkParentUsage;
	parentUsageMessages: number;
	compactions: number;
	plans: FastWorkMetrics[];
}

/** An observation, not a performance claim. Parent retries/continuations share one settled window. */
export class FastWorkTelemetry {
	private readonly profile: FastWorkProfile;
	private readonly model: string | undefined;
	private readonly thinking: string;
	private readonly now: () => number;
	private readonly started: number;
	private firstTextMs?: number;
	private firstToolMs?: number;
	private parentUsage?: FastWorkParentUsage;
	private parentUsageMessages = 0;
	private compactions = 0;
	private settled = false;

	constructor(profile: FastWorkProfile, model: string | undefined, thinking: string, now: () => number = () => performance.now()) {
		this.profile = profile;
		this.model = model;
		this.thinking = thinking;
		this.now = now;
		this.started = now();
	}
	firstText(): void { if (this.firstTextMs === undefined) this.firstTextMs = this.now() - this.started; }
	firstTool(): void { if (this.firstToolMs === undefined) this.firstToolMs = this.now() - this.started; }
	compacted(): void { this.compactions++; }
	usage(usage: FastWorkParentUsage): void {
		if (![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cost].every((value) => Number.isFinite(value) && value >= 0)) return;
		this.parentUsage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) this.parentUsage[key] += usage[key];
		this.parentUsageMessages++;
	}
	/** Only called from agent_settled, never agent_end or the first assistant stop. */
	finish(plans: FastWorkMetrics[]): FastWorkObservation | undefined {
		if (this.settled) return undefined;
		this.settled = true;
		return {
			version: 1, profile: this.profile, parentModel: this.model, parentThinking: this.thinking,
			wallMs: this.now() - this.started, firstTextMs: this.firstTextMs, firstToolMs: this.firstToolMs,
			parentUsage: this.parentUsage ? { ...this.parentUsage } : undefined, parentUsageMessages: this.parentUsageMessages,
			compactions: this.compactions, plans,
		};
	}
}
