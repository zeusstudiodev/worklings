// The org tools' test kit: a fake company that keeps what the tools ask of it and answers like the real one, with the
// org rules of company.ts, and office(), which puts it behind the MCP handler with a desk for every person. The tests
// call tools the way a desk does (tools/call on MCP 2026-07-28).
import { defaultSettings } from '../src/core/company-state.ts';
import { createServer, type Server } from 'node:http';
import {
  type AskInput,
  type AssignInput,
  type CatalogueEntry,
  type CompanyApi,
  type CompanyView,
  type Goal,
  type HireInput,
  mayAssign,
  mayMessage,
  type Message,
  type OfficeChange,
  OrgRefusal,
  type Person,
  type PersonView,
  peopleOf,
  personById,
  type Question,
  type Report,
  type Screenshot,
  STAKEHOLDER,
  type StatusLine,
  type Task,
  type TaskStatus,
  THE_OFFICE,
} from '../src/core/company.ts';
import { checkDashboard, type Dashboard } from '../src/core/dashboard.ts';
import type { OrgProposal } from '../src/core/org.ts';
import type { ReshapeResult } from '../src/core/snapshot.ts';
import type { Studio, StudioRole } from '../src/core/studio.ts';
import { MODERN, type OrgDesk, orgToolsHandler } from '../src/orgtools/index.ts';
import { tempDir } from './library-kit.ts';

export const NOW = 1_700_000_000_000;
export const role = (id: string, department: string, title: string, extra: Partial<StudioRole> = {}): StudioRole => ({ id, department, title, ...extra });
export const STUDIO: Studio = {
  version: 1,
  name: 'Pickup Café',
  domain: 'website',
  rigor: 'standard',
  departments: [
    { id: 'direction', name: 'Direction', style: 'direction' },
    { id: 'design', name: 'Design', style: 'design' },
    { id: 'engineering', name: 'Engineering', style: 'engineering' },
  ],
  roles: [
    role('ceo', 'direction', 'CEO', { name: 'Noor' }),
    role('head-of-design', 'design', 'Head of design', { name: 'Ada', level: 'head', reportsTo: 'ceo' }),
    role('ui-designer', 'design', 'UI designer', { name: 'Kai', reportsTo: 'head-of-design' }),
    role('ux-designer', 'design', 'UX designer', { name: 'Lea', reportsTo: 'head-of-design' }),
    role('head-of-engineering', 'engineering', 'Head of engineering', { name: 'Ben', level: 'head', reportsTo: 'ceo' }),
    role('frontend-lead', 'engineering', 'Frontend lead', { name: 'Ola', level: 'lead', reportsTo: 'head-of-engineering' }),
    role('frontend-engineer', 'engineering', 'Frontend engineer', { name: 'Sam', reportsTo: 'frontend-lead' }),
    role('qa-engineer', 'engineering', 'QA engineer', { reportsTo: 'head-of-engineering' }),
    role('office-manager', 'direction', 'Office manager', { name: 'Tia', reportsTo: 'ceo' }),
  ],
  rules: [],
  gates: [],
  skills: [],
  fired: [],
};

export const task = (id: string, owner: string, title: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  brief: `Brief for ${title}.`,
  owner,
  askedBy: 'head-of-design',
  files: [],
  doneWhen: 'It works on a phone.',
  status,
  outcome: null,
  parent: null,
  milestone: null,
  worktree: null,
  commit: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

export const CATALOGUE: CatalogueEntry[] = [
  { id: 'copywriter', title: 'Copywriter', department: 'content', description: 'Writes the words people read: pages, buttons, emails and errors, in the brand voice.', model: 'sonnet' },
  { id: 'seo-specialist', title: 'SEO specialist', department: 'content', description: 'Gets the site found: search intent, structure, metadata and local listings.', model: 'haiku' },
];

export const PROPOSAL: OrgProposal = { company: 'Pickup Café', goal: 'Pickup orders online.', theme: 'cafe', rooms: [], people: [], questions: [] };

/** A company that keeps what the org tools ask of it and answers like the real one, with the org rules of company.ts. */
export class FakeCompany implements CompanyApi {
  readonly id = 'pickup-cafe';
  readonly calls: { method: string; by: string; input: unknown }[] = [];
  readonly staff: Person[] = peopleOf(STUDIO);
  readonly taskList: Task[] = [
    task('t-1', 'ui-designer', 'Build the streak card', 'working', { files: ['web/src/streak/'] }),
    task('t-2', 'ux-designer', 'Map the pickup flow', 'queued'),
    task('t-3', 'frontend-engineer', 'Set up the build', 'done', { askedBy: 'frontend-lead', outcome: 'The build runs in CI.' }),
  ];
  readonly messages: Message[] = [
    { id: 'm-1', from: STAKEHOLDER, to: 'ceo', text: 'Make the palette darker.', origin: null, relayOf: null, note: null, at: NOW + 1, deliveredAt: NOW + 2, interrupt: false },
    { id: 'm-2', from: 'ceo', to: 'head-of-design', text: 'Make the palette darker.', origin: STAKEHOLDER, relayOf: 'm-1', note: 'For the whole app.', at: NOW + 3, deliveredAt: NOW + 4, interrupt: false },
    // The office's own notice is nobody's message to pass on.
    { id: 'm-3', from: THE_OFFICE, to: 'head-of-engineering', text: 'You were stopped.', origin: null, relayOf: null, note: null, at: NOW + 5, deliveredAt: NOW + 6, interrupt: false },
  ];
  readonly dashboards: Dashboard[] = [];
  /** Thrown by the next call, as the real company would on a bug or a full disk. */
  fail: Error | null = null;
  /** What hire, fire, move, rehire and changeOffice answer. */
  reshapeAnswer: ReshapeResult | null = null;

  protected record(method: string, by: string, input: unknown) {
    this.calls.push({ method, by, input });
    if (this.fail) throw this.fail;
  }
  protected newMessage(from: string, to: string, text: string, relayOf: string | null = null, note: string | null = null): Message {
    const m: Message = { id: `m-${this.messages.length + 1}`, from, to, text, origin: null, relayOf, note, at: NOW + 10, deliveredAt: null, interrupt: false };
    this.messages.push(m);
    return m;
  }
  private question(from: string, input: Omit<AskInput, 'to'>): Question {
    return { id: 'q-1', from, text: input.text, options: input.options, recommended: input.recommended, taskId: input.taskId, askedAt: NOW, answer: null, withdrawn: null };
  }
  private reshaped(message: string): ReshapeResult {
    return this.reshapeAnswer ?? { ok: true, message, changed: ['.claude/studio.yaml'] };
  }
  protected findTask(id: string): Task {
    const found = this.taskList.find((t) => t.id === id);
    if (!found) throw new OrgRefusal('unknown', `There is no task ${id}.`);
    return found;
  }

  people(): Person[] {
    return this.staff;
  }
  view(): CompanyView {
    const people: PersonView[] = this.staff.map((p) => {
      const own = this.taskList.find((t) => t.owner === p.id && t.status === 'working');
      const status: StatusLine | null = p.id === 'ui-designer' ? { person: p.id, text: 'Wiring the card to the API.', taskId: 't-1', at: NOW } : null;
      return {
        ...p,
        model: 'sonnet',
        desk: { person: p.id, state: p.id === 'ui-designer' ? 'working' : 'closed', sessionId: null, since: NOW, context: null, problem: null, queue: null },
        task: own?.id ?? null,
        status,
        agentKey: null,
        cost: 0,
      };
    });
    return {
      id: this.id,
      name: 'Pickup Café',
      phase: 'running',
      prompt: 'A café site with pickup orders.',
      stakeholder: 'Robin',
      branch: 'worklings/pickup-cafe',
      theme: 'cafe',
      rooms: [{ id: 'meeting', title: 'Meeting room', kind: 'meeting' }],
      goal: { text: 'Take pickup orders online by spring.', milestones: [], setAt: NOW },
      people,
      proposal: null,
      tasks: this.taskList,
      messages: this.messages,
      questions: [],
      approvals: [],
      statuses: [],
      reports: [],
      dashboards: this.dashboards,
      screenshots: [],
      spend: { samples: [], hourly: [], byPerson: [] },
      log: [],
      pause: null,
      settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] },
      desks: { working: 1, waiting: 0, max: 8 },
      preview: { state: 'off', url: null, command: null, problem: null },
      inbox: 0,
      seen: {},
      proposalEdited: false,
      problem: null,
    };
  }

  /** `cites` as the steering streams add them to CompanyApi: recorded when a call passes some. */
  postStatus(by: string, text: string, taskId: string | null, cites?: string[]): StatusLine {
    this.record('postStatus', by, { text, taskId, ...(cites ? { cites } : {}) });
    return { person: by, text, taskId, at: NOW };
  }
  report(by: string, input: { taskId: string | null; outcome: Report['outcome']; text: string }): Report {
    this.record('report', by, input);
    if (input.taskId !== null) {
      const t = this.findTask(input.taskId);
      if (input.outcome === 'done') t.status = 'review';
      if (input.outcome === 'blocked') t.status = 'blocked';
    }
    return { id: 'r-1', person: by, to: personById(this.staff, by)?.reportsTo ?? STAKEHOLDER, taskId: input.taskId, outcome: input.outcome, text: input.text, at: NOW };
  }
  message(by: string, to: string, text: string): Message {
    this.record('message', by, { to, text });
    if (!mayMessage(this.staff, by, to)) throw new OrgRefusal('not-allowed', 'You can reach that team only through your manager.');
    return this.newMessage(by, to, text);
  }
  ask(by: string, input: AskInput): Question | Message {
    this.record('ask', by, input);
    if (input.to === 'stakeholder') return this.question(by, input);
    const manager = personById(this.staff, by)?.reportsTo;
    if (!manager) throw new OrgRefusal('unknown', 'You have no manager to ask.');
    return this.newMessage(by, manager, input.text);
  }
  tasks(by: string, filter: { owner?: string; status?: TaskStatus }): Task[] {
    this.record('tasks', by, filter);
    return this.taskList.filter((t) => (filter.owner === undefined || t.owner === filter.owner) && (filter.status === undefined || t.status === filter.status));
  }
  shareScreenshot(by: string, input: { png: Uint8Array; caption: string }): Screenshot {
    this.record('shareScreenshot', by, input);
    return { id: 's-1', person: by, caption: input.caption, at: NOW };
  }
  assign(by: string, input: AssignInput): Task {
    this.record('assign', by, input);
    if (!mayAssign(this.staff, by, input.to)) throw new OrgRefusal('not-allowed', `${input.to} isn't one of your people; assign work to the people below you.`);
    const id = `t-${this.taskList.length + 1}`;
    const t = task(id, input.to, input.title, 'queued', {
      brief: input.brief,
      askedBy: by,
      files: input.files,
      doneWhen: input.doneWhen,
      parent: input.parent,
      milestone: input.milestone,
      worktree: input.worktree ? { path: '/tmp/worktrees/x', branch: `worklings/${id}` } : null,
    });
    this.taskList.push(t);
    return t;
  }
  relay(by: string, input: { message: string; to: string[]; note: string | null }): Message[] {
    this.record('relay', by, input);
    const original = this.messages.find((m) => m.id === input.message);
    if (!original) throw new OrgRefusal('unknown', `There is no message ${input.message}.`);
    return input.to.map((to) => this.newMessage(by, to, original.text, input.message, input.note));
  }
  review(by: string, input: { taskId: string; verdict: 'accept' | 'return'; note: string }): Task {
    this.record('review', by, input);
    const t = this.findTask(input.taskId);
    t.status = input.verdict === 'accept' ? 'done' : 'working';
    return t;
  }
  libraryCatalogue(by: string): CatalogueEntry[] {
    this.record('libraryCatalogue', by, null);
    return CATALOGUE;
  }
  proposeOrg(by: string, proposal: unknown): { ok: true; proposal: OrgProposal } | { ok: false; errors: string[] } {
    this.record('proposeOrg', by, proposal);
    const people = typeof proposal === 'object' && proposal !== null && 'people' in proposal ? proposal.people : null;
    if (!Array.isArray(people) || people.length < 2) return { ok: false, errors: [`An org has at least 2 people; this one has ${Array.isArray(people) ? people.length : 0}.`, 'design needs a head.'] };
    return { ok: true, proposal: { ...PROPOSAL, people: Array.from({ length: people.length }, () => ({ id: 'x', name: 'X', title: 'X', level: 'worker', room: 'design', reportsTo: 'ceo', model: 'sonnet', owns: 'x' })), questions: [{ text: 'Which payment?', options: ['TWINT', 'Card'] }] } };
  }
  askStakeholder(by: string, input: Omit<AskInput, 'to'>): Question {
    this.record('askStakeholder', by, input);
    return this.question(by, input);
  }
  askScoping(by: string, questions: unknown): Question[] {
    this.record('askScoping', by, questions);
    const list = Array.isArray(questions) ? (questions as { text: string; options: string[]; recommended: number | null }[]) : [];
    if (list.length > 5) throw new OrgRefusal('invalid', 'The questions need changes:\n- questions: expected 1 to 5 questions, got 6');
    return list.map((q) => this.question(by, { text: q.text, options: q.options, recommended: q.recommended, taskId: null }));
  }
  setGoal(by: string, input: { text: string; milestones: { title: string; doneWhen: string }[] }): Goal {
    this.record('setGoal', by, input);
    return { text: input.text, milestones: input.milestones.map((m, i) => ({ id: `m-${i + 1}`, title: m.title, doneWhen: m.doneWhen, doneAt: null })), setAt: NOW };
  }
  publishDashboard(by: string, dashboard: unknown): { ok: true; dashboard: Dashboard } | { ok: false; error: string } {
    this.record('publishDashboard', by, dashboard);
    const checked = checkDashboard(dashboard);
    if (!checked.ok) return checked;
    const published: Dashboard = { id: `d-${this.dashboards.length + 1}`, by, publishedAt: NOW, ...checked.dashboard };
    this.dashboards.push(published);
    return { ok: true, dashboard: published };
  }
  removeDashboard(by: string, id: string): Dashboard {
    this.record('removeDashboard', by, id);
    const at = this.dashboards.findIndex((d) => d.id === id);
    const [removed] = at === -1 ? [] : this.dashboards.splice(at, 1);
    if (!removed) throw new OrgRefusal('unknown', `There is no published dashboard ${id}.`);
    return removed;
  }
  hire(by: string, input: HireInput): ReshapeResult {
    this.record('hire', by, input);
    return this.reshaped(`Hired ${input.name ?? 'the role'}, ${input.title ?? input.role}.`);
  }
  fire(by: string, roleId: string): ReshapeResult {
    this.record('fire', by, roleId);
    return this.reshaped(`Fired the ${roleId}. Rehire brings them back.`);
  }
  move(by: string, input: { role: string; room: string; reportsTo: string | null }): ReshapeResult {
    this.record('move', by, input);
    return this.reshaped(`Moved the ${input.role} to ${input.room}.`);
  }
  rehire(by: string, roleId: string): ReshapeResult {
    this.record('rehire', by, roleId);
    return this.reshaped(`Rehired the ${roleId}.`);
  }
  changeOffice(by: string, change: OfficeChange): ReshapeResult {
    this.record('changeOffice', by, change);
    return this.reshaped('Changed the office.');
  }

  // The stakeholder's side: the org tools never call these.
  say(): never {
    throw new Error('not an org tool');
  }
  unsend(): never {
    throw new Error('not an org tool');
  }
  stop(): never {
    throw new Error('not an org tool');
  }
  answer(): never {
    throw new Error('not an org tool');
  }
  decide(): never {
    throw new Error('not an org tool');
  }
  undo(): never {
    throw new Error('not an org tool');
  }
  answerWithPicks(): never {
    throw new Error('not an org tool');
  }
  editProposal(): never {
    throw new Error('not an org tool');
  }
  restoreProposal(): never {
    throw new Error('not an org tool');
  }
  start(): never {
    throw new Error('not an org tool');
  }
  pause(): never {
    throw new Error('not an org tool');
  }
  resume(): never {
    throw new Error('not an org tool');
  }
  handOver(): never {
    throw new Error('not an org tool');
  }
  bringBack(): never {
    throw new Error('not an org tool');
  }
  updateSettings(): never {
    throw new Error('not an org tool');
  }
  setPreset(): never {
    throw new Error('not an org tool');
  }
  setBudget(): never {
    throw new Error('not an org tool');
  }
  setModels(): never {
    throw new Error('not an org tool');
  }
  markSeen(): never {
    throw new Error('not an org tool');
  }
  markLooked(): never {
    throw new Error('not an org tool');
  }
}

export const tokenOf = (person: string) => `desk-${person}-0123456789abcdefghij`;
const servers: Server[] = [];
/** Closes the test servers office() opened: call it after each test. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
}

export interface Office<C extends FakeCompany = FakeCompany> {
  company: C;
  logs: string[];
  root: string;
  /** Calls a tool as a person's desk and gives back the tool's answer. */
  call(person: string, tool: string, args?: unknown): Promise<{ text: string; isError: boolean }>;
  list(person: string): Promise<string[]>;
  /** A tool as tools/list shows it to a person. */
  listed(person: string, tool: string): Promise<Record<string, unknown>>;
  /** What server/discover tells a person's desk the org tools are for. */
  instructions(person: string): Promise<string>;
}

/** A fake company behind the handler, every person with a desk (and "gone", someone who has left). */
export async function office(o?: { root?: string; cwd?: string }): Promise<Office>;
export async function office<C extends FakeCompany>(o: { root?: string; cwd?: string; company: C }): Promise<Office<C>>;
export async function office(o: { root?: string; cwd?: string; company?: FakeCompany } = {}): Promise<Office> {
  const company = o.company ?? new FakeCompany();
  const root = o.root ?? tempDir('worklings-orgtools-');
  const people = [...company.staff.map((p) => p.id), 'gone'];
  const desks = new Map<string, OrgDesk>(people.map((id) => [tokenOf(id), { company, person: id, root, cwd: o.cwd ?? root }]));
  const logs: string[] = [];
  const handler = orgToolsHandler({ resolve: (token) => desks.get(token) ?? null, log: (line) => logs.push(line) });
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The test server has no port.');
  const post = async (person: string, method: string, params: Record<string, unknown>, name?: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${tokenOf(person)}`,
        'content-type': 'application/json',
        'mcp-protocol-version': MODERN,
        'mcp-method': method,
        ...(name ? { 'mcp-name': name } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
    });
    const body: unknown = await response.json();
    if (response.status !== 200 || typeof body !== 'object' || body === null || !('result' in body)) throw new Error(`${method} failed: ${response.status} ${JSON.stringify(body)}`);
    return body.result;
  };
  return {
    company,
    logs,
    root,
    call: async (person, tool, args = {}) => {
      const result = await post(person, 'tools/call', { name: tool, arguments: args }, tool);
      if (typeof result !== 'object' || result === null || !('content' in result) || !('isError' in result) || !Array.isArray(result.content)) throw new Error(`not a tool result: ${JSON.stringify(result)}`);
      const [first] = result.content as unknown[];
      const text = typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string' ? first.text : '';
      return { text, isError: result.isError === true };
    },
    list: async (person) => {
      const result = await post(person, 'tools/list', {});
      if (typeof result !== 'object' || result === null || !('tools' in result) || !Array.isArray(result.tools)) throw new Error(`not a tool list: ${JSON.stringify(result)}`);
      return (result.tools as unknown[]).map((t) => (typeof t === 'object' && t !== null && 'name' in t ? String(t.name) : ''));
    },
    listed: async (person, tool) => {
      const result = await post(person, 'tools/list', {});
      const tools = typeof result === 'object' && result !== null && 'tools' in result && Array.isArray(result.tools) ? (result.tools as unknown[]) : [];
      const found = tools.find((t) => typeof t === 'object' && t !== null && 'name' in t && t.name === tool);
      if (typeof found !== 'object' || found === null) throw new Error(`${tool} is not listed for ${person}`);
      return found as Record<string, unknown>;
    },
    instructions: async (person) => {
      const result = await post(person, 'server/discover', {});
      if (typeof result !== 'object' || result === null || !('instructions' in result) || typeof result.instructions !== 'string') throw new Error(`no instructions: ${JSON.stringify(result)}`);
      return result.instructions;
    },
  };
}

export const methods = (o: Office) => o.company.calls.map((c) => c.method);
export const ok = (text: string) => ({ text, isError: false });
export const refused = (text: string) => ({ text, isError: true });
