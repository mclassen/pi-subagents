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

		assert.match(skill, /parent handles trivial, serial, or causally coupled work directly/i);
		assert.match(skill, /delegation is subordinate to user\/global eligibility policy/i);
		assert.match(skill, /proactively delegate suitable independent.*when applicable instructions authorize it/is);
		assert.match(skill, /do not require parent failure or a separately named delegation request/i);
		assert.match(skill, /keep trivial, serial and tightly coupled work local/i);
		assert.match(skill, /avoid duplicate scouts, overlapping writers, vague prompts and fanout merely to fill slots/i);
		assert.match(skill, /smallest bounded mode.*earns its token and\s+elapsed-time overhead/is);
		assert.match(prompting, /all launch guidance.*assumes delegation is authorized by the current request or applicable user\/project instructions/is);
		assert.match(recipes, /parent performs the serial path by default/i);
		assert.match(recipes, /bounded approved components.*need not be mechanical or context-light/i);
		assert.match(lanes, /only after delegation is operator-authorized.*materially improves/is);
		assert.doesNotMatch(guidance, /frozen mechanical slice|codes it directly by default|Parent implements by default|especially when Sol/i);

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
		assert.match(prompting, /(?:launch|release) ready isolated writers.*without another delegation request/is);
		assert.match(recipes, /parent owns causality, design, shared contracts and integration/i);
		assert.doesNotMatch([skill, recipes].join("\n"), /default coder|coding by default|especially when Sol/i);
		assert.match(lanes, /parent integrates accepted component handoffs/i);
		assert.match(lanes, /Do not require a separate integration worker/i);
	});

	it("requires actual plan writers, canonical scope and an explicit fewer-lane decision", () => {
		for (const file of ["skills/pi-subagents/SKILL.md", "skills/pi-subagents/references/multi-lane-orchestration.md", "docs/fast-work.md"]) {
			const text = readProjectFile(file);
			assert.match(text, /2–5 concurrent independent coding\/test-writing workers/);
			assert.match(text, /openai-codex\/gpt-6\.1-sol:medium/);
			assert.match(text, /repository-root `PLAN\.md`/);
			assert.match(text, /missing or unclear.*ask/is);
			assert.match(text, /fewer than two.*concrete blocker.*ask.*rescope or proceed with fewer/is);
			assert.match(text, /read-only.*fast_work.*(?:never|do not) count as writers/is);
		}
		const docs = readProjectFile("docs/fast-work.md");
		assert.match(docs, /prompt-queuing command.*not an automatic launcher or concurrency guarantee/is);
		assert.match(docs, /tests prove.*instructions.*not future model compliance/is);
	});

	it("allows bounded local implementation with cold-start-complete current inputs", () => {
		const prompting = readProjectFile("skills/pi-subagents/references/prompting-and-roles.md");
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		const execution = readProjectFile("skills/pi-subagents/references/execution-controls.md");
		for (const text of [prompting, lanes]) {
			assert.match(text, /need not be mechanical or context-light/i);
			assert.match(text, /local implementation details.*(?:scope|contract)/is);
			assert.match(text, /(?:escalate|escalation).*product.*architecture.*shared-contract/is);
			assert.match(text, /uncommitted source\/config/i);
			assert.match(text, /adjacent consumers/i);
			assert.match(text, /provisioned dependencies/i);
			assert.match(text, /missing inputs.*stop.*never invent/is);
		}
		assert.match(lanes, /lane.*files\/contract.*dependencies.*workspace\/base.*gate/i);
		assert.match(execution, /one writer per workspace, not one overall/i);
		assert.doesNotMatch(execution, /frozen mechanical slice|main agent implements by default/i);
	});

	it("makes settled workspace cleanup parent-owned without retaining redundant dirty copies", () => {
		const lanes = readProjectFile("skills/pi-subagents/references/multi-lane-orchestration.md");
		assert.match(lanes, /parent owns cleanup.*failed.*cancelled.*startup-failed/is);
		assert.match(lanes, /evidence outside temporary workspaces/i);
		assert.match(lanes, /tracked\/untracked\/submodule/i);
		assert.match(lanes, /ordinary `git worktree remove`.*`prune`.*never `--force`/is);
		assert.match(lanes, /uncommitted agent changes alone do not require retaining unused copies/i);
		assert.match(lanes, /user work.*uncertain ownership.*unpreserved useful changes/is);
		assert.match(lanes, /verify deletion.*retained paths.*reasons.*do not wait for push/is);
		assert.doesNotMatch(lanes, /worktree is clean|If work is dirty\/divergent.*preserve the worktree/is);
	});

	// These checks prove instruction content, not model compliance or runtime recovery reliability.
	for (const file of [
		"skills/pi-subagents/SKILL.md",
		"skills/pi-subagents/references/execution-controls.md",
		"skills/pi-subagents/references/multi-lane-orchestration.md",
		"docs/tool-reference.md",
		"docs/workflows.md",
	]) {
		it(`${file} permits one ownership-safe recovery without blanket approval`, () => {
			const text = readProjectFile(file);
			assert.match(text, /failed(?:\/disappeared| or disappeared) runner is not task success/i);
			assert.match(text, /preserve[^.\n]*tracked AND untracked partial edits/i);
			assert.match(text, /unaccepted until parent inspection(?:\/|, )integration(?:\/| and )validation/i);
			assert.match(text, /old writer is terminal or demonstrably gone/i);
			assert.match(text, /exclusive ownership/i);
			assert.match(text, /one bounded same-protocol recovery attempt.*authorized without fresh user confirmation/i);
			assert.match(text, /same approved model\/provider\/tools/i);
			assert.match(text, /within existing (?:task\/iteration )?limits/i);
			assert.match(text, /prefer(?=[^.\n]*eligible)(?=[^.\n]*resume)(?=[^.\n]*exact.ID)/i);
			assert.match(text, /explicitly labeled same-role replacement in a distinct isolated workspace/i);
			assert.match(text, /current inputs.*partial work.*remaining checks/i);
			assert.match(text, /change.*(?:approach|input).*failure evidence/i);
			assert.match(text, /if recovery fails again.*checkpoint\/report and ask/i);
			assert.match(text, /no automatic[^.\n]*execution.mode\/model\/provider fallback|never automatically switch execution mode\/model\/provider/i);
			assert.doesNotMatch(text, /do not start another writer.*without explicit owner approval/i);
			assert.doesNotMatch(text, /report startup\/runtime failure and ask whether to repair or execute locally/i);
			assert.doesNotMatch(text, /before (?:a same-protocol )?retry(?:ing)? or asking the owner/i);
			if (!file.endsWith("SKILL.md")) {
				assert.match(text, /(?:quiet output|missing notifications).*`needs_attention`.*(?:not proof|do not prove)/i);
				assert.match(text, /ownership transfer and a parent-captured recovery handoff/i);
				assert.match(text, /local implementation.*(?:requires|still requires) explicit owner approval/i);
			}
			if (!file.endsWith("execution-controls.md")) {
				assert.match(text, /execution-controls\.md#failed-lane-recovery-and-execution-mode-changes/);
			}
		});
	}

	it("execution-controls bounds recovery authority and preserves a missing-response handoff", () => {
		const execution = readProjectFile("skills/pi-subagents/references/execution-controls.md");
		const recovery = execution.split("### Failed lane recovery and execution-mode changes\n")[1]?.split("\n### ")[0];
		assert.ok(recovery, "the canonical recovery section must exist");
		assert.match(recovery, /run\/status and repo\/cwd\/worktree\/branch\/ref/);
		assert.match(recovery, /commands\/evidence and outstanding acceptance checks outside the failed workspace/i);
		assert.match(recovery, /never replace a still-live writer or guess ownership/i);
		assert.match(recovery, /never loop unchanged failure/i);
		assert.match(recovery, /resume is unavailable or rejects eligibility/i);
		assert.match(recovery, /handoff.*substitute for a missing final worker response, not for acceptance evidence/is);
		assert.match(recovery, /no safe supported repair.*ownership is uncertain.*tools\/model\/provider are unavailable/is);
		assert.match(recovery, /task\/mission is paused, cancelled or out of iterations/i);
		assert.match(recovery, /do not reset the goal iteration count or restrictions/i);
		assert.match(recovery, /no automatic destructive repair, spending, extra permissions, publication/i);
		assert.match(recovery, /provider failures never select another model automatically/i);
		assert.match(recovery, /tests prove these instructions only, not future model compliance or recovery runtime reliability/i);
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
