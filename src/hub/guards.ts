// Who may reach which of the hub's routes. The hub listens on loopback only, on two ports. The local port has
// everything; with --tailnet a second port, the one `tailscale serve` proxies to, has only the office's pages, streams
// and API. Tailscale passes the phone's own Host header through, so a Host proves nothing about where a request comes
// from: intake (hooks, telemetry, the org tools, the desks) and the folder browser exist only on the local port, and
// refuse anything forwarded (Tailscale always adds X-Forwarded-For) besides needing a loopback socket and Host.
import type { IncomingMessage } from 'node:http';
import { fromThisMachine, HttpError, loopbackHost } from '../server/http.ts';

/** The tailnet address the hub is served on, with --tailnet. */
export interface TailnetAddress {
  /** The Host headers browsers send for it, lowercase: the name, alone and with :443. */
  hosts: string[];
  /** https://host, as browsers send it in Origin. */
  origin: string;
}

export function tailnetAddress(host: string, url: string): TailnetAddress {
  const parsed = new URL(url);
  const names = [host.trim().toLowerCase().replace(/\.$/, ''), parsed.hostname.toLowerCase()].filter(Boolean);
  const hosts = [...names, ...names.map((n) => `${n}:443`), parsed.host.toLowerCase()];
  return { hosts: [...new Set(hosts)], origin: parsed.origin.toLowerCase() };
}

/** Which of the hub's two ports a request came in on. */
export type Side = { kind: 'local' } | { kind: 'tailnet'; address: TailnetAddress | null };

/** Headers a proxy adds (tailscale serve among them): a request that carries one came from elsewhere. */
const FORWARDING = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-funnel-request'];

export const forwarded = (req: IncomingMessage): boolean => FORWARDING.some((h) => req.headers[h] !== undefined);

const hostHeader = (req: IncomingMessage) => (req.headers.host ?? '').toLowerCase();

/**
 * A Host the port answers to: this machine's names on the local port, the tailnet's name on the tailnet's. Anything
 * else is DNS rebinding, or a request that came the wrong way.
 */
export function knownHost(req: IncomingMessage, side: Side): boolean {
  if (side.kind === 'local') return loopbackHost(req);
  return side.address !== null && side.address.hosts.includes(hostHeader(req));
}

/** Browsers send Origin on cross-site requests; only the hub's own pages may pass, over http locally, https on the tailnet. */
export function sameOrigin(req: IncomingMessage, side: Side): boolean {
  const origin = req.headers.origin?.toLowerCase();
  if (origin === undefined) return true;
  if (side.kind === 'local') return origin === `http://${hostHeader(req)}`;
  return side.address !== null && origin === side.address.origin;
}

/** True for a request made on this machine to a loopback address, not forwarded from the tailnet or anywhere else. */
export const fromHere = (req: IncomingMessage): boolean => fromThisMachine(req.socket.remoteAddress) && loopbackHost(req) && !forwarded(req);

/** Hooks, telemetry and the desks: Claude Code on this machine, which sends no Origin. */
export function intakeOnly(req: IncomingMessage) {
  if (!fromHere(req) || req.headers.origin !== undefined) throw new HttpError(403, 'The hub takes this only from Claude Code on this machine.', { code: 'local-only' });
}

/** Routes that touch this machine's folders: never from the tailnet. */
export function localOnly(req: IncomingMessage, message: string) {
  if (!fromHere(req)) throw new HttpError(403, message, { code: 'local-only' });
}
