import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const prompt = readFileSync(new URL("../../prompts/goal.md", import.meta.url), "utf-8");
const manifest = readFileSync(new URL("../../package.json", import.meta.url), "utf-8");

// These checks prove packaged instructions, not future model compliance or goal completion.
describe("goal prompt contract", () => {
	it("exposes a packaged slash prompt with invocation arguments and an empty-input guard", () => {
		assert.match(manifest, /"prompts":\s*\[\s*"\.\/prompts"\s*\]/);
		assert.ok(manifest.includes('"prompts/**/*"'));
		assert.match(prompt, /^---\ndescription: .+\nargument-hint: .+\n---/);
		assert.match(prompt, /\n\$@\s*$/);
		assert.match(prompt, /no concrete goal.*ask.*stop without creating a mission or changing files/i);
	});

	it("uses an overridable eight-iteration limit without inventing a financial or token budget", () => {
		assert.match(prompt, /action: "mission\.list"/);
		assert.match(prompt, /action: "mission\.show"/);
		assert.match(prompt, /Do not create a duplicate on continuation/);
		assert.match(prompt, /action: "mission\.create".*goal: true \}/);
		assert.match(prompt, /Require the returned mission id before implementation/);
		assert.match(prompt, /maximum of 8 iterations unless I specify a different positive integer/);
		assert.match(prompt, /One iteration is one assess → plan → implement → verify cycle/);
		assert.match(prompt, /No monetary or token budget is imposed/);
		assert.doesNotMatch(prompt, /400000|400k|budget:\s*\{|budget-exhausted|maximum of 3/i);
		assert.match(prompt, /proceed without asking me to confirm it/);
		assert.match(prompt, /explicit override in my request is approval.*not a reason to pause/);
		assert.match(prompt, /Do not create a duplicate on continuation or reset its iteration count/);
		assert.match(prompt, /attach the enclosing `missionId`/);
		assert.match(prompt, /await state\.set\("nextReadyAction"/);
		assert.match(prompt, /iteration limit, iteration count, acceptance criteria and next action/);
		assert.match(prompt, /Routine assessment, checkpoint recording and verified cleanup do not need separate confirmation/);
	});

	it("assesses and updates canonical scope before implementing and verifies the full goal", () => {
		const assessment = prompt.indexOf("## Assess and update the plan");
		const implementation = prompt.indexOf("## Implement and verify");
		assert.ok(assessment > 0 && implementation > assessment);
		assert.match(prompt, /repository-root `PLAN\.md` as the canonical plan/);
		assert.match(prompt, /Read an existing plan completely and preserve unrelated work/);
		assert.match(prompt, /missing.*authorizes creating it after the initial assessment/);
		assert.match(prompt, /passing subset does not complete the full goal/);
		assert.match(prompt, /Integrate accepted scoped changes.*smallest authoritative regression/);
		assert.match(prompt, /reassess the full acceptance criteria/);
		assert.match(prompt, /every agreed acceptance criterion is proven/);
	});

	it("requires isolated plan writers and an explicit fewer-lane decision", () => {
		assert.match(prompt, /2–5 concurrent independent coding\/test-writing workers/);
		assert.match(prompt, /openai-codex\/gpt-6\.1-sol:medium/);
		assert.match(prompt, /real read\/write\/edit tools/);
		assert.match(prompt, /Read-only reviewers, scouts and `fast_work` do not count as writers/);
		assert.match(prompt, /fewer than two.*concrete blocker.*ask whether to rescope or proceed with fewer/);
		assert.match(prompt, /distinct temporary workspace outside extension auto-discovery/);
		assert.match(prompt, /exact current inputs.*cold-start-complete brief/);
		assert.match(prompt, /no silent execution-mode, model or provider fallback/);
		assert.match(prompt, /Preserve the selected parent model/);
		assert.match(prompt, /no new spending or publication authority/);
	});

	it("authorizes one ownership-safe same-protocol recovery without accepting partial work", () => {
		assert.match(prompt, /One bounded same-protocol recovery attempt.*without fresh user confirmation/);
		assert.match(prompt, /within existing task\/iteration limits.*same approved model\/provider\/tools/);
		assert.match(prompt, /report the exact failure.*run\/status, repository\/cwd\/worktree\/branch\/ref/);
		assert.match(prompt, /tracked and untracked partial edits, commands\/evidence and outstanding acceptance checks/);
		assert.match(prompt, /partial edits remain unaccepted until parent inspection, integration and validation/);
		assert.match(prompt, /prior writer is terminal or demonstrably gone and establish exclusive ownership/);
		assert.match(prompt, /missing notifications, quiet or `needs_attention` alone do not prove disappearance/);
		assert.match(prompt, /Never replace a still-live writer or guess ownership/);
		assert.match(prompt, /Change the recovery input or approach based on failure evidence; never loop unchanged failure/);
		assert.match(prompt, /Prefer resuming a proven eligible retained child using its exact ID/);
		assert.match(prompt, /If unavailable or rejected.*explicitly labeled same-role replacement in a distinct isolated workspace.*exact current inputs, preserved partial work and remaining checks/);
		assert.match(prompt, /clear ownership transfer and parent-captured recovery handoff.*missing final worker response/);
		assert.match(prompt, /Recovery does not reset the iteration count or restrictions/);
	});

	it("recovers without a blanket runtime pause but checkpoints repeated failure and forbids fallback", () => {
		assert.match(prompt, /Recoverable worker failures alone are not grounds to pause/);
		assert.doesNotMatch(prompt, /On a blocking decision, missing required evidence, permission\/runtime failure/);
		assert.match(prompt, /If recovery fails again, no safe supported repair is available, ownership is uncertain, required tools\/model\/provider are unavailable/);
		assert.match(prompt, /task\/mission is paused, cancelled or out of iterations.*checkpoint\/report and ask for the smallest needed decision/);
		assert.match(prompt, /No automatic destructive repair, spending, extra permissions, publication or execution-mode\/model\/provider fallback/);
		assert.match(prompt, /Switching to local implementation, foreground or external CLI requires explicit approval/);
		assert.match(prompt, /On an unresolved blocking decision.*unrecoverable runtime failure, repeated recovery failure/);
	});

	it("pauses on blockers or no progress and never treats a notice as completion", () => {
		assert.match(prompt, /changed attempt produces no new evidence or measurable progress/);
		assert.match(prompt, /status: "waiting", goal: \{ paused: true \}, summary: <checkpoint and decision>/);
		assert.match(prompt, /Do not exceed the selected iteration limit or bypass an existing mission restriction/);
		assert.match(prompt, /Pausing notices does not stop running children/);
		assert.match(prompt, /stop only task-owned work.*never unrelated jobs/);
		assert.match(prompt, /action: "mission\.close".*missionStatus: "completed"/);
		assert.match(prompt, /blocker or exhausted limit is not completion/);
		assert.match(prompt, /Parent owns cleanup of all settled temporary workspaces/);
		assert.match(prompt, /Never discard user work or unpreserved changes/);
		assert.match(prompt, /they do not launch work, replan or guarantee autonomous completion/);
		assert.match(prompt, /does not enforce future model compliance/);
	});
});
