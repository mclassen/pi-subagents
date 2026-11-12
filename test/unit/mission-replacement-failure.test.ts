import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { createMission, createSessionGoal, listMissions, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";

// All identities, jobs, and evidence in these fixtures are synthetic; no live process is a goal job.
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-replacement-failure-"));
	const location = resolveMissionStoreLocation({ projectRoot: root, agentDir: path.join(root, "agent"), config: { globalIndex: false } });
	const evidence = path.join(root, "synthetic-evidence.txt");
	fs.writeFileSync(evidence, "synthetic evidence remains intact");
	function old(title: string, date: string) {
		const goal = createMission(location, { title, objective: "synthetic", ownerSessionId: "synthetic-owner", goal: true, maxIterations: 5 }, new Date(date));
		updateMission(location, goal.id, { goal: { iteration: "begin" } }, new Date(date));
		return updateMission(location, goal.id, { summary: "synthetic checkpoint", usage: { tokens: 42 }, addRuns: [{ runId: "synthetic-running-job", mode: "single", status: "running" }], addArtifacts: [{ kind: "note", path: evidence }], addDecisions: [{ title: "synthetic decision" }] }, new Date(date));
	}
	return { root, location, evidence, old };
}

function captureFailure(run: () => unknown): Error {
	try { run(); } catch (error) { assert.ok(error instanceof Error); return error; }
	assert.fail("replacement must propagate the underlying failure");
}

function assertReport(error: Error, fresh: string, cancelled: string[], open: { id: string; status: string }[]) {
	const message = error.message;
	const lines = message.split(/\r?\n/);
	function stateLine(id: string, expected: string, contradictory: RegExp) {
		assert.ok(message.includes(id), `missing actual mission ID ${id} in: ${message}`);
		const matching = lines.filter((line) => line.startsWith(`New goal ${id}:`) || line.startsWith(`Old goal ${id}:`));
		assert.equal(matching.length, 1, `expected exactly one state line for ${id}: ${message}`);
		const line = matching[0]!;
		assert.ok(line === expected || line.startsWith(`${expected} `) || line.startsWith(`${expected} (`), `wrong state for ${id}: ${line}`);
		assert.doesNotMatch(line.slice(expected.length), contradictory, `contradictory state for ${id}: ${line}`);
	}
	stateLine(fresh, `New goal ${fresh}: persisted`, /\b(?:not persisted|unknown)\b/i);
	for (const id of cancelled) stateLine(id, `Old goal ${id}: cancelled`, /\b(?:not cancelled|not canceled|still open|closed|unknown)\b/i);
	for (const { id, status } of open) stateLine(id, `Old goal ${id}: still open (${status})`, /\b(?:not still open|cancelled|canceled|closed|unknown)\b/i);
	assert.match(lines[0]!, /^Goal replacement incomplete: \S/);
	assert.doesNotMatch(message, /rollback (?:succeeded|complete)|successfully replaced|replacement (?:succeeded|completed)/i);
}

it("synthetic assertion logic rejects swapped and contradictory goal states", () => {
	const header = "Goal replacement incomplete: synthetic fault";
	const fresh = "synthetic-new";
	const cancelled = "synthetic-cancelled";
	const open = "synthetic-open";
	const expectedOpen = [{ id: open, status: "planned" }];
	const correct = `${header}\nNew goal ${fresh}: persisted\nOld goal ${cancelled}: cancelled\nOld goal ${open}: still open (planned)`;
	assertReport(new Error(correct), fresh, [cancelled], expectedOpen);
	const swapped = `${header}\nNew goal ${fresh}: persisted\nOld goal ${cancelled}: still open (planned)\nOld goal ${open}: cancelled`;
	assert.throws(() => assertReport(new Error(swapped), fresh, [cancelled], expectedOpen));
	assert.throws(() => assertReport(new Error(`${correct}\nOld goal ${open}: cancelled`), fresh, [cancelled], expectedOpen));
	assert.throws(() => assertReport(new Error(`${correct} (cancelled)`), fresh, [cancelled], expectedOpen));
	assert.throws(() => assertReport(new Error(correct.replace(`Old goal ${cancelled}: cancelled`, `Old goal ${cancelled}: cancelled (not cancelled)`)), fresh, [cancelled], expectedOpen));
});

it("reports the persisted new ID and unchanged old ID when the new index write fails", () => {
	const t = fixture();
	try {
		const old = t.old("synthetic old", "2026-01-01T00:00:00Z");
		const before = fs.readFileSync(missionRecordPath(t.location, old.id), "utf8");
		const blocked = path.join(t.root, "index-is-a-file");
		fs.writeFileSync(blocked, "synthetic filesystem fault");
		const error = captureFailure(() => createSessionGoal({ ...t.location, writeGlobalIndex: true, globalIndexDir: blocked }, { title: "synthetic new", objective: "synthetic", goal: true, ownerSessionId: "synthetic-owner" }));
		const records = listMissions(t.location).records;
		const fresh = records.find((record) => record.id !== old.id);
		assert.equal(records.length, 2);
		assert.ok(fresh);
		assert.equal(fs.readFileSync(missionRecordPath(t.location, old.id), "utf8"), before);
		assert.equal(fs.readFileSync(t.evidence, "utf8"), "synthetic evidence remains intact");
		console.log("SYNTHETIC persisted state", JSON.stringify({ error: error.message, records }));
		assertReport(error, fresh.id, [], [{ id: old.id, status: old.status }]);
		assert.match(error.message.split(/\r?\n/)[0]!, /index|EEXIST/i, "underlying index failure must remain visible in the header");
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});

it("reports an old goal cancelled when its record commits before its index write fails", () => {
	const t = fixture();
	try {
		const old = t.old("synthetic index-fault old", "2026-01-01T00:00:00Z");
		const indexDir = path.join(t.root, "synthetic-index");
		const key = createHash("sha256").update(`${t.location.projectRoot}\0${old.id}`).digest("hex");
		fs.mkdirSync(path.join(indexDir, `${key}.json`), { recursive: true });
		const error = captureFailure(() => createSessionGoal({ ...t.location, writeGlobalIndex: true, globalIndexDir: indexDir }, { title: "synthetic new", objective: "synthetic", goal: true, ownerSessionId: "synthetic-owner" }));
		const fresh = listMissions(t.location).records.find((record) => record.id !== old.id);
		assert.ok(fresh);
		const cancelled = readMission(t.location, old.id);
		assert.deepEqual(cancelled, { ...old, status: "cancelled", updatedAt: cancelled.updatedAt, summary: `${old.summary}\nGoal superseded by new goal ${fresh.id}. Running jobs are NOT stopped.` });
		assertReport(error, fresh.id, [old.id], []);
		assert.ok(error.cause instanceof Error);
		assert.equal(fs.readFileSync(t.evidence, "utf8"), "synthetic evidence remains intact");
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});

it("reports unknown old-goal discovery when a synthetic record is unreadable", () => {
	const t = fixture();
	try {
		const old = t.old("synthetic corrupt old", "2026-01-01T00:00:00Z");
		fs.writeFileSync(missionRecordPath(t.location, old.id), "synthetic invalid JSON");
		const blocked = path.join(t.root, "index-is-a-file");
		fs.writeFileSync(blocked, "synthetic filesystem fault");
		const error = captureFailure(() => createSessionGoal({ ...t.location, writeGlobalIndex: true, globalIndexDir: blocked }, { title: "synthetic new", objective: "synthetic", goal: true, ownerSessionId: "synthetic-owner" }));
		const fresh = listMissions(t.location).records.find((record) => record.id !== old.id);
		assert.ok(fresh);
		assert.match(error.message, /^Old goal discovery: unknown \(some records could not be read\)$/m);
		assert.match(error.message, new RegExp(`^New goal ${fresh.id}: persisted$`, "m"));
		assert.ok(error.cause instanceof Error);
		assert.equal(fs.readFileSync(missionRecordPath(t.location, old.id), "utf8"), "synthetic invalid JSON");
	} finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});

it("reports cancelled and still-open old IDs when a real competing lock blocks the second cancellation", { timeout: 45000 }, async () => {
	const t = fixture();
	const first = t.old("synthetic first", "2026-01-02T00:00:00Z");
	const second = t.old("synthetic second", "2026-01-01T00:00:00Z");
	const beforeSecond = fs.readFileSync(missionRecordPath(t.location, second.id), "utf8");
	const child = spawn(process.execPath, ["--experimental-strip-types", "test/fixtures/mission-lock/lock-child.mjs", "hold", missionRecordPath(t.location, second.id)], { windowsHide: true, shell: false, timeout: 35000, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (data) => { stderr += String(data); });
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("lock fixture readiness timed out")), 12000);
			child.stdout.once("data", (data) => { clearTimeout(timer); String(data).includes("locked") ? resolve() : reject(new Error(`unexpected fixture output: ${data}`)); });
			child.once("error", (error) => { clearTimeout(timer); reject(error); });
			child.once("exit", () => { clearTimeout(timer); reject(new Error(`fixture exited before barrier: ${stderr}`)); });
		});
		const error = captureFailure(() => createSessionGoal(t.location, { title: "synthetic new", objective: "synthetic", goal: true, ownerSessionId: "synthetic-owner" }, new Date("2026-01-03T00:00:00Z")));
		const records = listMissions(t.location).records;
		const fresh = records.find((record) => record.id !== first.id && record.id !== second.id);
		assert.equal(records.length, 3);
		assert.ok(fresh);
		const cancelled = readMission(t.location, first.id);
		assert.deepEqual(cancelled, { ...first, status: "cancelled", updatedAt: cancelled.updatedAt, summary: `${first.summary}\nGoal superseded by new goal ${fresh.id}. Running jobs are NOT stopped.` });
		assert.equal(fs.readFileSync(missionRecordPath(t.location, second.id), "utf8"), beforeSecond);
		assert.equal(fs.readFileSync(t.evidence, "utf8"), "synthetic evidence remains intact");
		console.log("SYNTHETIC persisted state", JSON.stringify({ error: error.message, records }));
		assertReport(error, fresh.id, [first.id], [{ id: second.id, status: second.status }]);
		assert.match(error.message.split(/\r?\n/)[0]!, /lock|timed out/i, "underlying lock failure must remain visible in the header");
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill();
		await exited;
		fs.rmSync(t.root, { recursive: true, force: true });
	}
});
