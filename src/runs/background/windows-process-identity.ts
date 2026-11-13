import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { WINDOWS_HIDDEN_PROCESS_OPTIONS, windowsSystemDirectory, windowsSystemExecutable } from "../../shared/windows-launch-safety.ts";

export interface WindowsProcessSnapshot { pid: number; parentPid: number; creationDate: string }
export interface RetainedWindowsProcess { handle: string; creationDate: string; exited: boolean }

// Handles live in the controller process, not the short-lived helper observer. Every
// signal and exit check duplicates that same kernel object; a recycled PID is never a target.
const nativeSource = `
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class OwnedProcessRow {
 public int pid { get; set; }
 public int parentPid { get; set; }
 public string creationDate { get; set; }
}
public static class OwnedProcessNative {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
  public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parentPid; public int priority; public uint flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string executable;
 }
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
 [StructLayout(LayoutKind.Sequential)] struct BasicInformation {
  public IntPtr reserved1, peb, reserved2a, reserved2b, pid, parentPid;
 }
 [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int informationClass, out BasicInformation information, int length, out int returnedLength);
 public static OwnedProcessRow[] Snapshot() {
  IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
  if(snapshot==new IntPtr(-1)) throw new Exception("Process snapshot failed");
  try {
   var entry=new ProcessEntry(); entry.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
   var rows=new List<OwnedProcessRow>();
   if(!Process32FirstW(snapshot,ref entry)) throw new Exception("Process snapshot enumeration failed");
   do {
    string creation=""; int parent=(int)entry.parentPid;
    IntPtr handle=OpenProcess(5120,false,entry.pid);
    if(handle!=IntPtr.Zero) {
     try {
      BasicInformation info; int length;
      // Parent and creation are read through one handle, not mixed across a PID-reuse race.
      if(NtQueryInformationProcess(handle,0,out info,Marshal.SizeOf(typeof(BasicInformation)),out length)==0) {
       parent=info.parentPid.ToInt32(); creation=Creation(handle);
      }
     } finally { CloseHandle(handle); }
    }
    rows.Add(new OwnedProcessRow { pid=(int)entry.pid, parentPid=parent, creationDate=creation });
   } while(Process32NextW(snapshot,ref entry));
   if(Marshal.GetLastWin32Error()!=18) throw new Exception("Incomplete process snapshot");
   return rows.ToArray();
  } finally { CloseHandle(snapshot); }
 }
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
 [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool DuplicateHandle(IntPtr source, IntPtr handle, IntPtr target, out IntPtr result, uint access, bool inherit, uint options);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr handle, uint code);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
 public static string Creation(IntPtr handle) {
  long c,e,k,u; if (!GetProcessTimes(handle,out c,out e,out k,out u)) throw new Exception("GetProcessTimes failed");
  return c.ToString();
 }
 public static IntPtr Copy(IntPtr source, IntPtr handle, IntPtr target, uint options) {
  IntPtr result; if (!DuplicateHandle(source,handle,target,out result,0,false,options)) throw new Exception("DuplicateHandle failed: " + Marshal.GetLastWin32Error()); return result;
 }
 public static bool Exited(IntPtr handle) {
  uint result=WaitForSingleObject(handle,0); if(result==0) return true;
  if(result!=258) throw new Exception("WaitForSingleObject failed"); return false;
 }
}
`;

// The helper is a small native console program, compiled once per source revision and
// reused, so each call costs tens of milliseconds instead of a PowerShell start (~2 s).
const helperSource = `using System.Web.Script.Serialization;
${nativeSource}${String.raw`
public static class OwnedProcessHelper {
 static IntPtr owner, self;
 static List<Dictionary<string, object>> created = new List<Dictionary<string, object>>();
 static IntPtr H(object value) { return new IntPtr(Convert.ToInt64(value)); }
 static void ReleaseOwned(object handle) {
  // CLOSE_SOURCE may consume the source even when DuplicateHandle fails: never retry it.
  IntPtr local = OwnedProcessNative.Copy(owner, H(handle), self, 3);
  if (!OwnedProcessNative.CloseHandle(local)) throw new Exception("CloseHandle failed after source transfer");
 }
 static Dictionary<string, object> Proof(object pid, string handle, object creationDate, bool exited) {
  var proof = new Dictionary<string, object>();
  proof["pid"] = Convert.ToInt32(pid); proof["handle"] = handle; proof["creationDate"] = Convert.ToString(creationDate); proof["exited"] = exited;
  return proof;
 }
 public static int Main(string[] args) {
  var json = new JavaScriptSerializer(); json.MaxJsonLength = int.MaxValue;
  try {
   var input = (Dictionary<string, object>)json.DeserializeObject(Console.In.ReadToEnd());
   owner = OwnedProcessNative.OpenProcess(64, false, uint.Parse(args[0]));
   if (owner == IntPtr.Zero) throw new Exception("Cannot open controller handle table");
   self = OwnedProcessNative.GetCurrentProcess();
   try {
    string action = Convert.ToString(input["action"]);
    var retained = new List<Dictionary<string, object>>();
    object raw; if (input.TryGetValue("retained", out raw) && raw != null) foreach (object item in (object[])raw) retained.Add((Dictionary<string, object>)item);
    var retainedPids = new HashSet<string>(); foreach (var item in retained) retainedPids.Add(Convert.ToString(item["pid"]));
    if (action == "release") {
     var releases = new List<Dictionary<string, object>>();
     foreach (var item in retained) {
      var row = new Dictionary<string, object>();
      row["pid"] = Convert.ToInt32(item["pid"]); row["creationDate"] = Convert.ToString(item["creationDate"]);
      try { ReleaseOwned(item["handle"]); row["state"] = "released"; }
      catch (Exception e) { row["state"] = "uncertain"; row["diagnostic"] = e.Message; }
      releases.Add(row);
     }
     var released = new Dictionary<string, object>(); released["releaseResults"] = releases.ToArray();
     Console.Out.Write(json.Serialize(released));
     return 0;
    }
    var proofs = new List<Dictionary<string, object>>();
    var signalFailures = new Dictionary<string, int>();
    object deadlineValue;
    DateTime deadline = input.TryGetValue("deadline", out deadlineValue) && deadlineValue != null
     ? DateTimeOffset.FromUnixTimeMilliseconds(Convert.ToInt64(deadlineValue)).UtcDateTime : DateTime.UtcNow;
    foreach (var item in retained) {
     IntPtr local = OwnedProcessNative.Copy(owner, H(item["handle"]), self, 2);
     try {
      if (action == "terminate" && !OwnedProcessNative.Exited(local)) {
       if (!OwnedProcessNative.TerminateProcess(local, 1)) signalFailures[Convert.ToString(item["pid"])] = Marshal.GetLastWin32Error();
      }
      proofs.Add(Proof(item["pid"], Convert.ToString(item["handle"]), item["creationDate"], OwnedProcessNative.Exited(local)));
     } finally { OwnedProcessNative.CloseHandle(local); }
    }
    if (action == "terminate") {
     foreach (var item in retained) {
      IntPtr local = OwnedProcessNative.Copy(owner, H(item["handle"]), self, 2);
      try {
       double remaining = Math.Max(0, (deadline - DateTime.UtcNow).TotalMilliseconds);
       OwnedProcessNative.WaitForSingleObject(local, (uint)remaining);
       string key = Convert.ToString(item["pid"]);
       if (signalFailures.ContainsKey(key) && !OwnedProcessNative.Exited(local)) throw new Exception("TerminateProcess failed for retained PID " + key + " (expected=" + Convert.ToString(item["creationDate"]) + ", retained=" + OwnedProcessNative.Creation(local) + "): " + signalFailures[key]);
      } finally { OwnedProcessNative.CloseHandle(local); }
     }
     Console.Out.Write("{}");
     return 0;
    }
    OwnedProcessRow[] rows = OwnedProcessNative.Snapshot();
    var candidates = new HashSet<int>();
    foreach (var proof in proofs) {
     if ((bool)proof["exited"]) continue;
     foreach (var row in rows) if (row.pid == (int)proof["pid"] && row.creationDate == (string)proof["creationDate"]) { candidates.Add(row.pid); break; }
    }
    object root; if (input.TryGetValue("root", out root) && root != null) candidates.Add(Convert.ToInt32(root));
    bool changed;
    do {
     changed = false;
     foreach (var row in rows) if (candidates.Contains(row.parentPid) && !candidates.Contains(row.pid)) { candidates.Add(row.pid); changed = true; }
    } while (changed);
    foreach (var row in rows) {
     if (!candidates.Contains(row.pid) || retainedPids.Contains(row.pid.ToString())) continue;
     // SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
     IntPtr local = OwnedProcessNative.OpenProcess(1048577 | 4096, false, (uint)row.pid);
     if (local == IntPtr.Zero) throw new Exception("Cannot retain observed PID " + row.pid);
     try {
      string observed = OwnedProcessNative.Creation(local);
      if (observed != row.creationDate) throw new Exception("PID " + row.pid + " changed before retention (expected=" + row.creationDate + ", observed=" + observed + ")");
      IntPtr remote = OwnedProcessNative.Copy(self, local, owner, 2);
      var entry = new Dictionary<string, object>(); entry["pid"] = row.pid; entry["creationDate"] = row.creationDate; entry["handle"] = remote.ToInt64().ToString();
      created.Add(entry);
      proofs.Add(Proof(row.pid, remote.ToInt64().ToString(), row.creationDate, OwnedProcessNative.Exited(local)));
     } finally { OwnedProcessNative.CloseHandle(local); }
    }
    var output = new Dictionary<string, object>(); output["processes"] = rows; output["retained"] = proofs.ToArray();
    Console.Out.Write(json.Serialize(output));
    return 0;
   } catch (Exception e) {
    string failure = e.Message;
    var rollbackFailures = new List<string>();
    foreach (var item in created) {
     try { ReleaseOwned(item["handle"]); }
     catch (Exception rollback) { rollbackFailures.Add(item["pid"] + "@" + item["creationDate"] + ": " + rollback.Message); }
    }
    if (rollbackFailures.Count > 0) failure += "; rollback uncertain identities: " + string.Join(", ", rollbackFailures.ToArray());
    throw new Exception(failure);
   } finally { OwnedProcessNative.CloseHandle(owner); }
  } catch (Exception e) {
   Console.Error.Write(e.Message);
   return 1;
  }
 }
}
`}`;

interface WindowsReleaseResult {
	pid: number;
	creationDate: string;
	state: "released" | "uncertain";
	diagnostic?: string;
}

interface NativeResult {
	releaseResults?: WindowsReleaseResult[];
	processes?: WindowsProcessSnapshot[];
	retained?: (RetainedWindowsProcess & { pid: number })[];
	diagnostic?: string;
}

let helperExecutable: string | undefined;
function helperPath(): string {
	if (helperExecutable && fs.existsSync(helperExecutable)) return helperExecutable;
	const digest = createHash("sha256").update(helperSource).digest("hex").slice(0, 16);
	const target = path.join(os.tmpdir(), `pi-owned-process-helper-${digest}.exe`);
	if (!fs.existsSync(target)) {
		// Build privately, then publish atomically so concurrent builders never run a partial file.
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-owned-process-build-"));
		try {
			const staged = path.join(directory, "helper.exe");
			const result = spawnSync(windowsSystemExecutable("WindowsPowerShell", "v1.0", "powershell.exe"), [
				"-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
				"$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -ReferencedAssemblies System.Web.Extensions -OutputType ConsoleApplication -OutputAssembly $env:PI_OWNED_PROCESS_HELPER_OUT",
			], { encoding: "utf8", input: helperSource, timeout: 60_000, ...WINDOWS_HIDDEN_PROCESS_OPTIONS, cwd: windowsSystemDirectory(), env: { ...process.env, PI_OWNED_PROCESS_HELPER_OUT: staged } });
			if (result.error || result.status !== 0 || !fs.existsSync(staged)) {
				throw new Error(result.error?.message ?? (result.stderr.trim() || `helper build exited with ${result.status}`));
			}
			try { fs.renameSync(staged, target); }
			catch (error) { if (!fs.existsSync(target)) throw error; }
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	}
	helperExecutable = target;
	return target;
}

const helperTimeout = (input: object) => 5000 + ("verifyMs" in input ? Number((input as { verifyMs?: unknown }).verifyMs) : 0);

function invoke(input: object): NativeResult {
	try {
		const payload = JSON.stringify(input);
		const result = spawnSync(helperPath(), [String(process.pid)],
			{ encoding: "utf8", input: payload, timeout: helperTimeout(input), ...WINDOWS_HIDDEN_PROCESS_OPTIONS, cwd: windowsSystemDirectory() });
		if (result.error || result.status !== 0) return { diagnostic: result.error?.message ?? (result.stderr.trim() || `Windows identity helper exited with ${result.status}`) };
		try { return JSON.parse(result.stdout.trim()); }
		catch { return { diagnostic: "Invalid Windows identity helper response." }; }
	} catch (error) {
		return { diagnostic: `Windows identity helper setup/launch failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/** Same helper protocol as invoke(), without blocking the event loop. */
function invokeAsync(input: object): Promise<NativeResult> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: NativeResult) => { if (!settled) { settled = true; resolve(result); } };
		try {
			const child = spawn(helperPath(), [String(process.pid)], {
				...WINDOWS_HIDDEN_PROCESS_OPTIONS, cwd: windowsSystemDirectory(), stdio: ["pipe", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
			const timer = setTimeout(() => { child.kill(); finish({ diagnostic: "Windows identity helper timed out." }); }, helperTimeout(input));
			child.once("error", (error) => { clearTimeout(timer); finish({ diagnostic: `Windows identity helper setup/launch failed: ${error.message}` }); });
			child.once("close", (status) => {
				clearTimeout(timer);
				if (status !== 0) return finish({ diagnostic: stderr.trim() || `Windows identity helper exited with ${status}` });
				try { finish(JSON.parse(stdout.trim())); }
				catch { finish({ diagnostic: "Invalid Windows identity helper response." }); }
			});
			child.stdin.end(JSON.stringify(input));
		} catch (error) {
			finish({ diagnostic: `Windows identity helper setup/launch failed: ${error instanceof Error ? error.message : String(error)}` });
		}
	});
}

function entries(retained: ReadonlyMap<number, RetainedWindowsProcess>) {
	return [...retained].map(([pid, proof]) => ({ pid, ...proof }));
}

export function observeWindowsProcesses(retained: Map<number, RetainedWindowsProcess>, root?: number): WindowsProcessSnapshot[] | { diagnostic: string } {
	const result = invoke({ action: "observe", retained: entries(retained), root, verifyMs: 0 });
	if (result.diagnostic) return { diagnostic: result.diagnostic };
	if (!Array.isArray(result.processes) || !Array.isArray(result.retained)) return { diagnostic: "Incomplete Windows identity helper response." };
	for (const item of result.retained) retained.set(item.pid, { handle: item.handle, creationDate: item.creationDate, exited: item.exited });
	return result.processes;
}

/** Non-blocking observe for periodic monitoring; callers must not overlap it with other helper calls. */
export async function observeWindowsProcessesAsync(retained: Map<number, RetainedWindowsProcess>, root?: number): Promise<WindowsProcessSnapshot[] | { diagnostic: string }> {
	const result = await invokeAsync({ action: "observe", retained: entries(retained), root, verifyMs: 0 });
	if (result.diagnostic) return { diagnostic: result.diagnostic };
	if (!Array.isArray(result.processes) || !Array.isArray(result.retained)) return { diagnostic: "Incomplete Windows identity helper response." };
	for (const item of result.retained) retained.set(item.pid, { handle: item.handle, creationDate: item.creationDate, exited: item.exited });
	return result.processes;
}

export function signalRetainedWindowsProcesses(retained: ReadonlyMap<number, RetainedWindowsProcess>, verifyMs: number): { diagnostic: string } | undefined {
	const result = invoke({ action: "terminate", retained: entries(retained), verifyMs, deadline: Date.now() + Math.max(0, verifyMs) });
	return result.diagnostic ? { diagnostic: result.diagnostic } : undefined;
}

/** Consume a release batch once. Failed CLOSE_SOURCE calls may already have closed
 * their source, so an uncertain numeric value must never be retried or queried. */
export function releaseWindowsProcesses(retained: Map<number, RetainedWindowsProcess>): { diagnostic: string } | undefined {
	if (!retained.size) return undefined;
	const batch = entries(retained);
	// Quarantine all values before invocation, including when response/launch is uncertain.
	retained.clear();
	const result = invoke({ action: "release", retained: batch, verifyMs: 0 });
	const released: string[] = [];
	const uncertain: string[] = [];
	const outcomes = new Map(result.releaseResults?.map((row) => [row.pid, row]));
	for (const item of batch) {
		const candidate = outcomes.get(item.pid);
		const outcome = candidate?.creationDate === item.creationDate ? candidate : undefined;
		const identity = `${item.pid}@${item.creationDate}`;
		if (outcome?.state === "released") released.push(identity);
		else uncertain.push(`${identity}: ${outcome?.diagnostic ?? result.diagnostic ?? "missing release acknowledgement"}`);
	}
	if (uncertain.length || result.diagnostic) {
		return { diagnostic: `Windows handle release failed; released=${released.join(", ") || "none"}; uncertain identities=${uncertain.join(", ") || "unknown"}${result.diagnostic ? `; ${result.diagnostic}` : ""}. Source handle values will not be retried.` };
	}
	return undefined;
}
