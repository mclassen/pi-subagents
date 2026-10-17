import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FastWorkPlan, resolveFastWorkModel, type FastWorkTask, type FastWorkRegistryModel } from "pi-subagents/fast-work";
import { delegateFastWork, type FastWorkEvents } from "../../src/fast-work/delegation.ts";
import { SUBAGENT_DELEGATION_RESPONSE_EVENT, SUBAGENT_DELEGATION_UPDATE_EVENT, type SubagentDelegationRequest } from "../../src/api/delegation.ts";
import { registerPromptTemplateDelegationBridge } from "../../src/slash/prompt-template-bridge.ts";
import type { PromptTemplateBridgeResult } from "../../src/slash/delegation-adapters.ts";

const models: FastWorkRegistryModel[] = [
	{ provider: "openai-codex", id: "gpt-6-luna", reasoning: true },
	{ provider: "openai-codex", id: "gpt-6.1-sol", reasoning: true },
];
const task = (id: string, dependsOn: string[] = []): FastWorkTask => ({
	id, dependsOn, goal: "Inspect the parser", context: "Frozen read-only scope", inputs: ["src/parser.ts"],
	acceptance: "Return exact source references and uncertainty", nonGoals: ["No implementation"], role: "WORKER_STANDARD",
});
const plan = (tasks: FastWorkTask[], profile: "normal" | "fast" | "deep" = "fast") => new FastWorkPlan({ profile, cwd: process.cwd(), agent: "fast-work-leaf", tasks, models });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class Events implements FastWorkEvents {
	private handlers = new Map<string, Set<Parameters<FastWorkEvents["on"]>[1]>>();
	on(name: string, handler: Parameters<FastWorkEvents["on"]>[1]): () => void {
		const handlers = this.handlers.get(name) ?? new Set();
		handlers.add(handler);
		this.handlers.set(name, handlers);
		return () => { handlers.delete(handler); };
	}
	emit(name: string, data: Parameters<FastWorkEvents["emit"]>[1]): void {
		const snapshot = [...(this.handlers.get(name) ?? [])];
		for (const handler of snapshot) handler(data);
	}
	count(): number { return [...this.handlers.values()].reduce((total, handlers) => total + handlers.size, 0); }
}

function owner() {
	const events = new Events();
	const releases = new Map<string, (result?: PromptTemplateBridgeResult) => void>();
	const requests: Array<{ request: SubagentDelegationRequest; signal: AbortSignal }> = [];
	let ordinaryCalls = 0;
	const bridge = registerPromptTemplateDelegationBridge({
		events, getContext: () => ({ cwd: process.cwd() }),
		execute: async () => { ordinaryCalls++; throw new Error("Must reuse the concurrent owned-leaf executor"); },
		executeStructured: async (id, params, signal) => {
			// Synthetic executor barrier: no provider, process, or authentication calls.
			const request: SubagentDelegationRequest = {
				requestId: id, ownerRunId: "unused", nodeId: "unused", agent: params.agent!, task: params.task!,
				context: params.context, cwd: params.cwd, model: params.model, thinking: params.delegatedThinkingOverride, result: { kind: "text" },
			};
			requests.push({ request, signal });
			return new Promise<PromptTemplateBridgeResult>((resolve) => releases.set(id, (result) => resolve(result ?? {
				details: { mode: "single", runId: `run-${id}`, results: [{ agent: params.agent, model: params.model, thinking: params.delegatedThinkingOverride, exitCode: 0, finalOutput: "Evidence at parser.ts:12", usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, turns: 1, cost: 0 } }] },
			})));
		},
	});
	const shutdown = new AbortController();
	const delegate = (request: SubagentDelegationRequest, signal: AbortSignal) => delegateFastWork(events, request, signal, shutdown.signal);
	return { events, bridge, releases, requests, shutdown, delegate, ordinaryCalls: () => ordinaryCalls };
}

describe("extension-owned fast-work policy through the public delegation bridge", () => {
	it("overlaps A and C, but waits for parent acceptance before dispatching B", async () => {
		const harness = owner();
		const graph = plan([task("A"), task("B", ["A"]), task("C")]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		assert.equal(harness.requests.length, 2);
		assert.equal(graph.metrics().peakActive, 2);
		assert.deepEqual(graph.snapshot().map((node) => node.state), ["running", "pending", "running"]);
		for (const release of harness.releases.values()) release();
		await running;
		assert.equal(harness.requests.length, 2);
		assert.throws(() => graph.decide("A", "accept"), /evidence summary/);
		graph.decide("A", "accept", "Validated parser.ts:12; the accepted grammar is X.");
		const next = graph.runReady(harness.delegate, new AbortController().signal);
		assert.equal(harness.requests.length, 3);
		const packet = JSON.parse(harness.requests.at(-1)!.request.task);
		assert.deepEqual(packet.acceptedDependencies, [{ id: "A", evidence: "Validated parser.ts:12; the accepted grammar is X." }]);
		harness.releases.get(harness.requests.at(-1)!.request.requestId)!();
		await next;
		assert.equal(harness.ordinaryCalls(), 0);
		harness.bridge.dispose();
	});

	it("caps independent leaves at three with fresh contexts and default Sol medium requests", async () => {
		const harness = owner();
		const graph = plan([task("a"), task("b"), task("c"), task("d"), task("e")]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		assert.equal(harness.requests.length, 3);
		harness.releases.get(harness.requests[0]!.request.requestId)!();
		await tick();
		assert.equal(harness.requests.length, 4);
		for (const release of harness.releases.values()) release();
		await tick();
		for (const release of harness.releases.values()) release();
		await running;
		assert.equal(harness.requests.length, 5);
		assert.equal(graph.metrics().peakActive, 3);
		for (const { request } of harness.requests) {
			assert.equal(request.context, "fresh");
			assert.equal(request.model, "openai-codex/gpt-6.1-sol");
			assert.equal(request.thinking, "medium");
			assert.match(request.task, /No edits, commands, nested delegation/);
		}
		harness.bridge.dispose();
	});

	it("defaults to Sol medium in every profile without requiring Luna or falling back to it", () => {
		for (const profile of ["normal", "fast", "deep"] as const) {
			const graph = new FastWorkPlan({ profile, cwd: process.cwd(), agent: "fast-work-leaf", tasks: [task("A")], models: models.filter((model) => model.id === "gpt-6.1-sol") });
			assert.equal(graph.metrics().tasks[0]!.model, "openai-codex/gpt-6.1-sol");
			assert.equal(graph.metrics().tasks[0]!.thinking, "medium");
		}
		assert.throws(() => new FastWorkPlan({ profile: "fast", cwd: process.cwd(), agent: "fast-work-leaf", tasks: [task("A")], models: models.filter((model) => model.id === "gpt-6-luna") }), /unavailable.*gpt-6\.1-sol/);
	});

	it("isolates failure and transitively blocks dependents without losing independent results", async () => {
		const harness = owner();
		const graph = plan([task("A"), task("B", ["A"]), task("D", ["B"]), task("C")]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		harness.releases.get(harness.requests[0]!.request.requestId)!({ isError: true, details: { results: [{ exitCode: 1, error: "Provider failed" }] } });
		harness.releases.get(harness.requests[1]!.request.requestId)!();
		await running;
		assert.deepEqual(graph.snapshot().map((node) => node.state), ["failed", "blocked", "blocked", "awaiting_acceptance"]);
		assert.throws(() => graph.decide("A", "accept", "not evidence"), /captured completed/);
		harness.bridge.dispose();
	});

	it("does not treat progress or cancellation as terminal; slots remain owned until settlement", async () => {
		const harness = owner();
		const graph = plan([task("A"), task("B")]);
		const abort = new AbortController();
		let done = false;
		const running = graph.runReady(harness.delegate, abort.signal).then(() => { done = true; });
		harness.events.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, {
			requestId: harness.requests[0]!.request.requestId, ownerRunId: graph.ownerRunId, nodeId: "A", currentTool: "read", recentOutput: "not terminal evidence",
		});
		await tick();
		assert.equal(done, false);
		abort.abort();
		await tick();
		assert.equal(done, false);
		assert.equal(harness.requests.every(({ signal }) => signal.aborted), true);
		assert.equal(graph.snapshot().every((node) => node.state === "running"), true);
		for (const release of harness.releases.values()) release();
		await running;
		assert.equal(graph.snapshot().every((node) => node.state === "cancelled"), true);
		harness.bridge.dispose();
	});

	it("rejects empty completed evidence and parent rejection blocks declared dependents", async () => {
		const harness = owner();
		const graph = plan([task("A"), task("B", ["A"]), task("empty")]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		harness.releases.get(harness.requests[0]!.request.requestId)!();
		harness.releases.get(harness.requests[1]!.request.requestId)!({ details: { results: [{ exitCode: 0, finalOutput: "" }] } });
		await running;
		assert.equal(graph.snapshot()[2]!.state, "failed");
		assert.match(graph.snapshot()[2]!.error!, /no captured nonempty/);
		graph.decide("A", "reject");
		assert.deepEqual(graph.snapshot().map((node) => node.state), ["rejected", "blocked", "failed"]);
		harness.bridge.dispose();
	});

	it("rejects missing owners and invalidated contexts without leaking listeners", async () => {
		const events = new Events();
		const graph = plan([task("A")]);
		await graph.runReady((request, signal) => delegateFastWork(events, request, signal, new AbortController().signal), new AbortController().signal);
		assert.equal(graph.snapshot()[0]!.state, "failed");
		assert.match(graph.snapshot()[0]!.error!, /No compatible/);
		assert.equal(events.count(), 0);
		const harness = owner();
		const other = plan([task("B")]);
		const running = other.runReady(harness.delegate, new AbortController().signal);
		harness.shutdown.abort();
		await running;
		assert.match(other.snapshot()[0]!.error!, /terminal state is unverified/);
		assert.equal(other.snapshot()[0]!.response, undefined);
		for (const release of harness.releases.values()) release();
		await tick();
		harness.bridge.dispose();
	});

	it("rejects cycles, unknown dependencies, broad capsules, and unreasoned strong-worker piles", () => {
		assert.throws(() => plan([task("A", ["B"]), task("B", ["A"])]), /cycle/);
		assert.throws(() => plan([task("A", ["missing"])]), /Unknown dependency/);
		assert.throws(() => plan([task("A"), task("A")]), /unique/);
		assert.throws(() => plan([{ ...task("A"), context: "x".repeat(8193) }]), /8192/);
		assert.throws(() => plan([{ ...task("A"), role: "WORKER_STRONG" }]), /escalationReason/);
		assert.throws(() => plan(["A", "B"].map((id) => ({ ...task(id), role: "WORKER_STRONG", escalationReason: "Conflicting causal evidence" }))), /at most one strong/);
	});

	it("leaves normal mode without fanout and respects explicit model/thinking selection", async () => {
		let calls = 0;
		await assert.rejects(plan([task("A")], "normal").runReady(async () => { calls++; throw new Error("unexpected"); }, new AbortController().signal), /does not fan out/);
		assert.equal(calls, 0);
		const harness = owner();
		const graph = plan([{ ...task("A"), role: "WORKER_STRONG", escalationReason: "Luna produced conflicting evidence", model: "openai-codex/gpt-6-luna", thinking: "medium" }], "deep");
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		assert.equal(harness.requests[0]!.request.model, "openai-codex/gpt-6-luna");
		assert.equal(harness.requests[0]!.request.thinking, "medium");
		for (const release of harness.releases.values()) release();
		await running;
		harness.bridge.dispose();
		assert.throws(() => resolveFastWorkModel({ model: "other/gpt-6-luna", thinking: "medium" }, models), /unavailable/);
		assert.throws(() => resolveFastWorkModel({ model: "openai-codex/gpt-6.1-sol", thinking: "high" }, [{ provider: "openai-codex", id: "gpt-6.1-sol", thinkingLevelMap: { high: null } }]), /unsupported/);
	});

	it("stores only whitelisted numeric telemetry, never capsules, paths, output, errors or task IDs", async () => {
		const harness = owner();
		const graph = plan([{ ...task("private_id"), goal: "SECRET_PROMPT", inputs: ["SECRET_PATH"], context: "SECRET_SOURCE" }]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		for (const release of harness.releases.values()) release({ details: { results: [{ exitCode: 1, error: "SECRET_ERROR", finalOutput: "SECRET_OUTPUT" }] } });
		await running;
		const metrics = JSON.stringify(graph.metrics());
		for (const secret of ["SECRET_", "private_id", "parser.ts"]) assert.equal(metrics.includes(secret), false);
		assert.equal(graph.metrics().tasks[0]!.usage, undefined, "missing counters are unavailable, not zero");
		harness.bridge.dispose();
	});

	it("ignores other owners' terminal events and disallows overlapping frontier/decision calls", async () => {
		const harness = owner();
		const graph = plan([task("A")]);
		const running = graph.runReady(harness.delegate, new AbortController().signal);
		harness.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: harness.requests[0]!.request.requestId, ownerRunId: "wrong-owner", nodeId: "A", status: "completed" });
		assert.equal(graph.snapshot()[0]!.state, "running");
		await assert.rejects(graph.runReady(harness.delegate, new AbortController().signal), /already running/);
		assert.throws(() => graph.decide("A", "accept", "evidence"), /current frontier/);
		for (const release of harness.releases.values()) release();
		await running;
		graph.decide("A", "reject");
		assert.equal(graph.snapshot()[0]!.state, "rejected");
		harness.bridge.dispose();
	});
});
