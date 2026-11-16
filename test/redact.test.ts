import { describe, expect, it } from 'vitest';
import { redactClip, redactSecrets } from '../src/core/redact.ts';

/** Made-up credentials, assembled at run time so no secret scanner mistakes this file for a leak. */
const fake = (prefix: string, length = 40) => prefix + 'a1B2c3D4e5F6g7H8i9J0'.repeat(10).slice(0, length);
const base64url = (json: string) => Buffer.from(json).toString('base64url');
const jwt = [base64url('{"alg":"HS256","typ":"JWT"}'), base64url('{"sub":"1234567890","name":"Jo"}'), 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
const pemLines = (kind: string) => [
  `-----BEGIN ${kind}-----`,
  'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
  'VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK',
  'AB==',
  `-----END ${kind}-----`,
];

describe('redactSecrets', () => {
  it.each([
    { kind: 'Anthropic key', secret: fake('sk-ant-api03-', 90) },
    { kind: 'OpenAI project key', secret: fake('sk-proj-', 60) },
    { kind: 'OpenAI key', secret: fake('sk-', 48) },
    { kind: 'GitHub personal token', secret: fake('ghp_', 36) },
    { kind: 'GitHub OAuth token', secret: fake('gho_', 36) },
    { kind: 'GitHub fine-grained token', secret: fake('github_pat_11', 70) },
    { kind: 'AWS access key id', secret: 'AKIAIOSFODNN7EXAMPLE' },
    { kind: 'Slack token', secret: `${'xoxb'}-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx` },
    { kind: 'Stripe live key', secret: fake(`${'sk'}_live_`, 30) },
    { kind: 'Stripe restricted key', secret: fake(`${'rk'}_live_`, 30) },
    { kind: 'Google API key', secret: fake('AIza', 35) },
    { kind: 'JWT', secret: jwt },
  ])('masks a $kind wherever it appears', ({ secret }) => {
    expect(redactSecrets(`curl with ${secret} failed`)).toBe('curl with [redacted] failed');
  });

  it('masks a secret assignment and keeps the name, so the line still reads', () => {
    expect(redactSecrets(`export ANTHROPIC_API_KEY=${fake('sk-ant-api03-', 90)}`)).toBe('export ANTHROPIC_API_KEY=[redacted]');
    expect(redactSecrets('DB_PASSWORD=supersecret npm start')).toBe('DB_PASSWORD=[redacted] npm start');
  });

  it('masks the AWS secret access key by its name', () => {
    expect(redactSecrets('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe('aws_secret_access_key = [redacted]');
  });

  it('masks quoted values in JSON whose keys say secret, and keeps the quotes', () => {
    expect(redactSecrets('{"token": "abc", "password": "p@ss w0rd", "client_secret": "s3cr3t-value", "user": "jo"}'))
      .toBe('{"token": "[redacted]", "password": "[redacted]", "client_secret": "[redacted]", "user": "jo"}');
  });

  it('masks JSON written inside a JSON string', () => {
    expect(redactSecrets(String.raw`{\"api_key\": \"abc123secret\"}`)).toBe(String.raw`{\"api_key\": \"[redacted]\"}`);
  });

  it('masks generated-looking values in YAML and headers', () => {
    expect(redactSecrets('password: hunter2\nX-Api-Key: abc123def')).toBe('password: [redacted]\nX-Api-Key: [redacted]');
  });

  it('masks the credential after an Authorization scheme and keeps the scheme', () => {
    expect(redactSecrets(`curl -H "Authorization: Bearer ${jwt}"`)).toBe('curl -H "Authorization: Bearer [redacted]"');
    expect(redactSecrets('Authorization: Bearer abc123def456ghi')).toBe('Authorization: Bearer [redacted]');
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe('Authorization: Basic [redacted]');
  });

  it('masks the password in a URL and keeps the user and host', () => {
    expect(redactSecrets('postgres://admin:hunter2@db.example.com:5432/app')).toBe('postgres://admin:[redacted]@db.example.com:5432/app');
  });

  it('masks a secret in a query string and keeps the other parameters', () => {
    expect(redactSecrets('https://api.example.com/v1/items?api_key=abc123xyz&page=2')).toBe('https://api.example.com/v1/items?api_key=[redacted]&page=2');
  });

  it('masks command-line flags whose name says secret', () => {
    expect(redactSecrets('deploy --password hunter2 --token=abcdef --api-key "abc def 123" --verbose'))
      .toBe('deploy --password [redacted] --token=[redacted] --api-key "[redacted]" --verbose');
  });

  it('finds a secret name after passing over a name that is not one', () => {
    expect(redactSecrets('$env:API_KEY = "abc123def456"')).toBe('$env:API_KEY = "[redacted]"');
  });

  it('masks the body of a private key and keeps its BEGIN and END lines', () => {
    const key = pemLines(`${'RSA PRIVATE'} KEY`).join('\n');
    expect(redactSecrets(`key:\n${key}\ndone`)).toBe(`key:\n-----BEGIN RSA PRIVATE KEY-----\n[redacted]\n-----END RSA PRIVATE KEY-----\ndone`);
  });

  it('masks what is left of a private key that was cut short', () => {
    const cut = `${pemLines(`${'OPENSSH PRIVATE'} KEY`).slice(0, 3).join('\n')}\nThen I ran the tests.`;
    const out = redactSecrets(cut);
    expect(out).not.toContain('MIIEowIBAAKCAQEA');
    expect(out).not.toContain('VTLw7onLRnrq0');
    expect(out).toMatch(/Then I ran the tests\.$/);
  });

  it('keeps the punctuation that ends a sentence', () => {
    expect(redactSecrets('the token: abc123def.')).toBe('the token: [redacted].');
  });

  it('sees through backticks around a value or a name, the way Markdown writes code', () => {
    expect(redactSecrets('The deploy token: `a1b2c3d4e5f6`.')).toBe('The deploy token: `[redacted]`.');
    expect(redactSecrets('password: `swordfish` and `api_key`: abc123def456')).toBe('password: `[redacted]` and `api_key`: [redacted]');
    expect(redactSecrets('`DB_PASSWORD`=`hunter2` npm start')).toBe('`DB_PASSWORD`=`[redacted]` npm start');
    expect(redactSecrets('deploy --token `abc123def456` --verbose')).toBe('deploy --token `[redacted]` --verbose');
    const once = redactSecrets('token: `a1b2c3d4e5f6`');
    expect(redactSecrets(once)).toBe(once);
  });

  it.each([
    'src/core/office.ts:42: const token = getToken();',
    'commit 9fceb02d0ae598e95dc970b74767f19372d61af8',
    'session b0581371-e091-4b14-9a83-550be0bb1ac8 ended; agent acc52a8892c7c742e reported back',
    'tool_use_id toolu_01MEgPqqYAKzV4uQdfELXnrf in msg_011CghyPCM1ivegvAqaWHdAk',
    'sha256 5645b140c1a7e2f0d9b8a7c6e5d4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2',
    'max_tokens: 4096, input_tokens=12, cache_read_input_tokens: 5194, "contextTokens": 48000',
    'author: "Sam Rivera"',
    '  token: string | null;',
    'password: string;',
    'const apiKey = process.env.ANTHROPIC_API_KEY;',
    'client = Anthropic(api_key=api_key)',
    'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    'if (token === "") return; auth: true, passwordless: true, tokenizer: "cl100k"',
    'password_min_length = 8; token_limit=4000',
    'npx vitest run --reporter=dot',
    'https://github.com/example-org/headcount/pull/12 and http://localhost:4325/?mode=demo',
    'git@github.com:example-org/headcount.git',
    'export PATH=/usr/local/bin:$PATH',
    'C:\\Users\\jamie\\Desktop\\Development\\headcount\\src\\core\\redact.ts',
    'Use a Bearer token in the Authorization header. Bearer authentication is fine.',
    'Anthropic keys start with sk-ant- and GitHub tokens with ghp_.',
    'The risk-assessment-for-the-project-2026 doc',
    'Reads src/auth.ts, edits src/token.ts, asks to run npm publish',
    'Set `token: string` in the types, and `password: string | null`',
    'const auth = `Bearer ${token}`;',
    'token: `process.env.GITHUB_TOKEN`, the `max_tokens`: `4096` limit, password: `<your password>`',
  ])('leaves ordinary text alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  it('leaves text it already masked as it is', () => {
    const once = redactSecrets(`TOKEN=${fake('ghp_', 36)} ${pemLines(`${'EC PRIVATE'} KEY`).join('\n')} postgres://u:pw123@h/db Bearer ${jwt}`);
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('redactClip', () => {
  it('masks before it cuts, so no part of a cut secret shows', () => {
    // Cut first, the first 41 characters would end in "ghp_a1B2c3"; masked first, the whole line fits.
    const text = `${'x'.repeat(30)} ${fake('ghp_', 36)}`;
    const clipped = redactClip(text, 41);
    expect(clipped).not.toContain('ghp_');
    expect(clipped).toBe(`${'x'.repeat(30)} [redacted]`);
  });

  it('drops a mask the cut runs through instead of leaving half of it', () => {
    expect(redactClip(`x ${fake('ghp_', 36)} tail`, 12)).toBe('x …');
  });

  it('never cuts a character in half', () => {
    const clipped = redactClip('😀'.repeat(10), 8);
    expect(clipped).toBe('😀😀😀…');
    expect(clipped).not.toMatch(/\p{Cs}/u);
  });
});
