---
name: pi-subagents
description: |
  Delegate to builtin or custom subagents for single-agent handoffs, parallel
  review, scripted chaining, async work, forked context, and coordinated
  workflows. Use when one parent agent should stay in control while children
  supply focused context, planning, review, or execution.
---

# Pi Subagents

Choose a mode subject to user/global delegation eligibility:

Once authorized, choose the smallest bounded mode that earns its token and elapsed-time overhead:

- **Direct mode:** The parent handles trivial, serial, or causally coupled work directly. Context-rich bounded components can still be delegated with complete briefs. Skip workflow ceremony. A Sol parent (medium or high) reviews and reasons directly by default; do not reflexively commission one or two Luna reviewers.
- **Orchestrator mode:** Launch ready eligible independent coding/test-writing lanes when applicable instructions authorize them. The parent owns user intent, shared contracts, causal decisions, integration, final acceptance and publication, and codes tightly coupled work directly. Bounded approved components with exclusive ownership and independently testable outcomes qualify; they need not be mechanical or context-light. Freeze only shared interfaces needed for independence; workers solve local implementation details inside scope and escalate new product, architecture or shared-contract decisions. The parent's model or speed on one slice is not a blanket reason to take all independent coding. Never prescribe writer → review → writer merely because work is substantial.
This skill is for the root parent orchestrator only; do not inject or follow it inside children. Ordinary children do not launch subagents. An explicitly assigned fanout child whose resolved `tools` includes `subagent` may spawn one further level only for assigned work. Nested writers require separate managed temporary worktrees/clones, non-overlapping contracts, and scoped commits or captured patches. Nested children cannot recurse, merge, or integrate; the intermediate synthesizes for the root.

## Plan implementation

Read canonical repository-root `PLAN.md`; if missing or unclear, ask rather than select another plan or overwrite it. Keep requested scope and make unfinished milestones explicit. Launch 2–5 concurrent independent coding/test-writing workers through ordinary `subagent`, explicitly `openai-codex/gpt-6.1-sol:medium` (the suffix controls thinking), using actual read/write/edit tools. Read-only review, scouts and `fast_work` never count as writers. If fewer than two safe useful lanes can be ready, report the concrete blocker and ask whether to rescope or proceed with fewer; do not silently implement alone. Do not invent filler or fake concurrency. The minimum does not require keeping two alive after the remaining queue naturally drains.

## Launch shape

| Need | Use |
| --- | --- |
| One bounded task for one child | direct `{ agent, task }` |
| JavaScript control flow or data-dependent branching; sequence, fanout, retry, rolling fanout, or aggregation | `workflowScript` with `runs.run(...)` / `runs.all(...)` |
| A broad plan split into visible narrow stages per lane | `workflowScript` with `runs.lanes([{ key, stages: [...] }])` |
| Independent worktree or repository lanes | `references/multi-lane-orchestration.md` |
| Council of advisors | `../council-mode/SKILL.md` |
| Management, status, steering, authoring, or inspection | `action` |

`workflowScript` is code-driven: `runs.run(...)` for keyed steps,
`runs.all([...])` for fanout, plain JavaScript for branching and aggregation.
Keep scripts portable: use top-level `await`, plain helpers, or explicit Promise
chains, not nested async helpers. Legacy top-level `chain` / `tasks` inputs and
durable `.chain.md` execution are inspection or migration material only.

Use `runs.lanes(...)` only inside a `workflowScript`, not as a top-level mode,
when a broad, predeclared plan benefits from visible per-lane stages; otherwise
use ordinary `runs.run(...)` / `runs.all(...)`. See the [canonical staged-lane
example](../../docs/workflows.md#parallel-sequential-lanes). Keep assignments
bounded, but do not add stages or ceremony just to satisfy this skill.

Use async/background by default. Set `async:false` only when the parent must
block. Final reviews, validation gates, oracle checks, and publication checks
stay async.

In an ordinary interactive session, yield after launching or triaging useful
async lanes and let Pi wake the parent on completion; ordinary async subagents
already have native completion notifications, so do not call `bg_wait()` merely
because a child is active. Use blocking `bg_wait()` only for provider,
detached, or other background work without a native notification when a
headless/run-to-completion contract or a required same-turn artifact makes the
result necessary before this turn ends. For
“continue/orchestrate/work until done,” keep the lane board moving while a safe
immediate action remains; if only async lanes are running, record the revisit
trigger and yield.

Package agents appear in `subagent({ action: "list" })`. External CLI/job agents
use their own runner contract. Do not pass native Pi child options to them unless
that runner explicitly supports the option.

## Read the reference for the branch

| Branch | Read |
| --- | --- |
| Delegate or choose roles, prompts, models, or slash commands | `references/prompting-and-roles.md` |
| Execute single, scripted, async, scheduled, mission, forked, watchdog, oracle, or intercom workflows | `references/execution-controls.md` |
| Review, validate, triage gate failures, or prepare delivery | `references/review-and-validation.md` |
| Coordinate lanes, worktrees, repositories, or writer waves | `references/multi-lane-orchestration.md` |
| List, create, edit, disable, eject, or expose agents/RPC | `references/management-authoring-rpc.md` |
| Check safety constraints, recipes, or error handling | `references/constraints-and-recipes.md` |

For complex work, read `prompting-and-roles.md` and `execution-controls.md`, then
load `review-and-validation.md` and `constraints-and-recipes.md` before launch or
review.

## Operating rules

- Delegation is subordinate to user/global eligibility policy. Proactively delegate suitable independent scouting, research, bounded diagnosis, documentation, test analysis and focused review when applicable instructions authorize it; do not require parent failure or a separately named delegation request. Keep trivial, serial and tightly coupled work local. The parent owns design, causal synthesis, integration and acceptance; delegate implementation for bounded approved components with explicit ownership and independently testable outcomes. Avoid duplicate scouts, overlapping writers, vague prompts and fanout merely to fill slots.
- Follow the canonical [model routing policy](references/prompting-and-roles.md#model-routing-policy): Sol 6.1 high is preferred for substantive parent reasoning; Sol 6.1 medium defaults for coding, tests, verification and helpers. Explicit parent selection wins. Luna medium is only an explicitly selected cheap bounded read-only lookup, never implementation, review or verification. No automatic model fallback.
- Give every child a cold-start-complete brief: objective and plan requirements; exact workspace/base/current-source identity; applicable instructions, prior decisions/evidence; relevant symbols/contracts/callers and adjacent consumers; owned files and prohibited edits; dependencies; acceptance and focused commands; patch/handoff location; and stop/escalation rules. Supply needed uncommitted source/config and provisioned dependencies; missing inputs mean stop, never invent. See `references/prompting-and-roles.md`.
- Before launching a writer for substantial mutation work, classify it as single-seam or multi-seam. Partition independently eligible components across exclusive owners, focused gates and durable handoffs; the parent integrates accepted work as dependencies permit. See `references/multi-lane-orchestration.md`.
- Give every child a distinct isolated execution workspace/resource, including read-only children, except operator-enabled fast-work: up to three bounded read-only leaves may share the parent's checkout while all checkout writers are paused until verified settlement. That exception permits no edits, commands, nested delegation or publication. Other repository workers use a managed temporary worktree/clone/snapshot containing the exact target; keep one writer per cwd/worktree. See `references/multi-lane-orchestration.md` for lane mechanics.
- Normal fanout is up to five concurrent depth-one lanes, subject to tighter user/project limits. With five ready eligible coding slices, launch five; with fewer, launch only those ready. Each needs a distinct seam/output, isolated workspace, non-overlapping ownership, focused gate and integration order; more than five requires explicit user approval. Testing that changes files, generated state, or shared lifecycle resources is mutation.
- Maintain a compact ready/running/blocked coding queue. Freeze the smallest shared interface needed to release independent writers, rather than completing the entire design first. Refill freed slots promptly after each accepted scoped handoff is integrated; do not wait for an unrelated lane or a whole wave. When ready work stays idle, name the actual dependency, resource or runtime blocker. Do not treat read-only scouts or reviewers as coding progress, and do not invent tasks to fill slots.
- Nested fanout is one additional level, at most three children, and normally no more than six live descendants total. Nested writers use separate managed worktrees or temporary clones and return scoped commits or patches; nested model selection follows the canonical model routing policy. The root confirms durable handoffs and owns safe cleanup of every settled lane, including failures and cancellations. Preserve useful evidence outside temporary workspaces, then delete redundant agent-owned copies only after integration or durable disposition; uncommitted agent changes alone are not a retention requirement. See the cleanup checklist in `references/multi-lane-orchestration.md`.
- Keep long/high-output validation out of chat: prefer `interactive_shell` dispatch/background monitors, bounded logs, or subagent-owned reports; return a concise summary plus report path unless same-turn output is required. Do not use `interactive_shell` as an implicit fallback for a failed `subagent` lane; see `references/execution-controls.md`.
- A failed/disappeared runner is not task success. Report exact failure and run/worktree state; preserve tracked AND untracked partial edits and evidence, unaccepted until parent inspection/integration/validation. Confirm the old writer is terminal or demonstrably gone and exclusive ownership is clear. One bounded same-protocol recovery attempt is authorized without fresh user confirmation on the same approved model/provider/tools within existing limits: prefer eligible exact-ID resume, otherwise an explicitly labeled same-role replacement in a distinct isolated workspace with current inputs, partial work and remaining checks. Change the approach using failure evidence. If recovery fails again or no safe authorized action remains, checkpoint/report and ask; never automatically switch execution mode/model/provider. See [failed lane recovery](references/execution-controls.md#failed-lane-recovery-and-execution-mode-changes) for ownership, handoff and authority safeguards.
- For cross-codebase work, record the repo, explicit `cwd`, authority boundary, and expected output before launch.
- Make parallel prompts distinct by source seam, evidence, and decision. Do not clone prompts with only item numbers swapped.
- Keep substantive synthesis and acceptance in the parent. Use a focused read-only reviewer for an independent bounded question when it adds useful analysis or resolves uncertainty that deterministic checks cannot settle. Select models under the canonical model routing policy; provide the exact target diff, relevant contracts/source, acceptance criteria and validation command. Do not duplicate parent review or launch reviewers reflexively; multiple reviewers need distinct independent questions and a material benefit.
- For Pi extension repos under `~/.pi/agent/extensions`, put lane worktrees outside extension auto-discovery, such as `~/.pi/agent/worktrees`.
- Preserve capability ceilings, including child tool limits and allowed-agent restrictions.
- Preserve parent authority and escalate unresolved choices.
- Reuse discovery/startup evidence for unchanged runtime, provider/model and tool configuration; repeated prompts or phases alone do not invalidate it. The first useful writer establishes startup; do not add a standalone probe unless actually needed. Keep startup separate from product acceptance and carry cumulative handoff evidence through follow-up; do not repeat unchanged tests for metadata-only updates. See [execution guidance](references/execution-controls.md#startup-and-discovery-evidence).
- Treat receipts, CI, review bots, and external-run records as evidence, not authority.
- For backlog maintenance, releases, merge queues, or other public-repo mutation policy, load the matching user/project skill. This package defines delegation primitives, not private policy.
- As a conservative orchestration policy, do not pass a hard `toolBudget` or tight `usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools. If interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
