// Fakes for the company's tests: an OrgOps that writes real studio.yaml and agent files (so the company reloads its
// people from disk, as it does in the hub), a switchboard that records every turn, and a git that records every call.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeskControl, DeskEvents, DeskPlan, DeskView, OfficeChange, OrgOps, Task, TurnResult } from '../src/core/company.ts';
import { OrgRefusal, STAKEHOLDER } from '../src/core/company.ts';
import type { OrgProposal, ProposedPerson } from '../src/core/org.ts';
import type { ReshapeResult } from '../src/core/snapshot.ts';
import { DEFAULT_PLAN_APPROVAL, type PlanApproval } from '../src/core/steering.ts';
import { parseStudio, serializeStudio, type Studio, type StudioRole } from '../src/core/studio.ts';
import type { CheckRequest, CheckResult } from '../src/company/check-run.ts';
import type { LookRequest, LookResult } from '../src/company/app-look.ts';
import { type Company, createCompany, type GitOps, openCompany } from '../src/company/index.ts';
import { tempDir, writeTree } from './library-kit.ts';

export const KEY = new Uint8Array(32).fill(7);
export { STAKEHOLDER };

const ok = (message: string, changed: string[] = []): ReshapeResult => ({ ok: true, message, changed });

function readStudio(root: string): Studio {
  const parsed = parseStudio(readFileSync(join(root, '.claude', 'studio.yaml'), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.studio;
}

function writeAgent(root: string, id: string, model: string): void {
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', `${id}.md`), `---\nname: ${id}\ndescription: The ${id} of the company.\nmodel: ${model}\n---\nYou are the ${id}.\n`);
}

function writeStudio(root: string, studio: Studio): void {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'studio.yaml'), serializeStudio(studio));
}

const roleOf = (p: ProposedPerson): StudioRole => ({
  id: p.id,
  department: p.room,
  title: p.title,
  name: p.name,
  level: p.level,
  ...(p.reportsTo ? { reportsTo: p.reportsTo } : {}),
  ...(p.look ? { look: p.look } : {}),
});

const isProposal = (raw: unknown): raw is OrgProposal =>
  typeof raw === 'object' && raw !== null && typeof (raw as { company?: unknown }).company === 'string' && Array.isArray((raw as { people?: unknown }).people);

/** An OrgOps that keeps studio.yaml and the agent files on disk and refuses with OrgRefusal, as the real one does. */
export function fakeOrg(): OrgOps & { calls: string[]; openings: Parameters<OrgOps['openingTurn']>[0][]; checks: unknown[] } {
  const calls: string[] = [];
  const openings: Parameters<OrgOps['openingTurn']>[0][] = [];
  const checks: unknown[] = [];
  return {
    calls,
    openings,
    checks,
    found(root, prompt) {
      calls.push(`found:${prompt}`);
      writeStudio(root, {
        version: 1,
        name: 'Pickup Café',
        domain: 'custom',
        rigor: 'lean',
        departments: [{ id: 'direction', name: 'Direction', style: 'direction' }],
        roles: [{ id: 'ceo', department: 'direction', title: 'CEO', name: 'Noor', level: 'ceo' }],
        rules: [],
        gates: [],
        skills: [],
        fired: [],
      });
      writeAgent(root, 'ceo', 'opus');
      return ok('Founded.', ['.claude/studio.yaml', '.claude/agents/ceo.md']);
    },
    openingTurn(input) {
      const { prompt, detected } = input;
      openings.push(input);
      calls.push('openingTurn');
      return `Draft the org for: ${prompt}\nThe folder: ${detected}`;
    },
    catalogue() {
      return [{ id: 'ui-designer', title: 'UI designer', department: 'design', description: 'Shapes the visual system.', model: 'sonnet' }];
    },
    check(raw, options) {
      calls.push(options?.enforceSize === false ? 'check:any-size' : 'check');
      checks.push(options);
      if (!isProposal(raw)) return { ok: false, errors: ['The proposal needs a company name and a list of people.'] };
      // The CEO's proposals are held to a size; the stakeholder's own edits are not.
      if (options?.enforceSize !== false && raw.people.length < 2) return { ok: false, errors: [`An org has 2 to 25 people; this one has ${raw.people.length}.`] };
      return { ok: true, proposal: structuredClone(raw) };
    },
    write(root, proposal) {
      calls.push('write');
      writeStudio(root, {
        version: 1,
        name: proposal.company,
        domain: 'custom',
        rigor: 'standard',
        office: { theme: proposal.theme, rooms: [], decor: [] },
        departments: proposal.rooms.map((r) => ({ id: r.id, name: r.title, style: r.style })),
        roles: proposal.people.map(roleOf),
        rules: [],
        gates: [],
        skills: [],
        fired: [],
      });
      for (const p of proposal.people) writeAgent(root, p.id, p.model);
      return ok('Hired everyone.');
    },
    hire(root, input) {
      const id = input.id ?? input.role;
      calls.push(`hire:${id}`);
      const studio = readStudio(root);
      if (studio.roles.some((r) => r.id === id)) throw new OrgRefusal('conflict', `${id} is on staff already.`);
      studio.roles.push({ id, department: input.room ?? 'engineering', title: input.title ?? input.role, ...(input.name ? { name: input.name } : {}), ...(input.level ? { level: input.level } : {}), ...(input.reportsTo ? { reportsTo: input.reportsTo } : {}) });
      writeStudio(root, studio);
      writeAgent(root, id, 'sonnet');
      return ok(`Hired ${id}.`);
    },
    fire(root, role) {
      calls.push(`fire:${role}`);
      const studio = readStudio(root);
      const gone = studio.roles.find((r) => r.id === role);
      if (!gone) throw new OrgRefusal('unknown', `${role} isn't on staff.`);
      const reports = studio.roles.filter((r) => r.reportsTo === role).map((r) => r.id);
      studio.roles = studio.roles.filter((r) => r.id !== role).map((r) => (r.reportsTo === role ? { ...r, ...(gone.reportsTo ? { reportsTo: gone.reportsTo } : {}) } : r));
      studio.fired.push({
        id: role, department: gone.department, title: gone.title, file: `.claude/fired/${role}.md`,
        ...(gone.name ? { name: gone.name } : {}), ...(gone.level ? { level: gone.level } : {}), ...(gone.reportsTo ? { reportsTo: gone.reportsTo } : {}), ...(reports.length > 0 ? { reports } : {}),
      });
      writeStudio(root, studio);
      return ok(`Fired ${role}.`);
    },
    move(root, input) {
      calls.push(`move:${input.role}`);
      const studio = readStudio(root);
      const role = studio.roles.find((r) => r.id === input.role);
      if (!role) throw new OrgRefusal('unknown', `${input.role} isn't on staff.`);
      role.department = input.room;
      if (input.reportsTo) role.reportsTo = input.reportsTo;
      writeStudio(root, studio);
      return ok(`Moved ${input.role}.`);
    },
    rehire(root, role) {
      calls.push(`rehire:${role}`);
      const studio = readStudio(root);
      const back = studio.fired.find((f) => f.id === role);
      if (!back) throw new OrgRefusal('unknown', `${role} was never fired.`);
      studio.fired = studio.fired.filter((f) => f.id !== role);
      studio.roles.push({ id: back.id, department: back.department, title: back.title, ...(back.name ? { name: back.name } : {}), ...(back.level ? { level: back.level } : {}), ...(back.reportsTo ? { reportsTo: back.reportsTo } : {}) });
      // A manager's people come back to them.
      studio.roles = studio.roles.map((r) => (back.reports?.includes(r.id) ? { ...r, reportsTo: back.id } : r));
      writeStudio(root, studio);
      return ok(`Rehired ${role}.`);
    },
    changeOffice(root, change: OfficeChange) {
      calls.push(`office:${change.change}`);
      const studio = readStudio(root);
      const office = studio.office ?? { theme: 'office', rooms: [], decor: [] };
      if (change.change === 'theme') office.theme = change.theme;
      else if (change.change === 'add-room') office.rooms.push(change.room);
      else if (change.change === 'remove-room') office.rooms = office.rooms.filter((r) => r.id !== change.room);
      else throw new OrgRefusal('invalid', 'This fake changes only the theme and the rooms.');
      studio.office = office;
      writeStudio(root, studio);
      return ok('Changed the office.');
    },
    model(root, input) {
      calls.push(`model:${input.role}:${input.model}`);
      const file = join(root, '.claude', 'agents', `${input.role}.md`);
      if (!existsSync(file)) throw new OrgRefusal('unknown', `${input.role} has no agent file.`);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/^model: .*$/m, `model: ${input.model}`));
      return ok(`${input.role} runs on ${input.model} now.`, [`.claude/agents/${input.role}.md`]);
    },
  };
}

const person = (id: string, name: string, title: string, level: ProposedPerson['level'], room: string, reportsTo: string | null, model: ProposedPerson['model'] = 'sonnet'): ProposedPerson => ({
  id, name, title, level, room, reportsTo, model, owns: `The ${title.toLowerCase()}'s area.`,
});

/** The café's org: a CEO, two heads, a team lead and their people, and the office manager. */
export function proposal(extra: Partial<OrgProposal> = {}): OrgProposal {
  return {
    company: 'Pickup Café',
    goal: 'A bilingual café website with pickup orders.',
    // Declared small so the kit's plans of up to four tasks need no final verification task (the fake org check doesn't hold the people to it).
    size: 'small',
    theme: 'cafe',
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'design', title: 'Design', style: 'design' },
      { id: 'engineering', title: 'Engineering', style: 'engineering' },
    ],
    people: [
      person('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus'),
      person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
      person('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design'),
      person('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design', 'haiku'),
      person('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo'),
      person('frontend-lead', 'Ola', 'Frontend lead', 'lead', 'engineering', 'head-of-engineering'),
      person('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'frontend-lead'),
      person('office-manager', 'Tia', 'Office manager', 'worker', 'direction', 'ceo'),
    ],
    questions: [{ text: 'Which payment provider at pickup?', options: ['Stripe', 'TWINT'], recommended: 1 }],
    ...extra,
  };
}

export interface Turn {
  plan: DeskPlan;
  turn: { text: string; messageId: string | null; priority?: number };
}

/** A turn's end as the switchboard reports it: the words it ended with, and whether it went through. */
export const ended = (text: string, ok = true): TurnResult => ({
  sessionId: '0b7c1d2e-0000-4000-8000-0000000000aa', ok, text, costUsd: 0.01, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, contextTokens: 100, durationMs: 1_000,
  problem: ok ? null : 'Claude Code stopped with an error.',
});

/** A turn's parts: "From <who> (message <id>), between the two <marker> lines:", the marker, the words, the marker. */
export function fenced(t: Turn): { who: string; id: string | null; marker: string; words: string } {
  const lines = t.turn.text.split('\n');
  const head = /^(From .*?)(?: \(message ([\w-]+)\))?, between the two ([A-Za-z0-9]{8,64}) lines:$/.exec(lines[0] ?? '');
  if (!head) throw new Error(`The turn isn't fenced: ${t.turn.text}`);
  const [, who = '', id = null, marker = ''] = head;
  if (t.turn.messageId !== null && id !== t.turn.messageId) throw new Error(`The turn doesn't name its message ${t.turn.messageId}: ${t.turn.text}`);
  // The office's digest of routine reports may follow the closing marker, in a fence of its own.
  const close = lines.indexOf(marker, 2);
  if (lines.length < 4 || lines[1] !== marker || close < 3) throw new Error(`The turn's words aren't between its markers: ${t.turn.text}`);
  return { who, id, marker, words: lines.slice(2, close).join('\n') };
}

/** A switchboard that records what the company asks of it; the test plays its side through `events`. */
export class FakeDesks implements DeskControl {
  readonly events: DeskEvents;
  readonly turns: Turn[] = [];
  readonly stops: Turn[] = [];
  readonly withdrawn: string[] = [];
  readonly closed: string[] = [];
  readonly pauses: (number | null)[] = [];
  resumes = 0;
  maxDesks = 0;
  /** The idle times the company set while it ran, in order. */
  readonly idleTimes: number[] = [];
  closedAll = false;
  views: DeskView[] = [];
  /** What withdraw says: true while a turn still waits for a desk. */
  canWithdraw = true;
  /** Called with each turn as it is handed over, before the company carries on. */
  onTurn: ((t: Turn) => void) | null = null;

  /** The company id the switchboard was made for, as the hub's desk tokens use it. */
  readonly companyId: string;

  constructor(events: DeskEvents, companyId: string) {
    this.events = events;
    this.companyId = companyId;
  }

  deliver(plan: DeskPlan, turn: { text: string; messageId: string | null; priority?: number }): void {
    const t = { plan: structuredClone(plan), turn: { ...turn } };
    this.turns.push(t);
    this.onTurn?.(t);
  }

  stop(plan: DeskPlan, turn: { text: string; messageId: string | null }): void {
    const t = { plan: structuredClone(plan), turn: { ...turn } };
    this.stops.push(t);
    this.onTurn?.(t);
  }

  withdraw(messageId: string): boolean {
    this.withdrawn.push(messageId);
    return this.canWithdraw;
  }

  close(person: string): Promise<void> {
    this.closed.push(person);
    return Promise.resolve();
  }

  closeAll(): Promise<void> {
    this.closedAll = true;
    return Promise.resolve();
  }

  desks(): DeskView[] {
    return this.views.map((v) => ({ ...v }));
  }

  setMaxDesks(n: number): void {
    this.maxDesks = n;
  }

  setIdleMs(ms: number): void {
    this.idleTimes.push(ms);
  }

  pause(until: number | null): void {
    this.pauses.push(until);
  }

  resume(): void {
    this.resumes += 1;
  }

  /**
   * The words of every turn handed to a person, stops included, in order, as "From Ada, head of design: ...". Each turn
   * is checked first: its first line names who it is from and its own message id, its words sit between two lines
   * holding the same marker, and no marker is used twice.
   */
  textsFor(person: string): string[] {
    const all = [...this.turns, ...this.stops];
    const markers = all.map((t) => fenced(t).marker);
    if (new Set(markers).size !== markers.length) throw new Error('A fence marker was used for two turns.');
    return all.filter((t) => t.plan.person.id === person).map((t) => {
      const { who, words } = fenced(t);
      return `${who}: ${words}`;
    });
  }

  /** Says that every turn handed over so far reached its person. */
  deliverAll(at = Date.now()): void {
    for (const t of [...this.turns, ...this.stops]) if (t.turn.messageId) this.events.delivered(t.turn.messageId, at);
  }
}

/**
 * A git that records its calls and answers later, as the real one does. `conflict` makes merges refuse; `fail` makes
 * the named step reject with a sentence; `hold` keeps answers back until `release()`.
 */
export function fakeGit() {
  const held: (() => void)[] = [];
  const git = {
    calls: [] as string[][],
    conflict: false,
    branch: 'worklings/test' as string | null,
    fail: null as string | null,
    hold: false,
    release(): void {
      for (const go of held.splice(0)) go();
    },
    answer<T>(step: string, value: () => T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const go = () => {
          try {
            if (git.fail === step) throw new Error(`Git refused to ${step}: it has no name and email for you.`);
            resolve(value());
          } catch (error) {
            reject(error);
          }
        };
        if (git.hold) held.push(go);
        else go();
      });
    },
    prepareBranch(root: string, companyId: string) {
      git.calls.push(['prepareBranch', root, companyId]);
      return git.answer('prepareBranch', () => (git.branch ? { branch: git.branch, problem: null } : { branch: null, problem: "The folder isn't a git repository." }));
    },
    /** Where the work branch started: a fixed commit, asked for right after prepareBranch (not in `calls`, so call lists stay as they were). */
    branchTip: () => Promise.resolve('ba5e0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70'),
    addWorktree(root: string, companyId: string, taskId: string) {
      git.calls.push(['addWorktree', root, companyId, taskId]);
      return git.answer('addWorktree', () => ({ path: join(root, '..', `worktree-${taskId}`), branch: `worklings/${companyId}--${taskId}` }));
    },
    /** The fifth entry of a call is what the commit had to leave out for other tasks (`strays.except`). */
    commitTask(cwd: string, files: string[], message: string, strays?: { except: string[] }) {
      git.calls.push(['commitTask', cwd, files.join(','), message, strays ? strays.except.join(',') : '(none)']);
      return git.answer('commitTask', () => ({ commit: `c0ffee${git.calls.length}` }));
    },
    mergeWorktree(root: string, worktree: { path: string; branch: string }, message: string) {
      git.calls.push(['mergeWorktree', root, worktree.branch, message]);
      return git.answer('mergeWorktree', () => {
        if (git.conflict) throw new OrgRefusal('conflict', `Merging ${worktree.branch} conflicts in src/menu/Card.tsx; the merge was undone.`);
        return { commit: `bead${git.calls.length}` };
      });
    },
    removeWorktree(root: string, worktree: { path: string; branch: string }) {
      git.calls.push(['removeWorktree', root, worktree.branch]);
      return git.answer('removeWorktree', () => undefined);
    },
    /** The patch git would give; `diff` sets what it holds. */
    diff: '',
    taskDiff(root: string, task: Task) {
      git.calls.push(['taskDiff', root, task.id]);
      return git.answer('taskDiff', () => git.diff);
    },
    /** A cancelled task's work saved on a branch of its own; `nothingChanged` makes a save find nothing to keep. */
    nothingChanged: false,
    saveTaskWork(root: string, companyId: string, taskId: string, files: string[], message: string) {
      git.calls.push(['saveTaskWork', root, taskId, files.join(','), message]);
      return git.answer('saveTaskWork', () => ({ branch: git.nothingChanged ? null : `worklings/${companyId}--${taskId}` }));
    },
    saveWorktree(root: string, worktree: { path: string; branch: string }, message: string) {
      git.calls.push(['saveWorktree', root, worktree.branch, message]);
      return git.answer('saveWorktree', () => ({ branch: git.nothingChanged ? null : worktree.branch }));
    },
  };
  return git satisfies GitOps;
}

/**
 * The checks the office runs itself (v0.2), faked: every one is recorded and answered by `answer`, which passes unless a
 * test says otherwise. A test never reaches the real runner, which would start `npm test` in a temp folder.
 */
export interface FakeChecks {
  calls: CheckRequest[];
  answer: (request: CheckRequest) => CheckResult | Promise<CheckResult>;
}

/**
 * The office's look at the running app (v0.3), faked the same way: recorded, and answered by `answer`, which skips (not a
 * web app) unless a test says otherwise. A test never reaches the real one, which would start the app and a browser.
 */
export interface FakeLooks {
  calls: LookRequest[];
  answer: (request: LookRequest) => LookResult | Promise<LookResult>;
}

export interface Rig {
  root: string;
  company: Company;
  checks: FakeChecks;
  looks: FakeLooks;
  org: ReturnType<typeof fakeOrg>;
  git: ReturnType<typeof fakeGit>;
  /** The switchboards made so far: one per open, the newest last. */
  boards: FakeDesks[];
  desks: () => FakeDesks;
  warnings: string[];
  /** Opens the company again in `root` (after a close, or in a copy of the folder for a crash). */
  reopen: (root?: string) => Company;
}

/** A small project folder: a package.json and a source file. */
export function newProject(): string {
  return writeTree(tempDir('worklings-company-'), {
    'package.json': { name: 'pickup-cafe', private: true, scripts: { dev: 'vite', test: 'vitest run' }, dependencies: { react: '^19.0.0' } },
    'src/app.ts': 'export const app = 1;\n',
  });
}

/**
 * A new company with fakes on every side. `running` proposes the café's org, starts it and waits for git; `board` is the
 * switchboard's class, FakeDesks or one that plays more of the real one's part. `planApproval` is off unless a test
 * says otherwise: the free flow (assign, review) is what plan approval off keeps, and steering's tests choose theirs.
 */
export async function rig(o: { running?: boolean; now?: () => number; id?: string; prompt?: string; board?: typeof FakeDesks; planApproval?: PlanApproval; env?: Record<string, string | undefined>; org?: Partial<OrgProposal> } = {}): Promise<Rig> {
  const root = newProject();
  const org = fakeOrg();
  const git = fakeGit();
  const boards: FakeDesks[] = [];
  const warnings: string[] = [];
  const Board = o.board ?? FakeDesks;
  const checks: FakeChecks = { calls: [], answer: () => ({ state: 'passed', tail: '' }) };
  const looks: FakeLooks = { calls: [], answer: () => ({ state: 'skipped', note: 'Not a web app the office can open.', shots: [], errors: [], walks: [] }) };
  const deps = {
    lookApp: async (request: LookRequest): Promise<LookResult> => {
      looks.calls.push(request);
      return looks.answer(request);
    },
    runCheck: async (request: CheckRequest): Promise<CheckResult> => {
      checks.calls.push(request);
      return checks.answer(request);
    },
    key: KEY,
    org,
    git,
    desks: (events: DeskEvents, companyId: string) => {
      const board = new Board(events, companyId);
      boards.push(board);
      return board;
    },
    warn: (message: string) => warnings.push(message),
    ...(o.now ? { now: o.now } : {}),
    // Without one the company reads no ANTHROPIC_MODEL, whatever the machine running the tests has set.
    env: o.env ?? {},
  };
  const company = createCompany({
    ...deps,
    root,
    prompt: o.prompt ?? 'A bilingual café website with pickup orders.',
    stakeholder: 'Robin',
    ...(o.id ? { id: o.id } : {}),
  });
  const approval = o.planApproval ?? 'off';
  if (approval !== DEFAULT_PLAN_APPROVAL) company.changeSettings(STAKEHOLDER, { planApproval: approval, cites: [] });
  const desks = () => {
    const board = boards[boards.length - 1];
    if (!board) throw new Error('No switchboard yet.');
    return board;
  };
  if (o.running) {
    const proposed = company.proposeOrg('ceo', proposal(o.org));
    if (!proposed.ok) throw new Error(proposed.errors.join('; '));
    company.start();
    await company.idle();
  }
  return { root, company, checks, looks, org, git, boards, desks, warnings, reopen: (at = root) => openCompany({ ...deps, root: at }) };
}

/** A copy of the project folder as it is on disk this moment: what a crash would leave behind. */
export function crashCopy(root: string): string {
  const copy = join(tempDir('worklings-crash-'), 'project');
  cpSync(root, copy, { recursive: true });
  return copy;
}

export const eventsFile = (root: string): string => join(root, '.worklings', 'events.jsonl');
export const logText = (root: string): string => (existsSync(eventsFile(root)) ? readFileSync(eventsFile(root), 'utf8') : '');

/** A tiny valid PNG (1 by 1 pixel). */
export const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
