// The dock (docs/design-v3.md, "Stage and dock"): the foot of every company view. The talk bar, the live strip riding
// on it and the feed it opens upward into, placed in the shell's main view (the CSS container `main`). It attaches the
// talk bar to the company's TalkLink, so every view's `talk` reaches it, and tells the shell when the feed opens.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery, useReducedMotion } from '../../lib/hooks.ts';
import { Feed } from '../feed/Feed.tsx';
import { feedLines } from '../feed/feedModel.ts';
import { useEarlier } from '../feed/useEarlier.ts';
import { useCompanyClock } from '../people/clock.ts';
import { useLiveStripHidden } from '../strip/preference.ts';
import { Strip } from '../strip/Strip.tsx';
import { anythingNew, feedKeyName, newReplies, STRIP_SHOWN, stripFeedLines } from '../strip/stripModel.ts';
import { draftScope } from '../ui/draftScope.ts';
import type { DockProps } from '../mounts.tsx';
import type { FeedOpening } from './link.ts';
import { TalkBar, type TalkBarApi } from './TalkBar.tsx';
import { Glyph } from './bits.tsx';
import { showsSuggestions } from '../proposal/model.ts';
import { SUGGESTIONS } from './suggestions.ts';
import './talk.css';


/** The bar is compact where the main view is narrower than this. */
const COMPACT_UNDER = 640;
const FEED_ID = 'company-feed';

const seenKey = (scope: string) => `worklings-feed-seen:${scope}`;

function readSeen(scope: string): number | null {
  try {
    const raw = Number(window.localStorage.getItem(seenKey(scope)));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeSeen(scope: string, at: number): void {
  try {
    window.localStorage.setItem(seenKey(scope), String(at));
  } catch {
    // Kept for this page where storage is switched off.
  }
}

export function Dock(props: DockProps) {
  const { snapshot, company, online, link, board, office, phone, founding, onFeed, talk, inboxBeside = false } = props;
  const still = useReducedMotion();
  const [stripHidden] = useLiveStripHidden();
  const short = useMediaQuery('(max-height: 559px)') && phone;
  const now = useCompanyClock(snapshot.serverTime, online);
  const scope = draftScope(company);
  const [feed, setFeed] = useState<{ open: boolean; at: string | null; newFrom: number; ask: number }>({ open: false, at: null, newFrom: 0, ask: 0 });
  // When you last looked at the feed in this browser; a first visit counts from now, so an old company isn't all new.
  const [seenAt, setSeenAt] = useState(() => readSeen(scope) ?? snapshot.serverTime);
  const [compact, setCompact] = useState(phone);
  const [covered, setCovered] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const bar = useRef<TalkBarApi>(null);
  // What opened the feed (Feed, the strip, the palette's command), where focus goes back when it closes.
  const opener = useRef<HTMLElement | null>(null);

  // The view's messages with any earlier pages in front of them ("Show earlier lines").
  const earlier = useEarlier(company, props.actions);
  const full = earlier.company;
  const lines = useMemo(() => feedLines(snapshot, full, now), [snapshot, full, now]);
  const replies = newReplies(lines, seenAt, company.seen);
  const fresh = anythingNew(lines, seenAt);

  const openFeed = useCallback(
    (options: FeedOpening & { at?: string | null } = {}) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest(`#${FEED_ID}`)) opener.current = active;
      setFeed((f) => ({ open: true, at: options.at ?? null, newFrom: f.open ? f.newFrom : seenAt, ask: options.catchUp ? f.ask + 1 : f.ask }));
      onFeed(true);
    },
    [onFeed, seenAt],
  );
  const closeFeed = useCallback(
    (restore: boolean) => {
      const inFeed = root.current?.querySelector(`#${FEED_ID}`)?.contains(document.activeElement) ?? false;
      setFeed((f) => ({ ...f, open: false, at: null }));
      onFeed(false);
      // The office's clock, which accounts for a phone running ahead of the hub: lines the hub stamps must still count as new.
      const at = Math.max(now, snapshot.serverTime);
      setSeenAt(at);
      writeSeen(scope, at);
      // Focus goes back to what opened it (Feed, the strip), else to Feed, or the strip on phones.
      if (restore || inFeed) {
        const back = opener.current;
        opener.current = null;
        window.requestAnimationFrame(() => {
          const target = back?.isConnected ? back : root.current?.querySelector<HTMLElement>('.talkbar__feed') ?? root.current?.querySelector<HTMLElement>('.livestrip, .dock__feed-key');
          target?.focus({ preventScroll: true });
        });
      }
    },
    [onFeed, scope, snapshot.serverTime, now],
  );

  // Every view's `talk` reaches the bar through the link; calls made before it mounted run now.
  const handlers = useRef({ openFeed, closeFeed });
  useEffect(() => {
    handlers.current = { openFeed, closeFeed };
  });
  useEffect(
    () =>
      link.attach({
        offer: (to) => bar.current?.offer(to),
        to: (to, options) => bar.current?.to(to, options),
        stop: (person) => bar.current?.stop(person),
        focus: () => bar.current?.focus(),
        openFeed: (options) => handlers.current.openFeed(options),
        closeFeed: () => handlers.current.closeFeed(false),
      }),
    [link],
  );

  // The compact form where the main view is under 640 px: measured, since the main view isn't the window.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setCompact(phone || el.getBoundingClientRect().width < COMPACT_UNDER);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phone]);

  // The talk bar's height, for the labels' area, the boards' scroll padding and the camera (`--talk-now`).
  useLayoutEffect(() => {
    const form = row.current?.querySelector<HTMLElement>('.talkbar');
    const shell = root.current?.closest<HTMLElement>('[data-company-shell]');
    if (!form || !shell) return;
    const update = () => shell.style.setProperty('--talk-now', `${Math.round(form.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  // Phones: the side panel's sheet lies over the feed's, which is out of reach meanwhile.
  useEffect(() => {
    const shell = root.current?.closest<HTMLElement>('[data-company-shell]');
    if (!shell) return;
    const update = () => setCovered(shell.dataset.sheet === 'panel');
    update();
    const observer = new MutationObserver(update);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-sheet'] });
    return () => observer.disconnect();
  }, []);

  // Phones: the talk bar rides on the keyboard, which iOS draws over the page rather than shrinking it.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = root.current;
    if (!phone || !vv || !el) return;
    const update = () => el.style.setProperty('--keyboard', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.style.removeProperty('--keyboard');
    };
  }, [phone]);

  const feedKey = {
    open: feed.open,
    id: FEED_ID,
    name: feedKeyName(feed.open, replies, fresh),
    count: replies,
    dot: replies === 0 && fresh,
    toggle: () => (feed.open ? closeFeed(true) : openFeed()),
  };

  // The live strip is the office's: progress and the boards say what happened in their own words.
  const showStrip = office && !feed.open && !founding && !short && !stripHidden;
  // With the inbox open beside the office, what needs you is already listed there once.
  const stripFeed = useMemo(() => stripFeedLines(lines, inboxBeside), [inboxBeside, lines]);
  return (
    <div ref={root} className={`dock${phone ? ' dock--phone' : ''}${board ? ' dock--board' : ''}${feed.open ? ' dock--feed' : ''}`} data-dock data-still={still || undefined}>
      {feed.open && (
        <div className="dock__above dock__above--feed">
          <Feed
            id={FEED_ID}
            companyId={props.companyId}
            snapshot={snapshot}
            company={full}
            actions={props.actions}
            lines={lines}
            newFrom={feed.newFrom}
            at={feed.at}
            now={now}
            online={online}
            phone={phone}
            covered={covered}
            catchUp={props.catchUp}
            catchUpAsk={feed.ask}
            earlier={earlier}
            announce={props.announce}
            navigate={props.navigate}
            talk={talk}
            onClose={() => closeFeed(true)}
          />
        </div>
      )}
      {/* The chips change an org, so they wait for a proposal: before it, the scoping questions or the draft are what there is. */}
      {!feed.open && founding && showsSuggestions(company) && (
        <div className="dock__above">
          <div className="dock__suggestions" role="group" aria-label="Suggestions for the CEO">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} type="button" className="dock__suggestion" onClick={() => bar.current?.suggest(s.text, s.caret)}>
                {s.label.split('…').flatMap((part, i) => (i === 0 ? [part] : [<span key={i} aria-hidden="true">…</span>, part]))}
              </button>
            ))}
          </div>
        </div>
      )}
      {showStrip && (
        <div className="dock__above">
          <Strip snapshot={snapshot} company={company} lines={stripFeed} count={board || phone ? STRIP_SHOWN.board : STRIP_SHOWN.office} phone={phone} now={now} replies={replies} feedId={FEED_ID} onOpen={(at) => openFeed({ at })} />
        </div>
      )}
      {!feed.open && phone && !short && !showStrip && !founding && (
        <div className="dock__above dock__above--end">
          <button type="button" className="dock__feed-key" aria-expanded={false} aria-controls={FEED_ID} aria-label={feedKey.name} title={feedKey.name} onClick={() => openFeed()}>
            <Glyph name="feed" />
            {replies > 0 && (
              <span className="talkbar__count" aria-hidden="true">
                {replies}
              </span>
            )}
          </button>
        </div>
      )}
      <div ref={row} className="dock__bar">
        <TalkBar ref={bar} {...props} compact={compact} short={short} feed={feedKey} onChip={founding ? undefined : props.onChip} onEscape={() => (feed.open ? (closeFeed(true), true) : false)} />
      </div>
    </div>
  );
}
