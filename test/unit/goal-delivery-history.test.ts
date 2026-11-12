// Synthetic fixtures; optional source SessionManager slice performs real JSONL I/O,
// but does not exercise AgentSession/ExtensionRunner or make model calls.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { readGoalDeliveryHistory } from "../../src/missions/goal-driver.ts";

it("keeps missing, malformed and foreign saved-session evidence unknown", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-delivery-history-"));
	try {
		const file = path.join(root, "session.jsonl");
		assert.equal(readGoalDeliveryHistory(file, "owner"), undefined);
		fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "foreign" })}\n`);
		assert.throws(() => readGoalDeliveryHistory(file, "owner"), /mismatched/);
		fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "owner" })}\n{`);
		assert.throws(() => readGoalDeliveryHistory(file, "owner"));
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("observes real source SessionManager durable custom append, not its unflushed memory", { skip: !process.env.PI_GOAL_CORE_SOURCE }, async () => {
	const source = process.env.PI_GOAL_CORE_SOURCE!;
	const { SessionManager } = await import(pathToFileURL(path.join(source, "packages/coding-agent/src/core/session-manager.ts")).href);
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-delivery-core-"));
	try {
		const manager = SessionManager.create(root, root);
		const file = manager.getSessionFile();
		const runId = "goal-synthetic-turn-stable";
		const details = { source: "goal", goalContinuation: true, event: { runId } };
		manager.appendCustomMessageEntry("subagent_control_notice", "Synthetic goal notice", true, details);
		assert.ok(manager.getEntries().length > 0);
		assert.equal(readGoalDeliveryHistory(file, manager.getSessionId()), undefined, "setup-only session has not flushed");
		manager.appendMessage({ role: "user", content: "Synthetic persistence seed", timestamp: 1 });
		assert.ok(readGoalDeliveryHistory(file, manager.getSessionId())?.has(runId));
		const resumed = SessionManager.open(file);
		assert.ok(readGoalDeliveryHistory(resumed.getSessionFile(), resumed.getSessionId())?.has(runId));
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});
