# Worklings v0.4: a company shaped like a harness

The maintainer, 15 Nov 2026, after the v0.3 bench (one Claude Code session 8.8, both company versions 6.3–6.7, no
company run a reviewer would ship):

> "the idea perhaps is to have a company kind of structure but not with necessarily conventional company structure or
> roles, but roles and structure which makes sense in a harness and just splitting divisible work in subagents"

> "Stay with the same UI / UX experience but having something that works well. The experience is nice but I really
> want it to be useful too"

The office, the lobby, portfolios, the studio chat, the inbox and the stakeholder flow (scoping, plan approval, the
handover) stay as they are. What changes is the engine under them: who the people are, what each one's desk does,
and how work is split.

## What the v0.3 bench actually compared

The one-session arm (`scripts/bench/run-a.mjs`) ran the maintainer's own Claude Code setup: `effortLevel: xhigh` from
the user settings, his global CLAUDE.md (a strict quality bar: finish the whole job, run it, evidence before done),
108 skills and 7 MCP servers. Every company desk ran lean (no user CLAUDE.md, no skills) at `DEFAULT_EFFORT` =
`medium`. Two of the three company runs had a single maker on a single task, so they were one session at medium effort
with a paraphrased brief and a manager on top. The bench measured setup and effort as much as structure.

So v0.4 starts by making the bench fair (B1), then changes the structure (H1–H6).

## B1: a fair bench

- Arm A runs neutral: `--setting-sources project,local`, no user CLAUDE.md, skills or MCP servers (a lean desk's
  isolation), and an explicit `--effort` equal to what the company's Builder runs at. The model is the same.
- Record each arm's effort, model and loaded setup in `result.json` and print them in the report's "How each arm worked".
- Keep an optional arm A+ (the user's own setup, as in v0.3) for reference only, never in the ship rule.
- The company accepts a first prompt of any length: past the current 4,000-character cap the prompt goes into the
  brief file whole (quoted, never paraphrased) and the CEO's turn gets a pointer to it. `household` (10.9k) becomes
  the large task.

## H1: roles a harness needs, not a company's job titles

The default company for any job is these seats, plus extra Builders only when the work divides:

| Seat | Office title | What its desk does | Context |
|---|---|---|---|
| Lead | the CEO seat, titled "Lead" | Scoping questions, the plan (milestones, not a task split), acceptance checks, the handover. Sleeps during the build. | Its own, warm |
| Builder | "Builder" | Owns the whole codebase and builds every milestone in one warm session. Uses Claude Code subagents (the Agent tool) for divisible work: exploring, independent modules, test suites, research. | One long session, with the v0.2 handover file past the context threshold |
| Tester | "Tester" | Before the build: turns the stakeholder's words and the acceptance checks into runnable tests the Builder must pass, without seeing the Builder's code. After each milestone: runs them, plus v0.3's look at the running app. | Fresh per milestone |
| Reviewer | "Reviewer" | The one independent final review (v0.3's, with the app's screenshots), read-only. | Fresh |

- More Builders only where the plan has parts with an agreed contract between them (a web front end and its API, a
  game's engine and its content) and each part is big enough to justify a second warm session. The Lead says why in
  `sizing`; code refuses a second Builder without a contract in the plan (`BIG_PLAN`'s contracts rule, applied at two).
- No heads, team leads or managers by default. A large job gets Builders per contract-bounded part and still one Lead.
- The library's job-title roles (frontend engineer, QA engineer, …) stay as specialisations a Builder or Tester seat
  can carry (their rules and skills load into that desk), not as separate people.
- The office looks and works as it does now; the people are the seats above, with the same looks, desks and talk.

## H2: subagents for divisible work, shown in the office

- A Builder's lean desk gets the `Agent` tool (the built-in subagent types plus the project's own agents in
  `.claude/agents/`). Subagents inherit the desk's deny rules and approvals; the office's approval policy covers their
  tool calls exactly as the desk's own (`src/runtime/approvals.ts`), with a test that a subagent's write under
  `.claude/` still asks.
- The office shows a running subagent as a helper beside its Builder's desk ("Builder's helper explores the routes"),
  from the stream's subagent lines (`src/runtime/protocol.ts` already tells them apart). Helpers cost what their
  tokens cost, in the Builder's line of the ledger.
- The Builder's prompt says when to split: independent files or modules, read-only exploration, a test suite for a
  finished module; never two helpers writing the same files.

## H3: the quality bar travels with the desk

- The Builder's appended prompt carries a short, fixed quality bar (`src/company/house-rules.ts`): build the whole
  goal, run it the way the user will, write tests that cover the stated behaviour and its edges, a README with every
  assumption, check against the acceptance tests before reporting done. Byte-for-byte stable (prompt cache).
- The Builder works from the stakeholder's words verbatim (the brief file quotes them), never only from the Lead's
  paraphrase.

## H4: effort and models by seat

- Builder at `high` by default, Lead `high`, Tester and Reviewer `medium`. Lean, Balanced and Thorough move these
  (Lean: Builder `medium`; Thorough: Builder `xhigh`). Models stay as v0.2 decided (Lead on Opus, the rest on Sonnet),
  shown and editable in the spending plan as now.
- Changes to defaults users see go to the maintainer before shipping; the bench report states what each seat ran at.

## H5: the loop

1. The Lead scopes (if needed) and writes the plan as milestones with acceptance checks; the stakeholder approves.
2. The Tester writes the acceptance tests for milestone 1 into `.worklings-shared/acceptance/` (desks can read, only
   the Tester writes), from the stakeholder's words and the checks.
3. The Builder builds milestone 1 against them, with helpers where the work divides, and reports done.
4. The office runs the tests and the Tester's look at the app; failures go back to the Builder with the evidence, up
   to two rounds (v0.3's fix rounds), then the inbox.
5. Repeat per milestone; then the Reviewer's final review and the Lead's handover.

## H6: Thorough's second Builder (best of two)

- Thorough runs two Builders on the same milestone in two copies of the project (git worktrees); the Tester's tests
  and the Reviewer pick one, and the office keeps the winner. Off in Lean and Balanced. Cost shown before the start.

## The bench and the ship rule

- Tasks: `feature`, `link-checker`, `bookclub` (small) and `household` (large, hidden tests), Sonnet Builders.
- Arms: A neutral (B1) and v0.4 Balanced, one run each; one v0.4 Thorough run on `household` if the budget allows.
- Spend cap: USD 30 in all, reviews included. Stop and report before going over.
- Ship rule: on the small tasks v0.4 matches or beats A neutral on the blind review (within 0.5) at no more than 1.5×
  its cost; on `household` v0.4 beats A neutral on the review and the hidden tests. If it doesn't, the report says so
  plainly and names what the measurements point at.

## Ownership and done

- One build stream on `run/v0.4` (worktree `headcount-v04`), small logical commits; nothing pushed.
- Done: typecheck, lint, `lint:library`, unit tests, the v3 e2e projects for anything in `web/` or the server (the
  known failures, `v3-company:10` and `v3-dashboards:77` at both sizes, stay known), screenshots at 1440 and 375 px of
  the office with a Builder and a helper working, the privacy scan clean, the bench report.
- Log in `.claude/runs/v0.4/progress.md`.
