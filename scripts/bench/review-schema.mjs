// The shape of a blind review (scripts/bench/review.mjs), shared by the reviewer's prompt, its validation and the report.
// Plain JavaScript on purpose: no schema library for one small shape.

/** The rubric: key, what the report calls it, and what the reviewer is told to judge. */
export const CRITERIA = [
  { key: 'correctness', label: 'Correctness and robustness', ask: 'does it do what the goal says, and does it hold up on edge cases and errors' },
  { key: 'completeness', label: 'Completeness against the goal', ask: 'is every part of the goal built, with nothing missing or only stubbed' },
  { key: 'codeQuality', label: 'Code quality and structure', ask: 'clear structure, sensible modules, readable, no dead or duplicated code' },
  { key: 'tests', label: 'Tests', ask: 'are there meaningful tests of behaviour, and do they pass when you run them' },
  { key: 'ux', label: 'User experience and accessibility', ask: 'for a UI: states, responsive layout, keyboard use, labels, contrast; for a command line tool or a library: how clear its output, errors and usage are' },
  { key: 'documentation', label: 'Documentation', ask: 'could a stranger install, use and change it from what is written' },
  { key: 'overall', label: 'Overall', ask: 'your overall judgement of the quality of the outcome' },
];
export const KEYS = CRITERIA.map((c) => c.key);
export const SOLUTIONS = ['solution-1', 'solution-2'];

/** JSON Schema for the reviewer's answer (handed to `claude --json-schema` and written into the prompt). */
export function reviewSchema() {
  const score = { type: 'integer', minimum: 1, maximum: 10 };
  const scores = {
    type: 'object',
    additionalProperties: false,
    required: KEYS,
    properties: Object.fromEntries(KEYS.map((k) => [k, k === 'ux' ? { type: ['integer', 'null'], minimum: 1, maximum: 10 } : score])),
  };
  const notes = { type: 'object', additionalProperties: false, required: KEYS, properties: Object.fromEntries(KEYS.map((k) => [k, { type: 'string' }])) };
  const one = { type: 'object', additionalProperties: false, required: ['scores', 'notes'], properties: { scores, notes } };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['solutions', 'ship'],
    properties: {
      solutions: { type: 'object', additionalProperties: false, required: SOLUTIONS, properties: Object.fromEntries(SOLUTIONS.map((s) => [s, one])) },
      ship: { type: 'object', additionalProperties: false, required: ['choice', 'why'], properties: { choice: { enum: [...SOLUTIONS, 'neither'] }, why: { type: 'string' } } },
    },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Checks a parsed answer against the shape above; returns the list of problems (empty when it is valid). */
export function validateReview(value) {
  const problems = [];
  if (!isObj(value)) return ['the answer is not a JSON object'];
  if (!isObj(value.solutions)) problems.push('"solutions" is missing');
  else {
    for (const s of SOLUTIONS) {
      const sol = value.solutions[s];
      if (!isObj(sol)) {
        problems.push(`"solutions.${s}" is missing`);
        continue;
      }
      for (const k of KEYS) {
        const v = sol.scores?.[k];
        const okNull = k === 'ux' && v === null;
        if (!okNull && !(typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10)) problems.push(`"solutions.${s}.scores.${k}" must be a number from 1 to 10${k === 'ux' ? ' or null' : ''}`);
        if (typeof sol.notes?.[k] !== 'string') problems.push(`"solutions.${s}.notes.${k}" must be a string`);
      }
    }
  }
  if (!isObj(value.ship) || ![...SOLUTIONS, 'neither'].includes(value.ship.choice)) problems.push('"ship.choice" must be "solution-1", "solution-2" or "neither"');
  else if (typeof value.ship.why !== 'string') problems.push('"ship.why" must be a string');
  return problems;
}

/** The first JSON object in a reply: the whole text, a fenced block, or the outermost braces. */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (isObj(v)) return v;
    } catch {
      // try the next form
    }
  }
  return null;
}

/** Mean of the numbers in a list, ignoring nulls; null when there are none. */
export function mean(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length === 0 ? null : nums.reduce((a, v) => a + v, 0) / nums.length;
}
