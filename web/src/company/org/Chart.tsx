// The org chart's view on the mat (docs/design-v3.md, "The org chart"; docs/design-hud.md, "The org chart";
// feasibility, "The org chart"): DOM nodes and SVG lines in one world, panned and zoomed by one transform. Under 100% the
// zoom lays the chart out again with its columns closer and its nodes in another form, so no word is ever under 12 px;
// from 100% the world scales. The nodes are one tree (`role="tree"`, a flat list of `treeitem`s with their level, set
// size, position and `aria-expanded`), one tab stop with roving focus and the tree pattern's keys; a node's More follows
// it in the tab order. Pan by dragging the mat, the wheel or a trackpad; zoom with Ctrl and the wheel, a pinch or
// Safari's gesture events, at the pointer. Papers travel along the lines from one person to another.
//
// The org board and the proposal both draw it: the board says what each node shows (ChartItem) and does what a press
// asks; the chart keeps the view (kept per company for the tab) and the keys.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery, useReducedMotion } from '../../lib/hooks.ts';
import {
  clampZoom,
  elbowPath,
  FIT_MARGIN,
  FIT_TOP,
  floorZoom,
  FOLD_H,
  reportGapAt,
  type NodeForm,
  type OrgLayout,
  orgLayout,
  type OrgMember,
  openingZoom,
  type PlacedNode,
  relayRoute,
  SIGN_H,
  stepZoom,
  YOU,
} from './orgLayout.ts';
import { MAX_PAPERS, paperMs, type Relay } from './orgModel.ts';

/** What a node shows and says: the board's part. */
export interface ChartItem {
  id: string;
  /** Their room's style for the hue down the node's edge ('design'); null for none. */
  hue: string | null;
  /** The node's name for screen readers: who and how they are. */
  label: string;
  /** Figures that tick, said after a pause: "For 12 min. Sonnet, $4.66. Shift+F10 for more." */
  description?: string;
  /** The first name, which typing jumps to. */
  name: string;
  /** What the node shows in each form. */
  render: (form: NodeForm, mark: string | null) => ReactNode;
  /** Open in the side panel. */
  open?: boolean;
  /** Not matching Find someone. */
  dim?: boolean;
  /** Needs you: the face's ring and the highlighter chip. */
  needs?: boolean;
  /** The leash's tag on the top edge, left ("Trusted"); null for Default. */
  leash?: string | null;
  /** "In Design" on the top edge, right: moved to another room and still under their manager. */
  moved?: string | null;
  /** Fading out while the office takes them off the chart. */
  leaving?: boolean;
}

/** What the board's head asks of the chart. */
export interface ChartApi {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Pans so someone is in view; with `focus`, moves the tree's focus there too. */
  reveal(id: string, focus?: boolean): void;
  /** Papers for new messages, and nodes that ring. */
  relay(relays: readonly Relay[], rings: readonly string[]): void;
}

interface ChartProps {
  /** Names the tree: "Org chart", "The proposal". */
  label: string;
  members: readonly OrgMember[];
  items: ReadonlyMap<string, ChartItem>;
  folded: ReadonlySet<string>;
  onFold: (id: string, folded: boolean) => void;
  onOpen: (id: string) => void;
  /** The node's More; null where there is none (the proposal). */
  onMenu: ((id: string, anchor: HTMLElement) => void) | null;
  /** Each node's chip label, for the floor. */
  chipLabels: ReadonlyMap<string, string>;
  /** Where the view is kept for the tab. */
  storageKey: string;
  apiRef: RefObject<ChartApi | null>;
  onZoom: (zoom: number) => void;
  roomTitle: (room: string) => string;
  /** A folded manager's pill and line. */
  foldOf: (id: string) => { pill: string; line: string; needs: number };
  /** Who someone reported to before they left: "Lena". */
  lostName: (id: string) => string;
  /** The proposal's places for someone new. */
  adds?: { onAdd: (room: string) => void; onAddRoom: () => void } | null;
  /** Under the chart: visitors. */
  after?: ReactNode;
}

interface Camera {
  zoom: number;
  x: number;
  y: number;
  /** Moved by a key or a button: the world glides there (cut with reduced motion). */
  glide?: boolean;
}

interface Flight {
  key: string;
  d: string;
  yours: boolean;
  ms: number;
  to: string;
}

/** The mat left above the chart when it opens. */
const TOP = FIT_TOP;
/** Room kept round a node revealed by the keys. */
const REVEAL_MARGIN = 28;
const RING_MS = 400;
const RING_EVERY_MS = 1000;
const MARK_MS = 4000;

function readCamera(key: string): Camera | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object' && 'zoom' in raw && 'x' in raw && 'y' in raw) {
      const { zoom, x, y } = raw;
      if (typeof zoom === 'number' && typeof x === 'number' && typeof y === 'number' && [zoom, x, y].every(Number.isFinite)) return { zoom, x, y };
    }
  } catch {
    // Storage switched off or a damaged entry: the chart opens fitted.
  }
  return null;
}

let measurer: CanvasRenderingContext2D | null | undefined;
/** The longest first name's width in the chip's type (0.75rem Barlow Semi Condensed 600, 12 px at the default text size). */
function longestName(labels: Iterable<string>): number {
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  let longest = 0;
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  for (const label of labels) {
    // A label may add the title's word after a comma to tell two people apart; only the name must show whole.
    const text = label.split(',')[0] ?? label;
    if (measurer) {
      measurer.font = `600 ${0.75 * rootPx}px 'Barlow Semi Condensed', 'Barlow', system-ui, sans-serif`;
      longest = Math.max(longest, measurer.measureText(text).width);
    } else longest = Math.max(longest, text.length * 6.5);
  }
  return Math.ceil(longest);
}

const centre = (n: PlacedNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** Fitted to the free area (20 px of mat each side, clear of the dock), at 100% at most, down to the floor; else at the floor on `at` (or the CEO). */
function fittedView(room: { w: number; h: number; clear: number }, at: string | null, members: readonly OrgMember[], folded: ReadonlySet<string>, floor: number, adds: boolean): Camera {
  const layoutAt = (z: number) => orgLayout(members, { zoom: z, folded, adds });
  const { zoom, fits } = openingZoom(
    (z) => {
      const l = layoutAt(z);
      return { width: l.width, height: l.height };
    },
    { width: room.w, height: room.h - room.clear },
    floor,
  );
  const l = layoutAt(zoom);
  const w = room.w;
  // The top margin gives way when the free area is a little short (`FIT_SLACK`), so the chart stays whole.
  if (fits) return { zoom, x: Math.round((w - l.width * Math.max(zoom, 1)) / 2), y: Math.max(0, Math.min(TOP, room.h - room.clear - l.height)) };
  const n = l.nodes.find((x) => x.id === at) ?? l.nodes.find((x) => x.id === l.root);
  return { zoom, x: n ? Math.round(w / 2 - centre(n).x) : FIT_MARGIN, y: TOP };
}

export function Chart(props: ChartProps) {
  const { label, members, items, folded, onFold, onOpen, onMenu, chipLabels, storageKey, apiRef, onZoom, roomTitle, foldOf, lostName, adds, after } = props;
  const reduced = useReducedMotion();
  // Touch screens have no hover: the More of whoever is open in the side panel stays shown.
  const touch = useMediaQuery('(pointer: coarse)');
  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number; clear: number } | null>(null);
  const [kept, setCamera] = useState<Camera | null>(() => readCamera(storageKey));
  const floor = useMemo(() => floorZoom(longestName(chipLabels.values())), [chipLabels]);
  // Until it is moved (or the tab kept a view), the chart stays fitted to the room it has.
  const opening = useMemo(() => (kept === null && view !== null ? fittedView(view, null, members, folded, floor, Boolean(adds)) : null), [kept, view, members, folded, floor, adds]);
  const camera = kept ?? opening;
  const zoom = camera ? clampZoom(camera.zoom, floor) : 1;
  const layout = useMemo(() => orgLayout(members, { zoom, folded, adds: Boolean(adds) }), [members, zoom, folded, adds]);
  const scale = Math.max(zoom, 1);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  // ----- Focus: one tab stop, on a node that exists, following the person through any change of layout.
  const [active, setActive] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(0);
  const [seen, setSeen] = useState(members);
  if (seen !== members) {
    setSeen(members);
    if (active !== null && !byId.has(active)) {
      // They left, or went under a folded manager: their manager on the chart, else the CEO.
      const before = new Map(seen.map((m) => [m.id, m]));
      let at: string | null = before.get(active)?.reportsTo ?? null;
      const guard = new Set<string>();
      while (at !== null && !byId.has(at) && !guard.has(at)) {
        guard.add(at);
        at = before.get(at)?.reportsTo ?? members.find((m) => m.id === at)?.reportsTo ?? null;
      }
      setActive(at !== null && byId.has(at) ? at : layout.root);
      setRefocus((n) => n + 1);
    }
  }
  const current = active !== null && byId.has(active) ? active : (layout.root ?? layout.nodes[0]?.id ?? null);

  // ----- What the chart shows besides the people: papers, rings, "From Ada".
  const [flights, setFlights] = useState<Flight[]>([]);
  const [rings, setRings] = useState<ReadonlySet<string>>(() => new Set());
  const [marks, setMarks] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [hover, setHover] = useState<string | null>(null);
  // Focus somewhere in the chart: the tab stop's More shows then, as on hover.
  const [within, setWithin] = useState(false);

  // ----- The latest of everything, for handlers and the API.
  const latest = useRef({ layout, camera, view, floor, members, folded, reduced, current, items, scale });
  useLayoutEffect(() => {
    latest.current = { layout, camera, view, floor, members, folded, reduced, current, items, scale };
  });

  // The viewport's size, and what the talk bar and the mini-map keep clear at its foot.
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => {
      const clear = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      setView((was) => (was && was.w === el.clientWidth && was.h === el.clientHeight && was.clear === clear ? was : { w: el.clientWidth, h: el.clientHeight, clear }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layoutAt = (z: number): OrgLayout => orgLayout(latest.current.members, { zoom: z, folded: latest.current.folded, adds: Boolean(adds) });
  const fitted = (v: { w: number; h: number; clear: number }, at: string | null): Camera => fittedView(v, at, latest.current.members, latest.current.folded, latest.current.floor, Boolean(adds));

  useEffect(() => {
    if (camera) onZoom(zoom);
  }, [camera, zoom, onZoom]);
  useEffect(() => {
    if (!kept) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ zoom: kept.zoom, x: Math.round(kept.x), y: Math.round(kept.y) }));
    } catch {
      // Not kept where storage is switched off; the chart opens fitted next time.
    }
  }, [kept, storageKey]);

  /** Zoom to `next`, keeping a node (or the node nearest a point) where it is on screen. */
  const zoomTo = (next: number, anchor: { id: string } | { px: number; py: number } | null, glide = false) => {
    const { camera: cam, layout: was, floor: fl, view: v } = latest.current;
    if (!cam || !v) return;
    const z = clampZoom(next, fl);
    if (Math.abs(z - cam.zoom) < 0.001) return;
    const now = layoutAt(z);
    const s0 = Math.max(cam.zoom, 1);
    const s1 = Math.max(z, 1);
    const point = anchor === null ? { px: v.w / 2, py: (v.h - v.clear) / 2 } : 'px' in anchor ? anchor : null;
    let pin = anchor && 'id' in anchor ? anchor.id : null;
    if (point && was.nodes.length > 0) {
      // The node nearest the point stays under it, its distance from the point scaled with the columns.
      let best = Infinity;
      for (const n of was.nodes) {
        const c = centre(n);
        const d = Math.hypot(cam.x + c.x * s0 - point.px, cam.y + c.y * s0 - point.py);
        if (d < best) {
          best = d;
          pin = n.id;
        }
      }
    }
    const a = was.nodes.find((n) => n.id === pin);
    const b = now.nodes.find((n) => n.id === pin);
    if (!a || !b) {
      setCamera({ zoom: z, x: cam.x, y: cam.y, glide });
      return;
    }
    const ca = centre(a);
    const cb = centre(b);
    const sx = cam.x + ca.x * s0;
    const sy = cam.y + ca.y * s0;
    const k = point ? (now.pitch * s1) / (was.pitch * s0) : 1;
    const tx = point ? point.px + (sx - point.px) * k : sx;
    const ty = point ? point.py + (sy - point.py) * k : sy;
    setCamera({ zoom: z, x: tx - cb.x * s1, y: ty - cb.y * s1, glide });
  };

  /** The node a button's zoom keeps still: the focused one, else the one open in the side panel. */
  const anchorNode = (): { id: string } | null => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-org-node]') : null;
    if (focused?.dataset.orgNode) return { id: focused.dataset.orgNode };
    for (const [id, item] of latest.current.items) if (item.open && latest.current.layout.nodes.some((n) => n.id === id)) return { id };
    return null;
  };

  /** Pans the least so a node is in view, clear of the talk bar at the foot. */
  const reveal = (id: string, glide = true) => {
    const { camera: cam, layout: l, view: v, scale: s } = latest.current;
    const n = l.nodes.find((x) => x.id === id);
    if (!cam || !v || !n) return;
    const left = cam.x + n.x * s;
    const top = cam.y + n.y * s;
    const right = left + n.w * s + (onMenu ? 44 : 0);
    const bottom = top + n.h * s;
    const room = { l: REVEAL_MARGIN, r: v.w - REVEAL_MARGIN, t: REVEAL_MARGIN, b: v.h - v.clear - REVEAL_MARGIN };
    let dx = 0;
    let dy = 0;
    if (right - left > room.r - room.l || left < room.l) dx = room.l - left;
    else if (right > room.r) dx = room.r - right;
    if (bottom - top > room.b - room.t || top < room.t) dy = room.t - top;
    else if (bottom > room.b) dy = room.b - bottom;
    if (dx !== 0 || dy !== 0) setCamera({ ...cam, x: cam.x + dx, y: cam.y + dy, glide });
  };

  const focusNode = (id: string) => {
    setActive(id);
    treeRef.current?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    reveal(id);
  };

  // After a person left under focus: focus to where it went, if focus fell to the page.
  useLayoutEffect(() => {
    if (refocus === 0 || current === null) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(current)}"]`);
    if (el && (document.activeElement === null || document.activeElement === document.body)) el.focus({ preventScroll: true });
  }, [refocus, current]);

  // ----- Papers along the lines, rings, and "From Ada" with reduced motion.
  const lastRing = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) window.clearTimeout(t);
    };
  }, []);
  const later = (ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  const ring = (ids: readonly string[]) => {
    const now = performance.now();
    const fresh = ids.filter((id) => now - (lastRing.current.get(id) ?? -Infinity) >= RING_EVERY_MS);
    if (fresh.length === 0) return;
    for (const id of fresh) lastRing.current.set(id, now);
    setRings((was) => new Set([...was, ...fresh]));
    later(RING_MS, () => setRings((was) => new Set([...was].filter((x) => !fresh.includes(x)))));
  };
  /** The node someone shows as: themselves, or the nearest manager on the chart while they are folded away. */
  const shownAs = (id: string): string | null => {
    if (id === YOU) return YOU;
    const { layout: l, members: ms } = latest.current;
    const guard = new Set<string>();
    let at: string | null = id;
    while (at !== null && !guard.has(at)) {
      if (l.nodes.some((n) => n.id === at)) return at;
      guard.add(at);
      at = ms.find((m) => m.id === at)?.reportsTo ?? null;
    }
    return null;
  };

  const api: ChartApi = {
    zoomIn: () => zoomTo(stepZoom(latest.current.camera?.zoom ?? 1, 1, latest.current.floor), anchorNode(), true),
    zoomOut: () => zoomTo(stepZoom(latest.current.camera?.zoom ?? 1, -1, latest.current.floor), anchorNode(), true),
    fit: () => {
      const v = latest.current.view;
      if (v) setCamera({ ...fitted(v, anchorNode()?.id ?? null), glide: true });
    },
    reveal: (id, focus) => (focus ? focusNode(id) : reveal(id)),
    relay: (relays, ringing) => {
      const { layout: l, reduced: still } = latest.current;
      const flying: Flight[] = [];
      const marked = new Map<string, string>();
      const arrivals: string[] = [...ringing];
      for (const r of relays) {
        const from = shownAs(r.from);
        const to = shownAs(r.to);
        if (from === null || to === null || from === to) continue;
        if (still) {
          marked.set(to, r.from === YOU ? 'From you' : `From ${latest.current.items.get(r.from)?.name ?? latest.current.items.get(from)?.name ?? 'a colleague'}`);
          continue;
        }
        const route = flying.length < MAX_PAPERS ? relayRoute(l, from, to) : null;
        if (!route) {
          arrivals.push(to);
          continue;
        }
        flying.push({ key: `${r.key}:${performance.now()}`, d: route.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${Math.round(x)} ${Math.round(y)}`).join(' '), yours: r.yours, ms: paperMs(route.hops), to });
      }
      if (marked.size > 0) {
        setMarks((was) => new Map([...was, ...marked]));
        later(MARK_MS, () => setMarks((was) => new Map([...was].filter(([id]) => !marked.has(id)))));
      }
      if (flying.length > 0) setFlights((was) => [...was, ...flying].slice(-MAX_PAPERS));
      if (arrivals.length > 0) ring(arrivals);
    },
  };
  useLayoutEffect(() => {
    apiRef.current = api;
  });

  const landed = (f: Flight) => {
    setFlights((was) => was.filter((x) => x.key !== f.key));
    ring([f.to]);
  };

  // ----- Pan and zoom by pointer, wheel, pinch and Safari's gestures. The world takes will-change only while moving.
  const moving = useRef(0);
  const markMoving = () => {
    const world = worldRef.current;
    if (!world) return;
    world.classList.add('is-moving');
    window.clearTimeout(moving.current);
    moving.current = window.setTimeout(() => world.classList.remove('is-moving'), 160);
  };
  const pending = useRef<{ dx: number; dy: number; frame: number }>({ dx: 0, dy: 0, frame: 0 });
  const panBy = (dx: number, dy: number) => {
    const p = pending.current;
    p.dx += dx;
    p.dy += dy;
    markMoving();
    if (p.frame) return;
    p.frame = window.requestAnimationFrame(() => {
      const { dx: x, dy: y } = pending.current;
      pending.current = { dx: 0, dy: 0, frame: 0 };
      const cam = latest.current.camera;
      if (cam) setCamera({ zoom: cam.zoom, x: cam.x + x, y: cam.y + y });
    });
  };
  const localPoint = (clientX: number, clientY: number) => {
    const r = viewRef.current?.getBoundingClientRect();
    return { px: clientX - (r?.left ?? 0), py: clientY - (r?.top ?? 0) };
  };

  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    markMoving();
    if (e.ctrlKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      zoomTo((latest.current.camera?.zoom ?? 1) * factor, localPoint(e.clientX, e.clientY));
      return;
    }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (latest.current.view?.h ?? 600) : 1;
    if (e.shiftKey && e.deltaX === 0) panBy(-e.deltaY * unit, 0);
    else panBy(-e.deltaX * unit, -e.deltaY * unit);
  });
  const gesture = useRef<number | null>(null);
  const onGesture = useEffectEvent((e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault();
    if (e.type === 'gesturestart') gesture.current = latest.current.camera?.zoom ?? 1;
    else if (e.type === 'gesturechange' && gesture.current !== null && typeof e.scale === 'number') {
      zoomTo(gesture.current * e.scale, localPoint(e.clientX ?? 0, e.clientY ?? 0));
    } else gesture.current = null;
  });
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => onWheel(e);
    const gest = (e: Event) => onGesture(e);
    el.addEventListener('wheel', wheel, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(type, gest);
    return () => {
      el.removeEventListener('wheel', wheel);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) el.removeEventListener(type, gest);
    };
  }, []);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; pinch: { d: number; zoom: number } | null } | null>(null);
  const onBackground = (target: EventTarget) => target instanceof Element && target.closest('[data-org-node], button, a, input') === null;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onBackground(e.target)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: true, pinch: { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: latest.current.camera?.zoom ?? 1 } };
    } else drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, pinch: null };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d.pinch.d > 0) zoomTo((d.pinch.zoom * dist) / d.pinch.d, localPoint((a!.x + b!.x) / 2, (a!.y + b!.y) / 2));
      return;
    }
    if (e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    panBy(dx, dy);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (!d || pointers.current.size > 0) return;
    drag.current = null;
    if (d.moved || e.type === 'pointercancel') return;
    // A press on the mat without dragging centres the view there.
    const v = latest.current.view;
    const cam = latest.current.camera;
    if (!v || !cam) return;
    const { px, py } = localPoint(e.clientX, e.clientY);
    setCamera({ ...cam, x: cam.x + (v.w / 2 - px), y: cam.y + ((v.h - v.clear) / 2 - py), glide: true });
  };
  const onDoubleClick = (e: { target: EventTarget }) => {
    if (!onBackground(e.target)) return;
    api.fit();
  };
  // Focus moves never scroll the clipped view: the camera pans instead.
  const onScroll = () => {
    const el = viewRef.current;
    if (el && (el.scrollLeft !== 0 || el.scrollTop !== 0)) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  // ----- The tree's keys
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const id = current;
    if (id === null) return;
    const nodes = layout.nodes;
    const i = nodes.findIndex((n) => n.id === id);
    const n = nodes[i];
    if (!n) return;
    const go = (to: PlacedNode | undefined) => {
      if (!to) return;
      e.preventDefault();
      focusNode(to.id);
    };
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      if (!onMenu) return;
      e.preventDefault();
      const el = treeRef.current?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(id)}"]`);
      if (el) onMenu(id, el);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowDown':
        go(nodes[i + 1]);
        return;
      case 'ArrowUp':
        go(nodes[i - 1]);
        return;
      case 'Home':
        go(nodes[0]);
        return;
      case 'End':
        go(nodes.at(-1));
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (n.manages && n.folded) onFold(id, false);
        else if (n.manages) go(nodes.find((x) => x.parent === id));
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (n.manages && !n.folded) onFold(id, true);
        else if (n.parent !== null) go(nodes.find((x) => x.id === n.parent));
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpen(id);
        return;
    }
    // Typing a name jumps there: the next whose name starts with what was typed.
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = performance.now();
      const text = (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
      typed.current = { text, at: now };
      const order = [...nodes.slice(i + (text.length === 1 ? 1 : 0)), ...nodes.slice(0, i + (text.length === 1 ? 1 : 0))];
      const hit = order.find((x) => (items.get(x.id)?.name ?? '').toLowerCase().startsWith(text));
      if (hit) go(hit);
    }
  };

  // ----- Drawing
  const style = camera ? ({ transform: `translate(${Math.round(camera.x)}px, ${Math.round(camera.y)}px) scale(${scale})` } as CSSProperties) : ({ visibility: 'hidden' } as CSSProperties);
  const form = layout.form;
  const lit = flights.map((f) => f.d);

  return (
    <div
      ref={viewRef}
      className="org-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onScroll={onScroll}
      onFocus={() => setWithin(true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setWithin(false);
      }}
    >
      <div ref={worldRef} className={`org-world org-world--${form}${camera?.glide && !reduced ? ' is-gliding' : ''}`} style={style}>
        <svg className="org-lines" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map((e) => (
            <path key={`${e.from}>${e.to}`} className={e.dashed ? 'is-dashed' : undefined} d={elbowPath(e.points)} />
          ))}
          {lit.map((d, i) => (
            <path key={`lit-${i}`} className="is-lit" d={d} />
          ))}
        </svg>
        {layout.you && (
          <span className="org-you" style={{ left: layout.you.x, top: layout.you.y, height: layout.you.h }} aria-hidden="true">
            You
          </span>
        )}
        {layout.signs.map((s) => (
          <span key={`${s.room}-${s.over}`} className="org-sign" data-hue={items.get(s.over)?.hue ?? undefined} style={{ left: s.x, top: s.y, height: SIGN_H }} aria-hidden="true">
            {roomTitle(s.room)}
          </span>
        ))}
        {layout.lost.map((l) => (
          <span key={`lost-${l.id}`} className="org-lost" style={{ left: l.x, top: l.y, width: layout.nodes.find((n) => n.id === l.id)?.w }} aria-hidden="true">
            Reported to {lostName(l.manager)}, who left
          </span>
        ))}
        <div ref={treeRef} className="org-tree" role="tree" aria-label={label} onKeyDown={onTreeKey}>
          {layout.nodes.map((n) => {
            const item = items.get(n.id);
            if (!item) return null;
            const classes = [
              'org-node',
              `org-node--${form}`,
              item.open ? 'is-open' : '',
              item.dim ? 'is-dim' : '',
              item.needs ? 'is-needs' : '',
              rings.has(n.id) ? 'is-ringing' : '',
              item.leaving ? 'is-leaving' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const describe = item.description ? `org-desc-${n.id}` : undefined;
            return (
              <div
                key={n.id}
                role="treeitem"
                className={classes}
                data-org-node={n.id}
                data-hue={item.hue ?? undefined}
                tabIndex={n.id === current ? 0 : -1}
                aria-level={n.level}
                aria-setsize={n.setsize}
                aria-posinset={n.posinset}
                aria-expanded={n.manages ? !n.folded : undefined}
                aria-selected={item.open ? true : undefined}
                aria-label={item.label}
                aria-describedby={describe}
                aria-keyshortcuts={onMenu ? 'Shift+F10' : undefined}
                title={form === 'whole' ? undefined : item.label}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                onFocus={() => {
                  if (active !== n.id) setActive(n.id);
                }}
                onClick={() => {
                  setActive(n.id);
                  onOpen(n.id);
                }}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                {item.leash && form === 'whole' && <span className="org-node__leash">{item.leash}</span>}
                {item.moved && form !== 'chip' && <span className="org-node__moved">In {item.moved}</span>}
                {item.render(form, marks.get(n.id) ?? null)}
                {describe && (
                  <span id={describe} hidden>
                    {item.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {onMenu &&
          layout.nodes.map((n) => {
            const item = items.get(n.id);
            if (!item) return null;
            const shown = n.id === hover || (within && n.id === current) || (item.open && touch);
            return (
              <button
                key={`more-${n.id}`}
                type="button"
                className={`org-more${shown ? ' is-shown' : ''}${item.open ? ' is-open' : ''}`}
                style={{ left: n.x + n.w + 6, top: n.y + n.h / 2 }}
                tabIndex={n.id === current ? 0 : -1}
                aria-label={`More for ${item.name}`}
                aria-haspopup="menu"
                title={`More for ${item.name}`}
                onFocus={() => setActive(n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={(e) => onMenu(n.id, e.currentTarget)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="4.5" cy="10" r="1.7" />
                  <circle cx="10" cy="10" r="1.7" />
                  <circle cx="15.5" cy="10" r="1.7" />
                </svg>
              </button>
            );
          })}
        {layout.nodes
          .filter((n) => n.manages)
          .map((n) => {
            const fold = n.folded ? foldOf(n.id) : null;
            // The closed manager's pill hangs 8 px under them; the open key is 24 px, centred on the stem down to the reports.
            const top = n.y + n.h + (n.lost ? 18 : 0) + (fold ? 8 : Math.round((reportGapAt(n.h) - FOLD_H) / 2));
            return fold ? (
              <button
                key={`fold-${n.id}`}
                type="button"
                className={`org-fold${fold.needs > 0 ? ' is-needs' : ''}`}
                style={{ left: n.x + n.w / 2, top, height: FOLD_H }}
                tabIndex={-1}
                title={fold.line}
                aria-label={`Open ${items.get(n.id)?.name ?? ''}'s reports. ${fold.line}`}
                onClick={() => onFold(n.id, false)}
              >
                {fold.pill}
                {fold.needs > 0 && <span className="org-fold__needs">{fold.needs}</span>}
              </button>
            ) : (
              <button
                key={`fold-${n.id}`}
                type="button"
                className="org-fold org-fold--open"
                style={{ left: n.x + n.w / 2, top }}
                tabIndex={-1}
                title={`Close ${items.get(n.id)?.name ?? ''}'s reports`}
                aria-label={`Close ${items.get(n.id)?.name ?? ''}'s reports`}
                onClick={() => onFold(n.id, true)}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 6h6" />
                </svg>
              </button>
            );
          })}
        {adds &&
          layout.adds.map((a) => (
            <button
              key={`add-${a.under ?? 'room'}`}
              type="button"
              className="org-add"
              style={{ left: a.x, top: a.y, width: a.w }}
              data-focus={a.under ? `chart-add-${a.room}` : 'chart-add-room'}
              onClick={() => (a.under ? adds.onAdd(a.room) : adds.onAddRoom())}
            >
              {a.under ? `Add someone to ${roomTitle(a.room)}` : 'Add a room'}
            </button>
          ))}
        {flights.map((f) => (
          <Paper key={f.key} flight={f} onLanded={landed} />
        ))}
        {after && (
          <div className="org-after" style={{ top: layout.height + 40, minWidth: Math.max(layout.width, 320) }}>
            {after}
          </div>
        )}
      </div>
    </div>
  );
}

/** A paper along the lines: one animation along the route, 300 ms a hop, 1.2 s at most; the receiver rings on landing. */
function Paper({ flight, onLanded }: { flight: Flight; onLanded: (f: Flight) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const landed = useEffectEvent(() => onLanded(flight));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      landed();
      return;
    }
    const run = el.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], { duration: flight.ms, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' });
    run.onfinish = () => landed();
    return () => run.cancel();
  }, [flight.ms]);
  return <span ref={ref} className={`org-paper${flight.yours ? ' org-paper--yours' : ''}`} style={{ offsetPath: `path('${flight.d}')` } as CSSProperties} aria-hidden="true" />;
}
