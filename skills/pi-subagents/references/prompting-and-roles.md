# Pi Subagents: Prompting And Roles

This file is a detailed reference loaded from `skills/pi-subagents/SKILL.md`.

## Capability ceilings

Parent extensions may register a session-scoped, out-of-band ceiling through `pi-subagents/capability-ceiling`. Child tools and eligible canonical agent names are intersected with every active registration and inherited snapshot; `denyExtensions` removes ambient/provider extension loading while retaining package protocol runtime. `{ action: "list" }` marks non-allowlisted agents as restricted, and launch rejects them before spawn. Do not add a model-visible ceiling field or rely on unrestricted role selection for enforcement. Restricted schedules are rejected until their ceiling can be persisted safely.

## When to Use

All launch guidance below assumes delegation was requested by the operator in
the current request or applicable user/project instructions. Complexity,
workflow fit, and potential quality gains help choose a shape after that gate;
they do not authorize a launch.

- **Complex work orchestration**: start the parent on Luna high, use Luna xhigh for bounded difficult implementation or concrete reproducible failures, and escalate to Sol medium when actual code/context complexity, causal debugging, coordination, mixed work, or final-review evidence requires it. Delegate only when another child materially improves evidence, independent review, specialization, useful parallelism, or isolated execution; omission failures are cheaper than unnecessary commissions. For genuinely complex orchestration or root-cause questions, Sol high is manual-only and reserved for the most complex cases. If selected, keep it to direct parent reasoning or a bounded read-only critic/oracle review, never an autonomous root. Lightweight one-off delegation can stay lightweight.
- **Advisory review**: a Sol-medium or Sol-high parent reviews directly by default. Use at most one Luna-high `reviewer` only for a genuinely simple read-only review with a context-complete packet; use multiple reviewers only for independent high-impact risks with explicit justification. Fork to `oracle` only for rare escalation where inherited decisions, drift, model routing, root cause, or hard tradeoffs matter.
- **Implementation handoff**: have `oracle` advise when needed; parent implements the approved direction unless a frozen mechanical slice independently passes the user/global child-writer gate
- **Recon and planning**: use `scout`, then write a plan when needed
- **Parallel exploration**: run multiple non-conflicting tasks concurrently
- **Regular skill specialists**: when authorized delegation names or benefits from a relevant specialization, discovery suggestions may help select a small fresh-context fanout
- **Long-running work**: launch async/background runs and inspect them later. For mutation-capable work, bound the delivery slice and elapsed runtime, then request checkpoints after active tool work returns. Reserve hard tool-call caps for explicitly read-only children.
- **Subagent control**: watch needs-attention signals and soft-interrupt only when a delegated run is genuinely blocked
- **Agent authoring**: create, update, or override project agents. Treat saved chain records as legacy inspection or migration inputs, not as a current authoring target.

## Tool vs Slash Commands

Agents use the `subagent(...)` tool for execution, management, status, and control. Direct `{ agent, task }` execution is enough for one bounded child task; use `workflowScript` when the parent needs JavaScript control flow or data-dependent branching, keyed, parallel, sequential, retry, retained-resume, aggregate, or explicit staged-lane behavior (`runs.lanes`). Humans often use the slash-command layer instead:

- `/run` — launch a single agent
- `workflowScript` — the sole public surface for sequence, parallelism, branching, retries, and aggregation
- `/subagents` — interactive admin for inspecting agents and editing model, thinking, or system prompt
- `/subagents-stop [run-id]` — stop a current-session top-level async run; opens a selector when no id is given
- `/subagents-detach [run-id]` — detach an active foreground single-subagent run without terminating its child
- `/subagents-steer <run-id> [--child <child-id>] <message>` — steer a live async run (or one child of it) from non-TUI sessions and RPC hosts
- `/subagent-cost` — show parent plus child token usage and cost for the session
- `/subagents-fleet` — open the live fleet inspector with per-child controls; `↑↓`/`jk` selects children, `PgUp`/`PgDn` scrolls transcript detail, `s` steers the selected live async child, and `D` stops its top-level async run after confirmation
- `/subagents-watchdog` — inspect or configure the opt-in adversarial change watchdog (model, on/off, recommend-model, check)
- `/subagents-doctor` — diagnose setup, discovery, async paths, and intercom bridge state
- `/subagents-models [agent]` — show the live runtime-loaded builtin model mapping
- `/subagents-profiles`, `/subagents-load-profile`, `/subagents-refresh-provider-models`, `/subagents-generate-profiles`, `/subagents-check-profile` — manage model profiles and provider catalogs
- `/prompt-workflow` — run a prompt template through native workflowScript execution

Prefer the tool when you are writing agent logic. Prefer the slash commands when
you are guiding a human through an interactive flow.

Packaged prompt shortcuts are also available for repeatable workflows. Treat them as reusable orchestration recipes, not just human slash commands. When the user asks for one of these shapes, apply the same pattern directly with `subagent(...)` and other tools:
- `/parallel-review` — fresh-context reviewers with distinct review angles, then synthesis
- `/review-loop` — parent-orchestrated worker, fresh-reviewer, and fix-worker cycles until clean or capped
- `/parallel-research` — combine `researcher` and `scout` for external evidence plus local code context
- `/gather-context-and-clarify` — scout/research first, then ask the user clarifying questions with `interview`
- `/parallel-cleanup` — two fresh-context reviewers (deslop + verbosity passes) for an adversarial cleanup review of the current diff
- `/council` — bounded advisor council for material decisions, plan critique, cross-exam, and parent-written decision memos

## Applying Prompt Techniques Without Slash Commands

The prompt templates in `prompts/` encode workflows the parent agent can run on demand. If the user provides a URL, issue, PR, plan, local file, screenshot, or freeform target, treat that target as the primary scope: read or fetch it before launching children, then include it explicitly in every child task. For targets outside the parent cwd, include the exact repository, explicit `cwd`, authority boundary, and expected output path in each child task. Do not depend on the parent conversation history when the recipe calls for fresh context.

### Commission-risk and cold-start packets

After the operator-authority gate above, delegate only when the child materially improves evidence, independent review, specialization, useful parallelism, or isolated execution; do not manufacture parallelism. Every child packet must be cold-start complete: state the goal, exact target/cwd/ref, authority and edit boundary, relevant context/evidence, success criteria, validation, output, and stop/escalation rules. For an orchestration audit by the critic tier, make the child read-only and request at most three omissions, each cited to a file, line, or decision; high thinking is an explicit escalation, not a default.

### Council Mode technique

Use Council Mode when the user asks to convene advisors, debate a material decision, cross-examine recommendations, or critique and improve a plan with several model perspectives. This includes requests such as “run a council on this architecture,” “have the configured advisors critique this plan,” or “get multiple oracles to debate the tradeoffs.” Read `../council-mode/SKILL.md` and follow its bounded parent-supervised protocol instead of launching ad hoc parallel oracle calls.

Council advisors are read-only. User or project `council-*` profiles choose allowed models and define any persistent stance in the profile body. A top-reasoning advisor remains bounded and read-only; it does not become the root. Package advisors such as Surf's `gpt-pro` can join the roster only when the `surf-cli` Pi extension is installed and its `surf-oracle` provider is registered; treat them as external runners, omit child `async` for attached results, and do not pass `outputSchema` to them. The council question and scope provide the decision frame; do not invent per-advisor role labels. The parent collects independent reports, optionally sends curated cross-exam packets, and writes the final memo. Do not treat the council as agent-to-agent chat, implementation authority, or a writer swarm.

### Parallel review technique

Use this when the user wants adversarial review of a diff, plan, issue, file, or implemented work. The parent reviews directly by default when running at Sol Medium or Sol High. For a genuinely simple read-only review, one fresh-context Luna-high `reviewer` is allowed only with a context-complete packet: exact target diff/ref, relevant source and contracts, acceptance criteria, user constraints, and exact validation command. Do not launch one or two Luna reviewers as a default pattern. Multiple reviewers require independent high-impact risks and explicit justification. Reviewers should inspect files and diffs directly, return concise evidence-backed findings with file/line references, and avoid edits unless the user explicitly asks for a writer pass. Filter on evidence, not severity: report only concrete current issues caused or made reachable by the target diff, with source proof, a test or repro, or a contract contradiction. Label findings P0/P1/P2 and end with `Merge verdict: BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. Use `blockers only` only for final pre-merge re-checks after P1/P2 findings are already captured, or for explicit emergency hotfix lanes where non-blocking findings are intentionally deferred. For targeted follow-up, ask only whether the named finding was resolved, whether the fix introduced a new defect in the fix blast radius, and whether prior P1/P2 notes still stand. For bot or PR-comment triage, classify each comment as VALID, STALE, INVALID, or OUT-OF-POLICY against current HEAD, then assign P0/P1/P2 only to VALID comments. The parent synthesizes fixes worth doing now, optional improvements, and feedback to ignore/defer before applying anything.

### Proactive skill-specialist technique

Use this only within operator-authorized delegation when `{ action: "list" }` reports skill subagent suggestions relevant to the requested handoff. Availability is a selection hint, not authority or a command to fan out.

Default guardrails:
- Keep the fanout small: usually one or two skill-specialist children, never more than the listed recommendations or configured cap.
- Prefer `context: "fresh"` and include only the files, diff, plan, URL, or request details each child needs. Use forked context only when private/session history is essential and appropriate to share.
- Use read-only agents for analysis/review unless implementation was explicitly requested; do not create several writers in the same worktree.
- Skip proactive skill subagents for tiny questions, direct commands, highly private requests, or when the user asks not to delegate.
- Make cost and concurrency visible by using an ordinary `subagent(...)` call rather than hidden/background automation.

Example shape:

```typescript
subagent({
  workflowScript: `
    const results = await runs.all([
      { key: "deslop", agent: "reviewer", task: "Apply the available 'deslop' skill to review the current diff for concrete cleanup findings only. Do not modify files.", skill: "deslop" },
      { key: "accessibility", agent: "reviewer", task: "Apply the available 'accessibility' skill to review the UI changes for concrete issues only. Do not modify files.", skill: "accessibility" }
    ]);
    return results.map(result => result.output);
  `,
  context: "fresh"
})
```

### Review-loop technique

Use this when implementation or current-diff review should continue until no fixes worth doing now remain. Keep ownership in the parent. Before every iteration, the parent classifies the next causal slice and codes it directly by default—especially when Sol—or delegates only a frozen mechanical slice that independently passes the user/global eligibility gate. Fresh isolated reviewers inspect the resulting integrated target; parent synthesizes and decides ownership again. At round 2 and every second round thereafter, reread the applicable global Pi `~/.pi/agent/AGENTS.md` and nearest target-repository `AGENTS.override.md`/`AGENTS.md` from the exact repo/cwd, then include any changed constraints in reviewer packets. This refresh does not add rounds. Never pre-script writer → reviewers → next writer for uncertain work, and never let an iteration quota force child implementation. Treat eligible worker handoffs as intermediate until parent inspection, integration, and validation. Stop on no P0/P1 work, optional/deferred feedback, an unapproved decision, or the configured round cap.

As a conservative orchestration policy, do not pass a hard `toolBudget` to an implementation worker, fix worker, reviewer with edit authority, or other mutation-capable child. The default tool budget blocks read/search tools rather than mutation tools, but count limits still do not measure delivery safety. Use a narrow task plus an outer elapsed deadline with enough margin, then request a checkpoint after the current tool returns. The checkpoint should report changed files, build/test state, remaining work, and commit or PR state. An elapsed timeout is not a mutation-safe boundary and must not be used as the checkpoint trigger.

### Parallel research technique

Use this when the question needs both external evidence and local implications. Combine `researcher` for official docs, specs, ecosystem behavior, recent changes, benchmarks, and primary sources with `scout` for repository files, patterns, constraints, tests, and likely integration points. Give each child a distinct angle: external evidence, local code context, and practical tradeoffs. Ask for source links or file ranges, confidence level, gaps, and decision implications. Do not ask these children to edit unless implementation was explicitly requested.



### Gather-context-and-clarify technique

Use this when the operator requests delegated context gathering and independent local or external lanes clearly beat direct parent inspection. Launch `scout` for an obviously context-light, independently verifiable local question and `researcher` only when external docs, recent sources, ecosystem context, or primary evidence would materially improve understanding. Ask for concise findings plus unresolved questions; parent synthesizes and uses `interview` only when clarification remains necessary before planning or implementing.

### Parallel cleanup technique

Use this after implementation when the user or applicable instructions request delegated cleanup review. Launch two fresh-context `reviewer` tasks with `output: false` and `progress: false`: one deslop pass and one verbosity pass. If the `deslop` or `verbosity-cleaner` skills are available, pass the relevant skill to that reviewer; otherwise inline the criteria. Both reviewers are review-only and should flag concrete issues with severity, file/line references, and smallest safe fixes. Phrase the constraint as “Do not modify project/source files; returning findings through the configured output artifact is allowed” when you use `output` or `outputMode: "file-only"`. The parent decides what to apply and asks before making changes unless cleanup was already authorized.

### Staged fix orchestration technique

Use staged orchestration only when each delegated stage independently passes user/global eligibility. Do not turn a broad or uncertain finding set into an automatic writer workflow.

1. Optional planning/review lanes handle only obviously independent questions, each in its own isolated workspace.
2. Parent synthesizes findings and owns the next causal slice. Parent implements by default. Only an already-frozen mechanical slice may go to one eligible child writer in a distinct managed worktree/clone; it returns a scoped commit or patch.
3. Parent checks artifacts/diff, integrates only accepted work, and validates in the parent target.
4. Fresh reviewers inspect separate snapshots of that exact integrated target; parent disposes findings and re-runs the ownership gate.

Keep parent decision and integration boundaries between child waves; do not encode uncertain planning → writer → validation as one pre-scripted `workflowScript`. Use `runs.lanes` only for already-frozen independent child stages, never to force implementation delegation. Prefer managed outputs and stable keys for eligible child waves.

## Builtin Agents

Builtin agents load at the lowest priority. Project agents override user agents,
and user/project agents override builtins with the same name.

| Agent | Purpose | Recommended tier | Typical output / role |
|-------|---------|-------|------------------------|
| `scout` | Fast codebase recon | fast worker/scout tier | Writes `context.md` handoff material |
| `worker` | Implementation and approved oracle handoffs | capable worker tier | Single-writer implementation with decision escalation |
| `reviewer` | Review specialist | strong reviewer tier; high thinking for serious reviews | Default recipes are review-only; tools include edit/write when a fix pass is explicit |
| `researcher` | Web research brief generator | inherits configured default | Writes `research.md` |
| `delegate` | Lightweight generic delegate | inherits configured default | No fixed output; generic delegated work |
| `oracle` | Decision-consistency and final-review support | Sol medium by default; Sol high only for genuinely complex escalation; bounded read-only | Advisory trajectory review, not routine code review |
| `advisor` | Compatibility alias for `oracle` | Same Sol medium default and Sol high escalation ceiling as `oracle` | Same advisory escalation role as `oracle` |

Builtin `worker` and `delegate` use strict tool allowlists and do not inherit ambient parent extension tools. To give a child an extension tool, name it in `tools` and load its provider via `extensions`, a path-like `tools` entry, or `subagentOnlyExtensions`. Custom agents without an `extensions` field follow `subagents.defaultExtensions` when set.

Builtin agents inherit the current Pi default model unless a run, user setting, project setting, or `subagents.defaultModel` overrides `model`. The table records recommended tier routing, not shipped hard defaults; explicit run, user, or project settings still win. Under the local routing policy, start the parent/orchestrator on Luna high and escalate to Sol only on concrete evidence unless parent/user policy says otherwise. Override builtin defaults before copying full agent files when a small tweak is enough.

Set `subagents.defaultThinking` to apply a shared thinking level to builtin, package, user, and project agents whose frontmatter leaves `thinking` unset. Project settings win over user settings; matching `agentOverrides.<name>.thinking` and per-run overrides replace frontmatter, while an explicit frontmatter value remains in effect when no matching override is set. This setting affects child agents only and does not change the parent session's default thinking level.

```json
{
  "subagents": {
    "defaultThinking": "medium"
  }
}
```

For one run, use inline config:

```text
/run reviewer[model=provider/review-model] "Review this diff"
```

For persistent tweaks, edit `subagents.agentOverrides` in user or project settings. User overrides apply everywhere. Project overrides apply only in that repo and win over user overrides. Use `/subagents-models` or `subagent({ action: "models" })` to inspect the live mapping after settings and overrides load.

Provider-scoped entries can layer on top of the default override for the active parent session provider. The provider is selected once from the parent model. Within each settings file, the provider entry wins per field; project settings still win over user settings.

```json
{
  "subagents": {
    "agentOverrides": {
      "worker": { "thinking": "medium" }
    },
    "agentOverridesByProvider": {
      "provider-a": {
        "worker": { "model": "provider-a/fast-worker-model" }
      },
      "provider-b": {
        "worker": { "model": "provider-b/fast-worker-model" }
      }
    }
  }
}
```

Model ids do not have to be exact. Separator variations (`fast.worker-v1` vs `fast-worker-v1`), case (`Strong-Review-Model`), and optional trailing date stamps all resolve to the same registry model. Exact `provider/id` wins; a qualified `provider/model` never switches providers. To constrain subagents to a budget or compliance profile, set `subagents.modelScope: { enforce: true, allow: ["approved-provider/*", "second-provider/approved-*"] }` in user or project settings. Out-of-scope models you pass explicitly error and abort; models inherited from frontmatter, `subagents.defaultModel`, agent frontmatter, or the parent session only warn.

For model fleets, use the profile commands instead of hand-editing repeated overrides: `/subagents-refresh-provider-models <provider>`, `/subagents-generate-profiles <provider>`, `/subagents-load-profile <name>`, and `/subagents-check-profile <name>`. Profiles live under `~/.pi/agent/profiles/pi-subagents/` and replace only `settings.subagents` when loaded.

## Prompting role subagents

Builtin role agents inherit the current Pi default model unless you override them. When launching them, write the task prompt as a compact contract, not a long procedural script. Define the destination and let the role choose the efficient path.

A strong subagent prompt usually includes:
- **Goal**: the concrete outcome the child should produce.
- **Target**: repository, explicit `cwd`, branch/ref/head, and source seam when the target is not the parent cwd.
- **Authority boundary**: whether the child may read, edit, commit, push, comment, close, merge, publish, or release. Omit or forbid actions that are not approved.
- **Context/evidence**: relevant plan paths, files, diffs, decisions, or user constraints already approved.
- **Success criteria**: what must be true before the child can finish.
- **Hard constraints**: true invariants only, such as no edits for review-only tasks, one writer per workspace, or escalation for unapproved decisions. Ordinary children cannot delegate. A fanout child explicitly authorized through `tools: subagent` or `allowNestedSubagents: true` may spawn one assigned level only; nested writers need distinct managed temporary worktrees or clones, non-overlapping contracts, scoped commits or patches, explicit Luna high/xhigh selection (never Sol/inherited Sol or Terra), and no recursion or integration authority.
- **Validation**: targeted checks to run, or the next-best check when validation is impossible.
- **Output**: the expected summary shape, artifact path, or finding format. Use managed artifact paths for scratch reports; reserve repo-qualified absolute paths for durable handoffs that the user approved.
- **Stop rules**: when to ask via `intercom` or `contact_supervisor`, when to stop after enough evidence, and when not to keep searching.

Give each role useful discovery anchors. Name source roots, filenames, symbols, types, methods, and paths for scouts. Give workers context files, plans, task paths, and named source seams before asking them to search. Give reviewers changed files, contracts, and any exhaustive-verification target. Tell oracle whether current source behavior, product/policy documents, plans, or inherited decisions are the evidence that matters.

Avoid carrying over old prompt habits that over-specify every step. Use `must`, `always`, and `never` for real invariants; for judgment calls, give decision rules. For example, tell a reviewer to inspect the staged diff directly and report only evidence-backed findings, rather than prescribing every file or command. Tell a researcher the retrieval budget: start with broad targeted searches, fetch only the strongest sources, search again only when a required fact is missing, then stop.

For implementation handoffs, name the approved scope and success criteria more clearly than the process. Good prompts say what to change, what not to change, where the evidence lives, how to validate, and when to escalate. They should not ask the child to create another subagent plan or continue the parent conversation.

Settings locations:
- User scope: `~/.pi/agent/settings.json`
- Project scope: `.pi/settings.json`

Direct settings example:

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "model": "provider/strong-review-model",
        "thinking": "high",
        "acceptanceRole": "read-only"
      }
    }
  }
}
```

Useful override fields: `description`, `model`, `thinking`,
`systemPromptMode`, `inheritProjectContext`, `inheritGlobalContext`, `inheritSkills`, `defaultContext`,
`acceptanceRole`, `disabled`, `skills`, `tools`, `extensions`, and `systemPrompt`.
`description` replaces the discovered description for builtin and custom agents
in `list` output, which is useful for deployment-specific routing notes.
Use `acceptanceRole: false` to clear an override. Create a user or project
agent with the same name only when you want a substantially different agent.

### Recommended model tiering (optional)

Start the parent/orchestrator on Luna high because omission failures are cheaper than unnecessary commissions; use Luna xhigh for bounded difficult implementation or concrete reproducible failures, then escalate to Sol medium only when concrete complexity, causal debugging, coordination, mixed work, or final-review evidence requires it. When delegation independently qualifies, use Luna high for scouts, research, tests, verification, and focused review; use Luna xhigh for a frozen bounded implementation slice. Use Sol medium for high-stakes final review, final/adversarial review of high-impact code, and decision-consistency work after concrete Luna insufficiency, conflicting evidence, or materially consequential synthesis. Sol high is manual-only and reserved for the most complex scenarios possible. Terra is a manual comparison fallback only, and Luna max is never automatic. Explicit parent/user model policy wins over these recommendations.

Examples are illustrative, not requirements. Map these tiers to concrete models in user/project settings or a profile. A non-OpenAI setup should choose comparable available models by capability.

Each child launch uses one resolved model exactly once. If quota or availability fails, surface that failure and let the parent or operator explicitly launch a later attempt with another model. Forked children keep their requested thinking level even when provider-specific reasoning blocks are stripped from the inherited transcript.

If a provider rejects model IDs with thinking suffixes, use
`subagents.disableThinking: true` in user or project settings to clear bundled
builtin thinking defaults globally. A higher-precedence per-agent `thinking`
override can opt one builtin back in or replace custom-agent frontmatter thinking.

Set `subagents.defaultExtensions` to give agents without an `extensions` field a shared child extension allowlist. Omit it to preserve ambient extension discovery, set it to `[]` to disable ambient extensions by default, or use `agentOverrides.<name>.extensions` for one agent. A matching override replaces custom-agent frontmatter for that field.

Tool description modes live in `~/.pi/agent/extensions/subagent/config.json`, not `subagents` settings. The default uses split prompt metadata: a short tool description plus active `promptSnippet` and `promptGuidelines`. Set `toolDescriptionMode` to `full` or `compact` to force one description string, or `custom` to read `subagent-tool-description.md` from the project config dir or agent dir; invalid custom files fall back to full mode and the safety guidance is still appended.
