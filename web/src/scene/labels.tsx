// Labels over the model live in one DOM layer above the canvas. Scene objects register 3D anchors, DOM labels
// register their elements, and a projector inside the canvas moves each label to its anchor's screen position on
// every rendered frame. One React tree, real buttons people can tab to, no per-label React roots. Labels that would
// cover each other are lifted apart, and what doesn't fit is dropped (see stack.ts), using sizes measured only when they
// change. The conversation with someone (Ask aside) is a label too: it sits beside its person, inside the part of the
// stage the HUD leaves free, and the camera pans just enough to show both when it opens, room for its full height
// included, so it grows downward as answers come in. v3, a company's office: the front desk's sign and the line over
// the door at night are fixed labels, and the office screen's overlay is laid exactly over the 3D screen's face.
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, type RefObject, useContext, useEffect } from 'react';
import { type Camera, type Object3D, Vector3 } from 'three';
import type { CompanyView } from '../../../src/core/company.ts';
import { overlayMatrix } from './office/screen.ts';
import { facesCamera, onScreen, type ScreenCorners, screenLive } from './officeLabels.ts';
import { edgeToward, inBox, OFFICE_MIDDLE, type Reach } from './reach.ts';
import { type Area, type LabelBox, placeBeside, shiftToShow, stackLabels } from './stack.ts';

type Anchor = { object: Object3D; lift: number } | { point: Vector3 };

/** Labels the stacking moves or steers around, by their id's prefix: the front desk's sign and the night line are fixed. */
const KIND: Record<string, LabelBox['kind']> = { 'room:': 'sign', 'gate:': 'gate', 'person:': 'person', 'desk:': 'fixed', 'door:': 'fixed' };
const kindOf = (id: string) => KIND[id.slice(0, id.indexOf(':') + 1)];
/** How each kind hangs from its anchor: signs above and to the right of a room's corner, the front desk's sign down the counter. */
const hangOf = (id: string): LabelBox['hang'] => (id.startsWith('room:') ? 'above-right' : id.startsWith('desk:') ? 'below' : 'above');
/** The conversation's label; `data-anchor` names the person it sits beside. */
export const ASK_LABEL = 'ask';
/** The office screen's overlay, laid over the corners the scenery registers as `screen:top-left` and so on. */
export const SCREEN_LABEL = 'screen';
const SCREEN_CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
/** The overlay's own width before it is laid over the screen: its height follows the screen's shape. */
const SCREEN_BASE_W = 320;
/** A press that moves further than this is a drag of the camera, not a press on the screen. */
const PRESS_SLOP = 6;

/** What a company's office adds to the labels, from the shell: the company, where its screenshots are, a way to its views. */
export interface OfficeLabels {
  company: CompanyView;
  screenshotUrl: (shot: string) => string;
  /** Goes to a view under the company: `inbox/q-3`, `proposal`, `preview`. */
  open: (path: string) => void;
}

/** Provided by the shell around the stage of a company's office. */
export const OfficeLabelsContext = createContext<OfficeLabels | null>(null);
/** Kept clear around the free area's edges. */
const MARGIN = 12;
/** Labels keep this far inside the screen's sides. */
const EDGE = 8;
/**
 * People's bubbles in one stack: three on phones (the least important drop first), four on desktops, where routine
 * ones drop and someone who needs you, is stuck or asks a question (rank 1 and up) always shows, so 25 people at work
 * don't bury the office under a tower of "On it".
 */
const PHONE_STACK = 3;
const DESKTOP_STACK = 4;
const ALWAYS_SHOWN = 1;
const PAN_MS = 350;
/** The conversation's width and tallest height, or the free area's if that is smaller (styles.css, .talk--popover). */
const ASK_MAX = { w: 320, h: 560 };

interface Controls {
  target: Vector3;
  update: () => void;
}

const isOrthographic = (camera: Camera): camera is Camera & { zoom: number } => 'isOrthographicCamera' in camera;
const hasTarget = (controls: unknown): controls is Controls =>
  typeof controls === 'object' && controls !== null && 'target' in controls && controls.target instanceof Vector3 && 'update' in controls;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class LabelStore {
  readonly anchors = new Map<string, Anchor>();
  readonly nodes = new Map<string, HTMLElement>();
  private readonly v = new Vector3();
  private readonly refs = new Map<string, (el: HTMLElement | null) => void>();
  private readonly sizes = new Map<string, { w: number; h: number }>();
  private readonly lifts = new Map<string, number>();
  private readonly shifts = new Map<string, number>();
  /** The stacking order last set on each person's label, and the room signs hidden under a label. */
  private readonly layers = new Map<string, number>();
  private readonly covered = new Set<string>();
  /** Folds the pointer or focus is on (a label's id): their folded labels show (stack.ts, `foldCrowds`). */
  private open = new Set<string>();
  /** The free area as last handed to the conversation, as its CSS sizes. */
  private room = '';
  private readonly ids = new WeakMap<Element, string>();
  private observer: ResizeObserver | null = null;
  private requestFrame: () => void = () => {};
  /** What the HUD covers at each edge of the stage, in pixels. */
  private insets = { top: 0, right: 0, bottom: 0 };
  /**
   * A company's labels' area (stage and dock), exact: from each edge of the stage to where labels may go. Null for v2's
   * insets, inside which labels keep a margin.
   */
  private area: { top: number; right: number; bottom: number; left: number } | null = null;
  /**
   * A HUD piece standing over the office (the open feed on a desktop), in stage pixels: every label under it, the fixed
   * ones and the office screen's too, is hidden, so nothing that takes focus is ever beneath it. Null for none.
   */
  private under: Area | null = null;
  /** The last frame's camera and stage size, and the element the stage draws in: what `reach` answers from. */
  private camera: Camera | null = null;
  private stageW = 0;
  private stageH = 0;
  private surface: HTMLElement | null = null;
  /** Off while the office is the mini-map or covered: nothing is placed, and the office screen doesn't run live. */
  private active = true;
  private instant = false;
  /** Phones: a stack of bubbles holds three at most. */
  private narrow = false;
  /** Someone to bring into view on the next frame (with the conversation beside them, on desktops). */
  private focus: { anchor: string; beside: boolean; at: number } | null = null;
  private pan: { from: number; camera: Vector3; target: Vector3; by: Vector3 } | null = null;
  /** The conversation's side and tail as last drawn, and the person it was beside (a new person starts it afresh). */
  private side: { anchor: string; side: 'right' | 'left'; tail: number | null } | null = null;
  /** The office screen's overlay: its own size and scale as last set, whether it may run live, and who to tell when that changes. */
  private screenSize = '';
  private screenScale = '';
  private live: boolean | null = null;
  private liveListener: (live: boolean) => void = () => {};
  /** Its corners on the stage as last drawn (null while it isn't), what a press on it does, and whether the mouse is on it. */
  private screenAt: ScreenCorners | null = null;
  private screenPress: () => void = () => {};
  private screenHover = false;

  /** The projector hands over the element the stage draws in, so `reach` can give page positions. */
  drawnIn(surface: HTMLElement): () => void {
    this.surface = surface;
    return () => {
      this.surface = null;
    };
  }

  /** The projector hands over its way to request a frame, so a newly mounted label gets positioned at once. */
  connect(requestFrame: () => void): () => void {
    this.requestFrame = requestFrame;
    requestFrame();
    return () => {
      this.requestFrame = () => {};
    };
  }

  /** The stage's free part (what the top bar, the panel or the sheet leave), and whether panning may animate. */
  setView(insets: { top: number; right: number; bottom: number }, reducedMotion: boolean, narrow: boolean) {
    this.insets = { top: insets.top, right: insets.right, bottom: insets.bottom };
    this.area = null;
    this.instant = reducedMotion;
    this.narrow = narrow;
  }

  /**
   * A company's labels' area (docs/design-hud.md, "How the HUD sits over the office"), from each edge of the stage: under
   * the caption and the map keys, left of the side panel, above the strip. Labels keep inside it, moving in at its sides
   * as far as they can while still over their person.
   */
  setArea(area: { top: number; right: number; bottom: number; left: number }, reducedMotion: boolean, narrow: boolean) {
    this.area = { top: area.top, right: area.right, bottom: area.bottom, left: area.left };
    this.insets = { top: area.top, right: area.right, bottom: area.bottom };
    this.instant = reducedMotion;
    this.narrow = narrow;
  }

  /** The rectangle a HUD piece covers (or null), so labels beneath it leave the page and the Tab order. */
  setCovered(under: Area | null) {
    const same = under === this.under || (under && this.under && under.left === this.under.left && under.top === this.under.top && under.right === this.under.right && under.bottom === this.under.bottom);
    if (same) return;
    this.under = under ? { ...under } : null;
    this.requestFrame();
  }

  /** Opens or closes a fold, such as the front desk's crowd, and places the labels again. */
  setOpen(fold: string, open: boolean) {
    if (this.open.has(fold) === open) return;
    if (open) this.open.add(fold);
    else this.open.delete(fold);
    this.requestFrame();
  }

  /** Labels are placed only while the office is the main view; off, the office screen stops running live. */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    // Each placed label holds an inline `visibility: visible`, which beats a hidden stage around it: with nothing placing
    // them any more (the feed covers a phone's office, a board has it as the mini-map), they hide themselves.
    if (!active) for (const el of this.nodes.values()) el.style.visibility = 'hidden';
    if (!active && this.live) {
      this.live = false;
      this.liveListener(false);
      this.screenAt = null;
    }
    if (active) this.requestFrame();
  }

  /** Where an anchor is in the model now (a person's middle, a fixed point); null when it isn't there. */
  worldOf(anchorId: string): Vector3 | null {
    const anchor = this.anchors.get(anchorId);
    if (!anchor) return null;
    if ('point' in anchor) return anchor.point.clone();
    anchor.object.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(anchor.object.matrixWorld);
    at.y += anchor.lift / 2;
    return at;
  }

  /**
   * Where an anchor is on the page now, against the labels' area, for Send's flight; null before the first frame or when
   * the anchor isn't in the model. `OFFICE_MIDDLE` is the trays' middle. The camera never moves for it.
   */
  reach(anchorId: string): Reach | null {
    const camera = this.camera;
    const surface = this.surface;
    if (!camera || !surface || this.stageW <= 0) return null;
    camera.updateMatrixWorld();
    const at = anchorId === OFFICE_MIDDLE ? this.middle(camera) : this.screen(anchorId, camera, this.stageW, this.stageH, false);
    if (!at) return null;
    const free = this.freeArea(this.stageW, this.stageH);
    const inside = inBox(at, free);
    const edge = inside ? at : edgeToward(free, at);
    const box = surface.getBoundingClientRect();
    return { x: box.left + at.x, y: box.top + at.y, inside, edge: { x: box.left + edge.x, y: box.top + edge.y } };
  }

  /** The middle of the office on screen: the desk trays' centre of gravity. */
  private middle(camera: Camera): { x: number; y: number } | null {
    const sum = new Vector3();
    let n = 0;
    for (const [id, anchor] of this.anchors) {
      if (!id.startsWith('tray:') || !('point' in anchor)) continue;
      sum.add(anchor.point);
      n += 1;
    }
    if (n === 0) return null;
    sum.divideScalar(n).project(camera);
    return { x: ((sum.x + 1) / 2) * this.stageW, y: ((1 - sum.y) / 2) * this.stageH };
  }

  /** Whether labels are being placed: the office is the main view. */
  get placing(): boolean {
    return this.active;
  }

  /** Tells `listener` whenever the office screen starts or stops being on camera and big enough to run the app live. */
  watchScreen(listener: (live: boolean) => void): () => void {
    this.liveListener = listener;
    if (this.live !== null) listener(this.live);
    return () => {
      this.liveListener = () => {};
    };
  }

  /** What a press on the office screen does: it opens the preview. */
  onScreenPress(press: () => void): () => void {
    this.screenPress = press;
    return () => {
      this.screenPress = () => {};
    };
  }

  /**
   * Presses on the office screen, from the element the canvas's events come from. The overlay lets the pointer through,
   * so the camera still pans and zooms over it; a press that doesn't drag opens the preview, and the mouse over it shows
   * the hand and the overlay's hover ring.
   */
  listen(target: HTMLElement): () => void {
    let down: { x: number; y: number } | null = null;
    const over = (e: PointerEvent) => {
      if (!this.screenAt) return false;
      const box = target.getBoundingClientRect();
      return onScreen({ x: e.clientX - box.left, y: e.clientY - box.top }, this.screenAt);
    };
    const press = (e: PointerEvent) => {
      down = e.isPrimary && over(e) ? { x: e.clientX, y: e.clientY } : null;
    };
    const release = (e: PointerEvent) => {
      const from = down;
      down = null;
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) < PRESS_SLOP && over(e)) this.screenPress();
    };
    const move = (e: PointerEvent) => this.hoverScreen(e.pointerType === 'mouse' && down === null && over(e));
    const leave = () => this.hoverScreen(false);
    target.addEventListener('pointerdown', press);
    target.addEventListener('pointerup', release);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerleave', leave);
    return () => {
      target.removeEventListener('pointerdown', press);
      target.removeEventListener('pointerup', release);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerleave', leave);
      this.hoverScreen(false);
    };
  }

  private hoverScreen(on: boolean) {
    if (on === this.screenHover) return;
    this.screenHover = on;
    document.body.style.cursor = on ? 'pointer' : '';
    const el = this.nodes.get(SCREEN_LABEL);
    if (el && on) el.dataset.hover = '';
    else if (el) delete el.dataset.hover;
  }

  /** A fixed point in the model as a label's anchor, placed on the next frame; returns how to take it away. */
  pin(id: string, x: number, y: number, z: number): () => void {
    this.anchors.set(id, { point: new Vector3(x, y, z) });
    this.requestFrame();
    return () => {
      this.anchors.delete(id);
    };
  }

  /** Brings a person into the free part of the stage once, with the conversation beside them when `beside`. */
  focusOn(anchor: string, beside: boolean, at: number) {
    this.focus = { anchor, beside, at };
    this.requestFrame();
  }

  /** A stable ref callback for a DOM label: `ref={store.node('room:design')}`. */
  node(id: string) {
    let ref = this.refs.get(id);
    if (!ref) {
      ref = (el: HTMLElement | null) => {
        const old = this.nodes.get(id);
        if (old && old !== el) this.observer?.unobserve(old);
        if (el) {
          this.nodes.set(id, el);
          if (kindOf(id) !== undefined || id === ASK_LABEL) {
            this.ids.set(el, id);
            this.measure(el);
          }
          this.requestFrame();
        } else {
          this.nodes.delete(id);
          this.sizes.delete(id);
          this.lifts.delete(id);
          this.shifts.delete(id);
          this.layers.delete(id);
          this.covered.delete(id);
          if (id === ASK_LABEL) this.room = '';
          if (id === SCREEN_LABEL) {
            this.screenSize = '';
            this.screenScale = '';
            this.live = null;
            this.screenAt = null;
            this.hoverScreen(false);
          }
        }
      };
      this.refs.set(id, ref);
    }
    return ref;
  }

  /** Keeps each label's size as layout last found it, so placing them never forces a layout on a frame. */
  private measure(el: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = this.ids.get(entry.target);
        const box = entry.borderBoxSize[0];
        if (id && box) this.sizes.set(id, { w: box.inlineSize, h: box.blockSize });
      }
      this.requestFrame();
    });
    this.observer.observe(el);
  }

  /** An anchor's position on screen, in pixels; null when it isn't in the model (yet). */
  private screen(anchorId: string, camera: Camera, width: number, height: number, lifted = true): { x: number; y: number } | null {
    const anchor = this.anchors.get(anchorId);
    if (!anchor) return null;
    if ('object' in anchor) {
      anchor.object.updateWorldMatrix(true, false);
      this.v.setFromMatrixPosition(anchor.object.matrixWorld);
      if (lifted) this.v.y += anchor.lift;
    } else {
      this.v.copy(anchor.point);
    }
    this.v.project(camera);
    return { x: ((this.v.x + 1) / 2) * width, y: ((1 - this.v.y) / 2) * height };
  }

  private freeArea(width: number, height: number): Area {
    const a = this.area;
    if (a) return { left: a.left, top: a.top, right: width - a.right, bottom: height - a.bottom };
    return { left: MARGIN, top: this.insets.top + MARGIN, right: width - this.insets.right - MARGIN, bottom: height - this.insets.bottom - MARGIN };
  }

  /** The conversation at its largest in this free area: it never grows past it, so it never leaves the stage. */
  private askLimit(free: Area) {
    return { w: Math.min(ASK_MAX.w, free.right - free.left), h: Math.min(ASK_MAX.h, free.bottom - free.top) };
  }

  /**
   * Moves the camera so the person asked (and their conversation) shows: once when it opens, just far enough, never
   * zooming, and at once with reduced motion. Returns true while it is still moving.
   */
  steer(camera: Camera, controls: unknown, width: number, height: number, now: number): boolean {
    if (!isOrthographic(camera) || !hasTarget(controls)) {
      this.focus = null;
      return false;
    }
    const request = this.focus;
    if (request) {
      this.focus = null;
      camera.updateMatrixWorld();
      const head = this.screen(request.anchor, camera, width, height);
      const feet = this.screen(request.anchor, camera, width, height, false);
      if (head && feet) {
        const free = this.freeArea(width, height);
        let box: Area = { left: head.x - 30, top: head.y - 8, right: head.x + 30, bottom: feet.y + 8 };
        if (request.beside) {
          // Where it would sit at its tallest if nothing held it in: both it and the person should show.
          const { want } = placeBeside(head, this.askLimit(free), free);
          box = { left: Math.min(box.left, want.left), top: Math.min(box.top, want.top), right: Math.max(box.right, want.right), bottom: Math.max(box.bottom, want.bottom) };
        }
        const { dx, dy } = shiftToShow(box, free);
        if (dx !== 0 || dy !== 0) {
          const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          // Moving the camera right moves the model left on screen, and up moves it down.
          const by = right.multiplyScalar(-dx / camera.zoom).add(up.multiplyScalar(dy / camera.zoom));
          this.pan = { from: now, camera: camera.position.clone(), target: controls.target.clone(), by };
        }
      }
    }
    const pan = this.pan;
    if (!pan) return false;
    const t = this.instant ? 1 : Math.min(1, (now - pan.from) / PAN_MS);
    const e = ease(t);
    camera.position.copy(pan.camera).addScaledVector(pan.by, e);
    controls.target.copy(pan.target).addScaledVector(pan.by, e);
    controls.update();
    if (t >= 1) this.pan = null;
    return t < 1;
  }

  project(camera: Camera, width: number, height: number) {
    if (!this.active) return;
    // Frame callbacks run before three.js updates matrices for the render, so bring them up to date here;
    // otherwise labels would trail the camera by a frame and stay there when an on-demand loop stops.
    camera.updateMatrixWorld();
    this.camera = camera;
    this.stageW = width;
    this.stageH = height;
    const boxes: LabelBox[] = [];
    for (const [id, el] of this.nodes) {
      if (id === SCREEN_LABEL) {
        this.placeScreen(el, camera, width, height);
        continue;
      }
      const ask = id === ASK_LABEL;
      const anchor = ask ? (el.dataset.anchor ?? '') : id;
      const at = this.screen(anchor, camera, width, height);
      if (!at) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      if (ask) {
        this.placeConversation(el, anchor, at, width, height);
        continue;
      }
      el.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
      const size = this.sizes.get(id);
      const kind = kindOf(id);
      if (size && kind) {
        boxes.push({ id, x: at.x, y: at.y, w: size.w, h: size.h, hang: hangOf(id), kind, rank: Number(el.dataset.rank ?? 0), depth: Number(el.dataset.depth ?? 0), ...(el.dataset.fold ? { fold: el.dataset.fold } : {}) });
      }
    }
    const area = this.area;
    const { lifts, dropped, shifts, covered, folded } = stackLabels(boxes, {
      open: this.open,
      ceiling: this.insets.top,
      maxStack: this.narrow ? PHONE_STACK : DESKTOP_STACK,
      ...(this.narrow ? {} : { exempt: ALWAYS_SHOWN }),
      // The front desk's sign stays whole above a phone's sheet (and the desktop's foot); a company's labels keep to
      // their area, clear of the side panel and the strip.
      floor: area ? height - area.bottom : height - this.insets.bottom - EDGE,
      bounds: area ? { left: area.left, right: width - area.right } : { left: EDGE, right: width - EDGE },
    });
    for (const box of boxes) {
      const shift = shifts.get(box.id) ?? 0;
      if ((this.shifts.get(box.id) ?? 0) === shift) continue;
      this.shifts.set(box.id, shift);
      this.nodes.get(box.id)?.style.setProperty('--shift', String(shift));
    }
    for (const [id, lift] of lifts) {
      if (this.lifts.get(id) === lift) continue;
      this.lifts.set(id, lift);
      this.nodes.get(id)?.style.setProperty('--lift', String(lift));
    }
    // A label holding focus never hides under it (focus would drop to the page): it stays until focus leaves.
    const focused = typeof document === 'undefined' ? null : document.activeElement;
    const holdsFocus = (el: HTMLElement | undefined) => !!el && !!focused && focused !== document.body && el.contains(focused);
    for (const id of [...dropped, ...folded]) {
      const el = this.nodes.get(id);
      if (el && !holdsFocus(el)) el.style.visibility = 'hidden';
    }
    // A company's labels keep to their area: a room sign, a gate's caption or someone's bubble that still lies outside it
    // once moved in as far as it goes (under the bar, the caption, the side panel or the strip) hides, so nothing that
    // takes focus (a sign, a waiter's bubble, the Ask on a name tag) is ever under a HUD piece. Fixed labels stay put.
    if (area) {
      for (const box of boxes) {
        if (box.kind === 'fixed') continue;
        const left = (box.hang === 'above-right' ? box.x : box.x - box.w / 2) + (shifts.get(box.id) ?? 0);
        const top = box.y - box.h - (lifts.get(box.id) ?? 0);
        const inside = left >= area.left - 1 && left + box.w <= width - area.right + 1 && top >= area.top - 1 && top + box.h <= height - area.bottom + 1;
        if (!inside) {
          const el = this.nodes.get(box.id);
          if (el && !holdsFocus(el)) el.style.visibility = 'hidden';
        }
      }
    }
    // Whatever stands over the office (the open feed) hides every label it covers, fixed ones too.
    const under = this.under;
    if (under) {
      for (const box of boxes) {
        const left = (box.hang === 'above-right' ? box.x : box.x - box.w / 2) + (shifts.get(box.id) ?? 0);
        const top = (box.hang === 'below' ? box.y : box.y - box.h) - (lifts.get(box.id) ?? 0);
        if (left < under.right && under.left < left + box.w && top < under.bottom && under.top < top + box.h) {
          const el = this.nodes.get(box.id);
          if (el && !holdsFocus(el)) el.style.visibility = 'hidden';
        }
      }
    }
    // The lower a bubble ends on screen, the higher it lies, so a line down from a bubble above never crosses its words.
    for (const box of boxes) {
      if (box.kind !== 'person') continue;
      const layer = 1000 + Math.max(0, Math.min(999, Math.round((box.y - (lifts.get(box.id) ?? 0)) / 4)));
      if (this.layers.get(box.id) === layer) continue;
      this.layers.set(box.id, layer);
      this.nodes.get(box.id)?.style.setProperty('--layer', String(layer));
    }
    for (const box of boxes) {
      if (box.kind !== 'sign' || covered.has(box.id) === this.covered.has(box.id)) continue;
      const el = this.nodes.get(box.id);
      if (covered.has(box.id)) {
        this.covered.add(box.id);
        if (el) el.dataset.covered = '';
      } else {
        this.covered.delete(box.id);
        if (el) delete el.dataset.covered;
      }
    }
  }

  /**
   * The office screen's overlay, laid exactly over the screen's face from its four corners (the camera is
   * orthographic, so the face is a parallelogram and three corners fix it). Whether it may run the app live is told to
   * the listener only when that changes.
   */
  private placeScreen(el: HTMLElement, camera: Camera, width: number, height: number) {
    const [tl, tr, br, bl] = SCREEN_CORNERS.map((c) => this.screen(`screen:${c}`, camera, width, height, false));
    const world = SCREEN_CORNERS.map((c) => this.anchors.get(`screen:${c}`));
    const [wtl, wtr, , wbl] = world.map((a) => (a && 'point' in a ? a.point : null));
    // Turned away from the camera (orbiting past the wall's side), the face would draw mirrored: the 3D screen's back shows.
    if (!tl || !tr || !br || !bl || !wtl || !wtr || !wbl || !facesCamera({ topLeft: tl, topRight: tr, bottomLeft: bl })) {
      el.style.visibility = 'hidden';
      this.screenAt = null;
      if (this.live) {
        this.live = false;
        this.liveListener(false);
      }
      return;
    }
    const w = SCREEN_BASE_W;
    const h = Math.round((w * wtl.distanceTo(wbl)) / Math.max(1e-6, wtl.distanceTo(wtr)));
    const size = `${w}x${h}`;
    if (size !== this.screenSize) {
      this.screenSize = size;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
    const corners: ScreenCorners = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
    el.style.transform = overlayMatrix(corners, w, h);
    const under = this.under;
    const xs = [tl.x, tr.x, br.x, bl.x];
    const ys = [tl.y, tr.y, br.y, bl.y];
    const hit = !!under && Math.min(...xs) < under.right && under.left < Math.max(...xs) && Math.min(...ys) < under.bottom && under.top < Math.max(...ys);
    el.style.visibility = hit && !el.contains(document.activeElement) ? 'hidden' : 'visible';
    this.screenAt = corners;
    // How much the overlay is shrunk, so its focus ring can stay as thick on screen as anywhere else (labels.css).
    const scale = (Math.hypot(tr.x - tl.x, tr.y - tl.y) / w).toFixed(2);
    if (scale !== this.screenScale) {
      this.screenScale = scale;
      el.style.setProperty('--screen-scale', scale);
    }
    const live = screenLive(corners, this.freeArea(width, height), this.narrow);
    if (live !== this.live) {
      this.live = live;
      this.liveListener(live);
    }
  }

  /** Beside its person and kept on the stage, clear of their label: if you pan away, it follows them to the edge. */
  private placeConversation(el: HTMLElement, anchor: string, foot: { x: number; y: number }, width: number, height: number) {
    const last = this.side?.anchor === anchor ? this.side : null;
    const free = this.freeArea(width, height);
    const limit = this.askLimit(free);
    const room = `${Math.floor(limit.w)}px ${Math.floor(limit.h)}px`;
    if (room !== this.room) {
      this.room = room;
      el.style.setProperty('--room-w', `${Math.floor(limit.w)}px`);
      el.style.setProperty('--room', `${Math.floor(limit.h)}px`);
    }
    // Their name tag and bubble, where the last frame left them.
    const own = this.sizes.get(anchor);
    const lift = this.lifts.get(anchor) ?? 0;
    const label = own ? { left: foot.x - own.w / 2, top: foot.y - own.h - lift, right: foot.x + own.w / 2, bottom: foot.y - lift } : null;
    const placed = placeBeside(foot, this.sizes.get(ASK_LABEL) ?? limit, free, last?.side ?? null, 28, label);
    el.style.transform = `translate3d(${placed.left.toFixed(1)}px, ${placed.top.toFixed(1)}px, 0)`;
    if (el.dataset.placed === undefined) el.dataset.placed = '';
    if (last?.side !== placed.side) el.dataset.side = placed.side;
    const tail = placed.tail === null ? null : Math.round(placed.tail);
    if (!last || last.tail !== tail) {
      if (tail === null) el.dataset.tail = 'hidden';
      else {
        delete el.dataset.tail;
        el.style.setProperty('--tail-y', `${tail}px`);
      }
    }
    this.side = { anchor, side: placed.side, tail };
  }
}

export const LabelContext = createContext<LabelStore | null>(null);

/** Registers a fixed point in the model as the anchor for a label. */
export function useFixedAnchor(id: string, x: number, y: number, z: number) {
  const store = useContext(LabelContext);
  useEffect(() => {
    if (!store) return;
    store.anchors.set(id, { point: new Vector3(x, y, z) });
    return () => {
      store.anchors.delete(id);
    };
  }, [store, id, x, y, z]);
}

/** Registers a moving object (held by `ref`) as the anchor for a label. */
export function useObjectAnchor(ref: RefObject<Object3D | null>, id: string, lift: number) {
  const store = useContext(LabelContext);
  useEffect(() => {
    const object = ref.current;
    if (!store || !object) return;
    store.anchors.set(id, { object, lift });
    return () => {
      store.anchors.delete(id);
    };
  }, [store, ref, id, lift]);
}

/** Inside the canvas: moves every label after each rendered frame, so they follow the camera and walking people. */
export function LabelProjector({ store }: { store: LabelStore }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => store.connect(invalidate), [store, invalidate]);
  const surface = useThree((s) => s.gl.domElement);
  useEffect(() => store.drawnIn(surface), [store, surface]);
  // Presses on the office screen come from where the canvas's events do: the controls capture the pointer there.
  const connected = useThree((s): unknown => s.events.connected);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => store.listen(connected instanceof HTMLElement ? connected : canvas), [store, connected, canvas]);
  // Priority 0: after the controls move the camera, and without taking over rendering (positive priorities do).
  useFrame(({ camera, controls }) => {
    if (!store.placing) return;
    if (store.steer(camera, controls, size.width, size.height, performance.now())) invalidate();
    store.project(camera, size.width, size.height);
  });
  return null;
}
