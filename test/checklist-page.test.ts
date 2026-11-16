// The checklist's evidence link stays on the preview: a page is stored only as a path on it (CHECKLIST_PAGE, which refuses
// `//host/x`, a path a browser reads as another site), and the view links a page only when the link keeps the preview's origin,
// so a verdict stored before the pattern refused it still leads nowhere else.
import { describe, expect, it } from 'vitest';
import { checklistView } from '../src/core/checklist.ts';
import { CHECKLIST_PAGE, type ChecklistVerdict } from '../src/core/steering.ts';
import { checkRows } from '../web/src/company/progress/checklistModel.ts';
import { min, NOW, task } from './panels-work-kit.ts';
import { plan, version } from './steering-plan-kit.ts';

const OFF_SITE = ['//attacker.example/x', '//attacker.example', '/\\attacker.example/x', '///attacker.example'];

describe('a checklist page', () => {
  it('is stored only as a path on the preview', () => {
    for (const page of ['/menu', '/', '/menu?day=1#top', '/a//b']) expect(CHECKLIST_PAGE.test(page), page).toBe(true);
    for (const page of OFF_SITE) expect(CHECKLIST_PAGE.test(page), page).toBe(false);
  });

  it('links only to the preview, even for a page stored before the pattern refused another site', () => {
    const p = plan({ checklist: [{ id: 'k-1', text: 'Guests read the menu.', quote: null, covers: ['p-1'] }] });
    const tasks = [task('t-1', 'frontend-engineer', 'Menu data', { planTask: 'p-1', status: 'done' })];
    const verdict = (page: string): ChecklistVerdict => ({
      item: 'k-1', version: 1, verdict: 'met', by: 'qa-engineer', task: 't-9', at: NOW - min(5),
      evidence: { note: 'Seen.', check: null, files: [], page },
    });
    const link = (page: string) => {
      const view = checklistView(version(1, p), [verdict(page)], tasks);
      if (!view) throw new Error('expected a checklist');
      return checkRows(view, { now: NOW, preview: 'http://127.0.0.1:5199/', nameOf: () => 'Nils' })[0]?.evidence?.page;
    };
    expect(link('/menu')).toEqual({ href: 'http://127.0.0.1:5199/menu', path: '/menu' });
    for (const page of OFF_SITE) expect(link(page), page).toBeNull();
  });
});
