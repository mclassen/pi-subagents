import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { WINDOWS_HIDDEN_PROCESS_OPTIONS, windowsSystemExecutable } from "../../shared/windows-launch-safety.ts";

export interface WindowsProcessSnapshot { pid: number; parentPid: number; creationDate: string }
export interface RetainedWindowsProcess { handle: string; creationDate: string; exited: boolean }

// Handles live in the controller process, not the short-lived PowerShell observer. Every
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

// Cache compilation once per controller host; monitor ticks only load the private assembly.
let nativeAssembly: string | undefined;
function assemblyPath(): string {
	if (!nativeAssembly) {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-owned-process-native-"));
		nativeAssembly = path.join(directory, "OwnedProcessNative.dll");
		process.once("exit", () => { fs.rmSync(directory, { recursive: true, force: true }); });
	}
	return nativeAssembly;
}

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

function invoke(input: object): NativeResult {
	try {
		const payload = JSON.stringify(input);
		const assembly = assemblyPath().replaceAll("'", "''");
		const command = `
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '${assembly}')) {
Add-Type -OutputAssembly '${assembly}' -TypeDefinition @'
${nativeSource}
'@
}
Add-Type -Path '${assembly}'
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$owner = [OwnedProcessNative]::OpenProcess(64, $false, ${process.pid})
if ($owner -eq [IntPtr]::Zero) { throw 'Cannot open controller handle table' }
$self = [OwnedProcessNative]::GetCurrentProcess()
$created = [Collections.Generic.List[object]]::new()
function Release-OwnedHandle($handle) {
 # CLOSE_SOURCE may consume the source even when DuplicateHandle fails: never retry it.
 $local = [OwnedProcessNative]::Copy($owner, [IntPtr]([long]$handle), $self, 3)
 if (-not [OwnedProcessNative]::CloseHandle($local)) { throw 'CloseHandle failed after source transfer' }
}
try {
 $retained = @{}
 foreach ($item in $inputData.retained) { $retained[[string]$item.pid] = $item }
 if ($inputData.action -eq 'release') {
  $releases = [Collections.Generic.List[object]]::new()
  foreach ($item in $inputData.retained) {
   try {
    Release-OwnedHandle $item.handle
    $releases.Add(@{ pid=[int]$item.pid; creationDate=[string]$item.creationDate; state='released' })
   } catch {
    $releases.Add(@{ pid=[int]$item.pid; creationDate=[string]$item.creationDate; state='uncertain'; diagnostic=$_.Exception.Message })
   }
  }
  @{ releaseResults=@($releases.ToArray()) } | ConvertTo-Json -Compress -Depth 5
  return
 }
 $proofs = [Collections.Generic.List[object]]::new()
 $signalFailures = @{}
 $deadline = if ($inputData.deadline) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$inputData.deadline).UtcDateTime } else { [DateTime]::UtcNow }
 foreach ($item in $inputData.retained) {
  $local = [OwnedProcessNative]::Copy($owner, [IntPtr]([long]$item.handle), $self, 2)
  try {
   if ($inputData.action -eq 'terminate' -and -not [OwnedProcessNative]::Exited($local)) {
    if (-not [OwnedProcessNative]::TerminateProcess($local, 1)) { $signalFailures[[string]$item.pid] = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
   }
   $proofs.Add(@{ pid=[int]$item.pid; handle=[string]$item.handle; creationDate=[string]$item.creationDate; exited=[OwnedProcessNative]::Exited($local) })
  } finally { [void][OwnedProcessNative]::CloseHandle($local) }
 }
 if ($inputData.action -eq 'terminate') {
  foreach ($item in $inputData.retained) {
   $local = [OwnedProcessNative]::Copy($owner, [IntPtr]([long]$item.handle), $self, 2)
   try {
    $remaining = [Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    [void][OwnedProcessNative]::WaitForSingleObject($local, [uint32]$remaining)
    if ($signalFailures.ContainsKey([string]$item.pid) -and -not [OwnedProcessNative]::Exited($local)) { throw "TerminateProcess failed for retained PID $($item.pid) (expected=$($item.creationDate), retained=$([OwnedProcessNative]::Creation($local))): $($signalFailures[[string]$item.pid])" }
   } finally { [void][OwnedProcessNative]::CloseHandle($local) }
  }
  '{}' ; return
 }
 $rows = @([OwnedProcessNative]::Snapshot())
 $candidates = @{}
 foreach ($item in $proofs) {
  if ($item.exited) { continue }
  foreach ($row in $rows) {
   if ($row.pid -eq $item.pid -and $row.creationDate -eq $item.creationDate) { $candidates[[string]$item.pid] = $true; break }
  }
 }
 if ($inputData.root) { $candidates[[string]$inputData.root] = $true }
 do {
  $changed = $false
  foreach ($row in $rows) {
   if ($candidates.ContainsKey([string]$row.parentPid) -and -not $candidates.ContainsKey([string]$row.pid)) {
    $candidates[[string]$row.pid] = $true; $changed = $true
   }
  }
 } while ($changed)
 foreach ($row in $rows) {
  if (-not $candidates.ContainsKey([string]$row.pid) -or $retained.ContainsKey([string]$row.pid)) { continue }
  # SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
  $local = [OwnedProcessNative]::OpenProcess(1048577 -bor 4096, $false, [uint32]$row.pid)
  if ($local -eq [IntPtr]::Zero) { throw "Cannot retain observed PID $($row.pid)" }
  try {
   $observedCreation = [OwnedProcessNative]::Creation($local)
   if ($observedCreation -ne $row.creationDate) { throw "PID $($row.pid) changed before retention (expected=$($row.creationDate), observed=$observedCreation)" }
   $remote = [OwnedProcessNative]::Copy($self, $local, $owner, 2)
   $created.Add(@{ pid=$row.pid; creationDate=$row.creationDate; handle=$remote.ToInt64().ToString() })
   $proofs.Add(@{ pid=$row.pid; handle=$remote.ToInt64().ToString(); creationDate=$row.creationDate; exited=[OwnedProcessNative]::Exited($local) })
  } finally { [void][OwnedProcessNative]::CloseHandle($local) }
 }
 @{ processes=@($rows); retained=@($proofs.ToArray()) } | ConvertTo-Json -Compress -Depth 5
} catch {
 $failure = $_.Exception.Message
 $rollbackFailures = [Collections.Generic.List[string]]::new()
 foreach ($item in $created) {
  try { Release-OwnedHandle $item.handle }
  catch { $rollbackFailures.Add("$($item.pid)@$($item.creationDate): $($_.Exception.Message)") }
 }
 if ($rollbackFailures.Count) { $failure += "; rollback uncertain identities: " + ($rollbackFailures -join ', ') }
 throw $failure
} finally { [void][OwnedProcessNative]::CloseHandle($owner) }
`;
		const result = spawnSync(windowsSystemExecutable("WindowsPowerShell", "v1.0", "powershell.exe"),
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
			{ encoding: "utf8", input: payload, timeout: 5000 + ("verifyMs" in input ? Number(input.verifyMs) : 0), ...WINDOWS_HIDDEN_PROCESS_OPTIONS });
		if (result.error || result.status !== 0) return { diagnostic: result.error?.message ?? (result.stderr.trim() || `Windows identity helper exited with ${result.status}`) };
		try { return JSON.parse(result.stdout.trim()); }
		catch { return { diagnostic: "Invalid Windows identity helper response." }; }
	} catch (error) {
		return { diagnostic: `Windows identity helper setup/launch failed: ${error instanceof Error ? error.message : String(error)}` };
	}
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
