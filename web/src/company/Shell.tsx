// A company's office, the stage and dock (docs/design-v3.md, "Stage and dock"): the 3D office fills the window; the company
// bar floats at its top; the main view is the office or a board over it (Org, Tasks, Dashboards; Preview and a task's diff
// in the same frame); the side panel on the right holds what you opened; the talk bar, the live strip and the feed sit at
// the main view's foot. The path names the main view and `?panel=` the side panel's (address.ts). The shell routes,
// counts, keeps focus, measures the pieces the camera keeps clear of, and binds v2's Catch me up and Ask aside to the
// company's routes. The views come from their streams (mounts.tsx); today's panels stand in where a board isn't built yet.
import { type CSSProperties, type ReactNode, Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CompanyView, LobbyView } from '../../../src/core/company.ts';
import type { ReshapeAction, Snapshot, StudioCatalog } from '../../../src/core/snapshot.ts';
import type { Studio } from '../../../src/core/studio.ts';
import { countWord } from '../../../src/core/now.ts';
import { capital } from '../../../src/core/words.ts';
import { type TalkTarget, talkFor } from '../hud/asideModel.ts';
import { CatchUp } from '../hud/CatchUp.tsx';
import { Conversation, useAskAside } from '../hud/Conversation.tsx';
import { personHue } from '../hud/model.ts';
import { PersonCard } from '../hud/PersonCard.tsx';
import { RoomCard } from '../hud/RoomCard.tsx';
import { Loading, Locked, NoWebGL } from '../hud/States.tsx';
import { companyApiBase, getCatalog, pointApiAt } from '../lib/api.ts';
import { fullscreenProblem, toggleFullscreen, useFullscreenElement } from '../lib/fullscreen.ts';
import { hasWebGL, useOfficeClock, useReducedMotion } from '../lib/hooks.ts';
import type { Selection } from '../scene/Building.tsx';
import { OfficeLabelsContext } from '../scene/labels.tsx';
import { Stage, type StageCamera, type StageMode, useStageCamera } from '../scene/Stage.tsx';
import { useCast, useOfficeLayout } from '../scene/useCast.ts';
import type { HubActions } from './api.ts';
import { LiveRegion, useAnnouncer } from './announcer.tsx';
import { CompanyBar } from './CompanyBar.tsx';
import { Customize } from './customize/Customize.tsx';
import { type Cover, type StageInsets, stageInsets } from './insets.ts';
import { noTasksLine } from './plan/planModel.ts';
import { companyNews, companyState, companyTitle, lobbyNews, otherNeeds, reconnectingLine, showsStateCallout, stateOfCompany } from './model.ts';
import { Boundary, Decisions, DiffBoard, Dock, Inbox, Mounted, People, PersonPanel, Plan, PreviewBoard, Progress, Tasks, TaskBoard, OrgBoard, DashboardsBoard, TraceView } from './mounts.tsx';
import { noteCompanyShown, peekLobbyNotice, setLobbyNotice } from './notice.ts';
import { onInboxRequest } from './showInbox.ts';
import { headline, spendLine } from './now/nowModel.ts';
import { Palette, usePalette } from './palette/Palette.tsx';
import { SkewContext } from './people/clock.ts';
import { scopingOf, scopingWaits } from './proposal/model.ts';
import { ProposalView } from './proposal/ProposalView.tsx';
import { headBackAt, isBoard, mainViewTitle, peeksAt, sideShownAt, stageModeOf } from './panelView.ts';
import { type CompanyRoute, companyHref, type FocusKey, goBack, type Location, type MainView, navigate, openSub, type PanelView, restoreFocus, type TalkIntent, unmark } from './router.ts';
import { Settings } from './settings/Settings.tsx';
import { type BoardHost, BoardHostContext, type BoardResult } from './shell/boardHost.ts';
import { BoardFrame } from './shell/BoardFrame.tsx';
import { MiniMap } from './shell/MiniMap.tsx';
import { SidePanel, type SidePanelHead } from './shell/SidePanel.tsx';
import { fitPanelWidth, layoutOf, PANEL_MIN, panelBounds } from './shell/sidePanelModel.ts';
import { usePanelMemory, useWindowSize } from './shell/useShell.ts';
import { useShellKeys } from './shell/useShellKeys.ts';
import './shell/shell.css';
import './progress/progress.css';
import { stageOfView, stageShown } from './progress/progressModel.ts';
import { stagePill } from './lobby/lobbyModel.ts';
import { createTalkLink } from './talk/link.ts';
import type { CompanyActions, SteeringActions, TabProps } from './types.ts';
import { roomHue } from './ui/Face.tsx';
import type { Stream } from './useHub.ts';

/** A task's diff, the task page's own code, loaded when a diff is opened. */

/** How often an open, visible office tells the hub the stakeholder is looking (the hub keeps one look a minute at most). */
const LOOKED_EVERY_MS = 5 * 60_000;

/** A phone's sheets over the page, as marked entries at the same address, so Back and the back swipe close them. */
const HOME_SHEET = 'home';
const FEED_SHEET = 'feed';

interface ShellProps {
  companyId: string;
  route: CompanyRoute;
  /** An address from before the stage and dock: put right on arrival. */
  old: boolean;
  /** What an old address asked the talk bar for (its To, focus in its box), done once. */
  intent: TalkIntent | null;
  location: Location;
  stream: Stream<Snapshot & { company: CompanyView }>;
  lobby: LobbyView | null;
  actions: CompanyActions;
  hub: HubActions;
  demo: boolean;
  /** The tab's access token, for v2's calls (Catch me up, Ask aside, the studio's files); null in the demo. */
  token: string | null;
  /** Steering (the plan, the board, messages, leashes, the decision log), handed to every view; absent until bound. */
  steer?: SteeringActions;
  /** The demo's banner over a recorded run (v0.8), under the bar and over the office. */
  banner?: ReactNode;
}

/** What takes the side panel's place without an address of its own: v2's room card, a visitor's badge, Ask aside. */
type Overlay = { kind: 'room'; id: string } | { kind: 'visitor'; key: string } | { kind: 'talk'; target: TalkTarget };

export function Shell(props: ShellProps) {
  const { stream } = props;
  if (stream.connection === 'locked') return <Locked />;
  if (stream.connection === 'gone') return <Gone refusal={stream.refusal} />;
  if (!stream.data) return <Loading />;
  return (
    // Views time Undo windows on this browser's clock, so they need how far the hub's clock runs ahead of it.
    <SkewContext.Provider value={stream.skew}>
      <CompanyOffice {...props} snapshot={stream.data} />
    </SkewContext.Provider>
  );
}

/**
 * A company that left the lobby, or can't run, or one the demo doesn't have: straight to the lobby, which says so. Nothing
 * shows meanwhile: "Connecting to the server" would be untrue, the office has answered.
 */
function Gone({ refusal }: { refusal: string | null }) {
  useEffect(() => {
    // A removal from Settings has already said why, with its Undo.
    if (!peekLobbyNotice()) setLobbyNotice({ text: refusal ?? "That company isn't in the lobby any more." });
    navigate('/', { replace: true });
  }, [refusal]);
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The latest request to move focus: a later one ends an earlier one still waiting for its element. */
let focusRequest = 0;

/**
 * Focus on the element the first selector finds, once it can take focus: a view still loading, or a side panel still
 * coming out of hidden, gets a few frames. The other selectors are the fallbacks if it never does.
 */
function focusSoon([first, ...fallbacks]: string[], frames = 12) {
  focusRequest += 1;
  const mine = focusRequest;
  const take = (selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  };
  const tryNow = (left: number) => {
    if (mine !== focusRequest || first === undefined || take(first)) return;
    if (left > 0) window.requestAnimationFrame(() => tryNow(left - 1));
    else fallbacks.some(take);
  };
  tryNow(frames);
}

/** Back's focus: the element that had it when the entry was left, once its view has drawn, else `otherwise`. */
function restoreSoon(key: FocusKey, otherwise: () => void, frames = 12) {
  focusRequest += 1;
  const mine = focusRequest;
  const tryNow = (left: number) => {
    if (mine !== focusRequest || restoreFocus(key)) return;
    if (left > 0) window.requestAnimationFrame(() => tryNow(left - 1));
    else otherwise();
  };
  tryNow(frames);
}

function CompanyOffice({ companyId, route, old, intent, location, snapshot, stream, lobby, actions, hub, demo, token, steer, banner }: ShellProps & { snapshot: Snapshot & { company: CompanyView } }) {
  const company = snapshot.company;
  const online = stream.connection === 'live';
  const win = useWindowSize();
  const layout = layoutOf(win.width, win.height);
  const phone = layout === 'phone' || layout === 'short';
  const reducedMotion = useReducedMotion();
  const [webgl] = useState(() => hasWebGL());
  const now = useOfficeClock(snapshot, stream.receivedAt, online);
  const { announce, news, items } = useAnnouncer();
  // The talk bar's control, one per company: every view sets the To through it (TabProps.talk).
  const [link] = useState(createTalkLink);
  const talk = link.control;
  const [feedOpen, setFeedOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [memory, keepMemory] = usePanelMemory();
  // The office's camera, for the map keys: Fit, and Zoom in and out toward whoever is open in the side panel.
  const camera = useStageCamera();
  const full = useFullscreenElement() !== null;
  const root = useRef<HTMLDivElement>(null);
  const skip = useRef<(() => void) | null>(null);
  const founding = company.phase === 'founding' || company.phase === 'proposed';
  const { main, panel } = route;
  const href = useCallback((next: CompanyRoute) => companyHref(companyId, next), [companyId]);

  // Phones: a field in a sheet has the keyboard up, so the sheet takes what the keyboard leaves and the talk bar hides.
  const [typing, setTyping] = useState(false);
  const [visible, setVisible] = useState<{ top: number; height: number } | null>(null);
  const [lowered, setLowered] = useState(false);
  const askFailed = useCallback((text: string) => setFailure(text), []);
  const asks = useAskAside(token, announce, askFailed);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);

  // Overlays stack (a visitor's badge, then their conversation) and belong to the address they opened on.
  const [overlays, setOverlays] = useState<{ on: number; stack: { what: Overlay; opener: HTMLElement | null }[] }>({ on: 0, stack: [] });
  const stack = overlays.on === location.key ? overlays.stack : [];
  const overlay = stack.at(-1) ?? null;

  // v2's calls (Catch me up, Ask aside, the room card's files) go to this company's routes while it shows.
  useEffect(() => (demo ? undefined : pointApiAt(companyApiBase(companyId))), [companyId, demo]);
  // Back in the lobby, this company's world plays its way out.
  useEffect(() => noteCompanyShown(companyId), [companyId]);

  // ------------------------------------------------------------------------------------------------------------
  // Where things go

  /** A view inside the office, as today's views still write it ("people/kai", "tasks/t-12", "send/room/design"). */
  const nav = useCallback(
    (sub: string, options?: { replace?: boolean }) => {
      const next = openSub(route, sub, !phone);
      if (next.talk) {
        if (next.talk.to) talk.to(next.talk.to, { focus: true });
        else talk.focus();
      }
      if (!same(next.route, route)) navigate(href(next.route), options);
      // "Open the inbox" on a phone, with nothing open: the home's sheet comes up, as an entry Back closes.
      else if (phone && !next.talk && next.route.panel === null && location.mark === null) navigate(href(route), { mark: HOME_SHEET });
    },
    [route, phone, talk, href, location.mark],
  );
  const openPanel = useCallback((next: PanelView | null) => navigate(href({ main, panel: next })), [href, main]);
  /** "Back to the inbox": the side panel's home over the main view shown; on a phone, the sheet goes down. */
  const showHome = useCallback(() => {
    goBack(href({ main, panel: null }));
  }, [href, main]);
  // One panel at a time: a main view of its own (Progress, a board) opens with the side panel closed.
  const openMain = useCallback((next: MainView) => navigate(href({ main: next, panel: null })), [href]);
  /** Back to the office, or from a diff back to its task: the main view shown before, kept beside the side panel's. */
  const closeMain = useCallback(() => {
    if (main.kind === 'diff') goBack(href({ main: { kind: 'tasks' }, panel: { kind: 'task', task: main.task } }));
    else goBack(href({ main: { kind: 'office' }, panel: phone ? null : panel }));
  }, [main, href, phone, panel]);

  // An old address is put right on arrival, and what it asked of the talk bar done once.
  const intentDone = useRef(false);
  useEffect(() => {
    if (!old) return;
    navigate(href(route), { replace: true, at: location.key });
  }, [old, href, route, location.key]);
  useEffect(() => {
    if (!intent || intentDone.current) return;
    intentDone.current = true;
    if (intent.to) talk.to(intent.to, { focus: true });
    else talk.focus();
  }, [intent, talk]);

  // After the start there is no proposal to show; before it, the side panel's home is the proposal. Start itself lands
  // on progress (replacing the address, as the proposal's own redirect does), so the first thing after it is the plan
  // taking shape in plain words.
  const phaseWas = useRef(company.phase);
  useEffect(() => {
    const was = phaseWas.current;
    phaseWas.current = company.phase;
    const started = (was === 'proposed' || was === 'founding') && company.phase === 'running';
    if (started && panel?.kind === 'proposal') navigate(href({ main: { kind: 'office' }, panel: null }), { replace: true, at: location.key });
    else if (!founding && panel?.kind === 'proposal') navigate(href({ main, panel: null }), { replace: true, at: location.key });
  }, [company.phase, founding, panel, main, href, location.key]);

  // Since you last looked: the hub keeps when the stakeholder last had this company open. A look when it opens, then
  // one every few minutes while the page shows. A look that doesn't arrive only makes "since" start later; the next
  // one carries it, so a failure here isn't worth a word on screen.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === 'visible') actions.looked().catch(() => undefined);
    };
    look();
    const every = window.setInterval(look, LOOKED_EVERY_MS);
    document.addEventListener('visibilitychange', look);
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', look);
    };
  }, [actions, companyId]);

  // Opening someone in the side panel, however it was opened, makes them the To while the talk bar's box is empty: only
  // someone in the company, since an address can name anyone.
  const person = panel?.kind === 'person' ? panel.person : null;
  const inCompany = person !== null && company.people.some((p) => p.id === person);
  useEffect(() => {
    if (person !== null && inCompany) talk.offer({ kind: 'person', id: person });
  }, [person, inCompany, talk]);

  // Desktops: anything that opens into a hidden side panel brings it back.
  const panelKey = JSON.stringify(panel);
  const shownPanel = useRef(panelKey);
  useEffect(() => {
    if (shownPanel.current === panelKey) return;
    shownPanel.current = panelKey;
    if (panel !== null && memory.hidden) keepMemory({ hidden: false });
  }, [panelKey, panel, memory.hidden, keepMemory]);

  // Phones: "Back to the inbox" or "Show the inbox" from a sheet with nothing under it (opened by its address) brings the
  // inbox's sheet up, as the bar's Inbox does; a swipe down closes it instead.
  const sheetDown = useRef(false);
  /** The address whose close brings the inbox's sheet up, so focus goes to its title rather than the office's. */
  const inboxUp = useRef<number | null>(null);
  useEffect(() => {
    const down = sheetDown.current;
    sheetDown.current = false;
    if (!phone || !location.closed || down || panel !== null || location.mark !== null) return;
    inboxUp.current = location.key;
    navigate(href(route), { mark: HOME_SHEET, at: location.key });
  }, [phone, location.closed, location.key, location.mark, panel, href, route]);

  // A phone's feed is a sheet: an entry of its own at the same address, so Back and the back swipe close it.
  const feedMarked = location.mark === FEED_SHEET;
  const onFeed = useCallback(
    (open: boolean) => {
      setFeedOpen(open);
      if (!phone) return;
      if (open) {
        // A side panel view's sheet goes down to its peek as the feed opens, so the feed is not left inert under it; Back
        // from the feed brings the sheet up again. (A mark only sets at the address it is in.)
        if (panel !== null) navigate(href({ main, panel: null }));
        navigate(panel !== null ? href({ main, panel: null }) : href(route), { mark: FEED_SHEET });
      } else unmark(FEED_SHEET);
    },
    [phone, href, route, main, panel],
  );
  const wasMarked = useRef(feedMarked);
  useEffect(() => {
    const before = wasMarked.current;
    wasMarked.current = feedMarked;
    if (!phone || before === feedMarked) return;
    if (feedMarked && !feedOpen) link.openFeed();
    if (!feedMarked && feedOpen) link.closeFeed();
  }, [feedMarked, feedOpen, phone, link]);

  // ------------------------------------------------------------------------------------------------------------
  // Focus and the page's title

  // Where focus goes (design-v3, "Where focus goes"), once for each place the address reaches.
  const hiddenToTalk = useRef(false);
  const placed = useRef<{ key: number; route: CompanyRoute } | null>(null);
  useEffect(() => {
    const was = placed.current;
    if (was !== null && was.key === location.key) return;
    placed.current = { key: location.key, route };
    // Hide closed the inbox's entry with Back: focus goes to the talk bar, as Hide says, not where the entry was left.
    if (hiddenToTalk.current) {
      hiddenToTalk.current = false;
      talk.focus();
      return;
    }
    const officeHeading = () => focusSoon(['#company-office-heading']);
    const boardTitle = () => (main.kind === 'progress' ? focusSoon(['#progress-heading', '[data-progress]']) : focusSoon(['[data-board-title]']));
    const panelTitle = () => focusSoon(['#company-panel [data-panel-heading]']);
    if (was === null) {
      // Entering a company puts focus on its hidden heading; a reload, on the title of what it shows.
      if (!location.returned) officeHeading();
      else if (main.kind !== 'office') boardTitle();
      else if (panel !== null) panelTitle();
      return;
    }
    // Forward, closing as a new entry, or a Back whose element has gone: the title of what changed; a board closing
    // leaves it on the office's heading.
    const titleOfChange = () => {
      if (!same(was.route.main, main)) {
        if (main.kind === 'office') officeHeading();
        else boardTitle();
      } else if (!same(was.route.panel, panel)) {
        if (panel !== null) panelTitle();
        // Closed back to the side panel's home: the inbox's title; on a phone, the main view's when the sheet goes down.
        else if (location.returned && (!phone || inboxUp.current === location.key)) panelTitle();
        else if (location.returned) {
          if (main.kind === 'office') officeHeading();
          else boardTitle();
        }
      }
    };
    // Back puts focus where it was.
    if (location.returned && location.restore) restoreSoon(location.restore, titleOfChange);
    else titleOfChange();
  }, [location.key, location.returned, location.restore, route, main, panel, phone, talk]);

  useEffect(() => {
    document.title = companyTitle(company.name, company.inbox, mainViewTitle(main));
  }, [company.name, company.inbox, main]);

  // ------------------------------------------------------------------------------------------------------------
  // The live region, v2's room cards and badges

  const before = useRef<CompanyView | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = company;
    if (was && was.id === company.id) news(companyNews(was, company));
  }, [company, news]);
  const lobbyBefore = useRef<LobbyView | null>(null);
  useEffect(() => {
    const was = lobbyBefore.current;
    lobbyBefore.current = lobby;
    if (was && lobby) news(lobbyNews(was, lobby, companyId));
  }, [lobby, companyId, news]);

  useEffect(() => {
    if (!failure) return;
    const id = window.setTimeout(() => setFailure(null), 6_000);
    return () => window.clearTimeout(id);
  }, [failure]);

  // The studio's files for a room card or a badge (its rules, what can be hired): live offices only.
  const wantCatalog = !demo && catalog === null && (overlay?.what.kind === 'room' || overlay?.what.kind === 'visitor');
  useEffect(() => {
    if (!wantCatalog) return;
    let cancelled = false;
    getCatalog(token).then(
      (c) => !cancelled && setCatalog(c),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [wantCatalog, token]);

  const push = useCallback(
    (what: Overlay, opener: Element | null = document.activeElement) => {
      setOverlays((o) => ({ on: location.key, stack: [...(o.on === location.key ? o.stack : []), { what, opener: opener instanceof HTMLElement ? opener : null }] }));
      if (!phone) keepMemory({ hidden: false });
    },
    [location.key, phone, keepMemory],
  );
  /** Closes the top overlay; focus goes back to what opened it, else to the side panel's heading. */
  const pop = useCallback(() => {
    const opener = overlay?.opener ?? null;
    flushSync(() => setOverlays((o) => ({ ...o, stack: o.stack.slice(0, -1) })));
    setTyping(false);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('#company-panel [data-panel-heading]')?.focus({ preventScroll: true });
  }, [overlay, setTyping]);
  const openRoom = useCallback((room: string) => push({ kind: 'room', id: room }), [push]);
  const openVisitor = useCallback((key: string) => push({ kind: 'visitor', key }), [push]);

  const selection: Selection =
    overlay?.what.kind === 'room' ? { kind: 'room', id: overlay.what.id } : overlay?.what.kind === 'visitor' ? { kind: 'agent', key: overlay.what.key } : person ? { kind: 'role', id: person } : null;
  const onSelect = useCallback(
    (s: Selection) => {
      if (!s) return;
      if (s.kind === 'role') openPanel({ kind: 'person', person: s.id });
      else if (s.kind === 'room') openRoom(s.id);
      else {
        const who = company.people.find((p) => p.agentKey === s.key);
        if (who) openPanel({ kind: 'person', person: who.id });
        else openVisitor(s.key);
      }
    },
    [company.people, openPanel, openRoom, openVisitor],
  );

  // Room cards and badges change the studio through the company's reshape; their words come back in the live region.
  const canChange = !online ? 'The office is reconnecting, so changes wait.' : !demo && !token ? 'Open the office from the link the CLI printed to make changes.' : null;
  const onReshape = useCallback(
    async (action: ReshapeAction) => {
      try {
        const result = await actions.reshape(action);
        if (result.ok) announce(result.message);
        else setFailure(result.message);
        if (result.ok && !demo) setCatalog(await getCatalog(token));
        return result.ok;
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "The office didn't answer. Try again.");
        return false;
      }
    },
    [actions, announce, demo, token],
  );

  const tabProps: TabProps = {
    snapshot,
    company,
    companyId,
    actions,
    navigate: nav,
    announce,
    online,
    // The demo makes nothing up for Catch me up: it has no office to ask.
    catchUp: demo ? null : <CatchUp snapshot={snapshot} token={token} connected={online} announce={announce} cancelling={asks.cancelling} onCancel={(id) => void asks.cancel(id)} />,
    openRoom,
    openVisitor,
    expandSheet: setTyping,
    steer,
    talk,
  };
  // One stage everywhere: the bar's pill says what the lobby's card and progress say; the office's sentence is its detail.
  // While fix rounds run it says "Fixing" (v0.3), as progress does.
  const stage = stageShown(company, now);
  const state = { ...stagePill(stageOfView(company, now), companyState(stateOfCompany(company, now), now).sentence), pill: stage.word, tone: stage.tone };
  // The palette (Ctrl+K, or the bar's button) steers a running company; until the start the proposal is all there is.
  const palette = usePalette(!founding);

  const run = (what: string, action: () => Promise<unknown>) => () => {
    action().catch((error: unknown) => {
      const text = `Couldn't ${what}. ${error instanceof Error ? error.message : ''}`.trim();
      setFailure(text);
      announce(text);
    });
  };
  const resting = company.pause !== null && company.pause.reason !== 'stakeholder' && company.pause.reason !== 'budget';
  const tryNow = () => {
    actions.resume().then(
      () => announce('Trying once. A new limit sets a new time.'),
      (error: unknown) => {
        const text = `Couldn't try now. ${error instanceof Error ? error.message : ''}`.trim();
        setFailure(text);
        announce(text);
      },
    );
  };

  // The request goes out inside the press (a browser grants full screen to nothing else); a refusal is said.
  const fullScreen = () => {
    void toggleFullscreen(document, document.documentElement).then((result) => {
      const problem = fullscreenProblem(result);
      if (!problem) return;
      setFailure(problem);
      announce(problem);
    });
  };

  // ------------------------------------------------------------------------------------------------------------
  // The side panel: shown or hidden, its width, a phone's sheet

  const bounds = panelBounds(win.width);
  const width = layout === 'floating' ? PANEL_MIN : fitPanelWidth(memory.width, bounds);
  const homeSheet = location.mark === HOME_SHEET;
  // v0.8 (SPEC-v0.8.md, decision 1): office first. On desktops too the side panel stays closed until you ask for something,
  // and the inbox you open (See all, More's Inbox) is an entry of its own over the office, as a phone's sheet is: Back
  // closes it and Forward brings it back, and opening Progress or a board leaves it, one panel at a time.
  const inboxOpen = homeSheet && main.kind === 'office';
  const shown = sideShownAt({ phone, main, panel, overlay: overlay !== null, homeSheet, hidden: memory.hidden, inboxOpen, founding });
  // Before the start a phone shows the proposal's sheet peeking over the office; after it, the inbox card is the way in.
  const peek = founding && peeksAt({ phone, main, panel, sheetUp: shown, overlay: overlay !== null, feedOpen, typing });
  const setHidden = useCallback(
    (hidden: boolean, refocus = true) => {
      // Before the start the proposal is the panel's home and remembers being hidden; after it, hiding closes what shows.
      if (founding) keepMemory({ hidden });
      else if (!hidden) return; // After the start a closed panel leaves no pull to show it by; More's Inbox and the card open it.
      else {
        if (homeSheet) {
          // The entry closes by Back; once it has, focus goes to the talk bar (the placing effect below).
          hiddenToTalk.current = refocus;
          unmark(HOME_SHEET);
        }
        if (panel !== null) navigate(href({ main, panel: null }));
        setOverlays((o) => (o.stack.length > 0 ? { on: 0, stack: [] } : o));
      }
      if (hidden && refocus && !(homeSheet && !founding)) window.requestAnimationFrame(() => (founding ? document.querySelector<HTMLElement>('.side-panel__separator')?.focus({ preventScroll: true }) : talk.focus()));
    },
    [keepMemory, founding, panel, href, main, talk, homeSheet],
  );
  const setWidth = useCallback((next: number) => keepMemory({ width: next }), [keepMemory]);
  // A drag writes the live width on the root, so the side panel and the pieces over the main view follow by CSS alone.
  // Its end writes back what the shell draws: React writes the root's style only when that changes.
  const mainRight = !phone && shown ? width + 24 : 0;
  const onDrag = useCallback(
    (live: number | null) => {
      const el = root.current;
      if (!el) return;
      el.style.setProperty('--side-w', `${live ?? width}px`);
      el.style.setProperty('--main-right', `${live === null ? mainRight : live + 24}px`);
    },
    [width, mainRight],
  );

  const showInbox = () => {
    if (phone) {
      // One panel at a time on phones too: the inbox's sheet comes up over the office, as an entry of its own.
      if (!homeSheet) navigate(href({ main: { kind: 'office' }, panel: null }), { mark: HOME_SHEET, elsewhere: true });
    } else {
      if (memory.hidden) keepMemory({ hidden: false });
      // One panel at a time: the inbox closes Progress or a board and opens over the office, as an entry of its own.
      navigate(href({ main: { kind: 'office' }, panel: null }), { mark: HOME_SHEET, elsewhere: true });
    }
    focusSoon(['#company-panel [data-panel-heading]']);
  };
  // A view's own "Show the inbox" (a person or a task that has gone) opens it as More's Inbox does.
  const inboxAsked = useEffectEvent(() => showInbox());
  useEffect(() => onInboxRequest(() => inboxAsked()), []);
  const closeSheet = () => {
    if (overlay) pop();
    else if (panel !== null) {
      // A swipe or Close puts the sheet down, even where "Back to the inbox" would bring the inbox's sheet up.
      sheetDown.current = true;
      showHome();
    } else if (homeSheet) unmark(HOME_SHEET);
  };

  // Phones: the sheet takes 78% of the room between the views row and the strip, half for Customize and Settings or after
  // "Show the office", and while someone types, all the height the keyboard leaves.
  const half = panel?.kind === 'customize' || panel?.kind === 'settings' || lowered;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!phone || !vv) return;
    const update = () => setVisible({ top: vv.offsetTop, height: vv.height });
    const first = window.setTimeout(update, 0);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      window.clearTimeout(first);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [phone]);
  const sheetStyle: CSSProperties | undefined = phone && typing ? { top: visible?.top ?? 0, bottom: 'auto', height: visible?.height ?? win.height } : undefined;

  // ------------------------------------------------------------------------------------------------------------
  // The stage: its mode and the two insets it keeps clear, from what the shell measures

  const mode = webgl ? stageModeOf({ main, phone, feedOpen }) : 'covered';
  const caption = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const progressCol = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<{ caption: number | null; keys: number | null; talk: number; sheet: number | null; sheetBottom: number | null; feed: Cover | null; progress: number | null; card: number | null }>({ caption: null, keys: null, talk: 56, sheet: null, sheetBottom: null, feed: null, progress: null, card: null });
  useLayoutEffect(() => {
    const read = () => {
      const bottom = (el: HTMLElement | null) => (el && el.offsetParent !== null ? Math.round(el.getBoundingClientRect().bottom) : null);
      const talkNow = Number.parseFloat(root.current?.style.getPropertyValue('--talk-now') ?? '');
      const paper = document.querySelector<HTMLElement>('#company-panel .side-panel__paper');
      const sheet = phone && paper && !paper.hidden ? Math.round(paper.getBoundingClientRect().top) : null;
      const sheetBottom = phone && paper && !paper.hidden ? Math.round(paper.getBoundingClientRect().bottom) : null;
      // The open feed on a desktop stands over the office: its top and foot from the row it sits in (the feed itself rises
      // into place with a transform), its sides from the feed.
      const row = !phone ? document.querySelector<HTMLElement>('.dock__above--feed') : null;
      const piece = row?.firstElementChild;
      const feed = row && piece ? { left: Math.round(piece.getBoundingClientRect().left), right: Math.round(piece.getBoundingClientRect().right), top: Math.round(row.getBoundingClientRect().top), bottom: Math.round(row.getBoundingClientRect().bottom) } : null;
      // The progress column's right edge: the office stands in what it leaves.
      const column = !phone && progressCol.current ? Math.round(progressCol.current.getBoundingClientRect().right) : null;
      // The inbox card over the talk bar (v0.8), which writes its height on the root (`--card-now`) while it shows: the labels
      // keep clear of it, and the camera of a fixed share of it.
      const cardNow = Number.parseFloat(root.current?.style.getPropertyValue('--card-now') ?? '');
      const card = Number.isFinite(cardNow) && cardNow > 0 ? cardNow : null;
      const next = { caption: bottom(caption.current), keys: bottom(keys.current), talk: Number.isFinite(talkNow) && talkNow > 0 ? talkNow : 56, sheet, sheetBottom, feed, progress: column, card };
      setMeasured((was) => (same(was, next) ? was : next));
    };
    read();
    const resize = new ResizeObserver(read);
    if (caption.current) resize.observe(caption.current);
    if (keys.current) resize.observe(keys.current);
    if (progressCol.current) resize.observe(progressCol.current);
    const paper = document.getElementById('company-panel');
    if (phone && paper) resize.observe(paper);
    const feedRow = !phone ? document.querySelector<HTMLElement>('.dock__above--feed') : null;
    if (feedRow) resize.observe(feedRow);
    // The talk bar writes its height on the root (--talk-now) as it grows and shrinks.
    const style = new MutationObserver(read);
    if (root.current) style.observe(root.current, { attributes: true, attributeFilter: ['style'] });
    return () => {
      resize.disconnect();
      style.disconnect();
    };
  }, [main.kind, layout, phone, shown, peek, half, typing, feedOpen]);
  // The inbox card (SPEC-v0.8.md, decision 2): over the office and beside Progress, never while the whole list shows.
  // A phone's progress fills the screen, and says how many need you with See all, so the card waits for the office.
  const showsCard = !founding && (main.kind === 'office' || (main.kind === 'progress' && !phone)) && !(shown && panel === null && !overlay) && !(phone && shown);
  const insets = stageInsets({ layout, side: !phone && shown ? width : null, talk: measured.talk, caption: measured.caption, keys: measured.keys, sheet: phone && (shown || peek) && !typing ? measured.sheet : null, sheetBottom: layout === 'short' && peek ? measured.sheetBottom : null, safeBottom: 0, height: win.height, feed: !phone && feedOpen ? measured.feed : null, progress: !phone && main.kind === 'progress' ? measured.progress : null, card: measured.card });

  // ------------------------------------------------------------------------------------------------------------
  // The keys: Escape by where focus is, Enter on nothing to talk

  // Progress is a place of its own, not a board over the office: Escape leaves it alone.
  const onProgress = main.kind === 'progress';
  const mainOpen = main.kind !== 'office' && !onProgress;
  useShellKeys({ mainOpen, closeMain, skip: () => skip.current?.(), talk: () => talk.focus() });

  // ------------------------------------------------------------------------------------------------------------
  // The board host: the row under a board's head, Back to the office, and the feed over it

  const [result, setResult] = useState<BoardResult | null>(null);
  // A press's row and its Undo belong to the board where it happened: leaving it (for the office or another board) ends
  // them, so an old Undo never reverts what changed since.
  const [resultBoard, setResultBoard] = useState(main.kind);
  if (resultBoard !== main.kind) {
    setResultBoard(main.kind);
    if (result !== null) setResult(null);
  }
  const resultKey = useRef(0);
  const boardResult = useCallback(
    (text: string, undo?: () => Promise<void>) => {
      resultKey.current += 1;
      setResult({ text, ...(undo ? { undo } : {}), key: resultKey.current });
      announce(text);
    },
    [announce],
  );
  const host: BoardHost = useMemo(() => ({ result, dismiss: () => setResult(null), close: closeMain, feedOpen }), [result, closeMain, feedOpen]);

  // ------------------------------------------------------------------------------------------------------------

  const sideHead: SidePanelHead = {
    onBack: headBackAt({ prev: location.prev, company: companyId, route, feedOpen }) && !overlay ? () => window.history.back() : null,
    onHome: overlay ? pop : panel !== null ? showHome : phone && homeSheet ? closeSheet : null,
    // v0.8: the × leads back to the inbox only when you had opened it; otherwise it closes the side panel.
    homeLabel: overlay ? 'Back' : phone && panel === null ? 'Close' : founding ? 'Back to the proposal' : phone || !inboxOpen ? 'Close' : 'Back to the inbox',
    // Before the start the proposal's own heading is in the sheet; only its peek (an empty card otherwise) takes a title.
    title: panel === null && !overlay && founding && peek ? { text: "The CEO's proposal", sentence: company.phase === 'proposed' ? 'Read it, then start it, answer the CEO or change it.' : scopingWaits(scopingOf(company)) ? 'The CEO has a few questions first. Answer them, or use its picks.' : 'The CEO is drafting it. Your words reach the CEO meanwhile.', label: "The CEO's proposal", opens: "the CEO's proposal" } : panel === null && !overlay && !founding ? { text: 'Inbox', sentence: phone ? phoneHeadline(company, now, showsStateCallout(company) ? '' : state.sentence) : inboxLine(company), label: company.inbox > 0 ? `Inbox, ${company.inbox} need${company.inbox === 1 ? 's' : ''} you` : 'Inbox' } : null,
    person: person && !overlay ? personHead(company, snapshot, person) : null,
  };
  const reconnecting = !online ? reconnectingLine(snapshot.serverTime) : null;
  const sheetUp = phone && shown;
  const boardView = mainOpen;
  // The reconnecting row lies under the bar; a board's head starts below it (--reconnect-h) instead of under it.
  const rowRef = useRef<HTMLParagraphElement>(null);
  const hasRow = reconnecting !== null;
  useLayoutEffect(() => {
    const el = root.current;
    const row = rowRef.current;
    if (!el) return;
    if (!hasRow || !row) {
      el.style.removeProperty('--reconnect-h');
      return;
    }
    const set = () => el.style.setProperty('--reconnect-h', `${Math.ceil(row.getBoundingClientRect().height)}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(row);
    return () => {
      watch.disconnect();
      el.style.removeProperty('--reconnect-h');
    };
  }, [hasRow]);

  return (
    <div
      ref={root}
      className={`shell shell--${layout}${!phone && shown ? ' shell--panel' : ''}${!phone && isBoard(main) ? ' shell--board' : ''}`}
      data-company-shell
      data-layout={layout}
      data-typing={typing || undefined}
      data-sheet={sheetUp ? 'panel' : undefined}
      style={{ '--side-w': `${width}px`, '--main-right': `${mainRight}px`, '--float-clear': layout === 'floating' && shown ? `${width + 24}px` : '0px', '--sheet-share': half ? 0.5 : 0.78, '--progress-right': !phone && onProgress && measured.progress ? `${measured.progress}px` : '0px' } as CSSProperties}
    >
      {/* The heading takes focus on entering; it comes first in the page, so the skip links are the first stops after it. */}
      <h1 id="company-office-heading" tabIndex={-1} className="visually-hidden company__h1">
        {company.name} office
      </h1>
      <a
        className="skip-link"
        href="#company-talk"
        onClick={(event) => {
          event.preventDefault();
          talk.focus();
        }}
      >
        Skip to the talk bar
      </a>
      <a
        className="skip-link"
        href="#company-panel"
        onClick={(event) => {
          event.preventDefault();
          showInbox();
        }}
      >
        Skip to the side panel
      </a>
      <div className="shell__frame">
        <CompanyBar
          snapshot={snapshot}
          company={company}
          state={state}
          elsewhere={otherNeeds(lobby, companyId)}
          layout={layout}
          demo={demo}
          online={online}
          main={main}
          viewHref={(next) => href({ main: next, panel: null })}
          onView={openMain}
          inboxCurrent={shown && panel === null && !overlay && !founding}
          onLobby={() => navigate('/')}
          onInbox={showInbox}
          onPreview={() => openMain({ kind: 'preview' })}
          onCustomize={() => openPanel({ kind: 'customize' })}
          onSettings={() => openPanel({ kind: 'settings' })}
          onDecisions={founding ? undefined : () => openMain({ kind: 'decisions' })}
          onMessages={founding ? undefined : () => link.openFeed()}
          onActions={founding ? undefined : palette.show}
          onPause={run('pause work', () => actions.pause())}
          onResume={run('resume work', () => actions.resume())}
          onTryNow={resting ? tryNow : undefined}
          onFit={() => camera.fit()}
          onZoom={(direction) => void camera.zoom(direction)}
          onFullScreen={fullScreen}
        />
        {banner}
        {reconnecting && (
          <p ref={rowRef} className="shell-reconnecting" role="status">
            {reconnecting}
          </p>
        )}
        <main className="shell-stage" aria-labelledby="company-office-heading">
          {/* A short window's raised sheet covers the room: nothing under it may take focus (the desk sign, the screen's key). */}
          <div className="stage" data-mode={mode} aria-hidden={mode === 'covered' || undefined} inert={(layout === 'short' && sheetUp && !peek) || undefined}>
            {webgl ? (
              <Boundary fallback={<NoStage />}>
                <CompanyStage
                  snapshot={snapshot}
                  company={company}
                  actions={actions}
                  open={nav}
                  selection={selection}
                  onSelect={onSelect}
                  reducedMotion={reducedMotion}
                  mode={mode}
                  insets={insets}
                  camera={camera}
                  thumbnail={sheetUp && !half}
                  quiet={onProgress}
                  onSkip={(run) => {
                    skip.current = run;
                  }}
                />
              </Boundary>
            ) : (
              main.kind === 'office' && <NoWebGL />
            )}
          </div>
          {phone && sheetUp && !typing && (
            <button type="button" className="shell-show-office" onClick={() => setLowered((l) => !l)}>
              {half && !lowered ? 'Show more' : lowered ? 'Show more' : onProgress ? 'Show progress' : 'Show the office'}
            </button>
          )}
          <div className="shell-main" data-main data-panel={layout === 'floating' && shown ? 'floating' : undefined}>
            {onProgress && (
              <section ref={progressCol} className="progress" aria-labelledby="progress-heading" data-progress inert={(phone && sheetUp) || undefined}>
                <Boundary fallback={<ProgressFallback text="This view couldn't load. Reload the page to try again; the office, the task board and the inbox still work." />}>
                  <Suspense fallback={<ProgressFallback text="Opening progress…" />}>{Progress && <Progress {...tabProps} now={now} onInbox={showInbox} />}</Suspense>
                </Boundary>
              </section>
            )}
            {boardView && (
              <div className="shell-board" data-main-view inert={(phone && sheetUp) || undefined}>
                <BoardHostContext.Provider value={host}>
                  <MainBoard main={main} tabProps={tabProps} result={boardResult} announce={announce} />
                </BoardHostContext.Provider>
              </div>
            )}
            {!phone && isBoard(main) && (
              <MiniMap camera={camera} state={{ pill: state.pill, tone: state.tone }} needs={company.inbox} onBack={closeMain} hidden={feedOpen || !webgl} fullscreen={full} />
            )}
            {Dock && (
              <Boundary fallback={null}>
                <Suspense fallback={null}>
                  <Dock {...tabProps} link={link} board={boardView || onProgress} office={main.kind === 'office'} phone={phone} founding={founding} onFeed={onFeed} onChip={palette.run} inboxBeside={!phone && shown && panel === null && !overlay && !founding} card={showsCard} onSeeAll={showInbox} />
                </Suspense>
              </Boundary>
            )}
          </div>
        </main>
        <div className="toast-region" role="status" aria-live="polite">
          {failure && <p className="toast toast--error">{failure}</p>}
        </div>
      </div>
      <SidePanel
        layout={layout}
        shown={shown}
        place={`${location.key}:${stack.length}`}
        width={width}
        bounds={bounds}
        inbox={company.inbox}
        pull={founding}
        peek={peek}
        onPeek={showInbox}
        head={sideHead}
        sheet={phone ? { style: sheetStyle ?? {}, half, onLower: () => setLowered((l) => !l), onClose: overlay || panel !== null || homeSheet ? closeSheet : null } : undefined}
        onWidth={setWidth}
        onHidden={setHidden}
        onDrag={onDrag}
      >
        {overlay ? (
          <OverlayView
            overlay={overlay.what}
            snapshot={snapshot}
            catalog={catalog}
            canChange={canChange}
            now={now}
            phone={phone}
            online={online}
            token={token}
            asks={asks}
            onSelect={onSelect}
            onReshape={onReshape}
            onAsk={(target, opener) => push({ kind: 'talk', target }, opener)}
            onBack={pop}
            onTyping={setTyping}
          />
        ) : (
          <PanelBody panel={panel} founding={founding} tabProps={tabProps} hub={hub} phone={phone} now={now} demo={demo} />
        )}
      </SidePanel>
      <Palette {...tabProps} open={palette.open && !founding} start={palette.start} onClose={palette.hide} />
      <LiveRegion items={items} />
    </div>
  );
}

/** The person whose panel is open, for the side panel head's band in their room's hue. */
function personHead(company: CompanyView, snapshot: Snapshot, id: string) {
  const p = company.people.find((x) => x.id === id);
  return p ? { person: p, hue: roomHue(snapshot, p.room) } : null;
}

/** A phone has no caption: the inbox starts with the headline's sentences and the spend. */
function phoneHeadline(company: CompanyView, now: number, state: string): string {
  const head = headline(company, now, state);
  return [head.needs, ...head.rest, spendLine(company)].filter((s): s is string => s !== null && s !== '').join(' ');
}

const inboxLine = (c: CompanyView) => (c.inbox === 0 ? 'Nothing needs you.' : `${capital(countWord(c.inbox))} ${c.inbox === 1 ? 'needs' : 'need'} you, oldest first.`);

interface CompanyStageProps {
  snapshot: Snapshot;
  company: CompanyView;
  /** For the office screen's screenshots. */
  actions: CompanyActions;
  /** Goes to a view under the company: `inbox/q-3`, `proposal`, `preview`. */
  open: (path: string) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  reducedMotion: boolean;
  mode: StageMode;
  insets: StageInsets;
  camera: StageCamera;
  thumbnail: boolean;
  /** Progress beside the office: only bubbles of people who need you. */
  quiet: boolean;
  /** Hands the shell the walk-in's skip, for Escape on nothing. */
  onSkip: (skip: (() => void) | null) => void;
}

/**
 * The company's office in 3D, on its own so a failure stays here. Rooms and desks keep their places from one studio to
 * the next (useOfficeLayout); the cast's moments, night and frame tier go to the stage, the frame governor's walk
 * budget comes back to the cast, and the labels get the company, its screenshots and the way to open what they show.
 */
function CompanyStage({ snapshot, company, actions, open, selection, onSelect, reducedMotion, mode, insets, camera, thumbnail, quiet, onSkip }: CompanyStageProps) {
  const studioKey = JSON.stringify(snapshot.studio);
  const studio = useMemo(() => JSON.parse(studioKey) as Studio | null, [studioKey]);
  const layout = useOfficeLayout(studio);
  const [budget, setBudget] = useState<number | undefined>();
  const scene = useCast(snapshot, layout, reducedMotion, null, { budget });
  const labels = useMemo(() => ({ company, screenshotUrl: (shot: string) => actions.screenshotUrl(shot), open }), [company, actions, open]);
  useEffect(() => {
    onSkip(scene.skip ?? null);
    return () => onSkip(null);
  }, [scene.skip, onSkip]);
  return (
    <OfficeLabelsContext.Provider value={labels}>
      <Stage
        snapshot={snapshot}
        layout={layout}
        cast={scene.cast}
        clock={scene.clock}
        scene={scene}
        onWalkBudget={setBudget}
        selection={selection}
        onSelect={onSelect}
        reducedMotion={reducedMotion}
        mode={mode}
        insets={insets}
        camera={camera}
        thumbnail={thumbnail}
        quiet={quiet}
      />
    </OfficeLabelsContext.Provider>
  );
}

function NoStage() {
  return (
    <div className="screen screen--inline" role="note">
      <p className="screen__title">The 3D view couldn't draw</p>
      <p className="screen__text">Everything else works: the company is in the side panel. Reload the page to try the view again.</p>
    </div>
  );
}

interface OverlayViewProps {
  overlay: Overlay;
  snapshot: Snapshot;
  catalog: StudioCatalog | null;
  canChange: string | null;
  now: number;
  phone: boolean;
  online: boolean;
  token: string | null;
  asks: ReturnType<typeof useAskAside>;
  onSelect: (s: Selection) => void;
  onReshape: (action: ReshapeAction) => Promise<boolean>;
  onAsk: (target: TalkTarget, opener: HTMLElement) => void;
  onBack: () => void;
  onTyping: (typing: boolean) => void;
}

/** v2's room card, a visitor's badge or their conversation, in the side panel's place, each with Back. */
function OverlayView({ overlay, snapshot, catalog, canChange, now, phone, online, token, asks, onSelect, onReshape, onAsk, onBack, onTyping }: OverlayViewProps) {
  const [opening, setOpening] = useState(true);
  if (overlay.kind === 'room') {
    return <RoomCard snapshot={snapshot} catalog={catalog} roomId={overlay.id} canChange={canChange} onSelect={onSelect} onBack={onBack} onReshape={onReshape} now={now} />;
  }
  if (overlay.kind === 'visitor') {
    return <PersonCard snapshot={snapshot} catalog={catalog} selection={{ kind: 'agent', key: overlay.key }} canChange={canChange} onSelect={onSelect} onBack={onBack} onReshape={onReshape} now={now} onAsk={onAsk} />;
  }
  const talk = talkFor(snapshot, overlay.target);
  if (!talk) return <Fallback text="That visitor left the office." />;
  return (
    <div className="panel__body--talk">
      <Conversation
        key={talk.threadKey}
        snapshot={snapshot}
        talk={talk}
        hue={personHue(snapshot, { kind: talk.kind, roleId: talk.roleId })}
        variant="sheet"
        focusOnOpen={phone ? 'heading' : 'box'}
        opening={opening}
        onOpened={() => setOpening(false)}
        locked={!token && snapshot.mode !== 'demo'}
        stoppedAt={online ? null : now}
        draft={asks.drafts[talk.threadKey] ?? ''}
        onDraft={(text) => asks.setDraft(talk.threadKey, text)}
        attempt={asks.attempts[talk.threadKey] ?? null}
        typed={asks.typed}
        cancelling={asks.cancelling}
        onAsk={(question) => talk.agent && void asks.send(talk.threadKey, talk.agent.key, question, talk.who)}
        onCancel={(id) => void asks.cancel(id)}
        onClose={onBack}
        onTyping={onTyping}
      />
    </div>
  );
}

interface PanelBodyProps {
  panel: PanelView | null;
  founding: boolean;
  tabProps: TabProps;
  hub: HubActions;
  phone: boolean;
  now: number;
  demo: boolean;
}

/** What the side panel shows: its home (the inbox; before the start, the proposal) or the view `?panel=` names. */
function PanelBody({ panel, founding, tabProps, hub, phone, now, demo }: PanelBodyProps) {
  const { company } = tabProps;
  if (panel === null || panel.kind === 'proposal') {
    if (founding || panel?.kind === 'proposal') return <ProposalView {...tabProps} phone={phone} now={now} />;
    // The panel's head already says how many need you, so the wait doesn't say it again.
    const fallback = <Fallback text="Opening the inbox." />;
    return Inbox ? <Mounted fallback={fallback}><Inbox {...tabProps} /></Mounted> : fallback;
  }
  switch (panel.kind) {
    case 'inbox': {
      const fallback = <Fallback text="Opening the inbox." />;
      return Inbox ? (
        <Mounted key={panel.item} fallback={fallback}>
          <Inbox {...tabProps} focusItem={panel.item} />
        </Mounted>
      ) : (
        fallback
      );
    }
    case 'person': {
      const fallback = <PersonFallback company={company} person={panel.person} />;
      return PersonPanel ? (
        <Mounted key={panel.person} fallback={fallback}>
          <PersonPanel {...tabProps} person={panel.person} />
        </Mounted>
      ) : (
        fallback
      );
    }
    case 'task':
    case 'new-task': {
      const task = panel.kind === 'task' ? panel.task : null;
      const fallback = <Fallback text={task && !company.tasks.some((t) => t.id === task) ? "That task isn't on the board any more." : tasksLine(company)} />;
      return Tasks ? (
        <Mounted key={task ?? 'new'} fallback={fallback}>
          <Tasks {...tabProps} {...(task ? { task } : {})} />
        </Mounted>
      ) : (
        fallback
      );
    }
    case 'message': {
      const fallback = <Fallback text="Where your message went." />;
      return TraceView ? (
        <Mounted key={panel.message} fallback={fallback}>
          <TraceView {...tabProps} message={panel.message} />
        </Mounted>
      ) : (
        fallback
      );
    }
    case 'decision': {
      const fallback = <Fallback text="The decisions you and the company made, newest first." />;
      return Decisions ? (
        <Mounted key={panel.decision} fallback={fallback}>
          <Decisions {...tabProps} decision={panel.decision} />
        </Mounted>
      ) : (
        fallback
      );
    }
    case 'customize':
      return <Customize {...tabProps} phone={phone} />;
    case 'settings':
      return <Settings {...tabProps} hub={hub} demo={demo} />;
  }
}

interface MainBoardProps {
  main: MainView;
  tabProps: TabProps;
  result: (text: string, undo?: () => Promise<void>) => void;
  announce: (text: string) => void;
}

/** What fills the main view over the office: a board where its stream has built it, else today's panel in the frame. */
function MainBoard({ main, tabProps, result, announce }: MainBoardProps) {
  const { company } = tabProps;
  const board = { ...tabProps, view: main, result };
  const said = (title: string) => () => announce(`${title} couldn't load. Reload the page to try again.`);
  const shape = main.kind === 'org' ? 'chart' : main.kind === 'tasks' || main.kind === 'plan' ? 'columns' : 'cards';
  const mounted = (title: string, loading: string, error: string, node: ReactNode) => (
    <Boundary key={boardOf(main)} onFail={said(title)} fallback={<BoardFrame title={title} error={error} />}>
      <Suspense fallback={<BoardFrame title={title} loading={loading} shape={shape} />}>{node}</Suspense>
    </Boundary>
  );
  const legacy = (title: string, loading: string, error: string, node: ReactNode | null) =>
    mounted(
      title,
      loading,
      error,
      node ? (
        <BoardFrame title={title}>
          {/* Today's panel was drawn for paper, not the mat: it keeps its paper until its board lands. */}
          <div className="legacy-paper">{node}</div>
        </BoardFrame>
      ) : (
        <BoardFrame title={title} error={error} />
      ),
    );
  switch (main.kind) {
    case 'office':
    case 'progress':
      return null;
    case 'org':
      return OrgBoard
        ? mounted('Org chart', 'Opening the org chart…', peopleLine(company), <OrgBoard {...board} />)
        : legacy('Org chart', 'Opening the org chart…', peopleLine(company), People && <People {...tabProps} />);
    case 'tasks':
    case 'plan':
      if (TaskBoard) return mounted('Tasks', 'Opening the task board…', tasksLine(company), <TaskBoard {...board} />);
      return main.kind === 'plan'
        ? legacy('The plan', 'Opening the plan…', company.steering?.plan?.versions.length ? "The CEO's plan." : "The CEO hasn't proposed a plan yet.", Plan && <Plan key={main.version ?? ''} {...tabProps} version={main.version} />)
        : legacy('Tasks', 'Opening the task board…', tasksLine(company), Tasks && <Tasks {...tabProps} />);
    case 'dashboards':
    case 'decisions':
      return mounted('Dashboards', 'Opening the dashboards…', 'The dashboards show how the company is doing.', DashboardsBoard && <DashboardsBoard {...board} />);
    case 'preview':
      return mounted('Preview', 'Opening the preview…', previewLine(company), PreviewBoard && <PreviewBoard {...board} />);
    case 'diff':
      return mounted('Changes', 'Opening the changes…', "A task's changes show here.", DiffBoard && <DiffBoard {...board} />);
  }
}

/** Which board a main view is, so a board keeps its place (and its state) across its own sub-views. */
const boardOf = (main: MainView): string => (main.kind === 'plan' ? 'tasks' : main.kind === 'decisions' ? 'dashboards' : main.kind);

// ---------------------------------------------------------------------------------------------------------------
// What a view says while the stream that draws it hasn't landed yet: true sentences from the design, nothing made up

/** The progress column while its code loads, or if it fails: its title, so focus has its place, and a true sentence. */
function ProgressFallback({ text }: { text: string }) {
  return (
    <div className="progress__scroll">
      <h2 id="progress-heading" className="progress__title" tabIndex={-1}>
        Progress
      </h2>
      <p className="progress__muted">{text}</p>
    </div>
  );
}

function Fallback({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="shell-empty">
      <p className="shell-empty__line">{text}</p>
      {children}
    </div>
  );
}

const peopleLine = (c: CompanyView) => (c.people.length <= 1 ? 'Only the CEO is here. Tell the CEO who to hire.' : `${capital(countWord(c.people.length))} people work here.`);

function tasksLine(c: CompanyView): string {
  if (c.tasks.length === 0) return noTasksLine(c);
  const done = c.tasks.filter((t) => t.status === 'done').length;
  if (done === c.tasks.length) return `All ${countWord(done)} tasks are done.`;
  return `${capital(countWord(done))} of ${countWord(c.tasks.length)} tasks are done.`;
}

function PersonFallback({ company, person }: { company: CompanyView; person: string }) {
  const p = company.people.find((x) => x.id === person);
  if (!p) return <Fallback text="That person isn't in the company any more." />;
  return (
    <div>
      <h2 className="panel-title" data-panel-heading tabIndex={-1}>
        {p.name}
      </h2>
      <p className="muted">{p.title}</p>
      {p.status && <p>{p.status.text}</p>}
    </div>
  );
}

function previewLine(company: CompanyView): string {
  const p = company.preview;
  const line =
    p.state === 'off'
      ? p.command
        ? "The app isn't running."
        : 'This project has no app to preview. Screenshots people share still show here.'
      : p.state === 'starting'
        ? 'Starting the app…'
        : p.state === 'down'
          ? `The app didn't answer. ${p.problem ?? ''}`.trim()
          : 'The app is running.';
  return line;
}

