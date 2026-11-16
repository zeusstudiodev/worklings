// Reads a shell command well enough to judge it: the simple commands it chains (&&, ||, ;, |, &, new lines), each
// one's words and redirections, and the commands nested in it ($(...), backticks, process substitution), so that a
// chained or nested command can't hide a push behind a test run. It understands the quoting, escapes and heredocs
// Claude Code writes, for Bash and for PowerShell; anything it can't read comes back as null, and the policy asks.
// Pure, with no Node APIs.

/** Stands in for a value the shell works out while it runs ($(...), backticks), which can't be judged in advance. */
export const COMPUTED = '\u0000';

export interface Redirect {
  /** '>' writes (>, >>, &>, 2>), '<' reads, '<<<' is a string, not a file. */
  op: '>' | '<' | '<<<';
  target: string;
}

export interface SimpleCommand {
  words: string[];
  redirects: Redirect[];
  /** The command as written, for the stakeholder and for permission rules. */
  raw: string;
  /** Bash: it ends in a single `&`, so it runs in the background and `$!` is its process id from then on. */
  background?: true;
}

export interface Scanned {
  commands: SimpleCommand[];
  /** The bodies of the commands nested in it, to judge as commands of their own. */
  nested: string[];
}

export type Dialect = 'bash' | 'powershell';

interface Heredoc {
  tag: string;
  strip: boolean;
}

/** The end of the heredoc bodies that start after the new line at `nl`: the index of the last body line's new line. */
function skipHeredocs(src: string, nl: number, docs: readonly Heredoc[]): number {
  let pos = nl + 1;
  for (const doc of docs) {
    while (pos <= src.length) {
      const end = src.indexOf('\n', pos);
      const stop = end === -1 ? src.length : end;
      const line = src.slice(pos, stop).replace(/\r$/, '');
      pos = stop + 1;
      if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.tag) break;
    }
  }
  return Math.min(pos - 1, src.length);
}

/** A heredoc's tag at `at` (after `<<` and `-`): bare, or in quotes. */
function heredocTag(src: string, at: number): { tag: string; end: number } | null {
  let j = at;
  while (src.charAt(j) === ' ' || src.charAt(j) === '\t') j++;
  const quote = src.charAt(j);
  if (quote === "'" || quote === '"') {
    const close = src.indexOf(quote, j + 1);
    return close === -1 ? null : { tag: src.slice(j + 1, close), end: close + 1 };
  }
  const m = /^[\w.-]+/.exec(src.slice(j));
  return m ? { tag: m[0], end: j + m[0].length } : null;
}

/** The index of the `)` that closes the `(` at `open`, past quotes and heredoc bodies; -1 when none does. */
function closeParen(src: string, open: number, dialect: Dialect): number {
  let depth = 0;
  let docs: Heredoc[] = [];
  const escape = dialect === 'bash' ? '\\' : '`';
  for (let j = open; j < src.length; j++) {
    const c = src.charAt(j);
    if (c === escape) {
      j++;
      continue;
    }
    if (c === "'") {
      const close = src.indexOf("'", j + 1);
      if (close === -1) return -1;
      j = close;
      continue;
    }
    if (c === '"') {
      let k = j + 1;
      while (k < src.length && src.charAt(k) !== '"') k += src.charAt(k) === escape ? 2 : 1;
      if (k >= src.length) return -1;
      j = k;
      continue;
    }
    if (dialect === 'bash' && c === '<' && src.charAt(j + 1) === '<' && src.charAt(j + 2) !== '<') {
      const strip = src.charAt(j + 2) === '-';
      const tag = heredocTag(src, j + (strip ? 3 : 2));
      if (!tag) return -1;
      docs.push({ tag: tag.tag, strip });
      j = tag.end - 1;
      continue;
    }
    if (c === '\n' && docs.length > 0) {
      j = skipHeredocs(src, j, docs);
      docs = [];
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** The index of the backtick that closes the one at `open` (Bash), past escapes; -1 when none does. */
function closeBacktick(src: string, open: number): number {
  for (let j = open + 1; j < src.length; j++) {
    if (src.charAt(j) === '\\') j++;
    else if (src.charAt(j) === '`') return j;
  }
  return -1;
}

const ANSI_C_SIMPLE: Readonly<Record<string, string>> = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
};

/**
 * Bash's ANSI-C quoting, `$'...'`, from the quote at `open`: the text it stands for with its escapes read (`\x2e`, `\056`,
 * `.`, `\n`, `\'`), and where it closes; null when it doesn't close. A NUL ends the word in Bash, so the text stops there.
 */
function ansiC(src: string, open: number): { text: string; close: number } | null {
  let text = '';
  for (let j = open + 1; j < src.length; j++) {
    const c = src.charAt(j);
    if (c === "'") return { text: text.split('\0')[0] ?? '', close: j };
    if (c !== '\\') {
      text += c;
      continue;
    }
    const e = src.charAt(j + 1);
    if (Object.hasOwn(ANSI_C_SIMPLE, e)) {
      text += ANSI_C_SIMPLE[e];
      j++;
    } else if (/[0-7]/.test(e)) {
      const digits = /^[0-7]{1,3}/.exec(src.slice(j + 1))?.[0] ?? e;
      text += String.fromCharCode(Number.parseInt(digits, 8) & 0xff);
      j += digits.length;
    } else if (e === 'x' || e === 'u' || e === 'U') {
      const digits = /^[0-9a-fA-F]+/.exec(src.slice(j + 2, j + 2 + (e === 'x' ? 2 : e === 'u' ? 4 : 8)))?.[0] ?? '';
      const code = Number.parseInt(digits, 16);
      text += digits === '' ? `\\${e}` : code <= 0x10ffff ? String.fromCodePoint(code) : '';
      j += 1 + digits.length;
    } else if (e === 'c' && j + 2 < src.length) {
      text += String.fromCharCode(src.charCodeAt(j + 2) & 0x1f);
      j += 2;
    } else {
      text += `\\${e}`;
      j++;
    }
  }
  return null;
}

/**
 * Splits a command into its simple commands. Returns null when it can't be read: an open quote, a substitution that
 * doesn't close, or a heredoc without a tag.
 */
export function scanCommand(src: string, dialect: Dialect = 'bash'): Scanned | null {
  const bash = dialect === 'bash';
  const escape = bash ? '\\' : '`';
  const commands: SimpleCommand[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let redirects: Redirect[] = [];
  let word = '';
  let inWord = false;
  let redirect: Redirect['op'] | null = null;
  let docs: Heredoc[] = [];
  let start = 0;

  const endWord = () => {
    if (!inWord) return;
    if (redirect !== null) redirects.push({ op: redirect, target: word });
    else words.push(word);
    redirect = null;
    word = '';
    inWord = false;
  };
  const endCommand = (at: number, background = false) => {
    endWord();
    const raw = src.slice(start, at).trim();
    if (words.length > 0 || redirects.length > 0) commands.push({ words, redirects, raw, ...(background && bash ? { background: true as const } : {}) });
    words = [];
    redirects = [];
    redirect = null;
  };
  /** `$(` or `(` at `open`: the body goes to `nested`; returns where it closes, or -1. */
  const substitution = (open: number): number => {
    const close = closeParen(src, open, dialect);
    if (close === -1) return -1;
    // $(( ... )) is arithmetic, not a command.
    if (!(bash && src.charAt(open + 1) === '(')) nested.push(src.slice(open + 1, close));
    word += COMPUTED;
    inWord = true;
    return close;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    const next = src.charAt(i + 1);
    if (c === escape) {
      if (next === '\n') i++;
      else if (next === '\r' && src.charAt(i + 2) === '\n') i += 2;
      else {
        word += next;
        inWord = true;
        i++;
      }
      continue;
    }
    if (bash && c === '$' && next === "'") {
      const quoted = ansiC(src, i + 1);
      if (quoted === null) return null;
      word += quoted.text;
      inWord = true;
      i = quoted.close;
      continue;
    }
    if (c === "'") {
      let close = src.indexOf("'", i + 1);
      // PowerShell writes a quote inside single quotes as two.
      while (!bash && close !== -1 && src.charAt(close + 1) === "'") close = src.indexOf("'", close + 2);
      if (close === -1) return null;
      word += bash ? src.slice(i + 1, close) : src.slice(i + 1, close).replaceAll("''", "'");
      inWord = true;
      i = close;
      continue;
    }
    if (!bash && c === '@' && (next === "'" || next === '"') && /\r?\n/.test(src.slice(i + 2, i + 4))) {
      // A PowerShell here-string: text up to a line that starts with its quote and @.
      const close = src.indexOf(`\n${next}@`, i + 2);
      if (close === -1) return null;
      if (next === '"' && src.slice(i, close).includes('$(')) word += COMPUTED;
      word += src.slice(i + 2, close).trim();
      inWord = true;
      i = close + 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < src.length; j++) {
        const d = src.charAt(j);
        if (d === escape && j + 1 < src.length) {
          const e = src.charAt(j + 1);
          if (!bash || '$`"\\\n'.includes(e)) {
            if (e !== '\n') word += e;
            j++;
            continue;
          }
          word += d;
          continue;
        }
        if (d === '"') break;
        if (d === '$' && src.charAt(j + 1) === '(') {
          const close = substitution(j + 1);
          if (close === -1) return null;
          j = close;
          continue;
        }
        if (bash && d === '`') {
          const close = closeBacktick(src, j);
          if (close === -1) return null;
          nested.push(src.slice(j + 1, close));
          word += COMPUTED;
          j = close;
          continue;
        }
        word += d;
      }
      if (j >= src.length) return null;
      inWord = true;
      i = j;
      continue;
    }
    if (c === '$' && next === '(') {
      const close = substitution(i + 1);
      if (close === -1) return null;
      i = close;
      continue;
    }
    if (bash && c === '`') {
      const close = closeBacktick(src, i);
      if (close === -1) return null;
      nested.push(src.slice(i + 1, close));
      word += COMPUTED;
      inWord = true;
      i = close;
      continue;
    }
    if (bash && (c === '<' || c === '>') && next === '(' && !inWord) {
      const close = substitution(i + 1);
      if (close === -1) return null;
      i = close;
      continue;
    }
    if (c === '#' && !inWord) {
      const nl = src.indexOf('\n', i);
      i = (nl === -1 ? src.length : nl) - 1;
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      endCommand(i);
      if (docs.length > 0) {
        i = skipHeredocs(src, i, docs);
        docs = [];
      }
      start = i + 1;
      continue;
    }
    if (!bash && c === '&' && next !== '&' && next !== '>' && !inWord && words.length === 0) {
      // PowerShell's call operator: `& "C:\Tools\x.exe" args` runs the next word.
      continue;
    }
    if (c === ';' || c === '|' || (c === '&' && next !== '>')) {
      endCommand(i, c === '&' && next !== '&');
      if ((c === '&' && next === '&') || (c === '|' && (next === '|' || next === '&')) || (c === ';' && next === ';')) i++;
      start = i + 1;
      continue;
    }
    if (c === '&' && next === '>') {
      endWord();
      redirect = '>';
      i += src.charAt(i + 2) === '>' ? 2 : 1;
      continue;
    }
    if (!bash && c === '*' && next === '>' && !inWord) {
      redirect = '>';
      i += src.charAt(i + 2) === '>' ? 2 : 1;
      continue;
    }
    if (c === '>' || (bash && c === '<')) {
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      } else {
        endWord();
      }
      if (c === '<' && next === '<') {
        if (src.charAt(i + 2) === '<') {
          redirect = '<<<';
          i += 2;
          continue;
        }
        const strip = src.charAt(i + 2) === '-';
        const tag = heredocTag(src, i + (strip ? 3 : 2));
        if (!tag) return null;
        docs.push({ tag: tag.tag, strip });
        i = tag.end - 1;
        continue;
      }
      if (next === '&') {
        // 2>&1 and >&2 join one stream to another: no file.
        let j = i + 2;
        while (/[\d-]/.test(src.charAt(j))) j++;
        i = j - 1;
        continue;
      }
      if (c === '>' && (next === '>' || next === '|')) i++;
      redirect = c === '>' ? '>' : '<';
      continue;
    }
    // In Bash an unquoted ")" ends the word it follows too: `(ls || true)` runs `true`, not a program called "true)".
    if ((c === '(' || c === ')') && (!inWord || (bash && c === ')'))) {
      endCommand(i);
      start = i + 1;
      continue;
    }
    if ((c === '{' || c === '}') && !inWord && (next === '' || /[\s;]/.test(next))) {
      endCommand(i);
      start = i + 1;
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  endCommand(src.length);
  return { commands, nested };
}
