// The DOM half of the labels: room signs (real buttons), gate and poster captions, people's bubbles, the selected
// person's name tag with its Ask button, and the conversation by the person asked. Positions are written by the
// LabelProjector inside the canvas; this component only decides what exists. v3, a company's office: a sign over every
// room (its own rooms plain, no v2 lobby or lead), the front desk's sign and the bubbles of those who wait there opening
// their item in the inbox, the line over the door at night, and the office screen's overlay.
import { type ReactNode, type SyntheticEvent, useContext, useEffect, useRef, useState } from 'react';
import { capital } from '../../../src/core/words.ts';
import { PreviewScreen } from '../company/preview/PreviewScreen.tsx';
import { companyPath, navigate, parseAddress, routePath } from '../company/router.ts';
import { StatePill } from '../company/ui/StatePill.tsx';
import { useMediaQuery } from '../lib/hooks.ts';
import type { Selection } from './Building.tsx';
import type { Bubble, CastMember } from './cast.ts';
import { ASK_LABEL, type LabelStore, OfficeLabelsContext, SCREEN_LABEL } from './labels.tsx';
import type { Layout } from './layout.ts';
import { COUNTER_TOP } from './office/fronts.ts';
import { bubbleShown, frontDeskSign, happensNow, itemPath, nightLine, officeSigns, roomsAtWork } from './officeLabels.ts';
import { DEPARTMENT_HUE } from './palette.ts';
import './labels.css';

interface Props {
  store: LabelStore;
  layout: Layout;
  cast: CastMember[];
  selection: Selection;
  selectedKey: string | null;
  runningGates: Set<string>;
  roomNames: Map<string, string>;
  onSelect: (selection: Selection) => void;
  /** The conversation open with someone in the scene: the figure it belongs to, and on desktops the conversation. */
  asking: { figureKey: string; popover: ReactNode | null } | null;
  onAsk: (member: CastMember, opener: HTMLElement) => void;
  /** What the HUD covers at the stage's edges, so the conversation stays clear of it. */
  insets: { top: number; right: number; bottom: number };
  /** A company's labels' area, exact (stage and dock); without it labels keep a margin inside `insets`, as v2's do. */
  area?: { top: number; right: number; bottom: number; left: number } | null;
  /** A HUD piece over the office (a desktop's open feed), as a rectangle on the stage: labels under it are hidden. */
  covered?: { left: number; top: number; right: number; bottom: number } | null;
  /** False while the office is the mini-map or covered: nothing is placed and the layer is out of the page's order. */
  active?: boolean;
  reducedMotion: boolean;
  /**
   * Phones with the sheet at 78%: the strip above is a thumbnail, with no room signs or gate captions and only the
   * selected or asked person's label and bubbles of people who need you, are stuck or have a question. A company's
   * front desk sign stays.
   */
  thumbnail: boolean;
  /** Progress beside the office: room signs stay, and only bubbles of people who need you, are stuck or ask show. */
  quiet?: boolean;
}

/** Anchors this layer places itself: the front desk's sign on the counter, the night line over the door. */
const FRONT_DESK = 'desk:front';
const NIGHT = 'door:night';
/** How high the night line hangs over the street door, and how far the sign stands out from the counter's front. */
const NIGHT_HEIGHT = 2.6;
const SIGN_OUT = 0.02;

/** A view under the company the office is open on, through the shell's addresses when it gives no way of its own. */
function openInCompany(path: string) {
  const address = parseAddress(window.location.pathname);
  if (address.kind === 'company') navigate(companyPath(address.company, path));
}

export function LabelLayer({ store, layout, cast, selection, selectedKey, runningGates, roomNames, onSelect, asking, onAsk, insets, area = null, covered = null, active = true, reducedMotion, thumbnail, quiet = false }: Props) {
  const urgentOnly = thumbnail || quiet;
  const selectedRoom = selection?.kind === 'room' ? selection.id : null;
  const narrow = useMediaQuery('(max-width: 720px)');
  const { top, right, bottom } = insets;
  const exact = area !== null;
  const { top: aTop = 0, right: aRight = 0, bottom: aBottom = 0, left: aLeft = 0 } = area ?? {};
  useEffect(() => {
    if (exact) store.setArea({ top: aTop, right: aRight, bottom: aBottom, left: aLeft }, reducedMotion, narrow);
    else store.setView({ top, right, bottom }, reducedMotion, narrow);
  }, [store, exact, aTop, aRight, aBottom, aLeft, top, right, bottom, reducedMotion, narrow]);
  const { left: cLeft = 0, top: cTop = 0, right: cRight = 0, bottom: cBottom = 0 } = covered ?? {};
  const hasCover = covered !== null;
  useEffect(() => store.setCovered(hasCover ? { left: cLeft, top: cTop, right: cRight, bottom: cBottom } : null), [store, hasCover, cLeft, cTop, cRight, cBottom]);
  useEffect(() => store.setActive(active), [store, active]);
  // When a conversation opens (or moves to someone else), the camera shows the person, and the conversation beside them.
  const figure = asking?.figureKey ?? null;
  const beside = Boolean(asking?.popover);
  useEffect(() => {
    if (figure !== null) store.focusOn(`person:${figure}`, beside, performance.now());
  }, [store, figure, beside]);

  // A company's office: its anchors for the front desk's sign and the night line, and what the shell gives.
  const office = layout.office ?? null;
  const shell = useContext(OfficeLabelsContext);
  const open = shell?.open ?? openInCompany;
  const sign = office?.reception.frontDesk.sign ?? null;
  const door = office?.door ?? null;
  useEffect(() => {
    if (!sign || !door) return;
    const unpinSign = store.pin(FRONT_DESK, sign.x, COUNTER_TOP, sign.z + SIGN_OUT);
    const unpinDoor = store.pin(NIGHT, door.x, NIGHT_HEIGHT, door.z);
    return () => {
      unpinSign();
      unpinDoor();
    };
  }, [store, sign, door]);
  // v0.8: a company's office is calm. The inbox card is the front desk's sign now, and signs and bubbles show where
  // something happens.
  const calm = office !== null && shell !== null;
  const desk = office && !calm ? frontDeskSign(cast) : null;
  const atWork = calm ? roomsAtWork(cast) : null;
  // The CEO (a plain job's Claude Code) works in the CEO's office, whatever room their department names.
  if (atWork && office && cast.some((m) => m.level === 'ceo' && (m.status === 'working' || m.status === 'thinking'))) atWork.add(office.ceo.id);
  const night = office && shell ? nightLine(shell.company) : null;
  const [live, setLive] = useState(false);
  useEffect(() => store.watchScreen(setLive), [store]);
  useEffect(() => store.onScreenPress(() => open(routePath({ view: 'preview' }))), [store, open]);

  const room = selectedRoom ? layout.rooms.find((r) => r.id === selectedRoom) : undefined;
  const shown = (m: CastMember) =>
    m.key === selectedKey || m.key === figure || (m.bubble !== null && bubbleShown(m.bubble.tone, urgentOnly, false) && (!calm || happensNow(m)));
  // A room's sign or key with focus stays while it has it, whoever starts or stops working there meanwhile (v0.8).
  const [held, setHeld] = useState<{ sign: string | null; quiet: string | null }>({ sign: null, quiet: null });
  const hold = (kind: 'sign' | 'quiet', room: string | null) => setHeld((h) => (h[kind] === room ? h : { ...h, [kind]: room }));
  const roomSign = (id: string, name: string, hue: string, more: number) => (
    <div key={id} ref={store.node(`room:${id}`)} className="label">
      <div className={`room-sign${selectedRoom === id ? ' is-selected' : ''}`}>
        <button
          type="button"
          className="room-sign__button"
          style={{ ['--hue' as string]: hue }}
          aria-pressed={selectedRoom === id}
          onFocus={() => hold('sign', id)}
          onBlur={() => hold('sign', null)}
          onClick={() => onSelect(selectedRoom === id ? null : { kind: 'room', id })}
        >
          {name}
          {more > 0 && <span className="room-sign__more">+{more} rules</span>}
        </button>
      </div>
    </div>
  );
  const plainSign = (id: string, name: string) => (
    <div key={id} ref={store.node(id)} className="label">
      <div className="room-sign room-sign--plain">
        <span>{name}</span>
      </div>
    </div>
  );

  // The front desk's crowd folds into its sign; the pointer or focus on any of them opens it (stack.ts, `foldCrowds`). The
  // close waits a moment so moving from the sign to a bubble that has just appeared doesn't shut it.
  const crowd = (e: SyntheticEvent) => (e.target instanceof Element ? e.target.closest('[data-fold], [data-folds]') : null);
  const [touched, setTouched] = useState<{ hover: boolean; focus: boolean }>({ hover: false, focus: false });
  const deskOpen = touched.hover || touched.focus;
  useEffect(() => {
    store.setOpen(FRONT_DESK, deskOpen);
    return () => store.setOpen(FRONT_DESK, false);
  }, [store, deskOpen]);
  const closing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closing.current), []);
  const touch = (part: 'hover' | 'focus', on: boolean, delay = 0) => {
    window.clearTimeout(closing.current);
    if (on || delay === 0) setTouched((t) => (t[part] === on ? t : { ...t, [part]: on }));
    else closing.current = window.setTimeout(() => setTouched((t) => ({ ...t, [part]: false })), delay);
  };

  return (
    <div
      className={office ? 'labels labels--office' : 'labels'}
      onPointerOver={(e) => crowd(e) && e.pointerType === 'mouse' && touch('hover', true)}
      onPointerOut={(e) => crowd(e) && e.pointerType === 'mouse' && touch('hover', false, 250)}
      onFocus={(e) => crowd(e) && touch('focus', true)}
      onBlur={(e) => crowd(e) && !(e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-fold], [data-folds]')) && touch('focus', false)}
    >
      {/* First to tab to: what needs you. It lies over the rest by its z-index (labels.css). */}
      {desk && (
        <div ref={store.node(FRONT_DESK)} className="label label--front-desk" data-rank={1} data-folds="">
          <button type="button" className="front-desk-sign" onClick={() => open(desk.opens)}>
            {desk.text}
          </button>
        </div>
      )}
      {/* Before the other labels, so they all lie over it; dark at night, as the 3D screen is. The pointer passes
          through it to the canvas, where labels.tsx matches a press to it; its button is there for the keyboard. */}
      {office && shell && !night && (
        <div ref={store.node(SCREEN_LABEL)} className="label label--screen">
          <PreviewScreen company={shell.company} screenshotUrl={shell.screenshotUrl} live={live} onOpen={() => open(routePath({ view: 'preview' }))} />
        </div>
      )}
      {!thumbnail &&
        (office
          ? officeSigns(layout).filter((s) => atWork === null || atWork.has(s.room) || s.room === selectedRoom || s.room === held.sign).map((s) => {
            if (!s.department) return plainSign(s.id, s.name);
            const r = layout.rooms.find((x) => x.id === s.room);
            return roomSign(s.room, s.name, DEPARTMENT_HUE[s.department], r?.morePosters ?? 0);
          })
          : layout.rooms.map((r) => roomSign(r.id, r.name, DEPARTMENT_HUE[r.style], r.morePosters)))}
      {/* v0.8: the rooms nobody works in now have no sign over them, and stay one key away: a keyboard reaches each of them
          here, the key showing where it has focus (the pointer has the rooms themselves). */}
      {!thumbnail && atWork !== null && (
        <div className="quiet-rooms" role="group" aria-label="Rooms where nobody works now">
          {officeSigns(layout)
            .filter((s) => s.department !== null && ((!atWork.has(s.room) && s.room !== selectedRoom) || s.room === held.quiet))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="quiet-rooms__key"
                style={{ ['--hue' as string]: DEPARTMENT_HUE[s.department ?? 'engineering'] }}
                onFocus={() => hold('quiet', s.room)}
                onBlur={() => hold('quiet', null)}
                onClick={() => onSelect({ kind: 'room', id: s.room })}
              >
                {s.name}
              </button>
            ))}
        </div>
      )}
      {!thumbnail && !office && (
        <>
          <div ref={store.node('room:lobby')} className="label">
            <div className="room-sign room-sign--plain"><span>Lobby</span></div>
          </div>
          <div ref={store.node('room:lead')} className="label">
            <div className="room-sign room-sign--plain"><span>Lead</span></div>
          </div>
        </>
      )}
      {!thumbnail && (
      <>
      {layout.gates
        .filter((g) => runningGates.has(g.id) || selectedRoom === g.from)
        .map((g) => (
          <div key={g.id} ref={store.node(`gate:${g.id}`)} className="label">
            <div className={`gate-label${runningGates.has(g.id) ? ' is-running' : ''}`}>
              <span className="gate-label__name">{g.title}</span>
              <span className="gate-label__to">to {roomNames.get(g.to) ?? g.to}</span>
            </div>
          </div>
        ))}

      {room?.posters.map((p) => (
        <div key={p.ruleId} ref={store.node(`poster:${p.ruleId}`)} className="label">
          <div className="poster-label">{p.title}</div>
        </div>
      ))}
      </>
      )}

      {/* The top bar says it to screen readers already. */}
      {night && !thumbnail && (
        <div ref={store.node(NIGHT)} className="label label--night" aria-hidden="true">
          <div className="night-line">
            <StatePill label={night} tone="rest" />
          </div>
        </div>
      )}

      {cast
        .filter(shown)
        .map((m) => (
          <div key={m.key} ref={store.node(`person:${m.key}`)} className="label label--person" data-rank={rankOf(m.bubble)} {...(desk && m.inLine !== null && m.key !== selectedKey && m.key !== figure ? { 'data-fold': FRONT_DESK } : {})} data-walking={m.walk.length > 0} data-depth={m.depth.toFixed(2)}>
            <div className="person-label">
              {m.bubble && bubbleShown(m.bubble.tone, urgentOnly, m.key === selectedKey || m.key === figure) &&
                (office && m.item !== null ? (
                  // Whoever waits at the front desk: their bubble opens their item, as their paper does.
                  <button type="button" className="bubble-button" onClick={() => open(itemPath(m.item ?? ''))}>
                    <span className="visually-hidden">{capital(m.who)}: </span>
                    <SpeechBubble bubble={m.bubble} hue={m.hue} />
                    <span className="visually-hidden">{m.item === 'proposal' ? ', open the proposal' : ', open it in the inbox'}</span>
                  </button>
                ) : (
                  <SpeechBubble bubble={m.bubble} hue={m.hue} />
                ))}
              {m.key === selectedKey && (
                <div className="name-tag">
                  <span className="name-tag__title">{m.title}</span>
                  {m.cost && <span className="name-tag__cost">{m.cost}</span>}
                  {/* Phones leave it out: the badge in the sheet has Ask. */}
                  {!narrow && (
                    <button type="button" className="name-tag__ask" data-ask={`tag:${m.key}`} aria-label={`Ask ${m.who}`} onClick={(e) => onAsk(m, e.currentTarget)}>
                      Ask
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

      {asking?.popover && (
        <div ref={store.node(ASK_LABEL)} className="label label--ask" data-anchor={`person:${asking.figureKey}`}>
          {asking.popover}
        </div>
      )}
    </div>
  );
}

/** Bubbles that matter most keep their place when bubbles stack: someone who needs you, then the stuck and the asking. */
function rankOf(bubble: Bubble | null): number {
  if (bubble?.tone === 'needs-you' || bubble?.tone === 'answering') return 2;
  return bubble?.tone === 'stuck' || bubble?.tone === 'question' ? 1 : 0;
}

function SpeechBubble({ bubble, hue }: { bubble: Bubble; hue: string }) {
  return (
    <div className={`bubble bubble--${bubble.tone}`} style={{ ['--hue' as string]: hue }}>
      {bubble.dot === 'check' ? (
        <svg className="bubble__check" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.5 5 9l4.5-6" />
        </svg>
      ) : (
        bubble.dot && <span className={`bubble__dot${bubble.dot === 'busy' ? ' is-busy' : ''}`} aria-hidden="true" />
      )}
      {bubble.lead && <strong className="bubble__lead">{bubble.lead} </strong>}
      {bubble.text}
    </div>
  );
}
