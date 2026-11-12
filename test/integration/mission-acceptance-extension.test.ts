import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Details } from "../../src/shared/types.ts";
import { createEventBus, createMockPi, makeMinimalCtx } from "../support/helpers.ts";

// Scope: the supported foreground single-child producer, not async aggregation.
// Mocked boundary: createMockPi scripts the child session/model response; the
// host below captures Pi registration/events. Dispatch, launch, acceptance
// evaluation (including shell commands), and mission persistence are real.
it("registered subagent tool preserves rejected goal evidence and recovers via a new verified child run", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-acceptance-extension-"));
	const project = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	const sessionFile = path.join(agentDir, "sessions", "acceptance-owner.jsonl");
	const owner = sessionFile; // Saved-session path is the extension's durable owner identity.
	const keys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "PI_SUBAGENTS_HERDR_BRIDGE", "PI_OFFLINE"];
	const previousEnv = new Map(keys.map((key) => [key, process.env[key]]));
	const mock = createMockPi();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	type Execute = (id: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: undefined, ctx: ExtensionContext) => Promise<AgentToolResult<Details>>;
	let execute: Execute | undefined;
	let ctx: ExtensionContext | undefined;
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
		fs.writeFileSync(configPath, JSON.stringify({
			asyncByDefault: false, forceTopLevelAsync: false, fleetView: false,
			artifactDir: "temp", scheduledRuns: { storeRoot: path.join(root, "scheduled") },
			missions: { directory: path.join(root, "missions"), globalIndexDir: path.join(root, "index") },
		}));
		const agents = path.join(project, ".pi", "agents");
		fs.mkdirSync(agents, { recursive: true });
		fs.writeFileSync(path.join(agents, "acceptance-fixture.md"), "---\nname: acceptance-fixture\ndescription: Scripted acceptance fixture\nmodel: mock/test-model\n---\nReturn the supplied fixture report.\n");
		// This command really executes twice; its marker proves neither outcome
		// was inferred from the scripted child's claim or a manufactured ledger.
		fs.writeFileSync(path.join(project, "verify.cjs"), `const fs = require('node:fs');\nconst pass = fs.existsSync('ready');\nfs.appendFileSync('verification.log', pass ? 'pass\\n' : 'fail\\n');\nprocess.exit(pass ? 0 : 7);\n`);
		const command = `"${process.execPath}" verify.cjs`;
		const acceptance = { level: "verified", criteria: ["Run the fixture gate"], verify: [{ id: "fixture-gate", command, timeoutMs: 10000 }] };
		const report = "```acceptance-report\n" + JSON.stringify({
			criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "Scripted child attestation; runtime gate is authoritative" }],
			changedFiles: ["verify.cjs"], testsAddedOrUpdated: ["verify.cjs"],
			commandsRun: [{ command, result: "passed", summary: "Child claim deliberately identical for both runs" }],
			validationOutput: ["Host runs the gate independently"], residualRisks: [], noStagedFiles: true,
		}) + "\n```";
		mock.install();
		const pi = new Proxy({
			events: createEventBus(),
			on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
				const list = handlers.get(name) ?? [];
				list.push(handler);
				handlers.set(name, list);
			},
			registerTool(tool: { name: string; execute: Execute }) { if (tool.name === "subagent") execute = tool.execute; },
			registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() {},
		}, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => undefined; } });
		ctx = {
			...makeMinimalCtx(project),
			sessionManager: { getSessionId: () => "mission-acceptance-owner", getSessionFile: () => sessionFile, getEntries: () => [] },
			modelRegistry: { getAvailable: () => [{ provider: "mock", id: "test-model", reasoning: true }] },
		} as unknown as ExtensionContext;
		const { default: register } = await import("../../index.ts");
		register(pi as unknown as ExtensionAPI);
		assert.ok(execute, "public package entrypoint registered the subagent tool");
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		let callId = 0;
		const call = (params: Record<string, unknown>) => execute!(String(++callId), params, new AbortController().signal, undefined, ctx!);
		const created = await call({ action: "mission.create", mission: { title: "Acceptance recovery", goal: true, maxIterations: 4 } });
		assert.notEqual(created.isError, true, JSON.stringify(created));
		const missionId = created.details.missionId!;
		assert.ok(missionId);
		assert.equal(created.details.mission?.ownerSessionId, owner);
		const launch = () => call({ agent: "acceptance-fixture", agentScope: "project", task: "Run the fixture gate and report evidence", async: false, missionId, acceptance });
		const show = async () => {
			const result = await call({ action: "mission.show", missionId });
			assert.notEqual(result.isError, true, JSON.stringify(result));
			assert.ok(result.details.mission);
			return result.details.mission;
		};
		await call({ action: "mission.update", missionId, missionUpdate: { goal: { iteration: "begin" } } });
		mock.onCall({ output: report });
		await assert.rejects(launch(), /Acceptance verification.*fixture-gate.*failed/i);
		assert.equal(mock.callCount(), 1);
		const before = await show();
		assert.equal(before.acceptance?.verifyRuns[0]?.exitCode, 7);
		assert.equal(before.acceptance?.status, "rejected");
		assert.equal(before.status, "active");
		assert.equal(before.ownerSessionId, owner);
		assert.equal(fs.readFileSync(path.join(project, "verification.log"), "utf8"), "fail\n");
		const missionPath = created.details.missionPath!;
		const recordBytes = fs.readFileSync(missionPath, "utf8");
		const indexFiles = fs.readdirSync(path.join(root, "index"));
		assert.equal(indexFiles.length, 1);
		const indexPath = path.join(root, "index", indexFiles[0]!);
		const indexBytes = fs.readFileSync(indexPath, "utf8");
		const attempts = [];
		for (const params of [
			{ action: "mission.close", missionId, summary: "Premature close" },
			{ action: "mission.update", missionId, missionUpdate: { status: "completed" } },
		]) attempts.push(...await Promise.allSettled([call(params)]));
		assert.deepEqual(attempts.map((attempt) => attempt.status), ["rejected", "rejected"], "both public completion routes must block recorded rejection");
		for (const attempt of attempts) if (attempt.status === "rejected") assert.match(String(attempt.reason), /recorded acceptance is rejected/i);
		assert.equal(fs.readFileSync(missionPath, "utf8"), recordBytes);
		assert.equal(fs.readFileSync(indexPath, "utf8"), indexBytes);
		const paused = await call({ action: "mission.update", missionId, missionUpdate: { status: "waiting", goal: { paused: true }, summary: "Gate remains incomplete" } });
		assert.notEqual(paused.isError, true, JSON.stringify(paused));
		assert.equal(paused.details.mission?.goal?.status, "paused");
		assert.equal(paused.details.mission?.status, "waiting");
		assert.deepEqual(paused.details.mission?.acceptance, before.acceptance);
		const resumed = await call({ action: "mission.update", missionId, missionUpdate: { goal: { paused: false } } });
		assert.notEqual(resumed.isError, true, JSON.stringify(resumed));
		assert.equal(resumed.details.mission?.ownerSessionId, owner);
		assert.equal(resumed.details.mission?.status, "active");
		assert.deepEqual(resumed.details.mission?.acceptance, before.acceptance);
		// Change only the gate's input, never a mission record or acceptance field.
		fs.writeFileSync(path.join(project, "ready"), "ready");
		mock.onCall({ output: report });
		const passed = await launch();
		assert.notEqual(passed.isError, true, JSON.stringify(passed));
		assert.equal(mock.callCount(), 2);
		assert.equal(passed.details.results[0]?.acceptance?.status, "verified");
		assert.equal(passed.details.results[0]?.acceptance?.verifyRuns[0]?.exitCode, 0);
		assert.equal(fs.readFileSync(path.join(project, "verification.log"), "utf8"), "fail\npass\n");
		const recovered = await show();
		assert.equal(recovered.acceptance?.status, "verified");
		assert.deepEqual(recovered.acceptance, JSON.parse(JSON.stringify(passed.details.results[0]?.acceptance)), "persisted producer ledger survives JSON serialization");
		assert.equal(recovered.runs.length, 2);
		assert.notEqual(recovered.runs[0]?.runId, recovered.runs[1]?.runId);
		assert.equal(recovered.status, "active", "child success does not automatically close the parent goal");
		const closed = await call({ action: "mission.close", missionId, summary: "Runtime gate passed" });
		assert.notEqual(closed.isError, true, JSON.stringify(closed));
		assert.equal(closed.details.mission?.status, "completed");
		assert.equal(closed.details.mission?.ownerSessionId, owner);
		assert.deepEqual(closed.details.mission?.acceptance, recovered.acceptance);
		assert.ok(mock.sessions.every((session) => session.disposed), "foreground children released");
	} finally {
		try {
			if (ctx) for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
		} finally {
			mock.uninstall();
			for (const [key, value] of previousEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
});
