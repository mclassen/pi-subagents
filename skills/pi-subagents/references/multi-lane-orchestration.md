# Multi-Lane Orchestration

Use this reference when several independent tasks need coordinated workers, worktrees, or repositories. It defines lane ownership; use the other pi-subagents references for run controls, prompts, and mission details. The parent remains the final decision-maker.

Create lanes only after delegation is operator-authorized and each lane materially improves evidence, independent review, specialization, useful parallelism, or isolated execution. Do not manufacture parallelism: keep dependent work serial, and only split work when each lane has a distinct decision and useful output.

## Mandatory implementation-topology preflight

Before launching a writer for substantial mutation work, classify the implementation as **single-seam** or **multi-seam**. Two or more independently testable contracts or source boundaries make it multi-seam. One PR does not imply one writer, and the one-writer-per-worktree rule prevents concurrent ownership conflicts; it does not authorize an issue-wide commission.

Record the classification and evidence on a lane board before writer launch. For multi-seam work, freeze the smallest shared interface needed to release independently eligible component writers, each with exclusive file/contract ownership and a focused gate. The parent integrates accepted component handoffs as their dependencies permit. Do not require a separate integration worker or wait for all unrelated components. Repartition a writer prompt that owns multiple independent boundaries; keep genuinely coupled boundaries with the parent.

Bounded approved components with explicit ownership and independently testable outcomes qualify; they need not be mechanical or context-light. Workers may solve local implementation details inside scope; escalate new product, architecture or shared-contract decisions. Parent being Sol, or faster on one slice, is not a blanket reason to take all independent coding. Keep genuinely coupled/shared-state work and integration/acceptance in the parent.

For plan implementation, read canonical repository-root `PLAN.md`; if missing or unclear, ask, never select another plan or overwrite it. Keep requested scope; incremental milestones must leave incompleteness explicit. Launch 2–5 concurrent independent coding/test-writing workers through ordinary `subagent`, explicitly `openai-codex/gpt-6.1-sol:medium` (suffix controls thinking), with actual read/write/edit tools. Read-only review, scouts and `fast_work` never count as writers. If fewer than two safe useful lanes can be ready, report the concrete blocker and ask whether to rescope or proceed with fewer; do not silently implement alone. Do not manufacture parallelism by splitting tightly coupled work or inventing filler. The minimum does not require keeping two alive after the remaining queue naturally drains.

## Lane board and authority

Before multiple mutation-capable lanes start, record this board in the parent context:

`Lane | state (ready/running/blocked) | files/contract | dependencies | workspace/base | gate | authority | handoff | why independent`

Record the isolation path before the first mutation. Do not split one source seam or decision into duplicate lanes. Make overlapping work one lane with one source of truth.

For every lane, record the delivery target, allowed actions, required validation, and review rigor. For cross-repository work, name the shared contract and which repository changes first. A blocked decision is a lane state: record the owner, options, recommended default, and evidence needed to continue.

## Expanded writer fanout and nesting

Normal fanout is up to five concurrent depth-one lanes, subject to tighter user/project limits. With five ready eligible coding slices, launch five; with fewer, launch only those ready. Every writer needs a distinct seam/output, isolated workspace, non-overlapping contract, focused gate and integration order; more than five requires explicit user approval. Testing that changes files, generated state, or shared lifecycle resources is a mutation lane.

Nested delegation is exceptional. A root-designated fanout child with `subagent` may spawn one additional level, at most three children, within a normal total of six live descendants. A nested writer must use `worktree: true` or a recorded temporary clone, own a non-overlapping contract, and return a scoped commit or captured patch plus validation. Every nested launch follows the [canonical model routing policy](prompting-and-roles.md#model-routing-policy). Nested children do not recurse, merge, integrate, or decide scope; the intermediate synthesizes and the root reviews, integrates, accepts, and confirms cleanup.

## Partitioned runs

Give every run a distinct temporary isolated workspace/resource and explicit `cwd`; never share the parent checkout or a checkout/directory between children, including read-only runs except the documented operator-enabled `fast_work` exception. Set `worktree: true` for a managed repository worktree when HEAD exactly matches current inputs, or provision a temporary clone/snapshot containing the exact target, including needed uncommitted source/config and provisioned dependencies. Keep one writer per workspace, not one overall.

For Pi extension repositories, keep lane worktrees outside auto-discovered extension directories such as `~/.pi/agent/extensions`. A stale extension worktree there can auto-load duplicate tools and shortcuts. Remove or move it only after its useful work is integrated or durably dispositioned and no active run or later gate needs it, following the parent-owned cleanup checklist below.

Partition fanout by repository, source seam, decision, or review angle. Each run needs a stable key, lane-specific task, and a managed output path when a file is needed. Do not launch prompts that differ only by item name or broad file glob.

### Cold-start packets and bounded orchestration audits

Every child packet must stand alone: objective and plan requirements; exact workspace/cwd/base/current-source identity; applicable instructions and prior decisions/evidence; relevant source symbols/contracts/callers and adjacent consumers; owned files and prohibited edits; dependencies; acceptance and focused commands; patch/handoff location; and stop/escalation rules. Fresh children do not inherit parent history. Provide context-rich current inputs, including needed uncommitted source/config and provisioned dependencies. Missing inputs: stop, never invent. Do not rely on an issue number or broad glob alone. An orchestration audit by a top-reasoning critic model is read-only and returns at most three cited omissions; use high thinking only as an explicit parent/user escalation, never as an autonomous root or a parallel placeholder.

Use one async `workflowScript` for a coordinated wave. Use `runs.all` for independent lanes and `runs.run` for dependent lane stages. Give cross-repository runs explicit `cwd` values and lane-qualified outputs. Use `outputMode: "file-only"` when a report must survive the run or feed a later stage. Keep scratch outputs relative so they live under subagent artifacts; use absolute paths only for durable memory, approved docs paths, or final handoff files.

## Keep independent work moving

Track ready/running/blocked coding lanes and their actual dependencies. Launch ready eligible writers promptly and refill freed slots after acceptance of a scoped handoff, without waiting for an unrelated lane or a whole wave. While a lane waits, take the next safe independent coding action; use preparation or read-only review only when it resolves a named acceptance gap. If ready work stays idle, record the concrete contract, resource or runtime blocker. If no safe lane remains, record the event that will reopen work. Never invent lanes to fill capacity.

In an ordinary interactive session, completion wakes the parent; after useful
async lanes are launched or triaged, yield rather than use
`bg_wait({ all: true })` as a barrier. “Continue/orchestrate/work until
done” means keep the board moving while safe immediate work remains. If only
async lanes are running, record the revisit trigger and yield.

An ordinary coordinated workflow has one mission. Use its durable state, artifacts, run records, and receipts for recovery. Treat a receipt as evidence, not as authority or acceptance.

After a child writer produces a candidate, require actual scoped edits/patch, changed/new/generated files, command results and unresolved issues. The parent checks diff/stat and unexpected artifacts, integrates only accepted scope, and validates in the original target before acceptance. Then run required fresh-context read-only reviewers, each in a distinct snapshot of that exact integrated target. The parent decides finding disposition and assigns bounded independent fixes to ready writers while keeping coupled fixes local; rerun only affected gates.

## Handoff, cleanup, and recovery

Use stable lane-qualified artifact paths for reports and review output. A writer handoff states lane status, repository/worktree, base/ref, changed files, commit or patch, validation, open decisions, next action, artifact paths, and cleanup state. Carry that evidence cumulatively through follow-up, retaining prior results and naming only changed scope, affected checks and remaining gaps; do not repeat unchanged tests for metadata-only updates. Startup evidence is separate from product acceptance; see [startup and discovery evidence](execution-controls.md#startup-and-discovery-evidence). Copy only final evidence to memory, a mission record, or a PR/comment, then remove scratch files from the active worktree before closing the lane.

A failed/disappeared runner is not task success. Preserve the exact failure, run/status, repository/cwd/worktree/branch/ref, tracked AND untracked partial edits, commands/evidence and remaining acceptance checks; partial work stays unaccepted until parent inspection/integration/validation. Confirm the old writer is terminal or demonstrably gone and establish exclusive ownership; quiet output, missing notifications or `needs_attention` alone are not proof.

One bounded same-protocol recovery attempt is authorized without fresh user confirmation on the same approved model/provider/tools within existing task/iteration limits. Prefer eligible retained-child resume by exact ID; if unavailable or rejected, use an explicitly labeled same-role replacement in a distinct isolated workspace with current inputs, preserved partial work and remaining checks. Record ownership transfer and a parent-captured recovery handoff, and change the approach based on failure evidence. If recovery fails again or no safe authorized action remains, checkpoint/report and ask for the smallest needed decision. No automatic execution-mode/model/provider fallback; local implementation or external/foreground/CLI switching still requires explicit owner approval. See [failed lane recovery](execution-controls.md#failed-lane-recovery-and-execution-mode-changes) for full stop conditions and authority boundaries.

The parent owns cleanup for all settled lanes, including failed, cancelled and startup-failed lanes:

1. Preserve needed patch/handoff/log/recovery evidence outside temporary workspaces.
2. Confirm no active run or later gate needs the workspace and useful work is integrated or otherwise durably dispositioned.
3. Verify exact ownership/path and account for tracked/untracked/submodule contents. Standing cleanup approval does not authorize deletion of user work, uncertain ownership or unpreserved useful changes; retain those paths with a named recovery owner.
4. Delete only redundant agent-owned files/copied inputs/disposable outputs, then use ordinary `git worktree remove` / `prune`, never `--force`. Uncommitted agent changes alone do not require retaining unused copies once safely preserved/integrated. Do not change runtime discard authority or use it to bypass confirmation.
5. Verify deletion and report retained paths and reasons; do not wait for push. Do not start a replacement writer while ownership is uncertain.

Before completion, inspect the board. Every lane must be terminal or blocked with a named next action. Confirm one writer per repo/cwd/worktree, required validation, fresh read-only review, durable handoff, integration disposition, and cleanup state. The root reports outcomes, evidence, residual risks, and the next decision.
