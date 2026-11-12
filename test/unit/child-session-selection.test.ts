import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createDefaultChildSessionFactory, type ChildSessionLaunch, type PiCodingAgentModule } from "../../src/runs/shared/child-session.ts";

function launch(model?: string): ChildSessionLaunch {
	return { cwd: process.cwd(), storage: { kind: "memory" }, model, extensionPaths: [], ambientExtensions: false, hooks: [], noSkills: true, noContextFiles: true, runtime: {} as ChildSessionLaunch["runtime"] };
}

function scripted(options: { clamp?: boolean; changeOnBind?: boolean; failBind?: boolean; failShutdown?: boolean } = {}) {
	const sessions: Array<{ model: { provider: string; id: string }; thinkingLevel: string; disposed: number; shutdowns: number; prompts: number }> = [];
	const pi = {
		ModelRuntime: { create: async () => ({}) },
		SettingsManager: { create: () => ({}) },
		DefaultResourceLoader: class { async reload() {} },
		SessionManager: { inMemory: () => ({}) },
		resolveCliModel: ({ cliModel }: { cliModel: string }) => {
			const [name, thinkingLevel] = cliModel.split(":");
			const [provider, id] = name!.split("/");
			return { model: { provider, id }, thinkingLevel };
		},
		createAgentSession: async ({ model = { provider: "default", id: "inherited" }, thinkingLevel = "off" }) => {
			const session = {
				model, thinkingLevel: options.clamp ? "low" : thinkingLevel, disposed: 0, shutdowns: 0, prompts: 0,
				async bindExtensions() {
					if (options.changeOnBind) this.model = { provider: "other", id: "substitute" };
					if (options.failBind) throw new Error("bind failed");
				},
				dispose() { this.disposed++; },
				async prompt() { this.prompts++; },
				extensionRunner: { onError: () => () => {}, hasHandlers: () => true, emit: async () => { session.shutdowns++; if (options.failShutdown) throw new Error("shutdown failed"); } },
			};
			sessions.push(session);
			return { session };
		},
	} as unknown as PiCodingAgentModule;
	return { sessions, factory: createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi }) };
}

describe("child requested versus actual selection", () => {
	it("keeps independent explicit Terra high and Sol medium siblings", async () => {
		const { factory, sessions } = scripted();
		const [terra, sol] = await Promise.all([factory.create(launch("openai-codex/gpt-6.1-terra:high")), factory.create(launch("openai-codex/gpt-6.1-sol:medium"))]);
		await Promise.all([terra.prompt("one"), sol.prompt("two")]);
		assert.deepEqual(sessions.map(s => [s.model.id, s.thinkingLevel, s.prompts]), [["gpt-6.1-terra", "high", 1], ["gpt-6.1-sol", "medium", 1]]);
		await terra.dispose();
		assert.equal(sessions[1]!.disposed, 0);
		await sol.prompt("still independent");
		await factory.dispose();
	});
	it("rejects clamping before bind/provider prompt and disposes the opened session", async () => {
		const { factory, sessions } = scripted({ clamp: true });
		await assert.rejects(factory.create(launch("openai-codex/gpt-6.1-sol:high")), /thinking level.*clamped/);
		assert.deepEqual(sessions.map(s => [s.prompts, s.shutdowns, s.disposed]), [[0, 1, 1]]);
		await factory.dispose();
	});
	for (const options of [{ changeOnBind: true }, { failBind: true }]) {
		it(`shuts down and disposes after binding failure ${JSON.stringify(options)}`, async () => {
			const { factory, sessions } = scripted(options);
			await assert.rejects(factory.create(launch("openai-codex/gpt-6.1-sol:high")), /changed|bind failed/);
			assert.deepEqual(sessions.map(s => [s.prompts, s.shutdowns, s.disposed]), [[0, 1, 1]]);
			await factory.dispose();
		});
	}
	it("checks again immediately before a prompt and disposes altered sessions", async () => {
		const { factory, sessions } = scripted();
		const child = await factory.create(launch("openai-codex/gpt-6.1-sol:high"));
		sessions[0]!.thinkingLevel = "medium";
		await assert.rejects(child.prompt("must not send"), /thinking level.*changed/);
		assert.deepEqual(sessions.map(s => [s.prompts, s.shutdowns, s.disposed]), [[0, 1, 1]]);
		await factory.dispose();
	});
	it("preserves absent effort and absent model semantics", async () => {
		const { factory } = scripted();
		await factory.create(launch());
		await factory.create(launch("openai-codex/gpt-6.1-sol"));
		await factory.dispose();
	});
	it("reports cleanup failure as well as the selection failure", async () => {
		const { factory, sessions } = scripted({ clamp: true, failShutdown: true });
		await assert.rejects(factory.create(launch("openai-codex/gpt-6.1-sol:high")), /clamped.*cleanup failed.*shutdown failed/);
		assert.equal(sessions[0]!.disposed, 1);
		await assert.rejects(factory.dispose(), /shutdown failed/);
	});
});

describe("installed SDK no-network selection boundary", () => {
	it("reports pre-bind clamp and dispatched shutdown failures, unsubscribing and disposing once", async () => {
		let disposed = 0;
		let providerPrompts = 0;
		let shutdowns = 0;
		let listeners = 0;
		let unsubscribed = 0;
		const pi = {
			...sdk,
			createAgentSession: async (options: Parameters<typeof sdk.createAgentSession>[0]) => {
				const result = await sdk.createAgentSession(options);
				assert.equal(result.session.thinkingLevel, "off", "real SDK clamps the requested high effort");
				const dispose = result.session.dispose.bind(result.session);
				result.session.dispose = () => { disposed++; dispose(); };
				result.session.prompt = async () => { providerPrompts++; throw new Error("Provider prompts forbidden"); };
				const runner = result.session.extensionRunner;
				const onError = runner.onError.bind(runner);
				runner.onError = (listener) => {
					listeners++;
					const unsubscribe = onError(listener);
					return () => { unsubscribed++; unsubscribe(); };
				};
				return result;
			},
		};
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		await assert.rejects(factory.create({
			...launch("openai/gpt-4o:high"),
			hooks: [{ name: "throwing-shutdown", factory: (pi) => {
				pi.on("session_shutdown", async () => { shutdowns++; throw new Error("actual shutdown hook failed"); });
			} }],
		}), (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors.length, 2);
			assert.match(String(error.errors[0]), /thinking level.*clamped/);
			assert.match(String(error.errors[1]), /actual shutdown hook failed/);
			return true;
		});
		assert.equal(shutdowns, 1);
		assert.equal(disposed, 1);
		assert.equal(providerPrompts, 0);
		assert.equal(listeners, 1);
		assert.equal(unsubscribed, 1);
		await assert.rejects(factory.dispose(), /actual shutdown hook failed/);
		await assert.rejects(factory.create(launch("openai-codex/gpt-6.1-sol:medium")), /cleanup.*failed/);
		assert.equal(disposed, 1);
	});
	it("preserves mixed child profiles and rejects actual SDK effort clamping without provider turns", async () => {
		const opened: Array<{ session: Awaited<ReturnType<typeof sdk.createAgentSession>>["session"]; disposed: number }> = [];
		let providerPrompts = 0;
		const pi = {
			...sdk,
			createAgentSession: async (options: Parameters<typeof sdk.createAgentSession>[0]) => {
				const result = await sdk.createAgentSession(options);
				const record = { session: result.session, disposed: 0 };
				opened.push(record);
				const dispose = result.session.dispose.bind(result.session);
				result.session.dispose = () => { record.disposed++; dispose(); };
				result.session.prompt = async () => { providerPrompts++; throw new Error("Provider prompts forbidden in this test"); };
				return result;
			},
		};
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => pi });
		try {
			const [terra, sol] = await Promise.all([factory.create(launch("openai-codex/gpt-6.1-terra:high")), factory.create(launch("openai-codex/gpt-6.1-sol:medium"))]);
			assert.equal(terra.modelId, "openai-codex/gpt-6.1-terra");
			assert.equal(sol.modelId, "openai-codex/gpt-6.1-sol");
			assert.deepEqual(opened.map(r => r.session.thinkingLevel), ["high", "medium"]);
			await assert.rejects(factory.create(launch("openai/gpt-4o:high")), /thinking level.*clamped/);
			assert.equal(opened[2]!.session.thinkingLevel, "off");
			assert.equal(opened[2]!.disposed, 1);
			assert.deepEqual(opened.slice(0, 2).map(r => r.disposed), [0, 0]);
			assert.equal(providerPrompts, 0);
		} finally { await factory.dispose(); }
		assert.ok(opened.every(r => r.disposed === 1));
	});
});
