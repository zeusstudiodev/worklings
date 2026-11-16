// What a desk started, remembered, so closing the company can stop all of it.
//
// A desk is `claude -p`; its Bash tool starts dev servers and watchers in the background. On Windows the shell in
// between often exits and the server stays, and nothing links a process to its parent's parent any more: a process
// table read afterwards can't say whose it was, and `taskkill /T` from the desk only follows live parent links. So the
// links are written down while they still exist. While a desk runs, one timer reads the process table (a PowerShell
// helper on Windows, `ps` elsewhere) and adds every process whose parent is already known to the desk's family, with its
// creation time. A process that is in the family stays in it after its parent exits, so an orphan's own children are
// found too; a dead parent stays in the family too (a "ghost"), so an orphan that appears after its shell has gone is
// still linked to it.
//
// A process is only ever stopped when its pid AND its creation time match what was recorded, so a pid the system has
// reused for something else (another session, another project) is never touched. Nothing here looks at names, ports
// or command lines.
//
// When the family is stopped: `reap(owner)`, from Switchboard.close and closeAll. A person's own Stop only interrupts
// the turn and leaves their dev server running; the desk's own kill (a hang, an interrupt nobody answered) leaves what
// it can't reach running too, and the family keeps it until the person's desk is closed.
//
// The family also says what a desk may stop by itself (startedBy): the approvals policy lets a person stop a process
// by its pid when the pid is in their own desk's family, and asks for every other stop.
import { type ChildProcessByStdio, execFile, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { join } from 'node:path';

export interface ProcessRow {
  ppid: number;
  /** Creation time in ms since the epoch (whole seconds off Windows). */
  created: number;
}
export type ProcessTable = Map<number, ProcessRow>;
/** pid to creation time of the processes known to belong to a desk. */
export type Members = Map<number, number>;

/** More than a desk could start in a working day; past it new processes aren't recorded. */
const MEMBER_CAP = 500;
const READ_MS = 15_000;
const TASKKILL_MS = 30_000;
const DEFAULT_POLL_MS = 2_000;
const MIN_POLL_MS = 100;

// ---------------------------------------------------------------------------------------------------------------------
// The process table

/**
 * The Windows reader: one PowerShell that stays alive while desks run and answers "snap" with the table, taken through
 * the Toolhelp API (parent ids) and GetProcessTimes (creation times). Asking WMI (Win32_Process) for the same costs one to
 * several CPU seconds a call, far too much for a poll; here one snapshot is a few milliseconds once the helper has
 * compiled its little C# class (a second or two, once). It ends when its input closes, so it never outlives the office.
 */
const HELPER_SOURCE = `
using System; using System.Text; using System.Runtime.InteropServices;
public static class Snap {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct PE { public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szExeFile; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PE e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PE e);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long create, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Table() {
    StringBuilder sb = new StringBuilder();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    if (snap == (IntPtr)(-1)) return "";
    try {
      PE e = new PE();
      e.dwSize = (uint)Marshal.SizeOf(typeof(PE));
      for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e)) {
        IntPtr h = OpenProcess(0x1000, false, e.th32ProcessID);
        if (h == IntPtr.Zero) continue;
        long c, x, k, u;
        if (GetProcessTimes(h, out c, out x, out k, out u)) sb.Append(e.th32ProcessID).Append(' ').Append(e.th32ParentProcessID).Append(' ').Append((c - 116444736000000000L) / 10000L).Append('\\n');
        CloseHandle(h);
      }
    } finally { CloseHandle(snap); }
    return sb.ToString();
  }
}`;
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${HELPER_SOURCE}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($null -ne [Console]::In.ReadLine()) { [Console]::Out.Write([Snap]::Table()); [Console]::Out.WriteLine('end'); [Console]::Out.Flush() }
`;

interface Helper {
  child: ChildProcessByStdio<Writable, Readable, null>;
  buffer: string;
  ready: boolean;
  /** The one read waiting for its answer (freshTable never asks for two at once). */
  waiting: ((table: ProcessTable | null) => void) | null;
}
let helper: Helper | null = null;
let helperIdle: ReturnType<typeof setTimeout> | null = null;
/** The helper ends after this long without a read: no desk has run for a while. */
const HELPER_IDLE_MS = 60_000;
/** The first answer waits for the C# class to compile, which can take long on a busy machine. */
const HELPER_STARTUP_MS = 90_000;

function retire(h: Helper): void {
  if (helper === h) helper = null;
  h.child.kill(); // a process this module started
  const waiting = h.waiting;
  h.waiting = null;
  waiting?.(null);
}

function startHelper(): Helper {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const h: Helper = { child, buffer: '', ready: false, waiting: null };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    h.buffer = (h.buffer + chunk).slice(-8 * 1024 * 1024);
    const end = /(^|\n)end\r?\n/.exec(h.buffer);
    if (!end) return;
    const text = h.buffer.slice(0, end.index);
    h.buffer = h.buffer.slice(end.index + end[0].length);
    h.ready = true;
    const waiting = h.waiting;
    h.waiting = null;
    waiting?.(parseTable(text, 'win32'));
  });
  child.stdin.on('error', () => undefined);
  child.on('error', () => retire(h));
  child.on('exit', () => retire(h));
  // Neither the helper nor its pipes may keep the office's process alive.
  child.unref();
  for (const stream of [child.stdin, child.stdout]) (stream as unknown as { unref?: () => void }).unref?.();
  return h;
}

function readWindows(): Promise<ProcessTable | null> {
  const h = (helper ??= startHelper());
  if (helperIdle) clearTimeout(helperIdle);
  return new Promise((done) => {
    const timer = setTimeout(() => retire(h), h.ready ? READ_MS : HELPER_STARTUP_MS);
    h.waiting = (table) => {
      clearTimeout(timer);
      if (helperIdle) clearTimeout(helperIdle);
      helperIdle = setTimeout(() => retire(h), HELPER_IDLE_MS);
      helperIdle.unref();
      done(table && table.size > 0 ? table : null);
    };
    h.child.stdin.write('snap\n');
  });
}

/** Parses the lines `pid ppid created-ms` (Windows) or `pid ppid <lstart>` (ps); lines that aren't either are skipped. */
export function parseTable(text: string, platform: NodeJS.Platform = process.platform): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = platform === 'win32' ? /^\s*(\d+) (\d+) (\d+)\s*$/.exec(line) : /^\s*(\d+)\s+(\d+)\s+(\S.*\S)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const created = platform === 'win32' ? Number(m[3]) : Date.parse(m[3] ?? '');
    if (!Number.isSafeInteger(pid) || Number.isNaN(created)) continue;
    table.set(pid, { ppid: Number(m[2]), created });
  }
  return table;
}

/** Reads the system's process table; null when it can't be read (then nothing is recorded and nothing is stopped). */
function readTable(): Promise<ProcessTable | null> {
  if (process.platform === 'win32') return readWindows();
  // ps prints its dates in the user's language otherwise.
  return new Promise((done) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { timeout: READ_MS, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      const table = error ? null : parseTable(String(stdout), process.platform);
      done(table && table.size > 0 ? table : null);
    });
  });
}

let reading: Promise<ProcessTable | null> | null = null;
let queued: Promise<ProcessTable | null> | null = null;

/**
 * A table read that started after this call: callers that arrive while a read runs share the one read that follows,
 * so ten desks closing together cost two reads, and none gets a table older than the moment it asked.
 */
function freshTable(): Promise<ProcessTable | null> {
  const start = () => {
    const read: Promise<ProcessTable | null> = readTable().finally(() => {
      if (reading === read) reading = null;
    });
    reading = read;
    return read;
  };
  if (reading === null) return start();
  queued ??= reading.then(() => {
    queued = null;
    return start();
  });
  return queued;
}

// ---------------------------------------------------------------------------------------------------------------------
// Families

/**
 * Adds to `members` every process in `table` whose parent is a member, until nothing more is found. The first call for
 * a family is seeded with its root. A child counts only if it was created no earlier than its parent and its parent's
 * pid isn't now held by a different process (a reused pid).
 */
export function absorb(members: Members, table: ProcessTable): void {
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, row] of table) {
      if (members.has(pid)) continue;
      const parentCreated = members.get(row.ppid);
      if (parentCreated === undefined || row.created < parentCreated) continue;
      const holder = table.get(row.ppid);
      if (holder && holder.created !== parentCreated) continue;
      if (members.size >= MEMBER_CAP) return;
      members.set(pid, row.created);
      grew = true;
    }
  }
}

/** The members that are running now: the same pid with the same creation time. Never this process. */
export function living(members: Members, table: ProcessTable): number[] {
  return [...members].filter(([pid, created]) => pid !== process.pid && table.get(pid)?.created === created).map(([pid]) => pid);
}

/** Drops members that have ended, except `keep`. Run after absorb, so a dead parent has already linked its children. */
function prune(members: Members, table: ProcessTable, keep?: number): void {
  for (const [pid, created] of members) if (pid !== keep && table.get(pid)?.created !== created) members.delete(pid);
}

export interface Family {
  readonly owner: string;
  readonly root: number;
  readonly members: Members;
}

const running = new Set<Family>();
/** The owner of each desk, by the desk's own scratch folder: the name the hub knows a desk by (its token carries it). */
const desks = new Map<string, string>();
/** What desks that have exited left behind, per owner: nobody polls for it, close() stops it. */
const left = new Map<string, Members>();
let timer: ReturnType<typeof setInterval> | null = null;

function pollMs(): number {
  const wanted = Number(process.env.WORKLINGS_PROCESS_POLL_MS);
  return Number.isFinite(wanted) && wanted > 0 ? Math.max(MIN_POLL_MS, wanted) : DEFAULT_POLL_MS;
}

function record(table: ProcessTable): void {
  for (const f of running) {
    if (f.members.size === 0) {
      const root = table.get(f.root);
      if (root) f.members.set(f.root, root.created);
    }
    if (f.members.size > 0) absorb(f.members, table);
  }
  for (const [owner, members] of left) {
    absorb(members, table);
    prune(members, table);
    if (members.size === 0) left.delete(owner);
  }
  for (const f of running) prune(f.members, table, f.root);
}

async function tick(): Promise<void> {
  if (running.size === 0) return;
  const table = await freshTable();
  if (table && running.size > 0) record(table);
}

/**
 * Starts remembering what the desk with this pid starts. `owner` names whose desk it is (see reap); `desk` is the desk's
 * own scratch folder, by which startedBy finds the family.
 */
export function watchDesk(owner: string, pid: number, desk?: string): Family {
  const family: Family = { owner, root: pid, members: new Map() };
  running.add(family);
  if (desk !== undefined) desks.set(desk, owner);
  if (timer === null) {
    timer = setInterval(() => void tick(), pollMs());
    timer.unref();
  }
  void tick();
  return family;
}

/** The desk is about to be killed: records what it has started up to this moment, while the parent links still exist. */
export async function recordNow(family: Family): Promise<void> {
  const table = await freshTable();
  if (table && running.has(family)) record(table);
}

/** The desk has exited: stop polling for it and keep what it started until its person's desk is closed. */
export function endWatch(family: Family): void {
  if (!running.delete(family)) return;
  if (running.size === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (family.members.size <= 1) return;
  const kept = left.get(family.owner) ?? new Map();
  for (const [pid, created] of family.members) if (kept.size < MEMBER_CAP) kept.set(pid, created);
  left.set(family.owner, kept);
}

/**
 * What the desk with this scratch folder started and is running now, from a process table read after the call: the
 * recorded family of the desk's person (this desk's and their earlier desks'), without the desks themselves, each pid
 * checked against its creation time. Empty for a desk nobody watches and when the table can't be read. Never rejects.
 */
export async function startedBy(desk: string): Promise<Set<number>> {
  const owner = desks.get(desk);
  if (owner === undefined) return new Set();
  const table = await freshTable().catch(() => null);
  if (!table) return new Set();
  record(table);
  return startedIn(owner, table);
}

/** The living members of `owner`'s families in `table`, the desks' own processes left out. */
function startedIn(owner: string, table: ProcessTable): Set<number> {
  const all: Members = new Map(left.get(owner));
  const roots = new Set<number>();
  for (const f of running) {
    if (f.owner !== owner) continue;
    roots.add(f.root);
    for (const [pid, created] of f.members) all.set(pid, created);
  }
  return new Set(living(all, table).filter((pid) => !roots.has(pid)));
}

/**
 * Stops everything recorded for `owner` that is still running, each with its own tree, by pid. Returns the pids it
 * stopped. Never rejects; when the process table can't be read it stops nothing.
 */
export async function reap(owner: string): Promise<number[]> {
  const mine = [...running].filter((f) => f.owner === owner);
  const kept = left.get(owner);
  if (mine.length === 0 && !kept) return [];
  const table = await freshTable();
  if (!table) return [];
  const all: Members = new Map(kept);
  if (mine.length > 0) record(table);
  for (const f of mine) for (const [pid, created] of f.members) all.set(pid, created);
  if (kept) absorb(all, table);
  const pids = living(all, table);
  left.delete(owner);
  for (const [desk, whose] of desks) if (whose === owner) desks.delete(desk);
  for (const f of mine) f.members.clear();
  if (pids.length === 0) return [];
  await stop(pids, table);
  return pids;
}

async function stop(pids: number[], table: ProcessTable): Promise<void> {
  if (process.platform === 'win32') {
    // The full path, so a taskkill.exe in the project folder can't stand in for it. /T takes each one's children along.
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    await new Promise<void>((done) => {
      execFile(taskkill, ['/T', '/F', ...pids.flatMap((pid) => ['/pid', String(pid)])], { windowsHide: true, timeout: TASKKILL_MS }, () => done());
    });
  } else {
    // No /T here: add what they started (by parent links now) and stop children before parents.
    const order = [...pids];
    for (let i = 0; i < order.length; i++) {
      for (const [pid, row] of table) if (row.ppid === order[i] && !order.includes(pid) && pid !== process.pid) order.push(pid);
    }
    for (const pid of order.reverse()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone already
      }
    }
  }
  // Whatever taskkill couldn't stop (it fails on a process that ended a moment ago, and on access errors).
  const after = await freshTable();
  if (!after) return;
  for (const pid of living(new Map(pids.map((pid) => [pid, table.get(pid)?.created ?? -1])), after)) {
    try {
      process.kill(pid);
    } catch {
      // gone already
    }
  }
}
