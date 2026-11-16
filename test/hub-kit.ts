// Fakes for everything the hub wires together, so the hub's tests run with no company, switchboard, org tools,
// preview or tailscale of the real kind, and never start Claude Code.
import { defaultSettings } from '../src/core/company-state.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import type {
  Approval, ApprovalAsk, CompanyHandle, CompanyView, DeskControl, DeskView, LobbyCompany, Message, OrgOps, Pause, PersonView, PreviewView, Question,
} from '../src/core/company.ts';
import { OrgRefusal } from '../src/core/company.ts';
import { messagesBefore, NOT_KEPT } from '../src/core/message-pages.ts';
import type { Ack } from '../src/core/steering.ts';
import type { DeskCaller, HubMakers, PermissionVerdict, PolicyOptions, Previews, PreviewsOptions, SwitchboardOptions } from '../src/hub/seams.ts';

export const TOKEN = 'hub-test-token-0123456789abcdefghijklmn';

export function person(id: string, over: Partial<PersonView> = {}): PersonView {
  const desk: DeskView = { person: id, state: 'closed', sessionId: null, since: 0, context: null, problem: null, queue: null };
  return {
    id, name: id === 'ux-designer' ? 'Kai' : id, title: id === 'ux-designer' ? 'UX designer' : id, level: id === 'ceo' ? 'ceo' : 'worker', room: 'design',
    reportsTo: id === 'ceo' ? null : 'ceo', look: {}, model: 'sonnet', desk, task: null, status: null, agentKey: null, cost: 0, ...over,
  };
}

export interface FakeCompany extends CompanyHandle {
  root: string;
  calls: { method: string; args: unknown[] }[];
  closed: boolean;
  /** What view() gives, changed by tests. */
  state: CompanyView;
  /** Every message the company keeps, oldest first, and their acknowledgements: what earlierMessages pages through. */
  kept: { messages: Message[]; acks: Ack[] };
  sessionMap: Map<string, string>;
  /** requestApproval calls waiting for an answer; `signal` is how the hub withdraws one. */
  approvalsAsked: { person: string; ask: ApprovalAsk; signal: AbortSignal | undefined; answer: (a: { decision: 'allow' | 'deny'; always: boolean; note: string | null }) => void }[];
  emit(): void;
}

/** A company the hub can hold: records every call, refuses a few on purpose and keeps what tests put in `state`. */
export function fakeCompany(o: { id: string; root: string; name?: string; prompt?: string; stakeholder?: string; desks?: DeskControl; pause?: Pause | null }): FakeCompany {
  const listeners = new Set<() => void>();
  const calls: FakeCompany['calls'] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  let seq = 0;
  const message = (to: string, text: string, interrupt = false): Message => ({
    id: `m-${++seq}`, from: '@stakeholder', to, text, origin: null, relayOf: null, note: null, at: 1, deliveredAt: null, interrupt,
  });
  const desk = (p: string): DeskView => ({ person: p, state: 'closed', sessionId: null, since: 0, context: null, problem: null, queue: null });
  const refuseUnknown = (p: string) => {
    if (p === 'nobody') throw new OrgRefusal('unknown', 'Nobody called nobody works here.');
    if (p === 'boss') throw new OrgRefusal('not-allowed', 'Only the CEO talks to the board.');
  };
  const question: Question = { id: 'q-1', from: 'ceo', text: 'Which payment?', options: ['TWINT', 'Card'], recommended: 0, taskId: null, askedAt: 1, answer: null, withdrawn: null };
  const approval: Approval = {
    id: 'a-1', person: 'ux-designer', tool: 'Bash', summary: 'Push the work branch', detail: 'git push', kind: 'push', askedAt: 1, expiresAt: 2, alwaysRule: null, answer: null, withdrawn: null,
  };
  const unused = (name: string) => () => {
    throw new Error(`The fake company has no ${name}.`);
  };
  const company: FakeCompany = {
    id: o.id,
    root: o.root,
    calls,
    closed: false,
    sessionMap: new Map(),
    approvalsAsked: [],
    kept: { messages: [], acks: [] },
    state: {
      id: o.id, name: o.name ?? basename(o.root), phase: 'founding', prompt: o.prompt ?? '', stakeholder: o.stakeholder ?? '', branch: null, theme: 'office', rooms: [],
      goal: null, people: [person('ceo'), person('ux-designer')], proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [],
      dashboards: [], screenshots: [], spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: o.pause ?? null,
      settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: ['Bash(npm test)'] }, desks: { working: 0, waiting: 0, max: 8 },
      preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null,
    },
    emit() {
      for (const l of listeners) l();
    },
    people: () => company.state.people,
    view: () => structuredClone(company.state),
    lobbyEntry: (): LobbyCompany => ({
      id: o.id, name: company.state.name, root: o.root, phase: company.state.phase, theme: 'office', people: [], working: company.state.desks.working, waiting: 0,
      needsYou: company.state.inbox, pause: company.state.pause, spend: 0, latest: null, problem: null,
    }),
    noteSpend(spent) {
      record('noteSpend', [...spent]);
    },
    sessions: () => new Map(company.sessionMap),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestApproval(p, ask, signal) {
      record('requestApproval', p, ask);
      return new Promise((answer) => {
        company.approvalsAsked.push({ person: p, ask, signal, answer });
        // A withdrawn approval counts as a no, as the company's own does.
        signal?.addEventListener('abort', () => answer({ decision: 'deny', always: false, note: null }), { once: true });
      });
    },
    async diff(taskId) {
      record('diff', taskId);
      if (taskId !== 't-1') throw new OrgRefusal('unknown', 'There is no task t-9 in this company.');
      return 'diff --git a/menu.html b/menu.html\n+<h1>Menu</h1>\n';
    },
    // Pages through `kept` as the company pages through its state.
    earlierMessages(before, limit) {
      record('earlierMessages', before, limit);
      const page = messagesBefore(company.kept.messages, company.kept.acks, before, limit);
      if (!page) throw new OrgRefusal('unknown', NOT_KEPT);
      return page;
    },
    async close() {
      record('close');
      company.closed = true;
      await o.desks?.closeAll();
    },
    say(to, text, options) {
      // The options only when the route passed some: words the person typed.
      record('say', to, text, ...(options ? [options] : []));
      refuseUnknown(to);
      return message(to, text);
    },
    unsend(id) {
      record('unsend', id);
      if (id === 'm-delivered') throw new OrgRefusal('conflict', 'Kai has read it already.');
      return message('ux-designer', 'taken back');
    },
    stop(p, instruction, options) {
      record('stop', p, instruction, ...(options ? [options] : []));
      refuseUnknown(p);
      return message(p, instruction, true);
    },
    answer(id, input) {
      record('answer', id, input);
      return { ...question, id, answer: { ...input, at: 1, appliesAt: 5001 } };
    },
    decide(id, input) {
      record('decide', id, input);
      return { ...approval, id, answer: { ...input, at: 1, appliesAt: 5001 } };
    },
    undo(id) {
      record('undo', id);
      return { ...question, id };
    },
    answerWithPicks() {
      record('answerWithPicks');
      return [{ ...question, answer: { option: 0, text: '', at: 1, appliesAt: 5001 } }];
    },
    answerBatch(batch) {
      record('answerBatch', batch);
      return { questions: [{ ...question, batch, answer: { option: 0, text: '', at: 1, appliesAt: 5001 } }], approvals: [], left: [] };
    },
    editProposal(proposal) {
      record('editProposal', proposal);
      return proposal === 'broken' ? { ok: false, errors: ['Design has seven people and no team lead.'] } : { ok: false, errors: ['The fake only checks.'] };
    },
    restoreProposal() {
      record('restoreProposal');
      return { company: 'Fake', goal: 'A goal', theme: 'office', rooms: [], people: [], questions: [] };
    },
    start: () => void record('start'),
    pause: () => void record('pause'),
    resume: () => void record('resume'),
    handOver(p) {
      record('handOver', p);
      return { ...desk(p), state: 'away' };
    },
    bringBack(p) {
      record('bringBack', p);
      return { ...desk(p), state: 'idle' };
    },
    updateSettings(input) {
      record('updateSettings', input);
      return { ...company.state.settings, ...(input.maxDesks ? { maxDesks: input.maxDesks } : {}) };
    },
    setPreset(preset, options) {
      record('setPreset', preset, ...(options ? [options] : []));
      return { ...company.state.settings, preset };
    },
    setBudget(change) {
      record('setBudget', change);
      return { ...company.state.settings, budget: { ...company.state.settings.budget, ...change } };
    },
    setModels(change) {
      record('setModels', change);
      return { settings: { ...company.state.settings, models: { ...company.state.settings.models, ...change } }, proposal: null };
    },
    markSeen: (p) => void record('markSeen', p),
    markLooked: () => void record('markLooked'),
    changeOffice(by, change) {
      record('changeOffice', by, change);
      return { ok: true, message: 'Changed the office.', changed: ['.claude/studio.yaml'] };
    },
    removeDashboard(by, dashboard) {
      record('removeDashboard', by, dashboard);
      if (dashboard === 'd-gone') throw new OrgRefusal('unknown', 'That dashboard was taken down already.');
      return { id: dashboard, title: 'Bookings', by: 'ceo', widgets: [], publishedAt: 1 };
    },
    postStatus: unused('postStatus'), report: unused('report'), message: unused('message'), ask: unused('ask'), tasks: unused('tasks'),
    shareScreenshot: unused('shareScreenshot'), assign: unused('assign'), relay: unused('relay'), review: unused('review'),
    libraryCatalogue: unused('libraryCatalogue'), askScoping: unused('askScoping'), proposeOrg: unused('proposeOrg'), askStakeholder: unused('askStakeholder'), setGoal: unused('setGoal'),
    publishDashboard: unused('publishDashboard'), hire: unused('hire'), fire: unused('fire'), move: unused('move'), rehire: unused('rehire'),
  };
  return company;
}

/** A switchboard that only remembers how it was made. */
export function fakeDesks(): DeskControl & { closedAll: boolean } {
  const desks = {
    closedAll: false,
    deliver: () => {},
    stop: () => {},
    withdraw: () => false,
    close: async () => {},
    closeAll: async () => {
      desks.closedAll = true;
    },
    desks: () => [],
    setMaxDesks: () => {},
    setIdleMs: () => {},
    pause: () => {},
    resume: () => {},
  };
  return desks;
}

const STATE = (root: string) => join(root, '.worklings', 'events.jsonl');

export interface Fakes {
  make: HubMakers;
  companies: FakeCompany[];
  switchboards: SwitchboardOptions[];
  created: { id: string | undefined; root: string; prompt: string; stakeholder: string }[];
  opened: string[];
  /** What the approvals policy says next; `throws` makes it fail instead. */
  verdict: { next: PermissionVerdict; throws: boolean };
  /** What the policy was told about each request. */
  classified: PolicyOptions[];
  previews: Previews & { started: string[]; urls: Map<string, string> };
  /** The hub's tailnet: the ports it served on and the ledger it was given, how often it stopped, and each preview port served and stopped. */
  tailnet: { started: number[]; ledgers: (string | undefined)[]; stopped: number; served: number[]; unserved: number[] };
  /** What the hub gave createPreviews. */
  previewOptions: PreviewsOptions | null;
  resolved: (DeskCaller | null)[];
  byRoot(root: string): FakeCompany | undefined;
}

/** Every part the hub needs, as fakes. A created company leaves a line in .worklings/ that openCompany reads back. */
export function fakes(): Fakes {
  const f: Fakes = {
    companies: [], switchboards: [], created: [], opened: [], resolved: [], verdict: { next: { verdict: 'allow' }, throws: false }, classified: [],
    tailnet: { started: [], ledgers: [], stopped: 0, served: [], unserved: [] },
    previewOptions: null,
    previews: {
      started: [],
      urls: new Map(),
      start(id) {
        f.previews.started.push(id);
        f.previews.urls.set(id, 'http://127.0.0.1:5999/');
        return f.previews.view(id);
      },
      async stop(id) {
        f.previews.urls.delete(id);
        return f.previews.view(id);
      },
      view: (id): PreviewView => {
        const url = f.previews.urls.get(id) ?? null;
        return { state: url ? 'up' : 'off', url, command: 'npm run dev', problem: null };
      },
      closeAll: async () => {},
    },
    byRoot: (root) => f.companies.find((c) => c.root.toLowerCase() === root.toLowerCase()),
    make: {
      createCompany(o) {
        f.created.push({ id: o.id, root: o.root, prompt: o.prompt, stakeholder: o.stakeholder });
        const id = o.id ?? 'made-by-the-company';
        mkdirSync(join(o.root, '.worklings'), { recursive: true });
        writeFileSync(STATE(o.root), `${JSON.stringify({ id, name: basename(o.root), prompt: o.prompt })}\n`);
        const company = fakeCompany({ id, root: o.root, prompt: o.prompt, stakeholder: o.stakeholder, desks: o.desks(noEvents, id) });
        f.companies.push(company);
        return company;
      },
      openCompany(o) {
        f.opened.push(o.root);
        if (!existsSync(STATE(o.root))) throw new OrgRefusal('invalid', `There's no company in ${o.root}.`);
        const saved = JSON.parse(readFileSync(STATE(o.root), 'utf8')) as { id: string; name: string; prompt: string; pause?: Pause };
        const company = fakeCompany({ id: saved.id, root: o.root, name: saved.name, prompt: saved.prompt, desks: o.desks(noEvents, saved.id), pause: saved.pause ?? null });
        f.companies.push(company);
        return company;
      },
      companyIdAt(root) {
        try {
          return (JSON.parse(readFileSync(STATE(root), 'utf8')) as { id: string }).id;
        } catch {
          return null;
        }
      },
      orgOps: () => orgOps,
      createSwitchboard(o) {
        f.switchboards.push(o);
        return fakeDesks();
      },
      classifyPermission: (_payload, o) => {
        f.classified.push(o);
        if (f.verdict.throws) throw new Error('The policy broke.');
        return f.verdict.next;
      },
      orgToolsHandler: ({ resolve }) => async (req: IncomingMessage, res: ServerResponse) => {
        const auth = req.headers.authorization ?? '';
        const caller = resolve(auth.slice('Bearer '.length));
        f.resolved.push(caller);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(caller ? { companyId: caller.company.id, person: caller.person, root: caller.root, cwd: caller.cwd } : null));
      },
      createPreviews: (o) => {
        f.previewOptions = o;
        return f.previews;
      },
      async startTailnet({ port, ledger }) {
        f.tailnet.started.push(port);
        f.tailnet.ledgers.push(ledger);
        const host = 'box.tail1234.ts.net';
        return {
          host,
          url: `https://${host}/`,
          stop: () => void (f.tailnet.stopped += 1),
          async serve(local: number) {
            f.tailnet.served.push(local);
            return { host, port: local, url: `https://${host}:${local}/`, stop: async () => void f.tailnet.unserved.push(local) };
          },
        };
      },
    },
  };
  return f;
}

const noEvents = { desk: () => {}, delivered: () => {}, session: () => {}, turn: () => {}, limited: () => {} };

const nope = (name: string) => () => {
  throw new Error(`The fake org flow has no ${name}.`);
};
const orgOps: OrgOps = {
  found: nope('found'), openingTurn: nope('openingTurn'), catalogue: nope('catalogue'), check: nope('check'), write: nope('write'), hire: nope('hire'),
  fire: nope('fire'), move: nope('move'), rehire: nope('rehire'), changeOffice: nope('changeOffice'), model: nope('model'),
};
