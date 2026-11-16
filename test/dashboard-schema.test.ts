import { describe, expect, it } from 'vitest';
import { checkDashboard } from '../src/core/dashboard.ts';

const good = {
  title: 'Launch',
  widgets: [
    { kind: 'stat', title: 'Pages done', value: 7, unit: 'pages' },
    { kind: 'progress', title: 'Milestone 1', value: 3, max: 4, note: 'Menu and pickup left' },
    { kind: 'bars', title: 'Spend by room', bars: [{ label: 'Design', value: 1.2 }, { label: 'Engineering', value: 3.4 }], unit: '$' },
    { kind: 'line', title: 'Tasks done', points: [{ label: 'Mon', value: 2 }, { label: 'Tue', value: 5 }] },
    { kind: 'list', title: 'Open decisions', items: ['TWINT or cards first'] },
    { kind: 'table', title: 'Pages', columns: ['Page', 'Status'], rows: [['Menu', 'done'], ['Pickup', 'in review']] },
  ],
};

describe('checkDashboard', () => {
  it('takes every kind of widget the office draws', () => {
    const result = checkDashboard(good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dashboard.widgets.map((w) => w.kind)).toEqual(['stat', 'progress', 'bars', 'line', 'list', 'table']);
  });

  it('keeps only the known fields, so nothing else reaches the page', () => {
    const result = checkDashboard({ title: 'X', html: '<script>alert(1)</script>', widgets: [{ kind: 'stat', title: 'A', value: 1, onclick: 'x' }] });
    expect(result).toEqual({ ok: true, dashboard: { title: 'X', widgets: [{ kind: 'stat', title: 'A', value: 1 }] } });
  });

  it("refuses what it can't draw with a sentence naming the widget and the field", () => {
    const refuse = (raw: unknown) => {
      const result = checkDashboard(raw);
      return result.ok ? null : result.error;
    };
    expect(refuse('<div>')).toBe('A dashboard is an object with a title and a list of widgets.');
    expect(refuse({ title: 'X', widgets: [] })).toBe('A dashboard needs a list of one or more widgets.');
    expect(refuse({ title: 'X', widgets: [{ kind: 'html', title: 'A' }] })).toBe('Widget 1 has kind "html"; the office draws stat, progress, bars, line, list, table.');
    expect(refuse({ title: 'X', widgets: [good.widgets[0], { kind: 'progress', title: 'A', value: 1, max: 0 }] })).toBe(
      'Widget 2 needs a value and a max as numbers, with the max above 0.',
    );
    expect(refuse({ title: 'X', widgets: [{ kind: 'bars', title: 'A', bars: [{ label: 'a', value: 'lots' }] }] })).toBe("Widget 1's bars entry 1 needs a value as a number.");
    expect(refuse({ title: 'X', widgets: [{ kind: 'table', title: 'A', columns: ['a', 'b'], rows: [['only one']] }] })).toBe("Widget 1's row 1 needs 2 cells, one per column.");
    expect(refuse({ title: 'X'.repeat(81), widgets: [good.widgets[0]] })).toBe("The dashboard's title is 81 characters; the most is 80.");
    expect(refuse({ title: 'X', widgets: Array.from({ length: 13 }, () => good.widgets[0]) })).toBe('A dashboard holds up to 12 widgets; this one has 13.');
    expect(refuse({ title: 'X', widgets: [{ kind: 'line', title: 'A', points: [{ label: 'a', value: Number.NaN }] }] })).toBe("Widget 1's points entry 1 needs a value as a number.");
  });
});
