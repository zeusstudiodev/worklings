// The static web demo (npm run build:site, into dist/site): the demo lobby and the demo company in the browser, with no
// hub, no server and no Claude Code. Everything comes from the demo's local data and actions (src/core/demo-company.ts,
// company/demo.ts), steering included. The office's own entry (main.tsx, App.tsx) asks the server which office it is;
// this one only ever shows the demo, under a line that says so and links to the install.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '../styles.css';
import './site.css';
import { lazy, StrictMode, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { demoHub, demoSteering } from '../company/demo.ts';
import { Lobby } from '../company/lobby/Lobby.tsx';
import { Boundary } from '../company/mounts.tsx';
import { ReplayBanner } from '../company/replay/ReplayBanner.tsx';
import { useDemoCompany, useDemoLobby } from '../company/useHub.ts';
import { type Address, type Location, parseAddress, useLocation } from './router.ts';

/** Where Worklings is installed from. */
const INSTALL_URL = 'https://github.com/zeusstudiodev/worklings';

// The company's office comes with the 3D engine, so the lobby draws without waiting for either; it loads once the lobby
// is up, so entering a company rarely waits.
const loadShell = () => import('../company/Shell.tsx');
const Shell = lazy(async () => ({ default: (await loadShell()).Shell }));

function Site() {
  const location = useLocation();
  const address = parseAddress(location.path, location.search, location.hash);
  return (
    <div className="site">
      <DemoLine company={address.kind === 'company' ? address.company : null} />
      <div className="site__app">
        {address.kind === 'company' ? (
          // A company the demo doesn't have says so in the lobby (the shell's "gone").
          <DemoCompany key={address.company} address={address} location={location} />
        ) : (
          <DemoLobby location={location} starting={address.kind === 'new'} />
        )}
      </div>
    </div>
  );
}

/** Hidden for the rest of the visit once its button is pressed: on a phone the office's strip above the sheet needs the room. */
const LINE_KEY = 'worklings-site-line';

function lineHidden(): boolean {
  try {
    return sessionStorage.getItem(LINE_KEY) === 'hidden';
  } catch {
    // Storage can be switched off: the line shows.
    return false;
  }
}

/** Whether the company shown is the demo's recorded run (v0.8), which is real, not made up. */
function useReplaying(company: string | null): boolean {
  const hub = demoHub();
  return useSyncExternalStore(hub.subscribe, () => company !== null && hub.replayOf(company) !== null);
}

function DemoLine({ company }: { company: string | null }) {
  const replaying = useReplaying(company);
  const [hidden, setHidden] = useState(lineHidden);
  if (hidden) return null;
  const hide = () => {
    try {
      sessionStorage.setItem(LINE_KEY, 'hidden');
    } catch {
      // Storage can be switched off: the line stays hidden until the page reloads.
    }
    flushSync(() => setHidden(true));
    // Its button has gone: focus goes to the view's heading, where entering a view puts it.
    document.querySelector<HTMLElement>('.site__app h1')?.focus({ preventScroll: true });
  };
  return (
    <aside className="site-line" aria-label="About this demo">
      <p className="site-line__text">
        {replaying ? (
          // The recorded run is a real one: saying "made-up data" over it would be untrue.
          <>
            A recorded Claude Code run, replayed in your browser.<span className="site-line__more"> Nothing here runs Claude Code.</span>{' '}
          </>
        ) : (
          <>
            A demo with made-up data.<span className="site-line__more"> Nothing here runs Claude Code or leaves your browser.</span>{' '}
          </>
        )}
        <a className="site-line__install" href={INSTALL_URL}>
          Install it
        </a>
      </p>
      <button type="button" className="site-line__hide" aria-label="Hide this line" onClick={hide}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
        </svg>
      </button>
    </aside>
  );
}

function DemoLobby({ location, starting }: { location: Location; starting: boolean }) {
  const stream = useDemoLobby();
  const hub = useMemo(() => demoHub().hub(), []);
  useEffect(() => {
    // A head start only: if it fails, entering a company asks again, and says so if the office still can't load.
    loadShell().catch(() => undefined);
  }, []);
  return <Lobby stream={stream} hub={hub} demo location={location} starting={starting} />;
}

type CompanyAddress = Extract<Address, { kind: 'company' }>;

function DemoCompany({ address, location }: { address: CompanyAddress; location: Location }) {
  const stream = useDemoCompany(address.company);
  const lobby = useDemoLobby();
  const actions = useMemo(() => demoHub().actions(address.company), [address.company]);
  const hub = useMemo(() => demoHub().hub(), []);
  const steer = useMemo(() => demoSteering(address.company), [address.company]);
  return (
    <Boundary fallback={<NoOffice />}>
      <Suspense fallback={<Opening />}>
        <Shell companyId={address.company} route={address.route} old={address.old} intent={address.talk} location={location} stream={stream} lobby={lobby.data} actions={actions} hub={hub} demo token={null} steer={steer} banner={<ReplayBanner companyId={address.company} />} />
      </Suspense>
    </Boundary>
  );
}

function Opening() {
  return (
    <div className="screen" role="status">
      <p className="screen__title">Opening the office</p>
    </div>
  );
}

function NoOffice() {
  return (
    <div className="screen" role="alert">
      <p className="screen__title">The office couldn't load</p>
      <p className="screen__text">Check the connection, then reload the page.</p>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
