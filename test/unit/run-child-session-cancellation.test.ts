import assert from "node:assert/strict";
import { test } from "node:test";
import { runChildSession } from "../../src/runs/background/run-child-session.ts";
import type { ChildSession, ChildSessionFactory } from "../../src/runs/shared/child-session.ts";

test("cleanup failure prevents a stopped run from publishing success", async () => {
	let stop: (() => void) | undefined;
	let release!: (child: ChildSession) => void;
	const opening = new Promise<ChildSession>((resolve) => { release = resolve; });
	const child: ChildSession = {
		subscribe: () => () => {}, prompt: async () => {}, steer: async () => {}, followUp: async () => {}, abort: async () => {},
		dispose: async () => { throw new Error("cleanup rejected"); },
		messages: [], sessionFile: undefined, sessionId: "fixture", modelId: undefined,
	};
	const result = runChildSession({
		factory: { create: () => opening, dispose: async () => {} },
		launch: {
			session: { cwd: process.cwd(), storage: { kind: "memory" }, extensionPaths: [], ambientExtensions: false, hooks: [], noSkills: true, noContextFiles: true, runtime: {} as never },
			config: { agent: "fixture" } as never, toolPlan: {} as never,
			capture: { structuredOutput: () => ({ called: false, acceptanceReportProvided: false }), toolDiagnostic: () => undefined, runtimeAcknowledgedExtensions: () => undefined, finalDrainHeld: () => false },
			launchResolvedExtensions: {} as never, warnings: [],
		},
		prompt: "must not start", appendChildEvent: () => {}, writeOutputLine: () => {},
		registerStop: (value) => { stop = value; },
	});
	stop!();
	release(child);
	const settled = await result;
	assert.equal(settled.exitCode, 1);
	assert.match(settled.error ?? "", /cleanup rejected/);
});

for (const mode of ["stop", "timeout", "interrupt"] as const) {
	test(`${mode} during creation never starts the child prompt`, async () => {
		let release!: (child: ChildSession) => void;
		const opening = new Promise<ChildSession>((resolve) => { release = resolve; });
		const calls: string[] = [];
		const child: ChildSession = {
			subscribe: () => () => {},
			prompt: async () => { calls.push("prompt"); },
			steer: async () => {}, followUp: async () => {},
			abort: async () => { calls.push("abort"); },
			dispose: async () => { calls.push("dispose"); },
			messages: [], sessionFile: undefined, sessionId: "fixture", modelId: undefined,
		};
		const factory: ChildSessionFactory = { create: () => opening, dispose: async () => {} };
		let cancel: (() => void) | undefined;
		const result = runChildSession({
			factory,
			launch: {
				session: { cwd: process.cwd(), storage: { kind: "memory" }, extensionPaths: [], ambientExtensions: false, hooks: [], noSkills: true, noContextFiles: true, runtime: {} as never },
				config: { agent: "fixture" } as never,
				toolPlan: {} as never,
				capture: { structuredOutput: () => ({ called: false, acceptanceReportProvided: false }), toolDiagnostic: () => undefined, runtimeAcknowledgedExtensions: () => undefined, finalDrainHeld: () => false },
				launchResolvedExtensions: {} as never,
				warnings: [],
			},
			prompt: "must not start",
			appendChildEvent: () => {}, writeOutputLine: () => {},
			...(mode === "stop" ? { registerStop: (value: (() => void) | undefined) => { cancel = value; } } : {}),
			...(mode === "timeout" ? { registerTimeout: (value: (() => void) | undefined) => { cancel = value; } } : {}),
			...(mode === "interrupt" ? { registerInterrupt: (value: (() => void) | undefined) => { cancel = value; } } : {}),
		});
		cancel!();
		release(child);
		const settled = await result;
		assert.deepEqual(calls, ["dispose"]);
		assert.equal(settled.exitCode, mode === "interrupt" ? 0 : 1);
		assert.equal(settled[mode === "timeout" ? "timedOut" : mode === "stop" ? "stopped" : "interrupted"], true);
	});
}
