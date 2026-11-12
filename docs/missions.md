# Missions and schedules

Durable records for delegated work: missions wrap runs so you can recover them later, and schedules launch work on a timer.

## Missions

Missions are durable wrappers around runs. The noun map:

- **Project/codebase** — where work happens.
- **Mission** — why delegated work exists and how to recover it later.
- **Run** — one actual subagent execution.
- **Receipt** — proof or a link for an external outcome, such as a PR, CI check, deployment, or release.

Ordinary workflow launches create one enclosing mission by default, with detailed JSON records under `~/.pi/agent/missions/projects/<project-hash>/` linking objectives, run ids, lifecycle status, decisions, artifact paths, and delivery receipts. Workflow children do not create separate missions. Each workflow child attempt is stored in the enclosing mission with its stable workflow key, run id when known, agent, task metadata, timestamps, session and artifact paths, and latest status heartbeat.

Records created under the old default `<project>/.pi/subagents/missions` stay on disk. Continue them by setting `missions.directory` to that path for the project or by copying the record into the new agent-dir project store. There is no automatic migration.

Behavior:

- Automatic persistence failures do not block the run and are reported as `details.missionWarning`. Explicit `missionId` and `mission` requests remain strict before launch.
- Human receipts end with `Mission: <id> (<status>)`, while JSON/structured output text stays unchanged and `details.missionId` is authoritative.
- Pass `mission: false` for an intentionally ephemeral workflow. It creates no mission for the workflow or its children and has no `state` global.
- Set `missions.enabled: false` to disable automatic mission creation; explicit mission fields and actions still work.
- A workflow with a mission can use `await state.get(key)` and `await state.set(key, value)` for durable JSON state. Missing keys return `undefined`. Keys use the same format as `runs.run` keys. Each set takes the state-file lock, reads the latest file, merges the key, and atomically writes `<mission-directory>/<mission-id>/state.json`. The complete file cannot exceed 256 KiB. Each workflow caches the file on its first `get`. A `mission:false` workflow has no `state` global.

An explicit `mission` object must have exactly one non-empty `title` or `summary`. `objective` and `labels` are optional. When supplied, `goal` must be `true`. A goal accepts an optional positive integer `maxIterations` (default 8). Token caps have been removed; token usage remains informational, while monetary `usageBudget.costUsd` limits remain enforced.

```ts
const created = subagent({
  action: "mission.create",
  mission: { title: "Ship auth refresh", objective: "Implement and validate token refresh" }
})
subagent({
  workflowScript: `return runs.run("main", { agent: "worker", task: "Implement the approved auth refresh plan" })`,
  missionId: "<mission-id>"
})

// Or create and attach in one launch
subagent({
  workflowScript: `return runs.run("main", { agent: "worker", task: "Implement the approved plan" })`,
  mission: { title: "Ship auth refresh" }
})
```

### Goal missions

Set `goal: true` to make an open mission an active, bounded continuation driver; no token or monetary budget is imposed:

```ts
subagent({
  action: "mission.create",
  mission: {
    title: "Ship auth refresh",
    objective: "Implement and validate token refresh",
    goal: true,
    maxIterations: 8
  }
})
```

After each parent turn, an eligible idle goal mission sends one continuation message that requests another parent turn. It includes the title, persisted iteration count/limit and next ready action. Pending input, paused/closed goals, open decisions, unresolved linked runs and exhausted iteration limits suppress automatic execution. A latest linked run that is stopped, cancelled or rejected also suppresses continuation, including after `mission.show` refreshes its status. Duplicate wakeups do not spend iterations; lack of a new checkpoint, next action or linked-run progress pauses the goal rather than looping. An aborted parent turn pauses automatic goal execution immediately. A recoverable error or length outcome defers the goal wake while the SDK retries; successful recovery may continue the goal, while unrecovered final settlement pauses it without a wake. The action comes from `state.nextReadyAction`, `state.nextAction`, a state item with `status: "ready"`, an open decision, or linked-run state. A workflow can write `state.nextReadyAction` to tell the next notice exactly what work is ready. When the latest linked workflow has a resumable retained child, the notice names that child as the `resume` target. Non-resumable retained children stay visible in `children.list` with their reason, but goal notices do not present them as resume targets. The extension wakes the parent but never launches children or replans goal work by itself. The parent rechecks the exact mission before acting.

Linked-run token totals are stored on each run and folded into mission `usage` as informational accounting; they never stop execution. Monetary `usageBudget.costUsd` limits remain separate and enforced. Run summaries are recorded on run links and do not overwrite an authored goal checkpoint.

Goal ownership is session-scoped, based on the stable saved Pi session identity (`ownerSessionId`), not project, process ID or working directory. The default project-scoped `mission.list` shows only goals owned by the current saved session; ordinary missions retain their existing project-list behavior. A concrete new objective creates an independent goal in this session; when its valid new mission is created, only this session's previous open goals are cancelled. History, summaries, evidence, counters and files remain, and running jobs are not stopped. Empty or invalid invocations do not replace goals. Same saved-session resume or explicit continuation keeps the existing goal and counters; do not silently reset them. A new objective is not bypassing old counters.

A fresh session starts its own goal without asking old versus new or requiring the original session. Do not discover, adopt or reconcile foreign goals from shared `PLAN.md`, a capsule or global list merely because the directory matches. Global listing or exact foreign inspection is only for an explicit user-directed diagnostic investigation, never a prerequisite for `/goal`; foreign goals are read-only and missing ownership fails closed. A foreign or paused historical goal is not a repository lock, file ownership claim or blocker. Read shared `PLAN.md` and evidence, preserve user uncommitted work and avoid broad overwrites; ask only for a concrete file collision or missing scope. Older live runtimes require restart before ownership protection applies; upgrading does not retroactively fence old sessions or migrate live records.

Iteration accounting is structured and persisted: `goal.maxIterations`, `goal.iterationsStarted` and `goal.iterationActive`. After reassessing the plan, begin implementation/verification with `missionUpdate: { goal: { iteration: "begin" } }`; require success before launching work. An already active iteration does not increment again. After linked runs settle and verification/checkpointing finish, use `{ goal: { iteration: "complete" }, summary: "<checkpoint and evidence links>" }`. At the limit, another begin is rejected and goal status becomes `iteration-limit`; finishing an already admitted iteration remains allowed. Counter-aware runtimes lock and reread the mission record to preserve counter changes. After upgrading the mission runtime, restart all Pi sessions sharing that store: an older completion observer can discard unfamiliar counter fields and overwrite the parent checkpoint, even for another session. Repeated counter reconciliation is not an activation fix. If loss recurs, keep the goal paused, preserve its admission evidence and reconcile only after the runtime mismatch is resolved.

Existing records without structured counters are not reset to zero. They pause for reconciliation from preserved plan/evidence: explicitly supply `missionUpdate.goal.maxIterations`, `iterationsStarted` and, when a cycle is already in progress, `iterationActive`, then resume. Direct active-state reconciliation is allowed only once for a legacy goal with missing counters. Ambiguous history requires an operator decision. Legacy token-only exhaustion is no longer an execution gate; existing explicit pauses, cancellations and decisions remain binding. No persisted live records are rewritten merely by upgrading.

Operator cancellation: `/goal cancel` and `/goal cancel <exact mission ID>` cancel only goals owned by the current saved session. An exact foreign target is rejected. Cancellation preserves history, summaries, evidence, counters and files and does not stop running jobs.

Pause and resume notices with `mission.update` and `{ goal: { paused: true } }` or `{ goal: { paused: false } }`. Set `{ goal: false }` to disable goal mode. `mission.close` also ends the loop.

### Recorded rejection and completed closure

For a goal mission, `mission.close` with `missionStatus: "completed"` and `mission.update` with `status: "completed"` reject completion when the effective acceptance ledger explicitly has `status: "rejected"`. The check reads the current record under the existing mission-file lock, before writing either the record or its index. A concurrent status update cannot skip that check. Waiting, paused and incomplete checkpoints remain usable; failed/cancelled closure remains available.

Runtime-backed goal completion additionally requires current bound acceptance from exactly one explicit producer. The registered async workflow path preserves that producer's ledger without interpreting workflow success as acceptance. New launches invalidate older acceptance authority while retaining historic evidence. Late or unrelated completions cannot authorize the newer launch; multiple result rows are not aggregated or selected among. Truly manual/unlaunched goals retain parent-controlled closure, as do ordinary missions. An admitted goal launch is **pending/unknown**, even before its receipt is bound, and cannot complete until its current matching launch/run has an actual terminal result payload. A terminal status or successful exit alone is not that payload. A known terminal payload with no explicit producer can restore manual closure only when the goal has no prior runtime acceptance obligation; it does not refresh historic PASS. Missing evidence is never thereby verified.

Recovery uses a **new** supported acceptance-producing workflow that evaluates corrected work, not manual ledger deletion. Declare the candidate in the parent-authored child policy, for example `acceptance: { level: "verified", candidate: { files: ["src/input.ts", "test/input.test.ts"] }, verify: [{ id: "check", command: "node check.cjs" }] }`. A rejected command remains rejected; a corrected workflow can supply current bound `verified` evidence. Completion still requires the parent's full acceptance assessment.

Receipt attachment can recover acceptance from the current run's existing published original result payload; recovery does not promote pending data. The normal watcher's slim completion replay/output archive omits the acceptance ledger: if the watcher already consumed the original result before mission binding, terminal status and that archive leave authority unknown. Recovery requires the actual saved result payload or a fresh acceptance-producing launch, not reconstructed events, parsed text or inferred PASS. Replayed/old/implicit late payloads cannot replace an already observed terminal ledger or clear pending/current authority.

Runtime changes require a **new Pi process**, not `/reload`. Leave active sessions and existing missions untouched. For safe activation, start a fresh session with an isolated agent directory, mission store and index, explicitly load this checkout, and create a new test mission there. Do not resume/adopt an existing goal or copy its records. Older running processes retain their old behavior; this change does not retroactively protect a store they can still write. Use a separate store until all writers of any shared store have been deliberately upgraded by the operator.

#### Declared acceptance identity

`acceptance.candidate.files` is a nonempty list of explicit relative regular-file paths beneath the evaluation cwd. No globs, directories, symlinks, absolute paths or traversal are supported. The runtime captures exact bytes (including untracked/ignored files) and explicit absence before and after verification; changes or unreadable identity reject acceptance. These opted-in commands never reuse the tracked-Git verification cache.

The ledger records full SHA-256 digests with canonical object-key ordering, resolved policy/criteria, effective command cwd/options and environment hashes, and the actual producer run ID. Digests and derived verification output are excluded from their own preimages; environment values are not exposed by the identity. At goal closure, the store revalidates the declared files and bound policy/producer under the mission lock. Missing/stale identity cannot authorize runtime-backed closure. This is reproducibility for declared inputs, not attestation of undeclared inputs, observation of transient change-and-revert, or proof of model faithfulness.

`summary` and `nextReadyAction` text remain separate from acceptance identity. Checkpoint changes do not refresh PASS, change iteration accounting, or introduce a new orchestration mode.

### `/goal`: assess, plan, implement, verify

The packaged `/goal` prompt directs the parent through the goal workflow using the mission actions above:

```text
/goal Fix session recovery and verify it; maximum 12 iterations
```

Supply a concrete goal; the iteration override is an ordinary prompt instruction, not a parsed command flag. The default is **8 iterations**, with no mission token budget; separately configured monetary `usageBudget.costUsd` hard limits remain enforced. One iteration is an assess → plan → implement → verify cycle, not a worker, check or status update. An explicit override selects the limit without a separate confirmation step. With no goal, the parent is instructed to ask before creating a mission or changing files.

The parent establishes measurable acceptance, creates or explicitly identifies one enclosing goal mission, assesses the current repository, and updates canonical repository-root `PLAN.md` without replacing unrelated work. It then implements with up to five useful independent isolated coding/test-writing workers, `openai-codex/gpt-6.1-terra:high` for bounded work, integrates and verifies their actual changes, and reassesses remaining acceptance. A missing `PLAN.md` may be created after assessment. Fewer than two useful independent plan writers requires an explicit decision, not silent local implementation. Use Sol 6.1 medium (`openai-codex/gpt-6.1-sol:medium`) for routine, unbounded, complex or correctness-heavy coding; never use Luna for coding workers. Preserve explicit user model/thinking selections.

Before every new iteration, the parent rechecks the original goal and full acceptance criteria against current evidence, revises active steps/dependencies in `PLAN.md`, and archives completed/outdated/superseded steps with their iteration, reason, replacement and evidence links. Valid steps need no cosmetic rewrite; unmet requirements cannot disappear through archiving or an unapproved scope change.

The prompt requires mission-linked workflows, persisted next actions and structured iteration counts, evidence-backed completion, and a paused checkpoint on blockers, no progress or the iteration limit. Increment the persisted count when implementation/verification begins, not per worker, check, notice or cleanup. Routine assessment, checkpoint recording and verified cleanup do not introduce confirmation gates beyond applicable instructions.

For same-session continuation with a supplied or established exact mission ID, use `mission.show` directly; use the current-session `mission.list` only to discover an unknown own match, then establish identity, objective and ownership. Do not reset its count to bypass its restrictions; a concrete new objective creates a replacement for this session only. The mission owns ID, status, iteration count/limit and a concise summary referencing plan/evidence. `PLAN.md` owns full agreed scope and acceptance, with a compact `Current` section indexing source/workspace identities, evidence/history links, remaining work/dependencies, blockers and next action. Existing workflow state owns `nextReadyAction` when present; do not copy the full narrative into all three records or create competing state. Resolve contradictions before work, preserving unrelated plan content.

On continuation, check current mission restrictions, counts/limit and linked-run status, then read compact current state and only changed or missing relevant context. Read applicable instructions initially and the existing plan completely on initial assessment. Reuse reads/discovery/evidence only after a cheap identity check establishes unchanged applicability, content and runtime/tool identity; repeated phases/invocations alone do not invalidate them. Missing, stale or changed identity requires the relevant reread or discovery. Required full reads and full acceptance checks still apply. Notices grant no new authority; pause/cancel and all existing restrictions remain in force. Pausing goal notices does not terminate running children.

This is a parent instruction template backed by runtime iteration admission and bounded automatic wakeups, not a new runner. The parent performs planning, archiving, implementation and acceptance; notices alone prove none of them. Tests exercise the production mission/notice owners and packaged instructions, not future model compliance or live-provider completion.

Run `/reload` after adding/changing this prompt, with no child runs active. Extension/runtime changes still require a Pi restart.

### Managing missions

Use `mission.list`, `mission.show`, `mission.update`, `mission.resolve-decision`, `mission.attach-run`, and `mission.close`.

- Use `mission.update` to record decisions, artifacts, labels, summaries, and delivery receipts while work runs. Adding a decision gates active or completed missions as `needs_decision`; planned and waiting missions keep their lifecycle status while the decision stays visible. Resolve it with `mission.resolve-decision`, `missionId`, the decision `id`, and a resolution in `summary`. A gated mission returns to `active` after its last open decision is resolved.
- `mission.show` includes each workflow child's latest status, phase, update time, session path metadata, and heartbeat. The ledger is a recovery record only. It does not schedule or restart children.
- Receipts are durable links for pull requests, CI, deployments, or releases, each with `kind`, `status`, `title`, `url`, and optional `description`. They record delivery state only; pi-subagents does not merge, poll CI, or deploy.
- Use `mission.close` with a terminal status and summary when a mission is done.
- After compaction or restart, use `mission.show` directly for an established exact ID (`mission.list` only to discover an unknown current-session match). It refreshes linked async status where available; check restrictions and linked-run state, then use linked run ids with normal `status`, `steer`, `resume`, or `stop` actions only when eligible and authorized.
- `mission.list` with `missionScope: "global"` reads the user-local pointer index under the Pi agent directory. Project records remain the source of truth, and missing records are reported as stale rather than hiding other projects. Use global discovery or exact foreign inspection only for explicit user-directed diagnostics; foreign goals are read-only and must not be adopted or mutated.

### Cross-project work

Keep same-project tasks on ordinary subagents. Use an explicit `cwd` for small bounded work in another project.

For substantial or long-running work in another project, open a project-owned Herdr pane with `project.open` and give that project Pi session a narrow mission/result contract (see [extension-api.md](extension-api.md#herdr-integration)). The project pane owns its own subagents; do not model it as ordinary child nesting or expect existing headless runs to move into the pane.

Mission storage configuration (`missions.directory`, `retainTerminal`, `globalIndex`) is in [configuration.md](configuration.md#missions).

## Schedules

Durable schedules are enabled by default and stored per project under `.pi/subagents/schedules/<id>/`.

Create a one-shot schedule:

```ts
subagent({
  action: "schedule.create",
  id: "evening-review",
  name: "Evening review",
  at: "+30m",
  baseRef: "refs/heads/release",
  workflowScript: `return runs.run("main", { agent: "reviewer", task: "Review the current diff." })`
})
```

Create a fixed recurring workflow:

```ts
subagent({ action: "schedule.create", id: "backlog", every: "6h", catchUp: "latest", workflowScript: "return runs.run('main', { agent: 'worker', task: args.task })", args: { task: "Maintain core" } })
```

Fixed intervals support `m`, `h`, `d`, and `w` units and advance from the planned time without completion drift. Schedule arguments are normalized and persisted for exact replay after reload; do not put secrets in them.

Create a quiet recurring workflow whose successful completions stay visible but do not wake the parent session:

```ts
subagent({ action: "schedule.create", id: "nightly-sweep", every: "24h", quiet: true, workflowScript: "..." })
```

Manage schedules with `schedule.list`, `schedule.show`, `schedule.history`, `schedule.pause`, `schedule.resume`, `schedule.run`, `schedule.run-due`, and `schedule.delete`.

Behavior:

- Runs always launch async with fresh context and disable automatic mission creation; mission attachment is deferred from this first slice.
- An optional top-level `baseRef` selects the safe Git ref used by managed worktrees (default `HEAD`); it is persisted with the schedule and forwarded on every fire. The source checkout must still be clean.
- Definitions, bounded history, append-only events, and per-run receipts are stored with mode `0600`.
- `overlap` is currently fixed to `skip`; `catchUp` supports `latest` (default) and `none`.
- A successful `schedule.run` satisfies the next natural fire; a failed manual launch does not skip it.
- `quiet` persists only on recurring (`every`) schedules. Successful automatic fires stay visible without a parent turn; failed, stopped, or paused outcomes still wake the session. One-shot `at` schedules and `schedule.run` stay noisy unless that launch passes `quiet: true`.
- `schedule.run-due` lets an external launcher start due project work without making `pi-subagents` a daemon.
- Calendar recurrence, cron, queue/replace overlap, and the schedule TUI inspector are intentionally deferred to the next slice.
- The old `schedule`, `schedule-list`, `schedule-status`, and `schedule-cancel` actions were removed in a hard cutover.

Disable or bound schedules with the `scheduledRuns` config key in [configuration.md](configuration.md#scheduledruns).
