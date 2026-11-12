import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import { createMission, missionRecordPath, readMission, resolveMissionStoreLocation, updateMission } from "../../src/missions/store.ts";
import type { AcceptanceLedger } from "../../src/shared/types.ts";

function ledger(status: "rejected" | "checked"): AcceptanceLedger {
	return {
		status, evidenceStatus: status, explicit: true,
		effectiveAcceptance: { level: "checked", explicit: true, inferredReason: [], criteria: [], evidence: [], verify: [], stopRules: [] },
		inferredReason: [], criteria: [],
		runtimeChecks: [{ id: "synthetic-required-gate", status: status === "rejected" ? "failed" : "passed", message: "Synthetic regression fixture, not product acceptance" }],
		verifyRuns: [],
	};
}

function fixture(goal = true) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rejected-goal-acceptance-"));
	const projectRoot = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(projectRoot);
	const location = resolveMissionStoreLocation({ projectRoot, agentDir });
	const ctx = { cwd: projectRoot, agentDir, currentSessionId: "fixture-owner" };
	const mission = createMission(location, { title: "Synthetic acceptance regression", objective: "Do not promote a recorded rejection", goal, status: "active", ownerSessionId: ctx.currentSessionId });
	return { root, location, ctx, mission };
}

for (const route of ["mission.close", "mission.update", "internal update"] as const) {
	it(`rejects a completed goal transition through ${route} without modifying mission or index`, () => {
		const f = fixture();
		try {
			updateMission(f.location, f.mission.id, { acceptance: ledger("rejected") });
			const recordPath = missionRecordPath(f.location, f.mission.id);
			const before = fs.readFileSync(recordPath, "utf8");
			const indexPath = path.join(f.location.globalIndexDir, fs.readdirSync(f.location.globalIndexDir)[0]!);
			const indexBefore = fs.readFileSync(indexPath, "utf8");
			const attempt = () => route === "internal update"
				? updateMission(f.location, f.mission.id, { status: "completed" })
				: handleMissionAction(route, route === "mission.close"
					? { missionId: f.mission.id, missionStatus: "completed" }
					: { missionId: f.mission.id, missionUpdate: { status: "completed" } }, f.ctx);
			assert.throws(attempt, /recorded acceptance is rejected/i);
			assert.equal(fs.readFileSync(recordPath, "utf8"), before);
			assert.equal(fs.readFileSync(indexPath, "utf8"), indexBefore);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
}

it("rejects completion when a rejection is recorded in the same update", () => {
	const f = fixture();
	try {
		assert.throws(() => updateMission(f.location, f.mission.id, { status: "completed", acceptance: ledger("rejected") }), /recorded acceptance is rejected/i);
		assert.equal(readMission(f.location, f.mission.id).status, "active");
	} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

it("allows completion when a store update replaces the rejected ledger", () => {
	const f = fixture();
	try {
		updateMission(f.location, f.mission.id, { acceptance: ledger("rejected") });
		const updated = updateMission(f.location, f.mission.id, { acceptance: ledger("checked"), status: "completed" });
		assert.equal(updated.status, "completed");
		assert.deepEqual(updated.acceptance, ledger("checked"));
	} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

it("keeps paused and waiting goals usable with a rejected ledger", () => {
	const f = fixture();
	try {
		updateMission(f.location, f.mission.id, { acceptance: ledger("rejected") });
		assert.equal(updateMission(f.location, f.mission.id, { status: "planned" }).status, "planned");
		assert.equal(updateMission(f.location, f.mission.id, { status: "needs_decision" }).status, "needs_decision");
		const paused = updateMission(f.location, f.mission.id, { status: "active", goal: { status: "paused" } });
		assert.equal(paused.goal?.status, "paused");
		assert.equal(paused.status, "waiting");
		assert.equal(updateMission(f.location, f.mission.id, { summary: "Incomplete work" }).status, "waiting");
		assert.equal(updateMission(f.location, f.mission.id, { goal: { status: "active" }, status: "active" }).status, "active");
	} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

for (const status of ["failed", "cancelled"] as const) {
	it(`allows honest ${status} closure with a rejected ledger`, () => {
		const f = fixture();
		try {
			updateMission(f.location, f.mission.id, { acceptance: ledger("rejected") });
			const result = handleMissionAction("mission.close", { missionId: f.mission.id, missionStatus: status }, f.ctx);
			assert.equal(result.details?.mission?.status, status);
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	});
}

it("does not reinterpret missing goal acceptance or change ordinary-mission completion", () => {
	for (const goal of [true, false]) {
		const f = fixture(goal);
		try {
			if (!goal) updateMission(f.location, f.mission.id, { acceptance: ledger("rejected") });
			assert.equal(handleMissionAction("mission.close", { missionId: f.mission.id, missionStatus: "completed" }, f.ctx).details?.mission?.status, "completed");
		} finally { fs.rmSync(f.root, { recursive: true, force: true }); }
	}
});

it("checks a queued completion against a rejection committed by another process", { timeout: 30000 }, async () => {
	const f = fixture();
	const children: ChildProcess[] = [];
	const childFile = fileURLToPath(new URL("../fixtures/mission-lock/rejected-update-child.mjs", import.meta.url));
	const preload = new URL("../support/isolated-temp-root.mjs", import.meta.url).href;
	function launch(mode: string) {
		const child = fork(childFile, [mode, f.root, f.mission.id], {
			execArgv: ["--experimental-strip-types", "--import", preload],
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		children.push(child);
		let stderr = "";
		child.stderr!.on("data", (chunk) => { stderr += chunk; });
		const exit = once(child, "exit").then(([code, signal]) => {
			assert.equal(code, 0, `${mode} exited ${code ?? signal}: ${stderr}`);
		});
		void exit.catch(() => {});
		return { child, exit };
	}
	try {
		fs.writeFileSync(path.join(f.root, "ledger.json"), JSON.stringify(ledger("rejected")));
		const writer = launch("reject");
		assert.equal((await once(writer.child, "message"))[0], "writer-locked");
		const closer = launch("close");
		assert.equal((await once(closer.child, "message"))[0], "closure-contended");
		fs.writeFileSync(path.join(f.root, "release-writer"), "");
		await writer.exit;
		fs.writeFileSync(path.join(f.root, "writer-done"), "");
		await closer.exit;
		const result = readMission(f.location, f.mission.id);
		assert.equal(result.status, "active");
		assert.deepEqual(result.acceptance, ledger("rejected"));
	} finally {
		await Promise.all(children.map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}));
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});
