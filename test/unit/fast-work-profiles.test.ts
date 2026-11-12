import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_WORK_PROFILE_EVENT, setFastWorkProfiles, validateFastWorkProfiles } from "../../src/api/fast-work-profiles.ts";

test("accepts only explicit role/model selections available at requested effort", () => {
	const models = [{ provider: "openai-codex", id: "gpt-6.1-terra", reasoning: true, thinkingLevelMap: { medium: "medium", high: "high" } }];
	assert.deepEqual(validateFastWorkProfiles({ WORKER_STANDARD: { model: "openai-codex/gpt-6.1-terra", thinking: "high" } }, models), {
		WORKER_STANDARD: { model: "openai-codex/gpt-6.1-terra", thinking: "high" },
	});
	for (const value of [null, {}, { OTHER: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" } }, { WORKER_STANDARD: { model: "openai-codex/gpt-6.1-sol", thinking: "low" } }, { WORKER_STANDARD: { model: "mistral/model", thinking: "medium" } }, { WORKER_STANDARD: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" } }]) assert.throws(() => validateFastWorkProfiles(value, models));
});

test("fails closed without an owner and surfaces invalid protocol responses", () => {
	const selection = { WORKER_STANDARD: { model: "openai-codex/gpt-6.1-terra", thinking: "high" } as const };
	assert.throws(() => setFastWorkProfiles({ emit(event: string) { assert.equal(event, FAST_WORK_PROFILE_EVENT); } } as any, selection), /unavailable/);
	assert.throws(() => setFastWorkProfiles({ emit(_event: string, request: any) { request.result = { ok: false, error: "busy" }; } } as any, selection), /busy/);
});
