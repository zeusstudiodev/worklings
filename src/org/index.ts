// The org flow's writes (OrgOps in src/core/company.ts), so a company never writes .claude/ itself: founding a company
// with its CEO, the CEO's first turn, the catalogue, checking and writing the CEO's proposal, hiring, firing, moving
// and rehiring people, and office changes. All of it goes through the code v1 writes studios with (the composer's
// agentFile and writePlan, tailor's notes, reshape's changes), stays inside the project's .claude folder and
// CLAUDE.md's block, changes nothing while studio.yaml has a mistake, and leaves a studio parseStudio accepts.
// Refusals are OrgRefusals with a sentence saying why.
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentContext, PlannedFile } from '../composer/compose.ts';
import { detect } from '../composer/detect.ts';
import type { Library } from '../composer/library.ts';
import { TailorError } from '../composer/tailor.ts';
import { writePlan } from '../composer/write.ts';
import { type CatalogueEntry, type HireInput, introduce, LIMITS, type OfficeChange, type OrgOps, OrgRefusal, type Person, peopleOf } from '../core/company.ts';
import { BASE_DEPARTMENT_INFO, isBaseDepartment } from '../core/departments.ts';
import { DEPARTMENT_ORDER } from '../core/infer.ts';
import { installedNames } from '../server/claude-config.ts';
import { approvedLoads, recordApproved } from './approved-loads.ts';
import { DEFAULT_PRESET, type ModelsByLevel, type PresetId, presetGuidance, PRESETS } from '../core/presets.ts';
import type { CompanyShape } from '../core/harness-shape.ts';
import { andList, applyOfficeChange, checkProposal, MAX_OFFICE_ROOMS, OFFICE_ROOMS, type OrgProposal, type ProposalKnown, type ProposedPerson } from '../core/org.ts';
import type { ReshapeResult } from '../core/snapshot.ts';
import { inSentence, type Studio, type StudioDepartment, type StudioOffice, type StudioRole } from '../core/studio.ts';
import { capital } from '../core/words.ts';
import { PACKAGE_JSON } from '../paths.ts';
import { plainPath } from '../safe-fs.ts';
import { agentFileOf, MANIFEST } from '../server/project.ts';
import { applyReshape, inClaude, manifestText, planChange, type Reshaped, ReshapeError, studioForChange, writeManifest } from '../server/reshape.ts';
import { backTo, lintNewRole, onlyNotesDiffer, orgAgentFile, ownsNote, placeNote, roleFromLibrary, roleFromProposal, staffOf, tailorPerson } from './agents.ts';
import { companyBlock, describedOnDisk, refreshBlock } from './claude-md.ts';

/**
 * `installed` names the MCP servers a person's `loads.mcp` may use: what the user has installed (read from Claude Code's
 * own files each time it is asked, since they change under a running office); a test gives its own.
 */
export function orgOps(library: Library, installed: () => ReadonlySet<string> | null = () => installedNames(process.env)): OrgOps {
  const base = { libraryRoles: new Set(library.roles.keys()), lintRole: (draft: Parameters<typeof lintNewRole>[1]) => lintNewRole(library, draft) };
  const known = (): ProposalKnown => ({ ...base, mcpServers: installed() });
  return {
    found: (root, prompt, title) => refusals(() => found(root, prompt, library, title)),
    openingTurn,
    catalogue: () => catalogue(library),
    // The stakeholder's own edits come with enforceSize false: the CEO's size, its shape and its sizing never block them.
    check: (raw, options) =>
      checkProposal(raw, {
        ...known(),
        ...(options?.enforceSize === false ? { enforceSize: false } : {}),
        ...(options?.models ? { models: options.models } : {}),
        ...(options?.preset ? { preset: options.preset } : {}),
        ...(options?.harness === true ? { harness: true } : {}),
        ...(options?.solo === true ? { solo: true } : {}),
      }),
    write: (root, proposal) => refusals(() => writeOrg(root, proposal, library, known())),
    hire: (root, input) => refusals(() => hire(root, library, input)),
    fire: (root, role) => refusals(() => fire(root, library, role)),
    move: (root, input) => refusals(() => move(root, library, input)),
    rehire: (root, role) => refusals(() => rehire(root, library, role)),
    changeOffice: (root, change) => refusals(() => changeOffice(root, change)),
    // The agent file's model line, as reshape changes it from the office; the person's place in the org stays.
    model: (root, input) => refusals(() => applyReshape({ root, library }, { action: 'model', role: input.role, model: input.model }).result),
  };
}

/** Reshape's refusals are OrgRefusals already; tailoring's become one, so callers handle one kind. */
function refusals<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TailorError) throw new OrgRefusal('invalid', error.message);
    throw error;
  }
}

let version: string | null = null;
const packageVersion = (): string => (version ??= (JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version?: string }).version ?? '0.0.0');

const unique = (paths: string[]) => [...new Set(paths)];

/** "Lu" in a sentence, or "the SEO specialist" for someone without a name. */
const short = (p: Person) => (p.name === p.title ? `the ${inSentence(p.title)}` : p.name);
/** introduce() inside a sentence: "Lu, SEO specialist," closes its comma before the sentence goes on. */
const mid = (p: Person) => (p.name === p.title ? introduce(p) : `${introduce(p)},`);

function personIn(studio: Studio, roleId: string): Person {
  const person = peopleOf(studio).find((p) => p.id === roleId);
  if (!person) throw new Error(`"${roleId}" should be in the studio after the change`);
  return person;
}

const managerOf = (studio: Studio, person: Person) => (person.reportsTo ? peopleOf(studio).find((p) => p.id === person.reportsTo) : undefined);
const roomName = (studio: Studio, id: string) => studio.departments.find((d) => d.id === id)?.name ?? id;

// ---------------------------------------------------------------------------------------------------------------
// The CEO's start

/** The prompt as the CEO's agent file says what the project is: one line, and not the whole of a long one. */
function ideaOf(prompt: string): string {
  const line = prompt.replace(/[\s\p{Cc}]+/gu, ' ').trim();
  if (line.length <= 300) return line;
  const cut = line.slice(0, 300);
  const space = cut.lastIndexOf(' ');
  return `${space > 200 ? cut.slice(0, space) : cut}…`;
}

/** Where the CEO sits: the studio's direction room, made when it has none. */
function directionRoom(studio: Studio): StudioDepartment {
  const room = studio.departments.find((d) => d.style === 'direction') ?? studio.departments.find((d) => d.id === 'direction');
  if (room) return room;
  const direction: StudioDepartment = { id: 'direction', name: BASE_DEPARTMENT_INFO.direction.name, style: 'direction' };
  studio.departments.unshift(direction);
  return direction;
}

/**
 * A new company: the CEO from the library's ceo role, at level ceo in the direction room, first on the staff. Roles an
 * earlier studio has stay until the org is written, which fires those the CEO leaves out.
 */
function found(root: string, prompt: string, library: Library, title?: string): ReshapeResult {
  const archetype = library.roles.get('ceo');
  if (!archetype) throw new OrgRefusal('unknown', "The library has no ceo role, so there's no CEO to found the company with.");
  const fresh = !existsSync(inClaude(root, MANIFEST));
  const earlier = studioForChange(root);
  const studio = structuredClone(earlier);
  if (fresh && !studio.generator) studio.generator = { tool: 'worklings', version: packageVersion() };
  const room = directionRoom(studio);
  const current = studio.roles.find((r) => r.id === 'ceo');
  const ceo: StudioRole = { id: 'ceo', department: current?.department ?? room.id, title: current?.title ?? title ?? archetype.title };
  if (current?.name) ceo.name = current.name;
  ceo.level = 'ceo';
  if (current?.look) ceo.look = current.look;
  ceo.archetype = 'ceo';
  studio.roles = [ceo, ...studio.roles.filter((r) => r.id !== 'ceo')];
  // A CEO fired by hand comes back fresh; its archived file stays where it is.
  studio.fired = studio.fired.filter((f) => f.id !== 'ceo');

  const context: AgentContext = { name: studio.name, idea: ideaOf(prompt), detection: detect(root, library), rules: studio.rules.map((r) => r.id), stacks: [] };
  const style = studio.departments.find((d) => d.id === ceo.department)?.style ?? 'direction';
  const content = orgAgentFile(roleFromLibrary(archetype, { id: 'ceo', title: ceo.title, style, model: archetype.model }), staffOf(studio), library, context, 'the stakeholder');
  const onDisk = describedOnDisk(root, studio);
  const block = companyBlock(studio, (roleId) => (roleId === 'ceo' ? archetype.description : onDisk(roleId)));
  const written = writeStudio(root, studio, [{ id: 'ceo', content, earlier: current }], block);
  const notes = tailorPerson(root, studio, 'ceo', []);
  const others = studio.roles.length - 1;
  const here = others === 0 ? '' : `, next to the ${others === 1 ? 'role' : `${others} roles`} already here, who stay until the org is written`;
  return {
    ok: true,
    message: `Founded the company with its CEO in ${room.name}${here}. The CEO drafts the org from your prompt.`,
    changed: unique([...written.changed, ...(notes ? [notes] : [])]),
  };
}

/**
 * v0.4 (SPEC-v0.4.md, H1): the Lead's opening turn in a harness-shaped company. The seats are fixed, so there is no
 * catalogue to read and no size to argue: the Lead scopes, proposes the seats with a name and a goal, and later plans
 * milestones, not a task split.
 */
function harnessOpening(quoted: string[], long: boolean, detected: string, preset: PresetId, models: ModelsByLevel | undefined, shape: 'harness' | 'solo' = 'harness'): string {
  const p = PRESETS[preset];
  const m = models ?? p.models;
  if (shape === 'solo') {
    return [
      `You are founding a new company and you are its Lead.${long ? '' : ' The stakeholder asked for this:'}`,
      '',
      ...quoted,
      '',
      `What detection found in the project folder: ${detected.trim() || 'nothing.'}`,
      '',
      `This company works like one strong session with a second pair of eyes. You (the Lead) scope, write a short plan the Builder takes as advice, and hand over at the end. One Builder builds the whole request in one warm session, from the stakeholder's words verbatim, splitting divisible work into helpers of their own. Then an independent Reviewer runs the result and its tests and lists what is wrong, and the Builder fixes it. Thoroughness: ${p.label} (the default until the stakeholder chooses); the office asks "How thorough?" itself, so don't ask about size, cost or thoroughness. Models are set from it (you ${m.ceo}, everyone else ${m.worker}): leave models out.`,
      '',
      'Now:',
      "1. Read the request for what it settles. When it is short, vague or leaves real choices open (who it is for, the scope, the platforms, the quality bar, constraints), your first move is ask_scoping: up to three questions for a small job, else three to five, each with two to four options, your pick (the simplest option that satisfies the request, never a feature it didn't ask for) and a line on why. Then end your turn; the answers come in one message. When the request settles these, ask nothing and go on.",
      '2. Send the org with propose_org: the company named after what it builds, the goal, the theme, rooms (a "direction" room for you, an "engineering" room for the Builder, a "quality" room for the Reviewer), and the people: you (level ceo), one Builder (library "builder", or a specialist library role such as "frontend-engineer" when one area dominates) and the Reviewer (library "reviewer"), everyone reporting to you, each with a first name and one sentence of what they own. No heads and no tester. The office titles the seats and adds a missing Reviewer.',
      "3. A second Builder only when the job has parts with an agreed contract between them, each too big for one session; the plan must then name that contract. size is small for one Builder; sizing says why in one line.",
      "4. Put the decisions that are still the stakeholder's in the proposal's questions, each with two to four options and your pick. Then wait for the stakeholder to start the company.",
    ].join('\n');
  }
  return [
    `You are founding a new company and you are its Lead.${long ? '' : ' The stakeholder asked for this:'}`,
    '',
    ...quoted,
    '',
    `What detection found in the project folder: ${detected.trim() || 'nothing.'}`,
    '',
    `This company is shaped like a harness, not a company chart. You (the Lead) scope, plan in milestones and hand over, and sleep while it is built. One Builder owns the whole codebase and builds every milestone in one warm session, splitting divisible work into helpers of their own. The Tester writes acceptance tests from the stakeholder's words before each milestone is built, and the office runs them when the Builder says it is done. The Reviewer gives the one independent final review. Thoroughness: ${p.label} (the default until the stakeholder chooses); the office asks "How thorough?" itself, so don't ask about size, cost or thoroughness. Models are set from it (you ${m.ceo}, everyone else ${m.worker}): leave models out.`,
    '',
    'Now:',
    "1. Read the request for what it settles. When it is short, vague or leaves real choices open (who it is for, the scope, the platforms, the quality bar, constraints), your first move is ask_scoping: up to three questions for a small job, else three to five, each with two to four options, your pick (the simplest option that satisfies the request, never a feature it didn't ask for) and a line on why. Then end your turn; the answers come in one message. When the request settles these, ask nothing and go on.",
    '2. Send the org with propose_org: the company named after what it builds, the goal, the theme, rooms (a "direction" room for you, an "engineering" room for Builders, a "quality" room for the Tester and the Reviewer), and the people: you (level ceo), one Builder (library "builder", or a specialist library role such as "frontend-engineer" when one area dominates, which the Builder then carries), the Tester (library "tester") and the Reviewer (library "reviewer"), everyone reporting to you, each with a first name and one sentence of what they own. No heads. The office titles the seats and adds a missing Tester or Reviewer.',
    "3. A second Builder only when the job has parts with an agreed contract between them (a web front end and its API, a game's engine and its content), each big enough for a session of its own; the plan must then name that contract. size is small for one Builder, medium for two to four; sizing says why in one line.",
    "4. Put the decisions that are still the stakeholder's in the proposal's questions, each with two to four options and your pick. Then wait for the stakeholder to start the company.",
  ].join('\n');
}

/** The CEO's first turn. Short: the ceo role's file carries the rules for the org. */
function openingTurn({
  prompt,
  detected,
  studio,
  preset = DEFAULT_PRESET,
  models,
  shape = 'classic',
  brief = null,
}: {
  prompt: string;
  detected: string;
  studio: Studio | null;
  preset?: PresetId;
  models?: ModelsByLevel;
  shape?: CompanyShape;
  brief?: string | null;
}): string {
  // v0.4 (B1): a first prompt past what a turn quotes is read whole from the brief file, never cut or paraphrased here.
  const long = prompt.trim().length > LIMITS.promptInline && brief !== null;
  const quoted = long
    ? [
        `The stakeholder's request is long (${prompt.trim().length.toLocaleString('en-US')} characters), so it is not repeated here: it is in the brief file, ${brief}, word for word between two marker lines (stakeholder_words returns it too). Read all of it before anything else; every limit, name and format in it is a requirement.`,
      ]
    : prompt
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`.trimEnd());
  if (shape === 'harness' || shape === 'solo') return harnessOpening(quoted, long, detected, preset, models, shape);
  const lines = [
    `You are founding a new company, and its first task is the org.${long ? '' : ' The stakeholder asked for this:'}`,
    '',
    ...quoted,
    '',
    `What detection found in the project folder: ${detected.trim() || 'nothing.'}`,
  ];
  const others = (studio?.roles ?? []).filter((r) => r.id !== 'ceo');
  if (others.length > 0) {
    const listed = others.slice(0, 40).map((r) => `${r.id} (${inSentence(r.title)})`);
    lines.push(
      '',
      `The project already has a studio of ${others.length === 1 ? 'one role' : `${others.length} roles`}: ${listed.join(', ')}${others.length > 40 ? ' and more' : ''}. ` +
        'Keep the ones the work needs under the same ids; those you leave out are fired when the company starts, and can be rehired.',
    );
  }
  lines.push(
    '',
    ...presetGuidance(preset, false, models),
    'The office asks the stakeholder "How thorough?" itself, with the three presets and what each costs, so do not ask about size, cost or thoroughness; if they pick another preset, the office tells you and you revise.',
  );
  lines.push(
    '',
    'Now:',
    '1. Read the request for what it settles. When it is short, vague or leaves real choices open (who it is for, the scope and ' +
      'ambition, the platforms, the quality bar, constraints and must-haves), your first move is ask_scoping: three to five ' +
      'questions (at most three when the job looks small), each with two to four options, your pick and a line on why. Your pick is ' +
      "the simplest option that satisfies the request, never a feature it didn't ask for; extras are options that aren't your pick. Then end your turn: the answers come to you in " +
      'one message, and you draft from them. When the request already settles these, go on to 2 with fewer questions or none.',
    '2. Call library_catalogue for the roles you can hire.',
    '3. Judge the size first, from the job\'s parts: small (you and one maker, for one deliverable: a script, a CLI or a one-page tool), ' +
      'medium (you and 2 to 4 makers, flat, for two to four independent streams) or large (5 or more makers, for five or more streams; ' +
      'heads only when more than 6 makers need briefing, each briefing 3 or more). Pick at or under what the preset above allows, and send the org with propose_org, with size and ' +
      'the reason in sizing. Everyone reports to you unless a head exists. Name the company after what the stakeholder is building, not the folder. Give every niche area the work ' +
      'implies its own specialist, and write the role when the library has only a generic one (a TWINT payments engineer ' +
      'rather than a backend engineer, local search for a local business). If it is refused, fix what each sentence names and ' +
      'send it again.',
    "4. Put the decisions that are still the stakeholder's in the proposal's questions, each with two to four options and your pick.",
    'Then wait for the stakeholder, who reads the chart, may ask for changes, and starts the company.',
  );
  return lines.join('\n');
}

/** Every library role, by room in the office's order and then by id. */
function catalogue(library: Library): CatalogueEntry[] {
  const order = (r: { department: string }) => DEPARTMENT_ORDER.findIndex((d) => d === r.department);
  return [...library.roles.values()]
    .sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, title: r.title, department: r.department, description: r.description, model: r.model }));
}

// ---------------------------------------------------------------------------------------------------------------
// Writing a studio

interface AgentToWrite {
  id: string;
  content: string;
  /** The role as the earlier studio had it, to find its old file. */
  earlier: StudioRole | undefined;
}

/**
 * Writes agent files, studio.yaml and CLAUDE.md's block through the composer's writePlan, which backs up every file it
 * replaces. `first` runs before (the firings of a new org). Every path is checked for links before anything changes.
 */
function writeStudio(root: string, studio: Studio, agents: readonly AgentToWrite[], claudeBlock: string, first: (() => string[])[] = []): { changed: string[]; backups: number } {
  const now = new Date();
  const backup = `.claude/studio/backup/${now.toISOString().replace(/[:.]/g, '-')}`;
  const files: PlannedFile[] = [];
  const relocate: string[] = [];
  for (const { id, content, earlier } of agents) {
    const path = `.claude/agents/${id}.md`;
    const target = inClaude(root, path);
    // An agent kept under another file (an adopted studio's "Frontend Developer") would load twice next to the new one.
    const old = earlier ? agentFileOf(root, earlier) : undefined;
    if (old && old !== path) relocate.push(old);
    // Unchanged but for its notes, which tailoring writes next: left alone, so writing the same org twice backs up nothing.
    if (existsSync(target) && onlyNotesDiffer(readFileSync(target, 'utf8'), content)) continue;
    files.push({ path, content, kind: 'agent' });
  }
  files.push({ path: MANIFEST, content: manifestText(studio), kind: 'manifest' });
  for (const old of relocate) {
    inClaude(root, old);
    inClaude(root, `${backup}/${old}`);
  }
  plainPath(root, 'CLAUDE.md', ReshapeError);

  const changed = first.flatMap((run) => run());
  for (const old of relocate) {
    const to = inClaude(root, `${backup}/${old}`);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(inClaude(root, old), to);
    changed.push(old);
  }
  const result = writePlan(root, { studio, files, claudeBlock, notes: [] }, { force: true, now });
  return { changed: unique([...changed, ...result.written]), backups: result.backups.length + relocate.length };
}

function personRole(p: ProposedPerson, earlier: Studio, root: string): StudioRole {
  const role: StudioRole = { id: p.id, department: p.room, title: p.title, name: p.name, level: p.level };
  if (p.reportsTo) role.reportsTo = p.reportsTo;
  // A look the stakeholder gave someone stays unless the proposal gives another.
  const look = p.look && Object.keys(p.look).length > 0 ? p.look : earlier.roles.find((r) => r.id === p.id)?.look;
  if (look) role.look = look;
  // What a person loads: the proposal's, else what the stakeholder had already approved for them (a file's own isn't enough).
  const loads = p.loads ?? approvedLoads(root, earlier.roles.find((r) => r.id === p.id));
  if (loads) role.loads = loads;
  if (p.library) role.archetype = p.library;
  return role;
}

/** The office of a new org: its theme, the meeting room and the CEO's office, and what an earlier office held. */
function officeFor(proposal: OrgProposal, earlier: StudioOffice | undefined, rooms: readonly StudioDepartment[]): StudioOffice {
  const taken = new Set(rooms.map((d) => d.id));
  const standard = OFFICE_ROOMS.map((room) => earlier?.rooms.find((r) => r.id === room.id) ?? { ...room });
  const kept = (earlier?.rooms ?? []).filter((r) => !OFFICE_ROOMS.some((o) => o.id === r.id) && !taken.has(r.id));
  return { theme: proposal.theme, rooms: [...standard, ...kept].slice(0, MAX_OFFICE_ROOMS), decor: [...(earlier?.decor ?? [])] };
}

/**
 * Writes an accepted proposal: every person's agent file (a library role or one written for the company, with notes
 * on their place, what they own and the CEO's notes), studio.yaml with a department per room, the org fields and an
 * office, and CLAUDE.md's block. Roles of the earlier studio that the proposal leaves out are fired, so a rehire
 * brings any of them back; rules, gates and skills stay, in a room of the same style.
 */
function writeOrg(root: string, raw: OrgProposal, library: Library, known: ProposalKnown): ReshapeResult {
  // Checked again where ids become file names. An org the stakeholder edited isn't held to the CEO's 2 to 25.
  const check = checkProposal(raw, { ...known, enforceSize: false });
  if (!check.ok) {
    const more = check.errors.length > 1 ? ` (and ${check.errors.length - 1} more)` : '';
    throw new OrgRefusal('invalid', `The proposal has a problem, so nothing was written: ${check.errors[0] ?? ''}${more}.`);
  }
  const proposal = check.proposal;
  const earlier = studioForChange(root);
  const studio = structuredClone(earlier);
  const keep = new Set(proposal.people.map((p) => p.id));

  const fires: (() => string[])[] = [];
  const fired: string[] = [];
  const gone: string[] = [];
  for (const r of earlier.roles) {
    if (keep.has(r.id)) continue;
    if (!agentFileOf(root, r)) {
      studio.roles = studio.roles.filter((x) => x.id !== r.id);
      gone.push(r.id);
      continue;
    }
    fires.push(...planChange({ root, library }, studio, { action: 'fire', role: r.id }).files);
    fired.push(r.id);
  }

  const rooms: StudioDepartment[] = proposal.rooms.map((room) => (room.theme ? { id: room.id, name: room.title, style: room.style, theme: room.theme } : { id: room.id, name: room.title, style: room.style }));
  const extra: StudioDepartment[] = [];
  /** A rule's or gate's room in the new org: the same one, one of the same style, or else its old room, kept. */
  const roomFor = (id: string): string => {
    if (rooms.some((d) => d.id === id) || extra.some((d) => d.id === id)) return id;
    const old = earlier.departments.find((d) => d.id === id);
    const style = old?.style ?? (isBaseDepartment(id) ? id : undefined);
    const same = style ? rooms.find((d) => d.style === style) : undefined;
    if (same) return same.id;
    if (old) extra.push(old);
    return id;
  };
  studio.rules = studio.rules.map((r) => ({ ...r, department: roomFor(r.department) }));
  studio.gates = studio.gates.map((g) => ({ ...g, from: roomFor(g.from), to: roomFor(g.to) }));
  studio.departments = [...rooms, ...extra];
  studio.name = proposal.company;
  studio.roles = proposal.people.map((p) => personRole(p, earlier, root));
  // Someone fired before whom the proposal hires again leaves the fired list; the archived file stays as it is.
  studio.fired = studio.fired.filter((f) => !keep.has(f.id));
  studio.office = officeFor(proposal, earlier.office, rooms);
  if (!studio.generator) studio.generator = { tool: 'worklings', version: packageVersion() };

  const staff = staffOf(studio);
  const people = peopleOf(studio);
  const context: AgentContext = { name: studio.name, idea: proposal.goal, detection: detect(root, library), rules: studio.rules.map((r) => r.id), stacks: [] };
  const agents = proposal.people.map((p): AgentToWrite => {
    const seat = { id: p.id, title: p.title, style: proposal.rooms.find((r) => r.id === p.room)?.style ?? 'engineering', model: p.model };
    const base = p.library ? library.roles.get(p.library) : undefined;
    const role = base ? roleFromLibrary(base, seat) : p.role ? roleFromProposal(p.role, seat) : null;
    if (!role) throw new Error(`checkProposal accepted ${p.id} without a library role or a role of its own`);
    const person = people.find((x) => x.id === p.id);
    const back = person ? backTo(people, person) : null;
    return { id: p.id, content: orgAgentFile(role, staff, library, context, back), earlier: earlier.roles.find((r) => r.id === p.id) };
  });
  const describe = new Map(proposal.people.map((p) => [p.id, p.library ? (library.roles.get(p.library)?.description ?? '') : (p.role?.description ?? '')]));
  const written = writeStudio(root, studio, agents, companyBlock(studio, (roleId) => describe.get(roleId) ?? ''), fires);
  // The stakeholder started or approved this org: what its people load is what the desks may use (approved-loads.ts).
  recordApproved(root, studio.roles);

  const changed = [...written.changed];
  for (const p of proposal.people) {
    const file = tailorPerson(root, studio, p.id, [ownsNote(p.owns), ...(p.notes ?? [])]);
    if (file) changed.push(file);
  }
  const roomCount = proposal.rooms.length === 1 ? 'one room' : `${proposal.rooms.length} rooms`;
  const parts = [`Wrote the org of ${proposal.company}: ${proposal.people.length} people in ${roomCount}, with a meeting room and the CEO's office.`];
  if (fired.length > 0) parts.push(`Fired ${andList(fired)}, whom the proposal leaves out; rehiring brings any of them back.`);
  if (gone.length > 0) parts.push(`Took ${andList(gone)} off the staff: ${gone.length === 1 ? 'its agent file was' : 'their agent files were'} gone already.`);
  if (written.backups > 0) parts.push('The files it replaced are backed up in .claude/studio/backup/.');
  return { ok: true, message: parts.join(' '), changed: unique(changed) };
}

// ---------------------------------------------------------------------------------------------------------------
// Changes once the company runs

/**
 * After a change: the place note of everyone whose place changed (a new manager, someone back), and CLAUDE.md's block.
 * A file that can't take notes keeps its old line, and the message says so.
 */
function settle(root: string, done: Reshaped, message: string): ReshapeResult {
  const changed = [...done.result.changed];
  const problems: string[] = [];
  const was = peopleOf(done.before);
  const now = peopleOf(done.after);
  for (const person of now) {
    const before = was.find((p) => p.id === person.id);
    if (before && placeNote(was, before) === placeNote(now, person)) continue;
    try {
      const file = tailorPerson(root, done.after, person.id);
      if (file) changed.push(file);
    } catch (error) {
      if (!(error instanceof TailorError)) throw error;
      problems.push(`The agent file of ${mid(person)} still gives their old place: ${error.message}`);
    }
  }
  const block = refreshBlock(root, done.after);
  if (block) changed.push(block);
  return { ok: true, message: [message, ...problems].join(' '), changed: unique(changed) };
}

/**
 * A hire after the start: a library role, a second person holding one (`id`), or a role written for the company
 * (`written`, checked by the library linter). Without a `level` a head is hired as a head and anyone else as a worker;
 * someone hired back from the fired list keeps the level they had.
 */
function hire(root: string, library: Library, input: HireInput): ReshapeResult {
  const personId = input.id ?? input.role;
  const back = !input.written && studioForChange(root).fired.some((f) => f.id === personId);
  const level = input.level ?? (back ? null : input.role === 'head' ? 'head' : input.role === 'ceo' ? 'ceo' : 'worker');
  const done = applyReshape(
    { root, library },
    { action: 'hire', role: input.role, id: input.id, department: input.room, reportsTo: input.reportsTo, name: input.name, title: input.title, level, written: input.written },
  );
  const person = personIn(done.after, personId);
  const boss = managerOf(done.after, person);
  const where = `${mid(person)} in ${roomName(done.after, person.room)}${boss ? `, reporting to ${introduce(boss)}` : ''}`;
  return settle(root, done, `Hired ${back ? 'back ' : ''}${where}. Firing ${short(person)} undoes it.`);
}

function fire(root: string, library: Library, roleId: string): ReshapeResult {
  const done = applyReshape({ root, library }, { action: 'fire', role: roleId });
  const was = peopleOf(done.before);
  const person = personIn(done.before, roleId);
  const handed = peopleOf(done.after).filter((p) => was.find((b) => b.id === p.id)?.reportsTo === roleId);
  const parts = [`Fired ${introduce(person)}.`];
  const heir = handed[0] ? managerOf(done.after, handed[0]) : undefined;
  const names = andList(handed.map(short));
  if (handed.length > 0) parts.push(`${capital(names)} ${handed.length === 1 ? 'reports' : 'report'} to ${heir ? introduce(heir) : 'nobody'} now.`);
  const undo = `Rehiring ${short(person)} undoes it${handed.length > 0 ? ` and puts ${names} back under ${short(person)}` : ''}`;
  parts.push(`${undo}; the agent file waits in .claude/studio/fired/.`);
  return settle(root, done, parts.join(' '));
}

function move(root: string, library: Library, input: { role: string; room: string; reportsTo: string | null }): ReshapeResult {
  const done = applyReshape({ root, library }, { action: 'move', role: input.role, department: input.room, reportsTo: input.reportsTo });
  if (done.result.changed.length === 0) return done.result;
  const was = personIn(done.before, input.role);
  const now = personIn(done.after, input.role);
  const moved = was.room !== now.room;
  const boss = was.reportsTo === now.reportsTo ? undefined : managerOf(done.after, now);
  const oldBoss = boss ? managerOf(done.before, was) : undefined;
  const room = roomName(done.after, now.room);
  const oldRoom = roomName(done.before, was.room);
  let message: string;
  if (moved && boss) message = `Moved ${mid(now)} to ${room}, reporting to ${introduce(boss)}. Moving ${short(now)} back to ${oldRoom}${oldBoss ? ` under ${short(oldBoss)}` : ''} undoes it.`;
  else if (moved) message = `Moved ${mid(now)} to ${room}. Moving ${short(now)} back to ${oldRoom} undoes it.`;
  else message = `${capital(mid(now))} reports to ${boss ? introduce(boss) : 'nobody'} now. Moving ${short(now)} back${oldBoss ? ` under ${short(oldBoss)}` : ''} undoes it.`;
  return settle(root, done, message);
}

/** A rehire: back in their place, with the people fire handed up back under them unless they were moved since. */
function rehire(root: string, library: Library, roleId: string): ReshapeResult {
  const done = applyReshape({ root, library }, { action: 'rehire', role: roleId });
  const person = personIn(done.after, roleId);
  const boss = managerOf(done.after, person);
  const reports = done.before.fired.find((f) => f.id === roleId)?.reports ?? [];
  const now = peopleOf(done.after);
  const returned = now.filter((p) => reports.includes(p.id) && p.reportsTo === roleId);
  const stayed = now.filter((p) => reports.includes(p.id) && p.reportsTo !== roleId);
  const parts = [`Rehired ${mid(person)} in ${roomName(done.after, person.room)}${boss ? `, reporting to ${introduce(boss)}` : ''}.`];
  if (returned.length > 0) parts.push(`${capital(andList(returned.map(short)))} ${returned.length === 1 ? 'reports' : 'report'} to ${short(person)} again.`);
  if (stayed.length > 0) parts.push(`${capital(andList(stayed.map(short)))} ${stayed.length === 1 ? 'was moved since and stays' : 'were moved since and stay'} where they are.`);
  parts.push(`Firing ${short(person)} again undoes it.`);
  return settle(root, done, parts.join(' '));
}

function changeOffice(root: string, change: OfficeChange): ReshapeResult {
  const studio = studioForChange(root);
  const result = applyOfficeChange(studio, change);
  if (!result.ok) throw new OrgRefusal(result.code, result.error);
  if (!result.changed) return { ok: true, message: result.message, changed: [] };
  return { ok: true, message: result.message, changed: [writeManifest(root, manifestText(result.studio))] };
}
