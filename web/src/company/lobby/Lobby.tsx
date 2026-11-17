// The lobby (docs/design-v3.md, "Lobby"): every company the hub runs, the panel listing them as the accessible twin of
// the small worlds on the mat, Start a new company, the hub's desks, and the first run's welcome. The 3D worlds are
// the scene stream's: LobbyStage shows the mat they stand on until they land.
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Portfolio } from '../../../../src/studio/model.ts';
import { PortfolioCard, PortfolioForm, PortfolioPage, StudioCard } from '../../studio/Portfolio.tsx';
import { StudioChat } from '../../studio/StudioChat.tsx';
import { liveStudio } from '../../studio/studioApi.ts';
import { lobbyPlace, membersOf, outside, portfolioPath, STUDIO_PATH, studioParts } from '../../studio/studioModel.ts';
import type { LobbyRow } from '../model.ts';
import { flushSync } from 'react-dom';
import type { LobbyView } from '../../../../src/core/company.ts';
import { Wordmark } from '../../hud/TopBar.tsx';
import { Loading, Locked } from '../../hud/States.tsx';
import { hasWebGL, useMediaQuery } from '../../lib/hooks.ts';
import type { HubActions } from '../api.ts';
import { LiveRegion, useAnnouncer } from '../announcer.tsx';
import { DESKTOP_INSETS } from '../insets.ts';
import { byName, desksLine, hubProblem, lobbyNews, lobbyRow, lobbyTitle, reconnectingLine, totalNeeds } from '../model.ts';
import { Boundary } from '../mounts.tsx';
import { clearCompanyShown, clearLobbyNotice, peekCompanyShown, peekLobbyNotice } from '../notice.ts';
import { companyPath, goBack, type Location, navigate, restoreFocus } from '../router.ts';
import { StartCompany } from '../start/StartCompany.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { useFollowedField } from '../ui/useFollowedField.ts';
import { CLAUDE_PROBLEM_ID, SetupCallout, useSetup } from '../setup/SetupCallout.tsx';
import { WatchProject } from '../setup/WatchProject.tsx';
import { tabToken, type Stream } from '../useHub.ts';
import { LobbyCard } from './LobbyCard.tsx';
import { lobbyNames, shortenPaths } from './lobbyModel.ts';
import { NeedsStrip } from './NeedsStrip.tsx';

/** Most desks the hub may run at once across companies (src/hub/gate.ts). */
const MAX_HUB_DESKS = 50;
const UNDO_SHOWN_MS = 10_000;
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;

interface LobbyProps {
  stream: Stream<LobbyView>;
  hub: HubActions;
  demo: boolean;
  location: Location;
  /** `/new`: the start form in place of the list. */
  starting: boolean;
  /** The demo inside the office goes back to the real lobby; the static site has nowhere to go back to, so it leaves this out. */
  onLeaveDemo?: () => void;
}

export function Lobby(props: LobbyProps) {
  const { stream } = props;
  if (stream.connection === 'locked') return <Locked />;
  if (!stream.data) return <Loading />;
  return <LobbyPanel {...props} lobby={stream.data} />;
}

// The worlds load with the 3D engine's lobby scene, after the panel; a failure there leaves the panel working.
const LobbyWorlds = lazy(async () => ({ default: (await import('../../scene/lobby/LobbyWorlds.tsx')).LobbyWorlds }));

/** Called once a world's way in has played: it lands on the company's office (v0.8, office first), as a card does. A module function, so the memoised worlds keep their props. */
const enterCompany = (id: string) => navigate(companyPath(id, ''));

/** The mat with each company as a small world (desktops); the panel is its accessible twin, so the mat is the stage. */
function LobbyStage({ lobby, returning }: { lobby: LobbyView; returning: string | null }) {
  const [webgl] = useState(hasWebGL);
  const mat = <div className="lobby-mat" aria-hidden="true" />;
  if (!webgl) {
    return (
      <>
        {mat}
        <NoWorlds title="The 3D view needs WebGL" text="This browser has it switched off. Everything else works: your companies are all in the panel." />
      </>
    );
  }
  return (
    <Boundary
      fallback={
        <>
          {mat}
          <NoWorlds title="The 3D view couldn't draw" text="Everything else works: your companies are all in the panel. Reload the page to try the view again." />
        </>
      }
    >
      <Suspense fallback={mat}>
        <LobbyWorlds lobby={lobby} onEnter={enterCompany} insets={DESKTOP_INSETS} returning={returning} />
      </Suspense>
    </Boundary>
  );
}

function NoWorlds({ title, text }: { title: string; text: string }) {
  return (
    <div className="screen screen--inline" role="note">
      <p className="screen__title">{title}</p>
      <p className="screen__text">{text}</p>
    </div>
  );
}

function LobbyPanel({ lobby, stream, hub, demo, location, starting, onLeaveDemo }: LobbyProps & { lobby: LobbyView }) {
  const phone = useMediaQuery('(max-width: 720px)');
  const online = stream.connection === 'live';
  const { announce, news, items } = useAnnouncer();
  const heading = useRef<HTMLHeadingElement>(null);
  // What the lobby says on top: what was left on the way in (a removal, a company that left), or a removal made here.
  const [notice, setNotice] = useState(peekLobbyNotice);
  // The company the person came back from: its world starts open and closes up.
  const [returning] = useState(peekCompanyShown);
  const [noticeUntil, setNoticeUntil] = useState(undoUntil);
  const [noticeGone, setNoticeGone] = useState(false);
  const [noticeProblem, setNoticeProblem] = useState<string | null>(null);
  const noticeUndo = useRef<HTMLButtonElement>(null);
  const [hubOpen, setHubOpen] = useState(false);
  // A company that can't run leaves from its row: one at a time, with why if the office says no.
  const [removing, setRemoving] = useState<string | null>(null);
  const [rowProblem, setRowProblem] = useState<{ id: string; text: string } | null>(null);
  const total = totalNeeds(lobby);
  const problem = hubProblem(lobby);
  // Claude Code missing or signed out: the hub asks, and starting waits with the reason (the demo runs none).
  // The demo asks the hub for nothing, so it never reads the tab's token (the static site may have no storage at all).
  const [token] = useState(() => (demo ? null : tabToken()));
  // "Check again" finds it ready: its button went with the callout, so focus goes to the list's heading.
  const setup = useSetup(token, !demo, announce, () => document.querySelector<HTMLElement>('#lobby-panel [data-panel-heading]')?.focus({ preventScroll: true }));
  const claudeBlock = setup.notice?.blocks ?? null;
  const startBlock = problem ? 'Every company rests until the limit resets, so starting waits.' : claudeBlock;
  const startWhy = [setup.notice?.blocks ? CLAUDE_PROBLEM_ID : null, problem ? 'hub-problem' : null].filter((x) => x !== null).join(' ') || undefined;
  const firstRun = lobby.companies.length === 0;
  const roots = lobby.companies.map((c) => c.root);
  const names = lobbyNames(lobby.companies);
  // v0.3: the lobby is the top level: the studio chat over every company, then portfolios, then companies.
  const place = lobbyPlace(location.path);
  const { portfolios, studio } = studioParts(lobby);
  const studioActions = useMemo(() => liveStudio(token), [token]);
  const [deletingPortfolio, setDeletingPortfolio] = useState(false);
  const [portfolioUndo, setPortfolioUndo] = useState<{ p: Portfolio; until: number } | null>(null);
  const [portfolioProblem, setPortfolioProblem] = useState<string | null>(null);

  const remove = async (c: LobbyView['companies'][number]) => {
    if (!online || removing !== null) return;
    setRemoving(c.id);
    setRowProblem(null);
    // Its folder may be what went wrong, so the notice says nothing about it being there.
    const text = `${c.name} left the lobby. Adding its folder again brings it back.`;
    try {
      await hub.removeCompany(c.id);
      // Its row goes; focus waits on the notice's Undo.
      flushSync(() => {
        setNotice({ text, undo: { folder: c.root } });
        setNoticeUntil(undoUntil());
        setNoticeGone(false);
        setNoticeProblem(null);
      });
      noticeUndo.current?.focus();
      announce(text);
    } catch (error) {
      const why = `Couldn't remove ${c.name}. ${error instanceof Error ? error.message : ''}`.trim();
      setRowProblem({ id: c.id, text: why });
      announce(why);
    } finally {
      setRemoving(null);
    }
  };

  useEffect(() => {
    clearLobbyNotice();
    clearCompanyShown();
  }, []);
  useEffect(() => {
    document.title = lobbyTitle(total);
  }, [total]);

  // Entering the lobby puts focus on its hidden heading, and Start on its title; Back puts it where it was.
  useEffect(() => {
    if (location.restore && restoreFocus(location.restore)) return;
    (starting || place.kind !== 'list' ? document.querySelector<HTMLElement>('#lobby-panel [data-panel-heading]') : heading.current)?.focus({ preventScroll: true });
  }, [location.key, location.restore, starting, place.kind]);

  const before = useRef<LobbyView | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = lobby;
    if (was) news(lobbyNews(was, lobby, null));
  }, [lobby, news]);

  const rowOf = (c: LobbyView['companies'][number]) => ({ entry: c, row: lobbyRow(c, lobby.serverTime) });
  // Companies in a portfolio sit under it; the list shows the rest.
  const rows = byName(outside(portfolios, lobby.companies)).map(rowOf);
  const go = (path: string) => navigate(path);

  const renderCompany = (entry: LobbyView['companies'][number], row: LobbyRow) => {
    // Its name told apart from others of the same name: "Plant Pal in plant-phone".
    const unique = names.get(row.id) ?? row.name;
    return (
      <li key={row.id} className="lobby-row">
        {/* Named by its words, which the name and what needs you lead; it lands on the company's office. */}
        <LobbyCard entry={entry} row={row} unique={unique} phone={phone} now={lobby.serverTime} roots={roots} onOpen={() => navigate(companyPath(row.id, ''))} />
        {entry.summary?.preview && /^https?:\/\//.test(entry.summary.preview) && (
          <a className="link lobby-row__inbox" href={entry.summary.preview} target="_blank" rel="noopener noreferrer">
            Open the preview<span className="visually-hidden"> of {unique} (opens a new tab)</span>
          </a>
        )}
        {row.needsYou > 0 && (
          <a
            className="link lobby-row__inbox"
            href={companyPath(row.id, entry.phase === 'proposed' ? 'proposal' : 'inbox')}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              navigate(companyPath(row.id, entry.phase === 'proposed' ? 'proposal' : 'inbox'));
            }}
          >
            Open the inbox<span className="visually-hidden"> of {unique}</span>
          </a>
        )}
        {entry.problem !== null && (
          <button type="button" className="link link--danger lobby-row__inbox" aria-disabled={!online || removing !== null || undefined} onClick={() => void remove(entry)}>
            {removing === entry.id ? (
              'Removing…'
            ) : (
              <>
                Remove<span className="visually-hidden"> {unique}</span> from the lobby
              </>
            )}
          </button>
        )}
        {rowProblem?.id === entry.id && <p className="settings__problem">{rowProblem.text}</p>}
      </li>
    );
  };

  const deletePortfolio = async (p: Portfolio) => {
    if (!online || deletingPortfolio) return;
    setDeletingPortfolio(true);
    setPortfolioProblem(null);
    try {
      const gone = await studioActions.deletePortfolio(p.id);
      setPortfolioUndo({ p: gone, until: undoUntil() });
      announce(`The ${gone.name} portfolio is gone. Its companies stay in the lobby.`);
      navigate('/');
    } catch (error) {
      setPortfolioProblem(`Couldn't delete it. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setDeletingPortfolio(false);
    }
  };

  /** The studio chat, a portfolio or a new one, in place of the list; null for the list. */
  const placeView = (() => {
    if (demo && place.kind !== 'list') {
      return (
        <>
          <button type="button" className="panel-back" onClick={() => goBack('/')}>
            Back to the lobby
          </button>
          <p className="lobby-welcome__text">The demo has no studio chat or portfolios: they work in your own lobby.</p>
        </>
      );
    }
    if (place.kind === 'studio') {
      if (!studio) return <p className="lobby-welcome__text">This hub has no studio chat. Update Worklings to use it.</p>;
      return <StudioChat studio={studio} actions={studioActions} online={online} now={lobby.serverTime} announce={announce} onBack={() => goBack('/')} />;
    }
    if (place.kind === 'new-portfolio') {
      return (
        <>
          <button type="button" className="panel-back" onClick={() => goBack('/')}>
            Back to the lobby
          </button>
          <h2 className="panel-title" tabIndex={-1} data-panel-heading>
            New portfolio
          </h2>
          <p className="lobby-welcome__text">Group companies to share one budget and one brief, and see them as one card.</p>
          <PortfolioForm p={null} portfolios={portfolios} companies={byName(lobby.companies)} names={names} actions={studioActions} online={online} onDone={(id) => navigate(portfolioPath(id), { replace: true })} onCancel={() => goBack('/')} />
        </>
      );
    }
    if (place.kind === 'portfolio') {
      const p = portfolios.find((x) => x.id === place.id);
      if (!p) {
        return (
          <>
            <button type="button" className="panel-back" onClick={() => goBack('/')}>
              Back to the lobby
            </button>
            <h2 className="panel-title" tabIndex={-1} data-panel-heading>
              That portfolio isn't in the lobby any more.
            </h2>
          </>
        );
      }
      return (
        <>
          <PortfolioPage
            key={p.id}
            p={p}
            members={membersOf(p, lobby.companies).map(rowOf)}
            renderCompany={renderCompany}
            form={<PortfolioForm p={p} portfolios={portfolios} companies={byName(lobby.companies)} names={names} actions={studioActions} online={online} onDone={() => announce('Saved.')} />}
            onBack={() => goBack('/')}
            onStudio={() => go(STUDIO_PATH)}
            onDelete={() => void deletePortfolio(p)}
            online={online}
            deleting={deletingPortfolio}
          />
          {portfolioProblem && <p className="settings__problem">{portfolioProblem}</p>}
        </>
      );
    }
    return null;
  })();

  return (
    <div className={`office office--lobby${phone ? ' office--phone' : ''}`}>
      <header className="topbar topbar--lobby">
        {/* In a landmark, as all content is. The heading takes focus on entering, so the skip link is the first stop after it. */}
        <h1 ref={heading} tabIndex={-1} className="visually-hidden company__h1">
          Worklings lobby
        </h1>
        <a className="skip-link" href="#lobby-panel">
          Skip to the panel
        </a>
        <div className="topbar__id">
          <Wordmark />
          <span className="topbar__project">Lobby</span>
          {demo && <span className="mode mode--demo">
            <span className="mode__dot" aria-hidden="true" />
            Demo
          </span>}
          {!online && (
            <span className="mode mode--offline" role="status">
              <span className="mode__dot" aria-hidden="true" />
              Reconnecting
            </span>
          )}
        </div>
      </header>
      {!phone && (
        <main className="stage lobby-stage" aria-label="Your companies on the mat">
          <LobbyStage lobby={lobby} returning={returning} />
        </main>
      )}
      <aside id="lobby-panel" className={`panel panel--lobby${phone ? ' panel--full' : ''}`} aria-label="Companies" tabIndex={-1}>
        <div className="panel__body">
          {!online && <p className="panel__offline">{reconnectingLine(lobby.serverTime)}</p>}
          {notice && !noticeGone && (
            <div className="lobby-notice" role="status">
              {notice.undo ? (
                <UndoLine
                  ref={noticeUndo}
                  text={shortenPaths(notice.text, roots)}
                  until={noticeUntil}
                  unavailable={!online}
                  onUndo={() => {
                    const folder = notice.undo?.folder;
                    if (!folder) return;
                    hub.reopenCompany(folder).then(
                      () => {
                        // The notice goes with its Undo: focus waits on the list's heading.
                        flushSync(() => setNoticeGone(true));
                        document.querySelector<HTMLElement>('#lobby-panel [data-panel-heading]')?.focus({ preventScroll: true });
                        announce('Back in the lobby.');
                      },
                      (error: unknown) => setNoticeProblem(`Couldn't put it back. ${error instanceof Error ? error.message : ''}`.trim()),
                    );
                  }}
                />
              ) : (
                <p className="lobby-notice__text">{shortenPaths(notice.text, roots)}</p>
              )}
              {noticeProblem && <p className="settings__problem">{noticeProblem}</p>}
            </div>
          )}
          <SetupCallout state={setup} />
          {problem && (
            <section className="callout callout--warn" role="alert" aria-labelledby="hub-problem">
              <h2 id="hub-problem" className="callout__title">
                Every company rests
              </h2>
              <p>{problem}</p>
            </section>
          )}
          {starting ? (
            <>
              <button type="button" className="panel-back" onClick={() => goBack('/')}>
                Back to the lobby
              </button>
              <StartCompany hub={hub} lobby={lobby} blocked={startBlock} online={online} demo={demo} tryIt={demo && new URLSearchParams(location.search).has('try')} />
            </>
          ) : placeView ? (
            placeView
          ) : firstRun ? (
            <section className="lobby-welcome" aria-labelledby="lobby-welcome">
              <h2 id="lobby-welcome" className="panel-title" tabIndex={-1} data-panel-heading>
                Start your first company
              </h2>
              <p className="lobby-welcome__text">Worklings runs a company of Claude Code sessions that builds what you describe. Pick a folder and say what to build.</p>
              <StartCompany hub={hub} lobby={lobby} blocked={startBlock} online={online} demo={demo} embedded />
            </section>
          ) : (
            <>
              <div className="lobby-head">
                <h2 className="panel-title" tabIndex={-1} data-panel-heading>
                  Companies
                </h2>
                <button
                  type="button"
                  className="button button--primary"
                  aria-disabled={startBlock !== null || undefined}
                  aria-describedby={startWhy}
                  onClick={() => startBlock === null && navigate('/new')}
                  data-focus="start-new"
                >
                  Start a new company
                </button>
              </div>
              <div className="lobby-desks">
                <p className="lobby-desks__line">{desksLine(lobby.hub)}</p>
                <button type="button" className="link" aria-expanded={hubOpen} onClick={() => setHubOpen((o) => !o)}>
                  Settings
                </button>
              </div>
              {hubOpen && <HubDesks hub={hub} lobby={lobby} online={online} />}
              {demo && <TryIt />}
              {!demo && <StudioCard studio={studio} onOpen={() => go(STUDIO_PATH)} />}
              <NeedsStrip companies={lobby.companies} names={names} now={lobby.serverTime} />
              {portfolioUndo && (
                <div className="lobby-notice" role="status">
                  <UndoLine
                    text={`The ${portfolioUndo.p.name} portfolio is gone.`}
                    until={portfolioUndo.until}
                    unavailable={!online}
                    onUndo={() => {
                      const { name, companies, budget, brief } = portfolioUndo.p;
                      studioActions.createPortfolio({ name, companies, budget, brief }).then(
                        (back) => {
                          setPortfolioUndo(null);
                          announce(`The ${back.name} portfolio is back.`);
                        },
                        (error: unknown) => setPortfolioProblem(`Couldn't put it back. ${error instanceof Error ? error.message : ''}`.trim()),
                      );
                    }}
                  />
                  {portfolioProblem && <p className="settings__problem">{portfolioProblem}</p>}
                </div>
              )}
              {!demo && (
                <section className="lobby-portfolios" aria-labelledby="lobby-portfolios">
                  <div className="lobby-group-head">
                    <h3 id="lobby-portfolios" className="group-title">
                      Portfolios
                    </h3>
                    <a
                      className="link"
                      href="/p/new"
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        go('/p/new');
                      }}
                    >
                      New portfolio
                    </a>
                  </div>
                  {portfolios.length === 0 ? (
                    <p className="lobby-portfolios__empty">Group companies to share a budget and a brief, and see them as one card.</p>
                  ) : (
                    <ul className="lobby-rows">
                      {portfolios.map((p) => (
                        <li key={p.id} className="lobby-row">
                          <PortfolioCard p={p} onOpen={() => go(portfolioPath(p.id))} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              {portfolios.length > 0 && rows.length > 0 && <h3 className="group-title lobby-loose">Not in a portfolio</h3>}
              <ul className="lobby-rows">{rows.map(({ entry, row }) => renderCompany(entry, row))}</ul>
            </>
          )}
          {!demo && !starting && place.kind === 'list' && <WatchProject hub={hub} token={token} online={online} announce={announce} />}
          {!demo && !starting && place.kind === 'list' && (
            <p className="lobby-demo">
              The demo company is made up and runs no Claude Code, so looking around it costs nothing.{' '}
              <a
                className="link"
                href={companyPath('demo')}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  navigate(companyPath('demo'));
                }}
              >
                Open the demo company
              </a>
            </p>
          )}
          {demo && (
            <p className="lobby-demo">
              This is the demo: the companies, people and costs are made up, and nothing runs Claude Code.
              {onLeaveDemo ? (
                <>
                  {' '}
                  <button type="button" className="link" onClick={onLeaveDemo}>
                    Leave the demo
                  </button>
                </>
              ) : (
                ' Worklings itself runs on your own computer, so this page has no lobby of yours to go back to.'
              )}
            </p>
          )}
        </div>
      </aside>
      <LiveRegion items={items} />
    </div>
  );
}

function HubDesks({ hub, lobby, online }: { hub: HubActions; lobby: LobbyView; online: boolean }) {
  const id = useId();
  // Another tab may change the desks: the field follows the lobby until you type in it.
  const field = useFollowedField(lobby.hub.maxDesks);
  const value = field.text;
  const [done, setDone] = useState<{ before: number; until: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One change at a time, so answers can't come back out of order.
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const undoRef = useRef<HTMLButtonElement>(null);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_HUB_DESKS;
  const save = (to: number, undoable: boolean) => {
    if (!online || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const before = lobby.hub.maxDesks;
    setProblem(null);
    hub
      .setHubDesks(to)
      .then(
        () => {
          field.saved(to);
          setDone(undoable ? { before, until: undoUntil() } : null);
          if (undoable) window.setTimeout(() => undoRef.current?.focus(), 0);
        },
        (error: unknown) => setProblem(error instanceof Error ? error.message : "The office didn't answer. Try again."),
      )
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };
  return (
    <form
      className="settings__group lobby-hub"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && n !== lobby.hub.maxDesks) save(n, true);
      }}
    >
      <label className="settings__legend" htmlFor={`${id}-desks`}>
        Desks at once, across companies
      </label>
      <p className="settings__note">Each company has its own limit too, in its Settings. More is faster and uses your plan faster.</p>
      <div className="settings__inline">
        <input id={`${id}-desks`} className="text-input text-input--number" type="number" inputMode="numeric" min={1} max={MAX_HUB_DESKS} value={value} onChange={(e) => field.type(e.target.value)} />
        <button type="submit" className="button" aria-disabled={!online || !valid || n === lobby.hub.maxDesks || saving || undefined}>
          Save
        </button>
      </div>
      {!valid && <p className="settings__problem">Pick 1 to {MAX_HUB_DESKS} desks.</p>}
      {done && <UndoLine ref={undoRef} text="Changed." until={done.until} onUndo={() => save(done.before, false)} unavailable={!online || saving} />}
      {problem && <p className="settings__problem">{problem}</p>}
    </form>
  );
}

/**
 * The demo's way to see a project start from nothing (SPEC-v0.8.md, decision 3): the real start form, filled with the words
 * of a run recorded once, which Start replays sped up.
 */
function TryIt() {
  return (
    <section className="lobby-try" aria-labelledby="lobby-try-title">
      <h3 id="lobby-try-title" className="lobby-try__title">
        See a project start from nothing
      </h3>
      <p className="lobby-try__text">One real Claude Code session, recorded once from an empty folder and played back here, sped up: the todo list, a helper, its permission prompts for you to answer, then the result.</p>
      <a
        className="button button--primary lobby-try__key"
        href={`${import.meta.env.BASE_URL}new?try`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          navigate('/new?try');
        }}
      >
        Try it: start a project
      </a>
    </section>
  );
}
