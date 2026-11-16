// The task board (docs/design-v3.md, "Stage and dock", "The task board"; docs/design-hud.md): the company's tasks as a
// board of sticky notes over the map, in columns by status with Waiting for you among them, like GitHub Projects.
// Dragging a note between and within columns steers the work (its place in line, pause and resume, cancel, reassign);
// every drag has a keyboard way (Space picks a card up, the arrows carry it) and Move's menu covers every drop. Filters,
// lanes by person or by room, and on phones one column at a time. Its sub-view is the plan. The shell mounts it in the
// main view for the addresses `tasks` and `plan`; BoardFrame gives it its head and the result row.
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useMediaQuery } from '../../../lib/hooks.ts';
import { reconnectingLine } from '../../model.ts';
import { madeByCall, type PaletteCall } from '../../palette/paletteModel.ts';
import { useCompanyClock } from '../../people/clock.ts';
import { roomName as roomNameOf } from '../../people/peopleModel.ts';
import { refusalOf } from '../../people/shared.tsx';
import { Plan } from '../../plan/Plan.tsx';
import { named } from '../../plan/planEdit.ts';
import { noTasksLine } from '../../plan/planModel.ts';
import { type BoardViewLink, BoardFrame, useBoardHead } from '../../shell/BoardFrame.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { companyHref, navigate, parseCompanyAddress, type PanelView, useLocation } from '../../router.ts';
import type { BoardProps } from '../../types.ts';
import { type FaceOf, roomHue } from '../../ui/Face.tsx';
import { CancelForm, NO_STEER, OFFLINE, ReassignForm, useTaskOrder } from '../Board.tsx';
import { cancelDecision, isOpenTask, movedLine, priorityOrder, sameOrder, steerSaid } from '../boardModel.ts';
import { allDoneLine } from '../tasksModel.ts';
import {
  type BoardFilters,
  type BoardView,
  boardIndex,
  boardOf,
  boardSentence,
  type Card,
  type CardWords,
  cardWords,
  changedSince,
  type ColumnId,
  type ColumnView,
  COLUMNS,
  filteredLine,
  filtering,
  firstName,
  homeOf,
  planCard,
  planWords,
  seenOf,
  shownCount,
  type Seen,
  type TaskCard,
} from './columns.ts';
import { type CellState, type CellView, Columns } from './Columns.tsx';
import {
  beforeFor,
  defaultBefore,
  keptBefore,
  type LaneOf,
  laneKey,
  type LiftAt,
  liftStep,
  lifts,
  meansOver,
  type MoveAction,
  moveItems,
  movingLine,
  nextStop,
  nothingFurther,
  orderForDrop,
  placed,
  startLine,
  startOrder,
  stepBefore,
  takes,
  wentBack,
} from './drops.ts';
import { FilterCount, FilterFields, FilterSheet, filtersOn } from './Filters.tsx';
import { type LaneView, laneOfCard, lanesOf } from './lanes.ts';
import { MoveMenu } from './MoveMenu.tsx';
import { ARROWS, arrowTo, cardKey, cardOfKey, type ItemKey, moreKey, type NavColumn, RAIL_KEY, tabStop, tookItsPlace } from './nav.ts';
import { Note, type NoteView } from './Note.tsx';
import { PhoneBoard, type PhoneLane } from './PhoneBoard.tsx';
import { SessionBoard } from './SessionBoard.tsx';
import { keepFilters, keepSeen, readFilters, readSeen } from './storage.ts';
import { useCardDrag } from './useCardDrag.ts';
import './board.css';

/** A card in the hand, by the keyboard or the pointer: what it was when lifted, where it came from, where it is. */
interface Held {
  by: 'keys' | 'pointer';
  id: string;
  was: TaskCard;
  from: LaneOf | null;
  /** Its column's items when it was lifted, for "the card that took its place". */
  fromItems: ItemKey[];
  /** Where it would land; null while the pointer is over nothing (letting go puts it back). */
  at: LiftAt | null;
  /** The cards of the cell it is over, as last seen, so its place is kept by the card it lands before. */
  seen: string[];
}

/** A cancel or reassign form: under the card where it was dropped (`at`), or under the card where it is (from Move). */
interface DropForm {
  kind: 'cancel' | 'reassign';
  card: TaskCard;
  at: { column: ColumnId; lane: string } | null;
  to: string | null;
  busy: boolean;
}

const laneFrom = (key: string): LaneOf | null => {
  if (key.startsWith('person:')) return { kind: 'person', person: key.slice('person:'.length) };
  if (key.startsWith('room:')) return { kind: 'room', room: key.slice('room:'.length) };
  return null;
};

const findCard = (board: Pick<BoardView, 'columns'>, id: string): TaskCard | null => {
  for (const c of board.columns) for (const card of c.cards) if (card.kind === 'task' && card.id === id) return card;
  return null;
};

const sameAt = (a: LiftAt | null, b: LiftAt | null) => a === b || (a !== null && b !== null && a.column === b.column && laneKey(a.lane) === laneKey(b.lane) && a.before === b.before);

const toggled = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** How long focus keeps following a card after a move, while the office's answer comes back. */
const FOLLOW_MS = 5_000;

/** The app's own navigation for a plain press on a link; the browser's for a new tab or window. */
function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}

/** "Add a task", a key lying on the mat; where the head runs short, its glyph alone, named. On phones a chip. */
function AddTask({ href, chip = false }: { href: string; chip?: boolean }) {
  const head = useBoardHead();
  const glyph = head.glyphs && !chip;
  return (
    <a className={chip ? 'tb-subkey' : 'bf__key tb-addtask'} href={href} aria-label={glyph ? 'Add a task' : undefined} title={glyph ? 'Add a task' : undefined} onClick={(e) => follow(e, href)}>
      <Icon name="plus" size={16} />
      {!glyph && 'Add a task'}
    </a>
  );
}

export function TaskBoard(props: BoardProps) {
  const { company, companyId, snapshot, view } = props;
  const phone = useMediaQuery('(max-width: 720px), (max-height: 480px)');
  const location = useLocation();
  const panel = parseCompanyAddress(location.path, location.search)?.route.panel ?? null;
  // Board and Plan keep the side panel's view on desktops; phones drop it, where the side panel is a sheet.
  const keep: PanelView | null = phone ? null : panel;
  const links = {
    board: companyHref(companyId, { main: { kind: 'tasks' }, panel: keep }),
    plan: companyHref(companyId, { main: { kind: 'plan', version: null }, panel: keep }),
    add: companyHref(companyId, { main: { kind: 'tasks' }, panel: { kind: 'new-task' } }),
  };
  const views: BoardViewLink[] = [
    { label: 'Board', href: links.board, current: view.kind === 'tasks' },
    { label: 'Plan', href: links.plan, current: view.kind === 'plan', count: planCard(company) ? 1 : 0, countLabel: 'waits for your approval' },
  ];
  const roomName = (room: string) => roomNameOf(snapshot, room);

  // New since you looked: what each card was when you last left the board (the plan is part of it), kept in this browser.
  const [seenBefore] = useState(() => readSeen(companyId));
  const seenLatest = useRef<Seen | null>(null);
  useEffect(() => {
    const save = () => {
      if (seenLatest.current) keepSeen(companyId, seenLatest.current);
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [companyId]);

  // v0.7: a plain job has no task plan of the office's; its board is the session's own list and helpers.
  if (company.shape === 'plain') return <SessionBoard {...props} />;
  if (view.kind === 'plan') {
    return (
      <BoardFrame title="Tasks" views={views} viewsLabel="Tasks views" actions={<AddTask href={links.add} />}>
        <div className="tb-plan" data-tb-vscroll>
          <Plan {...props} version={view.version} inBoard />
        </div>
      </BoardFrame>
    );
  }
  return <TheBoard {...props} phone={phone} panel={panel} roomName={roomName} views={views} links={links} seenBefore={seenBefore} seenLatest={seenLatest} />;
}

interface TheBoardProps extends BoardProps {
  phone: boolean;
  panel: PanelView | null;
  roomName: (room: string) => string;
  views: BoardViewLink[];
  links: { board: string; plan: string; add: string };
  /** What the cards were when you last left the board (null on a first visit), and where the board says what they are now. */
  seenBefore: Seen | null;
  seenLatest: { current: Seen | null };
}

function TheBoard(props: TheBoardProps) {
  const { company, companyId, snapshot, steer, online, result, phone, panel, roomName, views, links, seenBefore, seenLatest } = props;
  const root = useRef<HTMLDivElement>(null);
  const now = useCompanyClock(snapshot.serverTime, online);
  const canSteer = steer !== undefined && online;
  const unavailable = !steer ? NO_STEER : !online ? OFFLINE : null;

  // ----- The order, the board and its filters
  const server = priorityOrder(company.tasks).map((t) => t.id);
  const { order, moveSettled } = useTaskOrder(server, steer ?? null, null);
  const [filters, setFiltersNow] = useState<BoardFilters>(() => readFilters(companyId));
  const setFilters = (next: BoardFilters) => {
    setFiltersNow(next);
    keepFilters(companyId, next);
  };
  const index = boardIndex(company, order);
  const full = boardOf(company, order, now);
  const board = filtering(filters) ? boardOf(company, order, now, filters) : full;
  const group = filters.group;
  const lanes = group === 'none' ? null : lanesOf(company, snapshot, board, group, roomName);
  const laneOfKey = (key: string): LaneOf | null => (lanes ? laneFrom(key) : null);
  const openTask = panel?.kind === 'task' ? panel.task : null;
  const words = (card: TaskCard): CardWords => cardWords(company, card, { index, now, roomName });

  // ----- New since you looked: marked against what you last left; what the cards are now is kept when you leave.
  const seenNow = seenOf(full);
  const changed = changedSince(seenBefore, seenNow);
  useEffect(() => {
    seenLatest.current = seenNow;
  });

  // ----- What is open, what is carried, where focus rests
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [railOpen, setRailOpen] = useState(false);
  const [closedLanes, setClosedLanes] = useState<ReadonlySet<string>>(() => new Set());
  const [held, setHeldNow] = useState<Held | null>(null);
  const [form, setForm] = useState<DropForm | null>(null);
  const [step, setStep] = useState('');
  const [active, setActive] = useState<ItemKey | null>(null);
  const [current, setCurrent] = useState<ColumnId>(() => board.columns.find((c) => c.cards.length > 0)?.id ?? 'queued');
  // The rail opened under a carried card closes again if the card goes elsewhere.
  const [railByDrag, setRailByDrag] = useState(false);
  const [ended, setEnded] = useState<{ why: string; focus: string | null; n: number } | null>(null);
  // The card in the hand as handlers see it: the pointer's can arrive before the board has drawn the lift.
  const heldNow = useRef<Held | null>(null);
  const setHeld = (h: Held | null) => {
    heldNow.current = h;
    setHeldNow(h);
  };
  const latest = useRef({ company, steer });
  useEffect(() => {
    // setHeld writes the ref itself; only an end decided while drawing (the company changed under it) is synced here,
    // so a pointer move between a render and this effect is never overwritten with the older card.
    if (held === null) heldNow.current = null;
    latest.current = { company, steer };
  });

  // ----- Cells: each column, or each column within a lane, as drawn now
  const laneList: (LaneView | null)[] = lanes ?? [null];
  const columnsOf = (lane: LaneView | null): ColumnView[] => (lane ? lane.columns : board.columns);
  const shownIn = (lane: string, column: ColumnId, cards: readonly Card[]) => {
    const n = shownCount(column, cards.length, opened.has(`${lane}|${column}`), lane !== '');
    return { cards: cards.slice(0, n), hidden: cards.length - n };
  };
  const idsIn = (lane: string, column: ColumnId): string[] => {
    const l = lanes ? (lanes.find((x) => x.key === lane) ?? null) : null;
    if (lanes && !l) return [];
    const cards = columnsOf(l).find((c) => c.id === column)?.cards ?? [];
    return shownIn(lane, column, cards)
      .cards.filter((c) => c.kind === 'task')
      .map((c) => c.id);
  };
  const grid: NavColumn[] = COLUMNS.map((spec) => {
    if (spec.id === 'cancelled' && !railOpen) return { column: spec.id, items: [{ key: RAIL_KEY, lane: '' }] };
    const items: { key: ItemKey; lane: string }[] = [];
    for (const lane of laneList) {
      if (lane && closedLanes.has(lane.key)) continue;
      const lk = lane?.key ?? '';
      const shown = shownIn(lk, spec.id, columnsOf(lane).find((c) => c.id === spec.id)?.cards ?? []);
      for (const card of shown.cards) items.push({ key: cardKey(card.id), lane: lk });
      if (shown.hidden > 0) items.push({ key: moreKey(lk, spec.id), lane: lk });
    }
    return { column: spec.id, items };
  });
  const stop = tabStop(grid, active);
  const itemsOf = (column: ColumnId) => grid.find((c) => c.column === column)?.items.map((i) => i.key) ?? [];

  // ----- The company goes on while a card is carried
  const heldCard = held ? findCard(board, held.id) : null;
  const heldWhy = held ? (!online ? reconnectingLine(snapshot.serverTime) : wentBack(company, held.was, heldCard)) : null;
  if (held?.by === 'keys' && phone) {
    // Phones don't lift: a window narrowed to the phone layout mid-lift puts the card back.
    setHeldNow(null);
    setStep('');
  } else if (held && heldWhy) {
    // Its task left the board: focus goes to the card that took its place, else to the column's heading.
    const focus = heldCard ? cardKey(held.id) : (tookItsPlace(held.fromItems, itemsOf(held.was.column), cardKey(held.id)) ?? `head:${held.was.column}`);
    setHeldNow(null);
    setStep('');
    setEnded({ why: heldWhy, focus: held.by === 'keys' ? focus : null, n: (ended?.n ?? 0) + 1 });
  } else if (held?.at && placed(meansOver(held.was, held.at.column, held.from, held.at.lane))) {
    // Its place is kept by the card it lands before: if that card left, the next one there holds it.
    const nowIds = idsIn(laneKey(held.at.lane), held.at.column);
    const kept = keptBefore(held.at.before, held.seen, nowIds);
    if (kept !== held.at.before || nowIds.join('\n') !== held.seen.join('\n')) setHeldNow({ ...held, at: { ...held.at, before: kept }, seen: nowIds });
  }
  const sayEnded = useEffectEvent((e: { why: string; focus: string | null }) => {
    result(e.why);
    if (e.focus) focusItem(e.focus);
  });
  useEffect(() => {
    if (ended) sayEnded(ended);
  }, [ended]);

  // ----- Focus follows a card after a move, as the office's answer moves it
  const followFocus = useRef<{ key: ItemKey; until: number } | null>(null);
  useEffect(() => {
    const f = followFocus.current;
    if (!f) return;
    if (Date.now() > f.until) {
      followFocus.current = null;
      return;
    }
    const el = root.current?.querySelector<HTMLElement>(`[data-tb-key="${CSS.escape(f.key)}"]`);
    const at = document.activeElement;
    if (el && at !== el && (at === null || at === document.body || !at.isConnected)) el.focus();
    // A card that moved far (to the bottom of a column) re-renders out of view, and focus went with it: bring it back.
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  // A press of your own elsewhere ends the following: focus goes where you pressed.
  useEffect(() => {
    const stop = () => {
      followFocus.current = null;
    };
    document.addEventListener('pointerdown', stop, true);
    return () => document.removeEventListener('pointerdown', stop, true);
  }, []);
  const followCard = (id: string) => {
    const key = cardKey(id);
    followFocus.current = { key, until: Date.now() + FOLLOW_MS };
    setActive(key);
    root.current?.querySelector<HTMLElement>(`[data-tb-key="${CSS.escape(key)}"]`)?.focus();
  };
  /** Focus to an item, or to a column's heading ("head:queued"). */
  function focusItem(key: string) {
    if (key.startsWith('head:')) {
      document.getElementById(`tb-head-${key.slice('head:'.length)}`)?.focus();
      return;
    }
    flushSync(() => setActive(key));
    const el = root.current?.querySelector<HTMLElement>(`[data-tb-key="${CSS.escape(key)}"]`);
    el?.focus();
    // Arrowing sideways leaves the next card partly in view; the scrollers' padding keeps its edges clear.
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ----- Steering, each with what it says and its Undo
  const openNow = (ids: readonly string[]) => ids.filter((id) => latest.current.company.tasks.some((t) => t.id === id && isOpenTask(t)));
  const moveTo = (card: TaskCard, next: string[]) => {
    const before = order;
    result(movedLine(next, card.task), () => moveSettled(openNow(before)));
    moveSettled(next).catch((error: unknown) => result(`Couldn't move ${named(card.task.title)}. ${refusalOf(error)}`));
    followCard(card.id);
  };
  /** Start next: it jumps to the front of the whole open order, so it starts now or right after its owner's current task. */
  const start = (card: TaskCard): boolean => {
    const line = `${named(card.task.title)} goes to the front. ${startLine(latest.current.company, card.task)}`;
    const next = startOrder(order, card.id);
    if (!next) {
      result(line);
      followCard(card.id);
      return false;
    }
    const before = order;
    result(line, () => moveSettled(openNow(before)));
    moveSettled(next).catch((error: unknown) => result(`Couldn't start ${named(card.task.title)} next. ${refusalOf(error)}`));
    followCard(card.id);
    return true;
  };
  const pause = async (card: TaskCard) => {
    const s = latest.current.steer;
    if (!s || !online) return;
    const before = new Set((company.steering?.decisions ?? []).map((d) => d.id));
    followCard(card.id);
    try {
      await s.pauseTask(card.id);
    } catch (error) {
      result(`Couldn't pause ${named(card.task.title)}. ${refusalOf(error)}`);
      return;
    }
    result(steerSaid.paused(company, card.task), async () => {
      const call: PaletteCall = { on: 'steer', method: 'pauseTask', args: [card.id] };
      const made = (latest.current.company.steering?.decisions ?? []).find((d) => madeByCall(call, before, d));
      if (made) await s.undoDecision(made.id);
      else await s.resumeTask(card.id);
      followCard(card.id);
    });
  };
  const resume = async (card: TaskCard, next: string[] | null) => {
    const s = latest.current.steer;
    if (!s || !online) return;
    const before = order;
    followCard(card.id);
    try {
      await s.resumeTask(card.id);
    } catch (error) {
      result(`Couldn't resume ${named(card.task.title)}. ${refusalOf(error)}`);
      return;
    }
    if (next) {
      try {
        await moveSettled(next);
      } catch (error) {
        // Two calls: the task stays resumed where it was in line, and the row says why it didn't move.
        result(`Resumed ${named(card.task.title)}, but couldn't change its place. ${refusalOf(error)}`);
        return;
      }
    }
    result(steerSaid.resumed(company, card.task), async () => {
      await s.pauseTask(card.id);
      if (next) await moveSettled(openNow(before));
      followCard(card.id);
    });
  };
  const cancel = async (card: TaskCard, reason: string): Promise<boolean> => {
    const s = latest.current.steer;
    if (!s || !online) return false;
    setForm((f) => (f ? { ...f, busy: true } : f));
    try {
      await s.cancelTask(card.id, reason);
    } catch (error) {
      setForm(null);
      result(`Couldn't cancel ${named(card.task.title)}. ${refusalOf(error)}`);
      followCard(card.id);
      return false;
    }
    setForm(null);
    setRailOpen(true);
    result(steerSaid.cancelled(card.task), async () => {
      const t = latest.current.company.tasks.find((x) => x.id === card.id);
      const decision = t ? cancelDecision(latest.current.company, t) : null;
      if (!decision) throw new Error("That cancel can't be undone any more.");
      await s.undoDecision(decision);
      followCard(card.id);
    });
    followCard(card.id);
    return true;
  };
  const reassign = async (card: TaskCard, to: string, note: string): Promise<boolean> => {
    const s = latest.current.steer;
    if (!s || !online) return false;
    setForm((f) => (f ? { ...f, busy: true } : f));
    try {
      await s.reassignTask(card.id, to, note);
    } catch (error) {
      setForm(null);
      result(`Couldn't reassign ${named(card.task.title)}. ${refusalOf(error)}`);
      followCard(card.id);
      return false;
    }
    setForm(null);
    // A reassignment has no Undo: the new owner may have started, so handing it back is another Reassign.
    result(steerSaid.reassigned(company, card.task, to));
    followCard(card.id);
    return true;
  };

  /** Letting a card go where it is over; null puts it back. True when it landed somewhere (a move, a form). */
  const drop = (h: Held, at: LiftAt | null): boolean => {
    setHeld(null);
    setStep('');
    if (railByDrag && at?.column !== 'cancelled') setRailOpen(false);
    setRailByDrag(false);
    const card = findCard(board, h.id) ?? h.was;
    if (!at) {
      followCard(card.id);
      return false;
    }
    const means = meansOver(card, at.column, h.from, at.lane);
    const ids = idsIn(laneKey(at.lane), at.column);
    switch (means.kind) {
      case 'order': {
        const next = orderForDrop(order, ids, card.id, at.before);
        if (next) moveTo(card, next);
        else followCard(card.id);
        return next !== null;
      }
      case 'resume': {
        const next = orderForDrop(order, ids, card.id, at.before);
        void resume(card, next && !sameOrder(next, order) ? next : null);
        return true;
      }
      case 'pause':
        void pause(card);
        return true;
      case 'start':
        return start(card);
      case 'cancel':
        setRailOpen(true);
        setForm({ kind: 'cancel', card, at: { column: 'cancelled', lane: laneKey(at.lane) }, to: null, busy: false });
        return true;
      case 'reassign':
        setForm({ kind: 'reassign', card, at: { column: at.column, lane: laneKey(at.lane) }, to: means.to, busy: false });
        return true;
      case 'back':
        followCard(card.id);
        return false;
      case 'refused':
        result(means.reason);
        followCard(card.id);
        return false;
    }
  };

  /** A form's Keep it, or Escape in it: the card goes back, with focus on it. */
  const closeForm = () => {
    const f = form;
    flushSync(() => setForm(null));
    if (f) followCard(f.card.id);
  };

  // ----- The keyboard way
  // A lane as the steps say it: "Mina's lane", "the Design lane".
  const laneNameOf = (lane: LaneOf | null) => (lane === null ? null : lane.kind === 'person' ? `${firstName(company, lane.person)}'s lane` : `the ${roomName(lane.room)} lane`);
  const say = (h: Held, at: LiftAt, skipped: { column: ColumnId; reason: string }[] = []) => {
    const means = meansOver(h.was, at.column, h.from, at.lane);
    setStep(liftStep(company, h.was, means, at, idsIn(laneKey(at.lane), at.column), skipped, laneNameOf(at.lane)));
  };
  const nextLane = (lane: LaneOf | null, dir: -1 | 1): LaneOf | null => {
    if (!lanes) return null;
    const open = lanes.filter((l) => !closedLanes.has(l.key));
    const i = open.findIndex((l) => l.key === laneKey(lane));
    return open[i + dir]?.of ?? null;
  };

  const pickUp = (id: string) => {
    // A card already in the hand (by the pointer, or by keys on another card) is never swapped for another.
    if (heldNow.current !== null) return;
    if (!canSteer) {
      setStep(unavailable ?? '');
      return;
    }
    // Cards that don't lift say why, rather than doing nothing.
    if (id === 'plan') {
      setStep("The plan isn't a task: Enter opens it.");
      return;
    }
    const card = findCard(board, id);
    if (!card) return;
    if (!isOpenTask(card.task)) {
      setStep(card.column === 'done' ? 'Done tasks stay done.' : 'Cancelled tasks stay cancelled.');
      return;
    }
    const from = laneOfCard(company, card, group);
    const ids = idsIn(laneKey(from), card.column);
    const at: LiftAt = { column: card.column, lane: from, before: defaultBefore(order, ids, id) };
    setHeld({ by: 'keys', id, was: card, from, fromItems: itemsOf(card.column), at, seen: ids });
    setStep(`${movingLine(card.task)} ${liftStep(company, card, meansOver(card, at.column, from, from), at, ids, [], laneNameOf(from))}`);
  };

  const liftKey = (event: KeyboardEvent<HTMLElement>, h: Held) => {
    const at = h.at;
    if (!at) return;
    const means = meansOver(h.was, at.column, h.from, at.lane);
    const ids = idsIn(laneKey(at.lane), at.column);
    const go = (next: LiftAt, skipped: { column: ColumnId; reason: string }[] = []) => {
      setHeld({ ...h, at: next, seen: idsIn(laneKey(next.lane), next.column) });
      say(h, next, skipped);
    };
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const dir = event.key === 'ArrowUp' ? -1 : 1;
        const before = placed(means) ? stepBefore(ids, h.id, at.before, dir) : at.before;
        if (before !== at.before) {
          go({ ...at, before });
          return;
        }
        // At a column's end with lanes, the card goes on into the next open lane's same column.
        const lane = nextLane(at.lane, dir);
        if (lane) {
          const there = idsIn(laneKey(lane), at.column);
          go({ column: at.column, lane, before: dir < 0 ? null : (there[0] ?? null) });
        } else say(h, at);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const dir = event.key === 'ArrowLeft' ? -1 : 1;
        const stops = COLUMNS.map((c) => ({ column: c.id, lane: at.lane }));
        const next = nextStop(h.was, h.from, stops, stops.findIndex((s) => s.column === at.column), dir);
        if (!next) {
          setStep(nothingFurther(dir));
          return;
        }
        const column = stops[next.index]?.column ?? at.column;
        if (column === 'cancelled' && !railOpen) setRailOpen(true);
        go({ column, lane: at.lane, before: placed(next.means) ? defaultBefore(order, idsIn(laneKey(at.lane), column), h.id) : null }, next.skipped);
        return;
      }
      case ' ':
      case 'Enter':
        event.preventDefault();
        drop(h, at);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        drop(h, null);
        return;
      case 'Tab':
        // Focus moves on: the card goes back where it was.
        setHeld(null);
        setStep('');
        return;
    }
  };

  // A press anywhere outside the lifted card puts it back (focus that only fell to the page while drawing doesn't).
  const liftedId = held?.by === 'keys' ? held.id : null;
  useEffect(() => {
    if (liftedId === null) return;
    const onPress = (event: PointerEvent) => {
      const note = root.current?.querySelector(`[data-tb-note="${CSS.escape(liftedId)}"]`);
      if (event.target instanceof Node && note?.contains(event.target)) return;
      heldNow.current = null;
      setHeldNow(null);
      setStep('');
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [liftedId]);

  // ----- Roving focus over the cards, "And 22 more" and the rail
  const nearestTo = (from: HTMLElement) => (candidates: readonly ItemKey[]) => {
    const box = (from.closest('[data-tb-note]') ?? from).getBoundingClientRect();
    const mid = box.top + box.height / 2;
    let best: ItemKey | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const key of candidates) {
      const el = root.current?.querySelector<HTMLElement>(`[data-tb-key="${CSS.escape(key)}"]`);
      if (!el) continue;
      const b = (el.closest('[data-tb-note]') ?? el).getBoundingClientRect();
      const d = Math.abs(b.top + b.height / 2 - mid);
      if (d < distance) {
        distance = d;
        best = key;
      }
    }
    return best;
  };
  const openMore = (lane: string, column: ColumnId) => {
    const l = lanes ? (lanes.find((x) => x.key === lane) ?? null) : null;
    const cards = columnsOf(l).find((c) => c.id === column)?.cards ?? [];
    const firstNew = cards[shownIn(lane, column, cards).cards.length];
    flushSync(() => setOpened((o) => new Set(o).add(`${lane}|${column}`)));
    if (firstNew) focusItem(cardKey(firstNew.id));
  };
  const openRail = () => {
    flushSync(() => setRailOpen(true));
    const first = board.columns.find((c) => c.id === 'cancelled')?.cards[0];
    if (first) focusItem(cardKey(first.id));
    else document.getElementById('tb-head-cancelled')?.focus();
  };
  const onItemKey = (event: KeyboardEvent<HTMLElement>, key: ItemKey) => {
    // While the pointer holds a card, keys on the board wait for the drop.
    if (heldNow.current?.by === 'pointer') {
      if (event.key === ' ' || event.key === 'Enter' || ARROWS[event.key]) event.preventDefault();
      return;
    }
    if (held?.by === 'keys' && cardOfKey(key) === held.id) {
      liftKey(event, held);
      return;
    }
    if (key === RAIL_KEY && (event.key === 'ArrowRight' || event.key === ' ')) {
      event.preventDefault();
      openRail();
      return;
    }
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const target = arrowTo(grid, key, arrow, nearestTo(event.currentTarget));
      if (target) focusItem(target);
      return;
    }
    const id = cardOfKey(key);
    if (event.key === ' ' && id) {
      event.preventDefault();
      pickUp(id);
    }
  };

  // ----- The pointer's way
  const drag = useCardDrag({
    root: () => root.current,
    canStart: (id) => {
      const card = findCard(board, id);
      return canSteer && !phone && form === null && heldNow.current === null && card !== null && lifts(card);
    },
    onStart: (id) => {
      const card = findCard(board, id);
      if (!card) return;
      const from = laneOfCard(company, card, group);
      const ids = idsIn(laneKey(from), card.column);
      setHeld({ by: 'pointer', id, was: card, from, fromItems: [], at: { column: card.column, lane: from, before: defaultBefore(order, ids, id) }, seen: ids });
    },
    onOver: (over) => {
      const h = heldNow.current;
      if (!h || h.by !== 'pointer') return;
      const at = over ? { column: over.column, lane: laneOfKey(over.lane), before: over.before } : null;
      if (sameAt(at, h.at)) return;
      if (over?.rail && !railOpen) {
        setRailOpen(true);
        setRailByDrag(true);
      }
      setHeld({ ...h, at, seen: over ? idsIn(over.lane, over.column) : h.seen });
    },
    onDrop: (over) => {
      const h = heldNow.current;
      return h ? drop(h, over ? { column: over.column, lane: laneOfKey(over.lane), before: over.before } : null) : false;
    },
    onCancel: () => {
      const h = heldNow.current;
      if (h) drop(h, null);
    },
  });
  // The company changed under a carried card, or the office went away: the pointer lets go of it too.
  const wasHeld = useRef(false);
  useEffect(() => {
    if (wasHeld.current && !held) drag.cancel();
    wasHeld.current = held !== null;
  });

  /** Phones show one column: the one a card is going to comes into view, so focus can follow it there. */
  const showColumn = (card: TaskCard, to: ColumnId) => {
    if (phone && card.column !== 'you') setCurrent(to);
  };

  // ----- Move's items
  const onMove = (card: TaskCard, action: MoveAction, ids: readonly string[]) => {
    switch (action) {
      case 'top':
      case 'up':
      case 'down':
      case 'bottom': {
        const next = orderForDrop(order, ids, card.id, beforeFor(action, ids, card.id));
        if (next) moveTo(card, next);
        else followCard(card.id);
        return;
      }
      case 'start':
        start(card);
        return;
      case 'pick':
        followCard(card.id);
        pickUp(card.id);
        return;
      case 'pause':
        showColumn(card, 'paused');
        void pause(card);
        return;
      case 'resume':
        showColumn(card, homeOf(card.task));
        void resume(card, null);
        return;
      case 'reassign':
      case 'cancel':
        setForm({ kind: action, card, at: null, to: null, busy: false });
        return;
      case 'open':
        navigate(companyHref(companyId, { main: { kind: 'tasks' }, panel: { kind: 'task', task: card.id } }));
        return;
    }
  };

  // ----- Each card as a note
  const faceOf = (ownerId: string): { face: FaceOf; hue: string | null } => {
    const person = index.people.get(ownerId);
    const hue = person ? roomHue(snapshot, person.room) : null;
    // Someone who left keeps a face: their title's first letter, with no room's colour.
    return { face: { kind: 'person', person: person ?? { id: ownerId, name: firstName(company, ownerId, index), look: {} }, hue }, hue };
  };
  const viewOf = (card: Card, w: CardWords | null): NoteView => {
    if (card.kind === 'plan' || !w) {
      const plan = card.kind === 'plan' ? card : null;
      const p = plan ? planWords(company, plan) : { band: '', title: '', line: '', owner: '', description: '' };
      const { face, hue } = faceOf(company.people.find((x) => x.level === 'ceo')?.id ?? '');
      return { id: card.id, hue, tone: 'you', band: p.band, place: null, changed: false, title: p.title, href: links.plan, part: null, parts: null, line: p.line, stuck: null, owner: { name: p.owner, face, mark: null, needsYou: true }, milestone: null, description: p.description };
    }
    const { face, hue } = faceOf(card.task.owner);
    return {
      id: card.id,
      hue,
      tone: card.column === 'you' ? 'you' : card.column === 'done' ? 'done' : card.column === 'cancelled' ? 'cancelled' : 'room',
      band: w.band,
      place: w.place,
      changed: changed.has(card.id),
      title: w.title,
      href: companyHref(companyId, { main: { kind: 'tasks' }, panel: { kind: 'task', task: card.id } }),
      kind: w.kind,
      check: w.check,
      part: w.part,
      parts: w.parts,
      line: w.line,
      stuck: w.stuck,
      owner: { name: w.owner, face, mark: w.stuck ? 'stuck' : null, needsYou: card.column === 'you' },
      milestone: w.milestone,
      description: w.description,
    };
  };

  const keyFor = (card: Card, w: CardWords | null, tabbable: boolean): ReactNode => {
    const tab = tabbable ? 0 : -1;
    if (card.kind === 'plan')
      return (
        <span className="tb-note__key tb-note__key--ink tb-note__key--drawn" aria-hidden="true">
          Open the plan
        </span>
      );
    switch (w?.key?.kind) {
      case 'answer': {
        const href = companyHref(companyId, { main: { kind: 'tasks' }, panel: { kind: 'inbox', item: w.key.item } });
        return (
          <a className="tb-note__key tb-note__key--ink" href={href} tabIndex={tab} aria-label={`Answer ${w.owner}`} onClick={(e) => follow(e, href)}>
            Answer
          </a>
        );
      }
      case 'resume':
        return (
          <button
            type="button"
            className="tb-note__key"
            tabIndex={tab}
            aria-label={`Resume ${named(card.task.title)}`}
            aria-disabled={!canSteer || undefined}
            onClick={() => {
              if (!canSteer) return;
              showColumn(card, homeOf(card.task));
              void resume(card, null);
            }}
          >
            Resume
          </button>
        );
      case 'undo-cancel': {
        const decision = w.key.decision;
        return (
          <button
            type="button"
            className="tb-note__key"
            tabIndex={tab}
            aria-label="Undo the cancel"
            aria-describedby={`tb-desc-${card.id}`}
            aria-disabled={!canSteer || undefined}
            onClick={() => {
              const s = latest.current.steer;
              if (!s || !online) return;
              followCard(card.id);
              s.undoDecision(decision).then(
                () => result(`${named(card.task.title)} is back on the board.`),
                (error: unknown) => result(`Couldn't undo the cancel. ${refusalOf(error)}`),
              );
            }}
          >
            Undo
          </button>
        );
      }
      default:
        return null;
    }
  };

  const formFor = (card: TaskCard): ReactNode => {
    if (!form || form.card.id !== card.id) return null;
    const why = unavailable ?? (form.busy ? (form.kind === 'cancel' ? 'Cancelling…' : 'Reassigning…') : null);
    return (
      <div
        className="tb-form"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeForm();
        }}
      >
        {form.kind === 'cancel' ? (
          <CancelForm company={company} task={card.task} unavailable={why} focus="field" onCancel={(reason) => cancel(card, reason)} onClose={closeForm} />
        ) : (
          <ReassignForm company={company} task={card.task} roomName={roomName} unavailable={why} focus="field" {...(form.to ? { to: form.to } : {})} onReassign={(to, note) => reassign(card, to, note)} onClose={closeForm} />
        )}
      </div>
    );
  };

  const noteFor = (card: Card, lane: string, column: ColumnId, onPhone: boolean): ReactNode => {
    const key = cardKey(card.id);
    const tabbable = onPhone || stop === key;
    const task = card.kind === 'task' ? card : null;
    const steerable = task !== null && lifts(task);
    const w = task ? words(task) : null;
    const view = viewOf(card, w);
    const ids = idsIn(lane, column);
    return (
      <Note
        view={view}
        itemKey={key}
        linkTab={tabbable ? 0 : -1}
        phone={onPhone}
        open={task !== null && openTask === task.id}
        lifted={held?.by === 'keys' && held.id === card.id}
        carries={steerable && canSteer && !onPhone}
        move={task && steerable ? <MoveMenu title={task.task.title} items={moveItems(task, ids, !onPhone)} phone={onPhone} unavailable={unavailable} tabbable={tabbable} onPick={(action) => onMove(task, action, ids)} /> : null}
        keyNode={keyFor(card, w, tabbable)}
        onLinkClick={(e) => follow(e, view.href)}
        onLinkKeyDown={onPhone ? undefined : (e) => onItemKey(e, key)}
        onLinkFocus={onPhone ? undefined : () => setActive(key)}
        onLinkBlur={(e) => {
          // A lifted card goes back when focus moves on to something else (a press elsewhere); not when it only fell
          // to the page while the board drew again.
          if (held?.by === 'keys' && held.id === card.id && e.relatedTarget instanceof HTMLElement && !e.currentTarget.closest('[data-tb-note]')?.contains(e.relatedTarget)) {
            setHeld(null);
            setStep('');
          }
        }}
        onPointerDown={!onPhone && task && steerable ? (e) => drag.start(task.id, e) : undefined}
      />
    );
  };

  /** A card dropped on a column, waiting there with its form until its button is pressed. */
  const pendingIn = (lane: string, column: ColumnId): ReactNode => {
    if (!form?.at || form.at.lane !== lane || form.at.column !== column) return null;
    return (
      <li className="tb-item tb-pending" key={`pending-${form.card.id}`}>
        <Note view={viewOf(form.card, words(form.card))} copy />
        {formFor(form.card)}
      </li>
    );
  };
  const formUnder = (id: string): ReactNode => {
    if (!form || form.at || form.card.id !== id) return null;
    const card = findCard(board, id);
    return card ? formFor(card) : null;
  };

  // ----- How each cell stands while a card is carried
  const stateOf = (lane: string, column: ColumnId): { state: CellState; reason: string | null } => {
    if (!held) return { state: 'idle', reason: null };
    const means = meansOver(held.was, column, held.from, laneOfKey(lane));
    if (means.kind === 'refused') return { state: 'sunk', reason: means.reason };
    const over = held.at !== null && held.at.column === column && laneKey(held.at.lane) === lane;
    return { state: over && takes(means) ? 'lit' : 'idle', reason: null };
  };
  const cellViews = (lane: LaneView | null): CellView[] =>
    columnsOf(lane).map((column) => {
      const lk = lane?.key ?? '';
      const shown = shownIn(lk, column.id, column.cards);
      const { state, reason } = stateOf(lk, column.id);
      const at = held?.at ?? null;
      const here = at !== null && at.column === column.id && laneKey(at.lane) === lk && held !== null && placed(meansOver(held.was, column.id, held.from, at.lane));
      return {
        key: `${lk}|${column.id}`,
        lane: lk,
        column,
        shown: shown.cards,
        hidden: shown.hidden,
        state,
        reason,
        ...(here ? { landing: at.before } : {}),
        pending: pendingIn(lk, column.id),
      };
    });
  const laneFace = (lane: LaneView): { face: FaceOf | null; hue: string | null } => {
    if (lane.of.kind === 'room') return { face: null, hue: roomHue(snapshot, lane.of.room) };
    return faceOf(lane.of.person);
  };
  /** Under Group: Room, a lane across rooms sinks as a refusing column does, and says why on its ribbon. */
  const laneReason = (lane: LaneView): string | null => {
    if (!held || laneKey(held.from) === lane.key) return null;
    const means = meansOver(held.was, held.was.column, held.from, lane.of);
    return means.kind === 'refused' ? means.reason : null;
  };

  /** Show all goes away when pressed: focus to Who where the filters show, else to the board's title. */
  const focusAfterShowAll = () => {
    const who = document.querySelector<HTMLElement>('[data-tb-filter="who"]');
    if (who && who.checkVisibility()) who.focus();
    else document.querySelector<HTMLElement>('[data-board-title]')?.focus();
  };

  // ----- Drawing
  const noTasks = company.tasks.length === 0;
  const plan = planCard(company);
  const allDone = allDoneLine(company.tasks);
  const sentence = boardSentence(company, full);
  const found = filteredLine(board);
  const columnOfCard = (card: Card): ColumnId => board.columns.find((c) => c.cards.some((x) => x.id === card.id))?.id ?? 'queued';
  const laneKeyOfCard = (card: Card): string => (lanes ? laneKey(laneOfCard(company, card, group)) : '');

  const body = noTasks ? (
    <div className="tb-empty">
      <p>{plan ? "No tasks yet: the CEO's plan waits for your approval." : noTasksLine(company)}</p>
      {plan && (
        <a className="tb-note__key tb-note__key--ink" href={links.plan} onClick={(e) => follow(e, links.plan)}>
          Open the plan
        </a>
      )}
    </div>
  ) : phone ? (
    <PhoneBoard
      columns={board.columns}
      lanes={lanes ? lanes.map((lane): PhoneLane => ({ lane, closed: closedLanes.has(lane.key), ...laneFace(lane) })) : null}
      current={current}
      onCurrent={setCurrent}
      shown={(cards, column, lane) => shownIn(lane, column, cards)}
      onMore={(column, lane) => setOpened((o) => new Set(o).add(`${lane}|${column}`))}
      onLane={(lane) => setClosedLanes((s) => toggled(s, lane))}
      note={(card) => noteFor(card, laneKeyOfCard(card), columnOfCard(card), true)}
      formUnder={formUnder}
      sub={
        <>
          <FilterSheet company={company} roomName={roomName} filters={filters} onChange={setFilters} found={found} />
          <AddTask href={links.add} chip />
          <a className="tb-subkey" href={links.plan} onClick={(e) => follow(e, links.plan)}>
            Plan
            {plan && (
              <span className="tb-tab__count tb-tab__count--you">
                1<span className="visually-hidden">, waits for your approval</span>
              </span>
            )}
          </a>
        </>
      }
    />
  ) : board.matching === 0 ? (
    <div className="tb-empty">
      <p>No task matches. Try a word from its title or its owner&apos;s name, or another person or milestone.</p>
      <button type="button" className="tb-note__key tb-note__key--ink" onClick={() => {
        flushSync(() => setFilters({ who: '', milestone: '', find: '', group: filters.group }));
        focusAfterShowAll();
      }}>
        Show all
      </button>
    </div>
  ) : (
    <>
      {allDone && <p className="tb-done-line">{allDone}</p>}
      <Columns
        cells={cellViews(null)}
        lanes={lanes ? lanes.map((lane) => ({ lane, cells: cellViews(lane), closed: closedLanes.has(lane.key), ...laneFace(lane), reason: laneReason(lane) })) : null}
        heads={COLUMNS.map((spec) => {
          const column = board.columns.find((c) => c.id === spec.id) ?? { ...spec, cards: [] };
          const own = held ? stateOf(laneKey(held.from), spec.id) : { state: 'idle' as CellState, reason: null };
          const filled = lanes ? lanes.some((l) => !closedLanes.has(l.key) && (l.columns.find((c) => c.id === spec.id)?.cards.length ?? 0) > 0) : column.cards.length > 0;
          return { column, count: column.cards.length, state: own.state, reason: own.reason, wide: filled || form?.at?.column === spec.id };
        })}
        railOpen={railOpen}
        cancelled={board.columns.find((c) => c.id === 'cancelled')?.cards.length ?? 0}
        tabStop={stop}
        note={(card, cell) => noteFor(card, cell.lane, cell.column.id, false)}
        origin={(id) => (held?.by === 'pointer' && held.id === id) || (form !== null && form.at !== null && form.card.id === id)}
        formUnder={formUnder}
        onMore={(cell) => openMore(cell.lane, cell.column.id)}
        onRail={openRail}
        onLane={(lane) => setClosedLanes((s) => toggled(s, lane))}
        onItemKey={onItemKey}
        onItemFocus={setActive}
      />
    </>
  );

  return (
    <BoardFrame
      title="Tasks"
      {...(sentence ? { summary: sentence } : {})}
      // Phones keep Board and Plan as the Plan chip under the column chips, as the design draws them.
      {...(phone ? {} : { views })}
      viewsLabel="Tasks views"
      filters={phone || noTasks ? undefined : <FilterFields company={company} roomName={roomName} filters={filters} onChange={setFilters} />}
      filtersOn={filtersOn(filters)}
      actions={
        phone ? undefined : (
          <>
            <FilterCount filters={filters} found={found} onChange={setFilters} onShowAll={focusAfterShowAll} />
            <AddTask href={links.add} />
          </>
        )
      }
      status={held?.by === 'keys' ? <p className="tb-moving">{movingLine(held.was.task)}</p> : undefined}
    >
      <div ref={root} className="tb" data-tb-root>
        <p className="visually-hidden" role="status">
          {step}
        </p>
        {body}
      </div>
    </BoardFrame>
  );
}
