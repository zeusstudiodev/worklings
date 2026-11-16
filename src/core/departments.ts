// The nine base departments. A studio may name its own departments; each one borrows the look of a base department
// through its `style`, so the office always knows how to furnish and colour a room.

export const BASE_DEPARTMENTS = [
  'direction',
  'design',
  'engineering',
  'quality',
  'security',
  'content',
  'data',
  'ops',
  'art',
] as const;

export type BaseDepartment = (typeof BASE_DEPARTMENTS)[number];

/** The colours Claude Code accepts in a subagent's `color` field. */
export type AgentColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';

export interface BaseDepartmentInfo {
  id: BaseDepartment;
  name: string;
  /** Shown in the room panel and used by the generator's CLAUDE.md block. */
  purpose: string;
  /** Written into generated agents so Claude Code's own UI matches the office. */
  agentColor: AgentColor;
}

export const BASE_DEPARTMENT_INFO: Record<BaseDepartment, BaseDepartmentInfo> = {
  direction: { id: 'direction', name: 'Direction', purpose: 'Plans the work, holds the scope and makes the calls.', agentColor: 'purple' },
  design: { id: 'design', name: 'Design', purpose: 'Shapes what people see, touch and play.', agentColor: 'pink' },
  engineering: { id: 'engineering', name: 'Engineering', purpose: 'Builds and maintains the product.', agentColor: 'blue' },
  quality: { id: 'quality', name: 'Quality', purpose: 'Tests, reviews and measures before anything ships.', agentColor: 'green' },
  security: { id: 'security', name: 'Security', purpose: 'Guards secrets, data, privacy and compliance.', agentColor: 'red' },
  content: { id: 'content', name: 'Content', purpose: 'Writes the words: copy, docs, story and search.', agentColor: 'yellow' },
  data: { id: 'data', name: 'Data & AI', purpose: 'Pipelines, models, prompts, evals and analytics.', agentColor: 'cyan' },
  ops: { id: 'ops', name: 'Ops & Release', purpose: 'Builds, deploys, releases and keeps things running.', agentColor: 'orange' },
  art: { id: 'art', name: 'Art & Audio', purpose: 'Visual assets, animation, effects, sound and music.', agentColor: 'pink' },
};

export function isBaseDepartment(value: string): value is BaseDepartment {
  return (BASE_DEPARTMENTS as readonly string[]).includes(value);
}
