import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { evaluateAcceptance, resolveEffectiveAcceptance, validateAcceptanceInput } from "../../src/runs/shared/acceptance.ts";
import { acceptanceDigest, canonicalAcceptanceJson, captureAcceptanceCandidate, currentAcceptanceIdentity } from "../../src/runs/shared/acceptance-identity.ts";

// SYNTHETIC unit fixture. The verifier is a real local shell/Node process, never a provider.
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-identity-"));
	fs.writeFileSync(path.join(root, "input"), Buffer.from([0, 255, 13, 10]));
	fs.writeFileSync(path.join(root, ".gitignore"), "input\n");
	assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true }).status, 0);
	assert.equal(spawnSync("git", ["check-ignore", "input"], { cwd: root, windowsHide: true }).status, 0);
	fs.writeFileSync(path.join(root, "check.cjs"), "process.stdout.write('ok');");
	const policy = resolveEffectiveAcceptance({ agentName: "synthetic", explicit: {
		level: "verified", candidate: { files: ["input", "absent", "check.cjs"] },
		verify: [{ id: "check", command: `"${process.execPath}" check.cjs`, env: { SYNTHETIC_SECRET: "fixture-secret-value" } }],
	}, agentContract: { version: 1 } });
	const run = () => evaluateAcceptance({ acceptance: policy, cwd: root, output: "", reportOptional: true, runId: "actual-unit-run", artifactsDir: root });
	return { root, policy, run, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

it("canonical full digests ignore object insertion order, not array order", () => {
	assert.equal(canonicalAcceptanceJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
	assert.equal(acceptanceDigest({ a: 1, b: 2 }), acceptanceDigest({ b: 2, a: 1 }));
	assert.notEqual(acceptanceDigest([1, 2]), acceptanceDigest([2, 1]));
	assert.match(acceptanceDigest({}), /^[a-f0-9]{64}$/);
});

it("binds exact binary/untracked/ignored bytes, absence, resolved policy and actual producer without tracked-cache reuse", async () => {
	const f = fixture();
	try {
		const ledger = await f.run();
		assert.equal(ledger.status, "verified");
		assert.equal(currentAcceptanceIdentity(ledger, "actual-unit-run"), true);
		assert.equal(currentAcceptanceIdentity(ledger, "another-run"), false);
		assert.equal(ledger.identity?.files.find((file) => file.path === "absent")?.state, "absent");
		assert.ok(!JSON.stringify(ledger).includes("fixture-secret-value"));
		assert.equal(ledger.effectiveAcceptance.verify[0]!.env!.SYNTHETIC_SECRET, "[REDACTED]");
		assert.match(ledger.verifyRuns[0]!.envHash!, /^[a-f0-9]{64}$/);
		assert.equal(ledger.verifyRuns[0]!.cacheKey, undefined);
		assert.equal(ledger.verifyRuns[0]!.memoized, undefined);
		for (const mutation of [
			(copy: typeof ledger) => { delete copy.identity; },
			(copy: typeof ledger) => { copy.identity!.digest = "f".repeat(64); },
			(copy: typeof ledger) => { copy.effectiveAcceptance.criteria.push({ id: "new", must: "changed", evidence: [], severity: "required" }); },
			(copy: typeof ledger) => { copy.effectiveAcceptance.verify[0]!.command += " changed"; },
			(copy: typeof ledger) => { copy.effectiveAcceptance.verify[0]!.env = { SYNTHETIC_SECRET: "changed-secret" }; },
			(copy: typeof ledger) => { copy.effectiveAcceptance.verify[0]!.timeoutMs = 123; },
			(copy: typeof ledger) => { copy.verifyRuns[0]!.envHash = "a".repeat(64); },
		]) {
			const copy = structuredClone(ledger); mutation(copy);
			assert.equal(currentAcceptanceIdentity(copy, "actual-unit-run"), false);
		}
		fs.writeFileSync(path.join(f.root, "input"), "changed ignored bytes");
		assert.equal(currentAcceptanceIdentity(ledger, "actual-unit-run"), false);
		const corrected = await f.run();
		assert.equal(corrected.status, "verified");
		assert.notEqual(corrected.identity!.digest, ledger.identity!.digest);
		assert.equal(currentAcceptanceIdentity(corrected, "actual-unit-run"), true);
		fs.writeFileSync(path.join(f.root, "absent"), "now present");
		assert.equal(currentAcceptanceIdentity(corrected, "actual-unit-run"), false);
	} finally { f.close(); }
});

it("binds typed verification without including derived structured output in the identity preimage", async () => {
	const f = fixture();
	try {
		fs.writeFileSync(path.join(f.root, "check.cjs"), "console.log(JSON.stringify({ pass: true }));");
		f.policy.verify[0]!.output = "json";
		const ledger = await f.run();
		assert.equal(ledger.status, "verified");
		assert.deepEqual(ledger.verifyRuns[0]!.structuredOutput, { pass: true });
		assert.equal(currentAcceptanceIdentity(ledger, "actual-unit-run"), true);
		assert.ok(!JSON.stringify(ledger.identity).includes("structuredOutput"));
		fs.writeFileSync(path.join(f.root, "input"), "later input");
		assert.equal(currentAcceptanceIdentity(ledger, "actual-unit-run"), false);
	} finally { f.close(); }
});

it("rejects mutation during real verification and missing producer identity", async () => {
	const f = fixture();
	try {
		fs.writeFileSync(path.join(f.root, "check.cjs"), "require('node:fs').writeFileSync('input', 'changed-during-check');");
		const ledger = await f.run();
		assert.equal(ledger.verifyRuns[0]!.exitCode, 0);
		assert.equal(ledger.status, "rejected");
		assert.equal(ledger.identity, undefined);
		const unknown = await evaluateAcceptance({ acceptance: f.policy, cwd: f.root, output: "", reportOptional: true });
		assert.equal(unknown.status, "rejected");
		assert.equal(unknown.verifyRuns.length, 0);
	} finally { f.close(); }
});

for (const files of [["../outside"], ["/absolute"], ["C:/absolute"], ["*.ts"], ["a\\b"], ["a/./b"], ["a", "a"], []]) {
	it(`rejects unsupported parent candidate declaration ${JSON.stringify(files)}`, () => {
		assert.ok(validateAcceptanceInput({ candidate: { files } }).length > 0);
	});
}

it("fails closed for directories and symlinks, and captures meaningful missing inputs", () => {
	const f = fixture();
	try {
		fs.mkdirSync(path.join(f.root, "directory"));
		assert.throws(() => captureAcceptanceCandidate(f.root, { files: ["directory"] }), /regular file/);
		// Directory junctions can be made without Windows symlink privilege.
		fs.symlinkSync(path.join(f.root, "directory"), path.join(f.root, "link"), "junction");
		assert.throws(() => captureAcceptanceCandidate(f.root, { files: ["link/missing"] }), /symlink/);
		assert.deepEqual(captureAcceptanceCandidate(f.root, { files: ["missing/file"] }), [{ path: "missing/file", state: "absent" }]);
	} finally { f.close(); }
});
