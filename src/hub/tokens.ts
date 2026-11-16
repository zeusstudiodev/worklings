// The desk-token table: one token per open desk, so every org-tools call and every hook a desk makes is tied to one
// person of one company. Tokens live in memory only (a restarted hub issues new ones as desks reopen) and reach a desk
// through its environment, never a command line or a file in the project.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface DeskSeat {
  /** The hub's key for the company the desk works for. */
  companyId: string;
  person: string;
  /** The desk's checkout or worktree, when the switchboard said; null for the project's own folder. */
  cwd: string | null;
  /** The desk's own scratch folder (its TMP, TEMP and TMPDIR), where the approvals policy lets it work freely; null when it has none. */
  scratch: string | null;
}

/** 32 random bytes as 64 hex characters: what `issue` makes, so anything else is refused before any lookup. */
const TOKEN = /^[0-9a-f]{64}$/;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class DeskTokens {
  /** Keyed by the token's SHA-256, so a lookup's timing says nothing about the token; the token is compared after. */
  private readonly seats = new Map<string, { token: Buffer; seat: DeskSeat }>();

  issue(companyId: string, person: string, cwd: string | null = null, scratch: string | null = null): string {
    const token = randomBytes(32).toString('hex');
    this.seats.set(digest(token), { token: Buffer.from(token), seat: { companyId, person, cwd, scratch } });
    return token;
  }

  /** The desk a token belongs to, or null for a missing, malformed, unknown or revoked one. */
  resolve(token: string | null | undefined): DeskSeat | null {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const entry = this.seats.get(digest(token));
    if (!entry || !timingSafeEqual(entry.token, Buffer.from(token))) return null;
    return { ...entry.seat };
  }

  revoke(token: string): boolean {
    return typeof token === 'string' && TOKEN.test(token) && this.seats.delete(digest(token));
  }

  /** The desks a company has open now: one per token, with the person and the folder each works in. */
  desksOf(companyId: string): DeskSeat[] {
    const desks: DeskSeat[] = [];
    for (const { seat } of this.seats.values()) if (seat.companyId === companyId) desks.push({ ...seat });
    return desks;
  }

  /** Drops every token of a company, when it closes or leaves the lobby. Returns how many there were. */
  revokeCompany(companyId: string): number {
    let count = 0;
    for (const [key, entry] of this.seats) {
      if (entry.seat.companyId !== companyId) continue;
      this.seats.delete(key);
      count += 1;
    }
    return count;
  }

  get size(): number {
    return this.seats.size;
  }
}
