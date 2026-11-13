import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Details } from "../../src/shared/types.ts";
import { createEventBus, createMockPi, makeMinimalCtx } from "../support/helpers.ts";

// SYNTHETIC child model output only: registered foreground workflows, child
// execution, shell verification and mission/index persistence are real.
for (const kind of ["disabled", "implicit", "verified"] as const) {
	it(`registered foreground workflow binds its one ${kind} child to the owner goal`, { timeout: 90000 }, async (t) => {
		const root = fs.mkdtempSync(path.join(process.env.PI_BOUNDARY_EVIDENCE ?? os.tmpdir(), `synthetic-foreground-${kind}-`));
		const project = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const sessionFile = path.join(agentDir, "sessions", "synthetic-owner.jsonl");
		const keys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "PI_SUBAGENTS_HERDR_BRIDGE", "PI_OFFLINE"];
		const oldEnv = new Map(keys.map((key) => [key, process.env[key]]));
		const mock = createMockPi();
		const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
		type Execute = (id: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: undefined, ctx: ExtensionContext) => Promise<AgentToolResult<Details>>;
		let execute: Execute | undefined;
		let ctx: ExtensionContext | undefined;
		let passed = false;
		const processes: Array<{ proc: ChildProcess; closed: boolean }> = [];
		const capture = (message: unknown) => {
			const proc = (message as { process?: unknown }).process;
			if (!(proc instanceof ChildProcess)) return;
			const item = { proc, closed: false };
			processes.push(item);
			proc.once("close", () => { item.closed = true; });
		};
		channel("child_process").subscribe(capture);
		try {
			fs.mkdirSync(project, { recursive: true });
			fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
			fs.writeFileSync(sessionFile, "");
			process.env.PI_CODING_AGENT_DIR = agentDir;
			delete process.env.PI_SUBAGENT_CHILD;
			delete process.env.PI_SUBAGENTS_HERDR_BRIDGE;
			process.env.PI_OFFLINE = "1";
			const configPath = path.join(agentDir, "extensions", "subagent", "config.json");
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, JSON.stringify({ asyncByDefault: false, forceTopLevelAsync: false, fleetView: false, artifactDir: "temp", scheduledRuns: { storeRoot: path.join(root, "scheduled") }, missions: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") } }));
			const agents = path.join(project, ".pi", "agents");
			fs.mkdirSync(agents, { recursive: true });
			fs.writeFileSync(path.join(agents, "acceptance-fixture.md"), "---\nname: acceptance-fixture\ndescription: Synthetic scripted foreground fixture\nmodel: mock/test-model\n---\nReturn the synthetic report.\n");
			fs.writeFileSync(path.join(project, "candidate.txt"), "synthetic verified candidate");
			fs.writeFileSync(path.join(project, "verify.cjs"), "require('node:fs').writeFileSync('synthetic-shell-passed', 'real shell passed');\n");
			const command = `"${process.execPath}" verify.cjs`;
			const report = "```acceptance-report\n" + JSON.stringify({ criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "synthetic report; real shell decides" }], changedFiles: ["candidate.txt"], testsAddedOrUpdated: ["verify.cjs"], commandsRun: [{ command, result: "passed", summary: "synthetic claim" }], validationOutput: ["real gate decides"], residualRisks: [], noStagedFiles: true }) + "\n```";
			mock.install();
			const pi = new Proxy({ events: createEventBus(), on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); }, registerTool(tool: { name: string; execute: Execute }) { if (tool.name === "subagent") execute = tool.execute; }, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() {} }, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => undefined; } });
			ctx = { ...makeMinimalCtx(project), isIdle: () => true, hasPendingMessages: () => false, sessionManager: { getSessionId: () => "synthetic-foreground-owner", getSessionFile: () => sessionFile, getEntries: () => [] }, modelRegistry: { getAvailable: () => [{ provider: "mock", id: "test-model", reasoning: true }] } } as unknown as ExtensionContext;
			const { default: register } = await import("../../index.ts");
			register(pi as unknown as ExtensionAPI);
			assert.ok(execute);
			for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
			let callId = 0;
			// The public tool takes an inline script as options.script.
			const call = ({ workflowScript, ...params }: Record<string, unknown>) => execute!(String(++callId), workflowScript === undefined ? params : { ...params, options: { script: workflowScript } }, new AbortController().signal, undefined, ctx!);
			const created = await call({ action: "mission.create", mission: { title: `Synthetic foreground ${kind}`, goal: true, maxIterations: 4 } });
			assert.notEqual(created.isError, true, JSON.stringify(created));
			const id = created.details.missionId!;
			const recordPath = created.details.missionPath!;
			await call({ action: "mission.update", missionId: id, missionUpdate: { goal: { iteration: "begin" } } });
			const before = JSON.parse(fs.readFileSync(recordPath, "utf8"));
			const child: Record<string, unknown> = { agent: "acceptance-fixture", task: "Synthetic foreground child", async: false };
			if (kind === "disabled") child.acceptance = false;
			if (kind === "verified") child.acceptance = { candidate: { files: ["candidate.txt", "verify.cjs"] }, level: "verified", criteria: ["Run the synthetic fixture gate"], verify: [{ id: "fixture-gate", command, timeoutMs: 10000 }] };
			mock.onCall({ output: kind === "verified" ? report : "Synthetic foreground response" });
			const result = await call({ workflowScript: `return await runs.run("only-child", ${JSON.stringify(child)});`, agentScope: "project", async: false, missionId: id });
			assert.notEqual(result.isError, true, JSON.stringify(result));
			assert.equal(result.details.mode, "workflow");
			const rows = result.details.results as unknown as Array<{ runId?: string; workflowKey?: string; acceptance?: { explicit?: boolean; status?: string; identity?: { producerRunId?: string } } }>;
			const inventory = result.details.workflowChildren!;
			assert.equal(inventory.inventoryComplete, true);
			assert.equal(inventory.children.length, 1);
			assert.equal(rows.length, 1);
			// Upstream exposes the foreground child's run id on its row; it must be the inventory child.
			if (rows[0]?.runId !== undefined) assert.equal(rows[0].runId, inventory.children[0]?.runId);
			assert.equal(rows[0]?.workflowKey, "only-child");
			assert.equal(inventory.children[0]?.childId, "only-child");
			assert.ok(inventory.children[0]?.runId);
			assert.ok(rows[0]?.acceptance);
			assert.equal(rows[0]?.acceptance?.explicit, kind !== "implicit");
			if (kind === "disabled") assert.equal(rows[0]?.acceptance?.status, "not-required");
			if (kind === "verified") {
				assert.equal(rows[0]?.acceptance?.status, "verified");
				assert.equal(rows[0]?.acceptance?.identity?.producerRunId, inventory.children[0]?.runId);
				assert.equal(fs.readFileSync(path.join(project, "synthetic-shell-passed"), "utf8"), "real shell passed");
			}
			const observed = JSON.parse(fs.readFileSync(recordPath, "utf8"));
			assert.equal(observed.ownerSessionId, sessionFile);
			assert.deepEqual(observed.goal, before.goal);
			for (const run of before.runs) assert.ok(observed.runs.some((candidate: { runId: string }) => candidate.runId === run.runId));
			if (kind === "verified") {
				const candidatePath = path.join(project, "candidate.txt");
				const original = fs.readFileSync(candidatePath);
				try {
					fs.writeFileSync(candidatePath, "synthetic changed candidate");
					const bytes = fs.readFileSync(recordPath, "utf8");
					await assert.rejects(call({ action: "mission.close", missionId: id, summary: "synthetic stale candidate" }), /acceptance/i);
					assert.equal(fs.readFileSync(recordPath, "utf8"), bytes);
				} finally { fs.writeFileSync(candidatePath, original); }
			}
			const route = kind === "implicit" ? { action: "mission.update", missionId: id, missionUpdate: { status: "completed" } } : { action: "mission.close", missionId: id, summary: "Synthetic foreground completed" };
			const [closure] = await Promise.allSettled([call(route)]);
			t.diagnostic(JSON.stringify({ synthetic: true, kind, root, workflowRunId: result.details.runId, inventory, rows, authority: observed.acceptanceAuthority, missionAcceptance: observed.acceptance, closure: closure.status, closureError: closure.status === "rejected" ? String(closure.reason) : undefined, sessions: mock.sessions.map((session) => ({ disposed: session.disposed, settled: session.settled })), processes: processes.map(({ proc, closed }) => ({ pid: proc.pid, closed })) }));
			assert.equal(observed.acceptanceAuthority?.completion, "observed");
			if (kind === "verified") {
				assert.equal(observed.acceptanceAuthority.producerRunId, inventory.children[0]?.runId);
				assert.deepEqual(observed.acceptance, JSON.parse(JSON.stringify(rows[0]?.acceptance)));
			} else {
				assert.notEqual(observed.acceptanceAuthority?.runtime, true);
				assert.equal(observed.acceptance, undefined);
			}
			assert.equal(closure.status, "fulfilled", "owner may close once the real foreground child settles");
			const closed = JSON.parse(fs.readFileSync(recordPath, "utf8"));
			assert.equal(closed.status, "completed");
			assert.equal(closed.ownerSessionId, before.ownerSessionId);
			assert.deepEqual(closed.goal, before.goal);
			assert.deepEqual(closed.runs, observed.runs);
			assert.ok(mock.sessions.length > 0 && mock.sessions.every((session) => session.disposed && session.settled));
			// Background session-start work (the watchdog git baseline) may still be finishing; wait, bounded.
			for (const deadline = Date.now() + 10_000; !processes.every((item) => item.closed) && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 50));
			assert.ok(processes.every((item) => item.closed));
			passed = true;
		} finally {
			try {
				if (ctx) for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
			} finally {
				channel("child_process").unsubscribe(capture);
				const terminal = processes.every((item) => item.closed) && mock.sessions.every((session) => session.disposed && session.settled);
				if (terminal) mock.uninstall();
				for (const [key, value] of oldEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
				if (passed && terminal) fs.rmSync(root, { recursive: true, force: true });
				else t.diagnostic(`Synthetic fixture retained: ${root}; all captured subprocesses and scripted sessions terminal=${terminal}`);
			}
		}
	});
}
