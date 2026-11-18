# Worklings: AI studios for any project in Claude Code, and a 3D office to watch them work

Open-source tool (MIT, not yet published). `SPEC.md` has the goal, scope and decisions; `docs/architecture.md` the
module map; `docs/design.md` the office's visual system.

## Commands
- Install: `npm install` (Node 22+; this machine runs Node 24).
- Dev: `npm run dev` -> http://localhost:4325/ (demo studio, hot reload); `npm run dev -- <project>` for a live office.
- Typecheck / lint / library lint / tests: `npm run typecheck`, `npm run lint`, `npm run lint:library`, `npm test`.
- One test file: `npx vitest run test/compose.test.ts`.
- End to end: `npm run e2e` (builds first, about 2 minutes; screenshots in `test-results/evidence/`).
- Build: `npm run build` (CLI to `dist/`, web app to `dist/web/`); plugin: `npm run build:plugin`.
- Run the CLI from source: `node src/cli.ts <command>` (Node strips the types).
- v3, a company: `node src/cli.ts hub --port 4380 --no-open` (the lobby; default port 7430), then
  `node src/cli.ts new <dir> --prompt "<one sentence>" --port 4380 --no-open`. Point `WORKLINGS_CLAUDE` at
  `test/fake-desk.mjs` and `WORKLINGS_HOME` at a temp folder first, so no real Claude Code starts and your own
  `~/.worklings` stays alone. `--tailnet` needs Tailscale (`test/fake-tailscale.mjs` stands in for it in tests).
- The whole company through the real hub with only Claude Code faked: `npx vitest run test/hub-integration.test.ts`
  (about 30 s). The hub's e2e: `npm run e2e -- --project=v3 --project=v3-phone` (builds first; the suite
  picks free ports for its offices, hubs and fake app when it starts, so another project on the machine never blocks it).
  The shell, boards, task board and org specs also run at 1024 x 768 (`v3-1024`: the side panel docks at 320 px),
  768 x 1024 (`v3-768`: it floats) and a phone on its side, 812 x 375 (`v3-phone-side`).
- Real checks that cost money (rules under Gotchas): `node scripts/check-desk.mjs`, `node scripts/check-orgtools.mjs`
  (`--probe` is free), `node scripts/check-fork.mjs`, `node scripts/check-aside.mjs`.
- Where a run's tokens went (v0.2): `node scripts/accounting.ts <company folder> [--projects <dir>] [--json]`. It is free (no
  model calls, writes nothing) and reads a company's `.worklings/` and Claude Code's transcripts; it doesn't check the log's
  signatures, so only point it at runs you trust. `node scripts/probe-desk-prompt.mjs --list` names the loading
  configurations it can measure; each probe starts a real Haiku desk and costs a few cents, so never loop it.
- Art: `node scripts/art/build.mjs` with `WORKLINGS_ART_RAW` naming the folder of raw packs, which live outside the repo
  (the folder `WORKLINGS_ART_RAW` names).

## Done here means
- Typecheck, lint, `lint:library` and tests pass; `npm run e2e` passes after any change to `web/` or the server.
- Office changes are looked at in the browser at 1440 and 375 px (the e2e screenshots, or `npm run dev`).
- Library changes keep the writing bar in `library/README.md`; the roster snapshot changes only on purpose.

## Conventions that differ from the defaults
- Source imports use `.ts` extensions and only erasable TypeScript: no enums, namespaces or constructor parameter
  properties (`constructor(readonly x)`), because Node runs `src/` directly with type stripping.
- `src/core/` must stay free of Node APIs: the web app imports it.
- UI copy: sentence case, plain verbs, no all-caps labels, no "A · B" strings; activity reads as sentences
  ("Reviewer reads notes.txt"); titles in sentences go through `inSentence` so acronyms survive ("QA engineer").
- No "Claude" in the product name (trademark); "for Claude Code" as the descriptor.

## Gotchas
- TypeScript is pinned to 6.0: typescript-eslint doesn't support 7 yet.
- Labels over the 3D model are one DOM layer positioned from 3D anchors (`web/src/scene/labels.tsx`), not drei
  `<Html>`, which mounted unreliably and creates a React root per label.
- The desktop app's Browser pane throttles `requestAnimationFrame` while hidden, so the office may not draw until you
  interact with it. Use Playwright (`npm run e2e` or a script) for screenshots and timing.
- Claude Code protects files under `.claude/` from direct edits; skills write through the CLI (`worklings tailor`).
- Hook payloads and transcripts are pinned per Claude Code version in `test/fixtures/claude-<version>/`; refresh them
  with the procedure in `docs/claude-code-surfaces.md`. `SessionStart` never reaches an `http` hook.
- Prices: `src/core/pricing.ts` follows https://platform.claude.com/docs/en/about-claude/pricing. Two tests pin
  costs Claude Code itself reported for real sessions; a mismatch means a price changed.
- Real-world checks run `claude -p` from inside Claude Code: unset `CLAUDECODE` for that command, call
  `claude.exe` directly (a shell splits the prompt), and use Haiku unless quality is what you are testing.
- Ask aside and Catch me up call the user's Claude Code (`src/server/claude.ts`). A fork's `total_cost_usd` includes the
  original session's cost, so price forks from `usage` (`costOf`), never from that field.
- Those calls run in a neutral empty temp folder, so the project's settings, hooks and CLAUDE.md don't load; keep it so.
- `WORKLINGS_CLAUDE` picks the executable. Tests and e2e set it to `test/fake-claude.mjs`; a test that reaches the real
  Claude Code spends money and hangs on sign-in, so always set it.
- Real checks (`scripts/check-fork.mjs`, `scripts/check-aside.mjs`) cost cents: use Haiku, unset `CLAUDECODE`, and
  don't run them in a loop.
- Evidence from the maintainer's private projects stays in `test-results/` (gitignored), never in the repo.
- Everything from outside is untrusted: hook payloads, transcripts, OpenTelemetry, a project's `.claude/` files and a
  `--library` folder. Records keyed by their ids are made with `dict()` in `src/core/office.ts` (no prototype), lookups
  in plain tables use `Object.hasOwn`, and every write goes through `plainPath` in `src/safe-fs.ts`. Keep it that way.
- Tests make temp folders only through `tempDir()` (`test/library-kit.ts`): they live under one root that
  `test/global-setup.ts` deletes after the run. Each e2e run uses its own `%TEMP%/worklings-e2e-<start time>`
  folder, and folders older than an hour go at the next start.
- The project was called Headcount while it was built. Still read, so files from earlier versions keep working: the
  `?from=headcount` hook marker, `<!-- headcount:start -->` and `<!-- headcount:notes -->` blocks, `tool: headcount`
  in studio.yaml, the `headcount:` library frontmatter key, `HEADCOUNT_CLAUDE`, `HEADCOUNT_HOME`, `~/.headcount/token` and
  the `headcount-token` session key. Each is a `LEGACY_…` constant with a comment; new files never write them. The repo
  folder and the branch names keep `headcount`.
- v3 contracts (`src/core/company.ts`, `studio.ts`, `looks.ts`, `org.ts`, `dashboard.ts`, `snapshot.ts`) belong to the
  lead. `docs/architecture.md`, "Who owns what", says which stream owns which files: change a contract by asking, not
  by editing, and keep to the seams listed there.
- A desk's appended prompt must be byte-for-byte the same every time the same person's desk opens: Claude Code's prompt
  cache is keyed by the system prompt, so a changed character rewrites the whole conversation at cache-write price (28%
  of a company's cost, measured). The scratch folder named in it is stable per company and person for that reason
  (`HarnessPlan.stable`); don't put anything that varies per start (a pid, a time, a random name) in it. The transcript's
  `diagnostics.cache_miss_reason` says which part changed ("Prompt cache on `--resume`" in `docs/claude-code-surfaces.md`).
- Two limits, not one: `maxDesks` is people working at once (the usage limit), `maxOpen` desks kept open, idle ones
  included (memory, about 470 MB each). An idle desk costs no tokens and holds no working slot; it keeps its process, and
  so its warm conversation, until `idleMs` (5 minutes by default) passes or the open cap needs the room, and the
  longest-idle desk closes first. The hub's gate holds both (`take(key, working)`, `takeWork`).
- Lean desks (v0.2, companies of the parked shapes; a plain desk loads the person's whole setup): a person's desk
  starts with `--setting-sources project,local`, `--strict-mcp-config` and `--tools <their tools>` (`deskArgs`), and loads only what `loads` assigns. `--tools` without `--strict-mcp-config` loads every MCP
  tool of the user's upfront, 215k tokens in the probe, so never add one without the other; `attach` kills a desk whose init
  lists MCP tools nobody assigned. A lean desk reads none of the user's settings, so `readCarry` copies deny and ask rules,
  hooks, sandbox, env and the MCP lists into the desk's own settings, complete or not at all; anything it can't carry makes
  that desk start the old way, with a notice. Don't add a user setting to the carry without a test that it reaches the
  desk. The first request is the thing to measure (`scripts/probe-desk-prompt.mjs harness`): 13.6k for a maker.
- A role's `loads` in studio.yaml counts only when it matches `.worklings/approved-loads.json`, which `recordApproved` rewrites
  when an org is written (the start, an accepted proposal). studio.yaml is a project file anyone may edit, so a desk takes
  its level's defaults for anything else. Keep `approvedLoads` between the file and the desk.
- Routine reports go straight to done (`Company.routineReport`): a done or progress report with no question, blocker or
  failure words, on a task whose done-when asks for no review, from someone who doesn't check work, closes the task and
  reaches the manager only as a digest line in their next turn. `NEEDS_A_PERSON` is broad on purpose (a false positive only
  wakes the manager). A change to what wakes a manager changes a measured cost (92 manager turns, 14% of it, only accepted
  a report), so say what you measured.
- `BIG_PLAN` (`src/core/plan.ts`): a plan whose parts are built by three or more people in six tasks or more must have
  contracts, an integration task at each milestone where two or more people's work meets and a last verification task
  that cites `stakeholder_words`; `propose_plan` from the CEO passes `structure: true`, nobody else does. A stakeholder's
  edit, its undo and plans saved by 0.1.0 never need it. A smaller plan is never asked for more, because the extra tasks
  would cost more than they catch. A task carries its own tests: a plan never splits "build X" from "test X".
- CEO plans need a checklist (`checklist: true` in `checkPlan`, from the CEO's `propose_plan` only); test plans that go
  through the CEO use `withChecklist` (`test/steering-plan-kit.ts`). Only the final review's owner marks it (`mark_checklist`).
- Claude Code 2.1.312's stream-json desk and its MCP handshake are pinned by fixtures in
  `test/fixtures/claude-2.1.312/desk/` and `mcp/`; `docs/claude-code-surfaces.md` ("Stream-json desks", "Org tools over
  MCP") has the facts. After a Claude Code update, re-run `scripts/check-desk.mjs` and `scripts/check-orgtools.mjs`
  and read the diff in the fixtures before building on it; they write fixtures only when every required step passes.
- A desk needs prompt caching on: `deskEnv` (`src/server/claude.ts`) is `claudeEnv` without `DISABLE_PROMPT_CACHING`.
  Use `claudeEnv` for one-shot calls and `deskEnv` for desks. A desk's token goes only in its environment
  (`WORKLINGS_DESK_TOKEN`), never on a command line, in a log or in a file in the project.
- v0.7's plain desk is the exception to the next two rules: it gets the person's words verbatim and asks exactly when
  Claude Code asks (`test/parity-contract.test.ts` holds its launch to plain `claude -p` plus `ALLOWED_DIFFERENCES` in
  `src/core/plain.ts`; change that list only on purpose, and keep it short).
- Every message delivered to a desk is a fenced turn with a fresh marker (`turnText` in `src/core/company.ts`), and the
  house rules (`src/company/house-rules.ts`) tell the person only such turns carry messages. Don't add a delivery path
  that skips the fence.
- Writes under `.claude/`, to `CLAUDE.md` and to the files it imports always ask in the inbox, with no "Always allow"
  (`src/runtime/approvals.ts`). Keep it that way when you touch the policy.
- `npm run e2e` empties `test-results/` (Playwright's output folder) at each start, and the check scripts' reports
  (`desk-check.json`, `orgtools-check.json`) are written there too. Copy evidence you need to keep somewhere else.
- Processes: stop only the ones you started, by the PIDs you recorded. Never kill by port, name or command-line pattern:
  the maintainer's own office (7421), other sessions and other projects run on this machine (a filter once stopped other
  agents' desks). When a port is taken, move to a free one.
- Real checks cost money: Haiku, a neutral working folder, `CLAUDECODE` unset, never in a loop. The real CEO runs used
  Sonnet through `ANTHROPIC_MODEL` in a throwaway `WORKLINGS_HOME` and port, on an empty temp project.
- Line endings: several editors wrote CRLF into files in the working tree. `.gitattributes` has `text=auto eol=lf`, so
  git normalises on commit; if a diff looks like a whole file changed, try `git diff --ignore-cr-at-eol`, and don't
  convert files you aren't otherwise changing.
- The art pipeline (`scripts/art/`) builds `web/public/art/` from raw CC0 packs. Only the built GLBs are committed, and
  `CREDITS.md` lists every pack, what was taken and what was changed: add to it whenever the build uses something new.
  The build stops if a pack's licence file doesn't say CC0.

- E2E and plan approval: new companies wait for the plan's approval ("before work"), and `assign` is refused until then.
  The e2e kit's `running()` (`test/e2e/v3-kit.ts`) turns it off before Start for specs about something else; pass
  `planApproval` to keep it. Companies whose state predates the setting read as "off" (`LEGACY_PLAN_APPROVAL`).
- The fake desk's `byText` rule (`test/fake-desk.mjs`) picks a scenario from what a turn says, for turns nobody can mark
  with `[fake:<name>]`, such as the office-written start turn that makes the CEO propose the plan (`test/e2e/v3-world.ts`).
- The company's browser app is the stage and dock: no tabs, the office fills the window, and `?panel=` names the side
  panel's view (`web/src/company/address.ts`; map in `docs/architecture.md`). Since v0.8 (`SPEC-v0.8.md`) the side panel
  is closed until asked for, on every size, and the next thing that needs you sits on one card over the talk bar
  (`web/src/company/inbox/InboxCard.tsx`); the views, Inbox and the camera keys are in More. The e2e kit
  (`test/e2e/v3-kit.ts`) reflects that: `openPanel(page, id, panel)` opens an address with a side panel view and
  `openBoard(page, id, board)` one on a board; `openInbox` opens More's Inbox and `sheetUp` makes sure the inbox (or a
  proposal) shows; `inboxCard` is the card; `talk(page, to, words)` types into the talk bar (leading `@` mentions pick
  who hears it); `cardDrag` drags a task card on desktop sizes (phones have Move). Specs that use none of these still work
  through `openCompany`.
- Node's typecheck (`tsconfig.json`) has no DOM types, so specs pass browser code to `page.evaluate` as a string.
- The maintainer gave the go to publish 0.1.0 on 13 Nov 2026, so `package.json` is no longer `"private"`. The public history is
  one squashed commit made outside his office hours by `npm run release:squash` (he or the coordinating session runs
  it; no other session pushes or tags). The plugin's `plugin/runtime/` is ignored on working branches and goes in only
  through `node scripts/release-plugin.ts --stage` before the squash; steps are in `docs/launch/release-steps.md`.
- A person's `git commit` in the shared checkout is refused (the office commits each finished task); the id `demo` is
  never a company's id; links printed inside Claude Code carry no token.

## Decisions not visible in the code
- The maintainer, 4 Nov 2026: curated roles tailored to the project (not generated from scratch), cozy low-poly diorama,
  twelve domains plus generic. In v1 and v2 the office watched and reshaped but never controlled sessions; v3 reverses
  that (next item).
- The maintainer, 4 and 5 Nov 2026 (v3, `SPEC-v3.md`): the office runs a company of Claude Code sessions. He is the stakeholder
  and sees the work as people would report it, never tool by tool. People decide routine work and ask on choices and on
  anything irreversible or visible to others. Phone access is through Tailscale only, never the public internet. The art
  uses CC0 packs only, nothing bought.
- Terms (the maintainer, 5 Nov 2026): Worklings is compliant by design.
  - It runs each user's own unmodified `claude`, signed in through Anthropic's flow, and never touches credentials.
  - It doesn't use the Agent SDK, offer a hosted service, or resell or intermediate usage.
  - "Claude Code" is only a descriptor.
  - API-key mode is there for anyone who prefers it.
  - Heavy parallel use counts against each user's own plan limits; the README's "Terms and publishing" quotes what
    Anthropic's legal and compliance page allows, with its link.

  So publishing doesn't wait for Anthropic's answer. It waits for the maintainer's go. Keep it
  that way when you touch sign-in, desks or anything hosted.
- Launch prep (the maintainer, 5 Nov 2026): v3 ends with a stage for adoption, ease of installation first (SPEC-v3.md "Launch
  prep"): one command, a guided first run, the plugin from GitHub, a static web demo, a hero video and a v3-first
  README. Nothing is published or deployed.
- How a company starts (the maintainer, 12 Nov 2026), after a benchmark gave an eight-person company to a one-file CLI that
  one Claude Code session finished in 2.5 minutes:
  - Scoping questions first. When the first prompt is short, vague or leaves real choices open, the CEO's first move
    is `ask_scoping`: three to five questions (who it is for, scope and ambition, platforms, quality bar, constraints),
    each with its pick and a line on why. The proposal panel shows them first, with "Use the CEO's picks"; the answers
    reach the CEO together in one message, and only then does it draft. A clear, detailed prompt skips them. Start
    stays the validation of the org, and plan approval before work is unchanged.
  - A team sized to the goal: the CEO's proposals hold 2 to 25 people (the CEO and at least one maker) and say why in
    `sizing`. A single small deliverable gets one to three makers and no heads; a head only where an area has three
    or more people; only an ambitious product grows toward 25 (`library/roles/ceo.md`).
  - Benchmarks judge quality first (a blind two-round expert review and hidden tests), then cost and time. The
    harness answers scoping questions with the CEO's picks, as an unattended stakeholder would.
  - The answers reach the CEO as one message the office writes from the inbox's answers, so it is the office's words
    (`fromOffice`), like every inbox answer since the 11 Nov gates; words the stakeholder types to the CEO in the talk
    bar stay typed.
- Leaner companies for big one-shot tasks (the maintainer, 13 Nov 2026; `SPEC-v0.2.md`, branch `run/v0.2`), after
  `scripts/accounting.ts` measured 13 real runs ($61): 28% of cost was context rewritten after a desk closed and reopened, 30%
  the fixed prompt each desk carries (about 60% of it the user's own Claude Code setup), and the CEO and heads 38%, 14 points of
  it paperwork turns. Quality comes first: no cut ships unless the benchmark's quality holds.
  - The three cuts that don't touch quality went ahead: warm desks, lean desks and office work done by code. A fresh session
    per task saves nothing and was dropped.
  - Models: the CEO on Opus and everyone else on Sonnet by default; no small-model CEO. The CEO gets cheaper by keeping its
    cache warm and by the office taking its paperwork turns.
  - A spending plan at the start: Lean, Balanced (the default) and Thorough, each with its cost an hour and for the whole job;
    the user also sets the number of people, how many work at once, the model per level and a budget. The CEO sizes its plan to
    the preset, which settles "lean or thorough" as the user's choice.
  - Fewer output tokens: short reports and briefs, quoted requirements word for word, no restating of context, status lines
    from code.
  - Lean desks, assigned by the CEO: in the proposal it gives each role the skills and MCP servers it needs from what the user
    has installed, the user can edit that before the start, and a role gets nothing it wasn't assigned.
  - Changes to what users see or what a company does by default (a mode, default models, budgets) go to the maintainer before they
    ship. Nothing is claimed about a whole company's savings until the benchmark has measured them.
- Better by design (the maintainer, 13 Nov 2026, afternoon; `SPEC-v0.2.md`, "Better by design"): v0.2 should be better than 0.1.0, not
  only cheaper, for people who aren't technical. The direction, being built when this was written, so check the code before
  you rely on it: the CEO sizes the company (small, medium or large) and code holds the org and the plan to it, flat by
  default; a plan linter refuses a plan before the stakeholder sees it; every desk's context is bounded, with a handover file
  and a fresh desk past a threshold; the stakeholder's words and agreed interfaces live in one brief file, and reports are a
  small fixed form; the office runs each task's check itself and one independent review closes the job; the CEO sleeps between
  milestones; step-ins after the plan's approval go near zero; and the job ends with something a non-technical person can use
  and a plain handover. Cheap validation on purpose: plan-only runs, and one small real run at or below 0.1.0's cost.
- Lean by default: Game Studios measured that more process cost more without a better game.
- Claude Code with an office around it (the maintainer, 15 Nov 2026; `SPEC-v0.7.md`), after four benches where splitting a job
  among roles never beat one session: a new company is plain, one unmodified Claude Code session on the person's words,
  with their own setup, tools, model, effort and permission mode; the office shows its prompts and end-of-turn words in the
  inbox, its todo list on the board and its subagents as helpers, and refuses only machine-wide kills. Plan first (Claude
  Code's plan mode, approved in the inbox) and the review round are extras, off by default. The read-only one-liner
  auto-allow was dropped. Released as 0.2.0 (the maintainer, 15 Nov 2026, evening): the start form and `worklings new --team`
  offer the solo shape as "A team (experimental)", kept in each company's records; `WORKLINGS_SHAPE` (plain, solo, harness,
  classic) is a developer's override that wins over that choice for new companies; a request naming no choice founds a
  classic company (the tests' and the e2e world's API calls).
- Office first (the maintainer, 16 Nov 2026; `SPEC-v0.8.md`): by default a company's screen shows the slim bar, one inbox card
  and the talk bar; Progress, Tasks and the full inbox open on demand, one panel at a time; the live strip is off by default
  and labels show only where something happens now. Nothing was removed: each piece is one click away (More, the panels,
  the palette). The static demo's "Try it: start a project" replays one real plain job recorded once
  (`scripts/record-demo-run.mjs`, which costs money, then `scripts/make-demo-replay.mjs`) from
  `web/src/company/replay/recording.json`; a new recording goes through the same sanitizer and the privacy scan.
- Packs (the maintainer, 18 Nov 2026; `SPEC-v0.9.md`): opt-in Claude Code setup for a one-session job, installed by the
  office into the project's `.claude/` as plain files the person can read, edit or delete, and recorded in
  `worklings-packs.json` in `.claude/`. 0.4.0 ships Kickoff alone, after the bench (the maintainer, 18 Nov 2026): check
  before done and the review round were measured and not shipped, and their numbers stay in `docs/benchmark.md`. Off by
  default; the office recommends one only by fixed rules (`RECOMMENDED` in `src/core/packs.ts`) on the task kinds where
  it met its bench rule, and none has. No skills generated per prompt, nothing installed from third-party repositories,
  and the launch doesn't change: the parity contract holds a job with packs to the same `claude -p`. The hub and the CLI install them before the session starts; no desk writes them, so
  the desk policy for `.claude/` stays as it is.
- Costs are API-equivalent estimates unless OpenTelemetry reports them.
- Nothing is published (npm, GitHub, marketplace, Pages) without the maintainer's OK. Where it will live (the maintainer, 5 Nov 2026): the
  repo `zeusstudiodev/worklings`, the npm package `worklings`, the demo at https://zeusstudiodev.github.io/worklings/.

## Where more lives
- `SPEC.md`, `.claude/runs/v1/` (checklist and progress log of the first build), `docs/`, `library/README.md`.
