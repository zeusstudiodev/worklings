import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { browserCommand, openBrowser } from '../src/browser.ts';
import { type Asker, consent, terminalAsker } from '../src/consent.ts';

/** An asker that answers each question with the next line given, and keeps what it was asked. */
function scripted(interactive: boolean, answers: string[]) {
  const asked: string[] = [];
  const asker: Asker = {
    interactive,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
  };
  return { asker, asked };
}

/** A terminal made of streams: what is typed goes in, and the streams say they are a TTY. */
function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.ReadStream & PassThrough;
  const output = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.WriteStream & PassThrough;
  let shown = '';
  output.on('data', (chunk: Buffer) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

describe('consent', () => {
  it('agrees without asking when --yes was given', async () => {
    const { asker, asked } = scripted(false, []);
    expect(await consent(asker, 'Add them?', true)).toBe('yes');
    expect(asked).toEqual([]);
  });

  it('never takes a yes when nobody can answer', async () => {
    const { asker, asked } = scripted(false, ['yes']);
    expect(await consent(asker, 'Add them?', false)).toBe('cannot-ask');
    expect(asked).toEqual([]);
  });

  it('takes only y or yes as a yes, and anything else as a no', async () => {
    for (const [typed, expected] of [['y', 'yes'], [' YES ', 'yes'], ['Yes', 'yes'], ['', 'no'], ['n', 'no'], ['sure', 'no'], ['yess', 'no']] as const) {
      const { asker, asked } = scripted(true, [typed]);
      expect(await consent(asker, 'Add them?', false)).toBe(expected);
      expect(asked).toEqual(['Add them? [y/N] ']);
    }
  });
});

describe('terminalAsker', () => {
  it('is interactive only on a terminal', () => {
    const t = terminal();
    expect(terminalAsker(t.input, t.output).interactive).toBe(true);
    expect(terminalAsker(new PassThrough() as unknown as NodeJS.ReadStream, t.output).interactive).toBe(false);
  });

  it('shows the question and reads the line typed', async () => {
    const t = terminal();
    const answer = terminalAsker(t.input, t.output).ask('Add them? [y/N] ');
    t.input.write('y\n');
    expect(await answer).toBe('y');
    expect(t.shown()).toContain('Add them? [y/N] ');
  });

  it('counts a terminal that closes before an answer as no answer', async () => {
    const t = terminal();
    const answer = terminalAsker(t.input, t.output).ask('Add them? [y/N] ');
    t.input.end();
    expect(await answer).toBe('');
  });
});

describe('openBrowser', () => {
  it("uses each system's opener", () => {
    expect(browserCommand('http://127.0.0.1:7430/?token=x', 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start', '""', 'http://127.0.0.1:7430/?token=x'] });
    expect(browserCommand('http://a/', 'darwin')).toEqual({ command: 'open', args: ['http://a/'] });
    expect(browserCommand('http://a/', 'linux')).toEqual({ command: 'xdg-open', args: ['http://a/'] });
  });

  it('says to open the link by hand when there is no opener, instead of crashing', async () => {
    const said: string[] = [];
    await new Promise<void>((done) => {
      openBrowser('http://127.0.0.1:7430/', {
        opener: { command: 'worklings-test-no-such-opener', args: [] },
        say: (line) => {
          said.push(line);
          done();
        },
      });
    });
    expect(said).toEqual(['  No browser opened here: open the link above yourself.']);
  });
});
