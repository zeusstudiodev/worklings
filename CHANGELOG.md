# Changelog

## 0.3.1, 18 November 2026

- **A new launch film.** A 30-second trailer replaces the screen recording: the lobby, a busy office (the demo's
  made-up company, labelled), helpers fanning out with their cost and a permission prompt allowed from a phone (a real
  Claude Code run, labelled). How it was made: `docs/launch/film/how-it-was-made.md`.
- **The studio chat says what it can do with a plain job.** It reads every company but can message only a team's CEO: a
  plain Claude Code job hears only you. The lobby used to say it asks every company's CEO.
- **Why Worklings leaves Claude Code alone.** [docs/benchmark.md](docs/benchmark.md): the benchmarks of a company of
  agents against one Claude Code session, and the parity bench behind 0.2. The roadmap is brought up to date.
- **The lobby's first-run welcome and the plugin's hub skill** describe a job as your own Claude Code, not a company of
  agents.
- **The web demo has a preview card.** A link to it shared on X, Slack or Discord shows the preview image and what the
  demo does.

## 0.3.0, 17 November 2026

The office is calmer. It fills the screen, the next thing that needs you waits on one card, and everything else is a
click away. The web demo can now start a project from scratch, by replaying a real recorded run.

### What a 0.2.0 user notices

- **Office first.** A company opens on its office, not on Progress. By default the screen holds three things: a slim
  bar (back to the lobby, the name, its status, the budget and More), one card with what needs you, and the talk bar.
  Progress, the task board and the whole inbox open when you ask, one at a time: opening one closes the other. Nothing
  was removed. The views, Inbox with its count and the office's zoom, Fit and Full screen keys are in More, and the
  palette (Ctrl+K) still has every command.
- **The inbox as one card.** The oldest thing waiting sits on a card over the talk bar: who asks, the question or the
  permission prompt, its answers (Answer in your own words included) and "1 of 6", with Next, Skip and See all. After you
  answer, the next card slides in and takes focus, and the answer's Undo stays on the card for its five seconds. With
  nothing waiting there is no card. On a phone the card is a sheet over the talk bar, and it folds to its head while
  you type in the talk bar.
- **Fewer things over the office.** Room signs and the bubbles over people show only where something happens now: someone
  at work, stuck, in a meeting or answering you. The front desk's sign gave way to the card. A room nobody works in
  keeps a key the keyboard reaches. The summary box over the office is gone, and Progress says how many things need you
  in one line instead of listing them again.
- **The live strip is off by default.** The relay lines that stacked over the talk bar are in the feed (the talk bar's
  Feed key, on phones too). More's "Show the live strip" brings it back in this browser.
- **The side panel opens when you ask for it.** It no longer shows the inbox by default on desktops, and it leaves no
  pull on the window's edge. The inbox you open is a step of its own: Back closes it.
- **Try it in the web demo.** The demo lobby has "Try it: start a project". It opens the real start form with the words
  of one real Claude Code run, recorded once from an empty folder on Sonnet. Start replays that run sped up ×8: the todo
  list fills the board, a helper appears with its cost, and each permission prompt waits on the card for your tap. It
  ends with the run's last words. Nothing runs in your browser, so if you type other words, the form says it will replay
  the recorded run instead. The demo lobby also shows a plain one-session job beside the team companies.
- **The new Workling.** The green Workling mascot replaces the 3D one, in the logos, the social preview and the favicon
  of the office and the demo.

- **A turn's end reads as one.** A job whose session ended its turn with words, and waits for nothing else, reads
  "Your turn" in its bar and on its lobby card; "Waiting for your OK" is kept for permission prompts and plans. The card
  says "Claude Code asks you." only when its words end in a question, and "Claude Code finished its turn." otherwise,
  with "Reply in your own words".
- **Only the latest words wait.** When the session goes on by itself after ending a turn (a background subagent or
  command reporting back), the words it ended that turn with leave the inbox, so the card never shows words the session
  has moved past. A reply you were writing to them stays on the card and reaches the session as a message. While its
  helpers still run, the job reads Working.
- **Helpers count as at work.** More's "At work" counts a session's running subagents too.
- **Prompts say Run once.** A command's prompt read "Claude Code asks: Run Run npm test"; it now uses Claude Code's own
  description of the command as it is.

## 0.2.0, 16 November 2026

Worklings is now Claude Code with an office around it. A new job is one unmodified Claude Code session on your words,
with your own setup; the office adds control, organization, a fine-grained view of what the session does, and the fun of
watching it. The company of roles from 0.1.0 is still there as an experiment ("A team"), and four benchmarks of it
explain why it is no longer the default (`SPEC-v0.7.md`).

### What a 0.1.0 user notices

- **The default job is one Claude Code session.** The start form asks how the work runs: "One Claude Code session" (the
  default) or "A team (experimental)". One session gets your words verbatim as its first message, nothing appended, with
  the setting sources, skills, plugins, MCP servers, tools, permission rules, model and effort your own `claude` would
  use. It starts at once: no CEO, no proposal, no plan to approve, no work branch and no commits by the office, and
  nothing of the office's written into your project except its records in `.worklings/` (which git ignores). A test
  (`test/parity-contract.test.ts`) holds its launch to plain `claude -p` given the same choices, plus a short list of
  allowed differences (`ALLOWED_DIFFERENCES` in `src/core/plain.ts`): the stream-json transport and `--verbose` the office
  reads it through, the session id that lets it resume, one settings file with the office's hooks, and a budget.
- **The office around it.** Pause, resume and stop. Claude Code's own permission prompts arrive in the inbox exactly when
  Claude Code would ask, and so do its last words when it ends a turn: your reply goes back as you wrote it. Talk to it
  mid-run from the talk bar. Choose the model, effort and permission mode for one job (`worklings new --model`,
  `--effort`, `--permission-mode`; effort can change in the office). A job's budget becomes Claude Code's own
  `--max-budget-usd` for what is left of it, so it stops a session mid-turn and never steers it.
- **Its own structure, shown.** Claude Code's todo list (TodoWrite, or its task tools) is the task board, live; it shows
  only when the model keeps one, and Sonnet 5.5 and Haiku 5.5 keep none unless your Claude Code turns the todo tools on.
  Each subagent it starts with the Agent tool is a helper beside its desk on the floor and on the board, with its own cost.
  Tool calls show as desk activity and on the timeline.
- **Plan first**, an extra that is off by default (`worklings new --plan-first`): the session starts in Claude Code's plan
  mode, and its plan waits in the inbox as "Approve the plan and start the work"; approving it leaves plan mode for the
  job's own permission mode.
- **Approvals.** A one-session job is asked exactly what Claude Code would ask; the office decides none of it. The one
  refusal of its own is stopping programs across the computer (by name, image, pattern or a port lookup, or all of them):
  a stop by process id, of what the session started, goes on as Claude Code decides.
- **The team is an experiment.** "A team (experimental)" in the start form, or `worklings new --team`: a Lead plans, one
  Builder builds the whole request from your words, and a strict Reviewer checks it and sends fixes back, up to two
  rounds. In our tests it cost about twice as much as one session and was not better. The full company of job titles
  from 0.1.0 is kept for experiments behind `WORKLINGS_SHAPE=classic` (also `solo`, `harness` and `plain`), a developer's
  override that wins over the form's choice for new companies.
- **Portfolios and the studio chat** in the lobby (below).

### Is it as good as plain Claude Code?

A parity bench compared a blank `claude -p` with a blank Claude Code inside Worklings: 20 pairs over 10 tasks (a bug fix,
a feature, a refactor guarded by tests and a change across several files in existing code; two web apps, a CLI, an API,
a game and a data script from scratch), Sonnet, Claude Code's default effort and the same permission mode on both.
Hidden tests came out level, cost 1.01 times plain, prompts to the person 0 and 0, and a blind pairwise judge (Opus, both
orders) scored Worklings 0.46 where 0.5 is a tie. Time was 1.04 times plain by the median pair; two Worklings runs hung for
five minutes on a test script the model wrote, which put the mean at 1.21. That is no difference 20 pairs can detect, not a
proof that the two are the same.

### Upgrading from 0.1.0

Nothing needs migrating. A company made in 0.1.0 has no shape in its records, and the code reads that as `classic`: it
reopens as the company of roles it was, with the CEO, its org and its plan. Everything new in this list for one-session
jobs applies only to companies started in 0.2.0. What changes for a 0.1.0 company:

- **Its desks start lean.** A desk loads only what its person was assigned, and a 0.1.0 company assigned nothing, so its
  desks get their level's defaults: Read, Edit, Write, Bash, Glob and Grep for makers and checkers; Read, Bash, Glob and
  Grep for the CEO and managers; no skills, no MCP servers, and not the `CLAUDE.md` in your home folder. The project's
  own `CLAUDE.md` still loads. A person who needs one of your MCP servers has to be given it in a new org proposal.
- **It reads as Balanced with no budget,** and keeps its desks at once.
- **A routine "done" report closes its task without a manager's review;** the manager reads it as a digest line.
- **MCP tools ask on first use,** with "Always allow" for the whole server.
- **Status lines are the office's**, and a person may stop a program their own desk started, by its process id, without
  asking.

### Added

- **One-session jobs** (`src/core/plain.ts`, `src/runtime/plain-desk.ts`) and the start form's choice of how the work runs,
  kept in each company's own records so it reopens the same way. `worklings new` takes `--model`, `--effort`,
  `--permission-mode`, `--plan-first` and `--team`.
- **The machine-wide kill refusal** (`src/runtime/kill-refusal.ts`), a PreToolUse hook on Bash and PowerShell. It reads the
  scripts handed to other shells (`bash -c`, `powershell -Command`, `cmd /c`), stops by a lookup through a variable, process
  objects' `.Kill()` and packages such as `kill-port`, and lets `kill <pid>`, `taskkill /PID`, `Stop-Process -Id $proc.Id`,
  a piped process object, `kill $(jobs -p)` and mere mentions through.
- **Portfolios.** In the lobby, "New portfolio" groups companies under a name, a shared budget and an optional shared
  brief. A company is in one portfolio at most. The lobby shows each portfolio as one card rolled up from its companies;
  its page lists them. The shared budget is a hard cap, API-equivalent: once its companies together reach it, every one
  pauses as at its own budget. The shared brief reaches a team's CEO through its brief file; a one-session job, which
  reads only your words, doesn't get it. Portfolios live in `~/.worklings/portfolios.json`.
- **The studio chat.** One chat in the lobby that asks and relays across your companies, on one lean Claude Code desk of
  the hub's (Sonnet, changeable in the chat), with only its own tools: list companies and portfolios, read a company's
  summary, plan, progress, checklist and what waits on you, and message one CEO, a portfolio's CEOs or all of them. It
  cannot approve anything, answer the inbox, change a budget or a plan, or start, pause or stop work, and it cannot write to
  a one-session job, which hears only your own words. Its messages reach a CEO as a turn from "the studio chat", never as
  yours. It starts when you write and closes after five idle minutes; each answer shows what it cost. It lives in
  `~/.worklings/studio/`.
- **For the team and the classic company:** a spending plan chosen before the start (Lean, Balanced, Thorough, with a
  whole-job estimate and budgets per company and per person); `loads` in the proposal and `studio.yaml` (tools, skills and
  MCP servers per person, approved by you and signed with the hub's key); contracts, integration and verification tasks for
  big plans; a final review with fix rounds, strict in the team.
- **`node scripts/accounting.ts <company folder>`** breaks a company run down by person, trigger, work and token kind, from
  the company's records and Claude Code's transcripts, calling no model; `scripts/probe-desk-prompt.mjs` measures a desk's
  first request.

### Changed

- **Desks stay warm.** A reopened desk reads its conversation from the prompt cache: a random scratch-folder name in each
  desk's prompt rewrote 8.0M of 10.3M cache tokens across 95 real desk transcripts. An idle desk keeps its process until
  the idle time in Settings (5 minutes by default) or until room is needed; desks at once counts people working, not open
  desks.
- **For the team and the classic company,** desks start lean (13.6k tokens in a maker's first request against 52.9k, with
  your deny and ask rules, hooks, sandbox and environment carried into the desk's own settings, completely or not at all),
  the office takes in routine reports itself, people write short reports, a task carries its own tests, and org tools are
  called by their full names.

### Fixed

- A reopened desk no longer rewrites its whole conversation into the prompt cache.
- An edit to what a person loads in the proposal is kept.
- A report over the length limit says how many characters to cut instead of failing seven times.
- The whole-job estimate, the "Checking" state, the end check's handover, the final review's checklist across plan
  versions, and the lobby card's and progress view's counts.

### Security

- Inline code (`node -e`, `python -c` and the rest) in a team's or classic company's desk runs without asking only when it
  is literals, arithmetic and printing them; anything else asks. A read-only allow-list tried during 0.2's development
  was dropped after five security reviews each found a way around it.
- From the independent review of the approvals policy (14 Nov 2026), each of these now asks: `PYTHON*`, `npm_config_*`,
  `YARN_*`, `PIP_*`, `BROWSER` and Java agent options; writing `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `pip.conf` or `pip.ini`
  (every time, as `.claude/` does); unpacking an archive into the project; words after `--` in `npm test` and `npm run`; a
  server or debugger listening beyond this computer; `mklink` links out of the project.
- `.worklings/approved-loads.json` is signed with the hub's key, so a file written by hand grants no tools or servers.
- The checklist's evidence link stays on the preview.

## 0.1.0, 13 November 2026

The first release. This one entry covers everything built so far, in three layers: the studio generator and the office, then what the office learned to
say about the work (Now, Catch me up, Ask aside, meetings), then v3, where the office runs a company of Claude Code
sessions. There is nothing to migrate from, except that the project was called Headcount while it was built: see
"Renamed from Headcount" below. Files written by earlier layers keep working in v3 (see "Changed").

### Added in v3: the office runs the company

The company:

- **`worklings hub`** serves a lobby of companies on one port (7430), so several projects run at once and switching
  between them keeps the others working. Each company is a project folder with its org, office, work branch and state.
- **`worklings new <dir> --prompt "<one sentence>"`** starts a company: the CEO, alone in an empty office, drafts the
  org in about a minute. Through a running hub when there is one, else in a hub started for it. Without `--prompt`, or
  with `--offline`, `worklings new` is the studio generator as before. From the lobby you can pick or create a folder
  and write the first prompt instead.
- **The proposal.** When the first prompt is short or leaves choices open, the CEO first asks three to five scoping
  questions, each with its pick and why; "Use the CEO's picks" answers them in one press. Then it proposes an org sized
  to the goal, 2 to 25 people with a sentence on why: one to three makers for a small tool, heads where an area has
  three or more people, team leads where a room passes six, with models, looks and an office theme, every area of the
  project covered and niche specialists included.
  Roles the library lacks are written for the company to the library's bar and linted. The CEO's open choices arrive as
  questions. You change the chart by talking to the CEO or by editing cards, then press "Start the company".
- **Parallel people.** Each working person is their own Claude Code session at a desk. At most 8 work at once per
  company (Settings changes it; the hub caps all companies at 50) and the rest wait for a desk. A desk closes after 5
  idle minutes and reopens on the same session. People with no work have no session and cost nothing.
- **Talk to anyone, with effect.** A message to a lead is passed down to the people it concerns; a message to a busy
  person reaches them at their next step; an unsent message can be taken back until it is delivered. **Stop** interrupts
  a person and gives them a new instruction, or holds them.
- **The inbox.** Every question (two to four options and free text) and every approval, with a count on every screen.
  Answers wait 5 seconds with an Undo. Approvals say what is asked in plain words, with the exact command or path one
  click away, and "Always allow" saves a scoped rule for that company.
- **Autonomy.** People decide routine work themselves. Product and design choices go to you as questions. Push,
  deploy, publish, spending money, deleting outside the project or a branch, messaging people outside the company and
  global config always ask. Changes to how Claude Code or git runs in the project (`.claude/`, `CLAUDE.md` and files it
  imports, hooks, `.mcp.json`, git config) always ask, with no "Always allow".
- **Work without collisions.** Assignments name the files a person owns; long or risky tasks get their own worktree;
  each company commits per finished task on a branch of its own and never pushes.
- **Change the company by talking.** "Add a games room with an arcade theme", "fire the SEO specialist" and "hire a
  German copywriter" change the org and the office live. `studio.yaml` and the agents record it and `rehire` undoes a
  firing; a fired person's reports pass to their manager.
- **Open in Claude Code.** Hand a person's session to a terminal and bring them back.
- **Resting.** When Claude Code reports a usage limit or overload, every company of the hub rests until the reset time
  it gives ("Resting until 14:00") and picks up by itself.
- **Restarts.** A restarted hub reopens every company. Messages, tasks, sessions and the log are on disk; open
  approvals count as expired; people with undelivered messages or work in progress get a resumed turn.

What you see:

- **A company's views:** the office, the inbox, the org (each person's conversation, task, latest report and cost), the
  tasks (the work tree, with a task's report and diff on request) and Dashboards, with Preview, Customize and Settings
  beside them. They were tabs when v3 was first built; the stage and dock below replaced the tabs. Everything reads in
  outcome words; tool-level activity stays under a person's details.
- **Dashboards.** Progress, Spend (per person and room, burn rate) and Timeline are built in. The CEO publishes more on
  request from a fixed set of widgets (stat, progress, bars, line, list, table), checked against a schema; a malformed
  one is refused with a sentence, and one can be taken down with Undo. No HTML or script from people is ever run.
- **Preview.** The project's dev server behind a proxy on a port of its own, beside the office, full screen and on the
  phone, with screenshots people share.
- **Phone access.** `worklings hub --tailnet` serves the hub through `tailscale serve` to your tailnet only, over HTTPS,
  with the token required for everything; it never uses Funnel. Previews get their own HTTPS port. Tested against a fake
  `tailscale`; the real check on a computer and an iPhone is still to do.
- **Art.** Themed scenery in nine themes (office, café, game studio, shop, lab, garden, city, arcade, music studio)
  chosen to match the project, built from CC0 packs by `node scripts/art/build.mjs` (credits in `CREDITS.md`). Moments
  in the 3D view: a relay is someone walking over to tell someone, a person who needs you waits at the front desk with
  a paper, a finished milestone gets a small celebration, tired people show it, and the office turns to night while the
  company rests. People are drawn by a new renderer that is still landing.
- **Library:** 41 roles (new `ceo`, `head`, `office-manager` and `privacy-officer`).
- **Watching stays.** Normal Claude Code sessions in a project still appear, as visitors next to the company. The demo
  holds a made-up company at `/c/demo`.

Under the hood:

- A switchboard runs each desk as the user's own `claude -p --input-format stream-json --output-format stream-json`,
  checked against Claude Code 2.1.312 and pinned with recorded fixtures. The org tools are an MCP server on `127.0.0.1`
  with a token per desk. New endpoints are listed in `docs/architecture.md`.
- Tests: `test/fake-desk.mjs` stands in for a desk, `test/fake-tailscale.mjs` for Tailscale; `test/hub-integration.test.ts`
  runs a whole company through the real hub; the Playwright projects `v3` and `v3-phone` drive the lobby, proposal,
  inbox, messages, dashboards, preview and resting.
- Real-world checks that cost cents: `scripts/check-desk.mjs` and `scripts/check-orgtools.mjs` (`--probe` is free).

### Added in v3: steering, and a first run that guides

Steering, so you run the company and not only watch it:

- **Plan approval.** After Start the CEO proposes a plan and nothing begins until you approve it (the default, "before
  work"). Settings can change it to every milestone, or off. A revised plan shows what changed from the last version.
- **Messages** to a room, a team or everyone, with a trace that shows each one landing, being acknowledged or flagged.
- **The task board:** priority (work is handed out in that order), pause, reassign, cancel and add a task.
- **The decision log:** who decided what, when and why, with Undo where it can be undone and Reconsider.
- **A leash per person,** up to "Check with me before each task".
- **The command palette** (Ctrl+K) reaches every action by typing.
- **Steering by talking:** when you ask, the CEO changes the plan, a leash or a setting, through the same code.

One command and a first run that guides:

- **`npx worklings`** opens the hub's lobby, with the demo company and "Start your first company". `worklings demo` and
  `worklings hub` work too. Proven from `npm pack` in a clean folder on Windows; CI repeats it on macOS and Linux. The
  package is not published yet.
- **`worklings doctor`** checks Node, Claude Code and its sign-in, git, the ports and Tailscale, each with one plain fix.
- **First run.** The lobby says when Claude Code is missing or signed out, and the proposal shows what a company costs an
  hour on your plan before you press Start. Watching an existing project installs hooks only with your consent.
- **The plugin from GitHub:** `claude plugin marketplace add zeusstudiodev/worklings`, then
  `claude plugin install worklings@worklings`, then `/worklings:hub`, with no clone or build. Proven from a local
  marketplace; the GitHub route waits for the repository.
- **A live demo in the browser** (a static build of the demo company, no server, no Claude Code), built for GitHub Pages
  and not deployed yet.
- **A hero video, feature clips and v3 screenshots** in `docs/launch/`, recorded by a script in the repository.
- **A v3-first README,** with a comparison with Bot Crossing, Pixel Agents, Claude Squad and Claude Code Game Studios.

### Changed in v3: the stage and dock

The company's screen was redesigned after the first hands-on use of v3. The tab strip, the Now tab, the composer page, a person's own
message box and the wide view are gone.

- **The office fills the window.** A company bar floats over it with Office, Org, Tasks and Dashboards, the inbox count,
  Preview and the company's menu. On the office, the map has Zoom, Fit and Full screen.
- **Boards over the map.** Org, Tasks and Dashboards open at full width, with the office shrunk to a live mini-map that
  brings it back on a click or Esc. Each board has its own address, and Back and Forward work. Preview and a task's
  changes open in the same frame.
- **A side panel** shows what you opened (the inbox, a person, a task, where a message went, a decision, Customize,
  Settings), named in the address by `?panel=`. It resizes by drag or keyboard, remembers its width and can be hidden.
  From 721 to 895 px wide it floats over the board; on phones it and the boards are sheets, and a phone opens on the
  office with the inbox peeking.
- **The talk bar is the one box.** `@` mentions: the first one picks who hears a message, and one after the first word
  says who it is for, so "@Ada ask @Kai to darken the palette" goes to Ada, who passes it on, and the hint row says so
  before you send. `/` commands include `/hire`, `/fire`, `/move` and `/rehire`. Stop and a history of what you sent
  are in the bar.
- **A live strip and the feed.** The strip over the bar shows the latest lines, relays included. The feed opens from it:
  threads, filters by person, room and kind, unread markers, questions and approvals answered inline (one state with the
  inbox, with the same 5 second Undo) and older pages from `GET /api/c/<id>/messages?before=`.
- **The task board** is a board of sticky notes by status, with lanes by person or room and filters. Dragging a card
  steers: dropping a Queued card on Working starts it next. Every drag has a keyboard or Move menu way, and a drag that
  needs words (cancel, reassign) opens its form first.
- **The org chart is a real tree,** with pan and zoom for 40 people, keyboard navigation as a tree, and hire, fire and
  move from a node; on phones it is an outline.
- **Dashboards at full width,** with the decision log as a sub-view of them.
- **Portraits:** cards, chart nodes and the To picker show each person's own 3D look.
- **The demo company talks on its own,** and its Ledger company has 40 people and 100 tasks for the crowded states.
- **Tests:** the Playwright projects `v3-1024`, `v3-768` and `v3-phone-side` run the shell, boards, task board and org
  specs at 1024 x 768, 768 x 1024 and 812 x 375.

Migration: none. Addresses from before the redesign still open, read as their new form.

### Fixed in v3: what the gates found

Each fix has a test.

- **Citations.** The CEO may act "as you asked" only on words you typed to it. Messages the office writes in your name
  (the answer to a question, the note on a denied approval, a plan comment, a Reconsider) are marked `fromOffice` and
  never count as your word.
- **Trusted.** It now reaches the approvals policy in a real hub, where before it applied only in tests. Nobody becomes
  Trusted without your yes in the inbox, whether by talking, by clearing a leash in a Trusted room or by a hire, rehire
  or move into one. Under Trusted, a URL, `host:port`, `user@host:` or UNC word leaves the project and asks, and
  programs that reach the network ask under every leash.
- **Delivery.** Your messages and the office's notices go ahead of queued task work, so a full set of desks no longer
  keeps them waiting. A brief already on a busy desk gets the stop notice when its task is cancelled, paused or moved.
  A paused task stays paused through a restart and when its person is brought back from Claude Code.
- **Commits.** A `git commit` in the shared checkout is refused with a note: the office commits each finished task.
- **A company in a folder named `demo`** no longer opens the demo company: `demo` is never given as a company's id.
- **Plan approval** is "before work" by default again. Companies founded before the setting existed keep "off".
- **First run.** `worklings new` checks Claude Code before it starts a company. Links printed inside Claude Code carry no
  token. `worklings hub --stop` re-checks the process before it stops it. The proposal's cost line respects a cap of
  one desk. A plan waiting for approval is an inbox item and counts in what needs you.
- **The browser** keeps the focused control in view above the plan's sticky bar, keeps drafts apart for a company
  removed and started again in the same folder, and the static demo works with the browser's site data blocked.
- **Commits beside thousands of untracked files.** A company whose project had `node_modules` but no `.gitignore` could
  not commit a finished task (the file list overflowed the command line on Windows). Stray commits never take
  installed packages, and a repository the office makes starts with a `.gitignore`.
- **Dev servers** a desk starts in the background stop when its person, its company or the hub closes, by PID and
  creation time, even after the shell that started them has exited.
- **Spend after a restart** reads what it was, not $0 until the desks are read again.
- **The CEO ending its turn without a proposal** is said, with its words, instead of "Drafting" with a timer.

### History

Worklings was built in three layers under the working name Headcount: v1 generated a studio and showed it in a 3D
office, v2 taught the office to say what the work is (Now, Catch me up, Ask aside, meetings), and v3 lets the office run
a company. It was renamed Worklings before anything was published; see "Renamed from Headcount" for what keeps
working. The first public release is 0.1.0.

### Added in v1 and v2

The generator:

- Thirteen kinds of project, three sizes each, from a library of 36 roles (41 with v3), 24 stack rules, 8 workflows and 8 review
  gates. Detects the stack, commands and folders of an existing project; never overwrites edited files without
  `--force`.
- Commands: `worklings new`, `detect`, `domains`, `adopt`, `tailor`, `hire`, `fire`, `rehire`, `move`, `model` and
  `hooks install`, `status`, `uninstall`.
- A Claude Code plugin with `/worklings:new`, `/worklings:office`, `/worklings:adopt`, `/worklings:hire` and
  `/worklings:fire`.

The office:

- A 3D model of the studio with live people, a cost ledger, person and room panels, payroll advice and the story of
  the work; hire, fire, rehire, move, change model and edit rules from the browser.
- Live events from Claude Code `http` hooks, tokens from session transcripts, optional exact cost from
  OpenTelemetry. The office shows agent-team tasks, who is at work and the input, output and cache split.
- `worklings replay` for recorded sessions (the replay bar picks a session) and `worklings demo` for a made-up studio.
- **Now**, the first tab and free: a headline (who needs you, who is on which request, the latest report), then the
  people who need you, who are on it and who finished in the last 15 minutes, each with their goal, the request it
  serves, their result and an Ask button. Everyone else folds away. Live, replay, demo, phone, keyboard and
  reduced-motion states are designed.
- **Outcome words.** People are described by outcome (needs your OK, needs your answer, has a question, stuck, on it,
  done) on Now, in Team, in badges and in the bubbles over their heads, not by their last tool call.
- **Story**, the tab that was the Log, and a badge's Recent work: what happened as milestones, newest first ("You
  asked: …", "The lead briefed the UX designer: …", "The QA engineer reported back: …", "The mobile engineer asked for
  your OK to run …"), never tool calls or file reads. A brief sent with SendMessage counts too.
- **Meetings.** When the lead briefs someone and when someone reports back, that person walks to their lead's desk
  (up to four at once). With reduced motion, in replays faster than 4x and for events that are already old when the
  page opens, nobody walks and the bubbles carry it.
- **Catch me up**, a button on Now: a few plain sentences on what happened since you last caught up (or the last
  hour), written from what the office already saw. The estimate shows before and the cost after.
- **Ask aside**: ask anyone a side question and get a first-person answer without interrupting them, from a
  conversation in the 3D view next to them (the whole sheet on phones), opened from their name tag, their badge or
  their Now row. Three suggested questions, or your own up to 500 characters. The lead of a live session answers from
  a read-only fork of its session; subagents, contractors and replays answer from their transcript.
- Catch me up and Ask aside go through your own Claude Code (Haiku by default): Worklings holds no API key. Calls are
  read-only and one-turn, with no tools, no MCP servers, no hooks and no transcript left behind; the office makes at
  most one at a time and six a minute. Set `WORKLINGS_CLAUDE` to the full path of `claude` if the office can't find
  it. The demo answers with marked samples and calls nothing.
- The office's own spend is a payroll line, "The office", and counts in the totals.
- New endpoints `POST /api/ask`, `POST /api/catch-up` and `POST /api/aside/cancel` (token required, in every mode).

### Changed

- The office used to make no model calls. It now makes them, but only when you press Catch me up or send a question
  (see Added), so the privacy section of the README describes exactly what is sent.
- **The office can now start, steer and stop Claude Code**, in a company. Until v3 it only watched. Watching an
  ordinary project is unchanged and `worklings [dir]`, `replay` and `demo` work as before. Nothing starts a session
  unless you start a company. Migration: none. A company writes `.worklings/` (gitignored, holding the signed event log,
  the state and shared screenshots) in its project, and the hub keeps its registry and the key that signs each log in
  `~/.worklings/`, outside every project.
- `studio.yaml` gains optional fields (`name`, `level`, `reportsTo` and `look` per role, a `theme` per department and an
  `office` section). Files without them read as before, so no migration is needed. The validator keeps the org a tree
  under one CEO and names the field at fault.
- Desks run with prompt caching on, unlike the office's one-shot calls (Catch me up, Ask aside), which keep it off.
- Sessions a desk runs show in the office as their person, not as a visitor.

### Renamed from Headcount

The project is now **Worklings**: the package and command (`worklings`), the Claude Code plugin and marketplace
(`claude plugin install worklings@worklings`), the slash commands (`/worklings:new`, `/worklings:office`,
`/worklings:adopt`, `/worklings:hire`, `/worklings:fire`), the environment variables (`WORKLINGS_CLAUDE`,
`WORKLINGS_HOME`) and the words in the office. New files carry the new name. What earlier versions wrote keeps working:

- Hooks installed with `?from=headcount` in their URL still reach the office and are found by `worklings hooks status`.
  `worklings hooks install` replaces them with `?from=worklings`, and `uninstall` removes both.
- A `CLAUDE.md` block between `<!-- headcount:start -->` and `<!-- headcount:end -->` is replaced by a
  `<!-- worklings:start -->` block the next time the studio is written.
- Role notes between `<!-- headcount:notes -->` and `<!-- /headcount:notes -->` are replaced by a `worklings:notes`
  block when a role is tailored again, and still show in the office until then.
- A `studio.yaml` with `tool: headcount` still loads.
- A library skill (your own `--library` folder) with a `headcount:` block in its frontmatter still loads; `worklings:`
  wins when both are there.
- `HEADCOUNT_CLAUDE` and `HEADCOUNT_HOME` are read when the new variables are unset, and a token in `~/.headcount/token`
  is copied to `~/.worklings/token`, so bookmarked office links keep working.
- An office tab that stored its token under `headcount-token` reconnects without a new link.

To switch over, run `worklings hooks install` in each project and set `WORKLINGS_CLAUDE` where you had
`HEADCOUNT_CLAUDE`. The plugin is installed under its new name: remove the old one with
`claude plugin uninstall headcount@headcount`.

### Security and reliability in v3

From the independent security review of the switchboard, org tools, preview proxy and tailnet mode (5 Nov 2026). The
trust model is in the README ("How much to trust a company") and `docs/architecture.md` ("Trust"): a desk is your own
Claude Code with your authority, and Worklings is not a sandbox.

- Every message body is delivered inside a fence with a fresh marker, so a message can't pass for a turn of its own.
- The company's event log is signed with a key outside the project, so editing `.worklings/` can't forge a message
  from you.
- Desk tokens live only in memory and in the desk's environment, never on a command line or in a file in the project.
  Each org-tool call is checked against the person the token belongs to.
- The org tools, the approval hook and desk intake accept connections from this computer only, with a loopback `Host`.
  The preview runs on a port of its own, so the app's scripts can't reach the office's API.
- Changes to how Claude Code or git runs in the project always ask, with no "Always allow", including files that
  `CLAUDE.md` imports.
- Desks never read, set or pass on a credential, and Worklings does not use the Claude Agent SDK.
- Everything people write is capped, masked for credentials and shown as text. Dashboards are data checked against a
  schema.
- Folders for a new company are browsed from this computer only, never over the tailnet or the local network. The hub
  refuses `--lan`; use `--tailnet`.

### Fixed

- Messages typed while Claude is working now appear in replays.

### Security and reliability

From the independent code and security reviews (4 Nov 2026):

- Generated files say `worklings` or `/worklings:office`, never `npx worklings` (nothing is published yet).
- The office changes nothing while `studio.yaml` has a mistake; rehire is an exact undo and moves files back only from
  the Worklings archive; `worklings new` keeps fired roles fired; agents named like "Frontend Developer" get a slug id.
- Model and room changes are drafts until you press Save.
- Hooks and telemetry are taken only from this machine and only for sessions in the project; reads need the token
  outside the demo; `--lan` links last one run; transcripts are read only from Claude Code's `projects` folder; ids
  from outside can't reach `Object.prototype`; writes never go through symlinks; library skills can't carry hooks or
  tool grants; commands show without their values.
- Transcript text and the catch-up account are masked for credentials before they go into a prompt or onto the
  screen, and sit in a fenced block with a random marker. Free text from hooks, transcripts, replays and session titles
  is masked as it arrives.
- Catch me up and Ask aside run Claude Code with `--disallowedTools "mcp__*"` on top of no tools and no MCP servers,
  in a child environment without the host Claude Code session's `CLAUDE_CODE_*` and `CLAUDE_AGENT_SDK_*` wiring (your
  own sign-in and network settings stay). Forks happen only for UUID session ids; transcript reads take regular files
  only and count against the 60 s deadline; with `--lan`, questions and catch-ups are taken only from this machine.
  A model that tries to use a tool gets a plain sentence. Checked against Claude Code 2.1.312 (see
  `docs/claude-code-surfaces.md`).
- No double counting after `claude --resume`; OpenTelemetry cost counts once it covers every request; old sessions
  fold into the payroll's totals; agents that went quiet reach the browser; replays run on the session's clock.
- Python dependencies are read from pyproject.toml, Pipfile, requirements and setup.py as declared, not from prose
  (adds `smol-toml`); code in subfolders counts as code.
