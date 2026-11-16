// What a real benchmark run of v0.2 showed, and the rules that answer it: the same small API took 14 minutes on 0.1.0
// and hit a 45-minute cap on 0.2. The plan had one task to build it and another to test it, makers built their own
// mutation runs, a report over the limit was sent seven times a few characters shorter, org tools were called by
// their short names, and servers nobody could stop were left running. Each test pins the words that answer one.
import { afterEach, describe, expect, it } from 'vitest';
import { houseRules } from '../src/company/house-rules.ts';
import { LIMITS, peopleOf, personById } from '../src/core/company.ts';
import { presetGuidance } from '../src/core/presets.ts';
import { cutAbout, tooLong } from '../src/core/too-long.ts';
import { STEERING_TOOL_DEFS } from '../src/orgtools/steering.ts';
import { closeServers, office, refused, STUDIO } from './orgtools-kit.ts';

const people = peopleOf(STUDIO);

function rulesFor(id: string, platform: NodeJS.Platform = 'win32'): string {
  const person = personById(people, id);
  if (!person) throw new Error(`no ${id}`);
  return houseRules({ person, people, company: 'Tool Library API', stakeholder: 'Robin', goal: 'A small HTTP JSON API.', roomName: (room) => room, steering: { planApproval: 'before-work' }, platform });
}

afterEach(closeServers);

describe('a refusal for text over its limit', () => {
  it('says the length, the limit and how much to cut', () => {
    expect(tooLong('summary', 4_667, 4_000)).toBe('summary is 4,667 characters; the limit is 4,000: cut about 800.');
    expect(tooLong('people[1].notes[0]', 317, 300)).toBe('people[1].notes[0] is 317 characters; the limit is 300: cut about 30.');
  });

  it('asks for a cut that lands under the limit with room to spare, in round numbers', () => {
    for (const max of [120, 200, 300, 1_000, 4_000, 8_000]) {
      for (const over of [1, 5, 17, 22, 94, 255, 667, 1_500, 4_000, 20_000]) {
        const cut = cutAbout(max + over, max);
        // Never more than the text itself: text many times its limit hears what it is over by, to the character.
        expect(cut).toBeLessThan(max + over);
        expect(cut, `${max + over} of ${max}`).toBeGreaterThanOrEqual(over);
        if (over < max) {
          expect(cut, `${max + over} of ${max}`).toBeGreaterThan(over);
          expect(cut % 10, `${max + over} of ${max}`).toBe(0);
        }
        // And never a wild overshoot for a near miss.
        if (over <= 25) expect(cut).toBeLessThanOrEqual(Math.max(100, max * 0.1));
      }
    }
  });

  it("would have ended the run's seven tries at the first: each of its lengths is told to cut more than it was over", () => {
    // The lengths the backend engineer sent, one after the other, each trimmed a little by eye.
    for (const length of [4_667, 4_255, 4_094, 4_065, 4_033, 4_022]) expect(4_000 + cutAbout(length, 4_000)).toBeGreaterThanOrEqual(length + 50);
  });

  it('is what a message answers, through the org tools; a report is never refused for its length', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'message', { to: 'head-of-design', text: 'y'.repeat(LIMITS.message + 22) })).toEqual(refused('text is 4,022 characters; the limit is 4,000: cut about 100.'));
    // The old free-text report is cut to its note, the form's fields to theirs: nothing is refused, so no second request.
    const long = await o.call('ui-designer', 'report', { outcome: 'progress', summary: 'x'.repeat(4_667) });
    expect(long.isError).toBeFalsy();
    const form = await o.call('ui-designer', 'report', { state: 'progress', note: 'n'.repeat(900), files: Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`), open: Array.from({ length: 12 }, (_, i) => `open ${i} ${'o'.repeat(300)}`) });
    expect(form.isError).toBeFalsy();
  });

  it('is told before it happens: the report form and the house rules give the limits to aim for', async () => {
    const o = await office();
    const report = await o.listed('ui-designer', 'report');
    const schema = JSON.stringify(report.inputSchema);
    expect(schema).toContain('up to 600 characters');
    expect(schema).toContain('up to 8 lines of 200 characters');
    const rules = rulesFor('ui-designer');
    expect(rules).toContain('Nothing is refused for length, it is cut: keep to 600 characters in the note, 8 open lines and 400 in the tail.');
    expect(rules).toContain('What runs long (assumptions, test results, a checklist) goes in a file your task names, and the message points to it.');
  });
});

describe('the org tools by the names Claude Code knows them by', () => {
  it('are named in full in the house rules, since a call by the short name fails', () => {
    for (const id of ['ui-designer', 'head-of-design', 'ceo']) {
      const rules = rulesFor(id);
      expect(rules).toContain('- These are their short names. Call each by its full name, which starts with mcp__org__: report is mcp__org__report, message is mcp__org__message. A call by the short name fails.');
      // Right under the list of tools it is about.
      expect(rules).toMatch(/## Your org tools\n\n[a-z_, ]+\.\n\n- These are their short names\./);
    }
  });

  it("are named in full in the server's instructions too, which reach every desk's system prompt", async () => {
    const o = await office();
    for (const id of ['ui-designer', 'ceo']) {
      expect(await o.instructions(id)).toContain('call every org tool by its full name, mcp__org__ and then the short name (mcp__org__report, mcp__org__message)');
    }
  });
});

describe('how much work a task is', () => {
  it('tells everyone that done is the done-when and the checks run once, with no verification nobody asked for', () => {
    for (const id of ['frontend-engineer', 'qa-engineer', 'ceo']) {
      expect(rulesFor(id)).toContain(
        "- Done means the task's done-when is met and the project's own checks pass, run once. Build what the brief asks, with the tests it asks for, and stop there: no second test harness, stress or mutation run, or exhaustive hand-testing that nobody asked for. Name in your report what you would check next instead of doing it.",
      );
    }
  });

  it("keeps a checker's own rule: the stakeholder's words, point by point", () => {
    expect(rulesFor('qa-engineer')).toContain("- Check work against Robin's own words from stakeholder_words, point by point");
  });

  it('tells managers a task holds its own tests, and what a done-when and a report are for', () => {
    const line =
      "- A task is a whole piece of work with its own tests in it: don't split building a thing from testing it, and split only where different people or a real dependency split the work. Its done-when names checks one command can run (the tests pass, it builds, it starts); ask for anything long (assumptions, results) as a file in the task's files, not in the report.";
    expect(rulesFor('ceo')).toContain(line);
    expect(rulesFor('head-of-design')).toContain(line);
    expect(rulesFor('frontend-engineer')).not.toContain('A task is a whole piece of work');
  });

  it('says so where the CEO writes the plan, and in no preset makes tests a seat or a task of their own', () => {
    const plan = STEERING_TOOL_DEFS.propose_plan.listing(true).description;
    expect(plan).toContain('A task is a whole piece of work with its own tests in it: never one task to build a thing and another to test it');
    // A preset line that said "testing is its own seat" made the CEO split build and tests into two tasks: the run cost 2.4 times as much and did not finish.
    for (const id of ['lean', 'balanced', 'thorough'] as const) {
      const guidance = presetGuidance(id, false).join(' ');
      expect(guidance).not.toMatch(/its own seat/i);
      expect(guidance).toContain('Makers test their own work');
    }
    expect(presetGuidance('thorough', false).join(' ')).toContain('tests are never a task of their own');
    expect(presetGuidance('lean', false).join(' ')).toContain('no QA or reviewer seat');
  });
});

describe('programs a person starts', () => {
  it('are run in the foreground and stopped by their process id before the report, in the words of the machine', () => {
    const windows = rulesFor('frontend-engineer', 'win32');
    expect(windows).toContain('- Run tests and builds in the foreground with a timeout; never wait on a background job with sleep loops. Stop every program you start (a server, a watcher) before you report, by its process id:');
    expect(windows).toContain(
      "start it in the background and keep its id in the same command (`cmd > \"$TMPDIR/x.log\" 2>&1 & PID=$!`, then `kill $PID` before the command ends); for a server started in an earlier command use `PID=$(netstat -ano | grep ':3000 .*LISTENING' | head -1 | awk '{print $5}'); taskkill //PID $PID //F` in Bash, or `Stop-Process -Id <id>` in PowerShell.",
    );
    expect(windows).toContain('Stopping what your own desk started needs nobody; a stop by name, port or pattern, or of anything else, asks Robin.');
    for (const platform of ['linux', 'darwin'] as const) {
      const rules = rulesFor('frontend-engineer', platform);
      expect(rules).toContain(
        'by its process id: start it in the background and keep its id in the same command (`cmd > "$TMPDIR/x.log" 2>&1 & PID=$!`, then `kill $PID` before the command ends), or look up a server started earlier with `PID=$(lsof -ti :3000 -sTCP:LISTEN)` and `kill $PID`.',
      );
      expect(rules).not.toContain('taskkill');
    }
  });

  it('are the same words every time a desk opens, so the prompt cache holds', () => {
    expect(rulesFor('frontend-engineer')).toBe(rulesFor('frontend-engineer'));
    const person = personById(people, 'frontend-engineer');
    if (!person) throw new Error('no frontend-engineer');
    const mine = houseRules({ person, people, company: 'Tool Library API', stakeholder: 'Robin', goal: 'A small HTTP JSON API.', roomName: (room) => room, steering: { planApproval: 'before-work' } });
    expect(mine).toBe(rulesFor('frontend-engineer', process.platform));
  });
});
