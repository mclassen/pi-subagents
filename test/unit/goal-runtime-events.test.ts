import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_CHILD_ENV } from "../../src/runs/shared/child-runtime-config.ts";
import { createMission, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";

const SESSION_ID = "goal-runtime-session";

function createRuntime(child = false, saved = false) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-goal-events-"));
	const projectRoot = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(projectRoot, { recursive: true });
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const originalChildFlag = process.env[SUBAGENT_CHILD_ENV];
	delete process.env[SUBAGENT_CHILD_ENV];
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const sessionFile = path.join(root, "synthetic-session.jsonl");
	if (saved) fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: SESSION_ID })}\n${JSON.stringify({ type: "message", id: "user-1", message: { role: "user", content: "Synthetic fixture" } })}\n`);
	let failSend = false;
	const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
	const sent: Array<{ message: any; options: any }> = [];
	const events = { on() { return () => {}; }, emit() {} };
	const pi = new Proxy({
		events,
		on(channel: string, handler: (...args: any[]) => unknown) { handlers.set(channel, [...(handlers.get(channel) ?? []), handler]); },
		registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, registerEntryRenderer() {},
		sendMessage(message: any, options: any) { if (failSend) { failSend = false; throw new Error("synthetic synchronous send failure"); } sent.push({ message, options }); },
		getSessionName() { return undefined; },
	}, { get(target, prop) { return prop in target ? (target as any)[prop] : () => undefined; } });
	const ctx = {
		cwd: projectRoot,
		hasUI: false,
		hasPendingMessages: () => false,
		isIdle: () => true,
		sessionManager: { getSessionId: () => SESSION_ID, getSessionFile: () => saved ? sessionFile : null, getEntries: () => [] },
		modelRegistry: { getAvailable: () => [] },
		ui: { setWidget() {}, requestRender() {}, theme: { fg(_name: string, text: string) { return text; }, bg(_name: string, text: string) { return text; }, bold(text: string) { return text; } } },
	};
	const location = resolveMissionStoreLocation({ projectRoot, agentDir });
	return {
		root, projectRoot, agentDir, originalAgentDir, handlers, sent, ctx, location, sessionFile,
		failNextSend() { failSend = true; },
		persistNotice(message: any) {
			// Synthetic disk append, NOT actual AgentSession dispatch/persistence.
			fs.appendFileSync(sessionFile, `${JSON.stringify({ type: "custom_message", id: `notice-${sent.length}`, ...message })}\n`);
		},
		async restart() {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" });
			handlers.clear();
			ctx.sessionManager = { ...ctx.sessionManager };
			await this.start();
		},
		async start() {
			const { default: registerSubagentExtension } = await import("../../src/extension/index.ts");
			if (child) process.env[SUBAGENT_CHILD_ENV] = "1";
			registerSubagentExtension(pi as any);
			for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		},
		async input(text: string, source = "interactive") {
			const results = [];
			for (const handler of handlers.get("input") ?? []) results.push(await handler({ type: "input", text, source }, ctx));
			return results.filter((result) => result !== undefined);
		},
		async end(stopReason: string, pendingMessages = false) {
			ctx.hasPendingMessages = () => pendingMessages;
			for (const handler of handlers.get("agent_end") ?? []) await handler({ messages: [{ role: "assistant", stopReason }] }, ctx);
		},
		async settle() {
			for (const handler of handlers.get("agent_settled") ?? []) await handler();
		},
		async shutdown() {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" });
			if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
			if (originalChildFlag === undefined) delete process.env[SUBAGENT_CHILD_ENV];
			else process.env[SUBAGENT_CHILD_ENV] = originalChildFlag;
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}

function createGoal(runtime: ReturnType<typeof createRuntime>, title: string) {
	return createMission(runtime.location, { title, objective: title, goal: true, status: "active", ownerSessionId: runtime.ctx.sessionManager.getSessionFile() ?? SESSION_ID });
}

describe("goal mission runtime events", () => {
	it("acknowledges delivered notices AND evaluates current progress on ordinary agent_end", async () => {
		const runtime = createRuntime(false, true);
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Synthetic ordinary continuation loop");
			await runtime.end("stop");
			runtime.persistNotice(runtime.sent[0]!.message);
			updateMission(runtime.location, mission.id, { summary: "Synthetic implementation checkpoint advanced" });
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 2, "delivery acknowledgment must not consume the ordinary progress evaluation");
			assert.equal(runtime.sent[1]!.options.triggerTurn, true);
			assert.notEqual(runtime.sent[0]!.message.details.event.runId, runtime.sent[1]!.message.details.event.runId);
			runtime.persistNotice(runtime.sent[1]!.message);
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 3);
			assert.equal(runtime.sent[2]!.options.triggerTurn, false, "unchanged progress pauses once");
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 3);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "paused");
			assert.equal(readMission(runtime.location, mission.id).goal?.iterationsStarted, 0);
		} finally { await runtime.shutdown(); }
	});

	it("retries an interrupted queue in a fresh runtime and reconciles persisted identity without reissuing", async () => {
		const runtime = createRuntime(false, true);
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Synthetic queue crash");
			await runtime.end("stop");
			const first = runtime.sent[0]!.message;
			assert.equal(readMission(runtime.location, mission.id).goal?.lastContinuation?.delivery, "pending", "send return is not acknowledgment");
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 1, "current runtime queued identity suppresses retry");
			runtime.ctx.isIdle = () => false;
			await runtime.restart();
			assert.equal(runtime.sent.length, 1, "startup recovery requires an idle host");
			runtime.ctx.isIdle = () => true;
			await runtime.restart();
			assert.equal(runtime.sent.length, 2, "new runtime proves absence on disk");
			assert.equal(runtime.sent[1]!.message.details.event.runId, first.details.event.runId);
			for (const handler of runtime.handlers.get("message_end") ?? []) await handler({ message: { role: "custom", ...first } }, runtime.ctx);
			assert.equal(readMission(runtime.location, mission.id).goal?.lastContinuation?.delivery, "pending", "pre-append message_end is not acknowledgment");
			runtime.persistNotice(first);
			updateMission(runtime.location, mission.id, { summary: "Synthetic progress before idle startup reconciliation" });
			await runtime.restart();
			assert.equal(runtime.sent.length, 2, "durable delivery before mission ack never reissues");
			assert.equal(readMission(runtime.location, mission.id).goal?.lastContinuation?.delivery, "observed");
			assert.equal(readMission(runtime.location, mission.id).goal?.iterationsStarted, 0);
		} finally { await runtime.shutdown(); }
	});

	it("retries synchronous send failure but honors pending-input recovery guards", async () => {
		const runtime = createRuntime(false, true);
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Synthetic send failure");
			runtime.failNextSend();
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 0);
			await runtime.end("stop", true);
			await runtime.restart();
			assert.equal(runtime.sent.length, 0);
			await runtime.end("stop");
			assert.equal(runtime.sent.length, 1);
			assert.equal(readMission(runtime.location, mission.id).goal?.iterationsStarted, 0);
		} finally { await runtime.shutdown(); }
	});
	it("rejects exact-ID interactive and rpc foreign cancellation and does not continue cancelled own goals", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			for (const source of ["interactive", "rpc"]) {
				const mission = createMission(runtime.location, { title: source, objective: "Work", goal: true, ownerSessionId: "foreign", status: "active" });
				assert.deepEqual(await runtime.input(`/goal cancel ${mission.id}`, source), [{ action: "handled" }]);
				const saved = readMission(runtime.location, mission.id);
				assert.equal(saved.status, "active");
				assert.equal(saved.ownerSessionId, "foreign");
				assert.equal(saved.goal?.iterationsStarted, 0);
				assert.match(runtime.sent.at(-1)!.message.content, /owning session/);
				assert.deepEqual(await runtime.input(`/goal cancel ${mission.id}`, source), [{ action: "handled" }]);
				assert.deepEqual(readMission(runtime.location, mission.id), saved);
			}
			const own = createGoal(runtime, "No continuation");
			await runtime.input(`/goal cancel ${own.id}`);
			const sent = runtime.sent.length;
			await runtime.end("stop");
			await runtime.settle();
			assert.equal(runtime.sent.length, sent);
			assert.equal(readMission(runtime.location, own.id).status, "cancelled");
		} finally { await runtime.shutdown(); }
	});

	it("handles malformed and rejected commands without falling through or mutating goals", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const goal = createGoal(runtime, "Keep");
			const before = readMission(runtime.location, goal.id);
			for (const text of ["/goal cancel ../escape", "/goal cancel missing", `/goal cancel ${goal.id} extra`, "/goal cancel --all", "/goal cancel:bad"]) {
				assert.deepEqual(await runtime.input(text), [{ action: "handled" }]);
				assert.match(runtime.sent.at(-1)!.message.content, /failed/);
				assert.deepEqual(readMission(runtime.location, goal.id), before);
			}
			for (const status of ["completed", "failed"] as const) {
				const terminal = createMission(runtime.location, { title: status, objective: "Keep", goal: true, status, ownerSessionId: SESSION_ID });
				assert.deepEqual(await runtime.input(`/goal cancel ${terminal.id}`), [{ action: "handled" }]);
				assert.match(runtime.sent.at(-1)!.message.content, /already/);
				assert.equal(readMission(runtime.location, terminal.id).status, status);
			}
			assert.deepEqual(await runtime.input("Please cancel my goal"), []);
			assert.deepEqual(await runtime.input("/goal Build something"), []);
			assert.deepEqual(readMission(runtime.location, goal.id), before, "raw goal input never preemptively replaces a goal");
		} finally { await runtime.shutdown(); }
	});

	it("keeps no-ID selection session-scoped and registers no child override", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const own = createGoal(runtime, "Own");
			const foreign = createMission(runtime.location, { title: "Foreign", objective: "Keep", goal: true, ownerSessionId: "foreign" });
			assert.deepEqual(await runtime.input("/goal cancel"), [{ action: "handled" }]);
			assert.equal(readMission(runtime.location, own.id).status, "cancelled");
			assert.equal(readMission(runtime.location, foreign.id).status, "planned");
		} finally { await runtime.shutdown(); }
		const child = createRuntime(true);
		try {
			await child.start();
			assert.equal(child.handlers.has("input"), false);
		} finally { await child.shutdown(); }
	});

	it("does not wake while messages are pending, then triggers after an idle turn", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Pending messages");
			await runtime.end("stop", true);
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");

			await runtime.end("stop");
			assert.equal(runtime.sent.length, 1);
			assert.equal(runtime.sent[0]!.message.details.goalContinuation, true);
			assert.equal(runtime.sent[0]!.options.triggerTurn, true);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");
		} finally {
			await runtime.shutdown();
		}
	});

	it("does not pause on a retryable assistant error, but pauses after final settlement", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Retry or pause");
			await runtime.end("error");
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");

			await runtime.end("stop");
			assert.equal(runtime.sent.length, 1);
			assert.equal(runtime.sent[0]!.options.triggerTurn, true);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");

			await runtime.end("error");
			await runtime.settle();
			assert.equal(runtime.sent.length, 1);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "paused");
		} finally {
			await runtime.shutdown();
		}
	});

	it("defers goal handling for a recoverable length response until the retry succeeds", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Length recovery");
			await runtime.end("length");
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");

			await runtime.end("stop");
			assert.equal(runtime.sent.length, 1);
			assert.equal(runtime.sent[0]!.options.triggerTurn, true);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");
		} finally {
			await runtime.shutdown();
		}
	});

	it("pauses an unrecovered length response at agent_settled without waking a goal turn", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Unrecovered length");
			await runtime.end("length");
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "active");

			await runtime.settle();
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "paused");
		} finally {
			await runtime.shutdown();
		}
	});

	it("pauses after an aborted assistant turn without scheduling continuation", async () => {
		const runtime = createRuntime();
		try {
			await runtime.start();
			const mission = createGoal(runtime, "Aborted turn");
			await runtime.end("aborted");
			assert.equal(runtime.sent.length, 0);
			assert.equal(readMission(runtime.location, mission.id).goal?.status, "paused");
		} finally {
			await runtime.shutdown();
		}
	});
});
