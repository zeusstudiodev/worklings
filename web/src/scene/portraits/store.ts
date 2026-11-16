// Baked portraits, by person: an object URL of the PNG for the look they wear now. The faces read it (Face.tsx through
// usePortrait), the baker fills it. A new look replaces the picture and revokes the old URL; a person who leaves, or the
// stage going away, revokes theirs, so nothing leaks while the office runs for days.
import type { Dress } from '../people/dress.ts';

/** What makes two looks the same picture: body, colours and the prop worn on the head (not their pace or phase). */
export function dressKey(dress: Pick<Dress, 'body' | 'outfit' | 'prop'>): string {
  return JSON.stringify([dress.body, dress.outfit, dress.prop]);
}

export class PortraitStore {
  private readonly entries = new Map<string, { dress: string; url: string }>();
  private readonly listeners = new Set<() => void>();
  private readonly revoke: (url: string) => void;

  constructor(revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {
    this.revoke = revoke;
  }

  /** The picture of someone's current look, or null until it is baked. */
  urlOf(person: string): string | null {
    return this.entries.get(person)?.url ?? null;
  }

  /** Whether that look is baked already. */
  has(person: string, dress: string): boolean {
    return this.entries.get(person)?.dress === dress;
  }

  set(person: string, dress: string, url: string): void {
    const old = this.entries.get(person);
    if (old && old.url !== url) this.revoke(old.url);
    this.entries.set(person, { dress, url });
    this.emit();
  }

  /** Keeps only these people; the rest are revoked. */
  retain(people: ReadonlySet<string>): void {
    let changed = false;
    for (const [person, entry] of this.entries) {
      if (people.has(person)) continue;
      this.revoke(entry.url);
      this.entries.delete(person);
      changed = true;
    }
    if (changed) this.emit();
  }

  clear(): void {
    this.retain(new Set());
  }

  get size(): number {
    return this.entries.size;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The one store of the page: faces anywhere read it, the stage's baker fills it. */
export const portraits = new PortraitStore();
