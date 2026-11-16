// Portfolios (SPEC-v0.3.md, S1): groups of companies with a shared budget and an optional shared brief, kept in the hub's
// own folder (~/.worklings/portfolios.json), outside every project. A company is in at most one. Changes are checked here
// and refused with a sentence (OrgRefusal), which the hub sends as it is.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgRefusal } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import { cleanBudget } from '../core/spending.ts';
import { slugId } from '../core/studio.ts';
import { type Portfolio, STUDIO_LIMITS } from './model.ts';

export const PORTFOLIOS_FILE = 'portfolios.json';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a new portfolio or a change to one may say; every field is checked before anything is kept. */
export interface PortfolioInput {
  name?: unknown;
  companies?: unknown;
  budget?: unknown;
  brief?: unknown;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new OrgRefusal('invalid', 'Give the portfolio a name.');
  const name = value.replace(/\s+/g, ' ').trim();
  if (name === '') throw new OrgRefusal('invalid', 'Give the portfolio a name.');
  if (name.length > STUDIO_LIMITS.name) throw new OrgRefusal('invalid', `Keep the name to ${STUDIO_LIMITS.name} characters.`);
  return name;
}

function cleanBrief(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new OrgRefusal('invalid', 'The shared brief is text.');
  const brief = value.replace(/\r\n?/g, '\n').trim();
  if (brief.length > STUDIO_LIMITS.brief) throw new OrgRefusal('invalid', `Keep the shared brief to ${STUDIO_LIMITS.brief.toLocaleString('en-US')} characters.`);
  return brief === '' ? null : brief;
}

function cleanCap(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cap = cleanBudget(value);
  if (cap === null) throw new OrgRefusal('invalid', 'A budget is a dollar amount from $0.01 to $1,000,000, or none.');
  return cap;
}

function cleanMembers(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OrgRefusal('invalid', 'Send the companies as a list.');
  if (value.length > STUDIO_LIMITS.members) throw new OrgRefusal('invalid', `A portfolio holds up to ${STUDIO_LIMITS.members} companies.`);
  const ids = value.map((v: unknown) => {
    const id = safeId(v);
    if (id === undefined) throw new OrgRefusal('invalid', "The companies list holds something that isn't a company's id.");
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new OrgRefusal('invalid', 'The companies list names one company twice.');
  return ids;
}

/** One portfolio as the file holds it, or null when it can't be read back as one. */
function readOne(raw: unknown): Portfolio | null {
  if (!isObj(raw)) return null;
  try {
    const id = safeId(raw.id);
    if (id === undefined || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
    return { id, name: cleanName(raw.name), companies: cleanMembers(raw.companies), budget: cleanCap(raw.budget), brief: cleanBrief(raw.brief), createdAt: raw.createdAt };
  } catch {
    return null;
  }
}

/**
 * The portfolios in the hub's folder. Each change is written at once (atomically), so a restart reads what the lobby
 * showed. A file that can't be read leaves the lobby with no portfolios and a warning; it is only replaced on a change.
 */
export class PortfolioStore {
  private list: Portfolio[] = [];
  private readonly file: string;
  private readonly now: () => number;

  constructor(dir: string, o: { now?: () => number; warn?: (line: string) => void } = {}) {
    this.file = join(dir, PORTFOLIOS_FILE);
    this.now = o.now ?? Date.now;
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const items = isObj(raw) && Array.isArray(raw.portfolios) ? raw.portfolios : [];
      const seen = new Set<string>();
      for (const item of items) {
        const p = readOne(item);
        if (!p || this.list.some((q) => q.id === p.id)) continue;
        // A company in two portfolios (a hand edit) stays in the first.
        p.companies = p.companies.filter((c) => !seen.has(c));
        for (const c of p.companies) seen.add(c);
        this.list.push(p);
      }
    } catch (error) {
      o.warn?.(`couldn't read ${this.file}, so the lobby has no portfolios until it changes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  all(): Portfolio[] {
    return this.list.map((p) => ({ ...p, companies: [...p.companies] }));
  }

  get(id: string): Portfolio | undefined {
    const p = this.list.find((x) => x.id === id);
    return p ? { ...p, companies: [...p.companies] } : undefined;
  }

  /** The portfolio a company is in. */
  of(company: string): Portfolio | undefined {
    const p = this.list.find((x) => x.companies.includes(company));
    return p ? this.get(p.id) : undefined;
  }

  /**
   * A new portfolio. `known` says whether a company id is in the lobby and gives its name, for the refusals; a company
   * already in another portfolio is refused, never moved without being asked.
   */
  create(input: PortfolioInput, known: (id: string) => string | null): Portfolio {
    if (this.list.length >= STUDIO_LIMITS.portfolios) throw new OrgRefusal('conflict', `The lobby holds up to ${STUDIO_LIMITS.portfolios} portfolios.`);
    const name = cleanName(input.name);
    if (this.list.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new OrgRefusal('conflict', `There's a portfolio called ${name} already. Pick another name.`);
    const companies = this.checkMembers(cleanMembers(input.companies), null, known);
    const p: Portfolio = { id: this.newId(name), name, companies, budget: cleanCap(input.budget), brief: cleanBrief(input.brief), createdAt: this.now() };
    this.list.push(p);
    this.save();
    return this.get(p.id) as Portfolio;
  }

  /** Changes the fields given; `companies` replaces the list. */
  update(id: string, input: PortfolioInput, known: (id: string) => string | null): Portfolio {
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new OrgRefusal('unknown', "That portfolio isn't in the lobby any more.");
    const next: Portfolio = { ...p, companies: [...p.companies] };
    if (input.name !== undefined) {
      next.name = cleanName(input.name);
      if (this.list.some((q) => q.id !== id && q.name.toLowerCase() === next.name.toLowerCase())) throw new OrgRefusal('conflict', `There's a portfolio called ${next.name} already. Pick another name.`);
    }
    if (input.companies !== undefined) next.companies = this.checkMembers(cleanMembers(input.companies), id, known, p.companies);
    if (input.budget !== undefined) next.budget = cleanCap(input.budget);
    if (input.brief !== undefined) next.brief = cleanBrief(input.brief);
    Object.assign(p, next);
    this.save();
    return this.get(id) as Portfolio;
  }

  remove(id: string): Portfolio {
    const p = this.get(id);
    if (!p) throw new OrgRefusal('unknown', "That portfolio isn't in the lobby any more.");
    this.list = this.list.filter((x) => x.id !== id);
    this.save();
    return p;
  }

  /** A company that left the lobby leaves its portfolio too. */
  forget(company: string): void {
    const p = this.list.find((x) => x.companies.includes(company));
    if (!p) return;
    p.companies = p.companies.filter((c) => c !== company);
    this.save();
  }

  private checkMembers(ids: string[], self: string | null, known: (id: string) => string | null, already: readonly string[] = []): string[] {
    for (const id of ids) {
      // A member that has since left the lobby may stay listed until it is taken out; a new one must be there.
      const name = known(id);
      if (name === null && !already.includes(id)) throw new OrgRefusal('unknown', "One of those companies isn't in the lobby any more.");
      const other = this.list.find((p) => p.id !== self && p.companies.includes(id));
      if (other) throw new OrgRefusal('conflict', `${name ?? 'That company'} is in the ${other.name} portfolio already. Take it out there first.`);
    }
    return ids;
  }

  private newId(name: string): string {
    const base = `p-${slugId(name.normalize('NFD').replace(/\p{M}/gu, ''), 40) || 'portfolio'}`;
    let id = base;
    for (let n = 2; this.list.some((p) => p.id === id); n += 1) id = `${base}-${n}`;
    return id;
  }

  private save(): void {
    const text = `${JSON.stringify({ version: 1, portfolios: this.list }, null, 2)}\n`;
    const temp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    try {
      renameSync(temp, this.file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
}
