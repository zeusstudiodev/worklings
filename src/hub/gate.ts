// The hub's two caps across every company (each company has its own too). People working at once is the usage limit:
// a switchboard takes a working slot when a turn starts on a desk and gives it back when the desk is idle again. Open
// desks, idle ones included, is a matter of memory, a higher cap: a switchboard takes a process slot before it opens a
// desk and gives it back when the desk closes. An idle desk keeps its process, and so its warm conversation, for the
// person's next turn. Only when people wait for a process at the cap is the longest-idle desk of any company asked to
// make way, one per person waiting; a freed slot goes to the waiting companies in turn, so one company can't keep the
// others waiting.
import { DEFAULT_MAX_DESKS } from '../core/company.ts';
import type { DeskGate } from './seams.ts';

/** The most people the hub's setting lets work at once. */
export const MAX_HUB_DESKS = 50;
/** How many desks the hub keeps open at once, idle ones included, when the working cap is lower (a company and a half). */
export const HUB_OPEN_DESKS = 16;
/** The most desks the hub holds open whatever the working cap. */
const HUB_OPEN_LIMIT = 60;
/** The open-desk cap the hub uses for a working cap: never below it. */
export const hubOpenCap = (working: number): number => Math.min(HUB_OPEN_LIMIT, Math.max(working, HUB_OPEN_DESKS));

/** What a switchboard offers when people wait at the gate (src/runtime/switchboard.ts, DeskYielder). */
interface DeskYielder {
  /** When its longest-idle desk went idle, or null when it has none. */
  idleSince(): number | null;
  /** Closes that desk so its slot comes back; false when it had none to give. */
  yieldOne(): boolean;
}

/**
 * A switchboard's key is its company's id, then `#` and the switchboard's generation (`acme#3`); a plain id (a test's)
 * is its own company.
 */
const companyOf = (key: string): string => {
  const at = key.indexOf('#');
  return at === -1 ? key : key.slice(0, at);
};

export class HubGate implements DeskGate {
  /** People working at once. */
  private limit: number;
  /** Open desks at once; the working cap itself unless a rule (hubOpenCap) says more. */
  private openLimit: number;
  private readonly openFor: (working: number) => number;
  /**
   * Slots held, by switchboard key. A company closed and reopened gets a new switchboard and so a new key: a late exit
   * of the closed one gives back under its old key, which holds nothing any more, and can't free the reopened one's.
   */
  private readonly held = new Map<string, number>();
  /** Working slots held, by switchboard key. */
  private readonly heldWork = new Map<string, number>();
  /** People waiting at the gate, by switchboard key. */
  private readonly wants = new Map<string, number>();
  private readonly listeners: (() => void)[] = [];
  private readonly yielders = new Set<DeskYielder>();
  /** Desks asked to make way whose slots haven't come back yet, so one wait doesn't close every idle desk. */
  private yielding = 0;
  /** Which listener hears of a freed desk first: it moves on each time, so waiting companies take turns. */
  private turn = 0;
  private used = 0;
  private usedWork = 0;

  constructor(max = DEFAULT_MAX_DESKS, o: { open?: (working: number) => number } = {}) {
    this.limit = max;
    this.openFor = o.open ?? ((working) => working);
    this.openLimit = Math.max(max, this.openFor(max));
  }

  /** People working at once, across companies. */
  get max(): number {
    return this.limit;
  }

  /** Desks open across companies, idle and closing ones included. */
  get inUse(): number {
    return this.used;
  }

  /** How many open desks the hub allows. */
  get openMax(): number {
    return this.openLimit;
  }

  /** People at work now, across companies. */
  get working(): number {
    return this.usedWork;
  }

  /** A process slot for a desk about to open; with `working`, a working slot for its person too, both or neither. */
  take(key: string, working = false): boolean {
    if (this.used >= this.openLimit || (working && this.usedWork >= this.limit)) return false;
    this.used += 1;
    this.held.set(key, (this.held.get(key) ?? 0) + 1);
    if (working) this.holdWork(key);
    return true;
  }

  hasWork(): boolean {
    return this.usedWork < this.limit;
  }

  /** A working slot for a desk that is open already, when a turn comes for it. */
  takeWork(key: string): boolean {
    if (this.usedWork >= this.limit) return false;
    this.holdWork(key);
    return true;
  }

  giveWork(key: string): void {
    const held = this.heldWork.get(key) ?? 0;
    // Given back twice, or late by a closed company's earlier switchboard: it must not free someone else's.
    if (held === 0) return;
    if (held === 1) this.heldWork.delete(key);
    else this.heldWork.set(key, held - 1);
    this.usedWork -= 1;
    this.freed(0);
  }

  private holdWork(key: string): void {
    this.usedWork += 1;
    this.heldWork.set(key, (this.heldWork.get(key) ?? 0) + 1);
  }

  give(key: string): void {
    const held = this.held.get(key) ?? 0;
    // A desk given back twice, or late by a closed company's earlier switchboard, must not free someone else's.
    if (held === 0) return;
    if (held === 1) this.held.delete(key);
    else this.held.set(key, held - 1);
    this.used -= 1;
    this.freed(1);
  }

  /** Everything a company still held, under every key it had, given back when it closes or leaves the lobby. */
  release(companyId: string): void {
    let freed = 0;
    let freedWork = 0;
    for (const [key, held] of [...this.held]) {
      if (companyOf(key) !== companyId) continue;
      this.held.delete(key);
      freed += held;
    }
    for (const [key, held] of [...this.heldWork]) {
      if (companyOf(key) !== companyId) continue;
      this.heldWork.delete(key);
      freedWork += held;
    }
    for (const key of [...this.wants.keys()]) if (companyOf(key) === companyId) this.wants.delete(key);
    if (freed === 0 && freedWork === 0) return;
    this.used -= freed;
    this.usedWork -= freedWork;
    this.freed(freed);
  }

  setMax(n: number): void {
    const grew = n > this.limit;
    this.limit = n;
    this.openLimit = Math.max(n, this.openFor(n));
    if (grew) this.freed(0);
  }

  onFree(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const at = this.listeners.indexOf(listener);
      if (at !== -1) this.listeners.splice(at, 1);
    };
  }

  /** How many of a switchboard's people wait at the gate; while some do and no desk is free, idle desks make way. */
  want(key: string, count: number): void {
    if (count > 0) this.wants.set(key, count);
    else this.wants.delete(key);
    if (count > 0) this.reclaim();
  }

  onWant(yielder: DeskYielder): () => void {
    this.yielders.add(yielder);
    return () => this.yielders.delete(yielder);
  }

  /** Asks the longest-idle desk of any company to make way, one per person waiting beyond the free and coming desks. */
  private reclaim(): void {
    let waiting = 0;
    for (const n of this.wants.values()) waiting += n;
    if (waiting === 0) {
      this.yielding = 0;
      return;
    }
    let need = waiting - Math.max(0, this.openLimit - this.used) - this.yielding;
    const spent = new Set<DeskYielder>();
    while (need > 0) {
      let pick: DeskYielder | null = null;
      let since = Number.POSITIVE_INFINITY;
      for (const yielder of this.yielders) {
        if (spent.has(yielder)) continue;
        const at = yielder.idleSince();
        if (at !== null && at < since) {
          since = at;
          pick = yielder;
        }
      }
      if (pick === null) return; // nobody has an idle desk: the waiting wait for a desk to finish
      if (pick.yieldOne()) {
        this.yielding += 1;
        need -= 1;
      } else {
        spent.add(pick);
      }
    }
  }

  /**
   * Told after the current call returns, so a switchboard that gives a desk back isn't re-entered mid-call. Each time a
   * different listener hears first, so the company that takes a freed desk rotates.
   */
  private freed(count: number): void {
    this.yielding = Math.max(0, this.yielding - count);
    queueMicrotask(() => {
      const n = this.listeners.length;
      if (n === 0) return;
      const start = this.turn % n;
      this.turn = (this.turn + 1) % n;
      for (const listener of [...this.listeners.slice(start), ...this.listeners.slice(0, start)]) {
        try {
          listener();
        } catch (error) {
          process.stderr.write(`worklings: a switchboard failed to take a free desk: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    });
  }
}
