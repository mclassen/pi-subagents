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

- **Direct mode:** The parent handles focused, serial, context-heavy, or causally coupled work directly. Skip workflow ceremony. A Sol parent (medium or high) reviews and reasons directly by default; do not reflexively commission one or two Luna reviewers.
- **Orchestrator mode:** Use only for eligible independent child lanes that materially improve evidence, review, or isolated execution. The parent remains causal owner and default coder—especially when Sol—and keeps user intent, constraints, authority, routing, arbitration, integration, final acceptance, and publication. Child implementation is limited to frozen mechanical slices that independently pass the writer gate; never prescribe writer → review → writer merely because work is substantial.

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

- Delegation is subordinate to user/global eligibility policy. Keep work local unless a child is obviously independent, context-light, easily parallel, and independently verifiable with less packet/review cost than parent execution. A Sol parent codes and reviews by default; delegate implementation only for an eligible frozen mechanical slice. Avoid duplicate scouts, overlapping writers, vague prompts, and delegation merely because work is non-trivial or needs multiple tool calls.
- Start the parent on Luna high and use Luna xhigh for bounded difficult implementation or concrete reproducible failures. Escalate to Sol medium only when actual code/context complexity, causal debugging, coordination, mixed work, or final-review evidence requires it; treat Sol medium as the normal automatic ceiling. Sol high is manual-only and reserved for the most complex scenarios possible. Route ordinary child scouting, research, tests, verification, and focused review to Luna high; route an eligible frozen writer slice to Luna xhigh.
- Terra is retired from automatic routing and Luna max is never automatic. Keep Terra manually selectable only as a representative comparison fallback; exact deployment overrides still belong in user/project settings or profiles.
- Give every child a compact meta-prompt checklist: objective; repo/cwd/ref; authority/edit boundary; relevant files/contracts and constraints; success/acceptance criteria; validation; expected output/report; and stop/ask conditions. See `references/prompting-and-roles.md`.
- Give every child a distinct isolated execution workspace/resource, including read-only children. For repository work, provision a managed temporary worktree/clone/snapshot containing the exact target; keep one writer per cwd/worktree. See `references/multi-lane-orchestration.md` for lane mechanics.
- Normal fanout is at most three depth-one lanes. Permit four to six independent lanes only with distinct seams and outputs, isolated writer workspaces, non-overlapping contracts, recorded integration order, and material benefit; more than six requires explicit user approval. Testing that changes files, generated state, or shared lifecycle resources is mutation.
- Nested fanout is one additional level, at most three children, and normally no more than six live descendants total. Nested writers use separate managed worktrees or temporary clones and return scoped commits or patches; every nested launch explicitly uses Luna high/xhigh, never Sol/inherited Sol or Terra. The root confirms durable handoffs and managed cleanup, preserving dirty or divergent work rather than force-discarding it.
- Keep long/high-output validation out of chat: prefer `interactive_shell` dispatch/background monitors, bounded logs, or subagent-owned reports; return a concise summary plus report path unless same-turn output is required. Do not use `interactive_shell` as an implicit fallback for a failed `subagent` lane; see `references/execution-controls.md`.
- Treat subagent workflow, child launch, prompt runtime, extension load, and child tooling setup failures as lane infrastructure blockers. Stop, report the exact failure and run/worktree state, verify a clean worktree or capture a partial diff, and use only a clear same-protocol retry or an owner-approved execution-mode fallback.
- For cross-codebase work, record the repo, explicit `cwd`, authority boundary, and expected output before launch.
- Make parallel prompts distinct by source seam, evidence, and decision. Do not clone prompts with only item numbers swapped.
- Prefer parent review for Sol-medium or Sol-high work. A single Luna-high reviewer is permitted only for a genuinely simple, read-only review when the parent supplies a context-complete packet containing the exact target diff, relevant contracts/source, acceptance criteria, and validation command. Do not launch one or two Luna reviewers by default; multiple reviewers require independent high-impact risks and explicit justification.
- For Pi extension repos under `~/.pi/agent/extensions`, put lane worktrees outside extension auto-discovery, such as `~/.pi/agent/worktrees`.
- Preserve capability ceilings, including child tool limits and allowed-agent restrictions.
- Preserve parent authority and escalate unresolved choices.
- Treat receipts, CI, review bots, and external-run records as evidence, not authority.
- For backlog maintenance, releases, merge queues, or other public-repo mutation policy, load the matching user/project skill. This package defines delegation primitives, not private policy.
- As a conservative orchestration policy, do not pass a hard `toolBudget` or tight `usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools. If interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
