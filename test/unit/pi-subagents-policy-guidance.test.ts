import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const readProjectFile = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

describe("pi-subagents delegation policy guidance", () => {
	it("keeps delegation operator-authorized and cost-bounded", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const recipes = readProjectFile("skills/pi-subagents/references/constraints-and-recipes.md");
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		const guidance = [skill, prompting, recipes, lanes].join("\n");

		assert.match(skill, /parent handles focused, serial, context-heavy, or causally coupled work directly/i);
		assert.match(skill, /delegation is subordinate to user\/global eligibility policy/i);
		assert.match(skill, /proactively delegate suitable independent.*when applicable instructions authorize it/is);
		assert.match(skill, /do not require parent failure or a separately named delegation request/i);
		assert.match(skill, /keep trivial, serial and tightly coupled work local/i);
		assert.match(skill, /avoid duplicate scouts, overlapping writers, vague prompts and fanout merely to fill slots/i);
		assert.match(skill, /smallest bounded mode.*earns its token and\s+elapsed-time overhead/is);
		assert.match(prompting, /all launch guidance.*assumes delegation is authorized by the current request or applicable user\/project instructions/is);
		assert.match(recipes, /parent performs the serial path by default/i);
		assert.match(recipes, /frozen mechanical slice passes the user\/global eligibility gate/i);
		assert.match(lanes, /only after delegation is operator-authorized.*materially improves/is);

		assert.doesNotMatch(guidance, /not the routine primary doer/i);
		assert.doesNotMatch(guidance, /delegate[^\n]*(?:most|all) non-trivial requests/i);
		assert.doesNotMatch(guidance, /use this at the start of non-trivial work/i);
	});

	it("uses the authorized five-lane coding queue without forcing unnecessary workers", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const recipes = readProjectFile("skills/pi-subagents/references/constraints-and-recipes.md");
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		for (const text of [skill, lanes]) {
			assert.match(text, /Normal fanout is up to five concurrent depth-one lanes/i);
			assert.match(text, /five ready eligible coding slices.*launch five/is);
			assert.match(text, /refill.*accept(?:ed|ance).*handoff/is);
			assert.match(text, /more than five requires explicit user approval/i);
			assert.doesNotMatch(text, /Normal fanout is at most three|four to six independent lanes/i);
		}
		assert.match(skill, /Do not treat read-only scouts or reviewers as coding progress/i);
		assert.doesNotMatch(skill, /before an integration-only owner/i);
		assert.match(prompting, /launch ready isolated writers.*without another delegation request/is);
		assert.match(recipes, /parent owns causality, design, shared contracts and integration/i);
		assert.doesNotMatch([skill, recipes].join("\n"), /default coder|coding by default|especially when Sol/i);
		assert.match(lanes, /parent integrates accepted component handoffs/i);
		assert.match(lanes, /Do not require a separate integration worker/i);
	});

	it("keeps loaded routing and review recommendations aligned with the current policy", () => {
		const skill = readProjectFile("skills/pi-subagents/SKILL.md");
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const review = readProjectFile("skills/pi-subagents/references/review-and-validation.md");
		assert.match(skill, /Sol 6\.1 high is preferred for substantive parent reasoning/i);
		assert.match(skill, /Sol 6\.1 medium defaults for coding, tests, verification and helpers/i);
		assert.match(skill, /Explicit parent selection wins/i);
		assert.match(skill, /Luna medium is only an explicitly selected cheap bounded read-only lookup/i);
		assert.match(prompting, /Prefer Sol 6\.1 high for substantive parent reasoning/i);
		assert.match(prompting, /Default ordinary coordination, coding, test-writing, verification, review and helper work to Sol 6\.1 medium/i);
		assert.match(prompting, /Astra medium is available only when explicitly selected, never as an automatic escalation/i);
		assert.match(prompting, /Sol xhigh\/max remains manual-only/i);
		assert.match(prompting, /Never route implementation, review or verification to Luna/i);
		assert.match(review, /canonical model routing policy/);
		for (const text of [skill, prompting, review]) {
			assert.doesNotMatch(text, /Sol 5\.6|genuinely simple.*review|Sol high(?:\/max)? (?:is|are) manual-only|Astra low is reserved for stuck/i);
		}
		assert.match(skill, /up to three bounded read-only leaves.*all checkout writers are paused until verified settlement/is);
		assert.match(skill, /exception permits no edits, commands, nested delegation or publication/i);
	});
});
