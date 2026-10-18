# Pi Subagents: Prompting And Roles

This file is a detailed reference loaded from `skills/pi-subagents/SKILL.md`.

## Capability ceilings

Parent extensions may register a session-scoped, out-of-band ceiling through `pi-subagents/capability-ceiling`. Child tools and eligible canonical agent names are intersected with every active registration and inherited snapshot; `denyExtensions` removes ambient/provider extension loading while retaining package protocol runtime. `{ action: "list" }` marks non-allowlisted agents as restricted, and launch rejects them before spawn. Do not add a model-visible ceiling field or rely on unrestricted role selection for enforcement. Restricted schedules are rejected until their ceiling can be persisted safely.

## When to Use

All launch guidance below assumes delegation is authorized by the current request or applicable user/project instructions and the parent has selected an independent bounded slice. Prior parent failure and a separately named delegation request are not required. Complexity or workflow fit alone does not authorize unnecessary fanout or expand the child's authority.

- **Complex work orchestration**: follow the [model routing policy](#model-routing-policy) for parent reasoning, implementation, verification and helpers. Delegate suitable independent supporting work under applicable user/project instructions; keep shared-state execution and cross-component decisions in the parent. Lightweight one-off delegation can stay lightweight.
- **Advisory review**: give a read-only reviewer an independent bounded question with a context-complete packet when its analysis adds value. Follow the [model routing policy](#model-routing-policy). Do not duplicate the parent's review or manufacture reviewer waves; multiple reviewers need distinct independent questions and a material benefit. Fork to `oracle` when inherited decisions, drift, model routing, root cause or hard tradeoffs require that history.
- **Implementation handoff**: parent resolves shared decisions and freezes only interfaces needed to release ready isolated writers, without another delegation request when applicable instructions already authorize them. Bounded approved components with explicit ownership and independently testable outcomes qualify; they need not be mechanical or context-light. Workers solve local implementation details inside scope; escalate new product, architecture or shared-contract decisions. Use the allowed coding capacity and refill it from ready work after accepted handoffs; parent model or speed on one slice is not a blanket reason to take all independent coding. For plan implementation, use 2–5 actual Sol 6.1 medium writers under the [lane policy](multi-lane-orchestration.md), not read-only substitutes.
- **Recon and planning**: use `scout`, then write a plan when needed
- **Parallel exploration**: run multiple non-conflicting tasks concurrently
- **Regular skill specialists**: when discovery shows proactive skill subagent suggestions and the current work is broad enough, launch a small fresh-context fanout that asks one subagent per relevant regularly used skill to apply that skill's perspective to the task
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
- `/subagents-fleet` — open the live fleet inspector with per-child controls; `Ctrl+Alt+F` opens it during an active foreground turn, `↑↓`/`jk` selects children, `PgUp`/`PgDn` scrolls transcript detail, `s` steers the selected live async child, and `D` stops its top-level async run after confirmation
- `/subagents-watchdog` — inspect or configure the opt-in adversarial change watchdog (model, on/off, recommend-model, check)
- `/subagents-doctor` — diagnose setup, discovery, async paths, and intercom bridge state
- `/subagents-models [agent]` — show the live runtime-loaded builtin model mapping
- `/subagents-profiles`, `/subagents-load-profile`, `/subagents-refresh-provider-models`, `/subagents-generate-profiles`, `/subagents-check-profile` — manage model profiles and provider catalogs
- `/prompt-workflow` — run a prompt template through native workflowScript execution

Prefer the tool when you are writing agent logic. Prefer the slash commands when
you are guiding a human through an interactive flow.

Packaged prompt shortcuts are also available for repeatable workflows. Treat them as reusable orchestration recipes, not just human slash commands. When the user asks for one of these shapes, or when the workflow clearly fits, apply the same pattern directly with `subagent(...)` and other tools:
- `/parallel-review` — fresh-context reviewers with distinct review angles, then synthesis
- `/review-loop` — parent-orchestrated worker, fresh-reviewer, and fix-worker cycles until clean or capped
- `/parallel-research` — combine `researcher` and `scout` for external evidence plus local code context
- `/gather-context-and-clarify` — scout/research first, then ask the user clarifying questions with `interview`
- `/parallel-cleanup` — two fresh-context reviewers (deslop + verbosity passes) for an adversarial cleanup review of the current diff
- `/council` — bounded advisor council for material decisions, plan critique, cross-exam, and parent-written decision memos

## Applying Prompt Techniques Without Slash Commands

The prompt templates in `prompts/` encode workflows the parent agent can run on demand. If the user provides a URL, issue, PR, plan, local file, screenshot, or freeform target, treat that target as the primary scope: read or fetch it before launching children, then include it explicitly in every child task. For targets outside the parent cwd, include the exact repository, explicit `cwd`, authority boundary, and expected output path in each child task. Do not depend on the parent conversation history when the recipe calls for fresh context.

### Commission-risk and cold-start packets

Delegate when the child materially improves evidence, independent review, useful parallelism or isolated execution; do not manufacture parallelism. Every child packet must be cold-start complete: objective and plan requirements; exact workspace/cwd/base/current-source identity; applicable instructions and prior decisions/evidence; relevant source symbols/contracts/callers and adjacent consumers; owned files and prohibited edits; dependencies; acceptance and focused commands; patch/handoff location; and stop/escalation rules. Fresh children do not inherit parent history. Supply needed uncommitted source/config and provisioned dependencies. Missing inputs: stop, never invent. For an orchestration audit by the critic tier, make the child read-only and request at most three omissions, each cited to a file, line, or decision; high thinking is an explicit escalation, not a default.

### Council Mode technique

Use Council Mode when the user asks to convene advisors, debate a material decision, cross-examine recommendations, or critique and improve a plan with several model perspectives. This includes requests such as “run a council on this architecture,” “have the configured advisors critique this plan,” or “get multiple oracles to debate the tradeoffs.” Read `../council-mode/SKILL.md` and follow its bounded parent-supervised protocol instead of launching ad hoc parallel oracle calls.

Council advisors are read-only. User or project `council-*` profiles choose allowed models and define any persistent stance in the profile body. A top-reasoning advisor remains bounded and read-only; it does not become the root. Package advisors such as Surf's `gpt-pro` can join the roster only when the `surf-cli` Pi extension is installed and its `surf-oracle` provider is registered; treat them as external runners, omit child `async` for attached results, and do not pass `outputSchema` to them. The council question and scope provide the decision frame; do not invent per-advisor role labels. The parent collects independent reports, optionally sends curated cross-exam packets, and writes the final memo. Do not treat the council as agent-to-agent chat, implementation authority, or a writer swarm.

### Parallel review technique

Use this when the user wants adversarial review of a diff, plan, issue, file or implemented work. The parent retains substantive synthesis and acceptance. Delegate an independent bounded read-only question when it adds useful analysis or resolves uncertainty that deterministic checks cannot settle; follow the [model routing policy](#model-routing-policy). Give each reviewer a context-complete packet: exact target diff/ref, relevant source and contracts, acceptance criteria, user constraints and exact validation command. Do not duplicate the parent review or launch reviewer waves reflexively. Multiple reviewers need distinct independent questions and a material benefit. Reviewers should inspect files and diffs directly, return concise evidence-backed findings with file/line references, and avoid edits unless the user explicitly asks for a writer pass. Filter on evidence, not severity: report only concrete current issues caused or made reachable by the target diff, with source proof, a test or repro, or a contract contradiction. Label findings P0/P1/P2 and end with `Merge verdict: BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. Use `blockers only` only for final pre-merge re-checks after P1/P2 findings are already captured, or for explicit emergency hotfix lanes where non-blocking findings are intentionally deferred. For targeted follow-up, ask only whether the named finding was resolved, whether the fix introduced a new defect in the fix blast radius, and whether prior P1/P2 notes still stand. For bot or PR-comment triage, classify each comment as VALID, STALE, INVALID, or OUT-OF-POLICY against current HEAD, then assign P0/P1/P2 only to VALID comments. The parent synthesizes fixes worth doing now, optional improvements, and feedback to ignore/defer before applying anything.

### Proactive skill-specialist technique

Use this when `{ action: "list" }` reports proactive skill subagent suggestions and the user's task would benefit from perspectives the parent regularly uses. These suggestions are conservative: a skill is recommended only when it is available and referenced repeatedly by configured agents or saved chains. Treat the list as an opt-in hint for the current task, not a command to always fan out.

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

Use this when implementation or current-diff review should continue until no fixes worth doing now remain. Keep ownership in the parent. Before every iteration, the parent resolves shared decisions and releases bounded independent coding/test-writing components to isolated writers, keeping genuinely coupled/shared-state work local. Freeze only shared interfaces required for independence, not every local detail or the whole architecture. Apply the 2–5 plan-writer requirement when implementing a plan; do not artificially split a truly coupled one-defect fix. Fresh isolated reviewers inspect the resulting integrated target; parent synthesizes and decides ownership again. At round 2 and every second round thereafter, reread the applicable global Pi `~/.pi/agent/AGENTS.md` and nearest target-repository `AGENTS.override.md`/`AGENTS.md` from the exact repo/cwd, then include any changed constraints in reviewer packets. This refresh does not add rounds. Never pre-script writer → reviewers → next writer for uncertain work, and never let an iteration quota force child implementation. Treat eligible worker handoffs as intermediate until parent inspection, integration, and validation. Stop on no P0/P1 work, optional/deferred feedback, an unapproved decision, or the configured round cap.

As a conservative orchestration policy, do not pass a hard `toolBudget` to an implementation worker, fix worker, reviewer with edit authority, or other mutation-capable child. The default tool budget blocks read/search tools rather than mutation tools, but count limits still do not measure delivery safety. Use a narrow task plus an outer elapsed deadline with enough margin, then request a checkpoint after the current tool returns. The checkpoint should report changed files, build/test state, remaining work, and commit or PR state. An elapsed timeout is not a mutation-safe boundary and must not be used as the checkpoint trigger.

### Parallel research technique

Use this when the question needs both external evidence and local implications. Combine `researcher` for official docs, specs, ecosystem behavior, recent changes, benchmarks, and primary sources with `scout` for repository files, patterns, constraints, tests, and likely integration points. Give each child a distinct angle: external evidence, local code context, and practical tradeoffs. Ask for source links or file ranges, confidence level, gaps, and decision implications. Do not ask these children to edit unless implementation was explicitly requested.



### Gather-context-and-clarify technique

Use this when the operator requests delegated context gathering and independent local or external lanes clearly beat direct parent inspection. Launch `scout` for an obviously context-light, independently verifiable local question and `researcher` only when external docs, recent sources, ecosystem context, or primary evidence would materially improve understanding. Ask for concise findings plus unresolved questions; parent synthesizes and uses `interview` only when clarification remains necessary before planning or implementing.

### Parallel cleanup technique

Use this after implementation when the user wants cleanup review or when a final pass would reduce AI-slop. Launch two fresh-context `reviewer` tasks with `output: false` and `progress: false`: one deslop pass and one verbosity pass. If the `deslop` or `verbosity-cleaner` skills are available, pass the relevant skill to that reviewer; otherwise inline the criteria. Both reviewers are review-only and should flag concrete issues with severity, file/line references, and smallest safe fixes. Phrase the constraint as “Do not modify project/source files; returning findings through the configured output artifact is allowed” when you use `output` or `outputMode: "file-only"`. The parent decides what to apply and asks before making changes unless cleanup was already authorized.

### Staged fix orchestration technique

Use staged orchestration only when each delegated stage independently passes user/global eligibility. Do not turn a broad or uncertain finding set into an automatic writer workflow.

1. Optional planning/review lanes handle only obviously independent questions, each in its own isolated workspace.
2. Parent synthesizes findings, resolves shared decisions and releases bounded approved independent components to writers in distinct temporary worktrees/clones; each returns a scoped patch or authorized commit. Workers own local implementation details within scope; parent keeps coupled work and integration. Apply the plan-writer requirement when implementing a plan, without artificial splitting.
3. Parent checks artifacts/diff, integrates only accepted work, and validates in the parent target.
4. Fresh reviewers inspect separate snapshots of that exact integrated target; parent disposes findings and re-runs the ownership gate.

Keep parent decision and integration boundaries between child waves; do not encode uncertain planning → writer → validation as one pre-scripted `workflowScript`. Use `runs.lanes` only for already-frozen independent child stages, never to force implementation delegation. Prefer managed outputs and stable keys for eligible child waves.

## Builtin Agents

Builtin agents load at the lowest priority. Project agents override user agents,
and user/project agents override builtins with the same name.

| Agent | Purpose | Recommended tier | Typical output / role |
|-------|---------|-------|------------------------|
| `scout` | Fast codebase recon | helper routing policy below | Writes `context.md` handoff material |
| `worker` | Implementation and approved oracle handoffs | coding routing policy below | Single-writer implementation with decision escalation |
| `reviewer` | Review specialist | helper routing policy below | Default recipes are review-only; tools include edit/write when a fix pass is explicit |
| `researcher` | Web research brief generator | inherits configured default | Writes `research.md` |
| `delegate` | Lightweight generic delegate | inherits configured default | No fixed output; generic delegated work |
| `oracle` | Decision-consistency and final-review support | helper routing policy below; bounded read-only | Advisory trajectory review, not routine code review |
| `advisor` | Compatibility alias for `oracle` | Same routing as `oracle` | Same advisory escalation role as `oracle` |

Builtin `worker` and `delegate` use strict tool allowlists and do not inherit ambient parent extension tools. To give a child an extension tool, name it in `tools` and load its provider via `extensions`, a path-like `tools` entry, or `subagentOnlyExtensions`. Custom agents without an `extensions` field follow `subagents.defaultExtensions` when set.

Builtin agents inherit the current Pi default model unless a run, user setting, project setting, or `subagents.defaultModel` overrides `model`. The table records recommended tier routing, not shipped hard defaults; explicit run, user, or project settings still win. Apply the [model routing policy](#model-routing-policy); parent/user model and thinking selections remain authoritative. Override builtin defaults before copying full agent files when a small tweak is enough.

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

Provider-scoped entries can layer on top of the default override for the active parent session provider. The provider is selected once from the parent model before child model fallback starts, so fallback attempts cannot switch configuration. Within each settings file, the provider entry wins per field; project settings still win over user settings.

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
- **Target**: repository, explicit isolated `cwd`, base/ref and exact current-source identity, including needed uncommitted source/config and provisioned dependencies.
- **Authority boundary**: whether the child may read, edit, commit, push, comment, close, merge, publish, or release. Omit or forbid actions that are not approved.
- **Context/evidence**: plan requirements, applicable instructions, prior decisions/evidence, relevant symbols/contracts/callers and adjacent consumers. Name owned files and prohibited edits.
- **Success criteria**: what must be true before the child can finish.
- **Hard constraints**: true invariants only, such as no edits for review-only tasks, one writer per workspace, or escalation for unapproved decisions. Ordinary children cannot delegate. A fanout child explicitly authorized through `tools: subagent` or `allowNestedSubagents: true` may spawn one assigned level only; nested writers need distinct managed temporary worktrees or clones, non-overlapping contracts, scoped commits or patches, model selection under the [model routing policy](#model-routing-policy), and no recursion or integration authority.
- **Validation**: targeted checks to run, or the next-best check when validation is impossible.
- **Output**: actual scoped edits/patch when writing, changed/new/generated files, command results and unresolved issues; the expected summary shape, patch/handoff location, or finding format. Use managed artifact paths for scratch reports; reserve repo-qualified absolute paths for durable handoffs that the user approved.
- **Stop rules**: when to ask via `intercom` or `contact_supervisor`, when to stop after enough evidence, and when not to keep searching.

Give each role useful discovery anchors. Name source roots, filenames, symbols, types, methods, and paths for scouts. Give workers context files, plans, task paths, and named source seams before asking them to search. Give reviewers changed files, contracts, and any exhaustive-verification target. Tell oracle whether current source behavior, product/policy documents, plans, or inherited decisions are the evidence that matters.

Avoid carrying over old prompt habits that over-specify every step. Use `must`, `always`, and `never` for real invariants; for judgment calls, give decision rules. For example, tell a reviewer to inspect the staged diff directly and report only evidence-backed findings, rather than prescribing every file or command. Tell a researcher the retrieval budget: start with broad targeted searches, fetch only the strongest sources, search again only when a required fact is missing, then stop.

For implementation handoffs, name the approved scope and success criteria more clearly than the process. Good prompts say what to change, what not to change, where the evidence lives, how to validate, and when to escalate. They should not ask the child to create another subagent plan or continue the parent conversation.

Settings locations:
- User scope: `~/.pi/agent/settings.json`
- Project scope: `.pi/settings.json`

Direct settings example (runtime override mechanics, not a recommendation to enable fallback under the local no-fallback policy):

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "model": "provider/strong-review-model",
        "thinking": "high",
        "fallbackModels": ["backup-provider/strong-review-model"],
        "acceptanceRole": "read-only"
      }
    }
  }
}
```

Useful override fields: `description`, `model`, `fallbackModels`, `thinking`,
`systemPromptMode`, `inheritProjectContext`, `inheritGlobalContext`, `inheritSkills`, `defaultContext`,
`acceptanceRole`, `disabled`, `skills`, `tools`, `extensions`, and `systemPrompt`.
`description` replaces the discovered description for builtin and custom agents
in `list` output, which is useful for deployment-specific routing notes.
Use `acceptanceRole: false` to clear an override. Create a user or project
agent with the same name only when you want a substantially different agent.

### Model routing policy

- Prefer Sol 6.1 high for substantive parent reasoning, diagnosis, design and acceptance. An explicit parent model/thinking selection wins; do not replace it automatically. Astra medium is available only when explicitly selected, never as an automatic escalation.
- Default ordinary coordination, coding, test-writing, verification, review and helper work to Sol 6.1 medium, including nested writers.
- Escalate to Sol 6.1 high for material medium failure, conflicting evidence, reviewer disagreement or high-impact review; deep reassessment stays Sol high. Honor explicit parent/user selections. Sol xhigh/max remains manual-only.
- Luna medium is permitted only when explicitly selected for a cheap bounded read-only lookup. Never route implementation, review or verification to Luna. Luna high is not a default or implementation tier.
- Do not automatically fall back to another model or provider on quota, availability or provider failure. Preserve the failure and ask for an explicit selection when needed. The existing `fallbackModels` override field is not a recommendation to enable fallback under this policy.

Map this policy to concrete models through the existing user/project overrides or profiles; these documentation recommendations do not change runtime defaults. Prefer fresh context for explicitly selected cross-provider children when inherited provider-specific reasoning blocks would force thinking off.

If a provider rejects model IDs with thinking suffixes, use
`subagents.disableThinking: true` in user or project settings to clear bundled
builtin thinking defaults globally. A higher-precedence per-agent `thinking`
override can opt one builtin back in or replace custom-agent frontmatter thinking.

Set `subagents.defaultExtensions` to give agents without an `extensions` field a shared child extension allowlist. Omit it to preserve ambient extension discovery, set it to `[]` to disable ambient extensions by default, or use `agentOverrides.<name>.extensions` for one agent. A matching override replaces custom-agent frontmatter for that field.

Tool description modes live in `~/.pi/agent/extensions/subagent/config.json`, not `subagents` settings. The default uses split prompt metadata: a short tool description plus active `promptSnippet` and `promptGuidelines`. Set `toolDescriptionMode` to `full` or `compact` to force one description string, or `custom` to read `subagent-tool-description.md` from the project config dir or agent dir; invalid custom files fall back to full mode and the safety guidance is still appended.
