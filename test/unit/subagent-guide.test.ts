import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSubagentGuide, SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

describe("subagent guide", () => {
	it("reads the packaged overview by default", () => {
		const guide = readSubagentGuide();

		assert.match(guide, /# pi-subagents/);
	});

	it("lists valid topics for an unknown topic without changing files", () => {
		const guide = readSubagentGuide("unknown");

		assert.match(guide, /Unknown subagents guide topic 'unknown'/);
		assert.match(guide, /No files were changed\./);
		assert.match(guide, new RegExp(SUBAGENT_GUIDE_TOPICS.join(", ")));
	});

	it("registers the guide action for action recovery", () => {
		assert.ok(SUBAGENT_ACTIONS.includes("guide"));
	});

	it("documents external CLI runner limits in packaged guide topics", () => {
		assert.match(readSubagentGuide("tool-reference"), /External CLI agent profiles[\s\S]*native Pi child options[\s\S]*model override[\s\S]*native Pi tools/);
		assert.match(readSubagentGuide("agents"), /External CLI agents use their own runner contract[\s\S]*native Pi child options/);
	});

	it("documents failed-lane recovery boundaries in packaged guide topics", () => {
		const workflows = readSubagentGuide("workflows");
		const toolReference = readSubagentGuide("tool-reference");
		for (const guide of [workflows, toolReference]) {
			assert.match(guide, /failed\/disappeared runner is not task success/);
			assert.match(guide, /subagent workflow[\s\S]*child launch[\s\S]*prompt runtime[\s\S]*extension loading[\s\S]*child tooling setup[\s\S]*lane infrastructure blockers/);
			assert.match(guide, /exact failure[\s\S]*run\/status[\s\S]*(?:repo|repository)\/cwd\/worktree\/branch\/ref/);
			assert.match(guide, /preserve tracked AND untracked partial edits/);
			assert.match(guide, /old writer is terminal or demonstrably gone[\s\S]*exclusive ownership/);
			assert.match(guide, /One bounded same-protocol recovery attempt[\s\S]*without fresh user confirmation[\s\S]*same approved model\/provider\/tools/);
			assert.match(guide, /eligible retained-child resume by exact ID[\s\S]*unavailable or rejected[\s\S]*same-role replacement[\s\S]*distinct isolated workspace/);
			assert.match(guide, /change the approach based on failure evidence/i);
			assert.match(guide, /recovery fails again[\s\S]*ownership or authority is unresolved[\s\S]*stop[\s\S]*ask for the smallest needed decision/);
			assert.match(guide, /No automatic execution-mode\/model\/provider fallback[\s\S]*external\/foreground\/CLI switching requires explicit owner approval/);
			assert.match(guide, /Pi core's generic `pi -ne` extension-load hint is not protocol-approved fallback/);
		}
	});

	it("keeps advanced workflow details in the packaged guide", () => {
		const guide = readSubagentGuide("workflows");

		assert.match(guide, /### Parallel sequential lanes[\s\S]*runs\.lanes/);
		assert.match(guide, /### Host command steps[\s\S]*runs\.host/);
		assert.match(guide, /### Advanced rolling child runs[\s\S]*Promise\.race[\s\S]*Promise\.all/);
	});
});
