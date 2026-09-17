import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const readProjectFile = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

describe("local orchestration policy", () => {
	it("keeps child implementation subordinate to the parent eligibility gate", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const constraints = readProjectFile("skills/pi-subagents/references/constraints-and-recipes.md");
		const reviewLoop = readProjectFile("prompts/review-loop.md");

		assert.match(skill, /Delegation is subordinate to user\/global eligibility policy/);
		assert.match(skill, /A Sol parent codes and reviews by default/);
		assert.doesNotMatch(skill, /delegate asynchronously.*most non-trivial requests/i);
		assert.match(prompting, /Parent implements by default/);
		assert.doesNotMatch(prompting, /one async `worker` implements or fixes/);
		assert.match(constraints, /parent owns causality, design, and coding by default/i);
		assert.match(reviewLoop, /Implementation requested.*does not automatically require a child writer/i);
	});

	it("routes bounded child work to Luna high/xhigh without automatic Terra or Luna max", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const reviewLoop = readProjectFile("prompts/review-loop.md");
		const worker = readProjectFile("agents/worker.md");
		const scout = readProjectFile("agents/scout.md");
		const researcher = readProjectFile("agents/researcher.md");
		const oracle = readProjectFile("agents/oracle.md");

		for (const text of [skill, prompting, reviewLoop]) {
			assert.match(text, /Luna high/i);
			assert.match(text, /Luna xhigh/i);
			assert.match(text, /Terra[^.\n]*manual[^.\n]*comparison fallback/i);
			assert.match(text, /Luna max.*never automatic|never route Luna max/i);
		}
		assert.match(worker, /Luna xhigh/);
		assert.match(scout, /thinking: high/);
		assert.match(researcher, /thinking: high/);
		assert.match(oracle, /thinking: medium/);
		assert.match(oracle, /Sol high only when.*complex|Sol high only for.*complex/i);
	});

	it("keeps Sol and Astra review loops from defaulting to Luna reviewers", () => {
		const reviewLoop = readProjectFile("prompts/review-loop.md");

		assert.match(reviewLoop, /Sol-medium or Astra-low parent reviews directly by default/i);
		assert.match(reviewLoop, /In a Sol- or Astra-parent session, never launch a Luna reviewer/i);
		assert.match(reviewLoop, /explicitly launch the reviewer at Sol medium or higher/i);
		assert.match(reviewLoop, /use Astra low only when the review itself meets the extreme-complexity threshold/i);
		assert.match(reviewLoop, /Luna reviewers are limited to Luna-parent sessions/i);
		assert.match(reviewLoop, /Luna medium more often for bounded mechanical reading/i);
		assert.match(reviewLoop, /do not rely on a configured Luna default in a Sol- or Astra-parent session/i);
	});

	it("keeps every child in a distinct isolated workspace", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const execution = readProjectFile("skills/pi-subagents/references/execution-controls.md");
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");

		assert.match(skill, /every child a distinct isolated execution workspace\/resource/i);
		assert.match(execution, /distinct execution workspace\/resource for every child/i);
		assert.match(lanes, /never share a checkout\/directory between children/i);
		assert.doesNotMatch(lanes, /Read-only runs can share a checkout/i);
		assert.doesNotMatch(prompting, /only child allowed to edit the active worktree/i);
		assert.doesNotMatch(prompting, /sole writer for the active worktree/i);
	});
});
