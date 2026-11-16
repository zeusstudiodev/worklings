// Builds a studio for a project that has Claude Code agents but no studio.yaml (hand-written agents, Game Studios,
// agency-agents, ...), by sorting each agent, rule and skill into the room its name and description point to.
import { type BaseDepartment, BASE_DEPARTMENT_INFO } from './departments.ts';
import type { Studio, StudioDepartment, StudioGate, StudioRole, StudioRule, StudioSkill } from './studio.ts';
import { ROLE_ID, slugId, titleFromId } from './studio.ts';

export interface AgentFile {
  id: string;
  description: string;
}

export interface RuleFile {
  id: string;
  description: string;
}

export interface SkillFile {
  id: string;
  description: string;
}

/** Keyword weights. Name tokens count in full, description words at a quarter, so a long description can't outvote the name. */
const KEYWORDS: Record<BaseDepartment, Record<string, number>> = {
  security: { security: 3, privacy: 3, compliance: 3, legal: 3, threat: 3, pentest: 3, gdpr: 3, secrets: 2, auth: 1 },
  quality: {
    qa: 3, test: 3, tests: 3, tester: 3, testing: 3, quality: 3, accessibility: 3, a11y: 3, reviewer: 3, review: 2,
    performance: 3, perf: 3, debugger: 3, debug: 2, verifier: 3, verify: 2, audit: 2, lint: 2, regression: 3, smoke: 2,
  },
  data: {
    data: 3, ml: 3, analytics: 3, scientist: 3, eval: 3, evals: 3, llm: 3, prompt: 2, prompts: 2, machine: 2,
    learning: 2, statistics: 3, metrics: 2, rag: 3, embeddings: 3, notebook: 2,
  },
  art: {
    art: 3, artist: 3, animator: 3, animation: 3, audio: 3, sound: 3, music: 3, composer: 3, vfx: 3, shader: 3,
    shaders: 3, illustrator: 3, modeler: 3, sprite: 2, sprites: 2, texture: 2, visual: 1,
  },
  content: {
    writer: 3, writing: 3, narrative: 3, copy: 3, copywriter: 3, content: 3, seo: 3, docs: 3, documentation: 3,
    localization: 3, localize: 3, translator: 3, translation: 3, editor: 2, community: 3, marketing: 3, social: 2,
    blog: 2, story: 2, lore: 3, changelog: 2, notes: 1,
  },
  design: {
    design: 3, designer: 3, ux: 3, ui: 2, interaction: 2, usability: 3, level: 2, world: 2, builder: 1, economy: 2,
    systems: 1, game: 1, researcher: 2, brand: 3, figma: 3, balance: 2, playtest: 2,
  },
  ops: {
    devops: 3, ops: 3, release: 3, deploy: 3, deployment: 3, infrastructure: 3, infra: 3, sre: 3, platform: 2, ci: 2,
    cd: 2, build: 1, store: 2, publish: 2, publishing: 2, monitoring: 2, incident: 3, cloud: 2, hotfix: 2, launch: 2,
  },
  direction: {
    director: 2, producer: 3, product: 2, manager: 2, owner: 2, orchestrator: 3, coordinator: 3, planner: 3,
    strategist: 3, strategy: 2, chief: 3, ceo: 3, cto: 3, head: 2, creative: 2, vision: 2, scrum: 3, project: 1,
    lead: 1, architect: 2, sprint: 2, milestone: 2, scope: 2, estimate: 2, roadmap: 2, start: 1, help: 1,
  },
  engineering: {
    engineer: 3, programmer: 3, developer: 3, dev: 2, coder: 3, frontend: 3, backend: 3, fullstack: 3, mobile: 3,
    ios: 3, android: 3, web: 2, api: 2, database: 2, network: 3, engine: 3, gameplay: 3, tools: 2, specialist: 1,
    unity: 3, unreal: 3, ue: 3, godot: 3, react: 3, typescript: 3, python: 3, rust: 3, swift: 3, kotlin: 3,
    extension: 2, desktop: 2, cli: 2, library: 2, scraper: 3, automation: 2, integration: 2, refactor: 2, code: 1,
    prototyper: 3, prototype: 1, gdscript: 3, csharp: 3, cpp: 3, blueprint: 2, dots: 2, replication: 2,
    addressables: 2, gdextension: 3, umg: 2, architecture: 1, story: 1,
  },
};

/** Tie-breaker: the more specific department wins over the generic ones at the end. */
const PRIORITY: BaseDepartment[] = ['security', 'quality', 'data', 'art', 'content', 'design', 'ops', 'direction', 'engineering'];

/** Room order in the office and in studio.yaml: roughly the path work takes from idea to release. */
export const DEPARTMENT_ORDER: BaseDepartment[] = ['direction', 'design', 'art', 'engineering', 'data', 'quality', 'security', 'content', 'ops'];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function classify(id: string, description = ''): { department: BaseDepartment | null; score: number } {
  const nameTokens = words(id);
  const descTokens = new Set(words(description));
  let best: BaseDepartment | null = null;
  let bestScore = 0;
  for (const dept of PRIORITY) {
    const table = KEYWORDS[dept];
    let score = 0;
    for (const token of nameTokens) score += Object.hasOwn(table, token) ? (table[token] ?? 0) : 0;
    for (const token of descTokens) score += (Object.hasOwn(table, token) ? (table[token] ?? 0) : 0) * 0.25;
    if (score > bestScore) {
      best = dept;
      bestScore = score;
    }
  }
  return { department: best, score: bestScore };
}

/** Which room's work a gate releases into: a design review lets work through to engineering, and so on. */
const NEXT_ROOM: Record<BaseDepartment, BaseDepartment> = {
  direction: 'design',
  design: 'engineering',
  art: 'engineering',
  engineering: 'quality',
  data: 'engineering',
  quality: 'ops',
  security: 'ops',
  content: 'ops',
  ops: 'direction',
};

const GATE_WORDS = /(^|-)(review|check|gate|audit|readiness|approval|signoff)(-|$)/;

export const COMMONS: StudioDepartment = { id: 'commons', name: 'Open space', style: 'engineering' };

export interface InferResult {
  studio: Studio;
  /** Roles no keyword matched; they sit in the open space until someone moves them. */
  unassigned: string[];
}

export function inferStudio(input: { name: string; agents: AgentFile[]; rules: RuleFile[]; skills: SkillFile[] }): InferResult {
  const unassigned: string[] = [];
  const used = new Set<string>();

  const taken = new Set<string>();
  const roles: StudioRole[] = input.agents.map((agent, i) => {
    // Names like "Frontend Developer" become a slug id; the role keeps the name Claude Code reports.
    const base = ROLE_ID.test(agent.id) ? agent.id : slugId(agent.id) || `agent-${i + 1}`;
    let id = base;
    let copy = 1;
    while (taken.has(id)) id = `${base.slice(0, 59)}-${++copy}`;
    taken.add(id);
    const { department } = classify(agent.id, agent.description);
    if (!department) unassigned.push(id);
    const room = department ?? COMMONS.id;
    used.add(room);
    if (id === agent.id) return { id, department: room, title: titleFromId(id) };
    // The title comes from the whole name (only the id has a length limit), numbered like the id when names clash.
    const title = titleFromId(slugId(agent.id, Infinity) || base) + (copy > 1 ? ` ${copy}` : '');
    return { id, department: room, title, agent: agent.id };
  });

  const rules: StudioRule[] = input.rules.map((rule) => {
    const department = classify(rule.id, rule.description).department ?? 'engineering';
    used.add(department);
    return { id: rule.id, department, title: titleFromId(rule.id) };
  });

  const gates: StudioGate[] = [];
  const skills: StudioSkill[] = [];
  for (const skill of input.skills) {
    if (GATE_WORDS.test(skill.id)) {
      const from = classify(skill.id.replace(GATE_WORDS, '-'), skill.description).department ?? 'quality';
      const to = NEXT_ROOM[from];
      used.add(from);
      used.add(to);
      gates.push({ id: skill.id, title: titleFromId(skill.id), from, to });
    } else {
      skills.push({ id: skill.id, title: titleFromId(skill.id) });
    }
  }

  const departments: StudioDepartment[] = DEPARTMENT_ORDER.filter((d) => used.has(d)).map((d) => ({
    id: d,
    name: BASE_DEPARTMENT_INFO[d].name,
    style: d,
  }));
  if (used.has(COMMONS.id)) departments.push(COMMONS);
  if (departments.length === 0) departments.push({ id: 'direction', name: BASE_DEPARTMENT_INFO.direction.name, style: 'direction' });

  return {
    studio: { version: 1, name: input.name, domain: 'custom', rigor: 'lean', departments, roles, rules, gates, skills, fired: [] },
    unassigned,
  };
}
