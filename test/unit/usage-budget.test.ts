import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { usageBudgetExceededMessage, usageBudgetState, validateUsageBudgetConfig } from "../../src/runs/shared/usage-budget.ts";

describe("usage budget", () => {
	it("rejects removed token limits while preserving monetary limits", () => {
		assert.match(validateUsageBudgetConfig({ tokens: { hard: 100 } }).error ?? "", /tokens has been removed/i);
		assert.deepEqual(validateUsageBudgetConfig({ costUsd: { soft: 2, hard: 5 } }).budget, {
			costUsd: { soft: 2, hard: 5 },
		});
		assert.match(validateUsageBudgetConfig({}).error ?? "", /must include costUsd/i);
	});

	it("enforces only reported monetary usage and keeps token totals informational", () => {
		const config = { costUsd: { soft: 2, hard: 5 } };
		const within = usageBudgetState(config, { inputTokens: 1000, outputTokens: 1000, costUsd: 3 });
		assert.equal(within?.exhausted, false);
		assert.equal(within?.costUsd?.outcome, "soft-exceeded");
		assert.equal(Object.hasOwn(within ?? {}, "tokens"), false);

		const exhausted = usageBudgetState(config, { inputTokens: 1, outputTokens: 1, costUsd: 5 });
		assert.equal(exhausted?.exhausted, true);
		assert.equal(exhausted?.reason, "costUsd");
		assert.match(usageBudgetExceededMessage(exhausted!), /reported cost/);
	});

	it("clears legacy token-only configuration state when a resumed run refreshes its budget", () => {
		const legacy = { tokens: { hard: 10 } } as unknown as Parameters<typeof usageBudgetState>[0];
		const refreshed = usageBudgetState(legacy, { inputTokens: 100, outputTokens: 100, costUsd: 0 });
		assert.equal(refreshed?.exhausted, false);
		assert.equal(Object.hasOwn(refreshed ?? {}, "tokens"), false);
		assert.equal(refreshed?.reason, undefined);
	});
});
