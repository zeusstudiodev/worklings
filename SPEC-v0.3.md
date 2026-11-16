# Worklings v0.3: better software in fewer shots, and a studio over many companies

The maintainer, 14 Nov 2026, after v0.2 (UI and UX accepted): "focus on making it an actual useful tool which produces better
software (at reasonable latency and price) in fewer shots", and "a way to work among companies: aggregating, creating groups
and a mastermind that can talk to all the CEOs, to coordinate more projects in a chat, so we cover each granularity level."

His answers the same day: both streams in parallel; the studio chat asks and relays (never approves); groups are portfolios
with a shared budget; real benchmark runs up to about USD 20 to 40 in total.

Built on `run/v0.2` (49d4f7a). Each stream works on its own branch in its own worktree and session; the coordinating
session merges them into `run/v0.3`. Nothing is pushed or published.

## Stream Q: better software in fewer shots (branch `run/v0.3-quality`)

A "shot" is a time the stakeholder has to step in after approving the plan: an inbox answer, a typed correction, or a
follow-up prompt because the result wasn't what was asked. The goal is fewer shots and better blind-review scores than
v0.2, at a cost no more than 20% above v0.2 on the same task and a similar wall time.

What the real v0.2 run showed (book club, 14 Nov: USD 1.39, 6 of 6 met): the final review judged "works well on a phone"
by reading code, because no desk can see the running app; and a failed checklist item goes to the stakeholder, not back to
the people who can fix it.

- **Q1 See the app.** The office runs the app and looks at it, the way it already runs each task's check
  (`src/company/check-run.ts`): start the project's run command, open the pages the checklist names in headless Chromium at
  375 and 1440 px, drive the steps an item describes where they are plain (click, type, read), collect screenshots and
  console errors, stop the app. The final review (and any checker) gets the screenshots and errors as evidence and cites
  them in its verdicts. The office does it, not the desk: no browser or MCP server for desks, same approval rules, the
  same refusals as check-run (no `--inspect`, nothing listening beyond localhost). Projects that aren't web apps skip it
  with a plain note in the verdict.
- **Q2 Acceptance first.** Before makers start, the checker turns each checklist item into an acceptance check where it
  can (a test, or a scripted walk Q1 can run), quoting the stakeholder's words; makers see them in the brief file and build
  against them. Items that can't be checked by a machine say so and stay for the final review's judgement.
- **Q3 Fix rounds before the inbox.** A failed acceptance check or checklist item becomes a follow-up task for the person who
  built that part, with the evidence, at most two rounds per item; only then does it reach the stakeholder. The stage and
  Progress show "Fixing" (plain words) while it happens.
- **Q4 Measure.** `scripts/bench`: add "shots" to result.json and the report. Run v0.2's tip and the stream's result on
  three tasks (`feature`, `link-checker` and one big task such as `household` or `bookclub`), arm A (one Claude Code
  session) and arm B, with the blind two-round review and hidden tests; Sonnet, 3 desks, as before. Budget: USD 20 to 40
  for everything, Q included; say what each run cost. A change that doesn't hold quality doesn't ship.
- Q owns `src/company/` (except files S names below), `library/roles/` (checker, CEO and final-review wording),
  `scripts/bench/`, the Progress view and their tests.

## Stream S: the studio over many companies (branch `run/v0.3-studio`)

- **S1 Portfolios.** In the lobby the stakeholder makes a portfolio (a name), puts companies in it (a company is in at most
  one), and gives it a budget and an optional shared brief. The lobby shows each portfolio as one card rolled up from its
  companies: what's happening in one line, progress, spent against the budget, and how many things wait on the stakeholder;
  opening it lists its companies as today. The shared budget is a hard cap: when the portfolio's spend reaches it, every
  company in it pauses as a company does at its own budget, and the inbox says why; each company's own budget still holds.
  The shared brief reaches each member CEO through its brief file (never the desk's appended prompt, which must stay
  byte-for-byte stable for the prompt cache).
- **S2 Studio chat.** One chat at lobby level, a hub-level Claude Code desk (lean, like company desks; Sonnet by default,
  changeable) that knows every company and portfolio. Over org tools it can: list companies and portfolios; read a company's
  summary, plan, progress, checklist and what waits on the stakeholder; send a message to one CEO, to the CEOs of a
  portfolio, or to all, and collect their replies. It cannot approve anything, answer the inbox, change budgets or plans, or
  start, pause or stop work: those stay with the stakeholder, and when one is needed it says where to click. Its messages
  reach a CEO as a fenced turn from "the studio chat", never as the stakeholder's own words, and show in that company's feed
  as such. Company content it reads is untrusted and fenced. Nothing from one company's files reaches another unless the
  stakeholder asks in the chat. Idle costs nothing; each answer shows its cost.
- **S3 The lobby is the top level.** Granularity reads: studio chat (all) > portfolio > company > person, each a click
  apart, with the same plain words and the same phone layout rules as the company app (375 px first).
- S owns `src/hub/`, `web/src/company/lobby/`, new `src/studio/` and `web/src/studio/`, the hub's routes and their tests.
  It adds the message origin "studio chat" to `src/core/company.ts` (`fromOffice` sits next to it) as a small, separate
  commit and tells the coordinating session; Q doesn't touch that type.

## Shared rules

- AGENTS.md rules hold (contracts, prompt cache, processes by recorded PID, fake desks in tests, no real Claude Code in
  tests, real checks only on Haiku or Sonnet in throwaway homes and ports).
- Done means typecheck, lint, `lint:library`, unit tests, the e2e for what changed (`--project=v3 --project=v3-phone`),
  and screenshots at 1440 and 375 px of every new screen.
- Each stream logs in `.claude/runs/v0.3-<stream>/progress.md` and commits small, logical commits on its own branch.
