import { cancelGoalMission, listMissions } from "./store.ts";
import type { MissionRecord, MissionStoreLocation } from "./types.ts";

export type GoalCancelResult =
	| { cancelled: true; mission: MissionRecord }
	| { cancelled: false; reason: "no-session" | "none" | "ambiguous" };

export function cancelCurrentGoal(location: MissionStoreLocation, ownerSessionId: string | null | undefined): GoalCancelResult {
	if (!ownerSessionId) return { cancelled: false, reason: "no-session" };
	const candidates = listMissions(location).records.filter((mission) =>
		mission.ownerSessionId === ownerSessionId
		&& mission.goal !== undefined
		&& !["completed", "failed", "cancelled"].includes(mission.status),
	);
	if (candidates.length === 0) return { cancelled: false, reason: "none" };
	if (candidates.length > 1) return { cancelled: false, reason: "ambiguous" };
	const mission = cancelGoalMission(location, candidates[0]!.id, ownerSessionId);
	return { cancelled: true, mission };
}
