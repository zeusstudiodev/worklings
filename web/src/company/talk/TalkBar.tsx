// The talk bar (docs/design-v3.md, "Stage and dock", "The talk bar"; design-hud, "The talk bar"): the one box for
// talking. Left to right the To, the box, Send and Feed, with the hint row under them. `@` at the start picks who hears
// it, `@` after the first word says who it's for, `/` runs a command with its steps asked in the box, Up brings back
// what you sent, and Stop turns the bar into a person's Stop. Every message it sends is typed (`{ typed: true }`).
import { type ChangeEvent, type KeyboardEvent, type Ref, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Message } from '../../../../src/core/company.ts';
import type { Recipient } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { useMediaQuery, useReducedMotion } from '../../lib/hooks.ts';
import { recipientKey } from '../compose/recipients.ts';
import { callOf, doneLine, keepRecent, type PaletteCommand, paletteCommands, readRecents, stepValue, type TalkChip, talkChips } from '../palette/paletteModel.ts';
import { type CallResult as RunResult, decisionOf, perform, resultOf } from '../palette/run.ts';
import { useLibrary } from '../palette/useLibrary.ts';
import { useCompanyClock } from '../people/clock.ts';
import { called } from '../people/peopleModel.ts';
import { refusalOf } from '../people/shared.tsx';
import { STOP_AND_WAIT } from '../person/personModel.ts';
import type { TabProps } from '../types.ts';
import { draftScope } from '../ui/draftScope.ts';
import { Face } from '../ui/Face.tsx';
import { faceOfRecipient, Faces, Glyph } from './bits.tsx';
import { beginFlight, type FlightSession } from './sendFlight.ts';
import { TalkList } from './TalkList.tsx';
import {
  type CallResult,
  ceoOf,
  choiceList,
  commandList,
  counterLine,
  effectiveTo,
  FOUNDING_COMMAND,
  FOUNDING_MENTION,
  FOUNDING_PLACEHOLDER,
  SCOPING_PLACEHOLDER,
  forList,
  forPeopleOf,
  forWords,
  goneLine,
  initialTalk,
  keep,
  historyKey,
  keepSent,
  type ListGroup,
  type ListOption,
  listStatus,
  mentionsIn,
  optionLine,
  optionsOf,
  pickList,
  readHistory,
  readKept,
  RECONNECTING_HINT,
  type SendCall,
  sendOutcome,
  sendPlan,
  stillThere,
  talkChoices,
  talkReducer,
  TEACH,
  toWords,
  triggerAt,
  typedPicks,
  UNSENT_BACK,
  whatHappens,
  wordsLine,
  wordsToSend,
} from './talkModel.ts';
import { ToPicker } from './ToPicker.tsx';
import { scopingOf, scopingWaits } from '../proposal/model.ts';

/** What the dock asks of the bar for the office's TalkControl. */
export interface TalkBarApi {
  offer(to: Recipient): void;
  to(to: Recipient, options?: { focus?: boolean; draft?: string }): void;
  stop(person: string): void;
  focus(): void;
  /** Before the start: a suggestion's words into the box, the caret where it says. */
  suggest(text: string, caret?: number): void;
}

export interface FeedKey {
  open: boolean;
  /** The feed's element id, for aria-controls. */
  id: string;
  name: string;
  /** New replies to you and disagreements: an ink count. */
  count: number;
  /** Only other lines are new: an ink dot. */
  dot: boolean;
  toggle: () => void;
}

export interface TalkBarProps extends TabProps {
  founding: boolean;
  phone: boolean;
  /** A main view under 640 px, and phones: the compact form. */
  compact: boolean;
  /** A phone window under 560 px tall: Feed joins the bar, and the hint row shows only with focus. */
  short: boolean;
  feed: FeedKey;
  /** Where Escape in the bar goes once its own modes are done: the feed, while it is open. */
  onEscape: () => boolean;
  /** A chip under the empty box: runs its palette command as the palette does. Absent before the start. */
  onChip?: (chip: TalkChip) => void;
  ref?: Ref<TalkBarApi>;
}

/** A result in the hint row: for 10 s, or until you type, with its keys. */
interface Result {
  id: number;
  line: string;
  tone: 'plain' | 'danger';
  keys: ResultKey[];
  /** Typing clears it: a send's result, not a refusal whose words are back in the box. */
  clears: boolean;
}

/** What a result's keys do, kept as data so a press acts on the bar as it is then, not as it was when the result came. */
type ResultKey =
  | { kind: 'unsend'; sent: readonly Message[]; text: string }
  | { kind: 'retry'; calls: readonly SendCall[]; text: string; forWhom: readonly string[]; toWhom: readonly Recipient[] }
  | { kind: 'send-ceo' }
  | { kind: 'undo'; ran: RunResult };

/** A key in the hint row for the mode the bar is in: Stop and wait, Cancel, Back. */
type ModeKey = { kind: 'stop-wait' } | { kind: 'cancel-stop' } | { kind: 'back' };

/** A key as the hint row draws it. */
interface KeyView {
  key: ResultKey | ModeKey;
  label: string;
  /** Its name where the label leaves out what it acts on. */
  name?: string;
  unavailable: boolean;
}

const RESULT_MS = 10_000;
const STATUS_PAUSE_MS = 500;

function session(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

function local(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/** What you sent stays for the tab only, so it goes with the tab; an earlier version kept it in localStorage for good. */
function dropOldHistory(scope: string): void {
  try {
    window.localStorage.removeItem(historyKey(scope));
  } catch {
    // Storage switched off: nothing was kept there.
  }
}

export function TalkBar(props: TalkBarProps) {
  const { snapshot, company, companyId, actions, steer, navigate, announce, online, founding, phone, compact, short, feed, onEscape, ref } = props;
  const ids = useId();
  const hintId = `${ids}-hint`;
  const listId = `${ids}-list`;
  const statusId = `${ids}-status`;
  const toId = `${ids}-to`;
  const pickerId = `${ids}-picker`;
  const now = useCompanyClock(snapshot.serverTime, online);
  const touch = useMediaQuery('(hover: none) and (pointer: coarse)');
  const still = useReducedMotion();
  const scope = draftScope(company);
  const ceoId = ceoOf(company)?.id ?? null;
  const ceoTo = useMemo<Recipient | null>(() => (ceoId ? { kind: 'person', id: ceoId } : null), [ceoId]);

  const [state, dispatch] = useReducer(talkReducer, null, () => {
    const kept = readKept(session(), scope);
    return initialTalk(kept.to ?? ceoTo, kept.draft);
  });
  const [history, setHistory] = useState(() => readHistory(session(), scope));
  const [recents, setRecents] = useState(() => readRecents(local(), companyId));
  useEffect(() => dropOldHistory(scope), [scope]);
  const [caret, setCaret] = useState(0);
  const [caretAt, setCaretAt] = useState<{ at: number } | null>(null);
  const [focused, setFocused] = useState(false);
  // The hint row comes with the box's focus and stays while focus is anywhere in the bar: a press on the To or Feed
  // never shows or hides it, so they don't move from under the pointer between pressing and letting go.
  const [hintOn, setHintOn] = useState(false);
  const [dismissed, setDismissed] = useState<{ text: string; caret: number } | null>(null);
  const [active, setActive] = useState(0);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<'send' | 'stop' | 'run' | 'unsend' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The hint row only describes the box, so a refusal is also said (4.1.3).
  const raise = (why: string) => {
    setProblem(why);
    announce(why);
  };
  const [status, setStatus] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const toKey = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const sendKey = useRef<HTMLButtonElement>(null);
  const hintRow = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  // Numbers the results, so each restarts its ten seconds.
  const resultIds = useRef(0);
  const lastPeople = useRef(company.people);

  // What the box holds and who hears it.
  const recalled = state.recall !== null ? (history[state.recall] ?? null) : null;
  const text = state.command ? state.step : recalled ? recalled.text : state.draft;
  const choices = useMemo(() => talkChoices(snapshot, company, now, { steering: steer !== undefined }), [snapshot, company, now, steer]);
  const parsed = useMemo(() => mentionsIn(state.draft, choices, state.bound), [state.draft, choices, state.bound]);
  const forPeople = steer && !founding && !state.stop ? forPeopleOf(parsed.mentions, state.notFor) : [];
  const effective = founding ? { to: ceoTo ? [ceoTo] : [], once: false } : effectiveTo(state, recalled ? [] : typedPicks(parsed.mentions), recalled);
  const to = effective.to;
  const words = useMemo(() => toWords(snapshot, company, to, effective.once), [snapshot, company, to, effective.once]);
  const stopping = state.stop !== null ? (company.people.find((p) => p.id === state.stop) ?? null) : null;
  const command = state.command;
  const step = command ? (command.command.steps[command.at] ?? null) : null;
  const counter = counterLine(state.stop || command ? text : state.draft);
  const sendWords = recalled ? recalled.text.trim() : state.stop ? state.draft.trim() : wordsToSend(state.draft, parsed.mentions, parsed.wordsFrom);
  // The library for `/hire`, asked once the box has had focus.
  const library = useLibrary(companyId, snapshot.mode === 'demo', focused && !founding);
  const commands = useMemo(
    () => (founding ? [] : paletteCommands(snapshot, company, { steering: steer !== undefined, feed: true, catchUp: props.catchUp !== null, library })),
    [founding, snapshot, company, steer, props.catchUp, library],
  );

  // The list the caret opens: a command's choices, `@` at the start or after the first word, or `/`.
  const trigger = !focused || picker || state.stop ? null : command ? null : triggerAt(text, caret, choices, state.bound);
  const listShut = dismissed !== null && dismissed.text === text && dismissed.caret === caret;
  let groups: ListGroup[] = [];
  let listKind: 'mention' | 'command' | 'choice' | null = null;
  let foundingLine: string | null = null;
  if (focused && step?.kind === 'choice') {
    groups = choiceList(step, state.step);
    listKind = 'choice';
  } else if (trigger?.kind === 'mention') {
    if (founding) foundingLine = FOUNDING_MENTION;
    else {
      groups = trigger.leading ? pickList(choices, trigger.query, state.picks) : steer ? forList(choices, trigger.query) : [];
      listKind = trigger.leading || steer ? 'mention' : null;
    }
  } else if (trigger?.kind === 'command') {
    if (founding) foundingLine = FOUNDING_COMMAND;
    else {
      groups = commandList(commands, trigger.query, recents, online);
      listKind = 'command';
    }
  }
  const options = optionsOf(groups);
  const listOpen = listKind !== null && !listShut && (options.length > 0 || listKind !== 'choice');
  const current = Math.min(active, Math.max(0, options.length - 1));
  const query = trigger?.kind === 'mention' || trigger?.kind === 'command' ? trigger.query : step?.kind === 'choice' ? state.step : '';

  // The status by the box: how many match, once typing pauses.
  const listSaid = listOpen && listKind ? listStatus(options.length, listKind, query) : '';
  useEffect(() => {
    const timer = window.setTimeout(() => setStatus(listSaid), STATUS_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [listSaid]);

  // The draft and the To are kept for the tab; one draft per company whatever the To.
  useEffect(() => keep(session(), scope, { to: state.base, draft: state.draft }), [scope, state.base, state.draft]);

  // A result stays 10 s, longer while focus is on one of its keys.
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => {
      if (hintRow.current?.contains(document.activeElement)) return;
      setResult((r) => (r?.id === result.id ? null : r));
    }, RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  // Someone leaving takes their place in the To: the To falls back to the CEO, said at the box.
  useEffect(() => {
    const before = lastPeople.current;
    lastPeople.current = company.people;
    if (founding) return;
    const baseGone = state.base !== null && !stillThere(snapshot, company, state.base);
    const picksGone = state.picks.filter((r) => !stillThere(snapshot, company, r)).map(recipientKey);
    const stopGone = state.stop !== null && !company.people.some((p) => p.id === state.stop);
    if (!baseGone && picksGone.length === 0 && !stopGone) return;
    dispatch({ type: 'fallback', to: baseGone ? ceoTo : state.base, drop: [...picksGone, ...(stopGone && state.stop ? [`person:${state.stop}`] : [])] });
    // Said only of someone the office knew: a To kept from before whose id names nobody falls back quietly.
    const line = baseGone && state.base ? goneLine(snapshot, { people: before }, state.base) : null;
    if (line) {
      announce(line);
      setResult({ id: (resultIds.current += 1), line, tone: 'plain', keys: [], clears: true });
    }
  }, [company, snapshot, founding, state.base, state.picks, state.stop, ceoTo, announce]);

  // Over the limit is said once, as it happens.
  const over = counter.over;
  const wasOver = useRef(false);
  useEffect(() => {
    if (over && !wasOver.current && counter.text) announce(counter.text);
    wasOver.current = over;
  }, [over, counter.text, announce]);

  // The box grows from one line to six, or a third of the window's height, then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 22;
    const pad = el.offsetHeight - el.clientHeight + Number.parseFloat(getComputedStyle(el).paddingTop) + Number.parseFloat(getComputedStyle(el).paddingBottom);
    const most = Math.min(line * 6, window.innerHeight / 3);
    el.style.height = `${Math.min(el.scrollHeight, most + pad)}px`;
  }, [text, compact, phone]);

  const focusBox = () => box.current?.focus({ preventScroll: true });

  useImperativeHandle(
    ref,
    () => ({
      // Someone the company doesn't have (an address naming an id nobody has) leaves the To as it is, silently.
      offer: (r) => {
        if (founding || !stillThere(snapshot, company, r)) return;
        dispatch({ type: 'offer', to: r });
      },
      to: (r, options = {}) => {
        if (founding) return;
        if (stillThere(snapshot, company, r)) dispatch({ type: 'to', to: r, ...(options.draft !== undefined ? { draft: options.draft } : {}) });
        setPicker(false);
        if (options.focus) window.requestAnimationFrame(focusBox);
      },
      stop: (person) => {
        if (founding || !company.people.some((p) => p.id === person)) return;
        dispatch({ type: 'stop', person });
        setPicker(false);
        window.requestAnimationFrame(focusBox);
      },
      focus: focusBox,
      suggest: (words, at) => {
        dispatch({ type: 'type', text: words, history: [] });
        window.requestAnimationFrame(() => {
          const el = box.current;
          if (!el) return;
          el.focus({ preventScroll: true });
          const spot = Math.min(at ?? words.length, el.value.length);
          el.setSelectionRange(spot, spot);
          setCaret(spot);
        });
      },
    }),
    [founding, snapshot, company],
  );

  const say = (line: string, tone: Result['tone'], keys: ResultKey[] = [], clears = true) => {
    setResult({ id: (resultIds.current += 1), line, tone, keys, clears });
    announce(line);
  };

  // ---------------------------------------------------------------------------------------------------------
  // Sending

  const sendCalls = async (calls: readonly SendCall[], text: string, forWhom: readonly string[], flight: FlightSession | null): Promise<CallResult[]> => {
    const out: CallResult[] = [];
    // One at a time, in the To's order: a refusal for one never stops the others.
    for (const call of calls) {
      try {
        let messages: Message[];
        if (call.via === 'say' && call.to.kind === 'person') messages = [await actions.say(call.to.id, text, { typed: true })];
        else if (steer) messages = await steer.send(call.to, text, [...forWhom], { typed: true });
        else throw new Error("This office can't send to more than one person yet.");
        out.push({ call, ok: true, messages });
        // Send's flight: a paper for each copy that went (sendFlight.ts).
        flight?.note(call.to);
      } catch (error) {
        out.push({ call, ok: false, why: refusalOf(error) });
      }
    }
    return out;
  };

  const finishSend = (outcome: ReturnType<typeof sendOutcome>, text: string, forWhom: readonly string[], toWhom: readonly Recipient[]) => {
    if (outcome.state === 'refused') {
      dispatch({ type: 'refused', text, to: toWhom });
      say(outcome.line, 'danger', [outcome.gone ? { kind: 'send-ceo' } : { kind: 'retry', calls: outcome.retry, text, forWhom, toWhom }], false);
      return;
    }
    const keys: ResultKey[] = [];
    if (outcome.state === 'partly') keys.push({ kind: 'retry', calls: outcome.retry, text, forWhom, toWhom });
    if (outcome.sent.length > 0) keys.push({ kind: 'unsend', sent: outcome.sent, text });
    say(outcome.line, outcome.state === 'partly' ? 'danger' : 'plain', keys, outcome.state === 'sent');
  };

  const sendNow = async () => {
    if (sending.current) return;
    if (!online) {
      // The hint row shows why; Send says it too.
      announce(RECONNECTING_HINT);
      return;
    }
    if (!sendWords || counter.over || to.length === 0) return;
    const plan = sendPlan(snapshot, company, to, forPeople);
    if (plan.length === 0) return;
    sending.current = true;
    setBusy('send');
    setProblem(null);
    const flight = beginFlight(sendKey.current, still);
    const text = sendWords;
    const toWhom = [...to];
    const forWhom = [...forPeople];
    // Sent: the box clears and keeps focus; refused words come back.
    flushSync(() => dispatch({ type: 'sent' }));
    setDismissed(null);
    setHistory(keepSent(session(), scope, { text, to: toWhom }));
    try {
      const results = await sendCalls(plan, text, forWhom, flight);
      finishSend(sendOutcome(snapshot, company, results, now), text, forWhom, toWhom);
    } finally {
      flight?.end();
      sending.current = false;
      setBusy(null);
      // Send pressed with the keyboard: focus goes back to the box, where the next words go.
      if (form.current?.contains(document.activeElement)) focusBox();
    }
  };

  const retry = async (calls: readonly SendCall[], text: string, forWhom: readonly string[], toWhom: readonly Recipient[]) => {
    if (sending.current || !online) return;
    sending.current = true;
    setBusy('send');
    const flight = beginFlight(sendKey.current, still);
    // A retry of words that came back into the box takes them out again.
    if (state.draft.trim() === text) flushSync(() => dispatch({ type: 'sent' }));
    try {
      const results = await sendCalls(calls, text, forWhom, flight);
      finishSend(sendOutcome(snapshot, company, results, now), text, forWhom, toWhom);
    } finally {
      flight?.end();
      sending.current = false;
      setBusy(null);
      focusBox();
    }
  };

  /** Unsend takes back every copy still waiting, and puts the words back unless something new was started. */
  const unsend = async (sent: readonly Message[], text: string) => {
    if (!online || busy) return;
    setBusy('unsend');
    const waiting = sent.filter((m) => {
      const now = company.messages.find((x) => x.id === m.id);
      return (now ?? m).deliveredAt === null;
    });
    const refusals: string[] = [];
    for (const m of waiting) {
      try {
        await actions.unsend(m.id);
      } catch (error) {
        refusals.push(refusalOf(error));
      }
    }
    setBusy(null);
    focusBox();
    if (waiting.length === 0 || refusals.length === waiting.length) {
      say(`Couldn't unsend: ${refusals[0] ?? 'it has reached them already.'}`, 'danger');
      return;
    }
    const writing = box.current ? box.current.value.trim() !== '' : false;
    if (!writing) dispatch({ type: 'type', text, history });
    say(writing ? 'Unsent.' : UNSENT_BACK, 'plain');
  };

  // ---------------------------------------------------------------------------------------------------------
  // Stop

  const stopNow = async (instruction: string, typed: boolean) => {
    if (!stopping || !online || busy) return;
    const name = called(stopping);
    setBusy('stop');
    try {
      await actions.stop(stopping.id, instruction, { typed });
      if (typed) flushSync(() => dispatch({ type: 'sent' }));
      dispatch({ type: 'end-stop' });
      say(`Stopped ${name}.`, 'plain');
    } catch (error) {
      say(`Couldn't stop ${name}: ${refusalOf(error)}`, 'danger', [], false);
    } finally {
      setBusy(null);
      focusBox();
    }
  };

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  const runCommand = async (c: PaletteCommand, values: Record<string, string>) => {
    if (busy) return;
    if (c.sends && !online) {
      raise(RECONNECTING_HINT);
      return;
    }
    const call = callOf(c.action, values);
    const ran = resultOf(call, company);
    setBusy('run');
    setProblem(null);
    try {
      dispatch({ type: 'end-command' });
      if (call.on === 'navigate') {
        navigate(call.path);
        setRecents(keepRecent(local(), companyId, c.id));
        // The view it opened takes focus, as the palette's do.
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-panel-heading], [data-board-heading]')?.focus({ preventScroll: true }));
        return;
      }
      await perform(call, { actions, ...(steer ? { steer } : {}), ...(props.talk ? { talk: props.talk } : {}) });
      setRecents(keepRecent(local(), companyId, c.id));
      const line = doneLine(snapshot, company, c, values);
      if (!line) return;
      say(line, 'plain', steer ? [{ kind: 'undo', ran }] : []);
    } catch (error) {
      say(`Couldn't do that: ${refusalOf(error)}`, 'danger', [], false);
    } finally {
      setBusy(null);
      focusBox();
    }
  };

  const undoRun = async (ran: RunResult) => {
    const d = decisionOf(company, ran);
    const inverse = ran.inverse;
    if ((!d && !inverse) || !online) return;
    try {
      // The change's own Undo where the office keeps one; else the opposite call (resume what was paused).
      if (d && steer) await steer.undoDecision(d.id);
      else if (inverse) await perform(inverse, { actions, ...(steer ? { steer } : {}) });
      say('Undone.', 'plain');
    } catch (error) {
      say(`Couldn't undo. ${refusalOf(error)}`, 'danger');
    } finally {
      focusBox();
    }
  };

  const chooseCommand = (c: PaletteCommand) => {
    if (c.sends && !online) {
      raise(RECONNECTING_HINT);
      return;
    }
    setProblem(null);
    setDismissed(null);
    // In the bar a message command picks who hears it, and Stop turns the bar into their Stop.
    if (c.action.kind === 'message') {
      dispatch({ type: 'pick', to: c.action.to, start: 0, end: state.draft.length, replaces: [] });
      announce(`${toWords(snapshot, company, [c.action.to], true).long}, for this message only.`);
      return;
    }
    if (c.action.kind === 'stop') {
      dispatch({ type: 'type', text: '', history });
      dispatch({ type: 'stop', person: c.action.person });
      return;
    }
    if (c.steps.length === 0) {
      void runCommand(c, {});
      return;
    }
    dispatch({ type: 'command', command: c, typed: state.draft });
    const first = c.steps[0];
    if (first) announce(`${c.label}, step 1 of ${c.steps.length}: ${first.label}`);
  };

  const answerStep = (raw: string) => {
    if (!command || !step) return;
    const checked = stepValue(step, raw);
    if (!checked.ok) {
      raise(checked.why);
      return;
    }
    setProblem(null);
    const values = { ...command.values, [step.key]: checked.value };
    if (command.at === command.command.steps.length - 1) {
      void runCommand(command.command, values);
      return;
    }
    dispatch({ type: 'answer', key: step.key, value: checked.value });
    const next = command.command.steps[command.at + 1];
    if (next) announce(`Step ${command.at + 2} of ${command.command.steps.length}: ${next.label}`);
  };

  // ---------------------------------------------------------------------------------------------------------
  // The list's picks

  const pickOption = (option: ListOption) => {
    if (option.disabled) {
      raise(RECONNECTING_HINT);
      return;
    }
    const pick = option.pick;
    setActive(0);
    if (pick.kind === 'command') {
      chooseCommand(pick.command);
      return;
    }
    if (pick.kind === 'option') {
      answerStep(pick.value);
      return;
    }
    if (trigger?.kind !== 'mention') return;
    const start = trigger.at;
    const end = caret;
    if (pick.kind === 'pick') {
      dispatch({ type: 'pick', to: pick.choice.recipient, start, end, replaces: pick.replaces });
      setCaretSoon(start);
      announce(`${capital(toWords(snapshot, company, [pick.choice.recipient], true).long)}, for this message only.`);
    } else if (pick.kind === 'for') {
      const name = pick.choice.person?.name ?? pick.choice.title;
      dispatch({ type: 'pick-for', key: pick.choice.key, name, start, end });
      setCaretSoon(start + name.length + 2);
    } else {
      dispatch({ type: 'instead', to: pick.choice.recipient, start, end });
      setCaretSoon(start);
      announce(`${capital(toWords(snapshot, company, [pick.choice.recipient], true).long)}, for this message only.`);
    }
  };

  /**
   * Puts the caret where a pick left it, in the commit that writes the pick's words into the box. It never waits for a
   * frame: on a slow frame the person has typed on by then, and a late move would drag the caret back into their words.
   */
  const setCaretSoon = (at: number) => setCaretAt({ at });
  useLayoutEffect(() => {
    const el = box.current;
    if (!caretAt || !el) return;
    const spot = Math.min(caretAt.at, el.value.length);
    el.setSelectionRange(spot, spot);
    setCaret(spot);
  }, [caretAt]);

  // ---------------------------------------------------------------------------------------------------------
  // Typing and keys

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    dispatch({ type: 'type', text: e.target.value, history });
    setCaret(e.target.selectionStart);
    setDismissed(null);
    setActive(0);
    setProblem(null);
    if (result?.clears) setResult(null);
  };

  const submit = () => {
    if (command) {
      if (step?.kind === 'choice') {
        const option = options[current];
        if (option) pickOption(option);
        return;
      }
      answerStep(state.step);
      return;
    }
    if (state.stop) {
      if (state.draft.trim()) void stopNow(state.draft.trim(), true);
      return;
    }
    void sendNow();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (listOpen && options.length > 0) {
      const move = (next: number) => {
        e.preventDefault();
        setActive(((next % options.length) + options.length) % options.length);
      };
      if (e.key === 'ArrowDown') return move(current + 1);
      if (e.key === 'ArrowUp') return move(current - 1);
      if (e.key === 'PageDown') return move(Math.min(options.length - 1, current + 8));
      if (e.key === 'PageUp') return move(Math.max(0, current - 8));
      if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
        const option = options[current];
        if (option) {
          e.preventDefault();
          pickOption(option);
          return;
        }
      }
    }
    if (e.key === 'Escape') {
      // The bar's own first: its list, a command's step, Stop, a recalled message; then the feed. Never a board.
      if (listOpen) {
        e.preventDefault();
        setDismissed({ text, caret });
      } else if (command) {
        e.preventDefault();
        dispatch({ type: 'step-back' });
        if (command.at === 0) setCaretSoon(command.typed.length);
      } else if (state.stop) {
        e.preventDefault();
        dispatch({ type: 'end-stop' });
      } else if (state.recall !== null) {
        e.preventDefault();
        dispatch({ type: 'unrecall' });
      } else if (onEscape()) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp' && !command && !state.stop && (state.recall !== null || (state.draft === '' && state.picks.length === 0))) {
      if (history.length === 0) return;
      e.preventDefault();
      dispatch({ type: 'recall', dir: 'older', history });
      setCaretSoon(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (e.key === 'ArrowDown' && state.recall !== null) {
      e.preventDefault();
      dispatch({ type: 'recall', dir: 'newer', history });
      setCaretSoon(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (e.key === 'Backspace' && el.value === '' && !command && !state.stop && state.picks.length > 0) {
      e.preventDefault();
      const left = state.picks.slice(0, -1);
      dispatch({ type: 'drop-pick' });
      const after = left.length > 0 ? toWords(snapshot, company, left, true) : toWords(snapshot, company, state.base ? [state.base] : [], false);
      announce(`${after.long}.`);
      return;
    }
    if (e.key === 'Backspace' && el.value === '' && command) {
      e.preventDefault();
      dispatch({ type: 'step-back' });
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !touch) {
      // A long text step takes Shift and Enter for a new line, as the box does.
      e.preventDefault();
      submit();
    }
  };

  const onSelect = () => {
    const el = box.current;
    if (el) setCaret(el.selectionStart);
  };

  // ---------------------------------------------------------------------------------------------------------
  // Drawing

  const canSend = online && !busy && !counter.over && (state.stop ? state.draft.trim() !== '' : command ? true : sendWords !== '' && to.length > 0);
  const stopName = stopping ? called(stopping) : '';
  const boxName = stopping ? `Stop ${stopName} and say what to do instead` : step ? step.label : words.box;
  const placeholder = founding ? (scopingWaits(scopingOf(company)) ? SCOPING_PLACEHOLDER : FOUNDING_PLACEHOLDER) : stopping ? `Say what ${stopName} should do instead` : step ? (step.kind === 'choice' ? 'Type to narrow the choices' : '') : words.placeholder;
  const sendLabel = stopping ? 'Stop and send' : command ? (command.at === command.command.steps.length - 1 ? 'Run' : 'Next') : 'Send';
  const stepLine = command ? `${command.command.label}, step ${command.at + 1} of ${command.command.steps.length}` : null;

  // The hint row, newest first: a fresh result, reconnecting, a problem, why a mention stays words, what will happen.
  const endedWords = parsed.mentions.find((m) => !(caret >= m.start && caret <= m.end) && m.resolved.kind !== 'choice');
  const happens = to.length > 0 && !command && !stopping ? whatHappens(snapshot, company, to, forPeople, effective.once, now) : null;
  const typing = text.trim() !== '' || effective.once || forPeople.length > 0;
  const activeOption = listOpen ? options[current] : undefined;
  const activeLine = activeOption ? optionLine(snapshot, company, activeOption, to, now) : null;
  let hint: { line: string; tone: 'plain' | 'danger'; keys: readonly ResultKey[] } | null = null;
  if (result) hint = result;
  else if (activeLine && online) hint = { line: activeLine, tone: 'plain', keys: [] };
  else if (!online) hint = { line: RECONNECTING_HINT, tone: 'plain', keys: [] };
  else if (problem) hint = { line: problem, tone: 'danger', keys: [] };
  else if (foundingLine) hint = { line: foundingLine, tone: 'plain', keys: [] };
  else if (stopping) hint = { line: `Stop ${stopName} and say what to do instead.`, tone: 'plain', keys: [] };
  else if (step) hint = { line: step.kind === 'text' && step.hint ? step.hint : (command?.command.hint ?? step.label), tone: 'plain', keys: [] };
  else if (endedWords) hint = { line: wordsLine(endedWords, choices) ?? '', tone: 'plain', keys: [] };
  else if (typing && happens) hint = { line: happens, tone: 'plain', keys: [] };
  else if (focused && !founding) hint = { line: TEACH, tone: 'plain', keys: [] };
  else if (focused && founding) hint = { line: whatHappens(snapshot, company, to, [], false, now), tone: 'plain', keys: [] };
  const modeKeys: ModeKey[] = stopping ? [...(compact || phone ? [{ kind: 'stop-wait' as const }] : []), { kind: 'cancel-stop' }] : command && (compact || phone) ? [{ kind: 'back' }] : [];
  const showHint = short ? hintOn : hintOn || text.trim() !== '' || result !== null || stopping !== null || command !== null || !online || effective.once;
  const listShown = listOpen && (options.length > 0 || listKind === 'command' || listKind === 'mention');
  const listKeys = listShown && options.length > 0 && !phone && !touch;

  // The keys, drawn from the bar as it is now; a press acts on it as it is then.
  const viewOf = (k: ResultKey | ModeKey): KeyView | null => {
    const waits = !online || busy !== null;
    switch (k.kind) {
      case 'unsend':
        return k.sent.some((m) => (company.messages.find((x) => x.id === m.id) ?? m).deliveredAt === null) ? { key: k, label: 'Unsend', unavailable: waits } : null;
      case 'retry':
        return { key: k, label: 'Try again', unavailable: waits };
      case 'send-ceo':
        return { key: k, label: 'Send to the CEO instead', unavailable: waits };
      case 'undo':
        return decisionOf(company, k.ran) || k.ran.inverse ? { key: k, label: 'Undo', unavailable: !online } : null;
      case 'stop-wait':
        return { key: k, label: 'Stop and wait', unavailable: waits };
      case 'cancel-stop':
        return { key: k, label: 'Cancel', name: `Cancel stopping ${stopName}`, unavailable: false };
      case 'back':
        return { key: k, label: 'Back', name: 'Back a step', unavailable: false };
    }
  };
  const keys = [...(hint?.keys ?? []), ...modeKeys].flatMap((k) => viewOf(k) ?? []);
  const press = (k: ResultKey | ModeKey) => {
    switch (k.kind) {
      case 'unsend':
        void unsend(k.sent, k.text);
        return;
      case 'retry':
        void retry(k.calls, k.text, k.forWhom, k.toWhom);
        return;
      case 'send-ceo':
        void sendNow();
        return;
      case 'undo':
        void undoRun(k.ran);
        return;
      case 'stop-wait':
        void stopNow(STOP_AND_WAIT, false);
        return;
      case 'cancel-stop':
        dispatch({ type: 'end-stop' });
        focusBox();
        return;
      case 'back':
        dispatch({ type: 'step-back' });
        focusBox();
        return;
    }
  };

  // An empty box with focus offers a few plain things to do, the palette's own suggestions (Catch me up, Pause work…).
  const onChip = props.onChip;
  const offering = onChip !== undefined && hintOn && text.trim() === '' && !stopping && !command && !recalled && !founding && !listShown;
  const offers = useMemo(() => (offering ? talkChips(commands, company) : []), [offering, commands, company]);

  const forChips = forPeople.map((id) => company.people.find((p) => p.id === id)).filter((p) => p !== undefined);
  const chips = forChips.map((p) => (
    <span key={p.id} className="talkbar__for">
      <Face of={faceOfRecipient(snapshot, company, { kind: 'person', id: p.id })} size={20} />
      <span>{to.some((r) => r.kind === 'person' && r.id === p.id) ? `For ${called(p)}` : forWords([p])}</span>
      <button type="button" className="talkbar__for-x" aria-label={`Not for ${called(p)}`} title={`Not for ${called(p)}`} onClick={() => dispatch({ type: 'not-for', person: p.id })}>
        <Glyph name="close" size={14} />
      </button>
    </span>
  ));

  const toFaces = to.length > 1 ? <Faces faces={to.map((r) => faceOfRecipient(snapshot, company, r))} size={28} /> : to[0] ? <Face of={faceOfRecipient(snapshot, company, to[0])} size={28} /> : null;
  const toName = effective.once ? `${words.long}, for this message only` : words.long;

  return (
    <form
      ref={form}
      className={`talkbar${compact ? ' talkbar--compact' : ''}${phone ? ' talkbar--phone' : ''}${stopping ? ' talkbar--stop' : ''}${command ? ' talkbar--command' : ''}${!online ? ' talkbar--offline' : ''}${counter.over ? ' talkbar--over' : ''}`}
      aria-label="Talk bar"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setHintOn(false);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {offers.length > 0 && onChip && (
        <div className="talkbar__offers" role="group" aria-label="Things to do">
          {offers.map((chip) => (
            <button key={chip.id} type="button" className="talkbar__offer" onMouseDown={(e) => e.preventDefault()} onClick={() => onChip(chip)}>
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {/* What the To can't say in the compact form takes a row above the box: Stop, or a command and its step. */}
      {stopping && (compact || phone) && (
        <div className="talkbar__mode talkbar__mode--stop">
          <Face of={faceOfRecipient(snapshot, company, { kind: 'person', id: stopping.id })} size={24} />
          <span>Stop {stopName}</span>
        </div>
      )}
      {command && (compact || phone) && (
        <div className="talkbar__mode talkbar__mode--command">
          <Glyph name="command" size={16} />
          <span>{stepLine}</span>
        </div>
      )}
      <div className="talkbar__row">
        {stopping ? (
          !(compact || phone) && (
            <div className="talkbar__to talkbar__to--stop">
              <Face of={faceOfRecipient(snapshot, company, { kind: 'person', id: stopping.id })} size={28} />
              <span className="talkbar__to-words">Stop {stopName}</span>
            </div>
          )
        ) : command ? (
          !(compact || phone) && (
            <div className="talkbar__to talkbar__to--command">
              <Glyph name="command" size={16} />
              <span className="talkbar__to-words">
                {command.command.label}
                <span className="talkbar__to-once">
                  Step {command.at + 1} of {command.command.steps.length}
                </span>
              </span>
            </div>
          )
        ) : (
          <button
            ref={toKey}
            id={toId}
            type="button"
            className={`talkbar__to${effective.once ? ' is-once' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={picker}
            aria-controls={picker ? pickerId : undefined}
            aria-label={toName}
            aria-describedby={`${toId}-change`}
            title={toName}
            disabled={founding || undefined}
            onClick={() => setPicker((open) => !open)}
          >
            {toFaces}
            {compact || phone ? (
              words.short && <span className="talkbar__to-words talkbar__to-words--short">To {words.short === 'All hands' ? 'all hands' : words.short}</span>
            ) : (
              <span className="talkbar__to-words">
                {words.long}
                {effective.once && <span className="talkbar__to-once">For this message only</span>}
              </span>
            )}
            {!founding && !(compact || phone) && <Glyph name="down" size={16} className="talkbar__caret" />}
            <span id={`${toId}-change`} hidden>
              Change who hears it
            </span>
          </button>
        )}
        <div className="talkbar__slot">
          {!(compact || phone) && chips}
          <textarea
            ref={box}
            id="company-talk"
            className="talkbar__box"
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={boxName}
            aria-describedby={hintId}
            aria-invalid={counter.over || undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={listShown && options[current] ? `${listId}-${options[current].id}` : undefined}
            autoComplete="off"
            spellCheck
            enterKeyHint={touch ? 'enter' : 'send'}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onSelect={onSelect}
            onFocus={() => {
              setFocused(true);
              setHintOn(true);
            }}
            onBlur={(e) => {
              // A press on the list keeps focus in the box; anywhere else, the list closes.
              if (e.relatedTarget instanceof Node && document.getElementById(listId)?.contains(e.relatedTarget)) return;
              setFocused(false);
            }}
          />
        </div>
        <button
          ref={sendKey}
          type="submit"
          className={`talkbar__send${(compact || phone) && sendLabel === 'Send' ? ' talkbar__send--icon' : ''}`}
          aria-disabled={!canSend || undefined}
          aria-label={sendLabel === 'Send' && (compact || phone) ? 'Send' : undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          {busy === 'send' || busy === 'stop' || busy === 'run' ? <span className="talkbar__busy" aria-hidden="true" /> : null}
          {sendLabel === 'Send' && (compact || phone) ? <Glyph name="send" /> : sendLabel}
        </button>
        {stopping && !(compact || phone) ? (
          <button type="button" className="talkbar__key" aria-disabled={!online || busy !== null || undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => void stopNow(STOP_AND_WAIT, false)}>
            Stop and wait
          </button>
        ) : (
          (!phone || short) && (
            // A small key: your messages and the replies to them, named for a screen reader and in its tooltip.
            <button type="button" className={`talkbar__feed${feed.open ? ' is-on' : ''}`} aria-expanded={feed.open} aria-controls={feed.id} aria-label={feed.name} title={feed.name} onClick={feed.toggle}>
              <Glyph name="feed" />
              {feed.count > 0 ? (
                <span className="talkbar__count" aria-hidden="true">
                  {feed.count}
                </span>
              ) : feed.dot ? (
                <span className="talkbar__dot" aria-hidden="true" />
              ) : null}
            </button>
          )
        )}
      </div>
      <div ref={hintRow} id={hintId} className={`talkbar__hint${showHint ? '' : ' is-hidden'}${hint?.tone === 'danger' ? ' is-danger' : ''}`}>
        {(compact || phone) && chips.length > 0 && <span className="talkbar__chips">{chips}</span>}
        {listKeys && (
          <span className="talkbar__keys-hint">
            <b>Enter</b> or <b>Tab</b> picks, <b>Esc</b> closes.{' '}
          </span>
        )}
        {hint && <span className="talkbar__hint-line">{hint.line}</span>}
        {counter.text && <span className={`talkbar__counter${counter.over ? ' is-over' : ''}`}>{counter.text}</span>}
        {keys.length > 0 && (
          <span className="talkbar__hint-keys">
            {keys.map((k) => (
              <button key={k.label} type="button" className="talkbar__small" aria-label={k.name} aria-disabled={k.unavailable || undefined} onClick={() => !k.unavailable && press(k.key)}>
                {k.label}
              </button>
            ))}
          </span>
        )}
      </div>
      <p id={statusId} className="visually-hidden" role="status">
        {status}
      </p>
      <TalkList
        id={listId}
        open={listShown && focused}
        anchor={box}
        groups={groups}
        active={current}
        phone={phone}
        empty={listShown && options.length === 0 ? listStatus(0, listKind ?? 'mention', query) : null}
        onActive={setActive}
        onPick={pickOption}
        lead={(o) => (o.who ? <Face of={faceOfRecipient(snapshot, company, o.who)} size={28} /> : o.pick.kind === 'command' ? <span className="tpop__glyph"><Glyph name="command" size={16} /></span> : o.pick.kind === 'instead' ? <span className="tpop__glyph"><Glyph name="relay" size={16} /></span> : null)}
      />
      {picker && !founding && (
        <ToPicker
          id={pickerId}
          snapshot={snapshot}
          company={company}
          choices={choices}
          phone={phone}
          anchor={toKey}
          onPick={(r) => {
            setPicker(false);
            dispatch({ type: 'to', to: r });
            announce(`${toWords(snapshot, company, [r], false).long}.`);
            window.requestAnimationFrame(focusBox);
          }}
          onClose={() => {
            setPicker(false);
            window.requestAnimationFrame(() => toKey.current?.focus({ preventScroll: true }));
          }}
        />
      )}
    </form>
  );
}
