// Bakes portraits with the office's own renderer: one 128 x 128 render target, one rig per body (the bodies the crowd
// already loaded, dressed for the person), a head-and-shoulders camera and the office's light. A few per animation frame
// while nothing is being dragged or panned; the read-back is asynchronous (a pixel buffer and a fence), so the GPU is
// never waited on. The target is an sRGB one, so the GPU encodes the colours the way the canvas does.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { loadBody, loadClips } from '../art/loader.ts';
import type { BodyDetail } from '../art/spec.ts';
import type { Dress } from '../people/dress.ts';
import { PropKit } from '../people/props.ts';
import { PEOPLE_LAYER, PersonRig } from '../people/rig.ts';
import { imagePixels, PORTRAIT_PX, portraitFrame } from './frame.ts';
import { dressKey, type PortraitStore } from './store.ts';

/** A tick bakes until it has used this much of the frame (at least one), and never more than MOST. */
const BUDGET_MS = 3;
const MOST = 3;
/** Turned a little toward the key light, so the face has a lit side. */
const YAW = -0.28;
/** The office's light (Stage.tsx's Lights), from the front: a warm key high on the left, a cool fill, the sky's hemisphere. */
const KEY = { colour: '#FFE3BE', intensity: 3.0, at: new Vector3(-0.55, 0.75, 0.9) };
const FILL = { colour: '#CFE0F4', intensity: 0.32, at: new Vector3(0.9, 0.25, 0.5) };
const SKY = { sky: '#FFF0DA', ground: '#4E6A5C', intensity: 0.82 };

export interface Want {
  person: string;
  dress: Dress;
}

interface Job extends Want {
  key: string;
}

const scratch = new Color();

export class PortraitBaker {
  private readonly renderer: WebGLRenderer;
  private readonly detail: BodyDetail;
  private readonly store: PortraitStore;
  private readonly busy: () => boolean;
  private readonly target = new WebGLRenderTarget(PORTRAIT_PX, PORTRAIT_PX, { type: UnsignedByteType, format: RGBAFormat, samples: 4 });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  private readonly props = new PropKit();
  private readonly rigs = new Map<string, PersonRig>();
  private readonly loading = new Set<string>();
  private readonly canvas = document.createElement('canvas');
  /** Who is wanted, by person: the newest look wins over whatever is still queued or being read. */
  private wanted = new Map<string, Job>();
  private queue: Job[] = [];
  private readonly failed = new Map<string, string>();
  private frame: number | null = null;
  private alive = true;
  private shown: PersonRig | null = null;
  private clipsReady = false;
  /** Bodies whose file failed to load, and whether the animation clips did: asked for once, never again (the faces keep their initials). */
  private readonly failedBodies = new Set<string>();
  private clipsFailed = false;

  constructor(renderer: WebGLRenderer, detail: BodyDetail, store: PortraitStore, busy: () => boolean) {
    this.renderer = renderer;
    this.detail = detail;
    this.store = store;
    this.busy = busy;
    this.target.texture.colorSpace = SRGBColorSpace;
    this.canvas.width = PORTRAIT_PX;
    this.canvas.height = PORTRAIT_PX;
    this.camera.layers.enable(PEOPLE_LAYER);
    const sky = new HemisphereLight(SKY.sky, SKY.ground, SKY.intensity);
    const key = new DirectionalLight(KEY.colour, KEY.intensity);
    key.position.copy(KEY.at).multiplyScalar(10);
    const fill = new DirectionalLight(FILL.colour, FILL.intensity);
    fill.position.copy(FILL.at).multiplyScalar(10);
    this.scene.add(sky, key, fill, key.target, fill.target);
    loadClips().then(
      () => {
        this.clipsReady = true;
        this.schedule();
      },
      (error: unknown) => {
        // Nothing can be drawn without the clips: give up the queue, so no frame is scheduled for it.
        this.clipsFailed = true;
        this.queue = [];
        console.warn('Worklings: portraits could not load their animations; faces keep their initials.', error);
      },
    );
  }

  /** The people to have a portrait of, in the order to bake them; anyone not listed is dropped (the store forgets them). */
  want(people: readonly Want[]): void {
    if (!this.alive) return;
    const next = new Map<string, Job>();
    for (const p of people) next.set(p.person, { ...p, key: dressKey(p.dress) });
    this.wanted = next;
    this.store.retain(new Set(next.keys()));
    this.queue = this.clipsFailed ? [] : [...next.values()].filter((j) => !this.store.has(j.person, j.key) && this.failed.get(j.person) !== j.key && !this.failedBodies.has(j.dress.body));
    this.schedule();
  }

  private schedule(): void {
    // Until the clips are in nothing can be baked, and the clips' arrival schedules the first tick: no frame loop waits for them.
    if (!this.alive || !this.clipsReady || this.frame !== null || this.queue.length === 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.tick();
    });
  }

  private tick(): void {
    if (!this.alive) return;
    // Never during a drag or a pan: the frame is theirs.
    if (!this.busy() && this.clipsReady) {
      const started = performance.now();
      let done = 0;
      for (let i = 0; i < this.queue.length && done < MOST; ) {
        const job = this.queue[i];
        if (!job) break;
        const rig = this.rigFor(job.dress);
        if (!rig) {
          i++;
          continue;
        }
        this.queue.splice(i, 1);
        this.bake(job, rig);
        done++;
        if (performance.now() - started > BUDGET_MS) break;
      }
      if (done > 0) performance.measure('portraits:tick', { start: started, end: performance.now() });
    }
    this.schedule();
  }

  /** The rig of a body, once its file is in: the crowd asked for the same one, so it is the same download. */
  private rigFor(dress: Dress): PersonRig | null {
    const id = dress.body;
    const made = this.rigs.get(id);
    if (made) return made;
    if (this.loading.has(id) || this.failedBodies.has(id)) return null;
    this.loading.add(id);
    Promise.all([loadBody(id, this.detail), loadClips()]).then(
      ([body, clips]) => {
        this.loading.delete(id);
        if (!this.alive) return;
        const rig = new PersonRig(body, clips, dress, 0, this.props);
        // Standing, arms down: Idle_A's first frame.
        rig.play({ base: { clip: 'Idle_A', mode: 'still', at: 0, elapsed: 0, timeScale: 1, weight: 1 }, layers: [], seated: false, holding: 'none', live: false }, 0);
        rig.root.rotation.y = YAW;
        this.rigs.set(id, rig);
        this.schedule();
      },
      (error: unknown) => {
        this.loading.delete(id);
        console.warn('Worklings: a portrait could not load its body.', error);
        // Once, not on every frame: the people who need this body keep their initials.
        this.failedBodies.add(id);
        const stuck = this.queue.filter((j) => j.dress.body === id);
        this.queue = this.queue.filter((j) => j.dress.body !== id);
        for (const j of stuck) this.fail(j, error);
      },
    );
    return null;
  }

  /** Dresses, frames and draws one portrait, and starts reading it back; the picture is stored when the read is done. */
  private bake(job: Job, rig: PersonRig): void {
    try {
      rig.dress(job.dress, 0);
      if (this.shown !== rig) {
        if (this.shown) this.scene.remove(this.shown.root);
        this.scene.add(rig.root);
        this.shown = rig;
      }
      rig.tick(0);
      rig.root.updateMatrixWorld(true);
      const head = rig.root.getObjectByName('head')?.getWorldPosition(new Vector3()) ?? new Vector3(0, 1.23, 0);
      const f = portraitFrame(head);
      const cam = this.camera;
      cam.left = f.x - f.half;
      cam.right = f.x + f.half;
      cam.top = f.y + f.half;
      cam.bottom = f.y - f.half;
      cam.position.set(f.x, f.y, head.z + 6);
      cam.lookAt(f.x, f.y, head.z);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();

      const gl = this.renderer;
      const alpha = gl.getClearAlpha();
      gl.getClearColor(scratch);
      const was = scratch.getHex();
      gl.setClearColor(0x000000, 0);
      gl.setRenderTarget(this.target);
      gl.render(this.scene, cam);
      gl.setRenderTarget(null);
      gl.setClearColor(was, alpha);

      // A buffer of its own per read: they finish out of step with the next bake.
      const pixels = new Uint8Array(PORTRAIT_PX * PORTRAIT_PX * 4);
      gl.readRenderTargetPixelsAsync(this.target, 0, 0, PORTRAIT_PX, PORTRAIT_PX, pixels).then(
        () => this.finish(job, pixels),
        (error: unknown) => this.fail(job, error),
      );
    } catch (error) {
      this.fail(job, error);
    }
  }

  private finish(job: Job, pixels: Uint8Array): void {
    if (!this.alive || this.wanted.get(job.person)?.key !== job.key) return;
    const started = performance.now();
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return this.fail(job, new Error('no 2D canvas'));
    ctx.putImageData(new ImageData(imagePixels(pixels, PORTRAIT_PX), PORTRAIT_PX, PORTRAIT_PX), 0, 0);
    this.canvas.toBlob((blob) => {
      if (!blob) return this.fail(job, new Error('no PNG'));
      // Someone changed look, or left, while the PNG was made: it is already stale.
      if (!this.alive || this.wanted.get(job.person)?.key !== job.key) return;
      this.store.set(job.person, job.key, URL.createObjectURL(blob));
    }, 'image/png');
    performance.measure('portraits:finish', { start: started, end: performance.now() });
  }

  private fail(job: Job, error: unknown): void {
    if (this.failed.size === 0) console.warn('Worklings: a portrait could not be drawn; faces keep their initials.', error);
    this.failed.set(job.person, job.key);
  }

  dispose(): void {
    this.alive = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const rig of this.rigs.values()) rig.dispose();
    this.rigs.clear();
    this.props.dispose();
    this.target.dispose();
    this.store.clear();
  }
}
