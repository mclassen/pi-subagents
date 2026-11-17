---
description: Work a durable goal to verified acceptance in measured iterations
argument-hint: "<goal> [maximum iterations]"
---

Work automatically toward the supplied goal until every acceptance criterion passes, the iteration limit is reached, or a real blocker needs me. Each iteration attacks one unmet criterion and ends with a measured result. Do not return control while authorized work remains, and do not ask for routine confirmation.

## Start

- If the invocation contains no concrete goal, ask for it and stop without creating a mission or changing files.
- Read applicable instructions and only the source and evidence the goal needs. Default to a maximum of 8 iterations unless I specify a different positive integer; proceed without asking me to confirm it. No monetary or token budget is imposed by this template.
- Goals belong to the stable saved-session identity (`ownerSessionId`), not the repository, process ID or cwd. A concrete NEW objective creates a new goal in this session: when the valid new mission is created, only this session's previous open goals are cancelled. Their history, summaries, evidence, counters and files remain; running jobs are not stopped. Empty or invalid invocations do not replace goals. A fresh session starts its own goal without asking old versus new or requiring the original session. Do not discover, adopt or reconcile foreign goals from shared `PLAN.md`, a capsule or global list merely because the directory matches. Global listing or exact foreign inspection is only for an explicit user-directed diagnostic investigation, never a prerequisite for `/goal`. A foreign or paused historical goal is not a repository lock, file ownership claim or blocker; ask only for a concrete file collision or missing scope.
- For same saved-session resume or explicit continuation, keep the existing goal and counters and check its exact mission ID with `action: "mission.show"`; use current-session `action: "mission.list"` only to discover an unknown own match. A new user objective is not bypassing old counters; never reset counters.
- Otherwise create one mission with `action: "mission.create"`, `mission: { title: <short goal>, objective: <goal plus the acceptance criteria>, goal: true, maxIterations: <selected positive limit> }` and `missionStatus: "active"`. Require the returned mission id before implementation. Its `goal` counters are authoritative.

## Acceptance contract

Before the first iteration, write 3–7 numbered acceptance criteria into `PLAN.md` under `## Current`. Each criterion is observable, can be proven by you within your authority, and names its check: a command, test or measurement with the pass threshold. One criterion keeps the existing checks the change can affect green, so nothing that works now breaks. Name what must stay unchanged. Run every check once before changing anything and record the baseline.

Anything only I can do (commit/push/publication, live runs on my hardware, product or scope decisions) goes into a separate **Handoff** list, not into acceptance. The goal closes when the criteria pass; handoffs are reported, not awaited.

Do not invent requirements or silently shrink the goal. If the goal cannot be turned into checkable criteria without a decision from me, ask once with a concrete proposal.

## Iterate

1. Pick the top unmet criterion. Start the iteration with `mission.update`, `missionUpdate: { goal: { iteration: "begin" } }`; an active iteration continues without another begin.
2. State the hypothesis in one line: what is wrong and what change should move the criterion.
3. Make the smallest change that tests it, directly in the target checkout. Then run that criterion's check, plus the repository checks that the change requires. A new test is evidence only if it failed before the change. Leave the checkout building and the tests passing; placeholders, stubs and TODOs are not progress.
4. Complete the iteration with `missionUpdate: { goal: { iteration: "complete", progress: "advanced" | "none" }, summary: <checkpoint> }`. `advanced` means a criterion passed or its measured value improved. A new hypothesis, plan edit, review or report is `none`.
5. Append one line to the iteration log in `PLAN.md`: `iN · criterion · change · result · evidence path`. Then continue with the next iteration automatically.

Convergence rules:

- The same failure twice means your model of the problem is wrong. The next attempt uses a different hypothesis and states why the previous one failed. Never rerun an unchanged attempt.
- After 2 consecutive `progress: "none"` iterations the runtime pauses the goal. Then stop and report one consolidated diagnosis: what was tried, what the evidence rules out, and the single decision or input you need. Do not ask for more iterations as the default next step.
- Reuse checks and evidence whose inputs have not changed; rerun only what a change can affect.

## Course and findings

Start every iteration by rereading the objective and the criteria; work that moves no criterion is off course. Record each obstacle or discovery as one line under `Findings` in `PLAN.md` with one disposition:

- **blocker**: it stops a criterion. Fix it or work around it in this iteration, keeping the criterion's check honest.
- **amend**: evidence shows a criterion or its check is wrong. Change it with the reason in the iteration log; ask me only if that narrows the goal. Never weaken, skip or delete a check to make it pass.
- **defer**: useful but not needed for acceptance. Add it to follow-ups; do not do it now.
- **pitfall**: a trap that cost time (flaky test, tool quirk, environment issue) and how to avoid it. Keep pitfalls listed so later iterations do not repeat them.

For an obstacle outside your authority, first look for a route within it (local reproduction, another measurement, a narrower check); ask only when none exists.

## Execution

- Implement directly by default. Use `subagent` writers only when at least two independent lanes with disjoint files are ready; give each a distinct temporary workspace and a cold-start-complete brief, and integrate its diff into the target checkout within the same iteration. Work left in a candidate copy is not progress. Read-only scouts are fine for bounded investigation.
- Models: explicit user model/thinking selections win. Bounded coding workers use `openai-codex/gpt-6.1-terra:high`; complex or correctness-heavy coding uses `openai-codex/gpt-6.1-sol:medium`; never Luna for coding. Preserve the selected parent model.
- For delegated work, attach the enclosing `missionId` to one top-level async workflow and use native completion notifications rather than polling. If a workflow writes `await state.set("nextReadyAction", ...)`, refresh or clear it at every iteration completion so it never names stale work.
- A failed worker is not success: inspect its partial edits, then make one changed recovery attempt (resume the retained child by exact ID, else a same-role replacement). If that fails too, implement the lane yourself or count the iteration as `none`.

## When to ask

Ask only for actions outside existing authority: commit, push or other publication; destructive operations; spending; a scope change; or an unavailable required model or tool. Batch open questions into one message with a recommendation. Everything else (assessment, edits, builds, tests, checkpoints, cleanup of your own temporary workspaces) proceeds without confirmation. This prompt grants no new spending or publication authority and changes no repository publication rules.

## Records

- `PLAN.md` is the canonical plan. Read it fully once; preserve unrelated content and other sessions' sections. Keep `## Current` short: criteria with status (PASS/FAIL/measured value), the handoff list, open findings and pitfalls, the last 5 iteration log lines and the next action. Move older log lines and finished steps to `## Archived`, one line each. Link evidence files; do not paste hashes, manifests or lane accounting.
- The mission summary is plain language, at most 5 lines: criteria passed out of total, the last change and its result, and the next action. Do not copy the same narrative into the mission, the plan and workflow state.

## Stop and close

- Completion audit: rerun every criterion's check on the final state and record each result with its evidence path; any failure reopens the work. Settle a judgment-only criterion with one read-only reviewer that did not write the change.
- Close with `action: "mission.close"`, the established `missionId`, `missionStatus: "completed"` and an evidence-backed summary when every acceptance criterion passes. A blocker or exhausted limit is not completion.
- On a real blocker, the stall pause or the iteration limit, record the blocker and the single needed decision in `PLAN.md` and the summary, and use `missionUpdate: { status: "waiting", goal: { paused: true }, summary: <checkpoint and decision> }` (or `status: "needs_decision"`).
- `/goal cancel` and `/goal cancel <exact mission ID>` cancel only goals owned by the current saved session. An exact foreign target is rejected. Cancellation preserves history, summaries, evidence, counters and files, and does not stop running jobs.
- Every stop reports: mission id, the criteria table, changed files, the handoff list, and the next action or decision.

## Continuation

On a goal notice, compaction or restart: `mission.show` the exact mission ID, read `PLAN.md` `## Current` including its pitfalls, and continue with the top unmet criterion. If the saved-session identity differs from the goal owner, inspect read-only and do not continue goal work. A notice is not new authority, progress or acceptance evidence.

Goal and optional limits from this invocation:

$@
