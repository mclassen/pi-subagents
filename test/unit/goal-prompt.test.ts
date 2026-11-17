import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const prompt = readFileSync(new URL("../../prompts/goal.md", import.meta.url), "utf-8");
const missions = readFileSync(new URL("../../docs/missions.md", import.meta.url), "utf-8");
const manifest = readFileSync(new URL("../../package.json", import.meta.url), "utf-8");

// These checks prove packaged instructions, not future model compliance or goal completion.
describe("goal prompt contract", () => {
	it("exposes a packaged slash prompt with invocation arguments and an empty-input guard", () => {
		assert.match(manifest, /"prompts":\s*\[\s*"\.\/prompts"\s*\]/);
		assert.ok(manifest.includes('"prompts/**/*"'));
		assert.match(prompt, /^---\r?\ndescription: .+\r?\nargument-hint: .+\r?\n---/);
		assert.match(prompt, /\n\$@\s*$/);
		assert.match(prompt, /no concrete goal.*ask.*stop without creating a mission or changing files/i);
	});

	it("uses the mission API with an overridable eight-iteration limit and no invented budget", () => {
		assert.match(prompt, /action: "mission\.create".*goal: true, maxIterations: <selected positive limit>/);
		assert.match(prompt, /action: "mission\.show"/);
		assert.match(prompt, /action: "mission\.list"/);
		assert.match(prompt, /action: "mission\.close".*missionStatus: "completed"/);
		assert.match(prompt, /Require the returned mission id before implementation/);
		assert.match(prompt, /maximum of 8 iterations unless I specify a different positive integer/);
		assert.match(prompt, /proceed without asking me to confirm it/);
		assert.match(prompt, /No monetary or token budget is imposed/);
		assert.doesNotMatch(prompt, /400000|400k|budget:\s*\{|budget-exhausted/i);
		assert.match(prompt, /never reset counters/i);
	});

	it("keeps new goals, continuation and cancellation scoped to the saved session", () => {
		for (const guidance of [prompt, missions, readFileSync(new URL("../../skills/pi-subagents/references/execution-controls.md", import.meta.url), "utf-8")]) {
			assert.match(guidance, /valid new mission is created.*only this session's previous open goals are cancelled/i);
			assert.match(guidance, /History, summaries, evidence, counters and files remain/i);
			assert.match(guidance, /running jobs are not stopped/i);
			assert.match(guidance, /Empty or invalid invocations do not replace goals/i);
			assert.match(guidance, /same saved-session resume or explicit continuation.*existing goal and counters/i);
			assert.match(guidance, /new (?:user )?objective is not bypassing old counters/i);
			assert.match(guidance, /fresh session starts its own goal without asking old versus new or requiring the original session/i);
			assert.match(guidance, /Do not discover, adopt or reconcile foreign goals from shared `PLAN\.md`, a capsule or global list merely because the directory matches/i);
			assert.match(guidance, /Global listing or exact foreign inspection is only for an explicit user-directed diagnostic investigation, never a prerequisite for `\/goal`/i);
			assert.match(guidance, /foreign or paused historical goal is not a repository lock, file ownership claim or blocker/i);
			assert.match(guidance, /concrete file collision or missing scope/i);
			assert.match(guidance, /\/goal cancel.*\/goal cancel <exact mission ID>.*only goals owned by the current saved session/i);
			assert.match(guidance, /exact foreign target is rejected/i);
			assert.doesNotMatch(guidance, /regardless of owner|natural language cancellation does not invoke the override/i);
		}
	});

	it("fixes checkable acceptance criteria and keeps user-only work out of acceptance", () => {
		const acceptance = prompt.indexOf("## Acceptance contract");
		const iterate = prompt.indexOf("## Iterate");
		assert.ok(acceptance > 0 && iterate > acceptance, "criteria are fixed before iterating");
		assert.match(prompt, /3–7 numbered acceptance criteria/);
		assert.match(prompt, /names its check/);
		assert.match(prompt, /\*\*Handoff\*\* list, not into acceptance/);
		assert.match(prompt, /every acceptance criterion passes/);
		assert.match(prompt, /blocker or exhausted limit is not completion/);
	});

	it("drives each iteration at one criterion and reports measured progress", () => {
		assert.match(prompt, /goal: \{ iteration: "begin" \}/);
		assert.match(prompt, /goal: \{ iteration: "complete", progress: "advanced" \| "none" \}/);
		assert.match(prompt, /top unmet criterion/);
		assert.match(prompt, /iN · criterion · change · result · evidence path/);
	});

	it("forbids repeating a failed approach and stops on stalled iterations", () => {
		assert.match(prompt, /same failure twice.*different hypothesis/i);
		assert.match(prompt, /Never rerun an unchanged attempt/);
		assert.match(prompt, /2 consecutive `progress: "none"` iterations the runtime pauses the goal/);
		assert.match(prompt, /single decision or input you need/);
	});

	it("keeps the course while giving every discovery one disposition", () => {
		assert.match(prompt, /rereading the objective and the criteria; work that moves no criterion is off course/);
		for (const disposition of ["blocker", "amend", "defer", "pitfall"]) assert.ok(prompt.includes(`**${disposition}**:`), disposition);
		assert.match(prompt, /ask me only if that narrows the goal/);
		assert.match(prompt, /useful but not needed for acceptance.*do not do it now/);
		assert.match(prompt, /Keep pitfalls listed so later iterations do not repeat them/);
		assert.match(prompt, /look for a route within it.*ask only when none exists/);
	});

	it("implements directly and asks only for actions outside existing authority", () => {
		assert.match(prompt, /Implement directly by default/);
		assert.match(prompt, /directly in the target checkout/);
		assert.match(prompt, /at least two independent lanes/);
		assert.match(prompt, /Work left in a candidate copy is not progress/);
		assert.match(prompt, /Ask only for actions outside existing authority/);
		assert.match(prompt, /do not ask for routine confirmation/i);
		assert.match(prompt, /grants no new spending or publication authority/);
		assert.match(prompt, /openai-codex\/gpt-6\.1-terra:high/);
		assert.match(prompt, /never Luna for coding/);
		assert.doesNotMatch(prompt, /fewer than two.*ask/i);
		assert.doesNotMatch(prompt, /local implementation.*requires explicit approval/i);
	});

	it("keeps plan and mission records short and current", () => {
		assert.match(prompt, /`PLAN\.md` is the canonical plan/);
		assert.match(prompt, /preserve unrelated content/);
		assert.match(prompt, /last 5 iteration log lines/);
		assert.match(prompt, /do not paste hashes, manifests or lane accounting/);
		assert.match(prompt, /at most 5 lines/);
		assert.match(prompt, /refresh or clear it at every iteration completion/);
		assert.ok(Buffer.byteLength(prompt) < 10240, "the prompt stays small enough to be read every continuation");
	});

	it("guards against regressions, weakened checks and self-confirming evidence", () => {
		assert.match(prompt, /One criterion keeps the existing checks the change can affect green/);
		assert.match(prompt, /Name what must stay unchanged/);
		assert.match(prompt, /record the baseline/);
		assert.match(prompt, /A new test is evidence only if it failed before the change/);
		assert.match(prompt, /placeholders, stubs and TODOs are not progress/);
		assert.match(prompt, /Never weaken, skip or delete a check to make it pass/);
		const audit = prompt.indexOf("Completion audit: rerun every criterion's check on the final state");
		assert.ok(audit > 0 && audit < prompt.indexOf('action: "mission.close"'), "the audit precedes closing");
		assert.match(prompt, /read-only reviewer that did not write the change/);
	});

	it("treats continuation notices as neither authority nor evidence", () => {
		assert.match(prompt, /`mission\.show` the exact mission ID, read `PLAN\.md` `## Current`/);
		assert.match(prompt, /saved-session identity differs from the goal owner, inspect read-only/);
		assert.match(prompt, /notice is not new authority, progress or acceptance evidence/);
	});
});
