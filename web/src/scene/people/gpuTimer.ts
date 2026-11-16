// GPU time per drawn frame for the frame governor (people/governor.ts), from EXT_disjoint_timer_query_webgl2 where the
// browser has it (Chrome and Edge do; Safari doesn't, and the governor's window rule covers it there). One timer query
// brackets everything R3F draws in a frame, from its global effects before the roots render to those after; results
// come back a frame or two later and are read when the next frame starts.

/** The extension's two names this needs. */
interface TimerQuery {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** R3F's addEffect or addAfterEffect: runs a callback every loop iteration, returns its removal. */
export type FrameHook = (callback: (timestamp: number) => void) => () => void;

/** A WebGL query object, as the timer holds it. */
type Query = object;

/** The part of a WebGL 2 context the timer uses (written out, so the tests' Node typecheck needs no DOM types). */
export interface TimerContext {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  getExtension(name: string): unknown;
  createQuery(): Query | null;
  beginQuery(target: number, query: Query): void;
  endQuery(target: number): void;
  deleteQuery(query: Query | null): void;
  getQueryParameter(query: Query, name: number): unknown;
  getParameter(name: number): unknown;
}

/** WebGL 2 has timer queries to offer; WebGL 1 has no createQuery. */
const isTimerContext = (gl: object): gl is TimerContext => 'createQuery' in gl && 'getQueryParameter' in gl;

/** Results still out beyond this many: the GPU is far behind, so no new query until they come back. */
export const MAX_PENDING = 4;

export class GpuTimer {
  private readonly before: FrameHook;
  private readonly after: FrameHook;
  private gl: TimerContext | null = null;
  private ext: TimerQuery | null = null;
  private active: Query | null = null;
  private pending: Query[] = [];
  private newest: number | null = null;
  private stops: (() => void)[] = [];

  constructor(before: FrameHook, after: FrameHook) {
    this.before = before;
    this.after = after;
  }

  /** Times the frames drawn on this context from now on. False when it isn't WebGL 2 or can't time the GPU. */
  attach(gl: object): boolean {
    this.detach();
    if (!isTimerContext(gl)) return false;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
    if (!ext) return false;
    this.gl = gl;
    this.ext = ext;
    this.stops = [this.before(() => this.begin()), this.after(() => this.end())];
    return true;
  }

  /** GPU milliseconds of the newest frame measured since the last call; null when none came back. */
  take(): number | null {
    this.collect();
    const ms = this.newest;
    this.newest = null;
    return ms;
  }

  detach(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
    const { gl, ext } = this;
    if (gl && ext && this.active) gl.endQuery(ext.TIME_ELAPSED_EXT);
    if (gl) for (const query of this.active ? [...this.pending, this.active] : this.pending) gl.deleteQuery(query);
    this.pending = [];
    this.active = null;
    this.gl = null;
    this.ext = null;
    this.newest = null;
  }

  private begin(): void {
    const { gl, ext } = this;
    if (!gl || !ext || this.active) return;
    if (this.pending.length >= MAX_PENDING) this.collect();
    if (this.pending.length >= MAX_PENDING) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  private end(): void {
    const { gl, ext, active } = this;
    if (!gl || !ext || !active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(active);
    this.active = null;
  }

  /**
   * Reads the results that are back, oldest first. A disjoint GPU (a clock change, a context switch) voids them; the
   * flag is read once results are available, as the extension asks, and only then, since each read waits on the GPU's
   * process.
   */
  private collect(): void {
    const { gl, ext } = this;
    if (!gl || !ext) return;
    let disjoint: boolean | null = null;
    while (this.pending.length > 0) {
      const query = this.pending[0] as Query;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      disjoint ??= Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
      this.pending.shift();
      if (!disjoint) this.newest = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
      gl.deleteQuery(query);
    }
  }
}
