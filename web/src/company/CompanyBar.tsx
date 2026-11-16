// The company bar (docs/design-v3.md, "Stage and dock", "The shell", "The company bar"; design-hud, "The company bar"): a
// row of tiles one gutter from the window's top. Left to right: Lobby with what needs you elsewhere, the company's name
// and its stage; the three views; then the budget meter, Inbox with its count (it shows and hides the side panel), Preview
// while the app runs, and More. Short of room, the bar gives way piece by piece in the design's order (shell/barFold.ts):
// a hidden copy of its row at each step is measured whenever what it says changes, so the step is chosen by measure,
// never by folding and measuring again. Phones keep Lobby, the name with a stage dot, Inbox and More, with the views as a
// row of three keys under the bar (one Views menu in short windows).
//
// v0.2 (SPEC-v0.2.md, "Simple, visible, proven", 2): three views, Progress, Office and Tasks; the org chart, the
// dashboards, the decision log, spending, the timeline and your messages open from More, which was the Company menu.
// Simpler still (Robin, 13 Nov 2026): who is at work, the burn, Actions ("Find an action", still Ctrl+K) and Full
// screen moved into More, the money into one meter, and the side panel's own toggle into Inbox. Nothing was removed:
// every address, command and shortcut still works.
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CompanyView } from '../../../src/core/company.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { rate } from '../lib/format.ts';
import { canFullscreen, useFullscreenElement } from '../lib/fullscreen.ts';
import { useMediaQuery } from '../lib/hooks.ts';
import { setStill, stillWords, useStillOffice } from '../lib/still.ts';
import type { MainView } from './address.ts';
import { type CompanyState, companySpend, spendWords, workingNow } from './model.ts';
import { paletteShortcut } from './palette/Palette.tsx';
import { type FoldStep, foldStep, MEASURED_STEPS, nameCap, NAME_MAX, NAME_MAX_FOLDED } from './shell/barFold.ts';
import { Icon, type IconName } from './shell/Icon.tsx';
import type { ShellLayout } from './shell/sidePanelModel.ts';
import { useLiveStripHidden } from './strip/preference.ts';
import { barMeter } from './spending/spendingModel.ts';
import './spending/spending.css';
import { Count } from './ui/Count.tsx';
import { nameWithCount } from './ui/countName.ts';
import { StatePill } from './ui/StatePill.tsx';

type ViewLink = { main: MainView; word: string; icon: IconName; current: (main: MainView) => boolean };

/** The three views (Progress, Office, Tasks), each a place with an address. */
const VIEWS: ViewLink[] = [
  { main: { kind: 'progress' }, word: 'Progress', icon: 'progress', current: (m) => m.kind === 'progress' },
  { main: { kind: 'office' }, word: 'Office', icon: 'office', current: (m) => m.kind === 'office' },
  // A board's link stays current on its sub-views: the plan is Tasks'.
  { main: { kind: 'tasks' }, word: 'Tasks', icon: 'tasks', current: (m) => m.kind === 'tasks' || m.kind === 'plan' },
];

const isBoardOf = (m: MainView, board: string) => m.kind === 'dashboards' && m.board === board;

/** The views behind More, in its Views group. The decision log only once the company runs (steering is bound). */
const MORE_VIEWS: (ViewLink & { steering?: boolean })[] = [
  { main: { kind: 'org' }, word: 'Org chart', icon: 'org', current: (m) => m.kind === 'org' },
  { main: { kind: 'dashboards', board: null }, word: 'Dashboards', icon: 'dashboards', current: (m) => m.kind === 'dashboards' && !isBoardOf(m, 'spend') && !isBoardOf(m, 'timeline') },
  { main: { kind: 'decisions' }, word: 'Decision log', icon: 'dashboards', current: (m) => m.kind === 'decisions', steering: true },
  { main: { kind: 'dashboards', board: 'spend' }, word: 'Spending', icon: 'dashboards', current: (m) => isBoardOf(m, 'spend') },
  { main: { kind: 'dashboards', board: 'timeline' }, word: 'Timeline', icon: 'dashboards', current: (m) => isBoardOf(m, 'timeline') },
];

/** More is marked current while one of its views is the main view, so you can always see where you are. */
const inMore = (m: MainView): boolean => m.kind === 'org' || m.kind === 'dashboards' || m.kind === 'decisions';

export interface CompanyBarProps {
  snapshot: Snapshot;
  company: CompanyView;
  state: CompanyState;
  /** What needs you in the other companies. */
  elsewhere: number;
  layout: ShellLayout;
  demo: boolean;
  online: boolean;
  /** The main view shown, for the switcher's current view. */
  main: MainView;
  /** A view's address, which the switcher's links carry (the side panel's view kept on desktops). */
  viewHref: (main: MainView) => string;
  onView: (main: MainView) => void;
  /** The side panel shows the inbox: Inbox is marked current. */
  inboxCurrent: boolean;
  /** Desktops: whether the side panel shows; Inbox shows and hides it. */
  panelShown: boolean;
  onLobby: () => void;
  /** Desktops: the inbox in the side panel, or the side panel hidden when it shows the inbox already. Phones: the inbox's sheet. */
  onInbox: () => void;
  onPreview: () => void;
  onCustomize: () => void;
  onSettings: () => void;
  /** Steering's decision log and palette; absent until the company starts. */
  onDecisions?: () => void;
  /** Opens the feed over the talk bar: your messages and the replies to them. */
  onMessages?: () => void;
  onActions?: () => void;
  onPause: () => void;
  onResume: () => void;
  /** While the company rests on a usage limit: tries once now. */
  onTryNow?: () => void;
  /** Phones keep the office's map keys in Company. */
  onFit: () => void;
  onZoom: (direction: 1 | -1) => void;
  /** Shows the office full screen, or leaves it; called inside the press, as browsers require. */
  onFullScreen: () => void;
}

export function CompanyBar(props: CompanyBarProps) {
  const { layout } = props;
  const phone = layout === 'phone' || layout === 'short';
  const row = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  // The row's width at each step, and the name's at the last, measured whenever what they say changes; the bar's room.
  const [measured, setMeasured] = useState<{ rows: number[]; name: number } | null>(null);
  const [room, setRoom] = useState(0);
  const [stillNote, setStillNote] = useState('');

  useLayoutEffect(() => {
    const el = ruler.current;
    if (phone || !el) return;
    const measure = () => {
      const rows = [...el.querySelectorAll<HTMLElement>('[data-ruler-step]')].map((r) => Math.ceil(r.getBoundingClientRect().width));
      const name = el.querySelector<HTMLElement>(`[data-ruler-step="${MEASURED_STEPS.at(-1)}"] .cbar__name`);
      setMeasured({ rows, name: name ? Math.ceil(name.getBoundingClientRect().width) : NAME_MAX_FOLDED });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const r of el.querySelectorAll('[data-ruler-step]')) observer.observe(r);
    return () => observer.disconnect();
  }, [phone]);

  useLayoutEffect(() => {
    const el = row.current;
    if (phone || !el) return;
    const observer = new ResizeObserver(([entry]) => setRoom(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [phone]);

  // The step from the measured rows: the first that fits; at the last, the name gives way down to 140 px.
  const step = measured && room > 0 ? foldStepFromRows(measured.rows, room, measured.name) : { step: 0 as const, name: NAME_MAX };

  if (phone) return <PhoneBar {...props} stillNote={stillNote} onStillNote={setStillNote} />;

  return (
    <header className="cbar" data-fold={step.step}>
      <div ref={row} className="cbar__row">
        <BarRow {...props} step={step.step} nameWidth={step.name} onStillNote={setStillNote} />
      </div>
      {/* The bar at each step, hidden, to measure (aria-hidden and inert: nothing in it is heard or focused). */}
      <div ref={ruler} className="cbar__ruler" aria-hidden="true" inert>
        {MEASURED_STEPS.map((s) => (
          <div key={s} className="cbar__row cbar__row--ruler" data-ruler-step={s} data-fold={s}>
            <BarRow {...props} step={s} nameWidth={nameCap(s)} onStillNote={setStillNote} ruler />
          </div>
        ))}
      </div>
      <StillNote text={stillNote} />
    </header>
  );
}

/** foldStep over whole rows: each row's width is its pieces at that step, so the pieces need no separate measure. */
function foldStepFromRows(rows: readonly number[], room: number, name: number): { step: FoldStep; name: number } {
  const first = rows.findIndex((w) => w <= room);
  if (first >= 0) return { step: first as FoldStep, name: nameCap(first as FoldStep) };
  const last = rows.at(-1) ?? 0;
  // The last step: the name, measured at the last row's width, gives up what the row lacks, down to 140.
  return foldStep({ lobby: 0, lobbyFolded: 0, name, pill: 0, pillFolded: 0, views: 0, viewsFolded: 0, meter: 0, inbox: 0, inboxFolded: 0, preview: 0, more: 0, moreFolded: 0, fixed: last - name }, room);
}

/** What the bar says out loud after Still office changes: the menu has closed by then. */
type Noting = { onStillNote: (text: string) => void };

type RowProps = CompanyBarProps & Noting & { step: FoldStep; nameWidth: number; ruler?: boolean };

/** The preview is running: Preview shows on the bar (desktops) until the bar runs short of room. */
const previewUp = (company: CompanyView): boolean => company.preview.state === 'up';

/** The desktop bar's row at a step of giving way. */
function BarRow(props: RowProps) {
  const { snapshot, company, state, elsewhere, demo, step, nameWidth, ruler = false } = props;
  const meter = barMeter(companySpend(company, snapshot.aside), company.spending?.budget, spendWords(company.settings.billing, snapshot.pricesAsOf));
  const spendHref = props.viewHref(SPENDING);
  const preview = previewUp(company) && step < 2;
  return (
    <>
      <div className="cbar__tile cbar__id">
        <LobbyLink elsewhere={elsewhere} words={step < 2} onLobby={props.onLobby} />
        <span className="cbar__divider" aria-hidden="true" />
        <span className="cbar__name" title={company.name} style={{ maxWidth: nameWidth }}>
          {company.name}
        </span>
        {step < 3 ? (
          <StatePill label={state.pill} tone={state.tone} detail={state.sentence} />
        ) : (
          <span className={`cbar__dot cbar__dot--${state.tone}`} title={state.sentence}>
            <span className="visually-hidden">{state.sentence}</span>
          </span>
        )}
        {demo && (
          <span className="mode mode--demo">
            <span className="mode__dot" aria-hidden="true" />
            Demo
          </span>
        )}
      </div>
      <Views {...props} words={step < 1} />
      <span className="cbar__gap" aria-hidden="true" />
      {step < 3 && (
        // The money in one figure; what it means is in its tooltip, More and the Spending view it opens.
        <a
          className={`cbar__tile cbar__meter${meter.state ? ` cbar__meter--${meter.state}` : ''}`}
          href={spendHref}
          title={meter.title}
          aria-label={meter.name}
          style={meter.share === null ? undefined : { ['--share' as string]: `${Math.round(meter.share * 100)}%` }}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            props.onView(SPENDING);
          }}
        >
          <span className="cbar__meter-text">{meter.text}</span>
          {meter.share !== null && <span className="cbar__meter-bar" aria-hidden="true" />}
        </a>
      )}
      <InboxKey company={company} current={props.inboxCurrent} expanded={props.panelShown} words={step < 3} onInbox={props.onInbox} />
      <div className="cbar__tile cbar__keys">
        {preview && (
          <button type="button" className="cbar__key" onClick={props.onPreview}>
            Preview
          </button>
        )}
        <CompanyMenu {...props} folded={step >= 2} previewInBar={preview} phoneItems={false} ruler={ruler} />
      </div>
    </>
  );
}

function LobbyLink({ elsewhere, words, onLobby, phone = false }: { elsewhere: number; words: boolean; onLobby: () => void; phone?: boolean }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onLobby();
  };
  // Phones show the count as desktops do, so it never reads as a second state dot beside the name's.
  const name = phone ? (elsewhere > 0 ? `Lobby, ${elsewhere} need${elsewhere === 1 ? 's' : ''} you elsewhere` : 'Lobby') : nameWithCount('Lobby', elsewhere, ' in other companies');
  return (
    // The lobby where the app is served from: "/" for the office, the base path for the static demo on Pages.
    <a className="cbar__lobby" href={import.meta.env.BASE_URL} aria-label={name} onClick={follow}>
      <Icon name="lobby" />
      {words && <span className="cbar__word">Lobby</span>}
      <Count n={elsewhere} />
    </a>
  );
}

/** Inbox: on desktops it shows the inbox in the side panel and hides the panel when the inbox already shows there. */
function InboxKey({ company, current, expanded, words, onInbox, phone = false }: { company: CompanyView; current: boolean; expanded?: boolean; words: boolean; onInbox: () => void; phone?: boolean }) {
  return (
    <button
      type="button"
      className={`cbar__inbox${phone ? ' cbar__inbox--phone' : ''}`}
      aria-current={current || undefined}
      aria-expanded={phone ? undefined : expanded}
      aria-controls={phone ? undefined : 'company-panel'}
      aria-label={nameWithCount('Inbox', company.inbox)}
      title={phone ? undefined : current ? 'Hide the inbox' : 'Show the inbox'}
      onClick={onInbox}
    >
      {(phone || !words) && <Icon name="inbox" />}
      {words && !phone && <span className="cbar__word">Inbox</span>}
      <Count n={company.inbox} />
    </button>
  );
}

/** The view switcher: a nav of four links, not tabs, since each is a place with an address. */
function Views({ main, viewHref, onView, words, row = false }: CompanyBarProps & { words: boolean; row?: boolean }) {
  return (
    <nav className={row ? 'cbar__views-row' : 'cbar__tile cbar__views'} aria-label="Views">
      {VIEWS.map((v) => {
        const current = v.current(main);
        return (
          <a
            key={v.word}
            className="cbar__view"
            href={viewHref(v.main)}
            aria-current={current ? 'page' : undefined}
            aria-label={words ? undefined : v.word}
            title={words ? undefined : v.word}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onView(v.main);
            }}
          >
            <Icon name={v.icon} />
            {words && <span className="cbar__word">{v.word}</span>}
          </a>
        );
      })}
    </nav>
  );
}

/** The phone's bar: Lobby, the name with a stage dot, Inbox and More; the views as a row under it, or one Views menu in a short window. */
function PhoneBar(props: CompanyBarProps & Noting & { stillNote: string }) {
  const { company, state, elsewhere, layout } = props;
  const short = layout === 'short';
  return (
    <header className={`cbar cbar--phone${short ? ' cbar--short' : ''}`}>
      <div className="cbar__row">
        <div className="cbar__tile cbar__id">
          <LobbyLink elsewhere={elsewhere} words={false} onLobby={props.onLobby} phone />
          <span className="cbar__name" title={company.name}>
            {company.name}
          </span>
          <span className={`cbar__dot cbar__dot--${state.tone}`} title={state.sentence}>
            <span className="visually-hidden">{state.sentence}</span>
          </span>
        </div>
        {short && <ViewsMenu {...props} />}
        <span className="cbar__gap" aria-hidden="true" />
        <InboxKey company={company} current={props.inboxCurrent} words={false} onInbox={props.onInbox} phone />
        <CompanyMenu {...props} folded previewInBar={false} phoneItems />
      </div>
      {!short && <Views {...props} words row />}
      <StillNote text={props.stillNote} />
    </header>
  );
}

/** A short window's one Views key: the current view's glyph and a caret, a menu of every view with the current one marked. */
function ViewsMenu(props: CompanyBarProps) {
  const { main } = props;
  const all = [...VIEWS, ...MORE_VIEWS.filter((v) => !v.steering || props.onDecisions)];
  const current = all.find((v) => v.current(main)) ?? VIEWS[0];
  return (
    <Disclosure
      label={current ? `Views, ${current.word}` : 'Views'}
      buttonClass="cbar__standing cbar__views-key"
      button={
        <>
          {current && <Icon name={current.icon} />}
          <Icon name="down" size={16} className="cbar__caret" />
        </>
      }
    >
      {(close) =>
        all.map((v) => (
          <a
            key={v.word}
            className="cbar__item"
            href={props.viewHref(v.main)}
            aria-current={v.current(main) ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              close();
              props.onView(v.main);
            }}
          >
            <Icon name={v.icon} />
            {v.word}
          </a>
        ))
      }
    </Disclosure>
  );
}

/**
 * More (the Company menu until v0.2): first how the company stands in figures (who is at work, waiting for a desk, the
 * money, the burn), then the views behind it (the org chart, the dashboards, the decision log, spending, the timeline,
 * your messages), then Find an action (the palette, Ctrl+K), Preview unless the bar shows it, Full screen, the map keys
 * on a phone's office, Customize, Settings, Pause or Resume work, Raise the budget, Try now, Still office and the live strip.
 */
function CompanyMenu(props: CompanyBarProps & Noting & { folded: boolean; previewInBar: boolean; phoneItems: boolean; ruler?: boolean }) {
  const { snapshot, company, online, folded, previewInBar, phoneItems, ruler = false } = props;
  const figuresId = useId();
  const groupId = useId();
  const still = useStillOffice();
  const systemStill = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [stripHidden, setStripHidden] = useLiveStripHidden();
  // Only where the browser can show the page full screen: iPhone Safari can't, so it offers nothing that does nothing.
  const [fullscreenable] = useState(() => canFullscreen(document, document.documentElement));
  const full = useFullscreenElement() !== null;
  const running = company.phase === 'running' && !company.problem;
  const paused = company.pause?.reason === 'stakeholder';
  const office = props.main.kind === 'office';
  const views = MORE_VIEWS.filter((v) => !v.steering || props.onDecisions);
  const item = (label: string, run: () => void, extra: { disabled?: boolean; pressed?: boolean } = {}) => (close: () => void) => (
    <button
      type="button"
      className={`cbar__item${extra.pressed !== undefined ? ' cbar__item--toggle' : ''}`}
      aria-disabled={extra.disabled || undefined}
      aria-pressed={extra.pressed}
      onClick={() => {
        if (extra.disabled) return;
        close();
        run();
      }}
    >
      {extra.pressed !== undefined && <Icon name="check" className={`cbar__check${extra.pressed ? '' : ' cbar__check--off'}`} />}
      {label}
    </button>
  );
  const onActions = props.onActions;
  const items: ((close: () => void) => ReactNode)[] = [
    ...(onActions
      ? [
          (close: () => void) => (
            <button
              type="button"
              className="cbar__item"
              aria-keyshortcuts={paletteShortcut.keys}
              onClick={() => {
                close();
                onActions();
              }}
            >
              Find an action
              <kbd className="cbar__item-keys" aria-hidden="true">
                {paletteShortcut.label}
              </kbd>
            </button>
          ),
        ]
      : []),
    ...(previewInBar ? [] : [item('Preview', props.onPreview)]),
    ...(phoneItems && office
      ? [item('Fit the office in view', props.onFit), item('Zoom in', () => props.onZoom(1)), item('Zoom out', () => props.onZoom(-1))]
      : []),
    ...(fullscreenable ? [item(full ? 'Exit full screen' : 'Full screen', props.onFullScreen)] : []),
    item('Customize the office', props.onCustomize),
    item('Settings', props.onSettings),
    ...(running ? [item(paused ? 'Resume work' : 'Pause work', paused ? props.onResume : props.onPause, { disabled: !online })] : []),
    ...(company.pause?.reason === 'budget' ? [item('Raise the budget', props.onSettings)] : []),
    ...(props.onTryNow ? [item('Try now', props.onTryNow, { disabled: !online })] : []),
    item(systemStill ? 'Still office (your system asks for it)' : 'Still office', () => {
      if (systemStill) return;
      setStill(!still);
      props.onStillNote(stillWords(!still));
    }, { pressed: still || systemStill, disabled: systemStill }),
    item(stripHidden ? 'Show the live strip' : 'Hide the live strip', () => setStripHidden(!stripHidden)),
  ];
  const current = inMore(props.main);
  return (
    <Disclosure
      label="More"
      current={current}
      buttonClass={phoneItems ? 'cbar__standing' : `cbar__key${folded ? ' cbar__key--icon' : ''}`}
      ruler={ruler}
      button={
        folded ? (
          <Icon name="menu" />
        ) : (
          <>
            <span className="cbar__word">More</span>
            <Icon name="down" size={16} className="cbar__caret" />
          </>
        )
      }
    >
      {(close) => (
        <>
          <MoreFigures id={figuresId} snapshot={snapshot} company={company} onSpending={() => {
            close();
            props.onView(SPENDING);
          }} spendingHref={props.viewHref(SPENDING)} />
          <span className="cbar__group-rule" aria-hidden="true" />
          <div className="cbar__group" role="group" aria-labelledby={groupId}>
            <p id={groupId} className="cbar__group-title">
              Views
            </p>
            {views.map((v) => (
              <a
                key={v.word}
                className="cbar__item"
                href={props.viewHref(v.main)}
                aria-current={v.current(props.main) ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  close();
                  props.onView(v.main);
                }}
              >
                {v.word}
              </a>
            ))}
            {props.onMessages && (
              <button
                type="button"
                className="cbar__item"
                onClick={() => {
                  close();
                  props.onMessages?.();
                }}
              >
                Your messages
              </button>
            )}
          </div>
          <span className="cbar__group-rule" aria-hidden="true" />
          {items.map((render, i) => (
            <span key={i}>{render(close)}</span>
          ))}
        </>
      )}
    </Disclosure>
  );
}

/** The Spending view, which the meter and More's money open. */
const SPENDING: MainView = { kind: 'dashboards', board: 'spend' };

/**
 * More's figures, which the bar kept until v0.2's simpler bar: who is at work, who waits for a desk, the money (whose
 * words open the Spending view) and the burn over the last five minutes.
 */
function MoreFigures({ id, snapshot, company, spendingHref, onSpending }: Pick<CompanyBarProps, 'snapshot' | 'company'> & { id: string; spendingHref: string; onSpending: () => void }) {
  const meter = barMeter(companySpend(company, snapshot.aside), company.spending?.budget, spendWords(company.settings.billing, snapshot.pricesAsOf));
  return (
    <div className="cbar__group" role="group" aria-labelledby={id}>
      <p id={id} className="cbar__group-title">
        Now
      </p>
      <dl className="cbar__figures">
        <div className="cbar__fig">
          <dt>At work</dt>
          <dd>{workingNow(company, snapshot.serverTime)}</dd>
        </div>
        {company.desks.waiting > 0 && (
          <div className="cbar__fig">
            <dt>Waiting for a desk</dt>
            <dd>{company.desks.waiting}</dd>
          </div>
        )}
        <div className="cbar__fig">
          <dt>Burn, last 5 min</dt>
          <dd>{rate(snapshot.burn.dollarsPerHour)}</dd>
        </div>
      </dl>
      <a
        className="cbar__item cbar__item--money"
        href={spendingHref}
        title={meter.title}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onSpending();
        }}
      >
        <span>
          {capitalFirst(meter.name)}
          <span className="cbar__item-note">See spending</span>
        </span>
      </a>
    </div>
  );
}

const capitalFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The bar's own polite line for Still office: it says what changed, the menu having closed by then. */
function StillNote({ text }: { text: string }) {
  return (
    <p className="visually-hidden" role="status">
      {text}
    </p>
  );
}

/**
 * A key that opens a list of choices under it (More, a short window's Views): a disclosure, closed by a press anywhere
 * else or by Escape, focus back on its key. Choosing puts focus back on the key first, so whatever opens next returns
 * there. `current` marks the key while one of its choices is the place shown.
 */
function Disclosure({ label, buttonClass, button, children, ruler = false, current = false }: { label: string; buttonClass: string; button: ReactNode; children: (close: () => void) => ReactNode; ruler?: boolean; current?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const keyId = `${id}-key`;
  const key = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (list.current?.contains(target) || key.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  // Found by its id, so the choices rendered with it never hold a ref.
  const close = () => {
    setOpen(false);
    document.getElementById(keyId)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    close();
  };
  return (
    <div className="cbar__menu-wrap" onKeyDown={onKey}>
      <button ref={key} id={keyId} type="button" className={buttonClass} aria-label={label} aria-current={current || undefined} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && !ruler && (
        <div ref={list} id={id} className="cbar__menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}
