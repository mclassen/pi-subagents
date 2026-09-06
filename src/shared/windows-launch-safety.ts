import * as path from "node:path";

export const WINDOWS_APPLICATION_LAUNCH_SAFETY = "On Windows, do not launch GUI applications or file associations—including start, Start-Process, explorer, OpenWith, Notepad, browsers, or editors such as VS Code—unless the assigned task explicitly requires opening that application. Treat passing a repository file path to a native executable as a possible launch, not inspection. For bulk inspection, use non-interactive CLI tools or a script with explicit argv binding; never assume piped input when a command appends filenames as arguments.";

/** Prevents child-process launches from opening a console window or invoking a shell association. */
export const WINDOWS_HIDDEN_PROCESS_OPTIONS = Object.freeze({ windowsHide: true, shell: false } as const);

export function windowsSystemExecutable(...segments: string[]): string {
	return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", ...segments);
}
