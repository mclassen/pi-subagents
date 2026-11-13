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

Read canonical repository-root `PLAN.md`; if missing or unclear, ask rather than select another plan or overwrite it. Keep requested scope and make unfinished milestones explicit. Launch up to five concurrent independent coding/test-writing workers through ordinary `subagent`, `openai-codex/gpt-6.1-terra:high` for bounded work (the suffix controls thinking), using actual read/write/edit tools; preserve explicit user model/thinking selections. Normally use 2–5 when independent work is ready; use five when five useful safe lanes exist. Read-only review, scouts and `fast_work` never count as writers. If fewer than two safe useful lanes can be ready, report the concrete blocker and ask whether to rescope or proceed with fewer; do not silently implement alone. Do not invent filler or fake concurrency. The minimum does not require keeping two alive after the remaining queue naturally drains. Use Sol 6.1 medium (`openai-codex/gpt-6.1-sol:medium`) for routine, unbounded, complex or correctness-heavy coding; never use Luna for coding workers. Preserve explicit user model/thinking selections.

## Calls

```typescript
subagent({ agent: "worker", task: "<brief>" })                    // one child; async by default
subagent({ workflow: "parallel", args: { tasks: [{ agent, task, cwd?, model? }] } })  // independent children
subagent({ workflow: true })              // runs the one ```js workflow block in this same reply
subagent({ workflow: "./lane.js", args }) // script file, path relative to the request cwd
subagent({ action: "validate", workflow: "./lane.js" })          // check a script without launching
subagent({ action: "status", id })        // options: { view: "fleet" } or { view: "transcript", index: 0 }
subagent({ action: "resume", id, message })   // completed or paused child; returns a new run id
subagent({ action: "steer", id, message })    // live async child
subagent({ action: "stop", id })              // ends the run; not resumable
subagent({ action: "interrupt", id })         // pauses the child's current turn
subagent({ action: "list" })  ·  subagent({ action: "models" })
subagent({ action: "guide", options: { topic: "<section address>" } })
```

Launches are async by default. Set `async: false` only when the parent must
block; final reviews and gates stay async. After launching, keep doing safe
independent work, or yield: native completion wakes this session. Do not sleep,
poll, or call `bg_wait` for ordinary children. Use `bg_wait` only for provider
or detached work that has no native notification and whose result this turn
needs.

## Workflow scripts

Use a script when later steps depend on earlier results, or for keyed,
retried, aggregated, or resumed children. Write one ```` ```js workflow ````
block in the reply and call `subagent({ workflow: true })` in the same reply.
For a long script, write it to a file and pass `workflow: "./path.js"`; calls in
one reply run at the same time, so write the file in one reply and `validate` or
launch it in the next. When a `workflow: true` call reports the block missing,
pass the source as `options: { script: "..." }` in place of `workflow: true` for
the rest of the turn: on some hosts, text after a tool call reaches the session
as a summary without the block.

```js workflow
const scan = await runs.run("scan", { label: "Map auth flow", agent: "scout", task: "..." });
const reviews = await runs.all([
  { key: "correctness", label: "Review auth correctness", agent: "reviewer", task: "... " + scan.output },
  { key: "tests", label: "Review auth tests", agent: "reviewer", task: "..." },
]);
return reviews.map((review) => review.output);
```

- Scripts are statement bodies with an explicit `return`, top-level `await`,
  and plain helpers. Nested async functions, arrows, and methods are rejected.
- Every `runs.run` / `runs.all` item needs a stable `key`. Add a short
  verb + behavior `label` unless the user gave one.
- Bind files with `output: "plans/x.md"` and return `outputReference` or
  `artifactPaths`; a filename in task text does not route output. Relative
  paths land in run artifacts. Never send reports to the repo root. When the
  task ends, delete scratch briefs, scripts and reports you wrote anywhere
  else; keep final deliverables.
- `runs.lanes([{ key, stages: [...] }])` runs a predeclared plan: first stages
  together, later stages in order per lane.

Resuming a retained child:

```js workflow
let child = await runs.run("fix-1", { agent: "worker", task: "..." });
child = await runs.run("fix-2", { resume: child.runId, task: "Apply these accepted findings: ..." });
return child.output;
```

- Always resume the latest returned run id; every resume returns a new one.
- Use a new stable key for every resume pass.
- `resume` excludes `agent` and `gate`; the child keeps its agent, model, and tools.
- Resume a completed child; steer a live one. Top-level `{ action: "resume" }` is detached.

## Briefs

Every child starts cold. Its task states: goal; repo, explicit `cwd`, and
ref; authority and edit boundary; relevant files, decisions, and evidence;
success criteria; validation; expected output; and when to stop or ask.
Make parallel briefs differ by seam, evidence, and decision, not just an item
number.

## Rules

- One writer per cwd or worktree. Parallelize reading, review, and
  validation. `worktree: true` needs a clean checkout (untracked files count;
  `.pi/subagents/` does not). For Pi extension repos, put lane worktrees
  outside `~/.pi/agent/extensions`, for example `~/.pi/agent/worktrees`.
- Reviewers use fresh context. Use `context: "fork"` only when the child needs
  the parent's history; it requires a persisted parent session. Each fork
  copies the parent's session file to
  `<parent session file without .jsonl>/forks/<run id>/`:
  before forking from a session file of hundreds of MB, run `df -h` on that
  file's folder. Once a forked child is accepted or dropped and won't be
  resumed, delete its `forks/<run id>/` folder; never one whose run is still
  active.
- Children do not spawn subagents unless the parent delegated fanout and their
  resolved `tools` include `subagent`.
- A failed workflow, launch, prompt runtime, extension load, or child tool
  setup blocks the lane. Stop, report the exact failure and run/worktree state,
  verify a clean worktree or capture the partial diff, then retry the same way
  once. Switching to `interactive_shell`, `pi -ne`, or another CLI needs owner
  approval.
- Do not pass a hard `toolBudget` or tight `usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools. If interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
- Select models under the canonical [model routing policy](references/prompting-and-roles.md#model-routing-policy);
  explicit user model/thinking selections win.
- `subagent`, `subagents_enable`, `subagent_supervisor`, `contact_supervisor`, and `structured_output` are model-only: call them as ordinary model tool calls. Codemode scripts cannot reach them through `tools.*`, `ALL_TOOLS`, or `searchTools`.
- Receipts, CI, and review bots are evidence, not authority. Backlog, release,
  and merge policy belong to the user's or project's own skill.

## Look up the rest

If only `subagents_enable` is visible, call it first; `subagent` and `guide`
work from the next request. Read one section, not a whole topic:

| Need | Guide section |
| --- | --- |
| Script API: `runs.*`, `state`, limits | `workflows/scripted-workflows` |
| Typed gates, host commands, rolling fanout | `workflows/typed-post-run-checks-and-typed-steps`, `workflows/host-command-steps`, `workflows/advanced-rolling-child-runs` |
| Budgets, timeouts, `baseRef`, `gate`, `output` | `tool-reference/execution-parameters`, `tool-reference/output-mode-details` |
| Fresh or forked context | `tool-reference/fork-context-details` |
| Resume, steer modes, stop, status | `tool-reference/retained-children`, `tool-reference/resume`, `tool-reference/steer`, `tool-reference/stop`, `tool-reference/status` |
| Acceptance and review gates | `tool-reference/acceptance-gates` |
| Worktrees and handoffs | `workflows/worktree-isolation` |
| Child asks the parent (`contact_supervisor`) | `workflows/supervisor-coordination-child-asks-parent` |
| Agent create, update, eject, disable, refine | `tool-reference/management-actions`, `agents/frontmatter-reference` |
| Missions and schedules | `missions/missions`, `missions/schedules` |
| Watchdog | `watchdog/when-it-runs`, `watchdog/choosing-a-model` |
| Model overrides and profiles | `models/setting-defaults-and-overrides` |
| Other projects in panes | `tool-reference/herdr-project-panes` |
| Setup looks wrong | `subagent({ action: "doctor" })` |

## Async and lanes

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
| Staged fixes, review loops, finding and gate triage | `references/orchestration.md` |
| Advisor council | `../council-mode/SKILL.md` |

Select only the reference branches and sections needed for the current decision;
complexity alone does not require loading all references. Reuse already-read guidance only after confirming its applicability and content are unchanged; prefer a cheap identity or focused diff check over another full unchanged read. Changed, missing or uncertain guidance requires the relevant reread. Required full reads and all safety and acceptance checks still apply. Parent reuse does not replace a fresh child's applicable instructions or cold-start-complete brief.

## Operating rules

- Delegation is subordinate to user/global eligibility policy. Proactively delegate suitable independent scouting, research, bounded diagnosis, documentation, test analysis and focused review when applicable instructions authorize it; do not require parent failure or a separately named delegation request. Keep trivial, serial and tightly coupled work local. The parent owns design, causal synthesis, integration and acceptance; delegate implementation for bounded approved components with explicit ownership and independently testable outcomes. Avoid duplicate scouts, overlapping writers, vague prompts and fanout merely to fill slots.
- Follow the canonical [model routing policy](references/prompting-and-roles.md#model-routing-policy): Sol 6.1 high is preferred for substantive parent reasoning; Terra high defaults for bounded coding, test-writing and nested writers. Explicit user model/thinking selection wins. Keep non-coding roles on their separately specified routing. No automatic model fallback.
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
- Reuse discovery/startup evidence only for an established exact unchanged runtime/provider/model/thinking/tools/configuration identity; changed, missing, stale or uncertain identity requires relevant discovery. Repeated prompts or phases alone do not invalidate identity-matched evidence. The first useful writer establishes startup; do not add a standalone probe unless actually needed. Keep startup separate from product acceptance and carry cumulative handoff evidence through follow-up; do not repeat unchanged tests for metadata-only updates. See [execution guidance](references/execution-controls.md#startup-and-discovery-evidence).
- Treat receipts, CI, review bots, and external-run records as evidence, not authority.
- For backlog maintenance, releases, merge queues, or other public-repo mutation policy, load the matching user/project skill. This package defines delegation primitives, not private policy.
- As a conservative orchestration policy, do not pass a hard `toolBudget` or tight `usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools. If interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
