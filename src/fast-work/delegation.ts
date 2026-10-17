import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_STARTED_EVENT,
	type SubagentDelegationRequest,
	type SubagentDelegationResponse,
	type SubagentDelegationStarted,
} from "../api/delegation.ts";

export interface FastWorkEvents extends Pick<ExtensionAPI["events"], "on" | "emit"> {}

const identity = Compile(Type.Object({ requestId: Type.String(), ownerRunId: Type.String(), nodeId: Type.String() }));

function matches(data: Parameters<FastWorkEvents["emit"]>[1], request: SubagentDelegationRequest): data is SubagentDelegationStarted {
	return identity.Check(data) && data.requestId === request.requestId && data.ownerRunId === request.ownerRunId && data.nodeId === request.nodeId;
}

/** Wait for the owner's terminal reply even after cancellation; never free a slot at agent_end. */
export function delegateFastWork(
	events: FastWorkEvents,
	request: SubagentDelegationRequest,
	signal: AbortSignal,
	shutdown: AbortSignal,
): Promise<SubagentDelegationResponse> {
	return new Promise((resolve, reject) => {
		let acknowledged = false;
		let finished = false;
		const cleanups: Array<() => void> = [];
		const cleanup = (): void => {
			finished = true;
			for (const dispose of cleanups) dispose();
		};
		const cancel = (): void => events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
			requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
		});
		const invalidated = (): void => {
			cancel();
			if (finished) return;
			cleanup();
			reject(new Error("Fast-work owner context was invalidated; child terminal state is unverified."));
		};
		cleanups.push(events.on(SUBAGENT_DELEGATION_STARTED_EVENT, (payload) => {
			if (matches(payload, request)) acknowledged = true;
		}));
		cleanups.push(events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
			if (!matches(payload, request)) return;
			cleanup();
			// SAFETY: full identity is schema-checked above; the installed trusted owner produces this public terminal DTO.
			resolve(payload as SubagentDelegationResponse);
		}));
		signal.addEventListener("abort", cancel, { once: true });
		shutdown.addEventListener("abort", invalidated, { once: true });
		cleanups.push(() => signal.removeEventListener("abort", cancel), () => shutdown.removeEventListener("abort", invalidated));
		if (shutdown.aborted) {
			invalidated();
			return;
		}
		try {
			if (signal.aborted) cancel();
			events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
			// The v0.71 owned-leaf bridge acknowledges or rejects synchronously before awaiting execution.
			// Fail closed without polling/timers if no compatible installed owner handled this request.
			if (!acknowledged && !finished) {
				cancel();
				cleanup();
				reject(new Error("No compatible pi-subagents structured delegation owner acknowledged fast-work."));
			}
		} catch (error) {
			cancel();
			cleanup();
			reject(error);
		}
	});
}
