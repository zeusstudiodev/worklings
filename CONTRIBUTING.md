# Contributing

Thank you for helping. This page is how to set up, what to run before you send a change, and the few rules that
differ from the defaults. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security
problem, use [SECURITY.md](SECURITY.md), not a public issue.

## Where to start

- **Good first issues:** [docs/launch/good-first-issues.md](docs/launch/good-first-issues.md) lists small, checked
  tasks, and the same ones carry the `good first issue` label at https://github.com/zeusstudiodev/worklings/issues.
- **New roles, rules and kinds of project** need no code: see [Adding a role, a rule or a kind of
  project](#adding-a-role-a-rule-or-a-kind-of-project).
- **Bigger changes:** open an issue first so we can agree on the shape. [ROADMAP.md](ROADMAP.md) says what is planned
  and what is out of scope.

## Set up

You need Node 22 or later and git. You do not need Claude Code to build, test or try the demo.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` runs the demo studio with the web app on http://localhost:4325/ and hot reload. Pass a project folder
(`npm run dev -- ../my-project`) to work on the live office for that project instead.

Run the command-line tool from source with `node src/cli.ts <command>`; Node strips the types, so there is no build step
for it.

## Checks

Run these before sending a change.

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run lint:library
```

```bash
npm test
```

```bash
npm run e2e
```

`npm run e2e` builds everything and drives the demo and a throwaway project in Chromium at desktop and phone sizes. It
takes about two minutes and is required after any change to `web/` or the server. Screenshots land in
`test-results/evidence/`.

For one test file: `npx vitest run test/compose.test.ts`.

If you change what people see, also look at the office in a browser at 1440 and at 375 px wide, and say so in your pull
request.

## How the code is written

- **Imports use `.ts` extensions, and only erasable TypeScript.** No enums, namespaces or constructor parameter
  properties (`constructor(readonly x)`), because Node runs `src/` directly by stripping types.
- **`src/core/` stays free of Node APIs.** The web app imports it.
- **Everything from outside is untrusted:** hook payloads, transcripts, a project's `.claude/` files and a `--library`
  folder. Writes go through `plainPath` in `src/safe-fs.ts`. See "Gotchas" in `AGENTS.md`.
- **Tests never reach the real Claude Code.** They set `WORKLINGS_CLAUDE` to `test/fake-claude.mjs` (or
  `test/fake-desk.mjs` for a company) and make temporary folders only through `tempDir()` in `test/library-kit.ts`. A
  test that reaches the real program spends money and hangs on sign-in.
- **Line endings:** `.gitattributes` normalises them to LF. If a diff looks like a whole file changed, try
  `git diff --ignore-cr-at-eol`, and do not convert files you are not otherwise changing.
- Keep diffs focused. Mention an unrelated problem in the pull request instead of fixing it there.

## Words in the interface

Interface copy follows these rules (they are in `AGENTS.md`):

- Sentence case and plain verbs. No all-caps labels and no "A · B" strings.
- Activity reads as sentences: "Reviewer reads notes.txt", not a tool name.
- Titles inside a sentence go through `inSentence`, so acronyms survive ("QA engineer").
- The product is called Worklings, never with "Claude" in the name. "For Claude Code" is the descriptor.
- No "simply" or "just", and spell out an acronym the first time on a page.

## Adding a role, a rule or a kind of project

Everything lives in [`library/`](library/README.md), which explains the file format and the writing bar.

1. Add or edit the files.
2. Run `npm run lint:library`. It checks the frontmatter, the required sections, hand-offs to roles that exist, and
   that every domain resolves at every size.
3. Run `npm test`. The composer tests build every domain at every size, and the roster snapshot shows your change;
   update it with `npx vitest run -u` once you have checked the diff.
4. Try it on a real project: `node src/cli.ts new <folder> --domain <id> --dry-run`.

**The writing bar.** Library files become prompts that run on every delegation, so every line costs tokens in every
project that uses it. Write what a capable engineer would want to be told, not a job advert; be specific to the role
and the stack; never invent tools, commands or APIs; use short sentences and lists. A role is 35 to 80 lines with the
sections `## Mission`, `## You own`, `## How you work` and `## Done means`. The full rules are in
[`library/README.md`](library/README.md). Good library changes are short and specific.

## When Claude Code changes

Hook payloads and transcripts are captured from a real Claude Code session in `test/fixtures/claude-<version>/`.
When a new Claude Code version breaks a test, capture new fixtures with the procedure in
[docs/claude-code-surfaces.md](docs/claude-code-surfaces.md) and update that page.

When Anthropic changes prices, update `src/core/pricing.ts` from the pricing page and its `PRICES_AS_OF` date. The
pricing tests compare against costs Claude Code itself reported for real sessions.

## Sending a change

Fill in the pull request template. Say what changed and why, which checks you ran, and what you did not check. Update
`CHANGELOG.md` for anything a user would notice.

## Releasing

Maintainers only.

1. Update `CHANGELOG.md` and the version in `package.json`.
2. `node scripts/release-plugin.ts --stage` builds `plugin/runtime/`, checks it and stages it for the release commit.
   It is ignored on working branches so builds don't churn the history.
3. Run every check above.

`docs/launch/release-steps.md` has the whole sequence, from creating the repository to the Pages deploy.
