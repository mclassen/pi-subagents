import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AcceptanceIdentity, AcceptanceLedger, AcceptanceVerifyCommand, ResolvedAcceptanceConfig } from "../../shared/types.ts";

export const ACCEPTANCE_VERIFY_DEFAULT_TIMEOUT_MS = 120_000;

export function acceptanceCommandOptionsDigest(command: AcceptanceVerifyCommand): string {
	return acceptanceDigest({ timeoutMs: command.timeoutMs ?? ACCEPTANCE_VERIFY_DEFAULT_TIMEOUT_MS, allowFailure: command.allowFailure === true, output: command.output ?? null, schema: command.schema ?? null, shell: true });
}

/** Stable JSON object keys; arrays retain their declared ordering. */
export function canonicalAcceptanceJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
export function acceptanceDigest(value: unknown): string {
	return createHash("sha256").update(canonicalAcceptanceJson(value)).digest("hex");
}

export function validateCandidateFiles(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "files")) throw new Error("candidate must be { files: string[] }");
	const files = (value as { files?: unknown }).files;
	if (!Array.isArray(files) || !files.length) throw new Error("candidate.files must be a non-empty array");
	for (const file of files) {
		if (typeof file !== "string" || !file || /[\\:*?\[\]{}\x00]/.test(file) || path.posix.isAbsolute(file) || file.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("candidate.files requires explicit relative file paths (no globs or traversal)");
	}
	if (new Set(files).size !== files.length) throw new Error("candidate.files contains duplicate paths");
	return [...files].sort();
}

export function captureAcceptanceCandidate(cwd: string, declaration: { files: string[] }): AcceptanceIdentity["files"] {
	const root = fs.realpathSync(cwd);
	return validateCandidateFiles(declaration).map((file) => {
		const parts = file.split("/");
		let current = root;
		for (let index = 0; index < parts.length; index++) {
			current = path.join(current, parts[index]!);
			let stat: fs.Stats;
			try { stat = fs.lstatSync(current); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: file, state: "absent" as const };
				throw error;
			}
			if (stat.isSymbolicLink()) throw new Error(`Candidate symlink is not supported: ${file}`);
			if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Candidate parent is not a directory: ${file}`);
			if (index === parts.length - 1 && !stat.isFile()) throw new Error(`Candidate is not a regular file: ${file}`);
		}
		const bytes = fs.readFileSync(current);
		return { path: file, state: "present" as const, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
	});
}

export function acceptancePolicyDigest(acceptance: ResolvedAcceptanceConfig, envOverrideHashes?: string[]): string {
	// Hash only resolved inputs, never the ledger or derived verification output.
	return acceptanceDigest({ ...acceptance, verify: acceptance.verify.map((command, index) => ({
		...command,
		env: command.env ? {
			keys: Object.keys(command.env).sort(),
			hash: envOverrideHashes && Object.values(command.env).every((value) => value === "[REDACTED]")
				? envOverrideHashes[index] : acceptanceDigest(command.env),
		} : undefined,
	})) });
}

/** Persist the policy shape without copying verification environment values into the ledger. */
export function redactAcceptancePolicy(acceptance: ResolvedAcceptanceConfig): ResolvedAcceptanceConfig {
	return { ...acceptance, verify: acceptance.verify.map((command) => ({
		...command,
		...(command.env ? { env: Object.fromEntries(Object.keys(command.env).map((key) => [key, "[REDACTED]"])) } : {}),
	})) };
}

export function sealAcceptanceIdentity(identity: Omit<AcceptanceIdentity, "digest">): AcceptanceIdentity {
	return { ...identity, digest: acceptanceDigest(identity) };
}

/** Revalidation is deliberately bounded to the parent's declared candidate files. */
export function currentAcceptanceIdentity(ledger: AcceptanceLedger, producerRunId: string): boolean {
	try {
		const identity = ledger.identity;
		if (!identity || identity.version !== 1 || !producerRunId || identity.producerRunId !== producerRunId || !ledger.effectiveAcceptance.candidate) return false;
		const { digest, ...preimage } = identity;
		if (!/^[a-f0-9]{64}$/.test(digest) || acceptanceDigest(preimage) !== digest) return false;
		if (identity.policyHash !== acceptancePolicyDigest(ledger.effectiveAcceptance, identity.commands.map((command) => command.envOverridesHash)) || acceptanceDigest(ledger.criteria) !== acceptanceDigest(ledger.effectiveAcceptance.criteria)) return false;
		if (identity.commands.length !== ledger.effectiveAcceptance.verify.length || ledger.verifyRuns.length !== identity.commands.length) return false;
		for (const [index, command] of identity.commands.entries()) {
			const configured = ledger.effectiveAcceptance.verify[index]!;
			const run = ledger.verifyRuns[index]!;
			if (!/^[a-f0-9]{64}$/.test(command.envHash) || !/^[a-f0-9]{64}$/.test(command.envOverridesHash) || command.optionsHash !== acceptanceCommandOptionsDigest(configured) || command.id !== configured.id || command.command !== configured.command || command.cwd !== path.resolve(identity.cwd, configured.cwd ?? ".") || run.id !== command.id || run.command !== command.command || run.cwd !== command.cwd || run.envHash !== command.envHash) return false;
		}
		return acceptanceDigest(identity.files) === acceptanceDigest(captureAcceptanceCandidate(identity.cwd, ledger.effectiveAcceptance.candidate));
	} catch { return false; }
}
