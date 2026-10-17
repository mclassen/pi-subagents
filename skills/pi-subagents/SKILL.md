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

- **Direct mode:** The parent handles focused, serial, context-heavy, or causally coupled work directly. Skip workflow ceremony. A Sol parent (medium or high) reviews and reasons directly by default; do not reflexively commission one or two Luna reviewers.
- **Orchestrator mode:** Launch ready eligible independent coding/test-writing lanes when applicable instructions authorize them. The parent owns user intent, shared contracts, causal decisions, integration, final acceptance and publication, and codes tightly coupled work directly. Child implementation still requires a frozen mechanical slice that independently passes the user/global writer gate; the parent's model is not a reason to withhold an eligible lane. Never prescribe writer → review → writer merely because work is substantial.
This skill is for the root parent orchestrator only; do not inject or follow it inside children. Ordinary children do not launch subagents. An explicitly assigned fanout child whose resolved `tools` includes `subagent` may spawn one further level only for assigned work. Nested writers require separate managed temporary worktrees/clones, non-overlapping contracts, and scoped commits or captured patches. Nested children cannot recurse, merge, or integrate; the intermediate synthesizes for the root.

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

- Delegation is subordinate to user/global eligibility policy. Proactively delegate suitable independent scouting, research, bounded diagnosis, documentation, test analysis and focused review when applicable instructions authorize it; do not require parent failure or a separately named delegation request. Keep trivial, serial and tightly coupled work local. The parent owns design, causal synthesis, integration and acceptance; delegate implementation only for an eligible frozen mechanical slice. Avoid duplicate scouts, overlapping writers, vague prompts and fanout merely to fill slots.
- Follow the canonical [model routing policy](references/prompting-and-roles.md#model-routing-policy): Sol 6.1 high is preferred for substantive parent reasoning; Sol 6.1 medium defaults for coding, tests, verification and helpers. Explicit parent selection wins. Luna medium is only an explicitly selected cheap bounded read-only lookup, never implementation, review or verification. No automatic model fallback.
- Give every child a compact meta-prompt checklist: objective; repo/cwd/ref; authority/edit boundary; relevant files/contracts and constraints; success/acceptance criteria; validation; expected output/report; and stop/ask conditions. See `references/prompting-and-roles.md`.
- Before launching a writer for substantial mutation work, classify it as single-seam or multi-seam. Partition independently eligible components across exclusive owners, focused gates and durable handoffs; the parent integrates accepted work as dependencies permit. See `references/multi-lane-orchestration.md`.
- Give every child a distinct isolated execution workspace/resource, including read-only children, except operator-enabled fast-work: up to three bounded read-only leaves may share the parent's checkout while all checkout writers are paused until verified settlement. That exception permits no edits, commands, nested delegation or publication. Other repository workers use a managed temporary worktree/clone/snapshot containing the exact target; keep one writer per cwd/worktree. See `references/multi-lane-orchestration.md` for lane mechanics.
- Normal fanout is up to five concurrent depth-one lanes, subject to tighter user/project limits. With five ready eligible coding slices, launch five; with fewer, launch only those ready. Each needs a distinct seam/output, isolated workspace, non-overlapping ownership, focused gate and integration order; more than five requires explicit user approval. Testing that changes files, generated state, or shared lifecycle resources is mutation.
- Maintain a compact ready/running/blocked coding queue. Freeze the smallest shared interface needed to release independent writers, rather than completing the entire design first. Refill freed slots promptly after each accepted scoped handoff is integrated; do not wait for an unrelated lane or a whole wave. When ready work stays idle, name the actual dependency, resource or runtime blocker. Do not treat read-only scouts or reviewers as coding progress, and do not invent tasks to fill slots.
- Nested fanout is one additional level, at most three children, and normally no more than six live descendants total. Nested writers use separate managed worktrees or temporary clones and return scoped commits or patches; nested model selection follows the canonical model routing policy. The root confirms durable handoffs and managed cleanup, preserving dirty or divergent work rather than force-discarding it.
- Keep long/high-output validation out of chat: prefer `interactive_shell` dispatch/background monitors, bounded logs, or subagent-owned reports; return a concise summary plus report path unless same-turn output is required. Do not use `interactive_shell` as an implicit fallback for a failed `subagent` lane; see `references/execution-controls.md`.
- Treat subagent workflow, child launch, prompt runtime, extension load, and child tooling setup failures as lane infrastructure blockers. Stop, report the exact failure and run/worktree state, verify a clean worktree or capture a partial diff, and use only a clear same-protocol retry or an owner-approved execution-mode fallback.
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
