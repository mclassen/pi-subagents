import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { missionRecordPath, resolveMissionStoreLocation, updateMission } from "../../../src/missions/store.ts";

const [mode, root, id] = process.argv.slice(2);
const location = resolveMissionStoreLocation({ projectRoot: path.join(root, "project"), agentDir: path.join(root, "agent") });
const recordPath = missionRecordPath(location, id);
function barrier(name, release) {
	process.send(name);
	const deadline = Date.now() + 15000;
	while (!fs.existsSync(path.join(root, release))) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${release}`);
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
	}
}
if (mode === "reject") {
	const original = fs.readFileSync;
	let intercepted = false;
	fs.readFileSync = function (file, ...args) {
		const result = original.call(this, file, ...args);
		if (!intercepted && file === recordPath) {
			intercepted = true;
			barrier("writer-locked", "release-writer");
		}
		return result;
	};
	syncBuiltinESMExports();
	updateMission(location, id, { acceptance: JSON.parse(fs.readFileSync(path.join(root, "ledger.json"), "utf8")) });
	if (!intercepted) throw new Error("Writer did not read the locked record");
} else if (mode === "close") {
	const original = fs.mkdirSync;
	let intercepted = false;
	fs.mkdirSync = function (dir, ...args) {
		try { return original.call(this, dir, ...args); }
		catch (error) {
			if (!intercepted && dir === `${recordPath}.lock` && error.code === "EEXIST") {
				intercepted = true;
				barrier("closure-contended", "writer-done");
			}
			throw error;
		}
	};
	syncBuiltinESMExports();
	try {
		updateMission(location, id, { status: "completed" });
		throw new Error("Completion unexpectedly succeeded");
	} catch (error) {
		if (!intercepted || !/recorded acceptance is rejected/i.test(error.message)) throw error;
	}
} else throw new Error(`Unknown mode: ${mode}`);
