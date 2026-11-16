// The Org board (docs/design-v3.md, "Stage and dock", "The org chart"; docs/design-hud.md, "The org chart"): the
// company as a real tree over the map, the CEO, then heads, leads and workers, each node with their live state, current
// work, model and spend. A node opens the person in the side panel (and makes them the talk bar's To while its box is
// empty); its More messages, stops, changes the model, moves and fires them, each with Undo where it can be taken back.
// Hire someone asks the CEO or opens a room's hiring card; the fired come back with Rehire. Find someone dims the rest.
// Papers travel the lines when people talk. On phones the chart is People's outline, as a tree that opens and closes.
// Before the start it is the proposal: the same layout, its nodes opening the proposal's forms, Start in the head.
import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompanyView, PersonView } from '../../../../src/core/company.ts';
import type { ReshapeAction } from '../../../../src/core/snapshot.ts';
import { titleFromId } from '../../../../src/core/studio.ts';
import { useMediaQuery } from '../../lib/hooks.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { leashBadge, modelChoices, steeringOf } from '../leash/leashModel.ts';
import { useCompanyClock } from '../people/clock.ts';
import { called, roomName as roomNameOf, visitorsOf } from '../people/peopleModel.ts';
import { refusalOf } from '../people/shared.tsx';
import { canStop, modelName } from '../person/personModel.ts';
import { type ProposalChartValue, proposalChart, useBridge } from '../proposal/chartBridge.ts';
import { draftState, scopingOf, scopingWaits } from '../proposal/model.ts';
import { ProposalChart } from '../proposal/OrgChart.tsx';
import { companyHref, navigate as go, parseCompanyAddress, useLocation } from '../router.ts';
import { BoardFrame, useBoardHead } from '../shell/BoardFrame.tsx';
import type { BoardProps } from '../types.ts';
import { Face, roomHue } from '../ui/Face.tsx';
import { Chart, type ChartApi, type ChartItem } from './Chart.tsx';
import { type MenuChoice, NodeMenu } from './NodeMenu.tsx';
import type { NodeForm } from './orgLayout.ts';
import {
  chartSentence,
  chipLabels,
  findMatches,
  focusAfterLeaving,
  foldWords,
  matchLine,
  membersOf,
  movedRoom,
  newRelays,
  type NodeWords,
  nodeWords,
  openFor,
  relaySeen,
  startsFolded,
} from './orgModel.ts';
import { Outline, type OutlineApi, type OutlineItem } from './Outline.tsx';
import './org.css';

const PHONE = '(max-width: 720px), (max-height: 480px)';
const OFFLINE = 'The office is reconnecting, so changes wait.';
const ZOOM_TIP = "Your browser's own Ctrl and plus still zoom the page.";

export function OrgBoard(props: BoardProps) {
  const founding = props.company.phase === 'founding' || props.company.phase === 'proposed';
  return founding ? <ProposalBoard {...props} /> : <PeopleBoard {...props} />;
}

// ---------------------------------------------------------------------------------------------------------------
// The company's people

function PeopleBoard(props: BoardProps) {
  const { snapshot, company, companyId, actions, steer, navigate, online, openRoom, openVisitor, talk, result } = props;
  const phone = useMediaQuery(PHONE);
  const now = useCompanyClock(snapshot.serverTime, online);
  const location = useLocation();
  const panel = parseCompanyAddress(location.path, location.search)?.route.panel ?? null;
  const openId = panel?.kind === 'person' ? panel.person : null;
  const roomName = (room: string) => roomNameOf(snapshot, room);
  const ceo = company.people.find((p) => p.level === 'ceo') ?? null;
  const chart = useRef<ChartApi | null>(null);
  const outline = useRef<OutlineApi | null>(null);
  const [zoom, setZoom] = useState(1);

  // ----- Open and closed managers: rooms where nobody works start closed over 25 people; then only you open or close them.
  const [startFolded] = useState(() => startsFolded(company, now));
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [query, setQuery] = useState('');
  const finding = query.trim() !== '';
  const matches = useMemo(() => findMatches(company.people, (room) => roomNameOf(snapshot, room), query), [company.people, snapshot, query]);
  const folded = useMemo(() => {
    const keepOpen = finding ? openFor(company, matches) : new Set<string>();
    return new Set(company.people.filter((p) => !keepOpen.has(p.id) && (folds.get(p.id) ?? startFolded.has(p.id))).map((p) => p.id));
  }, [company, finding, matches, folds, startFolded]);
  const onFold = (id: string, closed: boolean) => setFolds((was) => new Map(was).set(id, closed));
  const members = useMemo(() => membersOf(company.people), [company.people]);
  const labels = useMemo(() => chipLabels(company.people), [company.people]);

  // ----- Papers: what changed since the last view of the company.
  const seenRelays = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenRelays.current === null) {
      seenRelays.current = relaySeen(company);
      return;
    }
    const { relays, rings } = newRelays(company, seenRelays.current);
    seenRelays.current = relaySeen(company);
    if (relays.length === 0 && rings.length === 0) return;
    if (phone) outline.current?.relay(relays);
    else chart.current?.relay(relays, rings);
  }, [company, phone]);

  // ----- Find someone: "4 of 18 match", said once typing pauses.
  const [said, setSaid] = useState('');
  useEffect(() => {
    const line = finding ? matchLine(matches.length, company.people.length, query) : '';
    const t = window.setTimeout(() => setSaid(line), 500);
    return () => window.clearTimeout(t);
  }, [finding, matches.length, company.people.length, query]);

  // ----- Changes, each with its result under the head and Undo where it can be taken back.
  const [leaving, setLeaving] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const reshape = async (action: ReshapeAction, failed: string, words: (message: string) => string, undo: ReshapeAction | null): Promise<boolean> => {
    if (!online) {
      result(OFFLINE);
      return false;
    }
    try {
      const r = await actions.reshape(action);
      if (!r.ok) {
        result(r.message);
        return false;
      }
      result(
        words(r.message),
        undo
          ? async () => {
              const back = await actions.reshape(undo);
              if (!back.ok) throw new Error(back.message);
            }
          : undefined,
      );
      return true;
    } catch (error) {
      result(`${failed}: ${refusalOf(error)}`);
      return false;
    }
  };

  const fire = async (p: PersonView) => {
    setLeaving(p.id);
    const to = focusAfterLeaving(company, p);
    const ok = await reshape({ action: 'fire', role: p.id }, `Couldn't fire ${p.name}`, (m) => m, { action: 'rehire', role: p.id });
    setLeaving(null);
    if (ok && to) (phone ? outline.current : chart.current)?.reveal(to, true);
  };
  const move = async (p: PersonView, room: string) => {
    const manager = p.reportsTo ? company.people.find((x) => x.id === p.reportsTo) : undefined;
    const ceoName = ceo ? ceo.name : 'the CEO';
    await reshape({ action: 'move', role: p.id, department: room }, `Couldn't move ${p.name}`, () =>
      manager && manager.level !== 'ceo'
        ? `${p.name} moved to ${roomName(room)} and still reports to ${manager.name}. Ask ${ceoName} to give ${p.name} a manager there.`
        : `${p.name} moved to ${roomName(room)}.`,
      { action: 'move', role: p.id, department: p.room },
    );
  };
  const changeModel = async (p: PersonView, model: string) => {
    if (!online) {
      result(OFFLINE);
      return;
    }
    const was = p.model;
    const line = `${capitalName(p)} runs on ${modelName(model)} from their next desk.`;
    try {
      if (steer) {
        await steer.changeSettings({ model: { person: p.id, model } });
        result(line, async () => void (await steer.changeSettings({ model: { person: p.id, model: was } })));
      } else {
        const ok = await reshape({ action: 'model', role: p.id, model: asModel(model) }, `Couldn't change ${p.name}'s model`, () => line, { action: 'model', role: p.id, model: asModel(was) });
        if (!ok) return;
      }
    } catch (error) {
      result(`Couldn't change ${p.name}'s model: ${refusalOf(error)}`);
    }
  };
  const rehire = (id: string, name: string) => reshape({ action: 'rehire', role: id }, `Couldn't rehire ${name}`, (m) => m, { action: 'fire', role: id });

  // ----- What each node shows and says.
  const items = new Map<string, ChartItem>();
  const rows = new Map<string, OutlineItem>();
  const words = new Map<string, NodeWords>();
  const matched = new Set(matches);
  for (const p of company.people) {
    const moved = movedRoom(company, p);
    const lost = p.reportsTo !== null && !company.people.some((x) => x.id === p.reportsTo) ? lostName(snapshot, p.reportsTo) : null;
    const w = nodeWords(company, p, now, roomName, { moved: moved ? roomName(moved) : null, lostManager: lost });
    words.set(p.id, w);
    const hue = roomHue(snapshot, p.room);
    const leash = leashBadge(steeringOf(company, p.id))?.text ?? null;
    // The leash's tag shows on whole nodes only; the name always says it.
    const label = leash ? `${w.label} ${leash}.` : w.label;
    const shared = { id: p.id, name: p.name, hue, label, description: w.description, open: openId === p.id, dim: finding && !matched.has(p.id) };
    items.set(p.id, {
      ...shared,
      needs: w.kind === 'needs',
      leash,
      moved: moved ? roomName(moved) : null,
      leaving: leaving === p.id,
      render: (form, mark) => <NodeBody p={p} w={w} form={form} hue={hue} chip={labels.get(p.id) ?? p.name} mark={mark} />,
    });
    const under = foldWords(company, p, now);
    rows.set(p.id, {
      ...shared,
      closedLine: `${personLabel(p)}, and ${under.pill.slice(1)} more`,
      render: (mark) => <RowBody p={p} w={w} hue={hue} mark={mark} leash={leash} moved={moved ? roomName(moved) : null} />,
    });
  }
  const open = (id: string) => navigate(`people/${encodeURIComponent(id)}`);

  const visitors = visitorsOf(snapshot, company, now);
  const after =
    visitors.length > 0 ? (
      <section className="org-visitors" aria-labelledby="org-visitors">
        <h3 id="org-visitors" className="org-visitors__title">
          Visitors
        </h3>
        <p className="org-visitors__note">Claude Code sessions in this folder that the company didn&apos;t start.</p>
        <ul className="org-visitors__list">
          {visitors.map((v) => (
            <li key={v.key}>
              <button type="button" className="org-visitor" onClick={() => openVisitor(v.key)}>
                <Face of={{ kind: 'visitor' }} size={28} />
                <span className="org-visitor__name">{v.name}</span>
                <span className="org-visitor__line">
                  {v.word}. {v.line}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const menuPerson = menu ? company.people.find((p) => p.id === menu.id) : undefined;
  const rooms: MenuChoice[] = (snapshot.studio?.departments ?? []).map((d) => ({ value: d.id, label: d.name, hint: null }));
  const fired = snapshot.studio?.fired ?? [];
  const only = company.people.length === 1 && ceo !== null;

  return (
    <BoardFrame
      title="Org chart"
      summary={chartSentence(company, now)}
      shape="chart"
      actions={
        <>
          <FindField query={query} onQuery={setQuery} said={said} found={matches} onFirst={(id) => (phone ? outline.current : chart.current)?.reveal(id, true)} />
          <HireMenu
            ceo={ceo}
            rooms={rooms}
            fired={fired.map((f) => ({ id: f.id, name: f.name ?? f.title, title: f.title }))}
            demo={snapshot.mode === 'demo'}
            online={online}
            onAskCeo={() => ceo && talk.to({ kind: 'person', id: ceo.id }, { focus: true, draft: 'Hire ' })}
            onRoom={(room) => {
              if (snapshot.mode === 'demo' && ceo) talk.to({ kind: 'person', id: ceo.id }, { focus: true, draft: `Hire someone for ${roomName(room)}: ` });
              else openRoom(room);
            }}
            onRehire={(id, name) => void rehire(id, name)}
          />
          {!phone && <ZoomKeys zoom={zoom} chart={chart} />}
        </>
      }
    >
      {only && (
        <p className="org-only">
          Only the CEO is here.{' '}
          <button type="button" className="org-link" onClick={() => ceo && talk.to({ kind: 'person', id: ceo.id }, { focus: true, draft: 'Hire ' })}>
            Tell the CEO who to hire.
          </button>
        </p>
      )}
      {phone ? (
        <Outline label="Org chart" members={members} items={rows} folded={folded} onFold={onFold} onOpen={open} foldNeeds={(id) => foldOf(company, id, now).needs} apiRef={outline} after={after} />
      ) : (
        <Chart
          label="Org chart"
          members={members}
          items={items}
          folded={folded}
          onFold={onFold}
          onOpen={open}
          onMenu={(id, anchor) => setMenu({ id, anchor })}
          chipLabels={labels}
          storageKey={`worklings-org-view:${companyId}`}
          apiRef={chart}
          onZoom={setZoom}
          roomTitle={roomName}
          foldOf={(id) => foldOf(company, id, now)}
          lostName={(id) => lostName(snapshot, id)}
          after={after}
        />
      )}
      {menu && menuPerson && (
        <NodeMenu
          key={menu.id}
          anchor={menu.anchor}
          name={menuPerson.name}
          unavailable={online ? null : OFFLINE}
          canStop={canStop(menuPerson)}
          rooms={menuPerson.level === 'ceo' ? null : rooms.map((r) => (r.value === menuPerson.room ? { ...r, hint: 'Now' } : r))}
          models={modelChoices(menuPerson.model).map((c) => ({ value: c.value, label: c.label, hint: c.value === menuPerson.model ? 'Now' : null }))}
          onMessage={() => talk.to({ kind: 'person', id: menuPerson.id }, { focus: true })}
          onStop={() => talk.stop(menuPerson.id)}
          onModel={(model) => void changeModel(menuPerson, model)}
          onMove={menuPerson.level === 'ceo' ? null : (room) => void move(menuPerson, room)}
          onFire={menuPerson.level === 'ceo' ? null : () => void fire(menuPerson)}
          onClose={(refocus) => {
            const anchor = menu.anchor;
            setMenu(null);
            if (refocus) {
              // Back to the node it opened from, or the ⋯ key if that is where it was opened.
              const node = anchor.isConnected ? anchor : document.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(menu.id)}"]`);
              node?.focus({ preventScroll: true });
            }
          }}
        />
      )}
    </BoardFrame>
  );
}

const capitalName = (p: PersonView) => {
  const c = called(p);
  return c.charAt(0).toUpperCase() + c.slice(1);
};
const asModel = (m: string): 'inherit' | 'opus' | 'sonnet' | 'haiku' => (m === 'opus' || m === 'haiku' || m === 'inherit' ? m : 'sonnet');

function foldOf(company: CompanyView, id: string, now: number) {
  const p = company.people.find((x) => x.id === id);
  if (!p) return { pill: '', line: '', needs: 0 };
  return foldWords(company, p, now);
}

/** Who someone reported to before they left: their name from the fired, else their role's title. */
function lostName(snapshot: BoardProps['snapshot'], id: string): string {
  const f = snapshot.studio?.fired.find((x) => x.id === id);
  return f?.name ?? f?.title ?? titleFromId(id);
}

// ---------------------------------------------------------------------------------------------------------------
// A node and a row

/** The state chip: its words, a mark of its own shape, and the colour backing them up. */
function StateChip({ w }: { w: NodeWords }) {
  return <span className={`org-state org-state--${w.kind}`}>{w.chip}</span>;
}

function PaperMark({ text }: { text: string }) {
  return (
    <span className="org-from">
      <span className="org-from__paper" aria-hidden="true" />
      {text}
    </span>
  );
}

function NodeBody({ p, w, form, hue, chip, mark }: { p: PersonView; w: NodeWords; form: NodeForm; hue: string | null; chip: string; mark: string | null }) {
  const needs = w.kind === 'needs';
  if (form === 'chip') {
    return (
      <>
        <span className="org-node__face">
          <Face of={{ kind: 'person', person: p, hue }} size={20} needsYou={needs} />
          <span className={`org-dot org-dot--${w.kind}`} aria-hidden="true" />
        </span>
        <span className="org-node__name">{chip}</span>
      </>
    );
  }
  if (form === 'compact') {
    return (
      <>
        <Face of={{ kind: 'person', person: p, hue }} size={28} needsYou={needs} />
        <span className="org-node__id">
          <span className="org-node__name">{p.name}</span>
          {mark ? <PaperMark text={mark} /> : <StateChip w={w} />}
        </span>
      </>
    );
  }
  return (
    <>
      <Face of={{ kind: 'person', person: p, hue }} size={32} needsYou={needs} />
      <span className="org-node__id">
        <span className="org-node__name">{p.name}</span>
        {p.title !== p.name && <span className="org-node__title">{p.title}</span>}
      </span>
      <span className="org-node__nums">
        <span className="org-node__cost">{w.cost}</span>
        <span className="org-node__model">{w.model}</span>
      </span>
      <span className="org-node__now">
        <StateChip w={w} />
        <span className="org-node__task">{mark ? <PaperMark text={mark} /> : w.line}</span>
      </span>
    </>
  );
}

function RowBody({ p, w, hue, mark, leash, moved }: { p: PersonView; w: NodeWords; hue: string | null; mark: string | null; leash: string | null; moved: string | null }) {
  return (
    <span className="org-row__body">
      <Face of={{ kind: 'person', person: p, hue }} size={32} needsYou={w.kind === 'needs'} />
      <span className="org-row__id">
        <span className="org-row__name">{p.name}</span>
        {p.title !== p.name && <span className="org-row__title">{p.title}</span>}
      </span>
      <span className="org-row__cost">{w.cost}</span>
      <span className="org-row__now">
        <StateChip w={w} />
        <span className="org-row__task">{mark ? <PaperMark text={mark} /> : w.line}</span>
        {leash && <span className="org-row__tag">{leash}</span>}
        {moved && <span className="org-row__tag org-row__tag--moved">In {moved}</span>}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The head's keys

function FindField({ query, onQuery, said, found, onFirst }: { query: string; onQuery: (q: string) => void; said: string; found: readonly string[]; onFirst: (id: string) => void }) {
  const head = useBoardHead();
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query !== '') {
      // A search field with words clears them first (the shell's Escape order).
      e.preventDefault();
      onQuery('');
    } else if (e.key === 'Enter' && found[0]) {
      e.preventDefault();
      onFirst(found[0]);
    }
  };
  return (
    <span className={`org-find${head.narrowSearch ? ' org-find--narrow' : ''}`}>
      <label className="visually-hidden" htmlFor={id}>
        Find someone
      </label>
      <svg className="org-find__glyph" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8.5 3.5a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12.2 12.2L16.5 16.5" />
      </svg>
      <input
        id={id}
        className="org-find__box"
        type="search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Find someone"
        value={query}
        aria-describedby={`${id}-said`}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <span id={`${id}-said`} className="org-find__said" role="status">
        {said}
      </span>
    </span>
  );
}

function ZoomKeys({ zoom, chart }: { zoom: number; chart: { current: ChartApi | null } }) {
  const head = useBoardHead();
  return (
    <span className="org-zoom" role="group" aria-label="Zoom">
      <button type="button" className="org-zoom__key" aria-label="Zoom out" title={`Zoom out. ${ZOOM_TIP}`} onClick={() => chart.current?.zoomOut()}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 10h10" />
        </svg>
      </button>
      <output className="org-zoom__pct" aria-label={`Zoom ${Math.round(zoom * 100)}%`}>
        {Math.round(zoom * 100)}%
      </output>
      <button type="button" className="org-zoom__key" aria-label="Zoom in" title={`Zoom in. ${ZOOM_TIP}`} onClick={() => chart.current?.zoomIn()}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 10h10M10 5v10" />
        </svg>
      </button>
      <button type="button" className="org-zoom__fit" onClick={() => chart.current?.fit()}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />
        </svg>
        {head.glyphs ? 'Fit' : 'Fit the chart'}
      </button>
    </span>
  );
}

interface HireMenuProps {
  ceo: PersonView | null;
  rooms: MenuChoice[];
  fired: { id: string; name: string; title: string }[];
  demo: boolean;
  online: boolean;
  onAskCeo: () => void;
  onRoom: (room: string) => void;
  onRehire: (id: string, name: string) => void;
}

/** Hire someone: ask the CEO, hire into a room (its hiring card in the side panel), or rehire someone fired. */
function HireMenu({ ceo, rooms, fired, demo, online, onAskCeo, onRoom, onRehire }: HireMenuProps) {
  const head = useBoardHead();
  const id = useId();
  const popRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<'main' | 'rooms'>('main');
  const glyph = head.glyphs;

  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const place = (event: Event) => {
      const open = (event as ToggleEvent).newState === 'open';
      if (!open) {
        setPage('main');
        return;
      }
      const at = keyRef.current?.getBoundingClientRect();
      if (!at) return;
      const w = el.offsetWidth;
      el.style.top = `${Math.round(at.bottom + 8)}px`;
      el.style.left = `${Math.round(Math.max(8, Math.min(at.left, window.innerWidth - w - 8)))}px`;
      el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    };
    el.addEventListener('toggle', place);
    return () => el.removeEventListener('toggle', place);
  }, []);
  useLayoutEffect(() => {
    if (popRef.current?.matches(':popover-open')) popRef.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [page]);

  const close = () => {
    popRef.current?.hidePopover();
    keyRef.current?.focus({ preventScroll: true });
  };
  const pick = (fn: () => void) => () => {
    popRef.current?.hidePopover();
    fn();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(popRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = (j: number) => {
      e.preventDefault();
      items[(j + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (page === 'rooms') setPage('main');
      else close();
    } else if (e.key === 'ArrowLeft' && page === 'rooms') {
      e.preventDefault();
      setPage('main');
    }
  };
  const ceoName = ceo ? ceo.name : 'the CEO';
  return (
    <>
      <button
        ref={keyRef}
        type="button"
        className={`bf__key org-hire${glyph ? ' org-hire--glyph' : ''}`}
        popoverTarget={id}
        aria-haspopup="menu"
        aria-label={glyph ? 'Hire someone' : undefined}
        title={glyph ? 'Hire someone' : undefined}
      >
        <svg className="org-hire__glyph" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8 3.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M2.5 16.5c.4-3.3 2.6-5 5.5-5s5.1 1.7 5.5 5M15.5 6.5v5M13 9h5" />
        </svg>
        {!glyph && 'Hire someone'}
      </button>
      <div ref={popRef} id={id} className="org-menu org-menu--hire" popover="auto" role="menu" aria-label="Hire someone" onKeyDown={onKey}>
        {page === 'main' ? (
          <>
            <button type="button" role="menuitem" className="org-menu__item" onClick={pick(onAskCeo)}>
              Ask {ceoName} to hire someone
            </button>
            {rooms.length > 0 && (
              <button type="button" role="menuitem" className="org-menu__item" aria-haspopup="menu" onClick={() => setPage('rooms')}>
                Hire into a room
                <span className="org-menu__more" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
            {fired.length > 0 && (
              <>
                <p className="org-menu__title">Fired ({fired.length})</p>
                {fired.map((f) => (
                  <button key={f.id} type="button" role="menuitem" className="org-menu__item" aria-disabled={!online || undefined} onClick={online ? pick(() => onRehire(f.id, f.name)) : undefined}>
                    Rehire {f.name}
                    {f.name !== f.title && <span className="org-menu__hint">{f.title}</span>}
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <button type="button" role="menuitem" className="org-menu__item" onClick={() => setPage('main')}>
              Back
            </button>
            <p className="org-menu__title">{demo ? `Which room? ${ceoName} hires for it.` : 'Which room?'}</p>
            {rooms.map((r) => (
              <button key={r.value} type="button" role="menuitem" className="org-menu__item" onClick={pick(() => onRoom(r.value))}>
                {r.label}
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Before the start: the proposal

function ProposalBoard(props: BoardProps) {
  const { company, companyId, snapshot } = props;
  const phone = useMediaQuery(PHONE);
  const value: ProposalChartValue | null = useBridge(proposalChart);
  const chart = useRef<ChartApi | null>(null);
  const [zoom, setZoom] = useState(1);
  const ceo = company.people.find((p) => p.level === 'ceo') ?? null;
  // The side panel holds the proposal; opening a node opens its form there.
  useEffect(() => {
    if (phone || value) return;
    go(companyHref(companyId, { main: { kind: 'org' }, panel: { kind: 'proposal' } }), { replace: true });
  }, [phone, value, companyId]);

  if (!value) {
    const status = ceo?.status?.text ?? null;
    // Before the draft, the CEO's scoping questions wait for you in the proposal.
    const scoping = scopingWaits(scopingOf(company));
    const idle = draftState(company);
    const line = scoping
      ? 'The CEO has a few questions before drafting your company. Answer them in the proposal.'
      : idle === 'stopped'
        ? 'You stopped the CEO. Draft again from the proposal.'
        : idle === 'ended'
          ? "The CEO's turn ended without a proposal. Answer it, or draft again, from the proposal."
          : 'The CEO is drafting your company. About a minute.';
    const summary = scoping ? 'The CEO has a few questions first.' : idle === 'stopped' ? 'The CEO is stopped.' : idle === 'ended' ? 'The CEO is waiting for you.' : 'The CEO is drafting your company.';
    return (
      <BoardFrame title="Org chart" summary={summary}>
        <div className="org-drafting">
          {ceo && (
            <div className="org-drafting__ceo" data-hue={roomHue(snapshot, ceo.room) ?? undefined}>
              <Face of={{ kind: 'person', person: ceo, hue: roomHue(snapshot, ceo.room) }} size={32} />
              <span className="org-node__id">
                <span className="org-node__name">{ceo.name}</span>
                <span className="org-node__title">{ceo.title}</span>
              </span>
            </div>
          )}
          <p className="org-drafting__line">{line}</p>
          {status && <p className="org-drafting__status">{status}</p>}
        </div>
      </BoardFrame>
    );
  }

  const start: ReactNode = (
    <span className="org-start">
      {value.plan && !phone && <span className="org-start__cost">{value.plan}</span>}
      {value.cost && <span className="org-start__cost">{value.cost}</span>}
      <button
        type="button"
        className="bf__key org-start__key"
        aria-disabled={value.startBlocked !== null || value.starting || undefined}
        title={value.startBlocked ?? undefined}
        onClick={() => {
          if (!value.startBlocked && !value.starting) value.onStart();
        }}
      >
        {value.starting ? 'Starting…' : 'Start the company'}
      </button>
    </span>
  );
  return (
    <BoardFrame title="Org chart" summary={`The CEO's proposal: ${value.proposal.people.length} people.`} shape="chart" actions={<>{start}{!phone && <ZoomKeys zoom={zoom} chart={chart} />}</>}>
      <ProposalChart value={value} phone={phone} apiRef={chart} onZoom={setZoom} storageKey={`worklings-org-view:${companyId}:proposal`} />
    </BoardFrame>
  );
}

