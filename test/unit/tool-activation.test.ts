import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import registerSubagentExtension from "../../src/extension/index.ts";
import { supportsMinimumVersion, unsupportedDynamicToolsReason } from "../../src/extension/tool-activation.ts";
import { PI_CODING_AGENT_PACKAGE_ROOT_ENV } from "../../src/shared/utils.ts";
import { PI_CODING_AGENT_PACKAGE, resolveInstalledPiPackageRoot, resolvePiPackageRoot } from "../../src/runs/shared/pi-spawn.ts";

type Handler = (event: any, context: any) => any;
type Tool = { name: string; description?: string; promptSnippet?: string; parameters?: unknown; execute?: (...args: any[]) => any };

const runtimes: Array<{ handlers: Map<string, Handler[]>; context: any }> = [];

function createRuntime(messages: any[] = [], excluded: string[] = [], missingApis: string[] = [], declareHost = true) {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, Tool>();
	let activeNames = ["read"];
	const selectionWrites: string[][] = [];
	let selectionFailure: "throw" | "ignore" | undefined;
	const excludedNames = new Set(excluded);
	const missingApiNames = new Set(missingApis);
	const pi = new Proxy({
		events: { on() { return () => {}; }, emit() {} },
		on(name: string, handler: Handler) {
			const registered = handlers.get(name) ?? [];
			registered.push(handler);
			handlers.set(name, registered);
		},
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
			if (!excludedNames.has(tool.name)) activeNames = [...new Set([...activeNames, tool.name])];
		},
		getAllTools() {
			return [...tools.values()].filter((tool) => !excludedNames.has(tool.name));
		},
		getActiveTools() { return [...activeNames]; },
		setActiveTools(names: string[]) {
			selectionWrites.push([...names]);
			if (selectionFailure === "throw") throw new Error("selection restricted");
			if (selectionFailure === "ignore") return;
			const available = new Set([...tools.keys(), "read"].filter((name) => !excludedNames.has(name)));
			activeNames = [...new Set(names.filter((name) => available.has(name)))];
		},
		registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() {},
	}, { get(target, property) {
		if (missingApiNames.has(String(property))) return undefined;
		return property in target ? target[property as keyof typeof target] : () => undefined;
	} });
	const context = {
		cwd: process.cwd(), hasUI: false, model: undefined,
		ui: { setWidget() {}, theme: { fg(_name: string, text: string) { return text; }, bg(_name: string, text: string) { return text; }, bold(text: string) { return text; } } },
		sessionManager: {
			getSessionId() { return "activation-session"; }, getSessionFile() { return null; }, getEntries() { return []; },
			buildSessionContext() { return { messages }; },
		},
		modelRegistry: { getAvailable() { return []; } },
	};
	const childEnv = process.env.PI_SUBAGENT_CHILD;
	delete process.env.PI_SUBAGENT_CHILD;
	// The gate trusts the running host or an explicit override only, and this
	// test process is neither, so declare the host it is exercising.
	const hostRoot = declareHost ? process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] ?? resolveInstalledPiPackageRoot() : undefined;
	const declaredHost = declareHost && process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] === undefined && hostRoot !== undefined;
	if (declaredHost) process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = hostRoot;
	try {
		registerSubagentExtension(pi as any);
	} finally {
		if (declaredHost) delete process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV];
		if (childEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = childEnv;
	}
	runtimes.push({ handlers, context });
	return {
		handlers, tools, context, selectionWrites,
		failSelection: (failure: "throw" | "ignore") => { selectionFailure = failure; },
		declarations: () => JSON.stringify(activeNames.map((name) => {
			const tool = tools.get(name);
			return { name, description: tool?.description, promptSnippet: tool?.promptSnippet, parameters: tool?.parameters };
		})),
		active: () => [...activeNames],
		select: (names: string[]) => { activeNames = [...names]; },
		async emit(name: string, event: any) {
			for (const handler of handlers.get(name) ?? []) await handler(event, context);
		},
	};
}

afterEach(async () => {
	for (const runtime of runtimes.splice(0)) {
		for (const handler of runtime.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" }, runtime.context);
	}
});

describe("subagent tool activation", () => {
	it("keeps subagent eager unless the host provides the complete dynamic-tool API", async () => {
		for (const missing of ["getAllTools", "getActiveTools", "setActiveTools"]) {
			const runtime = createRuntime([], [], [missing]);
			await runtime.emit("session_start", { type: "session_start", reason: "startup" });
			assert.ok(runtime.active().includes("subagent"), `${missing} must fail closed to eager subagent`);
			assert.equal(runtime.tools.has("subagents_enable"), false);
		}
	});

	it("starts fresh parents with a compact self-service loader and keeps support tools active", async () => {
		const runtime = createRuntime();
		await runtime.emit("session_start", { type: "session_start", reason: "startup" });

		assert.equal(runtime.active().includes("subagent"), false);
		assert.ok(runtime.active().includes("subagents_enable"));
		assert.ok(runtime.active().includes("bg_wait"));
		assert.ok(runtime.active().includes("subagent_supervisor"));
		const loader = runtime.tools.get("subagents_enable");
		assert.ok(loader);
		assert.match(loader.description ?? "", /current request|applicable .*instructions/i);
		assert.deepEqual(loader.parameters, { type: "object", properties: {}, additionalProperties: false });

		const result = await loader.execute?.("enable", {}, new AbortController().signal, undefined, runtime.context);
		assert.notEqual(result?.isError, true);
		assert.ok(runtime.active().includes("subagent"));
		assert.ok(runtime.active().includes("read"));
		assert.equal(runtime.selectionWrites.length, 2, "cold start and first enable change membership");
		assert.match(result?.content?.[0]?.text ?? "", /reuse.*capability discovery.*same established runtime\/agent\/model\/tool configuration/i);
		assert.match(result?.content?.[0]?.text ?? "", /otherwise.*subagent\(\{action:"list",capabilities:true\}\)/i);
		const enabled = runtime.active();
		const declarations = runtime.declarations();
		await loader.execute?.("enable-again", {}, new AbortController().signal, undefined, runtime.context);
		assert.deepEqual(runtime.active(), enabled);
		assert.equal(runtime.selectionWrites.length, 2, "repeated enable must not write an identical selection");
		assert.equal(runtime.declarations(), declarations);
	});

	it("restores native cold and warm transcript selections across start, reload, and tree navigation", async () => {
		const tool = { name: "subagent", description: "historical", parameters: { type: "object" } };
		const history = [{ role: "system", content: "", toolsAdded: [], timestamp: 1 }];
		const cold = createRuntime(history);
		await cold.emit("session_start", { type: "session_start", reason: "reload" });
		assert.equal(cold.active().includes("subagent"), false);
		assert.equal(cold.selectionWrites.length, 1);
		const coldDeclarations = cold.declarations();
		await cold.emit("session_tree", { type: "session_tree", newLeafId: null, oldLeafId: null });
		assert.equal(cold.active().includes("subagent"), false);
		assert.equal(cold.selectionWrites.length, 1, "identical cold restoration must not write");
		assert.equal(cold.declarations(), coldDeclarations);
		history.push({ role: "system", content: "", toolsAdded: [tool], timestamp: 2 });
		await cold.emit("session_tree", { type: "session_tree", newLeafId: null, oldLeafId: null });
		assert.ok(cold.active().includes("subagent"));
		assert.equal(cold.selectionWrites.length, 2, "tree membership addition must write");
		assert.notEqual(cold.declarations(), coldDeclarations);
		history.push({ role: "system", content: "", toolsAdded: [], toolsRemoved: [tool], timestamp: 3 } as any);
		await cold.emit("session_tree", { type: "session_tree", newLeafId: null, oldLeafId: null });
		assert.equal(cold.active().includes("subagent"), false);
		assert.equal(cold.selectionWrites.length, 3, "tree membership removal must write");
		assert.equal(cold.declarations(), coldDeclarations);

		const warm = createRuntime([{ role: "system", content: "", toolsAdded: [tool], timestamp: 1 }]);
		await warm.emit("session_start", { type: "session_start", reason: "resume" });
		assert.ok(warm.active().includes("subagent"));
		assert.ok(warm.active().includes("subagents_enable"));
		assert.equal(warm.selectionWrites.length, 0, "warm selection is already active after registration");
		const warmDeclarations = warm.declarations();
		await warm.emit("session_start", { type: "session_start", reason: "reload" });
		await warm.emit("session_tree", { type: "session_tree", newLeafId: null, oldLeafId: null });
		assert.equal(warm.selectionWrites.length, 0, "identical warm restoration must not write");
		assert.equal(warm.declarations(), warmDeclarations);
	});

	it("keeps eager compatibility for legacy history and when the loader is restricted", async () => {
		const legacy = createRuntime([{ role: "user", content: "continue", timestamp: 1 }]);
		await legacy.emit("session_start", { type: "session_start", reason: "startup" });
		assert.ok(legacy.active().includes("subagent"));
		assert.ok(legacy.active().includes("subagents_enable"));

		const restricted = createRuntime([], ["subagents_enable"]);
		await restricted.emit("session_start", { type: "session_start", reason: "startup" });
		assert.ok(restricted.active().includes("subagent"));
		assert.equal(restricted.active().includes("subagents_enable"), false);
		assert.equal(restricted.selectionWrites.length, 0);
	});

	it("does not activate delegation from prompt keywords and reports an unavailable target", async () => {
		const runtime = createRuntime();
		await runtime.emit("session_start", { type: "session_start", reason: "startup" });
		runtime.select(["read"]);
		const selectedTools = runtime.active();
		await runtime.emit("before_agent_start", {
			type: "before_agent_start", prompt: "delegate this complex task", systemPrompt: "base",
			systemPromptOptions: { selectedTools, sections: new Map(), promptGuidelines: [] },
		});
		assert.equal(runtime.active().includes("subagent"), false);
		assert.ok(runtime.active().includes("subagents_enable"));
		assert.ok(selectedTools.includes("subagents_enable"));
		const defaultSelectionEvent = {
			type: "before_agent_start", prompt: "continue", systemPrompt: "base",
			systemPromptOptions: { selectedTools: undefined as string[] | undefined, sections: new Map(), promptGuidelines: [] },
		};
		await runtime.emit("before_agent_start", defaultSelectionEvent);
		assert.ok(defaultSelectionEvent.systemPromptOptions.selectedTools?.includes("read"));
		assert.ok(defaultSelectionEvent.systemPromptOptions.selectedTools?.includes("subagents_enable"));

		(runtime.tools as Map<string, Tool>).delete("subagent");
		const loader = runtime.tools.get("subagents_enable");
		const writes = runtime.selectionWrites.length;
		const result = await loader?.execute?.("missing", {}, new AbortController().signal, undefined, runtime.context);
		assert.equal(result?.isError, true);
		assert.match(result?.content?.[0]?.text ?? "", /unavailable.*subagent/i);
		assert.deepEqual(result?.details, { unavailable: ["subagent"] });
		assert.equal(runtime.selectionWrites.length, writes, "unavailable target must not write");
	});

	it("normalizes selections while preserving order and real membership changes", async () => {
		const runtime = createRuntime();
		await runtime.emit("session_start", { type: "session_start", reason: "startup" });
		runtime.select(["subagents_enable", "read", "read"]);
		const loader = runtime.tools.get("subagents_enable")!;
		await loader.execute?.("ordered-enable", {}, new AbortController().signal, undefined, runtime.context);
		assert.deepEqual(runtime.selectionWrites.at(-1), ["subagents_enable", "read", "subagent"]);
		assert.deepEqual(runtime.active(), ["subagents_enable", "read", "subagent"]);
		const writes = runtime.selectionWrites.length;
		const declarations = runtime.declarations();
		await loader.execute?.("ordered-enable-again", {}, new AbortController().signal, undefined, runtime.context);
		assert.equal(runtime.selectionWrites.length, writes);
		assert.equal(runtime.declarations(), declarations);
		runtime.select(["read", "subagent"]);
		await loader.execute?.("restore-loader", {}, new AbortController().signal, undefined, runtime.context);
		assert.deepEqual(runtime.active(), ["read", "subagent", "subagents_enable"]);
		assert.equal(runtime.selectionWrites.length, writes + 1, "missing loader membership must still write");
	});

	it("reports missing activation when the host rejects or ignores a selection change", async () => {
		for (const failure of ["throw", "ignore"] as const) {
			const runtime = createRuntime();
			await runtime.emit("session_start", { type: "session_start", reason: "startup" });
			const declarations = runtime.declarations();
			runtime.failSelection(failure);
			const result = await runtime.tools.get("subagents_enable")?.execute?.("restricted", {}, new AbortController().signal, undefined, runtime.context);
			assert.equal(result?.isError, true);
			assert.deepEqual(result?.details, { missing: ["subagent"] });
			assert.match(result?.content?.[0]?.text ?? "", /Activation failed/);
			assert.equal(runtime.selectionWrites.length, 2, "real membership change must reach the host");
			assert.equal(runtime.declarations(), declarations);
		}
	});
});

function withHostPackageRoot(manifest: Record<string, unknown> | string, run: () => void): void {
	assert.equal(resolvePiPackageRoot(), undefined, "the test process must not look like a running host package");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-host-root-"));
	fs.writeFileSync(path.join(root, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
	const prior = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV];
	const priorPiPackageDir = process.env.PI_PACKAGE_DIR;
	delete process.env.PI_PACKAGE_DIR;
	process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = root;
	try {
		run();
	} finally {
		if (prior === undefined) delete process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV];
		else process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = prior;
		if (priorPiPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = priorPiPackageDir;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe("host dynamic tool support detection", () => {
	it("compares the host version against the 0.86.1 floor", () => {
		for (const [version, supported] of [
			["0.85.9", false], ["0.86.0", false], ["0.86.1", true], ["0.87.0", true], ["1.0.0", true],
			["0.86", false], ["0.86.1-rc.1", false], ["0.87.0-beta.2", false], ["v0.87.0", false], ["current", false],
		] as const) {
			assert.equal(supportsMinimumVersion(version), supported, `version ${version}`);
		}
	});

	it("names the measured installation for a host below the floor", () => {
		const hostApi = { getAllTools() {}, getActiveTools() {}, setActiveTools() {} } as any;
		withHostPackageRoot({ name: PI_CODING_AGENT_PACKAGE, version: "0.86.0" }, () => {
			const reason = unsupportedDynamicToolsReason(hostApi);
			assert.match(reason ?? "", /requires Pi 0\.86\.1 or newer/);
			assert.match(reason ?? "", /detected 0\.86\.0 in .*pi-subagents-host-root-/);
		});
		withHostPackageRoot({ name: PI_CODING_AGENT_PACKAGE, version: "0.88.0" }, () => {
			assert.equal(unsupportedDynamicToolsReason(hostApi), undefined);
		});
	});

	it("accepts a validated 0.87 Bun bin/share host image", () => {
		const hostApi = { getAllTools() {}, getActiveTools() {}, setActiveTools() {} } as any;
		const manifestPath = "/synthetic-host/share/pi-coding-agent/package.json";
		assert.equal(unsupportedDynamicToolsReason(hostApi, {
			platform: "linux",
			bunVersion: "1.2.0",
			argv1: "/$bunfs/root/pi",
			execPath: "/synthetic-host/bin/pi",
			env: {},
			realpathSync: (value) => value,
			existsSync: (value) => value === manifestPath,
			readFileSync: (value) => value === manifestPath
				? JSON.stringify({ name: PI_CODING_AGENT_PACKAGE, version: "0.87.0" })
				: (() => { throw new Error(`unexpected read: ${value}`); })(),
		}), undefined);
	});

	it("keeps manifest failures visible instead of falling through", () => {		const hostApi = { getAllTools() {}, getActiveTools() {}, setActiveTools() {} } as any;
		withHostPackageRoot("{ not json", () => {
			assert.match(unsupportedDynamicToolsReason(hostApi) ?? "", /Could not read a valid Pi package manifest at .*package\.json/);
		});
		withHostPackageRoot({ name: PI_CODING_AGENT_PACKAGE }, () => {
			assert.match(unsupportedDynamicToolsReason(hostApi) ?? "", /has no version/);
		});
		withHostPackageRoot({ name: "@someone-else/tool", version: "0.88.0" }, () => {
			const reason = unsupportedDynamicToolsReason(hostApi) ?? "";
			assert.match(reason, /is not @earendil-works\/pi-coding-agent/);
			assert.match(reason, /PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT override/);
		});
	});

	it("refuses to gate on an SDK that is not the running host", async () => {
		const hostApi = { getAllTools() {}, getActiveTools() {}, setActiveTools() {} } as any;
		const prior = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV];
		const priorPiPackageDir = process.env.PI_PACKAGE_DIR;
		delete process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV];
		delete process.env.PI_PACKAGE_DIR;
		try {
			assert.equal(resolvePiPackageRoot(), undefined);
			assert.match(unsupportedDynamicToolsReason(hostApi) ?? "", /Could not verify the running Pi installation|Could not locate the running Pi installation/);
			const runtime = createRuntime([], [], [], false);
			await runtime.emit("session_start", { type: "session_start", reason: "startup" });
			assert.equal(runtime.tools.has("subagents_enable"), false);
			assert.ok(runtime.active().includes("subagent"));
		} finally {
			if (prior !== undefined) process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = prior;
			if (priorPiPackageDir !== undefined) process.env.PI_PACKAGE_DIR = priorPiPackageDir;
		}
	});

	it("stays eager below the floor and activates the loader at or above it", async () => {
		let old!: ReturnType<typeof createRuntime>;
		withHostPackageRoot({ name: PI_CODING_AGENT_PACKAGE, version: "0.86.0" }, () => { old = createRuntime(); });
		await old.emit("session_start", { type: "session_start", reason: "startup" });
		assert.equal(old.tools.has("subagents_enable"), false);
		assert.ok(old.active().includes("subagent"));

		let broken!: ReturnType<typeof createRuntime>;
		withHostPackageRoot("{ not json", () => { broken = createRuntime(); });
		await broken.emit("session_start", { type: "session_start", reason: "startup" });
		assert.equal(broken.tools.has("subagents_enable"), false, "a broken host manifest must fail closed");
		assert.ok(broken.active().includes("subagent"));

		let supported!: ReturnType<typeof createRuntime>;
		withHostPackageRoot({ name: PI_CODING_AGENT_PACKAGE, version: "0.88.0" }, () => { supported = createRuntime(); });
		await supported.emit("session_start", { type: "session_start", reason: "startup" });
		assert.ok(supported.tools.has("subagents_enable"));
		assert.equal(supported.active().includes("subagent"), false);
	});
});
