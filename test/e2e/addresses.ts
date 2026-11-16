// Where every server of the suite listens. The ports are chosen when the first thing loads this file (playwright.config.ts
// does, in the process that runs the suite) by asking the system for free ones, so the suite never collides with another
// project's server or another run; they go to the workers through the environment, as E2E_TOKEN does, so every worker
// agrees. Specs read their addresses here, never a literal 127.0.0.1:43xx.
import { execFileSync } from 'node:child_process';

export interface Ports {
  /** The built-in demo office. */
  demo: number;
  /** The live office of the generated web-app project, with the fake Claude Code. */
  live: number;
  /** The office of an empty folder. */
  empty: number;
  /** The office of a 50-person studio. */
  big: number;
  /** v3's hub, and the hub the usage-limit spec has to itself. */
  hub: number;
  restHub: number;
  /** v0.7: a hub that founds plain jobs (one Claude Code session), Worklings' default. */
  plainHub: number;
  /** The fake dev app the preview spec starts through the project's dev script. */
  devApp: number;
}

const NAMES: readonly (keyof Ports)[] = ['demo', 'live', 'empty', 'big', 'hub', 'restHub', 'plainHub', 'devApp'];
const VARIABLE = 'E2E_PORTS';

/** Binds `count` ports on 127.0.0.1 at once (so they differ), reads them and lets go: the system hands out free ones. */
function probe(count: number): number[] {
  const script = `
    const net = require('node:net');
    const servers = Array.from({ length: ${count} }, () => net.createServer());
    Promise.all(servers.map((s) => new Promise((ok, fail) => s.once('error', fail).listen(0, '127.0.0.1', () => ok(s.address().port)))))
      .then((ports) => { console.log(JSON.stringify(ports)); servers.forEach((s) => s.close()); });
  `;
  const ports: unknown = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
  if (!Array.isArray(ports) || ports.length !== count || !ports.every((p) => Number.isInteger(p))) throw new Error('Could not find free ports for the e2e servers.');
  return ports as number[];
}

let cached: Ports | null = null;

export function ports(): Ports {
  if (cached) return cached;
  const given = process.env[VARIABLE];
  if (given) {
    cached = JSON.parse(given) as Ports;
  } else {
    const found = probe(NAMES.length);
    cached = Object.fromEntries(NAMES.map((name, i) => [name, found[i]])) as unknown as Ports;
    process.env[VARIABLE] = JSON.stringify(cached);
  }
  return cached;
}

export const origin = (port: number): string => `http://127.0.0.1:${port}`;
export const DEMO = origin(ports().demo);
export const LIVE = origin(ports().live);
export const EMPTY = origin(ports().empty);
export const BIG = origin(ports().big);
