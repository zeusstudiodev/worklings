// Dashboards the CEO publishes (`publish_dashboard`): a list of widgets the office draws itself. People send data,
// never HTML or script, and a dashboard that doesn't fit the schema is refused with a sentence saying why.

export const WIDGET_KINDS = ['stat', 'progress', 'bars', 'line', 'list', 'table'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export type Widget =
  | { kind: 'stat'; title: string; value: number | string; unit?: string; note?: string }
  | { kind: 'progress'; title: string; value: number; max: number; note?: string }
  | { kind: 'bars'; title: string; bars: { label: string; value: number }[]; unit?: string }
  | { kind: 'line'; title: string; points: { label: string; value: number }[]; unit?: string }
  | { kind: 'list'; title: string; items: string[] }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][] };

export interface Dashboard {
  id: string;
  title: string;
  /** The person who published it. */
  by: string;
  widgets: Widget[];
  publishedAt: number;
}

/** What a dashboard may hold, so one can't slow the office down or fill the screen. */
export const DASHBOARD_LIMITS = { widgets: 12, title: 80, text: 200, unit: 12, entries: 60, columns: 8, rows: 50 } as const;

/** A published dashboard before the office stamps it: what `publish_dashboard` takes. */
export interface DashboardInput {
  title: string;
  widgets: Widget[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Refused extends Error {}

/** Checks a dashboard from a person. The error is one sentence naming the widget and the field. */
export function checkDashboard(raw: unknown): { ok: true; dashboard: DashboardInput } | { ok: false; error: string } {
  try {
    if (!isObj(raw)) throw new Refused('A dashboard is an object with a title and a list of widgets.');
    const title = text(raw.title, 'The dashboard', 'title', DASHBOARD_LIMITS.title);
    if (!Array.isArray(raw.widgets) || raw.widgets.length === 0) throw new Refused('A dashboard needs a list of one or more widgets.');
    if (raw.widgets.length > DASHBOARD_LIMITS.widgets) {
      throw new Refused(`A dashboard holds up to ${DASHBOARD_LIMITS.widgets} widgets; this one has ${raw.widgets.length}.`);
    }
    return { ok: true, dashboard: { title, widgets: raw.widgets.map((w, i) => widget(w, i + 1)) } };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    throw error;
  }
}

function text(v: unknown, owner: string, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Refused(`${owner} needs a ${field} as text.`);
  const t = v.trim();
  if (t.length > max) throw new Refused(`${owner}'s ${field} is ${t.length} characters; the most is ${max}.`);
  return t;
}

function optionalText(v: unknown, owner: string, field: string, max: number): string | undefined {
  return v === undefined ? undefined : text(v, owner, field, max);
}

function entries<T>(v: unknown, owner: string, field: string, each: (item: unknown, at: string) => T): T[] {
  if (!Array.isArray(v) || v.length === 0) throw new Refused(`${owner} needs ${field} as a list with at least one entry.`);
  if (v.length > DASHBOARD_LIMITS.entries) throw new Refused(`${owner} has ${v.length} ${field}; the most is ${DASHBOARD_LIMITS.entries}.`);
  return v.map((item, i) => each(item, `${owner}'s ${field} entry ${i + 1}`));
}

function labelled(item: unknown, at: string): { label: string; value: number } {
  if (!isObj(item)) throw new Refused(`${at} needs a label and a value.`);
  const label = text(item.label, at, 'label', DASHBOARD_LIMITS.text);
  if (!finite(item.value)) throw new Refused(`${at} needs a value as a number.`);
  return { label, value: item.value };
}

function widget(w: unknown, n: number): Widget {
  const owner = `Widget ${n}`;
  if (!isObj(w)) throw new Refused(`${owner} is not an object.`);
  const kind = w.kind;
  if (typeof kind !== 'string' || !(WIDGET_KINDS as readonly string[]).includes(kind)) {
    throw new Refused(`${owner} has kind ${JSON.stringify(kind ?? null)}; the office draws ${WIDGET_KINDS.join(', ')}.`);
  }
  const title = text(w.title, owner, 'title', DASHBOARD_LIMITS.title);
  const unit = optionalText(w.unit, owner, 'unit', DASHBOARD_LIMITS.unit);
  const note = optionalText(w.note, owner, 'note', DASHBOARD_LIMITS.text);
  const withUnit = unit === undefined ? {} : { unit };
  const withNote = note === undefined ? {} : { note };
  switch (kind) {
    case 'stat': {
      const value = w.value;
      if (finite(value)) return { kind, title, value, ...withUnit, ...withNote };
      return { kind, title, value: text(value, owner, 'value', DASHBOARD_LIMITS.text), ...withUnit, ...withNote };
    }
    case 'progress': {
      if (!finite(w.value) || !finite(w.max) || w.max <= 0 || w.value < 0) throw new Refused(`${owner} needs a value and a max as numbers, with the max above 0.`);
      return { kind, title, value: Math.min(w.value, w.max), max: w.max, ...withNote };
    }
    case 'bars':
      return { kind, title, bars: entries(w.bars, owner, 'bars', labelled), ...withUnit };
    case 'line':
      return { kind, title, points: entries(w.points, owner, 'points', labelled), ...withUnit };
    case 'list':
      return { kind, title, items: entries(w.items, owner, 'items', (item, at) => text(item, at, 'text', DASHBOARD_LIMITS.text)) };
    default: {
      if (!Array.isArray(w.columns) || w.columns.length === 0 || w.columns.length > DASHBOARD_LIMITS.columns) {
        throw new Refused(`${owner} needs 1 to ${DASHBOARD_LIMITS.columns} columns.`);
      }
      const columns = w.columns.map((c, i) => text(c, `${owner}'s column ${i + 1}`, 'name', DASHBOARD_LIMITS.title));
      if (!Array.isArray(w.rows) || w.rows.length > DASHBOARD_LIMITS.rows) throw new Refused(`${owner} needs rows as a list of up to ${DASHBOARD_LIMITS.rows}.`);
      const rows = w.rows.map((row, r) => {
        const at = `${owner}'s row ${r + 1}`;
        if (!Array.isArray(row) || row.length !== columns.length) throw new Refused(`${at} needs ${columns.length} cells, one per column.`);
        return row.map((cell, c) => (finite(cell) ? cell : text(cell, `${at}, cell ${c + 1},`, 'value', DASHBOARD_LIMITS.text)));
      });
      return { kind: 'table', title, columns, rows };
    }
  }
}
