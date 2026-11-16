// The switchboard's front door (docs/architecture.md, "Seams between the streams"): the hub makes one per company with
// createSwitchboard and the company drives it through DeskControl. classifyPermission (./approvals.ts) is the
// approvals policy the hub applies to each desk's PermissionRequest.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DeskControl, DeskEvents } from '../core/company.ts';
import type { ClaudeLookup } from '../server/claude.ts';
import { claudeCode, type Harness } from './harness.ts';
import { type DeskGate, type HubLink, Switchboard, type SwitchboardTiming } from './switchboard.ts';

export { classifyPermission, permissionAnswer, type PermissionVerdict, type PolicyOptions, stopsByPid } from './approvals.ts';
export { startedBy } from './descendants.ts';
export { claudeCode, type Harness, HarnessError, type HarnessPlan, type HarnessProcess, SCRATCH_PATH_MARK, sweepLeakedDesks } from './harness.ts';
export { ASK_LIST_RULES, DEFAULT_MAX_OPEN, DEFAULT_TIMING, DELIVERY_RULES, type DeskGate, type HubLink, type SwitchboardTiming } from './switchboard.ts';

export interface CreateSwitchboardOptions {
  companyId: string;
  /** The company's project folder. */
  root: string;
  hub: HubLink;
  events: DeskEvents;
  /** The company's cap on people working at once. */
  maxDesks: number;
  /** Desks the company keeps open at once, idle ones included (DEFAULT_MAX_OPEN); never fewer than maxDesks. */
  maxOpen?: number;
  /** An open desk with nothing to do closes after this long. */
  idleMs: number;
  /** The hub's cap across all its companies. */
  gate?: DeskGate;
  /** The environment desks start from; process.env when not given. */
  env?: NodeJS.ProcessEnv;
  /** Claude Code's executable (a full path, as WORKLINGS_CLAUDE takes it), or a finished lookup. */
  claude?: string | ClaudeLookup;
  now?: () => number;
  /** The company's Always allow rules, put in each desk's settings when it opens. */
  rules?: () => readonly string[];
  /** For tests: shorter waits than the defaults. */
  timing?: Partial<SwitchboardTiming>;
  /** Where each desk's temporary folder goes; the system's temporary folder by default. Never inside the project. */
  scratch?: string;
  /** Another harness than Claude Code. */
  harness?: Harness;
}

export function createSwitchboard(o: CreateSwitchboardOptions): DeskControl {
  if (o.scratch !== undefined) {
    const rel = relative(resolve(o.root), resolve(o.scratch));
    if (rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
      throw new Error(`The desks' temporary folders can't go in the project (${o.scratch}): their settings would be part of it.`);
    }
  }
  const harness = o.harness ?? claudeCode({ ...(o.env ? { env: o.env } : {}), ...(o.claude ? { claude: o.claude } : {}), ...(o.scratch ? { scratch: o.scratch } : {}) });
  const board = new Switchboard({
    companyId: o.companyId,
    root: o.root,
    hub: o.hub,
    events: o.events,
    maxDesks: o.maxDesks,
    ...(o.maxOpen !== undefined ? { maxOpen: o.maxOpen } : {}),
    idleMs: o.idleMs,
    harness,
    ...(o.gate ? { gate: o.gate } : {}),
    ...(o.now ? { now: o.now } : {}),
    ...(o.rules ? { rules: o.rules } : {}),
    ...(o.timing ? { timing: o.timing } : {}),
  });
  return {
    deliver: (plan, turn) => board.deliver(plan, turn),
    stop: (plan, turn) => board.stop(plan, turn),
    withdraw: (messageId) => board.withdraw(messageId),
    close: (person) => board.close(person),
    closeAll: () => board.closeAll(),
    desks: () => board.desks(),
    setMaxDesks: (n) => board.setMaxDesks(n),
    setIdleMs: (ms) => board.setIdleMs(ms),
    pause: (until) => board.pause(until),
    resume: () => board.resume(),
  };
}
