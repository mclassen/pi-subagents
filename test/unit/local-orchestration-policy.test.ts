import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const readProjectFile = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

describe("local orchestration policy", () => {
	it("keeps coding eligibility and parent decision authority explicit", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		assert.match(skill, /Delegation is subordinate to user\/global eligibility policy/);
		assert.match(skill, /Terra high defaults for bounded coding, test-writing and nested writers/i);
		assert.match(prompting, /escalate new product, architecture or shared-contract decisions/i);
		assert.doesNotMatch([skill, prompting].join("\n"), /Sol 6\.1 medium defaults for coding|Sol 6\.1 medium writers/i);
	});

	it("routes coding and test-writing to Terra high while preserving explicit selections and non-coding policy", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const reviewLoop = readProjectFile("prompts/review-loop.md");
		const worker = readProjectFile("agents/worker.md");
		const oracle = readProjectFile("agents/oracle.md");

		for (const text of [skill, prompting, reviewLoop]) {
			assert.match(text, /Terra high/i);
			assert.match(text, /routine, unbounded, complex or correctness-heavy coding/i);
			assert.match(text, /never use Luna for coding workers/i);
		}
		assert.match(worker, /^model: openai-codex\/gpt-6\.1-terra\r?$/m);
		assert.match(worker, /thinking: high/);
		assert.match(worker, /Default explicitly to Terra high.*coding and test-writing/i);
		assert.match(worker, /preserve explicit user model\/thinking selections/i);
		assert.match(skill, /Terra high defaults for bounded coding, test-writing and nested writers/i);
		assert.match(prompting, /Default bounded coding, test-writing and nested writer work to Terra high/i);
		assert.match(reviewLoop, /default coding\/test-writing workers.*Terra high/i);
		assert.match(reviewLoop, /Sol 6\.1 medium remains the default reviewer tier/i);
		assert.doesNotMatch([skill, prompting, reviewLoop, worker].join("\n"), /Never route implementation.*Luna|Terra high is not.*implementation/i);
		assert.match(oracle, /thinking: medium/);
		assert.match(oracle, /Sol high only when.*complex|Sol high only for.*complex/i);
		assert.match(readProjectFile("docs/fast-work.md"), /Standard leaves default to `openai-codex\/gpt-6\.1-terra` with `medium` thinking/i);
		assert.match(readProjectFile("prompts/review-loop.md"), /Sol 6\.1 medium remains the default reviewer tier/i);
	});

	it("keeps review routing separate from Luna coding defaults", () => {
		const reviewLoop = readProjectFile("prompts/review-loop.md");
		assert.match(reviewLoop, /default coding\/test-writing workers.*Terra high/i);
		assert.match(reviewLoop, /Sol 6\.1 medium remains the default reviewer tier/i);
		assert.doesNotMatch(reviewLoop, /Never route implementation.*Luna/i);
	});

	it("keeps every child in a distinct isolated workspace", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const execution = readProjectFile("skills/pi-subagents/references/execution-controls.md");
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");

		assert.match(skill, /every child a distinct isolated execution workspace\/resource/i);
		assert.match(execution, /distinct temporary execution workspace\/resource.*every child/i);
		assert.match(lanes, /never share the parent checkout or a checkout\/directory between children/i);
		assert.doesNotMatch(lanes, /Read-only runs can share a checkout/i);
		assert.doesNotMatch(prompting, /only child allowed to edit the active worktree/i);
		assert.doesNotMatch(prompting, /sole writer for the active worktree/i);
	});
});
