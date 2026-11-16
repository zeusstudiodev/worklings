// Asking the person before Worklings writes to their settings: a yes or no in the terminal, or --yes from a script.
// With nobody to ask (a pipe, CI, a Claude Code session running the CLI), nothing is assumed: the caller says how to
// agree instead.
import { createInterface } from 'node:readline/promises';

/** Who answers a question. */
export interface Asker {
  /** True when a person can answer: stdin and stdout are both a terminal. */
  readonly interactive: boolean;
  /** Puts the question and resolves with the line typed; '' when the terminal closes or the person presses Ctrl+C. */
  ask(question: string): Promise<string>;
}

/** The terminal this process runs in. */
export function terminalAsker(input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): Asker {
  return {
    interactive: input.isTTY === true && output.isTTY === true,
    async ask(question) {
      const rl = createInterface({ input, output });
      const gone = new AbortController();
      rl.once('SIGINT', () => gone.abort());
      rl.once('close', () => gone.abort());
      try {
        return await rl.question(question, { signal: gone.signal });
      } catch (error) {
        // Ctrl+C, or the terminal went away: no answer, which counts as no.
        if (error instanceof Error && error.name === 'AbortError') return '';
        throw error;
      } finally {
        rl.close();
      }
    },
  };
}

export type Consent = 'yes' | 'no' | 'cannot-ask';

/**
 * --yes agrees without asking. Otherwise the person is asked, and only "y" or "yes" (any case) agrees; with nobody to
 * ask, the answer is 'cannot-ask', never a yes.
 */
export async function consent(asker: Asker, question: string, yes: boolean): Promise<Consent> {
  if (yes) return 'yes';
  if (!asker.interactive) return 'cannot-ask';
  const answer = (await asker.ask(`${question} [y/N] `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes' ? 'yes' : 'no';
}
