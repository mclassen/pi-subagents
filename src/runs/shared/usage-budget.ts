import type { CostSummary, UsageBudgetConfig, UsageBudgetLimitConfig, UsageBudgetState } from "../../shared/types.ts";

function validateLimit(value: unknown, label: string): { limit?: UsageBudgetLimitConfig; error?: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${label} must be an object.` };
	const raw = value as Record<string, unknown>;
	const unknown = Object.keys(raw).find((key) => key !== "soft" && key !== "hard");
	if (unknown) return { error: `${label}.${unknown} is not supported.` };
	if (typeof raw.hard !== "number" || !Number.isFinite(raw.hard) || raw.hard <= 0) return { error: `${label}.hard must be a positive number.` };
	if (raw.soft !== undefined && (typeof raw.soft !== "number" || !Number.isFinite(raw.soft) || raw.soft <= 0)) return { error: `${label}.soft must be a positive number.` };
	if (typeof raw.soft === "number" && raw.soft > raw.hard) return { error: `${label}.soft must be less than or equal to ${label}.hard.` };
	return { limit: { ...(typeof raw.soft === "number" ? { soft: raw.soft } : {}), hard: raw.hard } };
}

export function validateUsageBudgetConfig(value: unknown, label = "usageBudget"): { budget?: UsageBudgetConfig; error?: string } {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${label} must be an object.` };
	const raw = value as Record<string, unknown>;
	if (raw.tokens !== undefined) return { error: `${label}.tokens has been removed; only costUsd limits are supported.` };
	const unknown = Object.keys(raw).find((key) => key !== "costUsd");
	if (unknown) return { error: `${label}.${unknown} is not supported.` };
	const budget: UsageBudgetConfig = {};
	if (raw.costUsd !== undefined) {
		const costUsd = validateLimit(raw.costUsd, `${label}.costUsd`);
		if (costUsd.error) return { error: costUsd.error };
		budget.costUsd = costUsd.limit;
	}
	if (!budget.costUsd) return { error: `${label} must include costUsd.` };
	return { budget };
}

function metricState(limit: UsageBudgetLimitConfig | undefined, used: number): UsageBudgetState["costUsd"] {
	if (!limit) return undefined;
	return {
		...limit,
		used,
		outcome: used >= limit.hard ? "hard-exceeded" : limit.soft !== undefined && used >= limit.soft ? "soft-exceeded" : "within-budget",
	};
}

export function usageBudgetState(config: UsageBudgetConfig | undefined, totals: CostSummary | undefined): UsageBudgetState | undefined {
	if (!config) return undefined;
	const costUsd = metricState(config.costUsd, totals?.costUsd ?? 0);
	const exhausted = costUsd?.outcome === "hard-exceeded";
	return {
		version: 1,
		source: "reported",
		...(costUsd ? { costUsd } : {}),
		exhausted,
		...(exhausted ? { reason: "costUsd" as const } : {}),
	};
}

export function usageBudgetExceededMessage(state: UsageBudgetState): string {
	if (state.reason === "costUsd" && state.costUsd) return `Usage budget exhausted: reported cost $${state.costUsd.used.toFixed(6)} reached hard limit $${state.costUsd.hard.toFixed(6)}.`;
	return "Usage budget exhausted.";
}
