// v0.4 (SPEC-v0.4.md, H1 and H5): a company shaped like a harness. The seats a harness needs replace a company's job
// titles: the Lead (the CEO seat), one Builder (more only for parts with a contract between them), the Tester and the
// Reviewer. The office holds the Lead's proposal to that shape by code, filling in what it can instead of refusing
// (a refusal costs the Lead a whole turn), and turns the Lead's milestones into the loop's tasks: for each milestone the
// Tester's acceptance tests first, then the Builder's build, checked by the office running those tests. Pure, with no
// Node APIs: the company and the org check read it alike.
import { WORKER_TOOLS, MANAGER_TOOLS } from './loads.ts';
import { PRESETS, type PresetId, SEAT_TITLES, type Seat } from './presets.ts';
import { isSize, type Size } from './size.ts';

/** classic: the v0.3 company of job titles. harness: v0.4's seats. Companies founded before v0.4 are classic. */
/** v0.5 adds `solo` (SPEC-v0.5.md): one Builder's session on the whole request, then an independent review and a fix round. */
/**
 * v0.7 adds `plain` (SPEC-v0.7.md), the default: one unmodified Claude Code session on the person's words, which the
 * office watches and controls without changing how it works. solo, harness and classic are parked for experiments.
 */
export const COMPANY_SHAPES = ['plain', 'solo', 'harness', 'classic'] as const;
export type CompanyShape = (typeof COMPANY_SHAPES)[number];
export const isCompanyShape = (v: unknown): v is CompanyShape => typeof v === 'string' && (COMPANY_SHAPES as readonly string[]).includes(v);

/** Seat ids: the Lead is the CEO's own id; Builders are builder, builder-2, …; one Tester and one Reviewer. */
export const BUILDER_ID = /^builder(?:-[2-9]|-[1-9][0-9])?$/;
export const TESTER_ID = 'tester';
export const REVIEWER_ID = 'reviewer';

/** The seat a person of a harness company sits in, by their id and level; null for anyone else (a later hire). */
export function seatOf(p: { id: string; level?: string }): Seat | null {
  if (p.level === 'ceo' || p.id === 'ceo') return 'lead';
  if (BUILDER_ID.test(p.id)) return 'builder';
  if (p.id === TESTER_ID) return 'tester';
  if (p.id === REVIEWER_ID) return 'reviewer';
  return null;
}

/**
 * v0.6 (E1): the solo shape's Reviewer is strict, so the fix round has something to fix: Opus at high effort, whatever
 * the preset gives a worker. A stakeholder's own effort for them still wins (steering).
 */
export const SOLO_REVIEWER = { model: 'opus', effort: 'high' } as const;

export const SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The severity a strict review gave a finding (`ms-1-build major: ...`): the first severity word near the line's start;
 * a nit or a suggestion is minor, and a line that names none counts as major, so nothing real is dropped by its wording.
 */
export function severityOf(line: string): Severity {
  const m = /\b(blocker|critical|major|minor|nit|nitpick|suggestion|polish-only)\b/i.exec(line.slice(0, 60));
  const word = (m?.[1] ?? '').toLowerCase();
  if (word === 'blocker' || word === 'critical') return 'blocker';
  if (word === 'minor' || word === 'nit' || word === 'nitpick' || word === 'suggestion' || word === 'polish-only') return 'minor';
  return 'major';
}

/**
 * v0.6 (E1): what a solo company's final review sends back to the Builder: every blocker and major in the first round;
 * in a later round only blockers. Minors are kept in the report and never start a round.
 */
export function soloFixLines(open: readonly string[], round: number): string[] {
  return open.filter((line) => {
    const s = severityOf(line);
    return round <= 1 ? s !== 'minor' : s === 'blocker';
  });
}

/** The Builder's tools: a maker's six and the Agent tool, for helpers (H2). */
export const BUILDER_TOOLS: readonly string[] = [...WORKER_TOOLS, 'Agent'];
/** The Reviewer reads and runs, and changes nothing. */
export const REVIEWER_TOOLS: readonly string[] = [...MANAGER_TOOLS];

/** The folder the Tester writes the acceptance tests into, per milestone; every desk reads it, only the Tester writes. */
export const ACCEPTANCE_REL = '.worklings-shared/acceptance';
export const acceptanceDir = (milestone: string): string => `${ACCEPTANCE_REL}/${milestone}`;
/** The command the office runs on a Builder's done: the milestone's acceptance tests, with Node's own runner. */
export const acceptanceCheck = (milestone: string): string => `node --test ${acceptanceDir(milestone)}/**/*.accept.mjs`;
/**
 * The file every milestone's tests start from. `node --test` passes a glob that matches nothing, so the Tester's task is
 * checked by loading this file: a Tester who wrote no tests gets the failure back instead of the Builder a free pass.
 */
export const ACCEPTANCE_MAIN = 'main.accept.mjs';
export const testsCheck = (milestone: string): string => `node --check ${acceptanceDir(milestone)}/${ACCEPTANCE_MAIN}`;

/**
 * What a Builder's build task may change, since a plan task names files and the office commits, diffs and routes fixes by
 * them: what the project has at its top level when the plan is written, and the places a new project grows into. The
 * Builder's house rules say the whole codebase is theirs; changes outside these still land with the task as its strays.
 */
const GROWS_INTO = ['src/', 'lib/', 'bin/', 'app/', 'public/', 'test/', 'tests/', 'scripts/', 'docs/', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'index.html', 'index.js', 'index.mjs', 'index.ts', 'cli.js', 'cli.mjs', 'server.js', 'server.mjs', 'vite.config.ts', 'vite.config.js'];
const NOT_THE_BUILDERS = /^(?:\.git|\.worklings|\.worklings-shared|\.claude|node_modules|CLAUDE\.md|AGENTS\.md|\.mcp\.json)\/?$/i;
export function builderFiles(topLevel: readonly string[] = []): string[] {
  const own = topLevel.filter((f) => /^[\w.@+-][\w .@+-]{0,99}\/?$/.test(f) && !NOT_THE_BUILDERS.test(f));
  return [...new Set([...own, ...GROWS_INTO])].slice(0, 50);
}
/** The most Builders a harness company holds: each needs a part of its own with a contract (SPEC-v0.4.md, H1). */
export const MOST_BUILDERS = 4;
/** A milestone id a plan keeps (PLAN_ID in src/core/plan.ts), so the task ids made from it are plan ids too. */
const MILESTONE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/;

/** Names for seats the office adds itself, made up; the first one nobody in the proposal has is taken. */
const SPARE_NAMES = ['Robin', 'Sasha', 'Kai', 'Noa', 'Ari', 'Jo', 'Remy', 'Tove'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

const TESTER_ROLES = new Set(['tester', 'qa-engineer']);
const REVIEWER_ROLES = new Set(['reviewer', 'code-reviewer']);

/**
 * What a person in the Lead's raw proposal is meant to be: by their library role when it names one (a frontend engineer
 * is a Builder whatever their title says), else by their id and title.
 */
function meantAs(p: Obj): Seat | 'head' {
  if (p.level === 'ceo') return 'lead';
  if (p.level === 'head' || p.level === 'lead') return 'head';
  const library = text(p.library);
  if (TESTER_ROLES.has(library)) return 'tester';
  if (REVIEWER_ROLES.has(library)) return 'reviewer';
  if (library) return 'builder';
  const said = `${text(p.id)} ${text(p.title)}`;
  if (/\b(?:tester|qa|test|testing|quality)\b/.test(said) || /qa-|-qa\b|test-/.test(said)) return 'tester';
  if (/\breview(?:er)?\b|code-reviewer|auditor/.test(said)) return 'reviewer';
  return 'builder';
}

export interface HarnessProposal {
  /** The proposal as the org check should read it: seats named, titled and wired, missing seats added. */
  raw: Obj;
  /** What the office changed instead of refusing, a sentence each, for the Lead's notes. */
  notes: string[];
  /** What it can't settle for the Lead: a sentence each, sent back like the org check's. */
  errors: string[];
}

/**
 * The Lead's proposal held to the harness shape (H1). Seats are recognised from what the Lead wrote (a QA engineer is
 * the Tester, a code reviewer the Reviewer, any other worker a Builder, who keeps the library role as their
 * specialisation); ids and titles become the seats'; everyone reports to the Lead; a missing Tester or Reviewer is
 * added; Builders get the Agent tool and the Reviewer only reading tools. Heads, two Testers or two Reviewers, and
 * more Builders than the preset allows are sent back. The size follows the Builders when the Lead gave none.
 */
export function harnessProposal(raw: Obj, preset: PresetId, shape: 'harness' | 'solo' = 'harness'): HarnessProposal {
  const notes: string[] = [];
  const errors: string[] = [];
  const list = Array.isArray(raw.people) ? raw.people.filter(isObj) : [];
  if (!Array.isArray(raw.people)) return { raw, notes, errors };
  const lead = list.find((p) => p.level === 'ceo');
  const leadId = typeof lead?.id === 'string' ? lead.id : 'ceo';
  const used = new Set(list.map((p) => (typeof p.name === 'string' ? p.name : '')));
  const spare = (): string => SPARE_NAMES.find((n) => !used.has(n) && used.add(n)) ?? 'Sam';
  const rooms = Array.isArray(raw.rooms) ? raw.rooms.filter(isObj) : [];
  const workRoom = (seat: Seat): string => {
    const style = seat === 'builder' ? 'engineering' : 'quality';
    const byStyle = rooms.find((r) => r.style === style && typeof r.id === 'string');
    const other = rooms.find((r) => r.style !== 'direction' && typeof r.id === 'string') ?? rooms[0];
    return String((byStyle ?? other)?.id ?? 'engineering');
  };

  const people: Obj[] = [];
  let builders = 0;
  const seen: Partial<Record<Seat, Obj>> = {};
  for (let p of list) {
    const seat = meantAs(p);
    if (seat === 'lead') {
      if (p.title !== SEAT_TITLES.lead) notes.push(`The CEO seat is titled "${SEAT_TITLES.lead}" in a harness company.`);
      people.push({ ...p, title: SEAT_TITLES.lead });
      continue;
    }
    if (seat === 'head') {
      errors.push(`people: ${String(p.id ?? 'someone')} is a ${String(p.level)}; a harness company has no heads or team leads: the Lead plans, Builders build, the Tester tests and the Reviewer reviews. Take them out, or make them a Builder.`);
      continue;
    }
    if (seat === 'tester' && shape === 'solo') {
      // v0.5: no Tester seat; the Builder tests its own work and the Reviewer checks it independently.
      notes.push(`${String(p.id ?? 'A tester')} was left out: a solo company has no Tester seat; the Builder tests its own work and the Reviewer checks it.`);
      continue;
    }
    if (seat === 'tester' || seat === 'reviewer') {
      if (seen[seat]) {
        errors.push(`people: ${String(p.id ?? 'someone')} would be a second ${SEAT_TITLES[seat]}; a harness company has one. Take them out, or make them a Builder.`);
        continue;
      }
    }
    const id = seat === 'builder' ? (builders === 0 ? 'builder' : `builder-${builders + 1}`) : seat;
    if (seat === 'builder') builders += 1;
    const library = typeof p.library === 'string' && p.library ? p.library : seat;
    const tools = seat === 'builder' ? BUILDER_TOOLS : seat === 'reviewer' ? REVIEWER_TOOLS : WORKER_TOOLS;
    const loads = isObj(p.loads) ? { ...p.loads } : {};
    // v0.6 (E1): a solo company's Reviewer runs on the strongest model.
    if (shape === 'solo' && seat === 'reviewer' && p.model !== SOLO_REVIEWER.model) {
      p = { ...p, model: SOLO_REVIEWER.model };
      notes.push(`The Reviewer runs on ${SOLO_REVIEWER.model} in a solo company, so the final review is strict.`);
    }
    const given = Array.isArray(loads.tools) ? loads.tools.filter((t): t is string => typeof t === 'string') : null;
    loads.tools = seat === 'builder' ? [...new Set([...(given ?? []), ...tools])] : seat === 'reviewer' ? [...tools] : (given ?? [...tools]);
    const shaped: Obj = { ...p, id, title: SEAT_TITLES[seat], level: 'worker', reportsTo: leadId, library, loads };
    if (p.id !== id || p.title !== SEAT_TITLES[seat]) notes.push(`${String(p.id ?? 'A person')} sits in the ${SEAT_TITLES[seat]} seat, as ${id}${library !== seat ? `, carrying the ${library} role` : ''}.`);
    if (seat !== 'builder') seen[seat] = shaped;
    people.push(shaped);
  }
  if (builders === 0) errors.push('people: a harness company needs a Builder, who owns the code; add one (library role "builder", or a specialist such as "frontend-engineer").');
  const max = Math.min(PRESETS[preset].maxMakers, MOST_BUILDERS);
  if (builders > max) errors.push(`people: ${PRESETS[preset].label} allows up to ${max} Builders, and this has ${builders}; keep one per part with a contract between them.`);
  for (const seat of shape === 'solo' ? (['reviewer'] as const) : (['tester', 'reviewer'] as const)) {
    if (seen[seat]) continue;
    const added: Obj = {
      id: seat, name: spare(), title: SEAT_TITLES[seat], level: 'worker', room: workRoom(seat), reportsTo: leadId, library: seat,
      owns: seat === 'tester' ? "The acceptance tests, written from the stakeholder's words before each milestone is built" : 'The one independent final review of the whole result',
      loads: { tools: seat === 'reviewer' ? [...REVIEWER_TOOLS] : [...WORKER_TOOLS] },
      ...(shape === 'solo' && seat === 'reviewer' ? { model: SOLO_REVIEWER.model } : {}),
    };
    people.push(added);
    notes.push(`The office added the ${SEAT_TITLES[seat]} seat (${String(added.name)}), which every harness company has.`);
  }
  const size: Size = isSize(raw.size) ? raw.size : builders <= 1 ? 'small' : builders <= 4 ? 'medium' : 'large';
  return { raw: { ...raw, size, people }, notes, errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// v0.5: the solo plan

/** A request that names a Node project, so `npm test` is the check the office reruns after the Builder and each fix. */
const NODE_WORDS = /\b(?:node(?:\.js)?|npm|javascript|typescript|react|vue|svelte|vite|express|next\.js|astro|vitest|jest)\b/i;

/**
 * The Lead's plan in the solo shape (SPEC-v0.5.md): the plan is advice, and one Builder builds the whole request in one
 * task, so a plan of several milestones is folded into one (their titles and done-whens kept as the one's advice). With
 * two or more Builders the Lead gives their tasks and contracts, as in a harness company. The office adds the Reviewer's
 * final review (checkPlan with `harness`). The build is checked by the project's own tests when the project is a Node one.
 */
export function soloPlan(raw: Obj, people: readonly { id: string; level?: string }[], o: { topLevel?: readonly string[]; prompt?: string } = {}): { raw: Obj; notes: string[]; errors: string[] } {
  const notes: string[] = [];
  const errors: string[] = [];
  const milestones = Array.isArray(raw.milestones) ? raw.milestones.filter(isObj) : [];
  const builders = people.filter((p) => seatOf(p) === 'builder').map((p) => p.id);
  if (milestones.length === 0 || builders.length === 0) return { raw, notes, errors };
  if (builders.length > 1) {
    const given = Array.isArray(raw.tasks) ? raw.tasks.filter(isObj) : [];
    const contracts = Array.isArray(raw.contracts) ? raw.contracts.filter(isObj) : [];
    if (contracts.length === 0) errors.push(`This company has ${builders.length} Builders, and the plan names no contract between their parts. Give contracts (the file each part shares, written first by one Builder's task, the other's tasks waiting for it), or keep one Builder.`);
    if (given.length === 0) errors.push(`With ${builders.length} Builders, give each Builder's tasks: an owner, the files of their part, its milestone and what it waits for.`);
    return { raw, notes, errors };
  }
  const first = milestones[0] as Obj;
  const keeps = typeof first.id === 'string' && MILESTONE_ID.test(first.id.trim());
  const id = keeps ? String(first.id).trim() : 'ms-1';
  const titles = milestones.map((m) => String(m.title ?? '').trim()).filter(Boolean);
  const dones = milestones.map((m) => String(m.doneWhen ?? '').trim()).filter(Boolean);
  const one: Obj = {
    id,
    title: (milestones.length === 1 ? titles[0] : 'Everything the stakeholder asked for') ?? 'Everything the stakeholder asked for',
    doneWhen: (milestones.length === 1 ? dones[0] : dones.map((d, i) => `${i + 1}. ${d}`).join(' ')) ?? 'Everything the stakeholder asked for is built.',
  };
  if (milestones.length > 1) notes.push(`One Builder builds the whole request in one session, so the plan's ${milestones.length} milestones became one; their titles and done-whens stay in it as advice.`);
  const node = (o.topLevel ?? []).some((f) => f === 'package.json') || NODE_WORDS.test(o.prompt ?? '');
  const advice = titles.length > 1 ? ` The plan's advice, in order: ${titles.join('; ')}.` : '';
  const task: Obj = {
    id: `${id}-build`,
    title: 'Build everything the stakeholder asked for',
    owner: builders[0],
    files: builderFiles(o.topLevel),
    milestone: id,
    after: [],
    brief: `Build all of the stakeholder's request, word for word in the brief file, as one session would: the whole request is the target, and the plan is advice, not a ceiling.${advice}`.slice(0, 3_900),
    doneWhen: `Every requirement in the stakeholder's words is built, tested and run the way the user will run it, and the README says how to run it.${node ? ' npm test passes.' : ''}`,
    ...(node ? { check: 'npm test' } : {}),
  };
  const given = Array.isArray(raw.tasks) ? raw.tasks.filter(isObj) : [];
  if (given.some((t) => t.kind !== 'verification')) notes.push("The Builder's task is the office's: one task for the whole request.");
  // Every checklist item is built by that one task.
  const checklist = Array.isArray(raw.checklist) ? raw.checklist.map((k) => (isObj(k) ? { ...k, covers: [task.id] } : k)) : raw.checklist;
  return { raw: { ...raw, milestones: [one], tasks: [task], ...(checklist !== undefined ? { checklist } : {}) }, notes, errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// The loop's plan (H5)

/** The Tester's task for a milestone, as the office writes it into the plan. */
export function testerTask(milestone: { id: string; title: string; doneWhen: string }, id: string, after: string[]): Obj {
  const dir = acceptanceDir(milestone.id);
  return {
    id,
    title: `Acceptance tests: ${milestone.title}`.slice(0, 120),
    owner: TESTER_ID,
    files: [`${dir}/`],
    milestone: milestone.id,
    after,
    // A Tester who wrote nothing gets this back, instead of the Builder's check passing on no tests at all.
    check: testsCheck(milestone.id),
    brief:
      `Write the acceptance tests for this milestone into ${dir}/, before it is built and without reading the Builder's code: ${dir}/${ACCEPTANCE_MAIN} first, and more files beside it if you like (node:test and node:assert, files ending .accept.mjs, a name the project's own test runner never picks up), each test quoting the requirement it checks from the stakeholder's words in the brief file and from the plan's acceptance checks. ` +
      'Test what the user will see: run the CLI with child_process, start the server and call it with fetch, or import a module from process.cwd(), which is the project. Cover the edges the words state or imply. No network, no package the project may not have. ' +
      `The office runs them with "node --test ${dir}/**/*.accept.mjs" when the Builder reports the milestone done.`,
    doneWhen: `Every requirement of the milestone (${milestone.doneWhen.slice(0, 300)}) has a test in ${dir}/ that quotes it, and every file loads with node --check.`,
  };
}

/**
 * The Lead's plan in the loop's shape: for each milestone, the Tester's acceptance tests, then the Builder's build of it,
 * which waits for those tests and for the previous milestone's build, and is checked by the office running them. The
 * Lead sends milestones (with what done means), the checklist and, for two or more Builders, the contracts and each
 * Builder's tasks; with one Builder and no tasks, the office writes the build tasks too. A checklist item may name a
 * milestone in `covers`: it then covers that milestone's build tasks. Returns the plan to check, and what the office did.
 */
export function harnessPlan(raw: Obj, people: readonly { id: string; level?: string }[], o: { topLevel?: readonly string[] } = {}): { raw: Obj; notes: string[]; errors: string[] } {
  const notes: string[] = [];
  const errors: string[] = [];
  const milestones = Array.isArray(raw.milestones) ? raw.milestones.filter(isObj) : [];
  if (milestones.length === 0) return { raw, notes, errors };
  const builders = people.filter((p) => seatOf(p) === 'builder').map((p) => p.id);
  const tester = people.find((p) => seatOf(p) === 'tester');
  if (builders.length === 0) return { raw, notes, errors };
  // Milestones need ids for the tasks to name; the Lead's own are kept when a plan can keep them, the rest get ms-1, ms-2, ….
  const keeps = (m: Obj): boolean => typeof m.id === 'string' && MILESTONE_ID.test(m.id.trim());
  const taken = new Set(milestones.filter(keeps).map((m) => String(m.id).trim()));
  let next = 1;
  const ms: (Obj & { id: string })[] = milestones.map((m) => {
    if (keeps(m)) return { ...m, id: String(m.id).trim() };
    while (taken.has(`ms-${next}`)) next += 1;
    taken.add(`ms-${next}`);
    return { ...m, id: `ms-${next}` };
  });
  const given = Array.isArray(raw.tasks) ? raw.tasks.filter(isObj) : [];
  // The Lead's own tests for the Tester are the office's to write; anything else it gave is kept.
  const lead = given.filter((t) => t.owner !== TESTER_ID && t.kind !== 'verification');
  if (given.length !== lead.length) notes.push("The Tester's tasks are the office's: one per milestone, before its build.");
  if (builders.length > 1) {
    const contracts = Array.isArray(raw.contracts) ? raw.contracts.filter(isObj) : [];
    if (contracts.length === 0) {
      errors.push(`This company has ${builders.length} Builders, and the plan names no contract between their parts. Give contracts: the file each part shares with another (an API's routes, a schema), written first by one Builder's task, with the other's tasks waiting for it. Or keep one Builder.`);
    }
    if (lead.length === 0) errors.push(`With ${builders.length} Builders, give each Builder's tasks: an owner, the files of their part, its milestone and what it waits for.`);
  }
  const buildOf = new Map<string, string[]>();
  let tasks: Obj[];
  // The office's task ids come from their milestone, so a revision that adds or drops a milestone keeps every other id
  // (an approved plan's board tasks are tied to them).
  const takenTaskIds = new Set(lead.map((t) => (typeof t.id === 'string' ? t.id : '')).filter(Boolean));
  const idFor = (milestone: string, what: 'tests' | 'build'): string => {
    let x = `${milestone}-${what}`;
    for (let k = 2; takenTaskIds.has(x); k += 1) x = `${milestone}-${what}-${k}`;
    takenTaskIds.add(x);
    return x;
  };
  const msKey = (m: unknown): string | null => {
    const said = typeof m === 'string' ? m.trim() : '';
    return ms.find((x) => x.id === said || String(x.title ?? '').toLowerCase() === said.toLowerCase())?.id ?? null;
  };
  if (lead.length === 0) {
    // One Builder: the build of each milestone is one task, owning the project, after the previous milestone's build.
    tasks = [];
    let previous: string | null = null;
    for (const m of ms) {
      const build = idFor(m.id, 'build');
      const title = String(m.title ?? m.id);
      tasks.push({
        id: build,
        title: `Build: ${title}`.slice(0, 120),
        owner: builders[0],
        files: builderFiles(o.topLevel),
        milestone: m.id,
        after: previous ? [previous] : [],
        brief: `Build the milestone "${title.slice(0, 200)}" from the stakeholder's words in the brief file, so its acceptance tests in ${acceptanceDir(String(m.id))}/ pass as written. Done when: ${String(m.doneWhen ?? '').slice(0, 1500)}`,
        doneWhen: `The acceptance tests in ${acceptanceDir(String(m.id))}/ pass, the project's own tests pass, and ${String(m.doneWhen ?? 'the milestone is built').slice(0, 600)}`,
        check: acceptanceCheck(String(m.id)),
      });
      buildOf.set(String(m.id), [build]);
      previous = build;
    }
    notes.push('The office wrote the build tasks: one per milestone, for the Builder, in order.');
  } else {
    tasks = lead.map((t) => {
      const m = msKey(t.milestone);
      const t2: Obj = { ...t };
      if (m) {
        const list = buildOf.get(m) ?? [];
        list.push(typeof t.id === 'string' && t.id ? t.id : String(t.title ?? ''));
        buildOf.set(m, list);
        // The office runs the milestone's acceptance tests on every Builder task of it, before the Lead's own check.
        const own = typeof t.check === 'string' && t.check.trim() ? t.check.trim() : '';
        const acc = acceptanceCheck(m);
        if (!own.includes(acceptanceDir(m))) {
          const both = own ? `${acc} && ${own}` : acc;
          // Never cut a command: past a check's length the office runs the acceptance tests, and says it dropped the rest.
          t2.check = both.length <= 200 ? both : acc;
          if (both.length > 200) notes.push(`${String(t.id ?? t.title ?? 'A task')}'s own check was dropped: with the acceptance tests it was longer than a check can be, so the office runs the acceptance tests.`);
        }
      }
      return t2;
    });
  }
  // The Tester's task per milestone, which every build task of the milestone waits for. Tests for the next milestone
  // wait only for the previous tests, so they are written while the Builder builds, and the Builder stays warm.
  const testTasks: Obj[] = [];
  let previousTests: string | null = null;
  if (tester) {
    for (const m of ms) {
      const t = testerTask({ id: String(m.id), title: String(m.title ?? m.id), doneWhen: String(m.doneWhen ?? '') }, idFor(m.id, 'tests'), previousTests ? [previousTests] : []);
      testTasks.push(t);
      previousTests = String(t.id);
      const builds = buildOf.get(String(m.id)) ?? [];
      for (const b of tasks) {
        const key = typeof b.id === 'string' && b.id ? b.id : String(b.title ?? '');
        if (!builds.includes(key)) continue;
        const after = Array.isArray(b.after) ? b.after.filter((a): a is string => typeof a === 'string') : [];
        if (!after.includes(String(t.id))) b.after = [...after, String(t.id)];
      }
    }
    notes.push('The office added the Tester\'s acceptance tests before each milestone\'s build, and the build is checked by running them.');
  }
  // A checklist item that names a milestone covers that milestone's build tasks.
  let checklist = raw.checklist;
  const allBuilds = new Set(tasks.map((t) => (typeof t.id === 'string' && t.id ? t.id : String(t.title ?? ''))));
  if (Array.isArray(checklist)) {
    checklist = checklist.map((item) => {
      if (!isObj(item)) return item;
      if (!Array.isArray(item.covers)) return { ...item, covers: [...allBuilds] };
      const covers = [...new Set(item.covers.flatMap((c) => {
        const m = msKey(c);
        return m ? (buildOf.get(m) ?? []) : [c];
      }))];
      // An item that names nothing the plan builds is built by the Builder anyway: it covers every build task.
      return { ...item, covers: covers.some((c) => allBuilds.has(String(c))) ? covers : [...allBuilds] };
    });
  }
  return { raw: { ...raw, milestones: ms, tasks: [...testTasks, ...tasks], ...(checklist !== undefined ? { checklist } : {}) }, notes, errors };
}
