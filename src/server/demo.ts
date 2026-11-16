// The built-in demo: a made-up mobile-app studio working through one feature, looping. It needs no Claude Code,
// powers the README screenshots and the end-to-end tests, and is always labelled as a demo in the office.
import { compose } from '../composer/compose.ts';
import type { Detection } from '../composer/detect.ts';
import type { Library } from '../composer/library.ts';
import type { OfficeEvent } from '../core/events.ts';
import { emptyOffice } from '../core/office.ts';
import type { Studio } from '../core/studio.ts';
import type { TokenUsage } from '../core/usage.ts';
import type { Office } from './office.ts';

export const DEMO_SESSION = 'demo-session';
const LOOP_SECONDS = 150;

type Step = OfficeEvent extends infer E ? (E extends OfficeEvent ? Omit<E, 'at' | 'sessionId'> : never) : never;

const EMPTY: Detection = {
  root: '', name: 'Plant Pal', isEmpty: true, stacks: [], frameworks: [], packageManager: null, commands: {}, folders: [], rootFiles: [], domains: [],
};

export function demoStudio(library: Library, version: string): Studio {
  return compose({
    library, domain: 'mobile-app', rigor: 'standard', detection: EMPTY, name: 'Plant Pal', version,
    idea: 'A plant-care app with watering streaks and a light meter.', stacks: ['expo', 'react-native', 'typescript'],
  }).studio;
}

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const use = (cacheRead: number, cacheWrite: number, output: number): TokenUsage => ({ input: 6, output, cacheRead, cacheWrite5m: cacheWrite, cacheWrite1h: 0 });

/** The script: seconds from the start of the loop, and what happens. */
export function demoScript(): [number, Step][] {
  const s: [number, Step][] = [];
  let n = 0;
  const id = () => `demo-tool-${++n}`;
  const tool = (start: number, end: number, who: { agentId?: string; agentType?: string }, name: string, target: string, opts: { ok?: boolean; error?: string; file?: string } = {}) => {
    const toolUseId = id();
    s.push([start, { kind: 'tool-start', ...who, toolUseId, tool: name, target }]);
    s.push([end, { kind: 'tool-end', ...who, toolUseId, tool: name, ok: opts.ok ?? true, ...(opts.error ? { error: opts.error } : {}), ...(opts.file ? { file: opts.file } : {}) }]);
  };
  const spend = (t: number, who: { agentId?: string; agentType?: string }, model: string, usage: TokenUsage) =>
    s.push([t, { kind: 'usage', ...who, messageId: `demo-msg-${++n}`, model, usage }]);
  const brief = (t: number, agentId: string, agentType: string, task: string) => {
    const toolUseId = id();
    s.push([t, { kind: 'tool-start', toolUseId, tool: 'Agent', target: `${agentType}: ${task}`, spawn: { agentType, description: task } }]);
    s.push([t + 0.5, { kind: 'subagent-start', agentId, agentType }]);
    s.push([t + 0.6, { kind: 'tool-end', toolUseId, tool: 'Agent', ok: true }]);
  };
  const lead = {};

  s.push([0, { kind: 'prompt', text: 'Add a watering streak to the home screen, with a small celebration at 7 days', notification: false }]);
  spend(1, lead, OPUS, use(42_000, 6_200, 380));
  tool(1.5, 2.5, lead, 'Skill', 'plan-feature');
  tool(3, 4, lead, 'Read', 'app/(tabs)/index.tsx');
  spend(4.5, lead, OPUS, use(48_000, 3_100, 910));

  const ux = { agentId: 'demo-ux', agentType: 'ux-designer' };
  brief(5, ux.agentId, ux.agentType, 'Design the streak card and the 7-day celebration');
  tool(7, 8, ux, 'Read', 'components/PlantCard.tsx');
  spend(8.5, ux, OPUS, use(18_000, 9_400, 640));
  tool(10, 11, ux, 'Glob', 'components/**/*.tsx');
  tool(13, 16, ux, 'Write', 'docs/streak-card.md', { file: 'docs/streak-card.md' });
  spend(17, ux, OPUS, use(27_500, 2_200, 1_480));
  s.push([20, { kind: 'subagent-stop', ...ux, lastMessage: 'Spec in docs/streak-card.md: flame icon, day count, gentle confetti at 7.' }]);

  const ui = { agentId: 'demo-ui', agentType: 'ui-designer' };
  brief(21, ui.agentId, ui.agentType, 'Check the streak spec against the design system');
  tool(22, 23, ui, 'Skill', 'design-gate');
  tool(24, 25, ui, 'Read', 'docs/streak-card.md');
  tool(27, 28, ui, 'Read', 'constants/theme.ts');
  spend(29, ui, OPUS, use(21_000, 8_800, 720));
  s.push([31, { kind: 'subagent-stop', ...ui, lastMessage: 'Passes: it uses the existing flame icon, colours and spacing scale.' }]);

  const me = { agentId: 'demo-mobile', agentType: 'mobile-engineer' };
  brief(32, me.agentId, me.agentType, 'Build the streak card and the celebration');
  tool(34, 35, me, 'Read', 'app/(tabs)/index.tsx');
  spend(35.5, me, OPUS, use(24_000, 11_000, 520));
  tool(36, 39, me, 'Write', 'components/StreakCard.tsx', { file: 'components/StreakCard.tsx' });
  spend(39.5, me, OPUS, use(35_000, 4_100, 2_300));
  tool(40, 42, me, 'Edit', 'app/(tabs)/index.tsx', { file: 'app/(tabs)/index.tsx' });

  const cw = { agentId: 'demo-copy', agentType: 'copywriter' };
  brief(36.5, cw.agentId, cw.agentType, 'Write the streak copy and the empty state');
  tool(38, 39, cw, 'Read', 'docs/streak-card.md');
  tool(41, 43, cw, 'Edit', 'locales/en.json', { file: 'locales/en.json' });
  spend(44, cw, SONNET, use(14_000, 6_500, 410));
  s.push([45, { kind: 'subagent-stop', ...cw, lastMessage: 'Added four strings: title, day count, celebration and the empty state.' }]);

  tool(43, 47, me, 'Bash', 'npm run typecheck', { ok: false, error: "Exit code 2: Property 'streak' does not exist on type 'Plant'" });
  spend(48, me, OPUS, use(39_000, 1_900, 380));
  tool(49, 50, me, 'Edit', 'types/plant.ts', { file: 'types/plant.ts' });
  tool(52, 56, me, 'Bash', 'npm run typecheck');

  const ex = { agentId: 'demo-explore', agentType: 'Explore' };
  brief(50, ex.agentId, ex.agentType, 'Find where plant data is cached on the device');
  tool(51, 53, ex, 'Grep', 'AsyncStorage');
  tool(54, 55, ex, 'Read', 'lib/storage.ts');
  spend(56, ex, HAIKU, use(31_000, 12_000, 610));
  s.push([57, { kind: 'subagent-stop', ...ex, lastMessage: 'Plant data is cached in lib/storage.ts under the key "plants:v2".' }]);

  s.push([57.5, { kind: 'permission', ...me, tool: 'Bash', target: 'npx expo install expo-haptics' }]);
  tool(64, 70, me, 'Bash', 'npx expo install expo-haptics');
  spend(71, me, OPUS, use(41_000, 2_400, 1_150));
  tool(72, 74, me, 'Edit', 'components/StreakCard.tsx', { file: 'components/StreakCard.tsx' });
  tool(76, 82, me, 'Bash', 'npm test');
  spend(82.5, me, OPUS, use(44_000, 1_800, 640));
  s.push([83, { kind: 'subagent-stop', ...me, lastMessage: 'Streak card built with a haptic tap at 7 days. Typecheck and tests pass.' }]);

  const qa = { agentId: 'demo-qa', agentType: 'qa-engineer' };
  brief(84, qa.agentId, qa.agentType, 'Test the streak on a small screen and with large text');
  tool(86, 96, qa, 'Bash', 'npm run e2e -- streak');
  spend(96.5, qa, SONNET, use(26_000, 10_200, 870));
  tool(97, 99, qa, 'Write', 'e2e/streak.spec.ts', { file: 'e2e/streak.spec.ts' });
  spend(100, qa, SONNET, use(33_000, 2_600, 1_340));
  s.push([104, { kind: 'subagent-stop', ...qa, lastMessage: 'Passes at 375px and at 200% text. Added a regression test.' }]);

  const a11y = { agentId: 'demo-a11y', agentType: 'accessibility-specialist' };
  brief(88, a11y.agentId, a11y.agentType, 'Run the accessibility gate on the streak card');
  tool(89, 90, a11y, 'Skill', 'a11y-gate');
  tool(91, 93, a11y, 'Read', 'components/StreakCard.tsx');
  spend(95, a11y, SONNET, use(22_000, 9_000, 760));
  s.push([99, { kind: 'subagent-stop', ...a11y, lastMessage: 'Labels and roles are set and contrast is 4.8:1. Passes.' }]);

  tool(106, 107, lead, 'Skill', 'code-gate');
  tool(108, 112, lead, 'Bash', 'npm run lint');
  spend(112.5, lead, OPUS, use(63_000, 7_400, 1_020));
  tool(113, 114, lead, 'Read', 'CHANGELOG.md');
  tool(115, 116, lead, 'Edit', 'CHANGELOG.md', { file: 'CHANGELOG.md' });
  spend(117, lead, OPUS, use(66_000, 2_100, 1_640));
  s.push([118, { kind: 'turn-end', failed: false, lastMessage: 'The streak card is in: designed, built, tested at 375px and with large text, and through the design, accessibility and code gates.' }]);
  return s.sort((a, b) => a[0] - b[0]);
}

/** Plays the script into the office in real time, then starts over. */
export class DemoPlayer {
  private readonly script = demoScript();
  private index = 0;
  private loopStart = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly office: Office;

  constructor(office: Office) {
    this.office = office;
  }

  start(now = Date.now()) {
    this.loopStart = now;
    this.timer = setInterval(() => this.tick(), 200);
    this.tick(now);
  }

  /** Applies every step whose time has come; exposed so tests can drive the clock. */
  tick(now = Date.now()) {
    const elapsed = (now - this.loopStart) / 1000;
    if (elapsed >= LOOP_SECONDS) {
      this.office.state = emptyOffice();
      this.index = 0;
      this.loopStart = now;
      this.office.markDirty();
      return;
    }
    while (this.index < this.script.length && (this.script[this.index]?.[0] ?? Infinity) <= elapsed) {
      const step = this.script[this.index];
      if (step) this.office.ingest({ ...step[1], at: this.loopStart + step[0] * 1000, sessionId: DEMO_SESSION } as OfficeEvent);
      this.index += 1;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
