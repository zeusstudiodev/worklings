// Opens a link in the person's browser. The link is always printed first, so a computer with no browser to open (a
// server, CI, a Linux box without xdg-open) only gets a sentence saying to open it by hand.
import { spawn } from 'node:child_process';

/** The program that opens a link on each system, and its arguments. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

export interface OpenOptions {
  platform?: NodeJS.Platform;
  /** The opener to run instead of the system's (tests). */
  opener?: { command: string; args: string[] };
  /** Where the sentence goes when nothing could open it: stderr unless given. */
  say?: (line: string) => void;
}

/** Starts the system's opener and lets it go; never throws, and a missing opener is a sentence, not a crash. */
export function openBrowser(url: string, o: OpenOptions = {}): void {
  const platform = o.platform ?? process.platform;
  const { command, args } = o.opener ?? browserCommand(url, platform);
  const say = o.say ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const noBrowser = () => say('  No browser opened here: open the link above yourself.');
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: platform === 'win32' && o.opener === undefined });
    child.once('error', noBrowser);
    child.unref();
  } catch {
    // spawn throws, rather than emitting 'error', for arguments it refuses outright.
    noBrowser();
  }
}
