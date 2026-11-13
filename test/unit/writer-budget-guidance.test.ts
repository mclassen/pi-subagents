import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const readProjectFile = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

describe("writer budget guidance", () => {
	it("keeps hard tool and usage caps off mutation-capable workers", () => {
		const toolReference = readProjectFile("docs/tool-reference.md");
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const reviewLoop = readProjectFile("prompts/review-loop.md");

		for (const text of [toolReference, skill, reviewLoop]) {
			assert.match(text, /do not (?:pass|set) a hard `toolBudget`/i);
			assert.match(text, /default tool budget blocks read\/search tools rather than mutation tools/i);
			assert.match(text, /checkpoint after the current tool returns/);
			assert.match(text, /changed files/);
			assert.match(text, /build\/test state/);
			assert.match(text, /commit or PR state/);
		}
		assert.match(toolReference, /elapsed timeout is not a mutation-safe boundary/i);
	});

	it("removes hard token caps without weakening cost and control safeguards", () => {
		const toolReference = readProjectFile("docs/tool-reference.md");
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const reviewLoop = readProjectFile("prompts/review-loop.md");
		const guidance = [toolReference, skill, reviewLoop].join("\n");

		assert.match(guidance, /do not (?:pass|set) a hard `toolBudget` or (?:tight )?`?usageBudget`?/i);
		assert.doesNotMatch(guidance, /hard token (?:cap|budget)|tokenBudget/);
		assert.match(guidance, /checkpoint after the current tool returns/);
		assert.match(guidance, /elapsed timeout is not a mutation-safe boundary/i);
		assert.match(toolReference, /cost|cancel|timeout|tool control/i);
	});

});
