// What the hub takes from the browser: a JSON object with only the fields a route reads, each of the right kind and
// within LIMITS. A refusal names the field and says what to send instead; the company then checks the org's rules,
// and its refusal goes back as its sentence (company()).
import { OrgRefusal } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import { HttpError } from '../server/http.ts';

/** A company's refusal as the office sends it: its sentence, with the status its code means. */
export function refused(error: unknown): unknown {
  if (!(error instanceof OrgRefusal)) return error;
  return new HttpError(error.code === 'not-allowed' ? 403 : error.code === 'conflict' ? 409 : 400, error.message, { code: error.code });
}

/** Runs a company call, sending a refusal as its sentence with the status its code means. */
export function company<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw refused(error);
  }
}

export type Fields = Record<string, unknown>;

/** Most desks at once one company may set (the hub's own cap is separate). */
export const MAX_COMPANY_DESKS = 20;

const bad = (message: string) => new HttpError(400, message, { code: 'bad-input' });
const count = (n: number) => n.toLocaleString('en-US');

/** The body as an object, refused when it isn't one or carries a field the route doesn't take. */
export function fields(body: unknown, allowed: readonly string[]): Fields {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('Send a JSON object.');
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw bad(allowed.length > 0 ? `This takes ${allowed.join(', ')}, not ${key}.` : `This takes an empty object, not ${key}.`);
  }
  return body as Fields;
}

/** A query parameter's name the office repeats in a refusal; any other is too long or odd to say back. */
const PLAIN_NAME = /^[A-Za-z][\w-]{0,31}$/;

/**
 * A GET route's query: each parameter it takes, at most once, refused when it carries another. `token` is the hub's
 * own (tokenOf), checked before any route runs, so it may come along.
 */
export function params(search: URLSearchParams, allowed: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of search) {
    if (key === 'token') continue;
    if (!allowed.includes(key)) throw bad(PLAIN_NAME.test(key) ? `This takes ${allowed.join(', ')}, not ${key}.` : `This takes ${allowed.join(', ')} and nothing else.`);
    if (out.has(key)) throw bad(`Send ${key} once.`);
    out.set(key, value);
  }
  return out;
}

/** Text of 1 (or `min`) to `max` characters once trimmed. */
export function text(o: Fields, key: string, max: number, min = 1): string {
  const value = o[key];
  if (typeof value !== 'string') throw bad(`Send ${key} as text.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw bad(min > 1 ? `${key} needs at least ${count(min)} characters.` : `${key} is empty.`);
  if (trimmed.length > max) throw bad(`${key} is longer than ${count(max)} characters.`);
  return trimmed;
}

/** Text that may be missing or null, as null. */
export function optionalText(o: Fields, key: string, max: number): string | null {
  if (o[key] === undefined || o[key] === null) return null;
  const value = text(o, key, max, 0);
  return value === '' ? null : value;
}

/** An id as Claude Code and the company make them (see safeId). */
export function id(o: Fields, key: string): string {
  const value = safeId(o[key]);
  if (value === undefined) throw bad(`${key} isn't an id this office made.`);
  return value;
}

/** A whole number from `min` to `max`. */
export function whole(o: Fields, key: string, min: number, max: number): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw bad(`${key} must be a whole number from ${count(min)} to ${count(max)}.`);
  return value;
}

export function optionalWhole(o: Fields, key: string, min: number, max: number): number | null {
  return o[key] === undefined || o[key] === null ? null : whole(o, key, min, max);
}

export function flag(o: Fields, key: string, fallback: boolean): boolean {
  const value = o[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw bad(`${key} must be true or false.`);
  return value;
}

/** A list of up to `max` ids (at least `min`), each once; [] when it is missing and may be. */
export function idList(o: Fields, key: string, max: number, min = 0): string[] {
  const value = o[key];
  if (value === undefined || value === null) {
    if (min > 0) throw bad(`Send ${key}.`);
    return [];
  }
  if (!Array.isArray(value)) throw bad(`Send ${key} as a list.`);
  if (value.length < min || value.length > max) throw bad(`${key} holds ${count(min)} to ${count(max)} ids.`);
  const ids = value.map((v: unknown) => {
    const one = safeId(v);
    if (one === undefined) throw bad(`${key} holds something that isn't an id this office made.`);
    return one;
  });
  if (new Set(ids).size !== ids.length) throw bad(`${key} names one of them twice.`);
  return ids;
}

/** A list of up to `max` texts of 1 to `itemMax` characters each, trimmed. */
export function textList(o: Fields, key: string, max: number, itemMax: number): string[] {
  const value = o[key];
  if (!Array.isArray(value)) throw bad(`Send ${key} as a list.`);
  if (value.length > max) throw bad(`${key} holds up to ${count(max)} entries.`);
  return value.map((v: unknown, i) => {
    if (typeof v !== 'string' || v.trim() === '') throw bad(`${key}[${i}] must be text.`);
    if (v.trim().length > itemMax) throw bad(`${key}[${i}] is longer than ${count(itemMax)} characters.`);
    return v.trim();
  });
}

export function oneOf<T extends string>(o: Fields, key: string, options: readonly T[]): T {
  const value = o[key];
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) throw bad(`${key} must be ${options.map((x) => `"${x}"`).join(' or ')}.`);
  return value as T;
}

export const badInput = bad;
