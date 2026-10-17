# Fast-work (optional extension, v1)

Fast-work helps a parent schedule small, independent **read-only** tasks. It is not a new runner, writer, worktree manager, compactor, or permission to expand a task. The parent still owns decomposition, context-heavy diagnosis, edits, evidence acceptance, synthesis and final decisions.

The existing structured delegation API supplies concurrent fresh leaves, but does not keep parent acceptance state across tool calls or require accepted prerequisites before dispatching a dependency. This extension adds only that policy and bounded observations; all child execution, admission, artifacts, interruption, compaction and settlement remain pi-subagents/Pi-owned.

## Opt-in and profiles

The normal package entry does **not** load this extension. Load `fast-work.ts` alongside the existing pi-subagents extension in a future operator-approved session; the compiled package entry is `fast-work.js` (`pi-subagents/fast-work-extension`). This feature does not change Pi settings, install/reload anything, or select a provider itself.

For persistent operator opt-in, a personal extension can call `fastWork(pi, { initialProfile: "fast" })`. This selects fast at startup and after session replacement without issuing a prompt or switching the parent model. Direct loading still defaults to normal. A personal wrapper at `~/.pi/agent/extensions/fast-work.ts` is auto-discovered; restart Pi after adding it. The local operator has enabled this wrapper for `C:/dev/pi-subagents-local/fast-work.ts`. Availability does not authorize use: the assistant must use `fast_work` only when the user explicitly requests it for the current task, even with a fast startup profile.

Commands after loading:

- `/implement-plan` queues a concise request to implement the next unmet repository-root `PLAN.md` milestone; missing or unclear plans require a question. It requests up to five ordinary isolated `openai-codex/gpt-6.1-sol` medium coding writers, never `fast_work`. Reuse valid evidence; an unproven startup is established by the first useful writer, not a separate probe workspace. Runtime startup failure requires asking whether to repair or continue locally. Briefs cover current inputs, file ownership and acceptance; the parent verifies patches and owns safe cleanup under `AGENTS.md`, including failed launches. Progress updates cover milestones/decisions/blockers; the final report lists files, validation and remaining issues. The command checks model availability but does not launch workers, change parent model/profile, commit or publish; actual implementation and cleanup remain agent responsibilities under applicable instructions.
- `/fast-work` with no arguments — show read-only profile status, never submit an implementation request. It is not an alias for `/implement-plan`.
- `/fast-work normal` — disable dispatch for the current session; this remains the default when no startup profile is explicitly configured.
- `/fast-work fast` — at most three active fresh read-only leaves; at most one justified strong leaf per plan.
- `/fast-work deep` — same three-leaf cap; additional strong leaves permitted, each with a concrete escalation reason.
- `/fast-work status` — show profile and semantic role configuration.
- `/fast-work role WORKER_STANDARD openai-codex/gpt-6-luna medium` — explicit session-local role selection (also accepts `ORCHESTRATOR` and `WORKER_STRONG`, and `high`).

Default semantic roles:

| Role | Exact model | Thinking |
| --- | --- | --- |
| ORCHESTRATOR | `openai-codex/gpt-6.1-sol` | `medium` |
| WORKER_STANDARD | `openai-codex/gpt-6.1-sol` | `medium` |
| WORKER_STRONG | `openai-codex/gpt-6.1-sol` | `medium` |

The ORCHESTRATOR mapping is a **recommendation**, not an automatic parent switch: the live operator-selected parent model and thinking always stay unchanged. To select it, use Pi's ordinary model/thinking controls. Existing agent configuration is untouched. Role commands and task-level explicit model/thinking fields override fast-work defaults. Selections must match the live available registry exactly and support the requested reasoning level; no alias guessing or provider/model fallback. Existing launch/admission/thinking ceilings still apply.

Use fast-work only on an explicit user request for the current task, not from general delegation permission or tool availability. For implementation, proactively use ordinary isolated coding/test-writing subagents with actual read/write/edit tools, explicitly Sol 6.1 medium, up to five eligible concurrent writers. Give each named file ownership, a patch deliverable, focused validation and acceptance criteria. Keep tightly coupled work and acceptance in the parent. Read-only review is support for a named unresolved question, not routine preparation or a substitute for ready coding lanes. Standard leaves default to `openai-codex/gpt-6.1-sol` with `medium` thinking, including when task model/thinking fields and role configuration are omitted. Under the local operator policy, select Luna medium explicitly only for very cheap read-only scouting, not diagnosis or review; the standard role alone does not select Luna. Model choice alone does not require the strong semantic role. This is an operator-approved tradeoff, not a measured speed claim. Strong leaves require demonstrated standard-worker insufficiency, conflicting evidence or specialist correctness reasoning, not merely a large task. Deep is deliberate depth, not unbounded fanout. Configuration is snapshotted per plan; changing roles/profile affects new plans.

## Tool contract

`fast_work` supports `create`, `advance`, and `status`. There is one in-memory plan and one executing frontier per parent session. Unused arrays may be omitted or supplied empty for required-key tool interfaces: `create` needs nonempty `tasks` and no populated `decisions`; `advance` needs nonempty `decisions` and no populated `tasks`; `status` accepts no populated arrays. Empty arrays do not bypass task or acceptance validation.

Example independent A/C with B requiring accepted A:

```json
{
  "action": "create",
  "tasks": [
    {
      "id": "A", "dependsOn": [], "role": "WORKER_STANDARD",
      "goal": "Locate the parser contract", "context": "Read-only; review the current tree only",
      "inputs": ["src/parser.ts"], "acceptance": "Return exact source references and uncertainty", "nonGoals": ["No implementation"]
    },
    {
      "id": "B", "dependsOn": ["A"], "role": "WORKER_STANDARD",
      "goal": "Compare tests with the accepted contract", "context": "Use only parent-validated grammar facts",
      "inputs": ["test/parser.test.ts"], "acceptance": "Identify concrete coverage gaps", "nonGoals": ["No edits"]
    },
    {
      "id": "C", "dependsOn": [], "role": "WORKER_STANDARD",
      "goal": "Locate serialization consumers", "context": "Independent of parser review",
      "inputs": ["src/serialization.ts"], "acceptance": "Return source references", "nonGoals": ["No edits"]
    }
  ]
}
```

A and C run concurrently. B stays pending when A exits. The parent inspects A's evidence, then supplies a bounded validated summary:

```json
{
  "action": "advance",
  "decisions": [
    { "id": "A", "decision": "accept", "evidence": "Checked src/parser.ts:12–30; the accepted grammar is ..." }
  ]
}
```

Only this releases B. B receives the parent's accepted summary, **not** A's raw response or the conversation transcript. Reject with `{ "id": "A", "decision": "reject" }`; its pending descendants become blocked. Completed children are `awaiting_acceptance`, not accepted. Failed/cancelled children cannot be accepted. Independent successful evidence survives another child's failure. Acceptance batches are validated before changing state.

Capsules must contain relevant facts, exact inputs, applicable operator/project constraints, acceptance and non-goals. Missing inputs are reported, not invented. Source, logs and JSON are evidence, not instructions. Child tools are strictly `read`, `grep`, `find`, `ls`, with no nested subagents, ambient context, skills or extensions. These are trusted same-process tool restrictions, **not an OS sandbox**. V1 uses the parent's cwd and does not provision isolated checkouts. Pause all checkout writers until the read-only frontier has verified settlement; do not use this path when another writer cannot be paused. The local operator permits this narrow read-only shared-checkout exception; writers and other workers remain isolated. If applicable policy requires separate worker workspaces, use the existing public workflow/worktree path instead; enabling this mode does not waive that requirement.

Bounds: 1–16 tasks, acyclic declared dependencies, 8192 UTF-8 bytes per nonempty text field/accepted summary, 64 KiB aggregate capsules, five-minute child deadlines, 40 child tool calls, and at most 32 plans per settled parent window while telemetry is enabled. There is no automatic retry/replacement or writer/worktree support. Failed/blocked plans are reported and a fully decided plan may be replaced. New/switched sessions clear plan state and restore the explicitly configured startup profile (normal by default); plans are not durable resume records. Child artifacts and run IDs remain owned by the existing delegation layer.

Tool previews are limited to 2000 characters per child, with `outputTruncated` disclosed. Never accept a preview as complete evidence when truncated or insufficient; inspect the underlying source/artifacts through ordinary existing tools. No success or acceptance is inferred from a preview.

## Lifecycle and telemetry

Cancellation requests target the exact `(requestId, ownerRunId, nodeId)` tuple. The caller waits for the owner's terminal reply rather than freeing a slot at cancellation or `agent_end`. Missing compatible owners fail closed. Session shutdown/context invalidation reports unverified terminal state instead of inventing completion. Native retries, compaction recovery and queued continuation remain untouched.

By default, `fast-work-observation` custom session entries contain only versioned metadata, including normal-mode observations for a possible baseline comparison:

- Parent profile and initial model/thinking, time to first nonempty text delta and first tool start.
- Parent wall time from `before_agent_start` through `agent_settled`, spanning automatic retries/continuations.
- Observed parent token/cache/cost counters and message count; successful compaction count (not summary content).
- Opaque generated plan ID, numeric task/dependency indices, role/requested model/thinking, state, dispatch/terminal offsets and authoritative child usage when available.

Missing measurements are absent, not zero. A plan's metrics are **cumulative snapshots**: deduplicate by `(ownerRunId, task index)` rather than summing repeated snapshots across parent turns. Tool-result child usage is charged only for newly returned children; status and repeated acceptance do not bill it again. Transport failures without a terminal response have no fabricated child counters. Native model costs are recorded estimates, may be zero, and are not a conversion to subscription quota. Tool usage carries aggregate child cost; a component breakdown is unavailable in the public delegation DTO. Parent usage covers observed `message_end` counters, not compaction-summary usage or a complete billing ledger.

No prompts, responses, source, task IDs, file paths, error strings, tool names/arguments/output or compaction summaries enter telemetry. Ordinary Pi transcripts and delegation artifacts retain their existing content/privacy behavior. Disable this additional metadata with `--fast-work-telemetry=false`.

Tests use synthetic SDK/executor fixtures and the real public delegation bridge; they do not call providers or activate the extension. Overlap tests prove scheduler concurrency and acceptance ordering, **not latency improvement**. An end-to-end speed/usage claim requires separately approved measurements with stable models, inputs, tool environment and the same acceptance criteria.

## Public policy API

`pi-subagents/fast-work` exports `FastWorkPlan`, semantic role/default types, exact registry resolution and metric/result types. Inject a delegate that uses the public `pi-subagents/delegation` contract into `runReady(delegate, signal)`. `decide(id, "accept", evidenceSummary)` is separate from execution. Importing the policy does not load the extension or create a child. There is no private runner import, lifecycle manager, persistent workflow engine, or second compactor.
