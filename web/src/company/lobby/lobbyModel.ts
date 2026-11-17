// The lobby's own words (docs/design-v3.md, "Lobby"): each company's name told apart from others of the same name,
// folder paths in the office's sentences cut in the middle so they fit the panel, and v0.2's card: the company's TL;DR
// in lines (cardLines), its stage in a word (stageWord) and where a needs-you item opens (routeOf). Pure, for tests.
import type { CompanyStage, CompanySummary, LobbyCompany, NeedsTarget, NeedsYouItem } from '../../../../src/core/company.ts';
import { coarseAge, countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { dollars } from '../../lib/format.ts';
import type { CompanyRoute } from '../address.ts';
import { type CompanyState, cutMiddle } from '../model.ts';
import { baseName } from '../paths.ts';
import { capWords } from '../spending/spendingModel.ts';
import type { StateTone } from '../ui/tone.ts';

/** What a row says after the company's name, in words: ", one needs you"; nothing when nothing does. */
export const needsWords = (n: number): string => (n > 0 ? `, ${countWord(n)} ${n === 1 ? 'needs' : 'need'} you` : '');

/** How long a path in a sentence may be before it is cut in the middle. */
const PATH_MAX = 40;

/**
 * Each company's name as the lobby's links and buttons say it, by id: told apart from others of the same name by its
 * folder ("Plant Pal in plant-phone"), and by more of the path when the folders' names match too. A name only one
 * company has stays as it is.
 */
export function lobbyNames(companies: readonly Pick<LobbyCompany, 'id' | 'name' | 'root'>[]): Map<string, string> {
  const byName = new Map<string, Pick<LobbyCompany, 'id' | 'name' | 'root'>[]>();
  for (const c of companies) {
    const key = c.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  const names = new Map<string, string>();
  for (const group of byName.values()) {
    const folders = new Map<string, number>();
    for (const c of group) folders.set(baseName(c.root).toLowerCase(), (folders.get(baseName(c.root).toLowerCase()) ?? 0) + 1);
    for (const c of group) {
      if (group.length === 1) names.set(c.id, c.name);
      else names.set(c.id, `${c.name} in ${(folders.get(baseName(c.root).toLowerCase()) ?? 0) > 1 ? cutMiddle(c.root, PATH_MAX) : baseName(c.root)}`);
    }
  }
  return names;
}

/**
 * A sentence of the office's with the folder paths in it cut in the middle: "Its folder isn't at C:\Users\…\plant-phone
 * any more." Paths are found as `known` gives them (a company's root, spaces and all), else as unbroken text after a
 * drive, a share or a leading slash.
 */
export function shortenPaths(text: string, known: readonly string[] = [], max = PATH_MAX): string {
  let out = text;
  for (const path of [...known].sort((a, b) => b.length - a.length)) {
    if (path.length > max && out.includes(path)) out = out.split(path).join(cutMiddle(path, max));
  }
  return out.replace(/(^|\s)((?:[A-Za-z]:\\|\\\\|\/)[^\s]*)/g, (whole, lead: string, found: string) => {
    const end = /[.,;:!?)]+$/.exec(found)?.[0] ?? '';
    const path = end ? found.slice(0, -end.length) : found;
    // A path cut already (a known root) stays as it is.
    return path.length > max && !path.includes('…') ? `${lead}${cutMiddle(path, max)}${end}` : whole;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// v0.2: the card, a company's TL;DR (SPEC-v0.2.md, "Simple, visible, proven", 1)

const STAGE_WORDS: Readonly<Record<CompanyStage, { word: string; tone: StateTone }>> = {
  scoping: { word: 'Scoping', tone: 'neutral' },
  waiting: { word: 'Waiting for your OK', tone: 'needs' },
  'your-turn': { word: 'Your turn', tone: 'needs' },
  working: { word: 'Working', tone: 'working' },
  checking: { word: 'Checking', tone: 'working' },
  done: { word: 'Done', tone: 'done' },
  paused: { word: 'Paused', tone: 'rest' },
  stuck: { word: 'Stuck', tone: 'error' },
};

/** Where a company stands, in a word or three, and the state pill's tone. */
export const stageWord = (stage: CompanyStage): { word: string; tone: StateTone } => STAGE_WORDS[stage];

/**
 * The company bar's state (and the mini-map's): the stage's word and tone, so the bar, the lobby's card and progress say
 * the same; the office's own sentence ("Resting until 14:00, when your plan's limit resets.") stays its detail.
 */
export function stagePill(stage: CompanyStage, sentence: string): CompanyState {
  const { word, tone } = stageWord(stage);
  return { pill: word, tone, sentence };
}

/** How far along: done and planned, with the share for a bar (null when nothing is planned yet). */
export interface CardProgress {
  /** "1 of 3 milestones, 11 of 17 tasks", "4 of 9 tasks", "No plan yet". */
  line: string;
  share: number | null;
}

export function progressLine(s: Pick<CompanySummary, 'milestones' | 'tasks'>): CardProgress {
  const { milestones: m, tasks: t } = s;
  const parts = [...(m.planned > 0 ? [`${m.done} of ${m.planned} ${m.planned === 1 ? 'milestone' : 'milestones'}`] : []), ...(t.planned > 0 ? [`${t.done} of ${t.planned} ${t.planned === 1 ? 'task' : 'tasks'}`] : [])];
  if (parts.length === 0) return { line: 'No plan yet', share: null };
  const share = t.planned > 0 ? t.done / t.planned : m.done / m.planned;
  return { line: parts.join(', '), share: Math.min(1, Math.max(0, share)) };
}

/** "$4.20 of $20 budget", "$4.20, no budget", "Nothing spent yet". */
export function spendLine(spend: CompanySummary['spend']): string {
  if (spend.budget !== null) return `${dollars(spend.spent)} of ${capWords(spend.budget)} budget`;
  return spend.spent > 0 ? `${dollars(spend.spent)}, no budget` : 'Nothing spent yet';
}

/** One needs-you item as a line: "Mina: Which pickup window should guests see?" or the office's own sentence. */
export const needsLine = (item: Pick<NeedsYouItem, 'from' | 'text'>): string => (item.from ? `${item.from}: ${item.text}` : item.text);

/** "Theo on “Pickup slot picker”", or the name alone between tasks. */
const workingLine = (w: CompanySummary['working'][number]): string => (w.task ? `${w.name} on “${w.task}”` : w.name);

/** "5 of 6 met, 1 partly met", once the final review has marked anything; null before. */
export function checklistLine(counts: CompanySummary['checklist']): string | null {
  if (!counts) return null;
  const total = counts.met + counts.partly + counts['not-met'] + counts.unchecked;
  if (total === 0 || counts.met + counts.partly + counts['not-met'] === 0) return null;
  const rest = [...(counts.partly > 0 ? [`${counts.partly} partly met`] : []), ...(counts['not-met'] > 0 ? [`${counts['not-met']} not met`] : []), ...(counts.unchecked > 0 ? [`${counts.unchecked} not checked`] : [])];
  return `${counts.met} of ${total} met${rest.length > 0 ? `, ${rest.join(', ')}` : ''}`;
}

export interface CardLines {
  /** The stakeholder's words, one line, without quotation marks (the card sets them); null when there are none. */
  goal: string | null;
  stage: { word: string; tone: StateTone };
  progress: CardProgress;
  /** What needs you: the inbox's count and the oldest item as a line (work that stopped too, which the inbox doesn't count). */
  needs: { count: number; first: string | null };
  /** The last few finished tasks, newest first: "Menu page layout". */
  finished: string[];
  /** Who works on what, three at most, then "and two more". */
  now: string[];
  nowMore: number;
  spend: string;
  checklist: string | null;
  /** "Moved 12 min ago"; null before anything has. */
  moved: string | null;
}

/** The lines of a company's card, from its summary. */
export function cardLines(s: CompanySummary, now: number): CardLines {
  const first = s.needs.items[0];
  return {
    goal: s.goal.trim() || null,
    stage: stageWord(s.stage),
    progress: progressLine(s),
    needs: { count: s.needs.count, first: first ? needsLine(first) : null },
    finished: s.achieved.map((a) => a.title),
    now: s.working.slice(0, 3).map(workingLine),
    nowMore: Math.max(0, s.working.length - 3),
    spend: spendLine(s.spend),
    checklist: checklistLine(s.checklist),
    moved: s.movedAt === null ? null : `Moved ${coarseAge(now - s.movedAt)}`,
  };
}

/** How many of the needs-you strip's items show before "Show all": the cards under it stay in view. */
export const STRIP_SHOWN = 3;

/**
 * The needs-you strip from every company's items (needsAcross): one number for the badge, the items shown, and the
 * toggle's words ("Show all 14", "Show fewer"; null when everything already shows). The badge counts the list itself,
 * so it never says more than "Show all" opens.
 */
export function needsStrip<T>(items: readonly T[], all: boolean): { total: number; shown: T[]; toggle: string | null } {
  return {
    total: items.length,
    shown: all ? [...items] : items.slice(0, STRIP_SHOWN),
    toggle: items.length > STRIP_SHOWN ? (all ? 'Show fewer' : `Show all ${countWord(items.length)}`) : null,
  };
}

/** "and two more", for a list cut short. */
export const moreWords = (n: number): string => (n > 0 ? `and ${countWord(n)} more` : '');

/** "Two need you", "One needs you". */
export const needYouWords = (n: number): string => `${capital(countWord(n))} ${n === 1 ? 'needs' : 'need'} you`;

/**
 * Where a needs-you item opens, as a route in its company: the inbox on its item, the proposal, the plan, or progress
 * (work that stopped). Each lands with progress as the main view, except the plan, which is the place to approve it.
 */
export function routeOf(target: NeedsTarget): CompanyRoute {
  const progress = { kind: 'progress' } as const;
  if ('main' in target) return target.main === 'plan' ? { main: { kind: 'plan', version: null }, panel: null } : { main: progress, panel: null };
  if (target.panel === 'proposal') return { main: progress, panel: { kind: 'proposal' } };
  return { main: progress, panel: { kind: 'inbox', item: target.item } };
}
