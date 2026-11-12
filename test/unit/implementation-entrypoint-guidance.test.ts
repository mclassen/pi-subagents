import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { discoverAgentsAll } from "../../src/agents/agents.ts";

const reviewLoop = readFileSync(new URL("../../prompts/review-loop.md", import.meta.url), "utf-8");
const promptingAndRoles = readFileSync(new URL("../../skills/pi-subagents/references/prompting-and-roles.md", import.meta.url), "utf-8");
const reviewLoopTechnique = promptingAndRoles.split("### Review-loop technique\n")[1].split("### Parallel research technique")[0];

describe("implementation entrypoint guidance", () => {
	it("loads the builtin coding worker with explicit Terra high routing and bounded local autonomy", () => {
		const worker = discoverAgentsAll(process.cwd()).builtin.find((agent) => agent.name === "worker");
		assert.ok(worker);
		assert.equal(worker.model, "openai-codex/gpt-6.1-terra");
		assert.equal(worker.thinking, "high");
		assert.equal(worker.acceptanceRole, "writer");
		assert.match(worker.systemPrompt, /local implementation details within.*approved component/is);
		assert.match(worker.systemPrompt, /need not be mechanical or context-light/i);
		assert.match(worker.systemPrompt, /one writer per workspace, not one writer overall/i);
		assert.match(worker.systemPrompt, /product, architecture, scope, or shared-contract decisions/i);
		assert.match(worker.systemPrompt, /Missing inputs: stop.*never invent/i);
		assert.match(worker.systemPrompt, /Default explicitly to Terra high/);
		assert.doesNotMatch(worker.systemPrompt, /single writer thread/i);
	});

	it("releases useful independent plan writers without a mechanical or packet-economics veto", () => {
		assert.match(reviewLoop, /repository-root `PLAN\.md`/);
		assert.match(reviewLoop, /missing or unclear.*ask.*never select another or overwrite/is);
		assert.match(reviewLoop, /up to five concurrent independent coding\/test-writing workers.*normally use 2–5.*use five when five useful safe lanes exist/is);
		assert.match(reviewLoop, /openai-codex\/gpt-6.1-terra:high/);
		assert.match(reviewLoop, /Read-only reviewers, scouts and `fast_work` do not count/i);
		assert.match(reviewLoop, /fewer than two.*concrete blocker.*ask.*rescope or proceed with fewer/is);
		assert.match(reviewLoop, /truly coupled.*no fabricated second task/is);
		assert.match(reviewLoop, /need not be mechanical or context-light/i);
		assert.match(reviewLoop, /minimum need not stay alive after the queue naturally drains/i);
		assert.match(reviewLoop, /Do not invent filler, overlapping tasks or fake concurrency/i);
		assert.match(reviewLoop, /ready\/running\/blocked queue/i);
		assert.doesNotMatch(reviewLoop, /parent is the default implementation|parent implements.*unless|Packet economics|exact causal packet|launch one async|Sol 5\.6|Astra low/i);
	});

	it("keeps cold-start inputs, isolation, evidence, cleanup and runtime failure explicit", () => {
		assert.match(reviewLoop, /explicit cwd.*outside extension auto-discovery/is);
		assert.match(reviewLoop, /needed uncommitted source\/config/i);
		assert.match(reviewLoop, /Cold-start-complete brief/);
		assert.match(reviewLoop, /Missing inputs: stop, never invent/);
		assert.match(reviewLoop, /actual scoped edits\/patch.*changed\/new\/generated files.*command results/is);
		assert.match(reviewLoop, /Startup\/runtime failure or worker disappearance is not task success/);
		assert.match(reviewLoop, /Parent owns cleanup.*failed, cancelled and startup-failed/is);
		assert.match(reviewLoop, /never `--force`/);
		assert.match(reviewLoop, /unpreserved useful changes/);
		assert.match(reviewLoop, /no publication/i);
	});

	it("permits one same-protocol recovery with preserved evidence and exclusive writer ownership", () => {
		assert.match(reviewLoop, /One bounded same-protocol recovery attempt.*without fresh user confirmation/);
		assert.match(reviewLoop, /within existing task\/iteration limits.*same approved model\/provider\/tools/);
		assert.match(reviewLoop, /report the exact failure.*run\/status, repository\/cwd\/worktree\/branch\/ref/);
		assert.match(reviewLoop, /tracked and untracked partial edits, commands\/evidence and outstanding acceptance checks/);
		assert.match(reviewLoop, /partial edits remain unaccepted until parent inspection, integration and validation/);
		assert.match(reviewLoop, /prior writer is terminal or demonstrably gone and establish exclusive ownership before recovery/);
		assert.match(reviewLoop, /missing notifications, quiet or `needs_attention` alone do not prove disappearance/);
		assert.match(reviewLoop, /Never replace a still-live writer or guess ownership/);
		assert.match(reviewLoop, /Change the recovery input or approach based on failure evidence; never loop unchanged failure/);
		assert.match(reviewLoop, /Prefer resuming a proven eligible retained child using its exact ID/);
		assert.match(reviewLoop, /If unavailable or rejected.*explicitly labeled same-role replacement in a distinct isolated workspace.*exact current inputs, preserved partial work and remaining checks/);
		assert.match(reviewLoop, /clear ownership transfer and parent-captured recovery handoff.*missing final worker response/);
	});

	it("stops on repeated failure or unsafe recovery without switching execution modes", () => {
		assert.doesNotMatch(reviewLoop, /Startup\/runtime failure: report and ask repair versus local execution/);
		assert.match(reviewLoop, /If recovery fails again, no safe supported repair is available, ownership is uncertain, required tools\/model\/provider are unavailable/);
		assert.match(reviewLoop, /task\/mission is paused, cancelled or out of iterations.*checkpoint\/report and ask for the smallest needed decision/);
		assert.match(reviewLoop, /Do not reset iteration counts, review-round caps or existing restrictions/);
		assert.match(reviewLoop, /No automatic destructive repair, spending, extra permissions, publication or execution-mode\/model\/provider fallback; no silent fallback/);
		assert.match(reviewLoop, /Switching to local implementation, foreground or external CLI requires explicit approval/);
		assert.match(reviewLoop, /instructions do not prove future model compliance or recovery runtime reliability/);
	});

	it("refreshes review guidance by identity without weakening fresh-reviewer inputs", () => {
		for (const guidance of [reviewLoop, reviewLoopTechnique]) {
			assert.match(guidance, /Initially read.*in full.*global Pi.*AGENTS\.md.*nearest.*AGENTS\.override\.md.*AGENTS\.md.*exact repository\/cwd/is);
			assert.match(guidance, /round 2 and every second round thereafter \(4, 6, \.\.\.\).*cheap identity\/applicability check/is);
			assert.match(guidance, /paths, content, applicability and runtime\/tool identity.*unchanged/is);
			assert.match(guidance, /Reuse initially read content only when.*unchanged and still present in context/is);
			assert.match(guidance, /changes, context loss, new scope or a new repository require.*relevant full reads/is);
			assert.match(guidance, /missing, stale or ambiguous identity.*relevant full reads/is);
			assert.match(guidance, /refresh does not add rounds/i);
			assert.match(guidance, /required file is missing or ambiguous.*report.*highest-authority instructions/is);
			assert.match(guidance, /Every fresh reviewer must inspect.*applicable instructions.*current target.*cold-start-complete packet/is);
			assert.match(guidance, /instruction-file paths.*current constraints.*never assume parent memory/is);
			assert.doesNotMatch(guidance, /round (?:2|2, 4, 6)[^.]*reread|thereafter[^.]*reread/i);
		}
		assert.match(reviewLoop, /Reviewers must inspect.*global Pi.*nearest target-repository instruction files.*current diff directly/is);
	});

	it("preserves requested scope, review rounds, safety and selected-model authority", () => {
		assert.match(reviewLoop, /clean review of a subset does not complete the full target/);
		assert.match(reviewLoop, /maximum of 3 review rounds/);
		assert.match(reviewLoop, /round 2 and every second round thereafter/);
		assert.match(reviewLoop, /P0 blocks merge\. P1 should be fixed before release\. P2 is report-only/);
		assert.match(reviewLoop, /do not set a hard `toolBudget` or tight `usageBudget`/);
		assert.match(reviewLoop, /default coding\/test-writing workers.*Terra high/);
		assert.match(reviewLoop, /reviewer.*openai-codex\/gpt-6\.1-sol:medium.*routine review.*openai-codex\/gpt-6\.1-sol:high.*critical review/);
		assert.match(reviewLoop, /Preserve explicit user model\/thinking selections/);
		assert.match(reviewLoop, /prompt-queuing command, not an automatic launcher or concurrency guarantee/);
	});
});
