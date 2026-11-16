import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { nowBoard } from '../../src/core/now.ts';
import type { ReshapeAction, StudioCatalog } from '../../src/core/snapshot.ts';
import type { Studio } from '../../src/core/studio.ts';
import { type TalkTarget, talkFor, targetOf } from './hud/asideModel.ts';
import { useCatchUpAnnouncements, useNeedsYouAnnouncements } from './hud/announce.ts';
import { CatchUp } from './hud/CatchUp.tsx';
import { Conversation, useAnswerAnnouncements, useAskAside } from './hud/Conversation.tsx';
import { personHue } from './hud/model.ts';
import { focusRow, NowTab } from './hud/NowTab.tsx';
import { PayrollBoard } from './hud/PayrollBoard.tsx';
import { PersonCard } from './hud/PersonCard.tsx';
import { Replay } from './hud/Replay.tsx';
import { RoomCard } from './hud/RoomCard.tsx';
import { Loading, Locked, NoStudio, NoWebGL, StudioErrors } from './hud/States.tsx';
import { Story } from './hud/Story.tsx';
import { focusTeamRow, teamKey, TeamList } from './hud/TeamList.tsx';
import { TopBar } from './hud/TopBar.tsx';
import { getCatalog, reshape, takeToken, useOffice } from './lib/api.ts';
import { liveActions, liveHub, probeServer } from './company/api.ts';
import { demoHub, demoSteering, enterDemo, inDemo, leaveDemo } from './company/demo.ts';
import { liveSteering } from './company/steeringApi.ts';
import { Lobby } from './company/lobby/Lobby.tsx';
import { type Address, type Location, navigate, parseAddress, useLocation } from './company/router.ts';
import { Shell } from './company/Shell.tsx';
import { useCompany, useDemoCompany, useDemoLobby, useLobby, usePageVisible } from './company/useHub.ts';
import { hasWebGL, useMediaQuery, useOfficeClock, useReducedMotion } from './lib/hooks.ts';
import type { Selection } from './scene/Building.tsx';
import { figureFor } from './scene/cast.ts';
import { computeLayout } from './scene/layout.ts';
import { Stage } from './scene/Stage.tsx';
import { useCast } from './scene/useCast.ts';

type Tab = 'now' | 'team' | 'payroll' | 'story';
const TABS: [Tab, string][] = [
  ['now', 'Now'],
  ['team', 'Team'],
  ['payroll', 'Payroll'],
  ['story', 'Story'],
];
/** Keys that move between tabs (the ARIA tabs pattern), as where they go from the selected tab's index. */
const TAB_KEYS: Record<string, (i: number) => number> = {
  ArrowRight: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  Home: () => 0,
  End: () => TABS.length - 1,
};
const PANEL_WIDTH = 384;
/** How long a sentence stays in the announcer after it was read out. */
const ANNOUNCEMENT_KEPT_MS = 8000;
/** Kept clear at the top for the camera's fit: the top bar, and on desktops three lines of caption under it. */
const TOP_INSET = { desktop: 164, phone: 64 };

/** `/c/demo` (or `?demo` on any address) opens the demo; the tab keeps it until "Leave the demo". */
const startsDemo = (path: string, search: string) => path === '/c/demo' || path.startsWith('/c/demo/') || new URLSearchParams(search).has('demo');

/**
 * The addresses (docs/design-v3.md, "Decisions" 8): the lobby at `/`, Start at `/new`, a company at `/c/:company`. At `/`,
 * `worklings office`, `replay` and `demo` keep v2's office: the app asks the server which it is.
 */
export function App() {
  const [token] = useState(() => takeToken());
  const location = useLocation();
  const address = parseAddress(location.path, location.search, location.hash);
  const [demoTab, setDemoTab] = useState(() => inDemo() || startsDemo(window.location.pathname, window.location.search));
  const demo = demoTab || startsDemo(location.path, '');
  // Only a tab that started in the demo keeps it: a look at the demo company from your own lobby ends at its Lobby link.
  useEffect(() => {
    if (demoTab) enterDemo();
  }, [demoTab]);
  const server = useServerKind(token, !demo && address.kind === 'lobby');
  const onLeaveDemo = () => {
    leaveDemo();
    setDemoTab(false);
    navigate('/');
  };

  if (address.kind === 'company') {
    if (demo && demoHub().has(address.company)) return <DemoCompanyApp key={address.company} address={address} location={location} />;
    return <LiveCompanyApp key={address.company} address={address} location={location} token={token} />;
  }
  if (demo) return <DemoLobbyApp location={location} starting={address.kind === 'new'} onLeaveDemo={onLeaveDemo} />;
  if (address.kind === 'new') return <LiveLobbyApp location={location} token={token} starting />;
  if (server === 'unknown') return <Loading />;
  if (server === 'hub') return <LiveLobbyApp location={location} token={token} starting={false} />;
  return <Office token={token} />;
}

/** Which server answered: the hub (a lobby stream) or v2's office. Asked until it answers. */
function useServerKind(token: string | null, needed: boolean): 'unknown' | 'hub' | 'office' {
  const [kind, setKind] = useState<'unknown' | 'hub' | 'office'>('unknown');
  useEffect(() => {
    if (!needed || kind !== 'unknown') return;
    let cancelled = false;
    let timer: number | null = null;
    const ask = () => {
      void probeServer(token).then((answer) => {
        if (cancelled) return;
        if (answer === 'unreachable') timer = window.setTimeout(ask, 2000);
        else setKind(answer);
      });
    };
    ask();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [needed, kind, token]);
  return kind;
}

type CompanyAddress = Extract<Address, { kind: 'company' }>;

function LiveCompanyApp({ address, location, token }: { address: CompanyAddress; location: Location; token: string | null }) {
  const stream = useCompany(address.company, token);
  // Here the lobby only counts and announces the other companies, so its stream is held while the tab is in sight: over
  // HTTP/1.1 a browser opens about six connections to one host, and every company tab already holds its own stream.
  const lobby = useLobby(token, usePageVisible());
  const actions = useMemo(() => liveActions(address.company, token), [address.company, token]);
  const hub = useMemo(() => liveHub(token), [token]);
  // Steering's routes refuse with the office's sentence until the company serves them, and the views say so.
  const steer = useMemo(() => liveSteering(address.company, token), [address.company, token]);
  return <Shell companyId={address.company} route={address.route} old={address.old} intent={address.talk} location={location} stream={stream} lobby={lobby.data} actions={actions} hub={hub} demo={false} token={token} steer={steer} />;
}

function DemoCompanyApp({ address, location }: { address: CompanyAddress; location: Location }) {
  const stream = useDemoCompany(address.company);
  const lobby = useDemoLobby();
  const actions = useMemo(() => demoHub().actions(address.company), [address.company]);
  const hub = useMemo(() => demoHub().hub(), []);
  const steer = useMemo(() => demoSteering(address.company), [address.company]);
  return <Shell companyId={address.company} route={address.route} old={address.old} intent={address.talk} location={location} stream={stream} lobby={lobby.data} actions={actions} hub={hub} demo token={null} steer={steer} />;
}

function LiveLobbyApp({ location, token, starting }: { location: Location; token: string | null; starting: boolean }) {
  const stream = useLobby(token);
  const hub = useMemo(() => liveHub(token), [token]);
  return <Lobby stream={stream} hub={hub} demo={false} location={location} starting={starting} onLeaveDemo={() => undefined} />;
}

function DemoLobbyApp({ location, starting, onLeaveDemo }: { location: Location; starting: boolean; onLeaveDemo: () => void }) {
  const stream = useDemoLobby();
  const hub = useMemo(() => demoHub().hub(), []);
  return <Lobby stream={stream} hub={hub} demo location={location} starting={starting} onLeaveDemo={onLeaveDemo} />;
}

/** v2's office, exactly as `worklings office`, `replay` and `demo` serve it: a snapshot with no company. */
function Office({ token }: { token: string | null }) {
  const { snapshot, connection, receivedAt } = useOffice(token);
  const reducedMotion = useReducedMotion();
  const phone = useMediaQuery('(max-width: 720px)');
  const [webgl] = useState(() => hasWebGL());
  const now = useOfficeClock(snapshot, receivedAt, connection === 'live');
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('now');
  // The Now or Team row that opened the badge, so Back can return focus to it.
  const [opener, setOpener] = useState<{ tab: Tab; key: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [announcements, setAnnouncements] = useState<{ id: number; text: string; at: number }[]>([]);
  const [viewport, setViewport] = useState(() => window.innerHeight);
  // Ask aside: whose conversation is open, and the Ask button that opened it, for focus to go back to. A conversation in
  // the sheet takes the panel's place, so its button is drawn again on close: `data-ask` finds it then. `opening` until
  // it has taken focus: moving between the scene and the panel later doesn't take it again.
  const [talking, setTalking] = useState<{ target: TalkTarget; opener: HTMLElement | null; openerId: string | null; opening: boolean } | null>(null);
  // Phones: the box has focus, so the keyboard is up and the conversation takes the full height.
  const [typing, setTyping] = useState(false);
  // Phones: the part of the screen the keyboard leaves (iOS shifts fixed elements when it opens, so follow this instead).
  const [visible, setVisible] = useState<{ top: number; height: number } | null>(null);
  const askFailed = useCallback((text: string) => setToast({ text, tone: 'error' }), []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!phone || !vv) return;
    const update = () => setVisible({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [phone]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The studio's identity: rebuild the floor plan and refetch its files only when the studio itself changes.
  const studioKey = snapshot ? JSON.stringify(snapshot.studio) : '';
  const studio = useMemo(() => (studioKey ? (JSON.parse(studioKey) as Studio | null) : null), [studioKey]);
  const layout = useMemo(() => computeLayout(studio), [studio]);
  // The scene's people, here so the scene and the conversation agree on who has a figure to sit by.
  const { cast, clock } = useCast(snapshot, layout, reducedMotion, talking?.target ?? null);
  useEffect(() => {
    if (!studioKey) return;
    let cancelled = false;
    getCatalog(token)
      .then((c) => !cancelled && setCatalog(c))
      .catch((error: unknown) => !cancelled && setToast({ text: `Couldn't load the studio's files: ${(error as Error).message}`, tone: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [studioKey, token]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const board = snapshot ? nowBoard(snapshot, now) : null;
  // Each sentence goes into the announcer as a node of its own: a screen reader reads out what was added, so sentences
  // that arrive together are each said once, and the same sentence later is said again.
  const lastAnnouncement = useRef(0);
  const announce = useCallback((text: string) => {
    lastAnnouncement.current += 1;
    const item = { id: lastAnnouncement.current, text, at: Date.now() };
    setAnnouncements((items) => [...items, item]);
  }, []);
  useNeedsYouAnnouncements(board, snapshot?.mode !== 'replay', announce);
  useCatchUpAnnouncements(snapshot?.aside ?? null, announce);
  useAnswerAnnouncements(snapshot, announce);
  const asks = useAskAside(token, announce, askFailed);
  // Sentences leave the announcer a while after they were said (a removal isn't read out).
  useEffect(() => {
    const oldest = announcements[0];
    if (!oldest) return;
    const id = window.setTimeout(() => setAnnouncements((items) => items.slice(1)), Math.max(0, oldest.at + ANNOUNCEMENT_KEPT_MS - Date.now()));
    return () => window.clearTimeout(id);
  }, [announcements]);

  const select = useCallback(
    (s: Selection) => {
      setSelection(s);
      if (s && phone) setSheetOpen(true);
    },
    [phone],
  );

  // On desktops the conversation sits beside its person in the scene; this finds them (null: no figure to sit by).
  const figure = talking && webgl ? figureFor(cast, talking.target) : null;

  const openTalk = (target: TalkTarget, from: HTMLElement | null) => {
    setTalking({ target, opener: from, openerId: from?.dataset.ask ?? null, opening: true });
    if (phone) setSheetOpen(true);
  };
  const talkOpened = useCallback(() => setTalking((t) => (t?.opening ? { ...t, opening: false } : t)), []);
  /** Closes the conversation; focus goes back to the Ask button that opened it, else to the panel's heading or tab. */
  const closeTalk = () => {
    const from = talking?.opener ?? null;
    const id = talking?.openerId ?? null;
    flushSync(() => {
      setTalking(null);
      setTyping(false);
    });
    const again = from?.isConnected ? from : id !== null ? document.querySelector<HTMLElement>(`[data-ask="${CSS.escape(id)}"]`) : null;
    again?.focus({ preventScroll: true });
    if (!again || document.activeElement !== again) (document.getElementById('badge-title') ?? document.getElementById(`tab-${tab}`))?.focus({ preventScroll: true });
  };
  // A click in the scene outside the conversation closes it: on another person it selects them, on the mat it clears.
  const sceneSelect = useCallback(
    (s: Selection) => {
      setTalking(null);
      setTyping(false);
      select(s);
    },
    [select],
  );
  const askAgent = (key: string, from: HTMLElement) => {
    const agent = snapshot?.agents.find((a) => a.key === key);
    if (agent) openTalk(targetOf(agent), from);
  };

  const openFromNow = (key: string) => {
    setOpener({ tab: 'now', key });
    select({ kind: 'agent', key });
  };
  const openFromTeam = (s: Selection) => {
    setOpener(s ? { tab: 'team', key: teamKey(s) } : null);
    select(s);
  };

  /** Closes a badge and puts focus back where it came from: its Now row (or the fold it went into), its Team row, else the tab. */
  const back = () => {
    flushSync(() => setSelection(null));
    const panel = document.getElementById(`tabpanel-${tab}`);
    const from = opener?.tab === tab ? opener.key : null;
    const returned = from !== null && panel !== null && (tab === 'now' ? focusRow(panel, from, true) : focusTeamRow(panel, from));
    if (!returned) document.getElementById(`tab-${tab}`)?.focus();
    setOpener(null);
  };

  const openNow = () => {
    setSelection(null);
    setOpener(null);
    setTab('now');
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = TAB_KEYS[e.key];
    if (!move) return;
    e.preventDefault();
    const next = TABS[(move(TABS.findIndex(([id]) => id === tab)) + TABS.length) % TABS.length]?.[0];
    if (!next) return;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const canChange =
    !snapshot ? 'Loading' : snapshot.mode !== 'live' ? `Changes are off in the ${snapshot.mode}.` : !token ? 'Open the office from the link the CLI printed to make changes.' : null;

  const onReshape = useCallback(
    async (action: ReshapeAction) => {
      try {
        const result = await reshape(token, action);
        setToast({ text: result.message, tone: result.ok ? 'ok' : 'error' });
        if (result.ok) setCatalog(await getCatalog(token));
        return result.ok;
      } catch (error) {
        setToast({ text: (error as Error).message, tone: 'error' });
        return false;
      }
    },
    [token],
  );

  if (connection === 'locked') return <Locked />;
  if (!snapshot || !board) return <Loading />;

  const talk = talking ? talkFor(snapshot, talking.target) : null;
  const inScene = talk !== null && figure !== null && !phone;
  const conversation = talk && (
    <Conversation
      key={talk.threadKey}
      snapshot={snapshot}
      talk={talk}
      hue={personHue(snapshot, { kind: talk.kind, roleId: talk.roleId })}
      variant={inScene ? 'popover' : 'sheet'}
      focusOnOpen={phone ? 'heading' : 'box'}
      opening={talking?.opening ?? false}
      onOpened={talkOpened}
      locked={!token}
      stoppedAt={connection === 'live' ? null : now}
      draft={asks.drafts[talk.threadKey] ?? ''}
      onDraft={(text) => asks.setDraft(talk.threadKey, text)}
      attempt={asks.attempts[talk.threadKey] ?? null}
      typed={asks.typed}
      cancelling={asks.cancelling}
      onAsk={(question) => talk.agent && void asks.send(talk.threadKey, talk.agent.key, question, talk.who)}
      onCancel={(id) => void asks.cancel(id)}
      onClose={closeTalk}
      onTyping={setTyping}
    />
  );
  const talkInSheet = talk !== null && !inScene;
  // A conversation in the sheet opens it to 78%; while you type, it takes all the screen the keyboard leaves (the camera
  // keeps fitting the 78%, so it doesn't jump on every tap in the box).
  const sheetHeight = phone ? Math.round(viewport * (sheetOpen || talkInSheet ? 0.78 : 0.5)) : 0;
  const fullHeight = phone && talkInSheet && typing;
  const panelStyle = !phone ? undefined : fullHeight ? { top: visible?.top ?? 0, bottom: 'auto', height: visible?.height ?? viewport } : { height: sheetHeight };
  const insets = phone ? { right: 0, bottom: sheetHeight, top: TOP_INSET.phone } : { right: PANEL_WIDTH + 24, bottom: 0, top: TOP_INSET.desktop };
  // The headline shows exactly once: in the panel on Now, over the scene otherwise. Phones keep the model uncovered.
  const showCaption = !phone && (selection !== null || tab !== 'now');
  const [needs, ...atWork] = board.caption;

  return (
    <div className={`office${phone ? ' office--phone' : ''}`}>
      <main className="stage" aria-label="Studio model">
        {/* In a landmark, as all content is. */}
        <h1 className="visually-hidden">Worklings office for {snapshot.project.name}</h1>
        {webgl ? (
          <Stage
            snapshot={snapshot}
            layout={layout}
            cast={cast}
            clock={clock}
            selection={selection}
            onSelect={sceneSelect}
            reducedMotion={reducedMotion}
            insets={insets}
            fitKey={fitKey}
            asking={figure !== null ? { figureKey: figure, popover: inScene ? conversation : null } : null}
            onAsk={(m, from) => openTalk({ roleId: m.roleId, agentKey: m.agentKey }, from)}
            thumbnail={phone && (sheetOpen || talkInSheet)}
          />
        ) : (
          <NoWebGL />
        )}
        <div className="stage__notes">
          {showCaption && (
            // A shortcut for the eye: the Now tab carries the same words for keyboards and screen readers.
            <div className="caption" aria-hidden="true" data-testid="now-caption" onClick={openNow}>
              {board.needsYou.length > 0 ? (
                <>
                  <span className="caption__needs">{needs}</span> {atWork.join(' ')}
                </>
              ) : (
                board.caption.join(' ')
              )}
            </div>
          )}
          {!snapshot.studio && <NoStudio snapshot={snapshot} />}
        </div>
      </main>

      <TopBar snapshot={snapshot} connection={connection} compact={phone} onFit={() => setFitKey((k) => k + 1)} />

      <aside className={`panel${sheetOpen ? ' is-open' : ''}`} style={panelStyle} aria-label="Studio details">
        {/* A conversation in the sheet holds it at 78% and closes with its own Back, so the handle would do nothing. */}
        {phone && !talkInSheet && (
          <button type="button" className="panel__handle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
            {sheetOpen ? 'Show less' : 'Show more'}
          </button>
        )}
        {snapshot.mode === 'replay' && snapshot.replay && <Replay replay={snapshot.replay} token={token} />}
        {talkInSheet ? (
          // On phones, without WebGL and for someone with no figure, the conversation takes the panel's place.
          <div className="panel__body panel__body--talk">{conversation}</div>
        ) : selection === null ? (
          <>
            <div className="tabs" role="tablist" aria-label="Views" onKeyDown={onTabKey}>
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={tab === id ? `tabpanel-${id}` : undefined}
                  tabIndex={tab === id ? 0 : -1}
                  className="tabs__tab"
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="panel__body" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
              <h2 className="visually-hidden">{TABS.find(([id]) => id === tab)?.[1]}</h2>
              <StudioErrors errors={snapshot.studioErrors} />
              {tab === 'now' && (
                <NowTab
                  snapshot={snapshot}
                  board={board}
                  stoppedAt={connection === 'live' ? null : now}
                  onOpen={openFromNow}
                  onAsk={askAgent}
                  catchUp={
                    <CatchUp
                      snapshot={snapshot}
                      token={token}
                      connected={connection === 'live'}
                      announce={announce}
                      cancelling={asks.cancelling}
                      onCancel={(id) => void asks.cancel(id)}
                    />
                  }
                />
              )}
              {tab === 'team' && <TeamList snapshot={snapshot} selection={selection} onSelect={openFromTeam} now={now} />}
              {tab === 'payroll' && <PayrollBoard snapshot={snapshot} onSelect={select} />}
              {tab === 'story' && <Story snapshot={snapshot} onSelect={select} />}
            </div>
          </>
        ) : (
          <div className="panel__body">
            {selection.kind === 'room' ? (
              <RoomCard snapshot={snapshot} catalog={catalog} roomId={selection.id} {...(selection.rule ? { focusRule: selection.rule } : {})} canChange={canChange} onSelect={select} onBack={back} onReshape={onReshape} now={now} />
            ) : (
              <PersonCard snapshot={snapshot} catalog={catalog} selection={selection} canChange={canChange} onSelect={select} onBack={back} onReshape={onReshape} now={now} onAsk={openTalk} />
            )}
          </div>
        )}
      </aside>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <p className={`toast toast--${toast.tone}`}>{toast.text}</p>}
      </div>
      {/* The office's one announcer: who started to need you, catch-ups, answers and why a press did nothing. */}
      <div className="visually-hidden" aria-live="polite" aria-relevant="additions" data-testid="announcer">
        {announcements.map((a) => (
          <p key={a.id}>{a.text}</p>
        ))}
      </div>
    </div>
  );
}
