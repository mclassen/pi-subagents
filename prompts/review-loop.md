---
description: Review/fix loop until clean
---

Run a parent-orchestrated review loop for the requested work.

Use the `subagent` tool. Keep the parent session as the loop controller and final decision-maker. Child subagents must receive concrete role-specific tasks; they must not run subagents or manage the loop themselves unless the parent intentionally selected an explicit fanout agent whose builtin `tools` includes `subagent` for that assigned fanout.

Default to a maximum of 3 review rounds unless I specify a different cap. Count a review round each time fresh-context reviewers inspect the current diff after any parent or worker implementation/fix pass. Stop early when reviewers find no P0 findings, no P1 fixes worth doing now, and no approved P2 notes that should be handled in this loop.

“Implementation requested” does not automatically require a child writer. Apply the global delegation eligibility gate before the initial implementation and before every fix iteration. Context-heavy causal design and real execution remain in the parent, especially when the parent is Sol.

The parent is the default implementation owner and starts on Luna high; use Luna xhigh for bounded difficult implementation or concrete reproducible failures. Escalate to Sol medium only when actual code/context complexity, causal debugging, coordination, mixed work, or final-review evidence requires it; treat Sol medium as the normal automatic ceiling. For genuinely complex diagnosis, architecture, or consequential review, suggest Sol high but require explicit user selection. Use Luna high for fresh focused reviewers and Luna xhigh for an eligible frozen child-writer slice. Never route Luna max or Terra automatically; Terra remains a manual comparison fallback only. Delegate a child writer only when every condition holds:
1. Contract and architecture are frozen.
2. Defect has an exact causal packet, allowed files, RED test, and acceptance criterion.
3. Slice is mechanical, context-light, and independently verifiable.
4. Parent will not need to re-derive or substantially repair the result.
5. Slice owns no cross-language authority, protocol/durable snapshot schema, candidate/baseline isolation, journal/resume/replacement semantics, cross-subsystem causality, remote execution acceptance/promotion, process lifecycle, or architecture decision.

If any condition fails, the parent implements directly; use children for fresh read-only review of that slice. Using a Sol child does not fix an ownership/context failure. Iteration quotas never force worker delegation.

If delegation is eligible, launch one async `worker` in a distinct managed temporary worktree/clone and require a scoped commit or patch; never let a child writer share the parent checkout. If the current diff is already the target, start with review. Never pre-script worker → reviewers → next worker for uncertain work. Use `workflowScript` only when all scripted implementation stages are already frozen and independently eligible; otherwise launch follow-up runs after parent synthesis. For an initial workflowScript, pass `async: true` so the main chat is unblocked; do not set `clarify: true` unless I explicitly want the foreground clarify UI.

As a conservative orchestration policy, do not set a hard `toolBudget` or tight `usageBudget` on implementation or fix workers. A default tool budget blocks read/search tools rather than mutation tools, and reported usage has no reservation model, so count or usage limits still do not measure delivery safety. Give each writer a narrow delivery slice and an outer elapsed deadline with enough margin. Before that deadline, request a checkpoint after the current tool returns with changed files, build/test state, remaining work, and commit or PR state. An elapsed timeout is not a mutation-safe boundary and must not be the checkpoint trigger.

For each review round, launch fresh-context `reviewer` agents in parallel, each in a distinct temporary read-only worktree/clone/snapshot containing the same exact integrated target diff. Record base/ref and focused diff identity; never share the parent checkout or another reviewer workspace. Reviewers must inspect repository instructions and current diff directly from files and commands. They must not rely on main conversation history or edit files.

Tell reviewers to filter on evidence, not severity. They should report only concrete current issues caused or made reachable by the target diff, with source proof, a test or repro, or a contract contradiction. Ask them to label findings P0/P1/P2 and end with `Merge verdict: BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. P0 blocks merge. P1 should be fixed before release. P2 is report-only. Use `blockers only` only for final pre-merge re-checks after P1/P2 findings are already captured, or for explicit emergency hotfix lanes.

Choose review angles from the actual change. Common angles are correctness/regressions, tests/validation, and simplicity/maintainability. Add security, performance, docs/API contracts, or user-flow validation when the work calls for it. Prefer three strong reviewers over many vague reviewers.

After reviewers return, synthesize their feedback into:
- P0 blockers or scope/product/architecture decisions that need user approval;
- P1 fixes worth doing now;
- P2 report-only notes or optional improvements;
- feedback to ignore or defer, with a short reason.

For every implementation/fix iteration, record before choosing the next action:
- Implementation owner: `parent` or `worker`.
- Delegation eligibility: eligible/ineligible and why.
- Packet economics: whether assembling and verifying the child causal packet was cheaper than a direct parent fix, with a short basis.

Do not blindly apply every reviewer suggestion. If reviewers surface an unapproved product, scope, or architecture decision, pause and ask me before launching a fix worker.

When an async implementation worker completes, the parent first checks diff/stat and unexpected artifacts, then integrates only an accepted scoped commit or patch into the parent target and validates there. Treat that integrated handoff as the transition into review, not final completion, unless I explicitly asked for worker-only work, review-only output, or to stop after implementation.

When there are fixes worth doing now and the workflow is implementation-authorized, the parent reclassifies and owns the next causal slice. The parent implements it directly unless the full delegation gate passes. Only then launch one async forked `worker`, in its distinct managed temporary workspace and without hard tool-call caps, to apply that frozen mechanical slice. Ask it to preserve the approved scope, run focused validation, and report changed files, scoped commit or patch, commands with exit codes, validation evidence, surprises, and anything left undone.

After any parent or worker fix pass, run another review round only when it made material changes or addressed non-trivial findings. Do not keep looping for optional polish, speculative improvements, or findings already deferred by the parent.

For a targeted follow-up review, ask only three questions: whether the named finding was resolved, whether the fix introduced a new concrete defect in the fix blast radius, and whether prior P1/P2 notes still stand. End with a fix verdict and the merge verdict.

Stop and summarize when one of these is true:
- reviewers find no P0 blockers or P1 fixes worth doing now;
- remaining feedback is optional, speculative, or intentionally deferred;
- reviewers surface an unapproved decision that needs me;
- the max review-round cap is reached.

On completion, inspect the final diff yourself, run or confirm focused validation where appropriate, and summarize the loop: rounds run, fixes applied, validation, remaining deferred items, and why the loop stopped.

Additional target, implementation request, max-iteration cap, or review focus from the slash command invocation:

$@
