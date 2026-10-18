import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import fastWork, { type FastWorkOptions } from "pi-subagents/fast-work-extension";
import type { FastWorkTask } from "pi-subagents/fast-work";
import { FastWorkTelemetry, type FastWorkObservation } from "../../src/fast-work/telemetry.ts";
import { registerRuntimeAgentEventListener } from "../../src/agents/runtime-agent-events.ts";
import { listRuntimeAgentConfigs } from "../../src/agents/runtime-agent-registry.ts";
import { registerPromptTemplateDelegationBridge } from "../../src/slash/prompt-template-bridge.ts";

interface ToolFixture {
	name: string;
	description: string;
	parameters: TSchema;
	execute(id: string, params: { action: "create" | "advance" | "status"; tasks?: FastWorkTask[]; decisions?: Array<{ id: string; decision: "accept" | "reject"; evidence?: string }> }, signal: AbortSignal, update: undefined, ctx: ExtensionContext): Promise<AgentToolResult<unknown>>;
}
const capsule = (id: string, dependsOn: string[] = []): FastWorkTask => ({ id, dependsOn, goal: "SECRET_GOAL", context: "SECRET_CONTEXT", inputs: ["SECRET_PATH"], acceptance: "Return source evidence", nonGoals: ["No edits"], role: "WORKER_STANDARD" });

function harness(telemetrySetting: boolean | string = true, options: FastWorkOptions = {}) {
	const handlers = new Map<string, (event: Parameters<ExtensionAPI["events"]["emit"]>[1], ctx: ExtensionContext) => void>();
	const eventHandlers = new Map<string, Set<Parameters<ExtensionAPI["events"]["on"]>[1]>>();
	const entries: Array<{ type: string; data: FastWorkObservation }> = [];
	const userMessages: Array<{ content: Parameters<ExtensionAPI["sendUserMessage"]>[0]; options: Parameters<ExtensionAPI["sendUserMessage"]>[1] }> = [];
	let active = ["read", "subagent"];
	let tool: ToolFixture | undefined;
	const commands = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
	const commandDescriptions = new Map<string, string>();
	const events = {
		on(name: string, handler: Parameters<ExtensionAPI["events"]["on"]>[1]) {
			const set = eventHandlers.get(name) ?? new Set(); set.add(handler); eventHandlers.set(name, set);
			return () => { set.delete(handler); };
		},
		emit(name: string, payload: Parameters<ExtensionAPI["events"]["emit"]>[1]) {
			const snapshot = [...(eventHandlers.get(name) ?? [])];
			for (const handler of snapshot) handler(payload);
		},
	};
	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test-only SDK fixture implements the exercised public methods, not unrelated services.
	const pi = {
		events, on: (name: string, handler: (event: Parameters<ExtensionAPI["events"]["emit"]>[1], ctx: ExtensionContext) => void) => { handlers.set(name, handler); },
		registerTool: (definition: ToolFixture) => { tool = definition; },
		registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { commands.set(name, options.handler); commandDescriptions.set(name, options.description); },
		sendUserMessage: (content: Parameters<ExtensionAPI["sendUserMessage"]>[0], options: Parameters<ExtensionAPI["sendUserMessage"]>[1]) => { userMessages.push({ content, options }); },
		registerFlag: () => {}, getFlag: () => telemetrySetting,
		getActiveTools: () => active, setActiveTools: (tools: string[]) => { active = tools; },
		getThinkingLevel: () => "high", setModel: () => { throw new Error("Must preserve operator parent selection"); },
		appendEntry: (type: string, data: FastWorkObservation) => { entries.push({ type, data }); },
	} as unknown as ExtensionAPI;
	// SAFETY: this test context supplies the model registry, cwd and UI used by the extension only.
	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Test-only context stub intentionally omits unrelated SDK services.
	let availableModels = [{ provider: "openai-codex", id: "gpt-6-luna", reasoning: true }, { provider: "openai-codex", id: "gpt-6.1-sol", reasoning: true }];
	const ctx = { cwd: process.cwd(), model: { provider: "openai-codex", id: "gpt-6.1-sol" }, modelRegistry: {
		getAvailable: () => availableModels,
	}, waitForIdle: async () => {}, ui: { notify: () => {} } } as unknown as ExtensionContext;
	const requests: Array<{ model?: string; thinking?: string; context?: string; task?: string }> = [];
	const unregister = registerRuntimeAgentEventListener(pi);
	const bridge = registerPromptTemplateDelegationBridge({ events, getContext: () => ctx,
		execute: async () => { throw new Error("Wrong executor"); },
		executeStructured: async (id, params) => {
			requests.push({ model: params.model, thinking: params.delegatedThinkingOverride, context: params.context, task: params.task });
			return { details: { mode: "single", runId: id, results: [{ agent: params.agent, model: params.model, thinking: params.delegatedThinkingOverride, exitCode: 0, finalOutput: "SECRET_OUTPUT", usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, turns: 1, cost: 0.01 } }] } };
		},
	});
	fastWork(pi, options);
	const fire = (name: string, event: Parameters<ExtensionAPI["events"]["emit"]>[1] = {}) => handlers.get(name)?.(event, ctx);
	const invoke = (params: Parameters<ToolFixture["execute"]>[1]) => tool!.execute("tool-id", params, new AbortController().signal, undefined, ctx);
	return { pi, ctx, fire, invoke, entries, requests, userMessages, setAvailableModels: (models: typeof availableModels) => { availableModels = models; }, active: () => active, toolName: () => tool?.name, toolDescription: () => tool?.description, commandDescription: (name: string) => commandDescriptions.get(name), parameters: () => tool!.parameters, command: (args: string, name = "fast-work") => commands.get(name)!(args, ctx), cleanup: () => { fire("session_shutdown"); bridge.dispose(); unregister(); } };
}

describe("optional fast-work extension (synthetic SDK, no providers)", () => {
	it("implement-plan submits the current PLAN.md implementation request without changing models or the read-only profile", async () => {
		for (const initialProfile of ["normal", "fast"] as const) {
			const h = harness(true, { initialProfile });
			try {
				h.fire("session_start");
				const active = [...h.active()];
				await h.command(" \t ", "implement-plan");
				assert.equal(h.userMessages.length, 1);
				const { content, options } = h.userMessages[0]!;
				assert.equal(typeof content, "string");
				if (typeof content !== "string") assert.fail("Expected an implementation prompt");
				assert.ok(content.trim().split(/\s+/).length <= 450, "Keep the implementation request under 450 words");
				assert.match(content, /repository-root PLAN\.md/);
				assert.match(content, /missing, ambiguous.*ask before implementation/);
				assert.match(content, /Do not choose another plan or overwrite it/);
				assert.match(content, /next unmet milestone.*reuse.*evidence/is);
				assert.match(h.commandDescription("implement-plan")!, /2–5.*independent.*writers/);
				assert.match(content, /2–5 concurrent independent coding\/test-writing workers/);
				assert.match(content, /model openai-codex\/gpt-6\.1-sol:medium.*no substitutions/);
				assert.match(content, /fewer than two.*concrete blocker.*ask.*rescope or proceed with fewer/is);
				assert.match(content, /minimum.*naturally drains/is);
				assert.match(content, /ready\/running\/blocked queue.*files\/contract.*dependencies.*workspace\/base.*gate/is);
				assert.match(content, /freeze only shared interfaces.*bounded components.*not.*mechanical or context-light/is);
				assert.match(content, /local implementation details.*escalate.*product\/architecture\/shared-contract/is);
				assert.match(content, /parent.*faster.*not.*blanket reason/is);
				assert.match(content, /ordinary subagent tool.*read\/write\/edit.*distinct isolated workspace/is);
				assert.match(content, /coupled.*integration and acceptance in the parent/);
				assert.match(content, /Do not use fast_work/);
				assert.match(content, /first useful isolated writer.*startup/);
				// Emitted instructions only; synthetic fixtures never launch recovery workers or contact providers.
				for (const contract of [
					/Follow established recovery safeguards: preserve tracked\/untracked partials\/evidence, unaccepted unverified/,
					/confirm exclusive ownership\/no live writer/,
					/One same-protocol recovery without confirmation: eligible resume or isolated same-role replacement/,
					/same approved model\/provider\/tools, existing limits/,
					/Change failed approach.*Repeated\/unsafe failure: checkpoint-and-ask/,
					/Honor pause\/cancel.*No unapproved local\/foreground\/external fallback/,
				]) assert.match(content, contract);
				assert.doesNotMatch(content, /ask: runtime repair or local implementation/);
				assert.match(content, /brief.*workspace\/base\/current-source identity.*owned\/prohibited files.*acceptance.*commands/is);
				assert.match(content, /temporary worktree\/clone\/snapshot.*explicit cwd.*outside extension auto-discovery/is);
				assert.match(content, /Never.*writers in the parent checkout or same workspace/);
				assert.match(content, /Read-only reviews, scouts and fast_work never count/);
				assert.match(content, /incompleteness explicit/);
				assert.match(content, /current source and dependencies.*uncommitted source\/config.*provisioned dependencies.*not just.*HEAD/is);
				assert.match(content, /patch\/handoff location, stop\/escalation rules/);
				assert.match(content, /parent conversation history.*stop on missing inputs/is);
				assert.match(content, /patch.*changed\/new\/generated files.*command results.*unresolved issues/is);
				assert.match(content, /Inspect diff\/stat\/unexpected artifacts, integrate and verify in the original target/);
				assert.match(content, /cleanup.*failed, cancelled and startup-failed/is);
				assert.match(content, /AGENTS\.md cleanup authorization.*without redundant confirmation/is);
				assert.match(content, /exact ownership\/path.*tracked, untracked and submodule contents/is);
				assert.match(content, /uncommitted.*not.*retain/is);
				assert.match(content, /normal git worktree remove.*never --force/is);
				assert.match(content, /Never delete active\/user-owned workspaces or unintegrated\/unpreserved work/);
				assert.match(content, /uncertain.*instructions require confirmation.*retain.*ask/is);
				assert.match(content, /Do not commit, rebase, tag, push or publish.*children/is);
				assert.match(content, /updates concise/);
				assert.deepEqual(options, { deliverAs: "followUp" });
				assert.deepEqual(h.active(), active);
				assert.deepEqual(h.requests, []);
				if (initialProfile === "fast") {
					const promptGuidelines: string[] = [];
					h.fire("before_agent_start", { systemPromptOptions: { promptGuidelines } });
					assert.match(promptGuidelines.join("\n"), /implementation writers use ordinary isolated subagents/);
					assert.match(promptGuidelines.join("\n"), /plan implementation requires 2–5 concurrent independent coding\/test-writing workers/);
					assert.match(promptGuidelines.join("\n"), /Bounded components need not be mechanical or context-light/);
					assert.match(promptGuidelines.join("\n"), /local implementation details.*escalate.*shared-contract/is);
				}
				await h.command("status");
				assert.equal(h.userMessages.length, 1);
			} finally { h.cleanup(); }
		}
	});

	it("bare fast-work only shows status, even when the implementation model is unavailable", async () => {
		const h = harness();
		try {
			h.fire("session_start");
			h.setAvailableModels([]);
			await h.command(" \t ");
			assert.deepEqual(h.userMessages, []);
			assert.deepEqual(h.requests, []);
			assert.deepEqual(h.active(), ["read", "subagent"]);
		} finally { h.cleanup(); }
	});

	it("implement-plan rejects arguments without submitting an implementation request", async () => {
		const h = harness();
		try {
			h.fire("session_start");
			await h.command("another-plan.md", "implement-plan");
			assert.deepEqual(h.userMessages, []);
			assert.deepEqual(h.requests, []);
		} finally { h.cleanup(); }
	});

	it("does not submit implementation when the exact requested model is unavailable", async () => {
		const h = harness();
		try {
			h.fire("session_start");
			h.setAvailableModels([]);
			await assert.rejects(h.command("", "implement-plan"), /unavailable/);
			assert.deepEqual(h.userMessages, []);
			assert.deepEqual(h.requests, []);
		} finally { h.cleanup(); }
	});

	it("normal stays inactive; fast registers a strictly read-only runtime leaf and accounts each child once", async () => {
		const h = harness();
		try {
			h.fire("session_start");
			assert.deepEqual(h.active(), ["read", "subagent"]);
			await assert.rejects(h.invoke({ action: "create", tasks: [capsule("A")] }), /disabled/);
			await h.command("fast");
			assert.deepEqual(h.active(), ["read", "subagent", "fast_work"]);
			h.fire("before_agent_start", { prompt: "SECRET_PARENT_PROMPT", systemPromptOptions: { promptGuidelines: [] } });
			const result = await h.invoke({ action: "create", tasks: [capsule("A"), capsule("B", ["A"]), capsule("C")] });
			assert.equal(h.requests.length, 2);
			assert.equal(result.usage?.input, 20);
			const [leaf] = listRuntimeAgentConfigs(h.pi);
			assert.deepEqual(leaf?.tools, ["read", "grep", "find", "ls"]);
			assert.equal(leaf?.allowNestedSubagents, false);
			assert.equal(leaf?.inheritProjectContext, false);
			assert.equal(leaf?.inheritGlobalContext, false);
			assert.equal(leaf?.inheritSkills, false);
			assert.deepEqual(leaf?.extensions, []);
			assert.equal((await h.invoke({ action: "status" })).usage, undefined);
			await assert.rejects(h.invoke({ action: "advance", decisions: [{ id: "A", decision: "accept", evidence: "checked" }, { id: "unknown", decision: "accept", evidence: "not evidence" }] }), /captured completed/);
			const status = await h.invoke({ action: "status" });
			assert.equal(status.content[0]!.type, "text");
			if (status.content[0]!.type === "text") assert.match(status.content[0]!.text, /"id":"A","state":"awaiting_acceptance"/);
			const advanced = await h.invoke({ action: "advance", decisions: [{ id: "A", decision: "accept", evidence: "Validated A against the source" }] });
			assert.equal(h.requests.length, 3);
			assert.equal(advanced.usage?.input, 10);
			assert.match(h.requests[2]!.task!, /Validated A against the source/);
			h.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: "SECRET_TEXT" } });
			h.fire("tool_execution_start", { toolName: "SECRET_TOOL", args: { secret: "SECRET_ARGS" } });
			h.fire("message_end", { message: { role: "assistant", usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }, content: "SECRET_MESSAGE" } });
			h.fire("session_compact", { summary: "SECRET_SUMMARY" });
			h.fire("agent_end", { willRetry: true });
			assert.equal(h.entries.length, 0);
			h.fire("agent_end", { willRetry: false });
			assert.equal(h.entries.length, 0);
			h.fire("agent_settled");
			assert.equal(h.entries.length, 1);
			assert.equal(h.entries[0]!.type, "fast-work-observation");
			assert.equal(h.entries[0]!.data.parentModel, "openai-codex/gpt-6.1-sol");
			assert.equal(h.entries[0]!.data.parentThinking, "high");
			assert.equal(h.entries[0]!.data.compactions, 1);
			assert.equal(h.entries[0]!.data.parentUsageMessages, 1);
			assert.equal(h.entries[0]!.data.parentUsage?.input, 4);
			assert.equal(h.entries[0]!.data.plans.length, 1);
			assert.equal(h.entries[0]!.data.plans[0]!.tasks.length, 3);
			assert.deepEqual(h.entries[0]!.data.plans[0]!.tasks[1]!.dependencies, [0]);
			assert.equal(JSON.stringify(h.entries).includes("SECRET_"), false);
			h.fire("agent_settled");
			assert.equal(h.entries.length, 1);
			h.fire("session_start");
			assert.deepEqual(h.active(), ["read", "subagent"]);
			assert.deepEqual(listRuntimeAgentConfigs(h.pi), []);
		} finally { h.cleanup(); }
	});

	it("honors an explicit fast startup profile without dispatching until asked", async () => {
		const h = harness(true, { initialProfile: "fast" });
		try {
			h.fire("session_start");
			assert.deepEqual(h.active(), ["read", "subagent", "fast_work"]);
			assert.deepEqual(h.requests, []);
			const promptGuidelines: string[] = [];
			h.fire("before_agent_start", { systemPromptOptions: { promptGuidelines } });
			assert.match(promptGuidelines.join("\n"), /Use fast_work only when the user explicitly requests it/);
			assert.match(promptGuidelines.join("\n"), /ordinary isolated subagents.*read\/write\/edit.*openai-codex\/gpt-6\.1-sol:medium/);
			assert.doesNotMatch(promptGuidelines.join("\n"), /Prefer fast_work|writes.*in this parent/);
			assert.match(h.toolDescription()!, /only when the user explicitly requests/);
			assert.doesNotMatch(h.toolDescription()!, /Prefer this tool/);
			assert.match(promptGuidelines.join("\n"), /never overlap them with mutations/);
			await h.invoke({ action: "create", tasks: [capsule("A")] });
			assert.equal(h.requests.length, 1);
			await h.command("normal");
			assert.deepEqual(h.active(), ["read", "subagent"]);
			await assert.rejects(h.invoke({ action: "status" }), /disabled/);
			h.fire("session_start");
			assert.deepEqual(h.active(), ["read", "subagent", "fast_work"]);
			assert.deepEqual(listRuntimeAgentConfigs(h.pi), []);
			await assert.rejects(h.invoke({ action: "status" }), /No fast-work plan/);
		} finally { h.cleanup(); }
	});

	it("accepts empty unused arrays from required-key tool interfaces across create, status and advance", async () => {
		const h = harness(true, { initialProfile: "fast" });
		try {
			h.fire("session_start");
			const create = { action: "create" as const, tasks: [{ ...capsule("A"), model: "openai-codex/gpt-6.1-sol", thinking: "medium" as const }], decisions: [] };
			assert.equal(Check(h.parameters(), create), true);
			await h.invoke(create);
			assert.equal(h.requests.length, 1);
			assert.equal(h.requests[0]!.model, "openai-codex/gpt-6.1-sol");
			assert.equal(h.requests[0]!.thinking, "medium");
			const status = { action: "status" as const, tasks: [], decisions: [] };
			assert.equal(Check(h.parameters(), status), true);
			assert.equal((await h.invoke(status)).usage, undefined);
			const advance = { action: "advance" as const, tasks: [], decisions: [{ id: "A", decision: "accept" as const, evidence: "Validated A against the source" }] };
			assert.equal(Check(h.parameters(), advance), true);
			await h.invoke(advance);
			const accepted = await h.invoke(status);
			assert.equal(accepted.content[0]!.type, "text");
			if (accepted.content[0]!.type === "text") assert.match(accepted.content[0]!.text, /"id":"A","state":"accepted"/);
			assert.equal(h.requests.length, 1);
		} finally { h.cleanup(); }
	});

	it("still rejects populated arrays belonging to another action without dispatch or acceptance", async () => {
		const h = harness(true, { initialProfile: "fast" });
		const decisions = [{ id: "A", decision: "accept" as const, evidence: "Checked source" }];
		try {
			h.fire("session_start");
			await assert.rejects(h.invoke({ action: "create", tasks: [capsule("A")], decisions }), /create requires nonempty tasks and no decisions/);
			await assert.rejects(h.invoke({ action: "create", tasks: [], decisions: [] }), /create requires nonempty tasks and no decisions/);
			assert.equal(h.requests.length, 0);
			await h.invoke({ action: "create", tasks: [capsule("A")], decisions: [] });
			await assert.rejects(h.invoke({ action: "status", tasks: [capsule("B")], decisions: [] }), /status takes no tasks or decisions/);
			await assert.rejects(h.invoke({ action: "status", tasks: [], decisions }), /status takes no tasks or decisions/);
			await assert.rejects(h.invoke({ action: "advance", tasks: [capsule("B")], decisions }), /advance requires/);
			await assert.rejects(h.invoke({ action: "advance", tasks: [], decisions: [] }), /advance requires/);
			const status = await h.invoke({ action: "status" });
			if (status.content[0]!.type === "text") assert.match(status.content[0]!.text, /"id":"A","state":"awaiting_acceptance"/);
			assert.equal(h.requests.length, 1);
		} finally { h.cleanup(); }
	});

	it("validates live exact role configuration and lets task-level overrides win", async () => {
		const h = harness();
		try {
			h.fire("session_start");
			await assert.rejects(h.command("role WORKER_STANDARD missing/model medium"), /unavailable/);
			await h.command("role WORKER_STANDARD openai-codex/gpt-6-luna medium");
			await h.command("deep");
			await h.invoke({ action: "create", tasks: [capsule("scout"), { ...capsule("A"), model: "openai-codex/gpt-6.1-sol", thinking: "high" }] });
			assert.equal(h.requests[0]!.model, "openai-codex/gpt-6-luna");
			assert.equal(h.requests[0]!.thinking, "medium");
			assert.equal(h.requests[1]!.model, "openai-codex/gpt-6.1-sol");
			assert.equal(h.requests[1]!.thinking, "high");
			assert.equal(h.ctx.model?.id, "gpt-6.1-sol");
			await assert.rejects(h.invoke({ action: "create", tasks: [capsule("new")] }), /previous plan/);
			h.fire("session_start");
			await h.command("fast");
			await h.invoke({ action: "create", tasks: [capsule("reset")] });
			assert.equal(h.requests[2]!.model, "openai-codex/gpt-6.1-sol");
			assert.equal(h.requests[2]!.thinking, "medium");
		} finally { h.cleanup(); }
	});

	it("does not register tools or hooks in a child", () => {
		const previous = process.env.PI_SUBAGENT_CHILD;
		process.env.PI_SUBAGENT_CHILD = "1";
		const h = harness();
		try {
			assert.equal(h.toolName(), undefined);
			h.fire("session_start");
			assert.deepEqual(h.active(), ["read", "subagent"]);
			h.fire("agent_settled");
			assert.deepEqual(h.entries, []);
		} finally {
			h.cleanup();
			if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previous;
		}
	});

	it("observes a normal-mode baseline without activating or dispatching leaves", () => {
		const h = harness();
		try {
			h.fire("session_start");
			h.fire("before_agent_start", { systemPromptOptions: { promptGuidelines: [] } });
			h.fire("agent_settled");
			assert.equal(h.entries[0]!.data.profile, "normal");
			assert.deepEqual(h.entries[0]!.data.plans, []);
			assert.deepEqual(h.requests, []);
			assert.deepEqual(h.active(), ["read", "subagent"]);
		} finally { h.cleanup(); }
	});

	it("respects both SDK boolean and CLI string telemetry opt-out", () => {
		for (const setting of [false, "false"]) {
			const h = harness(setting);
			try {
				h.fire("session_start");
				h.fire("before_agent_start", { prompt: "SECRET_PROMPT", systemPromptOptions: { promptGuidelines: [] } });
				h.fire("agent_settled");
				assert.deepEqual(h.entries, []);
			} finally { h.cleanup(); }
		}
	});

	it("records deterministic first-text, first-tool, usage and compaction timing through the settled boundary", () => {
		let now = 10;
		const observation = new FastWorkTelemetry("normal", "openai-codex/gpt-6.1-sol", "high", () => now);
		now = 20; observation.firstTool();
		now = 30; observation.firstText();
		now = 35; observation.firstText(); observation.firstTool();
		observation.usage({ input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.1 });
		observation.usage({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.2 });
		observation.usage({ input: Number.NaN, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 });
		observation.compacted(); now = 100;
		const result = observation.finish([])!;
		assert.equal(result.firstToolMs, 10); assert.equal(result.firstTextMs, 20); assert.equal(result.wallMs, 90);
		assert.equal(result.compactions, 1); assert.equal(result.parentUsageMessages, 2);
		assert.equal(result.parentUsage?.input, 3);
		assert.equal(observation.finish([]), undefined);
		const absent = new FastWorkTelemetry("fast", undefined, "medium", () => 0).finish([])!;
		assert.equal(absent.firstTextMs, undefined); assert.equal(absent.firstToolMs, undefined); assert.equal(absent.parentUsage, undefined);
	});
});
