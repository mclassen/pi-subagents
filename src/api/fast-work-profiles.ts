import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FastWorkModel, FastWorkRegistryModel, FastWorkRole, FastWorkRoles } from "./fast-work.ts";

export const FAST_WORK_PROFILE_EVENT = "pi-subagents:fast-work-profiles:v1";
export const FAST_WORK_PROFILE_VERSION = 1;
export interface FastWorkProfileRequest {
	version: 1;
	profiles: Partial<FastWorkRoles>;
	result?: { ok: true } | { ok: false; error: string };
}

/** Ask the owning fast-work extension to explicitly set role models. */
export function setFastWorkProfiles(events: ExtensionAPI["events"], profiles: Partial<FastWorkRoles>): void {
	const request: FastWorkProfileRequest = { version: FAST_WORK_PROFILE_VERSION, profiles };
	events.emit(FAST_WORK_PROFILE_EVENT, request);
	if (request.result?.ok === true) return;
	throw new Error(request.result?.error ?? "Fast-work owner is unavailable or did not handle the versioned profile request.");
}

export function validateFastWorkProfiles(value: unknown, availableModels: readonly FastWorkRegistryModel[]): Partial<FastWorkRoles> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) throw new Error("Fast-work profiles must be a nonempty role map.");
	const result: Partial<FastWorkRoles> = {};
	for (const [role, selection] of Object.entries(value)) {
		if (!["ORCHESTRATOR", "WORKER_STANDARD", "WORKER_STRONG"].includes(role)) throw new Error(`Unsupported fast-work role '${role}'.`);
		if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error(`Invalid model selection for ${role}.`);
		const candidate = selection as FastWorkModel;
		if (typeof candidate.model !== "string" || !/^openai-codex\/[A-Za-z0-9._-]+$/.test(candidate.model) || (candidate.thinking !== "medium" && candidate.thinking !== "high")) throw new Error(`Invalid explicit model/thinking for ${role}.`);
		const [provider, id] = candidate.model.split("/");
		const model = availableModels.find((entry) => entry.provider === provider && entry.id === id);
		if (!model || model.reasoning !== true || model.thinkingLevelMap?.[candidate.thinking] === null) throw new Error(`Fast-work model/effort is unavailable: ${candidate.model}:${candidate.thinking}.`);
		result[role as FastWorkRole] = { model: candidate.model, thinking: candidate.thinking };
	}
	return result;
}
