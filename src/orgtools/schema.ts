// The org tools' inputs. Each tool declares its fields once: the declaration is both the JSON Schema that tools/list
// shows the model and the check every call passes before anything reaches the company. A failed check is one sentence
// that names the field, so the model can fix its call and try again.
import { OrgRefusal } from '../core/company.ts';
import { importProblem, ROLE_ID } from '../core/studio.ts';
import { tooLong } from '../core/too-long.ts';

/** Ids the company gives tasks, messages, milestones and dashboards: letters, digits, "-" and "_", up to 64. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

interface Common {
  /** What the field is for, in a sentence the model reads. */
  about: string;
  optional?: true;
}

/**
 * One field of a tool's input. `text` is trimmed (and folded onto one line with `line`), then held to `min` and `max`
 * characters, and with `noImports` holds no word that starts with "@" (a title or description that reaches CLAUDE.md,
 * where Claude Code can take one for a file to load); `id` is a role id (ROLE_ID: people, rooms, library roles, decor)
 * or an item's (ITEM_ID: tasks, messages, milestones), or one of the words in `also`, with `like` as the example a
 * refusal gives; `clip` cuts a text that is too long (and a list that has too many entries) instead of refusing the call,
 * and lets a text be empty: the report form uses it, since a report refused for its length costs a second request with the
 * whole context; `data` is passed through untouched to a company check that names its own fields (dashboards and
 * proposals), so only its JSON type is checked here.
 */
export type Field =
  | (Common & { type: 'text'; max: number; min?: number; line?: true; pattern?: RegExp; shape?: string; noImports?: true; clip?: true })
  | (Common & { type: 'id'; of: 'role' | 'item'; like?: string; also?: readonly string[] })
  | (Common & { type: 'choice'; of: readonly string[] })
  | (Common & { type: 'integer'; min: number; max: number })
  | (Common & { type: 'flag' })
  | (Common & { type: 'list'; item: Field; min?: number; max: number; clip?: true })
  | (Common & { type: 'object'; fields: Fields })
  | (Common & { type: 'data'; json: 'text' | 'list' | 'object'; schema: Record<string, unknown> });

export type Fields = { readonly [name: string]: Field };

type ValueOf<F> = F extends { type: 'text' | 'id' }
  ? string
  : F extends { type: 'choice'; of: readonly (infer C)[] }
    ? C
    : F extends { type: 'integer' }
      ? number
      : F extends { type: 'flag' }
        ? boolean
        : F extends { type: 'list'; item: infer I }
          ? ValueOf<I>[]
          : F extends { type: 'object'; fields: infer S }
            ? ArgsOf<S>
            : unknown;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];

/** The checked arguments of a tool whose fields are `S`: optional fields are absent when the call left them out. */
export type ArgsOf<S> = { [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { [K in OptionalKeys<S>]?: ValueOf<S[K]> };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A refusal of a call's arguments: the model reads the sentence as the tool's error and can try again. */
export const badArgs = (sentence: string): OrgRefusal => new OrgRefusal('invalid', sentence);

// ---------------------------------------------------------------------------------------------------------------------
// JSON Schema, as tools/list shows it

const JSON_TYPES = { text: 'string', list: 'array', object: 'object' } as const;
/** The longest id either pattern allows. */
const ID_MAX = 64;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const idRule = (f: Extract<Field, { type: 'id' }>): RegExp => (f.of === 'role' ? ROLE_ID : ITEM_ID);

function idPattern(f: Extract<Field, { type: 'id' }>): string {
  const base = idRule(f);
  const extra = (f.also ?? []).filter((word) => !base.test(word));
  return extra.length === 0 ? base.source : `^(?:${extra.map(escape).join('|')}|${base.source.slice(1, -1)})$`;
}

function schemaOf(f: Field): Record<string, unknown> {
  const description = f.about;
  switch (f.type) {
    case 'text':
      // A Unicode pattern (a person's first name) is told in words: JSON Schema readers differ on \p{L}.
      // A clipped text states its limit in words only: a client that enforces maxLength would refuse what the office cuts.
      return { type: 'string', description, ...(f.clip ? {} : { minLength: f.min ?? 1, maxLength: f.max }), ...(f.pattern && !f.pattern.unicode ? { pattern: f.pattern.source } : {}) };
    case 'id':
      return { type: 'string', description, maxLength: ID_MAX, pattern: idPattern(f) };
    case 'choice':
      return { type: 'string', description, enum: [...f.of] };
    case 'integer':
      return { type: 'integer', description, minimum: f.min, maximum: f.max };
    case 'flag':
      return { type: 'boolean', description };
    case 'list':
      return { type: 'array', description, items: schemaOf(f.item), ...(f.min ? { minItems: f.min } : {}), ...(f.clip ? {} : { maxItems: f.max }) };
    case 'object':
      return { ...inputSchema(f.fields), description };
    case 'data':
      return { type: JSON_TYPES[f.json], description, ...f.schema };
  }
}

/** A tool's inputSchema: an object with exactly these fields. */
export function inputSchema(fields: Fields): Record<string, unknown> {
  const entries = Object.entries(fields);
  const required = entries.filter(([, f]) => !f.optional).map(([name]) => name);
  return {
    type: 'object',
    properties: Object.fromEntries(entries.map(([name, f]) => [name, schemaOf(f)])),
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The check

/** "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const orList = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

/** A value as a sentence shows it: short, quoted when it's text. */
function shown(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 39)}…` : v);
  if (Array.isArray(v)) return 'a list';
  if (isObj(v)) return 'an object';
  if (typeof v === 'number') return `the number ${Number.isFinite(v) ? v : 'given'}`;
  return String(v);
}

function idShape(f: Extract<Field, { type: 'id' }>): string {
  const example = `an id like ${JSON.stringify(f.like ?? (f.of === 'role' ? 'ui-designer' : 't-12'))}`;
  return f.also && f.also.length > 0 ? `${example}, or ${orList(f.also.map((w) => JSON.stringify(w)))}` : example;
}

function checkValue(f: Field, v: unknown, at: string): unknown {
  switch (f.type) {
    case 'text': {
      if (typeof v !== 'string') throw badArgs(`${at} must be text, not ${shown(v)}.`);
      const text = f.line ? v.replace(/\s+/g, ' ').trim() : v.trim();
      if (f.clip) return text.length > f.max ? `${text.slice(0, f.max - 1)}…` : text;
      if (!text) throw badArgs(`${at} is empty. ${f.about}`);
      // A shape ("a colour like #3e5b4e") says more than a length.
      if (f.pattern && !f.pattern.test(text)) throw badArgs(`${at} must be ${f.shape ?? 'in the form described'}, not ${shown(text)}.`);
      if (text.length > f.max) throw badArgs(tooLong(at, text.length, f.max));
      if (f.min !== undefined && text.length < f.min) throw badArgs(`${at} is ${text.length} characters; the least is ${f.min}.`);
      const loads = f.noImports ? importProblem(text) : null;
      if (loads) throw badArgs(`${at} ${loads}.`);
      return text;
    }
    case 'id': {
      const id = typeof v === 'string' ? v.trim() : undefined;
      if (id === undefined || !(f.also?.includes(id) || idRule(f).test(id))) {
        throw badArgs(`${at} must be ${idShape(f)}, not ${shown(id ?? v)}.`);
      }
      return id;
    }
    case 'choice':
      if (typeof v !== 'string' || !f.of.includes(v)) throw badArgs(`${at} must be ${orList(f.of.map((c) => JSON.stringify(c)))}, not ${shown(v)}.`);
      return v;
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) throw badArgs(`${at} must be a whole number from ${f.min} to ${f.max}, not ${shown(v)}.`);
      return v;
    case 'flag':
      if (typeof v !== 'boolean') throw badArgs(`${at} must be true or false, not ${shown(v)}.`);
      return v;
    case 'list': {
      if (!Array.isArray(v)) throw badArgs(`${at} must be a list, not ${shown(v)}.`);
      if (f.clip) {
        const kept = v.slice(0, f.max).flatMap((item: unknown, i) => (item === null || item === undefined ? [] : [checkValue(f.item, item, `${at}[${i}]`)]));
        return kept.filter((item) => item !== '');
      }
      if (v.length > f.max) throw badArgs(`${at} has ${v.length} entries; the most is ${f.max}.`);
      if (f.min !== undefined && v.length < f.min) throw badArgs(`${at} needs at least ${f.min} ${f.min === 1 ? 'entry' : 'entries'}; it has ${v.length}.`);
      return v.map((item: unknown, i) => {
        if (item === null || item === undefined) throw badArgs(`${at}[${i}] is empty. ${f.item.about}`);
        return checkValue(f.item, item, `${at}[${i}]`);
      });
    }
    case 'object':
      return checkObject(f.fields, v, at, at);
    case 'data': {
      const fits = f.json === 'text' ? typeof v === 'string' : f.json === 'list' ? Array.isArray(v) : isObj(v);
      if (!fits) throw badArgs(`${at} must be ${f.json === 'text' ? 'text' : f.json === 'list' ? 'a list' : 'an object'}, not ${shown(v)}.`);
      return v;
    }
  }
}

function checkObject(fields: Fields, raw: unknown, owner: string, path: string | null): Obj {
  if (!isObj(raw)) throw badArgs(`${owner} must be an object with ${andList(Object.keys(fields))}.`);
  const names = Object.keys(fields);
  const unknown = Object.keys(raw).filter((key) => !Object.hasOwn(fields, key));
  if (unknown.length > 0) {
    const extra = unknown.slice(0, 5).map((key) => (key.length > 40 ? `${key.slice(0, 39)}…` : key));
    const takes = names.length === 0 ? 'it takes nothing' : `it takes ${andList(names)}`;
    throw badArgs(`${owner} doesn't take ${andList(extra)}${unknown.length > 5 ? ' and others' : ''}; ${takes}.`);
  }
  const out: Obj = {};
  for (const [name, f] of Object.entries(fields)) {
    const at = path === null ? name : `${path}.${name}`;
    // Models often send null for a field they mean to leave out.
    const v = Object.hasOwn(raw, name) ? raw[name] : undefined;
    if (v === undefined || v === null) {
      if (f.optional) continue;
      throw badArgs(`${owner} needs ${name}. ${f.about}`);
    }
    out[name] = checkValue(f, v, at);
  }
  return out;
}

/** Checks a call's arguments against the tool's fields. Throws an OrgRefusal whose sentence names the field. */
export function checkArgs(tool: string, fields: Fields, raw: unknown): Obj {
  return checkObject(fields, raw, tool, null);
}
