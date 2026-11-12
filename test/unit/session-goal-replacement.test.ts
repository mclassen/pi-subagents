import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { prepareMissionLaunch } from "../../src/missions/lifecycle.ts";
import { collectGoalContinuationNotices } from "../../src/missions/goal-driver.ts";
import { createMission, createSessionGoal, listMissions, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-goal-replacement-"));
	const location = resolveMissionStoreLocation({ projectRoot: root, agentDir: path.join(root, "agent"), config: { globalIndex: false, retainTerminal: 1 } });
	const config = { directory: location.missionDir, globalIndex: false, retainTerminal: 1 };
	return { root, location, config, bytes: (id: string) => fs.readFileSync(missionRecordPath(location, id), "utf8") };
}

it("both entrypoints replace only own open goals, retaining evidence and foreign 9/20 counters", () => {
	const t = fixture();
	try {
		const a = createMission(t.location, { title: "A", objective: "A", goal: true, ownerSessionId: "A", maxIterations: 20 });
		for (let i = 0; i < 9; i++) {
			updateMission(t.location, a.id, { goal: { iteration: "begin" } });
			updateMission(t.location, a.id, { goal: { iteration: "complete" } });
		}
		updateMission(t.location, a.id, { goal: { status: "paused" } });
		const preserved = [a,
			createMission(t.location, { title: "Unowned", objective: "Keep", goal: true }),
			createMission(t.location, { title: "Ordinary", objective: "Keep", ownerSessionId: "B" }),
			...(["completed", "failed", "cancelled"] as const).map((status) => createMission(t.location, { title: status, objective: "Keep", ownerSessionId: "B", goal: true, status })),
		].map((record) => [record.id, t.bytes(record.id)] as const);
		const evidence = path.join(t.root, "evidence.md");
		fs.writeFileSync(evidence, "unchanged evidence");
		const old = createMission(t.location, { title: "Old B", objective: "B", goal: true, ownerSessionId: "B" });
		updateMission(t.location, old.id, { goal: { iteration: "begin" } });
		const before = updateMission(t.location, old.id, {
			summary: "Checkpoint", usage: { tokens: 42 },
			addRuns: [{ runId: "running", mode: "single", status: "running" }],
			addArtifacts: [{ kind: "note", path: evidence }], acceptance: { evidence: "keep" },
			addDecisions: [{ title: "Keep decision" }],
			addReceipts: [{ kind: "ci", status: "ready", title: "CI", url: "https://example.test/ci" }],
		});
		const legacy = createMission(t.location, { title: "Second old B", objective: "B", goal: true, ownerSessionId: "B" });
		const fresh = handleMissionAction("mission.create", { mission: { title: "New B", goal: true } }, { cwd: t.root, config: t.config, currentSessionId: "B" }).details!.mission!;
		const cancelled = readMission(t.location, old.id);
		assert.deepEqual(cancelled, { ...before, status: "cancelled", updatedAt: cancelled.updatedAt, summary: `Checkpoint\nGoal superseded by new goal ${fresh.id}. Running jobs are NOT stopped.` });
		assert.equal(readMission(t.location, legacy.id).status, "cancelled");
		assert.equal(fresh.goal?.iterationsStarted, 0);
		assert.deepEqual(fresh.usage, { tokens: 0 });
		assert.equal(fs.readFileSync(evidence, "utf8"), "unchanged evidence");
		const launch = prepareMissionLaunch({ params: { mission: { title: "Workflow B", goal: true } }, projectRoot: t.root, config: t.config, ownerSessionId: "B" })!;
		assert.equal(readMission(t.location, fresh.id).status, "cancelled");
		const started = readMission(t.location, launch.missionId);
		assert.equal(started.goal?.iterationsStarted, 1);
		assert.equal(prepareMissionLaunch({ params: { missionId: started.id }, projectRoot: t.root, config: t.config, ownerSessionId: "B" })?.missionId, started.id);
		assert.deepEqual(readMission(t.location, started.id).goal, started.goal);
		for (const [id, bytes] of preserved) assert.equal(t.bytes(id), bytes);
		assert.deepEqual(collectGoalContinuationNotices({ location: t.location, ownerSessionId: "B", retainedChildren: [], turnId: "turn" }).filter((notice) => notice.missionId === old.id || notice.missionId === fresh.id), []);
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});

it("invalid inputs and creation I/O failures preserve the existing goal", () => {
	const t = fixture();
	try {
		const old = createSessionGoal(t.location, { title: "Old", objective: "Keep", goal: true, ownerSessionId: "B" });
		const before = t.bytes(old.id);
		for (const input of [{ title: "", objective: "Bad" }, { title: "Bad", objective: "Bad", maxIterations: 0 }]) {
			assert.throws(() => createSessionGoal(t.location, { ...input, goal: true, ownerSessionId: "B" }));
		}
		for (const launch of [false, true]) assert.throws(() => launch
			? prepareMissionLaunch({ params: { mission: { title: "Bad", goal: true, maxIterations: 0 } }, projectRoot: t.root, config: t.config, ownerSessionId: "B" })
			: handleMissionAction("mission.create", { mission: { title: "Bad", goal: true, maxIterations: 0 } }, { cwd: t.root, config: t.config, currentSessionId: "B" }));
		const blocked = path.join(t.root, "not-directory");
		fs.writeFileSync(blocked, "blocked");
		assert.throws(() => createSessionGoal({ ...t.location, writeGlobalIndex: true, globalIndexDir: blocked }, { title: "Failed index", objective: "Keep", goal: true, ownerSessionId: "B" }));
		assert.equal(t.bytes(old.id), before);
		assert.equal(listMissions(t.location).records.length, 2, "partially persisted creation is not deleted");
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});

it("two separate processes serialize same-session creations", { timeout: 20000 }, async () => {
	const t = fixture();
	try {
		const moduleUrl = new URL("../../src/missions/store.ts", import.meta.url).href;
		const source = `import { createSessionGoal } from ${JSON.stringify(moduleUrl)}; process.stdin.once('data', () => { const record = createSessionGoal(${JSON.stringify(t.location)}, { title: 'Concurrent', objective: 'Work', goal: true, ownerSessionId: 'B' }); console.log(record.id); }); console.log('ready');`;
		const children = [0, 1].map(() => spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { windowsHide: true, shell: false, timeout: 12000, stdio: ["pipe", "pipe", "pipe"] }));
		try {
			const completions = children.map((child) => new Promise<void>((resolve, reject) => {
				let errors = "";
				child.stderr.on("data", (data) => { errors += data; });
				child.on("error", reject);
				child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(errors)));
			}));
			await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
				child.stdout.once("data", () => resolve());
				child.once("error", reject);
				child.once("exit", () => reject(new Error("Child exited before ready")));
			})));
			for (const child of children) child.stdin.end("go");
			await Promise.all(completions);
			const records = listMissions(t.location).records;
			assert.equal(records.length, 2);
			assert.equal(records.filter((record) => record.status === "planned").length, 1);
			const current = records.find((record) => record.status === "planned")!;
			assert.match(records.find((record) => record.status === "cancelled")!.summary!, new RegExp(current.id));
		} finally { for (const child of children) if (child.exitCode === null) child.kill(); }
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});
