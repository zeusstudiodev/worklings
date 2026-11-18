// The demo binding: a local copy of the demo hub (src/core/demo-company.ts) that CompanyActions, SteeringActions and the
// hub's actions change, with the small delays a hub has (a message reaching someone, an answer applying after its undo
// window, the CEO's draft arriving), so every flow can be tried in a browser with no hub. Replies are made up and say
// nothing. Timers are the platform's own (not window's), so tests can drive the demo with a fake clock.
import { noPacks } from '../../../src/core/packs.ts';
import {
  below,
  chainUp,
  type CompanyView,
  type DeskState,
  type DeskView,
  LIMITS,
  type LobbyView,
  managerOf,
  type Message,
  MESSAGE_PAGE,
  type PersonView,
  type Question,
  STAKEHOLDER,
  type StatusLine,
  type Task,
  THE_OFFICE,
} from '../../../src/core/company.ts';
import { dict, isOpenTask } from '../../../src/core/company-state.ts';
import {
  DEMO_COMPANY,
  DEMO_DEPARTMENTS,
  demoCompanies,
  demoDecor,
  demoFired,
  DEMO_SCOPING,
  demoFoundingView,
  demoProposal,
  demoRoot,
  demoScoping,
  demoSmallProposal,
  type DemoUndo,
  demoUndos,
  personSteering,
  proposalQuestions,
  demoSnapshot,
  lobbyEntryOf,
  type StudioExtras,
  withOverview,
} from '../../../src/core/demo-company.ts';
import { safeId } from '../../../src/core/events.ts';
import { messagesBefore, NOT_KEPT } from '../../../src/core/message-pages.ts';
import { clip, countWord } from '../../../src/core/now.ts';
import type { OrgProposal } from '../../../src/core/org.ts';
import type { CompanySettings } from '../../../src/core/company.ts';
import { presetModels } from '../../../src/core/presets.ts';
import { budgetIn, modelsIn, officeAnswerIn, presetIn, presetQuestionOf, withSpendingIn } from './spending/demoSpending.ts';
import type { ReshapeAction, ReshapeResult, Snapshot } from '../../../src/core/snapshot.ts';
import {
  type Ack,
  type Audience,
  type Decision,
  DECISION_LIMITS,
  EFFORTS,
  type Effort,
  type Leash,
  LEASHES,
  type PersonSteering,
  type Plan,
  PLAN_APPROVALS,
  PLAN_LIMITS,
  type PlanApproval,
  type PlanVersion,
  type PlanView,
  type Recipient,
  type SettingsChange,
  STEERING_VIEW_LIMITS,
  type SteeringView,
} from '../../../src/core/steering.ts';
import { inSentence, ROLE_MODELS, type StudioDepartment, titleFromId } from '../../../src/core/studio.ts';
import { checkPlan } from '../../../src/core/plan.ts';
import { capital } from '../../../src/core/words.ts';
import type { FolderInfo, HubActions } from './api.ts';
import { cafeEarlier } from './demoHistory.ts';
import {
  answerIn,
  answeredBy,
  checkEdit,
  closedDesk,
  decideIn,
  demoDiff,
  demoScreenshot,
  nameOf,
  newMade,
  officeChangeIn,
  open,
  picksIn,
  recount,
  refused,
  removeDashboardIn,
  reviseProposal,
  scopedIn,
  settle,
  startIn,
  TALK_BEATS,
  TALK_KEPT,
  TALK_PACE,
  type TalkMade,
  talkForget,
  talkReady,
  talkStep,
  undoIn,
} from './demoModel.ts';
import { baseName, insideOf, joinPath, parentOf, sameFolder } from './paths.ts';
import type { CompanyActions, SteeringActions } from './types.ts';
import { ReplayPlayer } from './replay/player.ts';
import { isRecording, type Recording } from './replay/replayModel.ts';

// ---------------------------------------------------------------------------------------------------------------
// The demo's folders, for Start a company

const HOME = 'C:\\Users\\you';
const DEMO_TREE: Record<string, string[]> = {
  [HOME]: ['Documents', 'Projects', 'Sites'],
  [`${HOME}\\Documents`]: [],
  [`${HOME}\\Projects`]: ['cafe-lumen', 'ledger', 'plant-pal', 'recipe-box', 'tiny-ideas'],
  [`${HOME}\\Projects\\cafe-lumen`]: ['public', 'src'],
  [`${HOME}\\Projects\\ledger`]: ['src'],
  [`${HOME}\\Projects\\plant-pal`]: ['src'],
  [`${HOME}\\Projects\\recipe-box`]: ['public', 'src'],
  [`${HOME}\\Projects\\tiny-ideas`]: [],
  [`${HOME}\\Sites`]: ['lake-wind', 'portfolio'],
  [`${HOME}\\Sites\\lake-wind`]: ['src'],
  [`${HOME}\\Sites\\portfolio`]: ['src'],
};
const DEMO_DETECTED: Record<string, string> = {
  [`${HOME}\\Projects\\cafe-lumen`]: 'A Vite and React app.',
  [`${HOME}\\Projects\\ledger`]: 'A Shopify app on React Router.',
  [`${HOME}\\Projects\\plant-pal`]: 'A Vite and React app.',
  [`${HOME}\\Projects\\recipe-box`]: 'A Vite and React app with a Supabase backend.',
  [`${HOME}\\Sites\\lake-wind`]: 'An Astro site.',
  [`${HOME}\\Sites\\portfolio`]: 'An Astro site.',
};
const DEMO_UNCOMMITTED = new Set([`${HOME}\\Projects\\recipe-box`]);
const DEMO_NOT_GIT = new Set([`${HOME}\\Projects\\tiny-ideas`, `${HOME}\\Documents`]);

// ---------------------------------------------------------------------------------------------------------------
// The store

interface DemoCompany {
  view: CompanyView;
  root: string;
  extras: StudioExtras & { decor: string[] };
  /** The CEO's own version of the proposal, for "Back to the CEO's version". */
  ceoProposal: OrgProposal | null;
}

type Live = Snapshot & { company: CompanyView };

/** What every press a recorded run can't take says (SPEC-v0.8.md, "The demo replay"). */
export const RECORDED_REFUSAL = "This is a recorded run, so nothing reaches it. Answer what it asks on the card; start your own with Worklings.";
/** The recorded run's company: one plain job, replayed when the demo starts a session. */
export const REPLAY_ID = 'haiku-check';
/** The recording, loaded when the demo first needs it, so the lobby never waits for it. */
export async function loadRecording(): Promise<Recording> {
  const raw: unknown = (await import('./replay/recording.json')).default;
  if (!isRecording(raw)) throw new Error('The recorded run in replay/recording.json is not a recording.');
  return raw;
}

export class DemoHub {
  private companies: DemoCompany[];
  private removed: DemoCompany[] = [];
  private maxDesks = 12;
  private changed = Date.now();
  private seq = 0;
  private settled = new Set<string>();
  private tree: Record<string, string[]> = { ...DEMO_TREE };
  private lobbyCache: LobbyView | null = null;
  private snapshots = new Map<string, Live | null>();
  private listeners = new Set<() => void>();
  /** Who was fired, as they were, so a rehire puts them back with their model and look. */
  private firedPeople = new Map<string, PersonView>();
  /** How to take back each reversible decision, by "company/decision": the demo's stand-in for the event log. */
  private undos = new Map<string, DemoUndo>();
  /** Messages from before each company's view, with their acknowledgements, oldest first: the café's first day. */
  private readonly earlier = new Map<string, { messages: Message[]; acks: Ack[] }>();

  /** The café's talk loop: the conversations played so far (they go round again) and what the last few made. */
  private talkAt = 0;
  private talked: TalkMade[] = [];
  private readonly isStill: () => boolean;
  /** The recorded runs the visitor started, by company id (v0.8). */
  private replays = new Map<string, ReplayPlayer>();

  /** `still` says whether the office is still (the person's switch or the system's reduced motion): the café stops talking then. */
  constructor(now: number, still: () => boolean = () => false) {
    this.isStill = still;
    this.earlier.set(DEMO_COMPANY, cafeEarlier(now));
    this.companies = demoCompanies(now).map((view) => ({
      view,
      root: demoRoot(view.id),
      extras: { departments: [...DEMO_DEPARTMENTS], decor: demoDecor(view), fired: demoFired(view.id) },
      ceoProposal: view.proposal,
    }));
    // What was answered before the demo opened has applied already; only answers given here settle.
    for (const c of this.companies) for (const id of answeredBy(c.view, now)) this.settled.add(id);
    for (const c of this.companies) for (const [decision, undo] of Object.entries(demoUndos(c.view.id))) this.undos.set(`${c.view.id}/${decision}`, undo);
    // Answers apply after their undo window; check twice a second, which is all the demo needs.
    setInterval(() => this.tick(), 500);
    this.later(TALK_PACE.first, () => this.talk());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  changedAt = (): number => this.changed;

  lobby = (): LobbyView => {
    this.lobbyCache ??= {
      companies: [
        ...this.companies.map((c) => lobbyEntryOf(c.view, c.root, this.changed)),
        ...[...this.replays.values()].flatMap((r) => {
          const live = r.snapshot();
          return live ? [lobbyEntryOf(live.company, r.recording.folder, this.changed)] : [];
        }),
      ],
      hub: { maxDesks: this.maxDesks, working: this.companies.reduce((s, c) => s + c.view.desks.working, 0) },
      serverTime: this.changed,
    };
    return this.lobbyCache;
  };

  snapshot = (id: string): Live | null => {
    const replay = this.replays.get(id);
    if (replay) return replay.snapshot();
    if (!this.snapshots.has(id)) {
      const c = this.find(id);
      this.snapshots.set(id, c ? { ...demoSnapshot(c.view, c.root, this.changed, c.extras), company: c.view } : null);
    }
    return this.snapshots.get(id) ?? null;
  };

  has = (id: string): boolean => this.find(id) !== undefined || this.replays.has(id);

  /** The recorded run playing as this company, if it is one. */
  replayOf = (id: string): ReplayPlayer | null => this.replays.get(id) ?? null;

  /**
   * How far the company's clock runs ahead of this browser's: a sped-up replay's runs ahead (its times are the run's); the
   * made-up companies' are this browser's own.
   */
  skewOf = (id: string): number => {
    const replay = this.replays.get(id);
    return replay ? replay.serverNow() - this.changed : 0;
  };

  /** Starts (or starts again) the recorded run as its company in the lobby. */
  async startReplay(): Promise<string> {
    const known = this.replays.get(REPLAY_ID);
    if (known) {
      known.start();
      return REPLAY_ID;
    }
    const player = new ReplayPlayer(await loadRecording(), () => this.emit());
    this.replays.set(REPLAY_ID, player);
    player.start();
    return REPLAY_ID;
  }

  /** A recorded run's actions: its prompts and last words answered on the card, everything else refused in a sentence. */
  private replayActions(player: ReplayPlayer): CompanyActions {
    const done: Partial<CompanyActions> = {
      decide: async (approval, decision, always, note) => player.decide(approval, decision, always, note),
      answer: async (question, option, text) => player.answer(question, option, text),
      undo: async (item) => player.undo(item),
      looked: async () => undefined,
      markSeen: async () => undefined,
      earlierMessages: async () => ({ messages: [], acks: [], more: false }),
      screenshotUrl: () => '',
    };
    return new Proxy(done as CompanyActions, {
      get: (target, key: string) =>
        Object.hasOwn(target, key)
          ? target[key as keyof CompanyActions]
          : async () => {
              throw refused(409, RECORDED_REFUSAL, 'replay');
            },
    });
  }

  private find(id: string): DemoCompany | undefined {
    return this.companies.find((c) => c.view.id === id);
  }

  private emit() {
    this.changed = Date.now();
    this.lobbyCache = null;
    this.snapshots.clear();
    for (const listener of this.listeners) listener();
  }

  private update(id: string, change: (c: DemoCompany) => Partial<DemoCompany> | void) {
    const c = this.find(id);
    if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
    const patch = change(c);
    if (patch) Object.assign(c, patch);
    c.view = withOverview(withSpendingIn(syncSteering(recount(c.view)), Date.now()), Date.now());
    this.emit();
  }

  private settingsOf(id: string): CompanySettings {
    const c = this.find(id);
    if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
    return c.view.settings;
  }

  private later(ms: number, run: () => void) {
    setTimeout(() => {
      try {
        run();
      } catch {
        // The company may have left the demo lobby meanwhile: then there is nothing to do.
      }
    }, ms);
  }

  /**
   * The café talks to itself, slowly: one conversation (a relay down the org, an acknowledgement, a status line moving)
   * every half minute or so, step by step. It only adds lines of its own, so nothing you did is touched, and it waits
   * while the office is still, paused or missing someone.
   */
  private talk() {
    const beat = TALK_BEATS[this.talkAt % TALK_BEATS.length];
    const again = (after: number) => this.later(after, () => this.talk());
    const c = this.find(DEMO_COMPANY);
    if (!c || !beat || this.isStill() || !talkReady(c.view, beat)) {
      again(TALK_PACE.between);
      return;
    }
    this.talkAt += 1;
    const made = newMade();
    const keys = new Map<string, string>();
    const ids = { message: () => this.next('dm'), ack: () => this.next('dk') };
    this.talked.push(made);
    beat.forEach((step, i) =>
      this.later(i * TALK_PACE.step, () => {
        if (this.isStill()) return;
        this.update(DEMO_COMPANY, (d) => ({ view: talkStep(d.view, step, keys, made, ids, Date.now()) }));
      }),
    );
    const oldest = this.talked.length > TALK_KEPT ? this.talked.shift() : undefined;
    if (oldest) this.update(DEMO_COMPANY, (d) => ({ view: talkForget(d.view, oldest) }));
    again(beat.length * TALK_PACE.step + TALK_PACE.between);
  }

  private tick() {
    const now = Date.now();
    for (const c of this.companies) {
      const { view, done } = settle(c.view, now, this.settled);
      if (done.length === 0) continue;
      for (const id of done) this.settled.add(id);
      // The last scoping answer applied: the answers go to the CEO, who drafts the org from them.
      const scoped = scopedIn(view, now, this.settled);
      if (scoped) {
        c.view = syncSteering(recount(scoped.view));
        this.emit();
        this.draft(c.view.id, scoped.prototype);
        continue;
      }
      // Answers, approvals and Always allow rules are decisions once they apply.
      let next = view;
      for (const item of done) {
        // The office's own questions act on their answer: a preset, or a raised budget.
        const asked = next.questions.find((x) => x.id === item);
        if (asked && (asked.preset === true || asked.budget)) next = officeAnswerIn(next, asked, now);
        for (const d of settledDecisions(next, item)) next = this.withDecision(c.view.id, next, d);
        const q = next.questions.find((x) => x.id === item);
        const held = q?.gate && q.answer ? next.tasks.find((t) => t.id === q.gate?.task) : undefined;
        if (!q?.answer || !held) continue;
        // As in the real company (gateAnswered in src/company/leash.ts): "Start it" lets the task go to its owner, and
        // any other answer pauses it, so Resume on the board starts it later.
        if (q.answer.option === 0) next = withStatus(next, { person: held.owner, text: `Starting “${held.title}” next.`, taskId: held.id, at: now, cites: [] });
        else if (!held.paused) next = { ...next, tasks: next.tasks.map((t) => (t.id === held.id ? { ...t, paused: { at: now, by: STAKEHOLDER }, updatedAt: now } : t)) };
      }
      c.view = withOverview(withSpendingIn(syncSteering(recount(next)), now), now);
      this.emit();
    }
  }

  /** Adds a decision with a fresh id, keeping how to undo it when it can be. */
  private withDecision(company: string, view: CompanyView, d: DecisionInput): CompanyView {
    const steering = view.steering;
    if (!steering) return view;
    const id = this.next('dd');
    const { undo, ...rest } = d;
    if (undo) this.undos.set(`${company}/${id}`, undo);
    const decision: Decision = {
      id, at: Date.now(), why: null, alternatives: [], links: {}, ...rest, reversible: undo !== undefined && undo !== null, undone: null, reconsider: null,
    };
    return { ...view, steering: { ...steering, decisions: [...steering.decisions, decision].slice(-STEERING_VIEW_LIMITS.decisions) } };
  }

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private person(id: string, person: string): PersonView {
    const p = this.find(id)?.view.people.find((x) => x.id === person);
    if (!p) throw refused(404, "That person isn't in the company any more.", 'unknown');
    return p;
  }

  private setDesk(id: string, person: string, state: DeskState, extra: Partial<DeskView> = {}) {
    this.update(id, (c) => ({
      view: { ...c.view, people: c.view.people.map((p) => (p.id === person ? { ...p, desk: { ...p.desk, state, since: Date.now(), ...extra } } : p)) },
    }));
  }

  private post(id: string, line: Omit<StatusLine, 'at'>) {
    const status = { ...line, at: Date.now() };
    this.update(id, (c) => ({ view: { ...c.view, statuses: [...c.view.statuses, status], people: c.view.people.map((p) => (p.id === line.person ? { ...p, status } : p)) } }));
  }

  private send(id: string, message: Omit<Message, 'id' | 'at'>): Message {
    const m: Message = { audience: null, for: [], deliveredHow: null, cites: [], ...message, id: this.next('dm'), at: Date.now() };
    this.update(id, (c) => ({ view: { ...c.view, messages: [...c.view.messages, m] } }));
    return m;
  }

  /** It reaches them: at their next step while a turn runs, else as a turn of its own. */
  private deliver(id: string, messageId: string) {
    this.update(id, (c) => ({
      view: {
        ...c.view,
        messages: c.view.messages.map((m) => {
          if (m.id !== messageId || m.deliveredAt !== null) return m;
          const desk = c.view.people.find((p) => p.id === m.to)?.desk.state;
          const busy = desk === 'working' || desk === 'starting' || desk === 'stopping';
          return { ...m, deliveredAt: Date.now(), deliveredHow: m.to === STAKEHOLDER || m.to === THE_OFFICE ? null : busy ? 'next-step' : 'new-turn' };
        }),
      },
    }));
  }

  /** Hands a message over as the switchboard would: soon for an open desk, later for one that has to open, never while away. */
  private deliverSoon(id: string, messageId: string, then?: () => void) {
    const c = this.find(id);
    const m = c?.view.messages.find((x) => x.id === messageId);
    const desk = c?.view.people.find((p) => p.id === m?.to)?.desk.state;
    if (!m || !desk || desk === 'away') return;
    const wait = desk === 'waiting' || desk === 'closed' ? 6_000 : 1_200;
    this.later(wait, () => {
      this.deliver(id, messageId);
      if (then) this.later(2_500, then);
    });
  }

  /** What someone says back in the demo, and what the CEO does with your words while the proposal waits. */
  private reply(id: string, to: PersonView, text: string) {
    const c = this.find(id);
    if (!c) return;
    if (to.level === 'ceo' && c.view.phase === 'proposed' && c.view.proposal) {
      const revised = reviseProposal(c.view.proposal, text);
      if (revised) {
        this.update(id, (d) => ({
          view: {
            ...d.view,
            proposal: revised.proposal,
            proposalEdited: false,
            log: [...d.view.log, { at: Date.now(), kind: 'proposal', by: to.id, text: `The CEO revised the proposal: ${revised.what}` }],
          },
          ceoProposal: revised.proposal,
        }));
        this.send(id, { from: to.id, to: STAKEHOLDER, text: `Done: ${revised.what} The chart shows what changed.`, origin: null, relayOf: null, note: null, deliveredAt: Date.now(), interrupt: false });
        return;
      }
      this.send(id, { from: to.id, to: STAKEHOLDER, text: 'Noted. In this demo I can add a German copywriter, merge design and UX, or make the org smaller; anything else I would fold into the next draft.', origin: null, relayOf: null, note: null, deliveredAt: Date.now(), interrupt: false });
      return;
    }
    const manager = to.level === 'ceo' || to.level === 'head' || to.level === 'lead';
    const words = manager ? "Thanks. I'll pass it on to whoever it concerns." : "Got it. I'll take that into my next step.";
    this.send(id, { from: to.id, to: STAKEHOLDER, text: words, origin: null, relayOf: null, note: null, deliveredAt: Date.now(), interrupt: false });
    this.post(id, { person: to.id, text: manager ? 'Passing your message on.' : 'Taking your message into account.', taskId: to.task });
  }

  actions(id: string): CompanyActions {
    const replay = this.replays.get(id);
    if (replay) return this.replayActions(replay);
    return {
      say: async (to, text) => {
        const person = this.person(id, to);
        const words = text.trim();
        if (!words) throw refused(400, 'Write something to send.', 'invalid');
        if (words.length > 4_000) throw refused(400, 'Keep it to 4,000 characters.', 'invalid');
        const m = this.send(id, { from: STAKEHOLDER, to, text: words, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false });
        if (person.desk.state === 'away') return m;
        const wait = person.desk.state === 'waiting' || person.desk.state === 'closed' ? 6_000 : 1_200;
        this.later(wait, () => {
          this.deliver(id, m.id);
          this.later(2_500, () => this.reply(id, this.person(id, to), words));
        });
        return m;
      },
      unsend: async (messageId) => {
        const c = this.find(id);
        const m = c?.view.messages.find((x) => x.id === messageId);
        if (!c || !m) throw refused(404, "That message isn't there any more.", 'unknown');
        if (m.deliveredAt !== null) throw refused(409, `It reached ${nameOf(c.view, m.to)} already, so it can't be unsent.`, 'conflict');
        this.update(id, (d) => ({ view: { ...d.view, messages: d.view.messages.filter((x) => x.id !== messageId) } }));
      },
      stop: async (person, instruction) => {
        const p = this.person(id, person);
        const words = instruction.trim() || 'Stop here and wait for my next message.';
        const name = nameOf(this.find(id)?.view ?? { people: [] }, person);
        this.update(id, (c) => ({
          view: {
            ...c.view,
            approvals: c.view.approvals.map((a) => (a.person === person && open(a) ? { ...a, withdrawn: { reason: `${name} was stopped.`, at: Date.now() } } : a)),
            log: [...c.view.log, { at: Date.now(), kind: 'stop', by: STAKEHOLDER, text: `You stopped ${name}.` }],
          },
        }));
        const m = this.send(id, { from: STAKEHOLDER, to: person, text: words, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: true });
        this.setDesk(id, person, 'stopping');
        this.later(1_200, () => {
          this.deliver(id, m.id);
          const waits = words === 'Stop here and wait for my next message.';
          this.setDesk(id, person, waits ? 'idle' : 'working');
          this.post(id, { person, text: waits ? 'Stopped, waiting for your next message.' : 'Stopped and on your new instruction.', taskId: p.task });
        });
      },
      answer: async (question, option, text) => {
        this.update(id, (c) => ({ view: answerIn(c.view, question, option, text, Date.now()) }));
      },
      answerWithPicks: async () => {
        this.update(id, (c) => ({ view: picksIn(c.view, Date.now()) }));
      },
      answerBatch: async (batch) => {
        const c = this.find(id);
        const inBatch = (item: { id: string; batch?: string | null }) => (item.batch ?? item.id) === batch;
        const questions = c?.view.questions.filter((q) => inBatch(q) && open(q)) ?? [];
        const approvals = c?.view.approvals.filter((a) => inBatch(a) && open(a)) ?? [];
        if (questions.length === 0 && approvals.length === 0) throw refused(404, "There's nothing waiting in that batch.", 'unknown');
        const picked = questions.filter((q) => q.recommended !== null);
        this.update(id, (d) => {
          let view = d.view;
          const now = Date.now();
          for (const q of picked) view = answerIn(view, q.id, q.recommended, '', now);
          for (const a of approvals) view = decideIn(view, a.id, a.advice?.recommend === 'allow' ? 'allow' : 'deny', false, null, now);
          return { view };
        });
        return { answered: picked.length + approvals.length, left: questions.length - picked.length };
      },
      decide: async (approval, decision, always, note) => {
        this.update(id, (c) => ({ view: decideIn(c.view, approval, decision, always, note, Date.now()) }));
      },
      undo: async (item) => {
        this.update(id, (c) => ({ view: undoIn(c.view, item, Date.now()) }));
      },
      editProposal: async (proposal) => {
        const c = this.find(id);
        if (!c || c.view.phase !== 'proposed') throw refused(409, 'There is no proposal to change: the company has started.', 'conflict');
        if (c.view.starting) throw refused(409, 'The company is starting; the org is being hired now.', 'busy');
        const check = checkEdit(proposal);
        if (!check.ok) return check;
        this.update(id, (d) => ({
          view: {
            ...d.view,
            proposal,
            proposalEdited: JSON.stringify(proposal) !== JSON.stringify(d.ceoProposal),
            log: [...d.view.log, { at: Date.now(), kind: 'proposal-edited', by: STAKEHOLDER, text: 'You changed the proposal.' }],
          },
        }));
        return { ok: true };
      },
      restoreProposal: async () => {
        if (this.find(id)?.view.starting) throw refused(409, 'The company is starting; the org is being hired now.', 'busy');
        this.update(id, (c) => ({ view: { ...c.view, proposal: c.ceoProposal, proposalEdited: false } }));
      },
      // As the hub does: the press is checked at once, then the company says it is starting while it hires everyone
      // and makes its branch, and runs a moment later.
      start: async () => {
        const waiting = this.find(id);
        if (!waiting) throw refused(404, "That company isn't in the lobby any more.", 'gone');
        if (waiting.view.starting) throw refused(409, 'The company is starting; the org is being hired now.', 'busy');
        startIn(waiting.view, Date.now());
        this.update(id, (c) => ({ view: { ...c.view, starting: true } }));
        this.later(1_200, () => {
          this.update(id, (c) => {
            const departments = c.view.proposal?.rooms.map((r) => ({ id: r.id, name: r.title, style: r.style, ...(r.theme ? { theme: r.theme } : {}) }));
            return { view: startIn(c.view, Date.now()), extras: { ...c.extras, ...(departments ? { departments } : {}) } };
          });
          this.later(1_500, () => {
            const c = this.find(id);
            for (const p of c?.view.people ?? []) if (p.desk.state === 'starting') this.setDesk(id, p.id, 'working');
            const ceo = c?.view.people.find((p) => p.level === 'ceo');
            if (ceo) this.post(id, { person: ceo.id, text: 'Briefing the heads on the goal.', taskId: null });
          });
        });
      },
      pause: async () => {
        const now = Date.now();
        this.update(id, (c) => ({
          view: { ...c.view, pause: { reason: 'stakeholder', since: now, until: null, message: 'You paused work.' }, log: [...c.view.log, { at: now, kind: 'pause', by: STAKEHOLDER, text: 'You paused work.' }] },
        }));
        this.later(1_500, () => {
          this.update(id, (c) => ({
            view: c.view.pause ? { ...c.view, people: c.view.people.map((p) => (p.desk.state === 'working' || p.desk.state === 'starting' ? { ...p, desk: { ...p.desk, state: 'idle', since: Date.now() } } : p)) } : c.view,
          }));
        });
      },
      resume: async () => {
        this.update(id, (c) => ({ view: { ...c.view, pause: null, phase: c.view.phase === 'stopped' ? 'running' : c.view.phase, log: [...c.view.log, { at: Date.now(), kind: 'resume', by: STAKEHOLDER, text: 'You resumed work.' }] } }));
        this.later(1_000, () => {
          this.update(id, (c) => ({
            view: { ...c.view, people: c.view.people.map((p) => (p.desk.state === 'idle' && p.task ? { ...p, desk: { ...p.desk, state: 'working', since: Date.now() } } : p)) },
          }));
        });
      },
      changeOffice: async (change) => {
        let message = '';
        this.update(id, (c) => {
          const result = officeChangeIn(c.view, change, c.extras.decor);
          message = result.message;
          const departments = change.change === 'room-theme' && c.extras.departments?.some((d) => d.id === change.room)
            ? c.extras.departments.map((d) => {
                if (d.id !== change.room) return d;
                if (change.theme === null) {
                  const { theme: _theme, ...rest } = d;
                  return rest;
                }
                return { ...d, theme: change.theme };
              })
            : c.extras.departments;
          return { view: { ...result.view, log: [...result.view.log, { at: Date.now(), kind: 'office', by: STAKEHOLDER, text: message }] }, extras: { ...c.extras, decor: result.decor, ...(departments ? { departments } : {}) } };
        });
        return { ok: true, message, changed: ['.claude/studio.yaml'] };
      },
      removeDashboard: async (dashboard) => {
        this.update(id, (c) => ({ view: removeDashboardIn(c.view, dashboard, Date.now()) }));
      },
      reshape: async (action) => this.reshape(id, action),
      preview: async (action) => {
        if (action === 'stop') {
          this.update(id, (c) => ({ view: { ...c.view, preview: { ...c.view.preview, state: 'off', url: null, problem: null } } }));
          return this.find(id)?.view.preview ?? { state: 'off', url: null, command: null, problem: null };
        }
        this.update(id, (c) => ({ view: { ...c.view, preview: { ...c.view.preview, state: 'starting', problem: null } } }));
        this.later(1_500, () =>
          this.update(id, (c) => ({ view: { ...c.view, preview: { ...c.view.preview, state: 'down', problem: 'The demo has no app to run, so nothing answers here.' } } })),
        );
        return this.find(id)?.view.preview ?? { state: 'starting', url: null, command: null, problem: null };
      },
      taskDiff: async (taskId) => {
        const t = this.find(id)?.view.tasks.find((x) => x.id === taskId);
        if (!t) throw refused(404, "That task isn't in the company any more.", 'unknown');
        if (!t.commit) throw refused(404, "Changes land in one commit when it's done.", 'no-commit');
        await new Promise((resolve) => setTimeout(resolve, 400));
        return demoDiff(t.files.length > 0 ? t.files : ['README.md'], t.commit);
      },
      screenshotUrl: (shot) => {
        const s = this.find(id)?.view.screenshots.find((x) => x.id === shot);
        return demoScreenshot(s?.caption ?? '', shot !== 'shot-1');
      },
      handOver: async (person) => {
        const name = nameOf(this.find(id)?.view ?? { people: [] }, person);
        this.update(id, (c) => ({
          view: {
            ...c.view,
            approvals: c.view.approvals.map((a) => (a.person === person && open(a) ? { ...a, withdrawn: { reason: `${name} was handed over to you in Claude Code.`, at: Date.now() } } : a)),
            log: [...c.view.log, { at: Date.now(), kind: 'hand-over', by: STAKEHOLDER, text: `You opened ${name} in Claude Code.` }],
          },
        }));
        this.setDesk(id, person, 'away');
        return this.person(id, person).desk;
      },
      bringBack: async (person) => {
        const name = nameOf(this.find(id)?.view ?? { people: [] }, person);
        this.update(id, (c) => ({ view: { ...c.view, log: [...c.view.log, { at: Date.now(), kind: 'bring-back', by: STAKEHOLDER, text: `You brought ${name} back.` }] } }));
        this.setDesk(id, person, 'idle');
        return this.person(id, person).desk;
      },
      updateSettings: async (input) => {
        if (input.maxDesks !== undefined && (!Number.isInteger(input.maxDesks) || input.maxDesks < 1 || input.maxDesks > 20)) throw refused(400, 'Pick 1 to 20 desks.', 'invalid');
        this.update(id, (c) => ({
          view: {
            ...c.view,
            settings: {
              ...c.view.settings,
              ...(input.maxDesks !== undefined ? { maxDesks: input.maxDesks } : {}),
              alwaysAllow: input.removeRule ? c.view.settings.alwaysAllow.filter((r) => r !== input.removeRule) : c.view.settings.alwaysAllow,
            },
            log: [...c.view.log, { at: Date.now(), kind: 'settings', by: STAKEHOLDER, text: input.maxDesks !== undefined ? `You set ${input.maxDesks} desks at once.` : 'You removed a rule.' }],
          },
        }));
        return this.find(id)?.view.settings ?? { maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [], preset: 'balanced', models: presetModels('balanced'), budget: { company: null, person: null } };
      },
      setPreset: async (preset) => {
        this.update(id, (c) => ({ view: presetIn(c.view, preset, Date.now()) }));
        return this.settingsOf(id);
      },
      setModels: async (change) => {
        this.update(id, (c) => ({ view: modelsIn(c.view, change, Date.now()) }));
        return this.settingsOf(id);
      },
      setBudget: async (change) => {
        this.update(id, (c) => ({ view: budgetIn(c.view, change, Date.now()) }));
        return this.settingsOf(id);
      },
      markSeen: async (person) => {
        this.update(id, (c) => ({ view: { ...c.view, seen: { ...c.view.seen, [person]: Date.now() } } }));
      },
      // The demo keeps its made-up last look, so "Since you last looked" stays the same however often it opens.
      looked: async () => undefined,
      // As the hub's route answers: the same checks, then the messages kept before `before`, the made-up history first
      // and the view after it, a moment later as an answer over the network comes.
      earlierMessages: async (before, limit = MESSAGE_PAGE.default) => {
        const c = this.find(id);
        if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
        if (safeId(before) === undefined) throw refused(400, "before isn't an id this office made.", 'bad-input');
        if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGE_PAGE.max) throw refused(400, `limit must be a whole number from 1 to ${MESSAGE_PAGE.max}.`, 'bad-input');
        const earlier = this.earlier.get(id);
        const page = messagesBefore([...(earlier?.messages ?? []), ...c.view.messages], [...(earlier?.acks ?? []), ...(c.view.steering?.acks ?? [])], before, limit);
        if (!page) throw refused(400, NOT_KEPT, 'unknown');
        await new Promise((resolve) => setTimeout(resolve, 250));
        return page;
      },
    };
  }

  /**
   * SteeringActions over this company's local state, as the real company would answer them: the same refusals, a new
   * plan version for an edit, one copy per person for a room, and a decision for every change it makes.
   */
  steering(id: string): SteeringActions {
    if (this.replays.has(id)) {
      return new Proxy({} as SteeringActions, {
        get: () => async () => {
          throw refused(409, RECORDED_REFUSAL, 'replay');
        },
      });
    }
    const company = (): DemoCompany => {
      const c = this.find(id);
      if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
      return c;
    };
    const view = () => company().view;
    /** Changes the view and records the decision in the same step. */
    const change = (next: (view: CompanyView, now: number) => CompanyView, decision: (view: CompanyView) => DecisionInput | null) =>
      this.update(id, (c) => {
        const now = Date.now();
        const changed = next(c.view, now);
        const d = decision(changed);
        return { view: d ? this.withDecision(id, changed, d) : changed };
      });

    return {
      // ----- The plan
      editPlan: async (draft, note) => {
        const v = view();
        const current = latestVersion(steeringOf(v));
        // The office's own check (src/core/plan.ts), so a plan is turned down here exactly as it is live: with the
        // people let go, so a task given to one of them says so (src/company/company.ts hands it the studio's fired).
        const options = {
          earlier: steeringOf(v).plan?.versions.map((x) => x.plan) ?? [],
          fired: (company().extras.fired ?? []).map((f) => ({ id: f.id, name: f.name ?? f.title, title: f.title })),
        };
        const checked = checkPlan(draft, v.people, options);
        if (!checked.ok) return { ok: false, errors: checked.errors };
        const plan = keptChecklist(checked.plan, draft);
        const held = checkPlan(current.plan, v.people, options);
        if (held.ok && JSON.stringify(plan) === JSON.stringify(keptChecklist(held.plan, current.plan))) return { ok: false, errors: [`Nothing changed: that is version ${current.version} as it stands.`] };
        const words = note?.trim().slice(0, PLAN_LIMITS.note) || null;
        const version = current.version + 1;
        const ceo = ceoOf(v);
        change(
          (cv, now) => withVersion(cv, { version, by: STAKEHOLDER, at: now, plan: structuredClone(plan), note: words, cites: [] }),
          () => ({
            by: STAKEHOLDER, kind: 'plan', what: `You edited the plan: version ${version}.`, why: words, people: [STAKEHOLDER, ceo.id], rooms: [ceo.room],
            links: { planVersion: version }, undo: { kind: 'plan', version: current.version },
          }),
        );
        return { ok: true };
      },
      approvePlan: async (version, through) => {
        const v = view();
        const s = steeringOf(v);
        const current = latestVersion(s);
        if (!s.plan?.versions.some((x) => x.version === version)) throw refused(404, `There's no version ${version} of the plan.`, 'unknown');
        if (version !== current.version) throw refused(409, `Version ${version} isn't the latest: version ${current.version} is. Approve that one, or edit it.`, 'conflict');
        const milestone = through === null ? null : current.plan.milestones.find((m) => m.id === through);
        if (through !== null && !milestone) throw refused(400, `The plan has no milestone “${through}”.`, 'unknown');
        const was = s.plan?.approved;
        if (was?.version === version && was.through === through) throw refused(409, `Version ${version} is approved ${milestone ? `through “${milestone.title}” ` : ''}already.`, 'conflict');
        const ceo = ceoOf(v);
        change(
          (cv, now) => approveIn(cv, current, through, now),
          () => ({
            by: STAKEHOLDER, kind: 'plan', what: `You approved version ${version} of the plan${milestone ? ` through “${milestone.title}”` : ''}.`,
            people: [STAKEHOLDER, ceo.id], rooms: [ceo.room], links: { planVersion: version },
          }),
        );
        this.later(1_500, () => this.post(id, { person: ceo.id, text: `Version ${version} is the plan now; its tasks go out in order.`, taskId: null, cites: [] }));
      },
      commentPlan: async (on, text) => {
        const v = view();
        const current = latestVersion(steeringOf(v));
        const words = text.trim();
        if (!words) throw refused(400, 'Write the comment first.', 'invalid');
        if (words.length > PLAN_LIMITS.comment) throw refused(400, `Keep a comment to ${PLAN_LIMITS.comment.toLocaleString('en')} characters.`, 'invalid');
        const about = (): string => {
          if (on.kind === 'plan') return 'the plan';
          if (on.kind === 'milestone') {
            const m = current.plan.milestones.find((x) => x.id === on.id);
            if (!m) throw refused(404, `The plan has no milestone “${on.id}”.`, 'unknown');
            return `the milestone “${m.title}”`;
          }
          const t = current.plan.tasks.find((x) => x.id === on.id);
          if (!t) throw refused(404, `The plan has no task “${on.id}”.`, 'unknown');
          return `the task “${t.title}”`;
        };
        const ceo = ceoOf(v);
        const m = this.send(id, { from: STAKEHOLDER, to: ceo.id, text: `On ${about()}: ${words}`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false });
        const comment = { id: this.next('dc'), at: Date.now(), by: STAKEHOLDER, version: current.version, on, text: words, message: m.id };
        this.update(id, (c) => ({ view: withPlan(c.view, (plan) => ({ ...plan, comments: [...plan.comments, comment].slice(-STEERING_VIEW_LIMITS.comments) })) }));
        this.deliverSoon(id, m.id, () => this.acknowledge(id, m.id, true, "I'll take it into the next version of the plan."));
      },

      // ----- Messages to anyone, and following them
      send: async (to, text, forPeople) => {
        const v = view();
        const words = text.trim();
        if (!words) throw refused(400, 'Say something to send.', 'invalid');
        if (words.length > LIMITS.message) throw refused(400, `Keep it to ${LIMITS.message.toLocaleString('en')} characters.`, 'invalid');
        const named = [...new Set(forPeople)];
        for (const f of named) personIn(v, f);
        const { people, audience } = recipientsOf(v, to, company().extras.departments ?? []);
        const group = audience ? this.next('dg') : null;
        const copies = people.map((p) =>
          this.send(id, {
            from: STAKEHOLDER, to: p.id, text: words, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false,
            audience: audience && group ? { ...audience, group } : null, for: named,
          }),
        );
        for (const m of copies) this.deliverSoon(id, m.id, () => this.takeIn(id, m.id));
        return copies;
      },
      remind: async (message, person) => this.nudge(id, message, person, 'remind'),
      escalate: async (message, person) => this.nudge(id, message, person, 'escalate'),

      // ----- The task board
      orderTasks: async (ids) => {
        const v = view();
        if (ids.length === 0) throw refused(400, 'Say which tasks go first.', 'invalid');
        if (new Set(ids).size !== ids.length) throw refused(400, 'Each task has one place in line.', 'invalid');
        for (const t of ids) {
          const task = taskIn(v, t);
          if (!isOpenTask(task)) throw refused(409, `Task ${task.id} is ${task.status}, so it has no place in line.`, 'closed');
        }
        const before = openInOrder(v.tasks).map((t) => t.id);
        const line = [...ids, ...before.filter((t) => !ids.includes(t))];
        if (line.join('\n') === before.join('\n')) return;
        const moved = movedIn(before, line).map((t) => taskIn(v, t));
        const first = moved[0] ?? taskIn(v, line[0] ?? '');
        const place = line.indexOf(first.id) + 1;
        const owners = [...new Set(moved.map((t) => t.owner))];
        change(
          (cv) => ({ ...cv, tasks: ranked(cv.tasks, line) }),
          () => ({
            by: STAKEHOLDER, kind: 'task', people: [STAKEHOLDER, ...owners], rooms: roomsOf(v, owners), links: { task: first.id },
            what: moved.length > 1 ? `You reordered the board: “${first.title}” and ${countWord(moved.length - 1)} more moved.`
              : place === 1 ? `You moved “${first.title}” to the top of the board.` : `You moved “${first.title}” to place ${place} on the board.`,
          }),
        );
      },
      pauseTask: async (task) => {
        const t = taskIn(view(), task);
        if (!isOpenTask(t)) throw refused(409, `Task ${t.id} is already ${t.status}.`, 'closed');
        if (t.paused) throw refused(409, `“${t.title}” is paused already.`, 'conflict');
        this.hold(id, [t], true, { by: STAKEHOLDER, kind: 'task', what: `You paused “${t.title}”.`, people: [STAKEHOLDER, t.owner], rooms: roomsOf(view(), [t.owner]), links: { task: t.id } });
      },
      resumeTask: async (task) => {
        const t = taskIn(view(), task);
        if (!t.paused) throw refused(409, `“${t.title}” isn't paused.`, 'conflict');
        this.hold(id, [t], false, { by: STAKEHOLDER, kind: 'task', what: `You resumed “${t.title}”.`, people: [STAKEHOLDER, t.owner], rooms: roomsOf(view(), [t.owner]), links: { task: t.id } });
      },
      pauseRoom: async (room) => {
        const c = company();
        const title = roomTitle(c, room);
        const tasks = c.view.tasks.filter((t) => isOpenTask(t) && !t.paused && ownerRoom(c.view, t) === room);
        if (tasks.length === 0) throw refused(409, `Nothing in ${title} is open to pause.`, 'conflict');
        const owners = [...new Set(tasks.map((t) => t.owner))];
        const what = `You paused ${title}: ${tasks.length === 1 ? 'one task waits' : `${countWord(tasks.length)} tasks wait`}.`;
        this.hold(id, tasks, true, { by: STAKEHOLDER, kind: 'task', what, people: [STAKEHOLDER, ...owners], rooms: [room] });
      },
      resumeRoom: async (room) => {
        const c = company();
        const title = roomTitle(c, room);
        const tasks = c.view.tasks.filter((t) => isOpenTask(t) && t.paused && ownerRoom(c.view, t) === room);
        if (tasks.length === 0) throw refused(409, `Nothing in ${title} is paused.`, 'conflict');
        const owners = [...new Set(tasks.map((t) => t.owner))];
        const what = `You resumed ${title}: ${tasks.length === 1 ? 'one task goes on' : `${countWord(tasks.length)} tasks go on`}.`;
        this.hold(id, tasks, false, { by: STAKEHOLDER, kind: 'task', what, people: [STAKEHOLDER, ...owners], rooms: [room] });
      },
      cancelTask: async (task, reason) => {
        const v = view();
        const t = taskIn(v, task);
        if (!isOpenTask(t)) throw refused(409, `Task ${t.id} is already ${t.status}.`, 'closed');
        const why = reason.trim();
        if (!why) throw refused(400, 'Say why it is cancelled, so its owner knows.', 'invalid');
        if (why.length > PLAN_LIMITS.note) throw refused(400, `Keep the reason to ${PLAN_LIMITS.note.toLocaleString('en')} characters.`, 'invalid');
        const branch = t.worktree?.branch ?? `worklings/${t.id}-${slug(t.title)}`;
        change(
          (cv, now) => {
            const tasks = cv.tasks.map((x): Task => (x.id === t.id ? { ...x, status: 'dropped', outcome: `Cancelled: ${endSentence(why)}`, paused: null, cancel: { at: now, by: STAKEHOLDER, reason: why, branch }, updatedAt: now } : x));
            const stopped = stopWorkOn(cv, t.id, now);
            return withStatus({ ...stopped, tasks }, { person: t.owner, text: `Stopped “${t.title}”; the work is on ${branch}.`, taskId: t.id, at: now, cites: [] });
          },
          () => ({
            by: STAKEHOLDER, kind: 'task', what: `You cancelled “${t.title}”: ${endSentence(why)}`, people: [STAKEHOLDER, t.owner], rooms: roomsOf(v, [t.owner]), links: { task: t.id },
            undo: { kind: 'restore-task', task: t.id, status: t.status },
          }),
        );
      },
      reassignTask: async (task, to, note) => {
        const v = view();
        const t = taskIn(v, task);
        if (!isOpenTask(t)) throw refused(409, `Task ${t.id} is already ${t.status}.`, 'closed');
        const next = personIn(v, to);
        const was = nameOf(v, t.owner);
        if (next.id === t.owner) throw refused(409, `${capital(was)} has it already.`, 'conflict');
        const words = note.trim();
        if (words.length > PLAN_LIMITS.note) throw refused(400, `Keep the note to ${PLAN_LIMITS.note.toLocaleString('en')} characters.`, 'invalid');
        const from = t.owner;
        change(
          (cv, now) => {
            const tasks = cv.tasks.map((x): Task =>
              x.id === t.id ? { ...x, owner: next.id, status: x.status === 'working' ? 'queued' : x.status, handovers: [...(x.handovers ?? []), { at: now, by: STAKEHOLDER, from, to: next.id, note: words }], updatedAt: now } : x,
            );
            return { ...stopWorkOn(cv, t.id, now), tasks };
          },
          () => ({ by: STAKEHOLDER, kind: 'task', what: `You handed “${t.title}” from ${was} to ${nameOf(v, next.id)}.`, people: [STAKEHOLDER, from, next.id], rooms: roomsOf(v, [from, next.id]), links: { task: t.id } }),
        );
        const m = this.send(id, { from: STAKEHOLDER, to: next.id, text: `You take over “${t.title}” from ${was}.${words ? ` ${words}` : ''}`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false });
        this.deliverSoon(id, m.id, () => {
          this.takeIn(id, m.id);
          this.post(id, { person: next.id, text: `Taking over “${t.title}” from ${was}.`, taskId: t.id, cites: [] });
        });
      },
      createTask: async (input) => {
        const v = view();
        const title = input.title.trim();
        const brief = input.brief.trim();
        const doneWhen = input.doneWhen.trim();
        if (!title || !brief || !doneWhen) throw refused(400, 'A task needs a title, a brief and what done looks like.', 'invalid');
        if (title.length > LIMITS.title) throw refused(400, `A title is up to ${LIMITS.title} characters.`, 'invalid');
        if (brief.length > LIMITS.brief) throw refused(400, `A brief is up to ${LIMITS.brief.toLocaleString('en')} characters.`, 'invalid');
        if (doneWhen.length > LIMITS.doneWhen) throw refused(400, `"Done when" is up to ${LIMITS.doneWhen.toLocaleString('en')} characters.`, 'invalid');
        const owner = personIn(v, input.owner);
        if (input.milestone !== null && !v.goal?.milestones.some((m) => m.id === input.milestone)) throw refused(404, `The goal has no milestone ${input.milestone}.`, 'unknown');
        const files = checkFiles(input.files);
        refuseOverlaps(v, files);
        const gated = v.steering?.people[owner.id]?.leash === 'check';
        const head = [owner, ...chainUpOf(v, owner.id)].find((p) => p.level === 'head' && p.id !== owner.id) ?? (owner.level === 'ceo' ? null : ceoOrNull(v));
        const now = Date.now();
        const task: Task = {
          id: this.next('dt'), title, brief, owner: owner.id, askedBy: STAKEHOLDER, files, doneWhen, status: 'queued', outcome: null, parent: null, milestone: input.milestone,
          worktree: null, commit: null, createdAt: now, updatedAt: now, priority: Math.max(0, ...v.tasks.map((t) => t.priority ?? 0)) + 1, paused: null, cancel: null,
          handovers: [], planTask: null, cites: [],
        };
        // The office holds the task and asks, in the real company's words (gateFor in src/company/board.ts).
        const gate: Question | null = gated
          ? {
              id: this.next('dq'), from: THE_OFFICE, text: `${capital(nameOf(v, owner.id))} would like to start “${title}”. Start it, or hold it until you resume it?`, options: ['Start it', 'Not now'],
              recommended: null, taskId: task.id, askedAt: now, answer: null, withdrawn: null, gate: { task: task.id },
            }
          : null;
        change(
          (cv) => ({ ...cv, tasks: [...cv.tasks, task], questions: gate ? [...cv.questions, gate] : cv.questions }),
          () => ({
            by: STAKEHOLDER, kind: 'task', what: `You gave ${nameOf(v, owner.id)} a new task: “${title}”.`, people: [STAKEHOLDER, owner.id, ...(head ? [head.id] : [])],
            rooms: [owner.room], links: { task: task.id },
          }),
        );
        if (!gate) {
          const m = this.send(id, { from: STAKEHOLDER, to: owner.id, text: `A new task for you: “${title}”. ${brief}`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false });
          this.deliverSoon(id, m.id, () => this.takeIn(id, m.id));
        }
        if (head) {
          const told = this.send(id, { from: THE_OFFICE, to: head.id, text: `${v.stakeholder || 'The stakeholder'} gave ${nameOf(v, owner.id)} a new task: “${title}”.`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false });
          this.deliverSoon(id, told.id);
        }
        return task;
      },

      // ----- The decision log
      undoDecision: async (decision) => {
        const v = view();
        const d = steeringOf(v).decisions.find((x) => x.id === decision);
        if (!d) throw refused(404, "There's no decision with that id.", 'unknown');
        if (d.undone) throw refused(409, 'That was undone already.', 'conflict');
        const undo = this.undos.get(`${id}/${d.id}`);
        if (!d.reversible || !undo) throw refused(409, "That decision can't be undone. Reconsider sends it back to whoever made it.", 'conflict');
        this.takeBack(id, undo);
        this.undos.delete(`${id}/${d.id}`);
        this.update(id, (c) => {
          const undoneBy = this.next('dd');
          const now = Date.now();
          const s = steeringOf(c.view);
          const entry: Decision = {
            id: undoneBy, at: now, by: STAKEHOLDER, kind: 'undo', what: `You undid this: ${d.what}`, why: null, alternatives: [], people: d.people.includes(STAKEHOLDER) ? d.people : [STAKEHOLDER, ...d.people],
            rooms: d.rooms, links: { ...d.links, decision: d.id }, reversible: false, undone: null, reconsider: null,
          };
          const decisions = s.decisions.map((x) => (x.id === d.id ? { ...x, reversible: false, undone: { at: now, by: STAKEHOLDER, decision: undoneBy } } : x));
          return { view: { ...c.view, steering: { ...s, decisions: [...decisions, entry].slice(-STEERING_VIEW_LIMITS.decisions) } } };
        });
      },
      reconsider: async (decision, note) => {
        const v = view();
        const d = steeringOf(v).decisions.find((x) => x.id === decision);
        if (!d) throw refused(404, "There's no decision with that id.", 'unknown');
        if (d.by === STAKEHOLDER) throw refused(409, 'That was your own decision: change it instead of sending it back.', 'conflict');
        if (d.by === THE_OFFICE) throw refused(409, 'The office made that one, so there is nobody to send it back to.', 'conflict');
        const decider = v.people.find((p) => p.id === d.by);
        if (!decider) throw refused(409, `${capital(nameOf(v, d.by))} isn't in the company any more.`, 'conflict');
        const words = note.trim();
        if (!words) throw refused(400, 'Say what to reconsider, so they know what to look at.', 'invalid');
        if (words.length > DECISION_LIMITS.note) throw refused(400, `Keep the note to ${DECISION_LIMITS.note.toLocaleString('en')} characters.`, 'invalid');
        const m = this.send(id, {
          from: STAKEHOLDER, to: decider.id, text: `Please reconsider: “${d.what}” ${words}`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false, cites: [d.id],
        });
        change(
          (cv, now) => {
            const s = steeringOf(cv);
            return { ...cv, steering: { ...s, decisions: s.decisions.map((x) => (x.id === d.id ? { ...x, reconsider: { at: now, note: words, message: m.id } } : x)) } };
          },
          () => ({
            by: STAKEHOLDER, kind: 'reconsider', what: `You asked ${nameOf(v, decider.id)} to reconsider: ${d.what}`, why: words, people: [STAKEHOLDER, decider.id],
            rooms: d.rooms, links: { decision: d.id, message: m.id },
          }),
        );
        this.deliverSoon(id, m.id, () => this.acknowledge(id, m.id, true, "I'll look at it again and tell you what changes."));
      },

      // ----- Settings, the leash, model and effort
      changeSettings: async (input) => {
        const c = company();
        const result = settingsIn(c.view, input, Date.now(), knownRooms(c));
        this.update(id, () => {
          let next = result.view;
          for (const d of result.changes) next = this.withDecision(id, next, d);
          const log = result.changes.map((d) => ({ at: Date.now(), kind: 'settings' as const, by: STAKEHOLDER, text: d.what }));
          return { view: { ...next, log: [...next.log, ...log] } };
        });
        return steeringOf(view()).settings;
      },
    };
  }

  /** The recipient takes a message in: they acknowledge it and pass it on to whoever it is for below them. */
  private takeIn(id: string, messageId: string) {
    const c = this.find(id);
    const m = c?.view.messages.find((x) => x.id === messageId);
    const p = c?.view.people.find((x) => x.id === m?.to);
    if (!c || !m || !p) return;
    const passed = this.passOn(id, m, p);
    const manager = p.level === 'ceo' || p.level === 'head' || p.level === 'lead';
    const words =
      passed.length > 0 ? `Passing it on to ${listOf(passed.map((f) => nameOf(c.view, f)))}.` : manager && !m.audience ? "Got it. I'll pass it on to whoever it concerns." : "Got it. I'll take it into my next step.";
    this.acknowledge(id, m.id, true, words);
  }

  /** Relays a message to the people it is for who are below the holder and haven't had it; returns who it went to. */
  private passOn(id: string, m: Message, holder: Pick<PersonView, 'id'>): string[] {
    const c = this.find(id);
    if (!c) return [];
    const root = rootOf(c.view, m);
    const family = familyOf(c.view, root);
    const under = new Set(below(c.view.people, holder.id).map((p) => p.id));
    const due = (root.for ?? []).filter((f) => f !== holder.id && under.has(f) && !c.view.messages.some((x) => family.has(x.id) && x.to === f));
    for (const f of due) {
      const relay = this.send(id, {
        from: holder.id, to: f, text: root.text, origin: STAKEHOLDER, relayOf: m.id, note: `Passing on ${c.view.stakeholder || 'the stakeholder'}'s note.`, deliveredAt: null, interrupt: false,
        for: root.for ?? [],
      });
      this.deliverSoon(id, relay.id, () => this.takeIn(id, relay.id));
    }
    return due;
  }

  private acknowledge(id: string, messageId: string, agree: boolean, text: string) {
    this.update(id, (c) => {
      const m = c.view.messages.find((x) => x.id === messageId);
      const s = c.view.steering;
      if (!m || !s || s.acks.some((a) => a.message === messageId)) return;
      const ack = { id: this.next('dk'), message: messageId, by: m.to, agree, text, at: Date.now() };
      return { view: { ...c.view, steering: { ...s, acks: [...s.acks, ack].slice(-STEERING_VIEW_LIMITS.acks) } } };
    });
  }

  /** Remind nudges whoever holds a message; Escalate tells their manager, or the CEO. */
  private nudge(id: string, messageId: string, person: string, kind: 'remind' | 'escalate') {
    const v = this.find(id)?.view;
    if (!v) throw refused(404, "That company isn't in the lobby any more.", 'gone');
    const m = v.messages.find((x) => x.id === messageId);
    if (!m) throw refused(404, "There's no message of yours with that id.", 'unknown');
    const root = rootOf(v, m);
    if (root.from !== STAKEHOLDER) throw refused(400, 'Only your own messages have a trace to follow.', 'invalid');
    const holder = personIn(v, person);
    const family = familyOf(v, root);
    const held = v.messages.find((x) => family.has(x.id) && x.to === holder.id);
    if (!held) throw refused(409, `${capital(nameOf(v, holder.id))} hasn't had that message yet; remind whoever holds it.`, 'conflict');
    const waiting = (root.for ?? []).filter((f) => f !== holder.id && !v.messages.some((x) => family.has(x.id) && x.to === f));
    const names = listOf(waiting.map((f) => nameOf(v, f)));
    const quoted = `“${clip(root.text, 160)}”`;
    const base = { origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false, cites: [root.id] };
    if (kind === 'remind') {
      const text = `A reminder about my message ${root.id}: ${quoted} ${waiting.length > 0 ? `Please pass it on to ${names}, or tell me why not.` : 'Please acknowledge it: what you will do with it, or why you disagree.'}`;
      const r = this.send(id, { ...base, from: STAKEHOLDER, to: holder.id, text });
      this.deliverSoon(id, r.id, () => {
        this.acknowledge(id, held.id, true, waiting.length > 0 ? `Sorry, passing it on to ${names} now.` : "Got it. I'll take it into my next step.");
        this.acknowledge(id, r.id, true, 'Thanks for the nudge.');
        this.passOn(id, held, holder);
      });
      return;
    }
    if (holder.level === 'ceo') throw refused(409, 'The CEO answers to you: remind them instead.', 'conflict');
    const boss = managerOf(v.people, holder.id) ?? ceoOf(v);
    const text = `My message ${root.id} is stuck with ${nameOf(v, holder.id)}: ${quoted}${waiting.length > 0 ? ` It hasn't reached ${names} yet.` : ''} Please make sure it gets where it should.`;
    const e = this.send(id, { ...base, from: STAKEHOLDER, to: boss.id, text });
    this.deliverSoon(id, e.id, () => {
      this.acknowledge(id, e.id, true, waiting.length > 0 ? `I'll make sure it reaches ${names}.` : `I'll ask ${nameOf(v, holder.id)} about it.`);
      this.passOn(id, root, boss);
    });
  }

  /** Pauses or resumes tasks: a working owner gets "stop and wait" as an interrupt; a resumed one goes back to work. */
  private hold(id: string, tasks: Task[], pause: boolean, decision: DecisionInput) {
    const ids = new Set(tasks.map((t) => t.id));
    const stopping: string[] = [];
    this.update(id, (c) => {
      const now = Date.now();
      const next = c.view.tasks.map((t) => (ids.has(t.id) ? { ...t, paused: pause ? { at: now, by: STAKEHOLDER } : null, updatedAt: now } : t));
      const people = c.view.people.map((p) => {
        if (!p.task || !ids.has(p.task)) return p;
        const busy = p.desk.state === 'working' || p.desk.state === 'starting';
        if (pause && busy) {
          stopping.push(p.id);
          return { ...p, desk: { ...p.desk, state: 'stopping' as const, since: now } };
        }
        if (!pause && p.desk.state === 'idle') return { ...p, desk: { ...p.desk, state: 'working' as const, since: now } };
        return p;
      });
      return { view: this.withDecision(id, { ...c.view, tasks: next, people }, decision) };
    });
    for (const t of tasks) {
      if (pause && stopping.includes(t.owner)) {
        const m = this.send(id, { from: THE_OFFICE, to: t.owner, text: `Stop and wait: “${t.title}” is paused until it is resumed.`, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: true });
        this.later(1_200, () => {
          this.deliver(id, m.id);
          this.setDesk(id, t.owner, 'idle');
          this.post(id, { person: t.owner, text: `Paused “${t.title}” until it is resumed.`, taskId: t.id, cites: [] });
        });
      } else if (!pause) {
        this.post(id, { person: t.owner, text: `Back on “${t.title}”.`, taskId: t.id, cites: [] });
      }
    }
  }

  /** Takes a decision back: the change that undoes it, without a decision of its own (the undo entry is that). */
  private takeBack(id: string, undo: DemoUndo) {
    switch (undo.kind) {
      case 'rehire':
      case 'fire': {
        const result = this.reshape(id, { action: undo.kind, role: undo.role });
        if (!result.ok) throw refused(409, result.message, 'conflict');
        return;
      }
      case 'theme':
        this.update(id, (c) => {
          const result = officeChangeIn(c.view, { change: 'theme', theme: undo.theme }, c.extras.decor);
          return { view: { ...result.view, log: [...result.view.log, { at: Date.now(), kind: 'office', by: STAKEHOLDER, text: result.message }] } };
        });
        return;
      case 'settings':
        this.update(id, (c) => ({ view: settingsIn(c.view, undo.change, Date.now(), knownRooms(c)).view }));
        return;
      case 'add-rule':
        this.update(id, (c) => ({ view: { ...c.view, settings: { ...c.view.settings, alwaysAllow: [...new Set([...c.view.settings.alwaysAllow, undo.rule])] } } }));
        return;
      case 'restore-task':
        this.update(id, (c) => ({
          view: { ...c.view, tasks: c.view.tasks.map((t): Task => (t.id === undo.task ? { ...t, status: undo.status, outcome: null, cancel: null, paused: null, updatedAt: Date.now() } : t)) },
        }));
        return;
      case 'plan': {
        const kept = this.find(id)?.view.steering?.plan?.versions.find((x) => x.version === undo.version);
        if (!kept) throw refused(409, `Version ${undo.version} of the plan isn't kept any more, so the edit can't be undone.`, 'conflict');
        this.update(id, (c) => {
          const current = latestVersion(steeringOf(c.view));
          return { view: withVersion(c.view, { version: current.version + 1, by: STAKEHOLDER, at: Date.now(), plan: structuredClone(kept.plan), note: `Back to version ${undo.version}.`, cites: [] }) };
        });
        return;
      }
    }
  }

  private reshape(id: string, action: ReshapeAction): ReshapeResult {
    const c = this.find(id);
    if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
    const changed = ['.claude/studio.yaml'];
    switch (action.action) {
      case 'fire': {
        const p = this.person(id, action.role);
        if (p.level === 'ceo') return { ok: false, message: 'The CEO runs the company, so nobody can fire them.', changed: [] };
        const name = nameOf(c.view, p.id);
        const manager = p.reportsTo ? nameOf(c.view, p.reportsTo) : 'the CEO';
        this.update(id, (d) => ({
          view: {
            ...d.view,
            people: d.view.people.filter((x) => x.id !== p.id).map((x) => (x.reportsTo === p.id ? { ...x, reportsTo: p.reportsTo } : x)),
            tasks: d.view.tasks.map((t) => (t.owner === p.id && t.status !== 'done' && t.status !== 'dropped' ? { ...t, owner: p.reportsTo ?? t.owner, status: 'queued' } : t)),
            approvals: d.view.approvals.map((a) => (a.person === p.id && open(a) ? { ...a, withdrawn: { reason: `${name} was fired.`, at: Date.now() } } : a)),
            log: [...d.view.log, { at: Date.now(), kind: 'fire', by: STAKEHOLDER, text: `You fired ${name}.` }],
          },
          extras: {
            ...d.extras,
            fired: [...(d.extras.fired ?? []), { id: p.id, department: p.room, title: p.title, file: `.claude/agents/.fired/${p.id}.md`, name: p.name, level: p.level, ...(p.reportsTo ? { reportsTo: p.reportsTo } : {}), look: p.look }],
          },
        }));
        this.firedPeople.set(`${id}/${p.id}`, p);
        return { ok: true, message: `${name} was fired. Their task goes back to ${manager}.`, changed };
      }
      case 'rehire': {
        const p = this.firedPeople.get(`${id}/${action.role}`);
        const record = c.extras.fired?.find((f) => f.id === action.role);
        if (!record) return { ok: false, message: "That role isn't among the people fired.", changed: [] };
        const back: PersonView = p ?? {
          id: record.id, name: record.name ?? record.title, title: record.title, level: record.level ?? 'worker', room: record.department, reportsTo: record.reportsTo ?? null,
          look: record.look ?? {}, model: 'sonnet', desk: closedDesk(record.id, Date.now()), task: null, status: null, agentKey: null, cost: 0,
        };
        this.update(id, (d) => ({
          view: { ...d.view, people: [...d.view.people, { ...back, desk: closedDesk(back.id, Date.now()) }], log: [...d.view.log, { at: Date.now(), kind: 'rehire', by: STAKEHOLDER, text: `You rehired ${back.name}.` }] },
          extras: { ...d.extras, fired: (d.extras.fired ?? []).filter((f) => f.id !== action.role) },
        }));
        return { ok: true, message: `${back.name} is back at their desk.`, changed };
      }
      case 'hire': {
        // The rule of src/server/reshape.ts: a named manager must be on staff and able to manage; otherwise the head of
        // the room, or the CEO.
        const roleId = typeof action.role === 'string' ? action.role.trim() : '';
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(roleId)) return { ok: false, message: 'A role is an id like "qa-engineer".', changed: [] };
        if (c.view.people.some((x) => x.id === roleId)) return { ok: false, message: `"${roleId}" already works here.`, changed: [] };
        const room = action.department ?? 'engineering';
        if (!knownRooms(c).has(room)) return { ok: false, message: `There is no "${room}" room.`, changed: [] };
        const named = action.reportsTo;
        let boss: PersonView | undefined;
        if (named !== undefined) {
          boss = typeof named === 'string' ? c.view.people.find((x) => x.id === named) : undefined;
          const gone = typeof named === 'string' && (c.extras.fired ?? []).some((f) => f.id === named);
          if (!boss) return { ok: false, message: gone ? `"${named}" was fired, so nobody can report to them; rehire them first.` : `"${String(named)}" is not on the staff.`, changed: [] };
          if (boss.level === 'worker') return { ok: false, message: `"${boss.id}" is a worker; people report to the CEO, a head or a team lead.`, changed: [] };
        } else {
          boss = c.view.people.find((x) => x.level === 'head' && x.room === room) ?? c.view.people.find((x) => x.level === 'ceo');
        }
        const title = roleId.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
        const hired: PersonView = {
          id: roleId, name: title, title, level: 'worker', room, reportsTo: boss?.id ?? null, look: {}, model: 'sonnet',
          desk: closedDesk(roleId, Date.now()), task: null, status: null, agentKey: null, cost: 0,
        };
        this.update(id, (d) => ({
          view: { ...d.view, people: [...d.view.people, hired], log: [...d.view.log, { at: Date.now(), kind: 'hire', by: STAKEHOLDER, text: `You hired ${title}.` }] },
        }));
        return { ok: true, message: `${title} joined, reporting to ${boss ? nameOf(c.view, boss.id) : 'nobody'}.`, changed };
      }
      case 'move': {
        const p = this.person(id, action.role);
        this.update(id, (d) => ({ view: { ...d.view, people: d.view.people.map((x) => (x.id === p.id ? { ...x, room: action.department } : x)) } }));
        return { ok: true, message: `${nameOf(c.view, p.id)} moved rooms.`, changed };
      }
      case 'model': {
        const p = this.person(id, action.role);
        this.update(id, (d) => ({ view: { ...d.view, people: d.view.people.map((x) => (x.id === p.id ? { ...x, model: action.model } : x)) } }));
        return { ok: true, message: `${nameOf(c.view, p.id)} works on ${action.model === 'inherit' ? 'your own model' : action.model.charAt(0).toUpperCase() + action.model.slice(1)} from their next step.`, changed };
      }
      default:
        return { ok: false, message: "The demo doesn't change that. In a company it would.", changed: [] };
    }
  }

  hub(): HubActions {
    return {
      createCompany: async (folder, prompt, work) => {
        const root = folder.trim().replace(/[\\/]+$/, '');
        const words = prompt.trim();
        // v0.8: nothing runs in the browser, so one Claude Code session is the recorded run, replayed (the form says so).
        if (work === 'plain') {
          if (!words) throw refused(400, 'Say what to build.', 'invalid');
          return { id: await this.startReplay() };
        }
        if (!/^[A-Za-z]:\\/.test(root) && !root.startsWith('/')) throw refused(400, `Give the folder's full path, like ${HOME}\\plant-pal.`, 'bad-folder');
        if (sameFolder(root, HOME)) throw refused(400, "That's your home folder. Pick a folder in it.", 'bad-folder');
        for (const c of this.companies) {
          if (sameFolder(c.root, root)) throw refused(409, `${c.view.name} already runs here. Open it from the lobby.`, 'exists');
          if (insideOf(c.root, root)) throw refused(409, `That's inside ${c.view.name}'s folder. Pick another.`, 'inside');
          if (insideOf(root, c.root)) throw refused(409, `${c.view.name}'s folder is inside that one. Pick another.`, 'around');
        }
        const back = this.removed.find((c) => sameFolder(c.root, root));
        if (back) {
          this.removed = this.removed.filter((c) => c !== back);
          this.companies.push(back);
          this.emit();
          return { id: back.view.id };
        }
        const parent = parentOf(root);
        if (!Object.hasOwn(this.tree, root)) {
          if (!parent || !Object.hasOwn(this.tree, parent)) throw refused(400, "That folder doesn't exist, and neither does the folder it would go in. Make it with New folder here.", 'missing');
          this.tree[parent] = [...(this.tree[parent] ?? []), baseName(root)];
          this.tree[root] = [];
        }
        if (!words) throw refused(400, 'Say what to build.', 'invalid');
        return { id: this.found(root, words) };
      },
      removeCompany: async (companyId) => {
        const replay = this.replays.get(companyId);
        if (replay) {
          replay.stop();
          this.replays.delete(companyId);
          this.emit();
          return;
        }
        const c = this.find(companyId);
        if (!c) throw refused(404, "That company isn't in the lobby any more.", 'gone');
        this.companies = this.companies.filter((x) => x !== c);
        this.removed.push(c);
        this.emit();
      },
      reopenCompany: async (folder) => {
        const back = this.removed.find((c) => sameFolder(c.root, folder));
        if (!back) throw refused(404, 'No company worked in that folder.', 'unknown');
        this.removed = this.removed.filter((c) => c !== back);
        this.companies.push(back);
        this.emit();
        return { id: back.view.id };
      },
      setHubDesks: async (maxDesks) => {
        if (!Number.isInteger(maxDesks) || maxDesks < 1 || maxDesks > 40) throw refused(400, 'Pick 1 to 40 desks.', 'invalid');
        this.maxDesks = maxDesks;
        this.emit();
      },
      folders: async (path) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return this.listing(path.trim().replace(/[\\/]+$/, '') || HOME);
      },
      newFolder: async (parent, name) => {
        const folder = parent.trim().replace(/[\\/]+$/, '');
        const words = name.trim();
        if (!Object.hasOwn(this.tree, folder)) throw refused(404, "The folder to put it in doesn't exist.", 'missing');
        if (!words) throw refused(400, 'Name the new folder.', 'invalid');
        if (/[<>:"/\\|?*]|[. ]$/.test(words)) throw refused(400, 'A folder name can\'t hold < > : " / \\ | ? * or end in a dot or a space. Try another name.', 'invalid');
        if ((this.tree[folder] ?? []).some((f) => f.toLowerCase() === words.toLowerCase())) throw refused(409, 'That folder already exists.', 'exists');
        const path = joinPath(folder, words);
        this.tree[folder] = [...(this.tree[folder] ?? []), words];
        this.tree[path] = [];
        return path;
      },
    };
  }

  private listing(path: string): FolderInfo {
    if (!Object.hasOwn(this.tree, path)) throw refused(404, "That folder doesn't exist.", 'missing');
    const notes: string[] = [];
    for (const c of this.companies) {
      if (sameFolder(c.root, path)) notes.push(`${c.view.name} already runs here.`);
      else if (insideOf(c.root, path)) notes.push(`That's inside ${c.view.name}'s folder.`);
      else if (insideOf(path, c.root)) notes.push(`${c.view.name}'s folder is inside this one.`);
    }
    const folders = [...(this.tree[path] ?? [])].sort((a, b) => a.localeCompare(b));
    if (DEMO_NOT_GIT.has(path) || !Object.hasOwn(DEMO_DETECTED, path)) {
      notes.push(folders.length === 0 ? 'Not a git repository: starting runs git init so the work has its own branch.' : "Not a git repository, so finished tasks won't be committed until it is one.");
    }
    if (DEMO_UNCOMMITTED.has(path)) notes.push('It has uncommitted changes; the company leaves them be.');
    return { path, parent: parentOf(path), folders, detected: DEMO_DETECTED[path] ?? (folders.length === 0 ? 'An empty folder.' : 'A folder with no app Worklings recognises.'), notes, refusal: null, packs: noPacks(folders.length === 0) };
  }

  /**
   * A new company: the CEO alone, reading the folder, then asking its scoping questions a few seconds later. Your
   * answers (or its picks) start the draft (`draft`), and the proposal follows.
   */
  private found(root: string, prompt: string): string {
    const base = baseName(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    let id = base;
    for (let i = 2; this.find(id) || this.removed.some((c) => c.view.id === id) || id === 'demo'; i++) id = `${base}-${i}`;
    const now = Date.now();
    const template = demoFoundingView(now);
    const name = baseName(root);
    const people = template.people.map((p) => ({ ...p, desk: { ...p.desk, state: 'starting' as const, since: now }, status: null, cost: 0 }));
    const view: CompanyView = recount({
      ...template, id, name, prompt, people, statuses: [], messages: [], questions: [], scoping: null, log: [{ at: now, kind: 'founded', by: STAKEHOLDER, text: `You started ${name}.` }],
      spend: { samples: [], hourly: [], byPerson: [] },
    });
    this.companies.push({ view, root, extras: { departments: [...DEMO_DEPARTMENTS], decor: demoDecor(view), fired: [] }, ceoProposal: null });
    this.emit();
    const detected = DEMO_DETECTED[root] ?? 'an empty folder';
    this.later(800, () => this.setDesk(id, 'ceo', 'working'));
    this.later(1_800, () => this.post(id, { person: 'ceo', text: `Reading the folder: ${detected.charAt(0).toLowerCase()}${detected.slice(1).replace(/\.$/, '')}.`, taskId: null }));
    this.later(3_500, () => {
      const asked = demoScoping(id, DEMO_SCOPING, Date.now(), null);
      this.update(id, (c) => ({
        view: {
          ...c.view,
          questions: [...c.view.questions, presetQuestionOf(c.view, this.next('q'), Date.now()), ...asked.questions],
          scoping: asked.scoping,
          log: [...c.view.log, { at: Date.now(), kind: 'scoping', by: 'ceo', text: 'The CEO asked four questions to scope the company before drafting it.' }],
        },
      }));
      this.setDesk(id, 'ceo', 'idle');
      this.post(id, { person: 'ceo', text: 'Asked you four questions before drafting.', taskId: null });
    });
    return id;
  }

  /** The CEO drafts from your scoping answers: a small org for a quick prototype, Plant Pal's for anything more. */
  private draft(id: string, prototype: boolean) {
    const prompt = this.find(id)?.view.prompt ?? '';
    this.setDesk(id, 'ceo', 'working');
    this.later(1_000, () => this.post(id, { person: 'ceo', text: `Drafting from your answers: looking through the library for the roles ${this.find(id)?.view.name ?? 'it'} needs.`, taskId: null }));
    this.later(5_000, () => {
      const proposal = prototype ? demoSmallProposal(titleFromId(id), prompt) : { ...demoProposal(), company: titleFromId(id), goal: prompt };
      this.update(id, (c) => ({
        view: {
          ...c.view,
          phase: 'proposed',
          proposal,
          questions: [...c.view.questions, ...proposalQuestions(proposal, id, Date.now())],
          log: [...c.view.log, { at: Date.now(), kind: 'proposal', by: 'ceo', text: `The CEO proposed an org of ${proposal.people.length} people.` }],
        },
        ceoProposal: proposal,
      }));
      this.setDesk(id, 'ceo', 'idle');
      this.post(id, { person: 'ceo', text: `The proposal is ready: ${proposal.people.length} people in ${proposal.rooms.length} rooms.`, taskId: null });
      const asks = proposal.questions.length > 0 ? ` ${capital(countWord(proposal.questions.length))} questions are open for you; starting uses my picks for them.` : '';
      this.send(id, { from: 'ceo', to: STAKEHOLDER, text: `My proposal is ready.${asks}`, origin: null, relayOf: null, note: null, deliveredAt: Date.now(), interrupt: false });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Steering in the demo: pure changes to a company's view, and the company's refusals as sentences

/** A decision before it has an id and a time; `undo` is what takes it back, when it can be. */
type DecisionInput = Pick<Decision, 'by' | 'kind' | 'what' | 'people' | 'rooms'> & Partial<Pick<Decision, 'why' | 'alternatives' | 'links'>> & { undo?: DemoUndo | null };

const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** A copy of a table keyed by ids, with one key set or (null) removed. */
function withKey<T>(table: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const out = dict<T>();
  for (const [k, v] of Object.entries(table)) if (k !== key) out[k] = v;
  if (value !== null) out[key] = value;
  return out;
}

/** Keeps each person's leash and effort in step with the people and the settings. */
/**
 * The checklist a stakeholder's edit keeps. The office's own check reads it once the plan's checklist rules are in
 * (src/core/plan.ts); until then it is carried from what was sent, its covers kept to the tasks the plan still has.
 */
function keptChecklist(checked: Plan, sent: Plan): Plan {
  if (checked.checklist !== undefined || !sent.checklist) return checked;
  const ids = new Set(checked.tasks.map((t) => t.id));
  return { ...checked, checklist: sent.checklist.map((k) => ({ ...k, covers: k.covers.filter((id) => ids.has(id)) })) };
}

function syncSteering(view: CompanyView): CompanyView {
  const s = view.steering;
  return s ? { ...view, steering: { ...s, people: personSteering(s.settings, view.people) } } : view;
}

function steeringOf(view: CompanyView): SteeringView {
  if (!view.steering) throw refused(409, 'This company started before steering, so it has no plan, leash or decision log.', 'closed');
  return view.steering;
}

function latestVersion(steering: SteeringView): PlanVersion {
  const latest = steering.plan?.versions.at(-1);
  if (!latest) throw refused(409, "There's no plan yet: the CEO hasn't proposed one.", 'closed');
  return latest;
}

function withPlan(view: CompanyView, change: (plan: PlanView) => PlanView): CompanyView {
  const s = view.steering;
  return s?.plan ? { ...view, steering: { ...s, plan: change(s.plan) } } : view;
}

const withVersion = (view: CompanyView, version: PlanVersion): CompanyView =>
  withPlan(view, (plan) => ({ ...plan, versions: [...plan.versions, version].slice(-STEERING_VIEW_LIMITS.planVersions) }));

function withStatus(view: CompanyView, line: StatusLine): CompanyView {
  return {
    ...view,
    statuses: [...view.statuses, line],
    people: view.people.map((p) => (p.id === line.person && (!p.status || line.at >= p.status.at) ? { ...p, status: line } : p)),
  };
}

function personIn(view: CompanyView, id: string): PersonView {
  const p = view.people.find((x) => x.id === id);
  if (!p) throw refused(404, `There's nobody called "${clip(id, 64)}" in the company.`, 'unknown');
  return p;
}

function taskIn(view: CompanyView, id: string): Task {
  const t = view.tasks.find((x) => x.id === id);
  if (!t) throw refused(404, `There's no task ${clip(id, 40)}.`, 'unknown');
  return t;
}

const ceoOrNull = (view: CompanyView): PersonView | null => view.people.find((p) => p.level === 'ceo') ?? null;

function ceoOf(view: CompanyView): PersonView {
  const ceo = ceoOrNull(view);
  if (!ceo) throw refused(409, 'The company has no CEO to take it.', 'closed');
  return ceo;
}

const chainUpOf = (view: CompanyView, id: string) => chainUp(view.people, id);

const roomsOf = (view: CompanyView, people: readonly string[]): string[] => [...new Set(people.flatMap((id) => view.people.find((p) => p.id === id)?.room ?? []))];

const ownerRoom = (view: CompanyView, task: Task): string | undefined => view.people.find((p) => p.id === task.owner)?.room;

/** "the design room", for a room the office has. */
function roomTitleIn(view: CompanyView, departments: readonly StudioDepartment[], room: string): string {
  const name = departments.find((d) => d.id === room)?.name ?? view.rooms.find((r) => r.id === room)?.title ?? (view.people.some((p) => p.room === room) ? titleFromId(room) : null);
  if (name === null) throw refused(404, `There's no room “${clip(room, 40)}” in the office.`, 'unknown');
  return /\broom$/i.test(name) ? `the ${inSentence(name)}` : `the ${inSentence(name)} room`;
}

const roomTitle = (c: DemoCompany, room: string): string => roomTitleIn(c.view, c.extras.departments ?? [], room);

/** The rooms a leash can be set on, and how a sentence names them. */
function knownRooms(c: DemoCompany): { has: (room: string) => boolean; title: (room: string) => string } {
  const ids = new Set([...(c.extras.departments ?? []).map((d) => d.id), ...c.view.people.map((p) => p.room)]);
  return { has: (room) => ids.has(room), title: (room) => roomTitle(c, room) };
}

const listOf = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);
const endSentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';

/** The message a relay passes on, all the way up: the stakeholder's own. */
function rootOf(view: CompanyView, m: Message): Message {
  let at = m;
  const seen = new Set([m.id]);
  for (let up = view.messages.find((x) => x.id === at.relayOf); up && !seen.has(up.id); up = view.messages.find((x) => x.id === at.relayOf)) {
    seen.add(up.id);
    at = up;
  }
  return at;
}

/** A stakeholder message's copies (one per person for a room, a team or everyone) and every relay of them. */
function familyOf(view: CompanyView, root: Message): Set<string> {
  const group = root.audience?.group;
  const copies = new Set(view.messages.filter((x) => x.id === root.id || (group !== undefined && x.from === root.from && x.audience?.group === group)).map((x) => x.id));
  const family = new Set(copies);
  for (const x of view.messages) if (copies.has(rootOf(view, x).id)) family.add(x.id);
  return family;
}

/** Who gets a message, and the audience each copy names. */
function recipientsOf(view: CompanyView, to: Recipient, departments: readonly StudioDepartment[]): { people: PersonView[]; audience: Omit<Audience, 'group'> | null } {
  switch (to.kind) {
    case 'person':
      return { people: [personIn(view, to.id)], audience: null };
    case 'room': {
      const title = roomTitleIn(view, departments, to.id);
      const people = view.people.filter((p) => p.room === to.id);
      if (people.length === 0) throw refused(409, `Nobody works in ${title} yet.`, 'conflict');
      return { people, audience: { kind: 'room', id: to.id, title } };
    }
    case 'team': {
      const head = personIn(view, to.head);
      const name = nameOf(view, head.id);
      if (head.level !== 'ceo' && head.level !== 'head' && head.level !== 'lead') throw refused(400, `${capital(name)} has no team: message them on their own, or their room.`, 'invalid');
      const ids = new Set([head.id, ...below(view.people, head.id).map((p) => p.id)]);
      return { people: view.people.filter((p) => ids.has(p.id)), audience: { kind: 'team', id: head.id, title: `${name}'s team` } };
    }
    case 'everyone':
      return { people: [...view.people], audience: { kind: 'everyone', id: null, title: 'everyone' } };
  }
}

// ----- The task board

const byPriority = (a: Task, b: Task): number => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;
const openInOrder = (tasks: readonly Task[]): Task[] => tasks.filter(isOpenTask).sort(byPriority);

/** Gives the tasks in `line` their places 1, 2, 3...; the rest keep theirs. */
function ranked(tasks: readonly Task[], line: readonly string[]): Task[] {
  const place = new Map(line.map((t, i) => [t, i + 1]));
  return tasks.map((t) => {
    const p = place.get(t.id);
    return p === undefined || p === t.priority ? t : { ...t, priority: p };
  });
}

/** The tasks a reorder moved: those outside the longest run that kept its order. */
function movedIn(before: readonly string[], after: readonly string[]): string[] {
  const w = after.length + 1;
  const table = new Array<number>((before.length + 1) * w).fill(0);
  const at = (i: number, j: number) => table[i * w + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) table[i * w + j] = before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  }
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    if (before[i] === after[j]) {
      kept.add(after[j] ?? '');
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  return after.filter((t) => !kept.has(t));
}

/** Whoever works on a task stops: their desk goes idle and the task is no longer theirs to show. */
function stopWorkOn(view: CompanyView, taskId: string, now: number): CompanyView {
  return {
    ...view,
    people: view.people.map((p) => {
      if (p.task !== taskId) return p;
      const busy = p.desk.state === 'working' || p.desk.state === 'starting';
      return { ...p, task: null, desk: busy ? { ...p.desk, state: 'idle' as DeskState, since: now } : p.desk };
    }),
  };
}

const normalizeFile = (raw: string): string =>
  raw
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');

/** Whether two owned paths touch: the same file, or one is a folder the other is inside. */
function overlaps(a: string, b: string): boolean {
  const x = normalizeFile(a).toLowerCase();
  const y = normalizeFile(b).toLowerCase();
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
}

/** The company's checks on a path a task owns, as its sentences say them. */
function fileProblem(raw: string): string | null {
  const shown = `"${clip(raw, 80)}"`;
  const path = normalizeFile(raw);
  if (raw.length > LIMITS.path) return `a path can be up to ${LIMITS.path} characters; ${shown} is longer`;
  if (/^(?:[\\/~]|[a-zA-Z]:)/.test(raw.trim())) return `${shown} is an absolute path; name files relative to the project, like src/app.ts`;
  if (path === '') return 'a file path is empty; name the files or folders the task owns, or none';
  if (/\p{Cc}/u.test(raw) || raw.includes(':')) return `${shown} has a character a project path can't have`;
  const parts = path.split('/');
  if (parts.includes('..')) return `${shown} leaves the project; name files inside it`;
  if (['.worklings', '.git'].includes((parts[0] ?? '').toLowerCase())) return `${shown} is git's or Worklings' own folder, which no task owns`;
  return null;
}

function checkFiles(raw: readonly string[]): string[] {
  if (raw.length > LIMITS.files) throw refused(400, `A task owns up to ${LIMITS.files} files or folders, and this one names ${raw.length}; name folders instead of every file.`, 'invalid');
  const files: string[] = [];
  for (const entry of raw) {
    const problem = fileProblem(entry);
    if (problem) throw refused(400, `${capital(problem)}.`, 'invalid');
    const path = normalizeFile(entry);
    if (!files.some((f) => f.toLowerCase() === path.toLowerCase())) files.push(path);
  }
  return files;
}

/** No two open tasks own the same file: the company's sentence when they would. */
function refuseOverlaps(view: CompanyView, files: readonly string[]): void {
  for (const other of view.tasks) {
    if (!isOpenTask(other)) continue;
    for (const mine of files) {
      const theirs = other.files.find((f) => overlaps(f, mine));
      if (theirs === undefined) continue;
      const path = normalizeFile(theirs);
      const what = path.length > mine.length ? `${path} (in ${mine})` : mine;
      throw refused(409, `${what} already belongs to ${nameOf(view, other.owner)}'s task "${other.title}".`, 'conflict');
    }
  }
}

// ----- The plan

/**
 * Approves a version through a milestone (null: all of it). The goal takes the plan's milestones; open tasks made from
 * the plan follow it (cut ones are cancelled onto a branch, changed ones change) and line up in its order; a milestone
 * waiting for approval stops waiting once the approval reaches past it.
 */
function approveIn(view: CompanyView, version: PlanVersion, through: string | null, now: number): CompanyView {
  const s = steeringOf(view);
  if (!s.plan) return view;
  const n = version.version;
  const order = version.plan.milestones.map((m) => m.id);
  const hold = s.plan.waiting;
  const waiting = hold && (through === null || order.indexOf(through) > order.indexOf(hold.milestone)) ? null : hold;
  const goal = view.goal && {
    ...view.goal,
    text: version.plan.goal,
    milestones: version.plan.milestones.map((m) => ({ ...m, doneAt: view.goal?.milestones.find((g) => g.id === m.id)?.doneAt ?? null })),
  };
  const planned = new Map(version.plan.tasks.map((t) => [t.id, t]));
  const tasks = view.tasks.map((t): Task => {
    if (!t.planTask || !isOpenTask(t)) return t;
    const p = planned.get(t.planTask);
    if (!p) {
      const reason = `Cut from the plan in version ${n}.`;
      return { ...t, status: 'dropped', outcome: reason, paused: null, cancel: { at: now, by: STAKEHOLDER, reason, branch: t.worktree?.branch ?? `worklings/${t.id}-${slug(t.title)}` }, updatedAt: now };
    }
    const handed = p.owner !== t.owner;
    if (!handed && p.title === t.title && p.brief === t.brief && p.doneWhen === t.doneWhen && p.milestone === t.milestone && p.files.join('\n') === t.files.join('\n')) return t;
    const handovers = handed ? [...(t.handovers ?? []), { at: now, by: STAKEHOLDER, from: t.owner, to: p.owner, note: `Version ${n} of the plan gives it to ${nameOf(view, p.owner)}.` }] : (t.handovers ?? []);
    return { ...t, title: p.title, brief: p.brief, doneWhen: p.doneWhen, milestone: p.milestone, files: [...p.files], owner: p.owner, handovers, updatedAt: now };
  });
  const place = (t: Task) => (t.planTask ? version.plan.tasks.findIndex((p) => p.id === t.planTask) : -1);
  const line = openInOrder(tasks);
  const inPlan = line.filter((t) => place(t) >= 0).sort((a, b) => place(a) - place(b));
  let k = 0;
  const reordered = line.map((t) => (place(t) >= 0 ? (inPlan[k++] ?? t) : t)).map((t) => t.id);
  return {
    ...view,
    goal,
    tasks: ranked(tasks, reordered),
    steering: { ...s, plan: { ...s.plan, approved: { version: n, through, at: now, by: STAKEHOLDER, cites: [] }, waiting } },
  };
}

// ----- Settings, the leash, model and effort

const APPROVAL_WORDS: Record<PlanApproval, string> = { 'before-work': 'before work starts', milestones: 'at every milestone', off: 'off' };
const EFFORT_WORDS: Record<Effort, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max' };
const MODEL_WORDS: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', inherit: 'your own model' };

function leashWords(who: string, leash: Leash | null): string {
  if (leash === null) return `You cleared ${who}'s own leash.`;
  if (leash === 'check') return `You set ${who} to check with you before each task.`;
  if (leash === 'trusted') return `You made ${who} Trusted.`;
  return `You put ${who} on the company's approvals.`;
}

/**
 * One change to the settings, checked as the company checks it. Returns the new view and a decision per thing that
 * changed, each with the change that undoes it. Someone who stops checking with you loses their open "start?" questions.
 */
function settingsIn(view: CompanyView, change: SettingsChange, now: number, rooms: ReturnType<typeof knownRooms>): { view: CompanyView; changes: DecisionInput[] } {
  const steering = steeringOf(view);
  const you = STAKEHOLDER;
  let company = view.settings;
  let settings = steering.settings;
  let people = view.people;
  const changes: DecisionInput[] = [];
  const setting = (what: string, undo: SettingsChange, about: string[] = [], where: string[] = []) => changes.push({ by: you, kind: 'setting', what, people: [you, ...about], rooms: where, undo: { kind: 'settings', change: undo } });
  if (Object.values(change).every((v) => v === undefined)) throw refused(400, 'Say what to change.', 'invalid');
  if (change.maxDesks !== undefined) {
    const n = change.maxDesks;
    if (!Number.isInteger(n) || n < 1 || n > 20) throw refused(400, 'Desks at once is a whole number from 1 to 20.', 'invalid');
    if (n !== company.maxDesks) setting(`You set ${countWord(n)} ${n === 1 ? 'desk' : 'desks'} at once.`, { maxDesks: company.maxDesks });
    company = { ...company, maxDesks: n };
  }
  if (change.idleMs !== undefined) {
    const ms = change.idleMs;
    if (!Number.isInteger(ms) || ms < 60_000 || ms > 3_600_000) throw refused(400, 'An idle desk closes after 1 to 60 minutes.', 'invalid');
    const minutes = Math.round(ms / 60_000);
    if (ms !== company.idleMs) setting(`You set an idle desk to close after ${countWord(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`, { idleMs: company.idleMs });
    company = { ...company, idleMs: ms };
  }
  if (change.planApproval !== undefined) {
    const a = change.planApproval;
    if (!PLAN_APPROVALS.includes(a)) throw refused(400, 'Plan approval is before work starts, at every milestone, or off.', 'invalid');
    if (a !== settings.planApproval) setting(`You set plan approval to “${capital(APPROVAL_WORDS[a])}”.`, { planApproval: settings.planApproval });
    settings = { ...settings, planApproval: a };
  }
  if (change.leash !== undefined) {
    const l = change.leash;
    if (l.leash !== null && !LEASHES.includes(l.leash)) throw refused(400, 'A leash is check with me, default or trusted.', 'invalid');
    if ('person' in l) {
      const p = personIn(view, l.person);
      const before = own(settings.leash.people, p.id) ?? null;
      if (before !== l.leash) changes.push({ by: you, kind: 'leash', what: leashWords(nameOf(view, p.id), l.leash), people: [you, p.id], rooms: [p.room], undo: { kind: 'settings', change: { leash: { person: p.id, leash: before } } } });
      settings = { ...settings, leash: { ...settings.leash, people: withKey(settings.leash.people, p.id, l.leash) } };
    } else {
      if (!rooms.has(l.room)) throw refused(404, `There's no room “${clip(l.room, 40)}” in the office.`, 'unknown');
      const before = own(settings.leash.rooms, l.room) ?? null;
      const inRoom = view.people.filter((p) => p.room === l.room).map((p) => p.id);
      if (before !== l.leash) changes.push({ by: you, kind: 'leash', what: leashWords(rooms.title(l.room), l.leash), people: [you, ...inRoom], rooms: [l.room], undo: { kind: 'settings', change: { leash: { room: l.room, leash: before } } } });
      settings = { ...settings, leash: { ...settings.leash, rooms: withKey(settings.leash.rooms, l.room, l.leash) } };
    }
  }
  if (change.effort !== undefined) {
    const { person, effort } = change.effort;
    const p = personIn(view, person);
    if (effort !== null && !EFFORTS.includes(effort)) throw refused(400, 'Effort is low, medium, high, xhigh or max.', 'invalid');
    const before = own(settings.effort, p.id) ?? null;
    const who = nameOf(view, p.id);
    if (before !== effort) setting(effort ? `You set ${who}'s effort to ${EFFORT_WORDS[effort]}.` : `You set ${who}'s effort back to Claude Code's default.`, { effort: { person: p.id, effort: before } }, [p.id], [p.room]);
    settings = { ...settings, effort: withKey(settings.effort, p.id, effort) };
  }
  if (change.model !== undefined) {
    const { person, model } = change.model;
    const p = personIn(view, person);
    if (!(ROLE_MODELS as readonly string[]).includes(model)) throw refused(400, 'A model is opus, sonnet, haiku or inherit (your own).', 'invalid');
    if (p.model !== model) setting(`You moved ${nameOf(view, p.id)} to ${MODEL_WORDS[model] ?? model}.`, { model: { person: p.id, model: p.model } }, [p.id], [p.room]);
    people = people.map((x) => (x.id === p.id ? { ...x, model } : x));
  }
  if (change.removeRule !== undefined) {
    const rule = change.removeRule;
    if (!company.alwaysAllow.includes(rule)) throw refused(404, "There's no such rule to remove.", 'unknown');
    changes.push({ by: you, kind: 'rule', what: `You removed the rule ${rule}.`, people: [you], rooms: [], undo: { kind: 'add-rule', rule } });
    company = { ...company, alwaysAllow: company.alwaysAllow.filter((r) => r !== rule) };
  }
  const next = syncSteering({ ...view, settings: company, people, steering: { ...steering, settings } });
  const leashes = next.steering?.people ?? dict<PersonSteering>();
  const questions = next.questions.map((q) => {
    const owner = q.gate && q.answer === null && q.withdrawn === null ? gateOwnerIn(next, q) : null;
    return owner !== null && own(leashes, owner)?.leash !== 'check'
      ? { ...q, withdrawn: { reason: `${capital(nameOf(next, owner))} no longer checks with you before each task.`, at: now } }
      : q;
  });
  return { view: { ...next, questions }, changes };
}

/** Whose task the office's "start?" holds back: the gate's task's owner, or null once the task is gone. */
function gateOwnerIn(view: Pick<CompanyView, 'tasks'>, q: Question): string | null {
  return q.gate ? (view.tasks.find((t) => t.id === q.gate?.task)?.owner ?? null) : null;
}

/** The decisions an answer or an approval makes once it applies: an answer, an approval, and an Always allow rule. */
function settledDecisions(view: CompanyView, item: string): DecisionInput[] {
  const you = STAKEHOLDER;
  const q = view.questions.find((x) => x.id === item);
  if (q?.answer) {
    const task = q.taskId ? view.tasks.find((t) => t.id === q.taskId) : undefined;
    // The office asks the "start?" before a task, so that answer is about the task's owner.
    const person = (q.gate && task ? gateOwnerIn(view, q) : null) ?? q.from;
    const who = nameOf(view, person);
    const what =
      q.gate && task
        ? q.answer.option === 0 ? `You let ${who} start “${task.title}”.` : `You asked ${who} to wait with “${task.title}”.`
        : `You answered ${who}: ${endSentence(clip(q.answer.text, 200))}`;
    return [{ by: you, kind: 'answer', what, people: [you, person], rooms: roomsOf(view, [person]), links: { question: q.id, ...(q.taskId ? { task: q.taskId } : {}) } }];
  }
  const a = view.approvals.find((x) => x.id === item);
  if (!a?.answer) return [];
  const who = nameOf(view, a.person);
  const summary = inSentence(a.summary.replace(/\.$/, ''));
  const allowed = a.answer.decision === 'allow';
  const out: DecisionInput[] = [
    {
      by: you, kind: 'approval', why: a.answer.note, people: [you, a.person], rooms: roomsOf(view, [a.person]), links: { approval: a.id },
      what: allowed ? `You allowed ${who} to ${summary}${a.answer.always ? '' : ', once'}.` : `You said no to ${who}: ${summary}.`,
    },
  ];
  if (allowed && a.answer.always && a.alwaysRule) {
    out.push({
      by: you, kind: 'rule', what: `You always allowed ${a.alwaysRule.sentence}: ${a.alwaysRule.rule}.`, people: [you, a.person], rooms: roomsOf(view, [a.person]),
      links: { approval: a.id }, undo: { kind: 'settings', change: { removeRule: a.alwaysRule.rule } },
    });
  }
  return out;
}

let hub: DemoHub | null = null;

/** The demo hub this tab plays with: made on first use, kept until the tab closes. */
export function demoHub(): DemoHub {
  hub ??= new DemoHub(Date.now(), officeIsStill);
  return hub;
}

/**
 * The office is still: the person's switch (lib/still.ts marks the page with it) or the system's reduced motion. Read off
 * the globals as unknowns, because this file is also compiled and tested without the DOM.
 */
export function officeIsStill(): boolean {
  const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null;
  const doc: unknown = Reflect.get(globalThis, 'document');
  const root: unknown = isObject(doc) ? Reflect.get(doc, 'documentElement') : undefined;
  const dataset: unknown = isObject(root) ? Reflect.get(root, 'dataset') : undefined;
  if (isObject(dataset) && Reflect.get(dataset, 'still') === 'on') return true;
  const match: unknown = Reflect.get(globalThis, 'matchMedia');
  if (typeof match !== 'function') return false;
  const query: unknown = Reflect.apply(match, globalThis, ['(prefers-reduced-motion: reduce)']);
  return isObject(query) && Reflect.get(query, 'matches') === true;
}

/** The stakeholder's steering actions in a demo company, over the demo hub's local state (TabProps.steer). */
export function demoSteering(company: string, demo: DemoHub = demoHub()): SteeringActions {
  return demo.steering(company);
}

/** Tabs that opened the demo keep showing it (the lobby, a reload) until it is left. */
const DEMO_KEY = 'worklings-demo';
export const inDemo = (): boolean => sessionStorage.getItem(DEMO_KEY) === '1';
export const enterDemo = (): void => sessionStorage.setItem(DEMO_KEY, '1');
export const leaveDemo = (): void => sessionStorage.removeItem(DEMO_KEY);
