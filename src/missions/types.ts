export const MISSION_STATUSES = [
	"planned",
	"active",
	"waiting",
	"needs_decision",
	"completed",
	"failed",
	"cancelled",
] as const;

export type MissionStatus = typeof MISSION_STATUSES[number];
export type MissionRunMode = "single" | "parallel" | "chain" | "workflow" | "scheduled" | "external";
export type MissionArtifactKind = "status" | "output" | "patch" | "manifest" | "review" | "note" | "other";
export type MissionReceiptKind = "pull_request" | "ci" | "deployment" | "release";
export type MissionReceiptStatus = "pending" | "ready" | "succeeded" | "failed";
export type MissionGoalStatus = "active" | "paused" | "iteration-limit";

export const DEFAULT_GOAL_MAX_ITERATIONS = 8;

export interface MissionGoal {
	status: MissionGoalStatus;
	maxIterations?: number;
	iterationsStarted?: number;
	iterationActive?: boolean;
	lastContinuation?: { turnId: string; progressKey: string; delivery?: "pending" | "observed" };
}

export interface MissionGoalUpdate {
	status?: "active" | "paused";
	maxIterations?: number;
	iterationsStarted?: number;
	iterationActive?: boolean;
	iteration?: "begin" | "complete";
}

export interface MissionTokenUsage {
	tokens: number;
}

export interface MissionRunLink {
	runId: string;
	asyncDir?: string;
	childIndex?: number;
	agent?: string;
	mode: MissionRunMode;
	status?: string;
	startedAt?: string;
	completedAt?: string;
	summary?: string;
	usage?: MissionTokenUsage;
}

export interface MissionDecision {
	id: string;
	status: "open" | "resolved";
	title: string;
	prompt?: string;
	options?: string[];
	recommendation?: string;
	createdAt: string;
	resolvedAt?: string;
	resolution?: string;
}

export interface MissionChildHeartbeat {
	updatedAt: string;
	status?: string;
	phase?: string;
	message?: string;
}

export interface MissionWorkflowChild {
	workflowRunId: string;
	key: string;
	status: string;
	startedAt: string;
	updatedAt: string;
	runId?: string;
	agent?: string;
	task?: string;
	label?: string;
	phase?: string;
	completedAt?: string;
	sessionPath?: string;
	artifactPaths: string[];
	heartbeat?: MissionChildHeartbeat;
}

export type MissionWorkflowChildUpdate = Pick<MissionWorkflowChild, "workflowRunId" | "key" | "status"> & Partial<Omit<MissionWorkflowChild, "workflowRunId" | "key" | "status" | "startedAt" | "updatedAt" | "artifactPaths" | "heartbeat">> & {
	startedAt?: string;
	artifactPaths?: string[];
	heartbeat?: Omit<MissionChildHeartbeat, "updatedAt"> & { updatedAt?: string };
};

export interface MissionArtifact {
	kind: MissionArtifactKind;
	path: string;
	description?: string;
}

export interface MissionReceipt {
	kind: MissionReceiptKind;
	status: MissionReceiptStatus;
	title: string;
	url: string;
	createdAt: string;
	description?: string;
}

export interface MissionAcceptanceAuthority {
	/** Missing is unknown too; only an actual matching terminal payload can mark observed. */
	completion?: "pending" | "observed";
	launchId: string;
	runId?: string;
	runtime?: true;
	producerRunId?: string;
	identityDigest?: string;
}

export interface MissionRecord {
	schemaVersion: 1;
	id: string;
	title: string;
	objective: string;
	goal?: MissionGoal;
	usage?: MissionTokenUsage;
	status: MissionStatus;
	createdAt: string;
	updatedAt: string;
	cwd?: string;
	ownerSessionId?: string;
	runs: MissionRunLink[];
	workflowChildren: MissionWorkflowChild[];
	decisions: MissionDecision[];
	artifacts: MissionArtifact[];
	receipts: MissionReceipt[];
	summary?: string;
	acceptance?: unknown;
	acceptanceAuthority?: MissionAcceptanceAuthority;
	labels?: string[];
}

export interface MissionIndexEntry {
	schemaVersion: 1;
	missionId: string;
	projectRoot: string;
	recordPath: string;
	title: string;
	status: MissionStatus;
	updatedAt: string;
	lastRunId?: string;
}

export interface MissionStoreConfig {
	enabled?: boolean;
	directory?: string;
	globalIndex?: boolean;
	globalIndexDir?: string;
	retainTerminal?: number;
}

export interface MissionStoreLocation {
	projectRoot: string;
	missionDir: string;
	globalIndexDir: string;
	writeGlobalIndex: boolean;
	retainTerminal?: number;
}

export interface MissionListResult {
	records: MissionRecord[];
	warnings: string[];
}

export interface GlobalMissionIndexRecord extends MissionIndexEntry {
	stale: boolean;
	staleReason?: string;
}

export interface GlobalMissionListResult {
	entries: GlobalMissionIndexRecord[];
	warnings: string[];
}

export interface MissionCreateInput {
	title: string;
	objective: string;
	goal?: boolean;
	maxIterations?: number;
	status?: MissionStatus;
	labels?: string[];
	ownerSessionId?: string;
}

export interface MissionUpdateInput {
	/** Internal lock-time ownership check for user-facing goal mutations and launches. */
	expectedGoalOwnerSessionId?: string;
	requireActiveGoal?: boolean;
	title?: string;
	objective?: string;
	goal?: MissionGoalUpdate | false;
	goalContinuation?: { ownerSessionId: string; turnId: string; progressKey: string; delivery?: "observed" };
	usage?: MissionTokenUsage;
	status?: MissionStatus;
	summary?: string;
	labels?: string[];
	acceptance?: unknown;
	/** Internal launch/completion binding; validated under the mission lock. */
	acceptanceLaunch?: { launchId: string; runId?: string };
	acceptanceCompletion?: { launchId: string; runId: string; hasExplicitProducer: boolean; producerRunId?: string };
	addRuns?: MissionRunLink[];
	upsertWorkflowChildren?: MissionWorkflowChildUpdate[];
	addArtifacts?: MissionArtifact[];
	addDecisions?: Array<Omit<MissionDecision, "id" | "status" | "createdAt">>;
	resolveDecision?: { id: string; resolution: string };
	addReceipts?: Array<Omit<MissionReceipt, "createdAt">>;
}
