import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createDefaultChildSessionFactory,
	type ChildSessionLaunch,
	type PiCodingAgentModule,
} from "../../src/runs/shared/child-session.ts";

const launch = (): ChildSessionLaunch => ({
	cwd: process.cwd(),
	storage: { kind: "memory" },
	extensionPaths: [],
	ambientExtensions: false,
	hooks: [],
	noSkills: true,
	noContextFiles: true,
	runtime: {} as ChildSessionLaunch["runtime"],
});
function fixture(
	shutdown: (report: (error: string) => void) => Promise<void>,
	dispose: () => void = () => {},
	open: () => Promise<void> = async () => {},
	prompt: () => Promise<void> = async () => {},
	abort: () => Promise<void> = async () => {},
) {
	let report = (_error: {
		extensionPath: string;
		event: string;
		error: string;
	}) => {};
	return createDefaultChildSessionFactory({
		shutdownTimeoutMs: 20,
		loadPiCodingAgent: async () => {
			await open();
			return {
				ModelRuntime: { create: async () => ({}) },
				SettingsManager: { create: () => ({}) },
				DefaultResourceLoader: class {
					async reload() {}
				},
				SessionManager: { inMemory: () => ({}) },
				createAgentSession: async () => ({
					session: {
						bindExtensions: async (bindings: { onError: typeof report }) => {
							report = bindings.onError;
						},
						dispose,
						extensionRunner: {
							hasHandlers: () => true,
							emit: () =>
								shutdown((error) =>
									report({
										extensionPath: "fixture",
										event: "session_shutdown",
										error,
									}),
								),
						},
						abort,
						prompt,
						messages: [],
					},
				}),
			} as unknown as PiCodingAgentModule;
		},
	});
}

describe("default child factory disposal", () => {
	it("waits for successful shutdown before resolving", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const factory = fixture(() => gate);
		await factory.create(launch());
		let settled = false;
		const done = factory.dispose().then(() => {
			settled = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(settled, false);
		release();
		await done;
	});
	it("rejects rather than reporting completion after a shutdown timeout", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const factory = fixture(() => gate);
		await factory.create(launch());
		try {
			await assert.rejects(factory.dispose(), /shutdown.*timed out/i);
		} finally {
			release();
		}
	});
	it("rejects shutdown errors reported by Pi's non-throwing dispatcher", async () => {
		const factory = fixture(async (report) => {
			report("hook failed");
		});
		await factory.create(launch());
		await assert.rejects(factory.dispose(), /hook failed/);
	});
	it("does not certify cleanup while a child is still opening", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const factory = fixture(
			async () => {},
			() => {},
			() => gate,
		);
		const creating = factory.create(launch());
		await assert.rejects(factory.dispose(), /creation is still in progress/);
		release();
		await assert.rejects(creating, /opened during failed cleanup/);
	});
	it("does not certify cleanup while a child prompt remains unsettled after abort", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const factory = fixture(async () => {}, () => {}, async () => {}, () => gate);
		const child = await factory.create(launch());
		const prompting = child.prompt("held prompt");
		try {
			await assert.rejects(factory.dispose(), /prompt did not settle.*cleanup is unverified/i);
		} finally {
			release();
			await prompting;
		}
	});
	it("propagates prompt abort failure", async () => {
		let release!: () => void;
		const prompt = new Promise<void>((resolve) => { release = resolve; });
		const factory = fixture(async () => {}, () => {}, async () => {}, () => prompt, async () => {
			throw new Error("abort failed");
		});
		const child = await factory.create(launch());
		const prompting = child.prompt("held prompt");
		try {
			await assert.rejects(factory.dispose(), /prompt abort failed.*abort failed/i);
		} finally {
			release();
			await prompting;
		}
	});
	it("propagates shutdown failure", async () => {
		const factory = fixture(async () => {
			throw new Error("shutdown failed");
		});
		await factory.create(launch());
		await assert.rejects(factory.dispose(), /shutdown failed/);
	});
	it("propagates disposal failure without an unhandled rejection", async () => {
		const factory = fixture(
			async () => {},
			() => {
				throw new Error("dispose failed");
			},
		);
		await factory.create(launch());
		await assert.rejects(factory.dispose(), /dispose failed/);
		await new Promise<void>((resolve) => setImmediate(resolve));
	});
});
