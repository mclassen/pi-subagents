# Multi-Lane Orchestration

Use this reference when several independent tasks need coordinated workers, worktrees, or repositories. It defines lane ownership; use the other pi-subagents references for run controls, prompts, and mission details. The parent remains the final decision-maker.

Create lanes only after delegation is operator-authorized and each lane materially improves evidence, independent review, specialization, useful parallelism, or isolated execution. Do not manufacture parallelism: keep dependent work serial, and only split work when each lane has a distinct decision and useful output.

## Mandatory implementation-topology preflight

Before launching a writer for substantial mutation work, classify the implementation as **single-seam** or **multi-seam**. Two or more independently testable contracts or source boundaries make it multi-seam. One PR does not imply one writer, and the one-writer-per-worktree rule prevents concurrent ownership conflicts; it does not authorize an issue-wide commission.

Record the classification and evidence on a lane board before writer launch. For multi-seam work, give each isolated component writer exclusive file or contract ownership and focused validation gates. Require every component to produce a committed or otherwise durable handoff, then start a separate integration-only owner after the component handoffs are ready. Mechanically reject and repartition a writer prompt if it owns all major outcomes across multiple independent boundaries.

A single complete writer remains valid only when the board records evidence that the work is genuinely one seam or that splitting it would create overlapping ownership or artificial handoffs. This preflight must not manufacture parallelism: do not split tightly coupled work merely to increase the lane count.

## Lane board and authority

Before multiple mutation-capable lanes start, record this board in the parent context:

`Lane | repo/cwd | exact decision | claimed files or contract | isolation path | authority | next gate | handoff | why independent`

Record the isolation path before the first mutation. Do not split one source seam or decision into duplicate lanes. Make overlapping work one lane with one source of truth.

For every lane, record the delivery target, allowed actions, required validation, and review rigor. For cross-repository work, name the shared contract and which repository changes first. A blocked decision is a lane state: record the owner, options, recommended default, and evidence needed to continue.

## Expanded writer fanout and nesting

Normal fanout is at most three depth-one lanes. Use four to six independent lanes—including mutation/test-writing lanes—only when each has a distinct seam/output, isolated writer workspace, non-overlapping contract, recorded integration order, and material benefit; more than six requires explicit user approval. Testing that changes files, generated state, or shared lifecycle resources is a mutation lane.

Nested delegation is exceptional. A root-designated fanout child with `subagent` may spawn one additional level, at most three children, within a normal total of six live descendants. A nested writer must use `worktree: true` or a recorded temporary clone, own a non-overlapping contract, and return a scoped commit or captured patch plus validation. Every nested launch explicitly uses Luna or Terra, never Sol/inherited Sol. Nested children do not recurse, merge, integrate, or decide scope; the intermediate synthesizes and the root reviews, integrates, accepts, and confirms cleanup.

## Partitioned runs

Give every run a distinct isolated workspace/resource and explicit `cwd`; never share a checkout/directory between children, including read-only runs. Set `worktree: true` for a managed repository worktree, or provision a temporary clone/snapshot containing the exact target when worktree creation cannot represent an uncommitted diff. Keep one writer per repo/cwd/worktree.

For Pi extension repositories, keep lane worktrees outside auto-discovered extension directories such as `~/.pi/agent/extensions`. A stale extension worktree there can auto-load duplicate tools and shortcuts. Remove or move it only after its handoff is durable, the worktree is clean, and no run owns it.

Partition fanout by repository, source seam, decision, or review angle. Each run needs a stable key, lane-specific task, and a managed output path when a file is needed. Do not launch prompts that differ only by item name or broad file glob.

### Cold-start packets and bounded orchestration audits

Every child packet must stand alone: include the goal, exact repository/cwd/ref, authority and edit boundary, relevant context/evidence, success criteria, validation, expected output, and stop/escalation rules. Do not rely on parent history, an issue number, or a broad glob alone. An orchestration audit by a top-reasoning critic model is read-only and returns at most three cited omissions; use high thinking only as an explicit parent/user escalation, never as an autonomous root or a parallel placeholder.

Use one async `workflowScript` for a coordinated wave. Use `runs.all` for independent lanes and `runs.run` for dependent lane stages. Give cross-repository runs explicit `cwd` values and lane-qualified outputs. Use `outputMode: "file-only"` when a report must survive the run or feed a later stage. Keep scratch outputs relative so they live under subagent artifacts; use absolute paths only for durable memory, approved docs paths, or final handoff files.

## Keep independent work moving

While one lane waits, run safe independent preparation, validation, or fresh read-only review lanes. Do not block the parent just because a run is active. If no safe lane remains, record the blocker and the event that will reopen work.

In an ordinary interactive session, completion wakes the parent; after useful
async lanes are launched or triaged, yield rather than use
`bg_wait({ all: true })` as a barrier. “Continue/orchestrate/work until
done” means keep the board moving while safe immediate work remains. If only
async lanes are running, record the revisit trigger and yield.

An ordinary coordinated workflow has one mission. Use its durable state, artifacts, run records, and receipts for recovery. Treat a receipt as evidence, not as authority or acceptance.

After an eligible child writer produces a candidate, the parent checks its diff/artifacts, integrates only the accepted scoped commit or patch, and validates in the parent target. Then run required fresh-context read-only reviewers, each in a distinct snapshot of that exact integrated target. The parent decides finding disposition. Parent implements accepted fixes by default; reuse the lane writer only when the next frozen mechanical slice independently passes the delegation gate, then rerun only the affected gate.

## Handoff, cleanup, and recovery

Use stable lane-qualified artifact paths for reports and review output. A writer handoff states lane status, repository/worktree, base/ref, changed files, commit or patch, validation, open decisions, next action, artifact paths, and cleanup state. Copy only final evidence to memory, a mission record, or a PR/comment, then remove scratch files from the active worktree before closing the lane.

For backlog lanes and other subagent-governed workflows, a setup/runtime/tooling failure remains an infrastructure blocker. Preserve the exact failure, run/status, and repository/cwd/worktree/branch/ref state; verify a clean worktree or capture any partial diff before a same-protocol retry or asking the owner. Do not start another writer or switch to an external, foreground, or CLI execution mode without explicit owner approval.

Keep an unmanaged worktree until its handoff is durable, no run owns it, and no later gate needs it. Managed worktrees may be removed after durable patch/handoff capture; the root confirms each manifest's cleanup state. Clean up only inside recorded authority, never with `--force`. If work is dirty/divergent, a run stops, or ownership is uncertain, preserve the worktree/artifacts, record state and recovery owner, and resume it or create one replacement from the handoff. Never discard uncommitted work or start another writer while ownership is uncertain.

Before completion, inspect the board. Every lane must be terminal or blocked with a named next action. Confirm one writer per repo/cwd/worktree, required validation, fresh read-only review, durable handoff, integration disposition, and cleanup state. The root reports outcomes, evidence, residual risks, and the next decision.
