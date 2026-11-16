// Masks credentials before text leaves the office (in a prompt for Claude Code) or reaches the screen. Transcripts,
// tool output and hook payloads carry commands, config files and logs, and some of that is secret. The rules look for
// the shapes credentials really take and keep the name around a secret, so "GITHUB_TOKEN=[redacted]" still reads,
// while paths, commit ids, UUIDs, session ids and ordinary code stay as they are.

const REDACTED = '[redacted]';

/**
 * PEM private keys. The BEGIN and END lines stay and the body goes; a key cut short (no END line) loses its base64
 * lines, and gets its END line back so a second pass leaves it alone.
 */
const PEM_KEY =
  /-----BEGIN ([A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?)-----(?:[\s\S]{0,8000}?-----END \1-----|(?:(?:\s|\\[rn])+[A-Za-z0-9+/=]{16,}…?)*)/g;

/** The password in `scheme://user:password@host`. */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s:@/?#]+):([^\s@/?#]+)@/gi;

/** Credentials recognisable by their own shape, wherever they appear. */
const TOKENS: RegExp[] = [
  /\bsk-ant-[\w-]{10,}/g, // Anthropic API keys and OAuth tokens
  /\bsk-(?:proj-|svcacct-|admin-)?(?=[\w-]*\d)[\w-]{20,}/g, // OpenAI-style keys
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, // GitHub tokens
  /\bglpat-[\w-]{20,}/g, // GitLab tokens
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key ids
  /\bxox[abpr]-(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe secret and restricted keys
  /\bwhsec_[A-Za-z0-9]{20,}/g, // Stripe webhook secrets
  /\bAIza[\w-]{30,}/g, // Google API keys
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm tokens
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, // JWTs: three base64url parts, the first a JSON header
];

/** `Bearer <token>`. A word after "Bearer" in prose ("Bearer authentication") has no digit and is short. */
const BEARER = /\b(Bearer[ \t]+)([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * `name = value`, `name: value`, `"name": "value"`, `NAME=value`: masked when the name says secret. Values in quotes
 * (escaped quotes too, for JSON inside JSON) or in backticks (Markdown's code: "token: `a1b2c3`"), or a bare value,
 * with an optional scheme ("Authorization: Basic ..."). A name may sit in quotes or backticks too, or in Markdown's
 * emphasis ("- **DB_PASSWORD**: ...", "*API_KEY*: ...").
 */
const ASSIGNMENT = new RegExp(
  String.raw`(?<![\w.-])(?<q>\\?["']|\x60|\*\*|\*|)(?<name>[A-Za-z_][\w.-]*)\k<q>(?<sep>[ \t]*(?::=|=>|[:=])[ \t]*)` +
    String.raw`(?:"(?<dq>(?:[^"\\\n]|\\.)*)"|\\"(?<eq>(?:[^"\\\n]|\\[^"\n])*)\\"|'(?<sq>(?:[^'\\\n]|\\.)*)'|\x60(?<bq>[^\x60\n]*)\x60` +
    String.raw`|(?<scheme>(?:Bearer|Basic|Token|Digest|Bot)[ \t]+)?(?<bare>[^\s"'\x60,;&()[\]{}<>]+))`,
  'g',
);

/** `--password hunter2`, `--api-key=...`: command-line flags whose name says secret. */
const FLAG = new RegExp(
  String.raw`(?<![\w-])(?<flag>--[A-Za-z][\w-]*)(?<sep>=|[ \t]+)` +
    String.raw`(?:"(?<dq>(?:[^"\\\n]|\\.)*)"|'(?<sq>[^'\n]*)'|\x60(?<bq>[^\x60\n]*)\x60|(?<bare>[^\s"'\x60,;&()[\]{}<>-][^\s"'\x60,;&()[\]{}<>]*))`,
  'g',
);

/**
 * Words in a name that mark its value as secret. Names are split into words first, so "max_tokens", "tokenizer",
 * "author" and "passwordless" don't count while "GITHUB_TOKEN", "apiKey" and "x-auth-token" do.
 */
const SECRET_WORDS = new Set(['secret', 'token', 'password', 'passwd', 'passphrase', 'auth', 'oauth', 'authorization', 'apikey', 'privatekey', 'secretkey', 'accesskey']);
/** "<kind> key" names: "api_key", "privateKey", "SIGNING_KEY". */
const KEY_KINDS = new Set(['api', 'private', 'secret', 'access', 'signing', 'encryption', 'master', 'license', 'session']);

function secretName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((word, i) => SECRET_WORDS.has(word) || (word === 'key' && KEY_KINDS.has(words[i - 1] ?? '')));
}

/** Values that stand for a secret without being one: references, templates and masks. */
const PLACEHOLDER = /^(?:[$%<{]|\*+$|x{3,}$|\.{3}$|…$)/i;
const KEYWORDS = new Set([
  'true', 'false', 'null', 'none', 'nil', 'undefined', 'string', 'number', 'boolean', 'bool', 'int', 'integer', 'any', 'unknown', 'object',
  'optional', 'required', 'yes', 'no', 'on', 'off', 'enabled', 'disabled', 'bearer', 'basic', 'token', 'secret', 'password', 'redacted',
  'hidden', 'empty', 'default',
]);
/** Code that reads a secret from somewhere else: `token = process.env.TOKEN`, `api_key=self.api_key`. */
const REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|env[.:]|secrets\.|vars\.|config\.|settings\.|self\.|this\.)/;

/**
 * Whether a value after a secret name is worth masking. `loose` is for literals (quoted values, `NAME=value`, a value
 * after a scheme); otherwise the value must look generated (letters and digits) so code like `token: string` or
 * `password = hashPassword(raw)` reads as it was.
 */
function worthMasking(value: string, loose: boolean): boolean {
  if (value.length < 3 || PLACEHOLDER.test(value) || KEYWORDS.has(value.toLowerCase())) return false;
  // Numbers are limits and counts ("token_limit=4000"), URLs carry their own rule, paths aren't secrets.
  if (/^\d+(?:\.\d+)?$/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(value)) return false;
  if (loose) return true;
  return value.length >= 6 && /\d/.test(value) && /[A-Za-z]/.test(value) && !REFERENCE.test(value);
}

const TICK = '`';

/**
 * A value in backticks is a literal, as in quotes, unless it is code that reads a secret from elsewhere:
 * "token: `process.env.TOKEN`", "auth = `Bearer ${token}`".
 */
const tickedLiteral = (value: string) => !REFERENCE.test(value) && !value.includes('${');

/** A bare value keeps the punctuation that ends its sentence: "the token: abc123." -> "the token: [redacted]." */
function maskBare(value: string): { core: string; tail: string } {
  // A loop, not /[.:!?]+$/, which retries from every character of a long run of dots and takes quadratic time.
  let end = value.length;
  while (end > 0 && '.:!?'.includes(value.charAt(end - 1))) end -= 1;
  return { core: value.slice(0, end), tail: value.slice(end) };
}

function maskAssignment(m: RegExpExecArray): string | null {
  const g = m.groups ?? {};
  const name = g.name ?? '';
  if (!secretName(name)) return null;
  const head = `${g.q ?? ''}${name}${g.q ?? ''}${g.sep ?? ''}`;
  if (g.dq !== undefined) return worthMasking(g.dq, true) ? `${head}"${REDACTED}"` : null;
  if (g.eq !== undefined) return worthMasking(g.eq, true) ? `${head}\\"${REDACTED}\\"` : null;
  if (g.sq !== undefined) return worthMasking(g.sq, true) ? `${head}'${REDACTED}'` : null;
  if (g.bq !== undefined) return worthMasking(g.bq, tickedLiteral(g.bq)) ? `${head}${TICK}${REDACTED}${TICK}` : null;
  const { core, tail } = maskBare(g.bare ?? '');
  if (g.scheme) return worthMasking(core, true) ? `${head}${g.scheme}${REDACTED}${tail}` : null;
  // `NAME=value` with nothing around the equals sign is a shell or env-file assignment: its value is a literal,
  // unless it only passes a variable on (`api_key=api_key`) or reads one (`token=self.token`).
  const literal = g.sep === '=' && core.toLowerCase() !== name.toLowerCase() && !REFERENCE.test(core);
  return worthMasking(core, literal) ? `${head}${REDACTED}${tail}` : null;
}

function maskFlag(m: RegExpExecArray): string | null {
  const g = m.groups ?? {};
  if (!secretName(g.flag ?? '')) return null;
  const head = `${g.flag ?? ''}${g.sep ?? ''}`;
  if (g.dq !== undefined) return worthMasking(g.dq, true) ? `${head}"${REDACTED}"` : null;
  if (g.sq !== undefined) return worthMasking(g.sq, true) ? `${head}'${REDACTED}'` : null;
  if (g.bq !== undefined) return worthMasking(g.bq, tickedLiteral(g.bq)) ? `${head}${TICK}${REDACTED}${TICK}` : null;
  const { core, tail } = maskBare(g.bare ?? '');
  return worthMasking(core, g.sep === '=' && !REFERENCE.test(core)) ? `${head}${REDACTED}${tail}` : null;
}

/**
 * Replaces the matches `mask` accepts. A match it turns down is searched again from its next character, so
 * `$env:API_KEY = "..."` still finds `API_KEY` after passing over `env:API_KEY`.
 */
function replaceAccepted(text: string, pattern: RegExp, mask: (m: RegExpExecArray) => string | null): string {
  const re = new RegExp(pattern.source, pattern.flags);
  let out = '';
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const replacement = mask(m);
    if (replacement === null) {
      re.lastIndex = m.index + 1;
      continue;
    }
    out += text.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/** Masks the credentials in `text`. Safe to run twice: masked text comes out unchanged. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text.replace(PEM_KEY, (_m, name: string) => `-----BEGIN ${name}-----\n${REDACTED}\n-----END ${name}-----`);
  out = out.replace(URL_PASSWORD, (m, scheme: string, user: string, password: string) => (password === REDACTED ? m : `${scheme}${user}:${REDACTED}@`));
  for (const token of TOKENS) out = out.replace(token, REDACTED);
  out = out.replace(BEARER, (m, word: string, token: string) => (/\d/.test(token) || token.length >= 20 ? `${word}${REDACTED}` : m));
  out = replaceAccepted(out, ASSIGNMENT, maskAssignment);
  return replaceAccepted(out, FLAG, maskFlag);
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** At most `max` UTF-16 units of `text`, never half a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max);
}

/**
 * Masks, then shortens to at most `max` characters with an ellipsis. Masking comes first so a cut never leaves part of
 * a secret that no longer matches its pattern, and a cut never splits a character in two.
 */
export function redactClip(text: string, max: number): string {
  if (max < 1) return '';
  const masked = redactSecrets(cut(text, max * 4));
  if (masked.length <= max) return masked;
  let kept = cut(masked, max - 1);
  // Don't leave "[redac…": a marker the cut runs through goes as a whole.
  const marker = masked.lastIndexOf(REDACTED, kept.length - 1);
  if (marker !== -1 && marker + REDACTED.length > kept.length) kept = kept.slice(0, marker);
  return `${kept}…`;
}
