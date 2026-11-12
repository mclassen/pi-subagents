import { withFileLock } from "../../../src/shared/file-lock.ts";

const [mode, filePath] = process.argv.slice(2);
if (mode !== "hold") throw new Error(`Unknown mode: ${mode}`);
withFileLock(filePath, () => {
	process.stdout.write("locked\n");
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
