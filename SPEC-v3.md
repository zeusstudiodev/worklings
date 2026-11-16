# Worklings v3: the office runs the company

v1 (the generator and the watching office) and v2 (Now, Catch me up, Ask aside, the rename) are specified in
`SPEC.md`. This file is v3.

## Why

The maintainer, 4 and 5 Nov 2026, watching v2 being built: he wants to run his projects from Worklings instead of the Claude
chat. He is the stakeholder and the company works for him. He gives the first prompt, talks to the CEO or to anyone
else, steers decisions, approves what needs approving and follows progress at the level a person would report it,
never tool by tool. It should be a game-like place that is good to look at and fun to use, and it should work better
than a plain chat because the org is real: specialists in parallel, managers who break work down and check it, and
one place to see all of it.

v1 and v2 watch Claude Code. v3 runs it.

## Decisions (the maintainer, 4 and 5 Nov 2026)

- **Control.** The office starts, steers and stops the work. This reverses v1's "the office never controls sessions".
- **The org from the first prompt.** Leadership, then people management, then the people doing the work: complete
  enough that every area of the project has a person, niche ones included, and no more complex than that.
- **Many people at once.** Work is split so that lots of people work in parallel, not a few in turn.
- **Talk to anyone, with effect.** At any time the stakeholder can message any person. A message to a lead is
  relayed down to the people it concerns, and on down to whoever does the work.
- **High level only.** A human account of the work (who is on what, what got done, what's blocked, what needs him).
  No tool calls, file reads or commands in the views he reads.
- **Everything in the office.** Approvals, questions, the app's preview, dashboards and settings, so the Claude chat
  is no longer needed.
- **Changed by talking.** Telling the CEO "I want a new office", "hire a German copywriter" or "add a games room"
  changes the office and the org. Worklings is an open-source tool people adapt, not a finished app.
- **Fully functional.** People use the project's and the user's skills, connectors (MCP) and subagents. The structure
  has to pay for itself in better work, not only look good.
- **Several companies at once.** Each project is its own world and office; switching worlds keeps the others working.
- **From the phone: Tailscale.** The office is reachable on the maintainer's tailnet only, never on the public internet.
- **Dashboards.** Progress, spend and timeline built in, plus dashboards the CEO makes when asked.
- **Art.** Much better people, animation and scenery, and scenery that matches the project being built.
- **Claude account: the person's own Claude Code.** Worklings starts the user's installed, unmodified `claude` and
  never reads, stores or passes on its login, so a Pro or Max plan works for its owner. An API-key setting exists for
  people who want per-token billing.
- **Publishing doesn't wait for Anthropic (5 Nov 2026).** Worklings is compliant by design:
  - it runs each user's own unmodified `claude`, signed in through Anthropic's own flow, and never touches credentials;
  - there is no Agent SDK, no hosted service, and no reselling or intermediating of usage;
  - "Claude Code" appears only as a descriptor, never in the name;
  - API-key mode is there for anyone who prefers it.

  Publishing still waits for the maintainer's go.
- **Where it lives (5 Nov 2026; under Zeus Studio since 14 Nov 2026).** The repo is `zeusstudiodev/worklings`, Zeus
  Studio's GitHub organization, the npm package is `worklings`, the plugin installs with
  `claude plugin marketplace add zeusstudiodev/worklings`, and the live demo is https://zeusstudiodev.github.io/worklings/
  (all from `scripts/home.json`). Creating the repo, pushing, publishing to npm and deploying Pages all wait for the
  maintainer's go.
- **Launch prep (5 Nov 2026).** v3 ends with a stage that gets Worklings ready for adoption and GitHub stars, ease of
  installation first. Nothing is published or deployed. See "Launch prep" below.
- **Autonomy: routine alone, ask on choices.** People decide routine work themselves and come to the stakeholder for
  product and design choices and for anything irreversible or visible to others: push, deploy, publish, spending money,
  deleting outside the project, messaging people.
- **Steering, all six (5 Nov 2026).** The stakeholder steers the company "the more flexible the better", so Worklings
  is the best app of its kind:
  - approve the plan;
  - message a room or everyone;
  - see each message land;
  - steer the task board;
  - a decision log;
  - a per-person leash;
  - a command palette, and settings changed by talking.

  Each works by talking (to the CEO or to the person) and from the office. The switchboard and the approvals policy
  enforce them, not prompts alone. Each appears in the demo company. See "Steering" below.

## Facts checked (5 Nov 2026, Claude Code 2.1.312 and its docs)

Terms, quoted from https://code.claude.com/docs/en/legal-and-compliance.md:

- "Developers building products or services that interact with Claude's capabilities, including those using the
  Agent SDK, should use API key authentication [...] Anthropic does not permit third-party developers to offer Claude.ai
  login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of
  their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude
  subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in
  their products?*" That section requires an unmodified binary, and that "each end user must authenticate with their
  own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent
  SDK."
- The Agent SDK overview: "Unless previously approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."

So Worklings does not build on the Agent SDK. It runs the user's own `claude` binary, the route the terms describe for
end users, and it never touches credentials. The maintainer decided on 5 Nov 2026 that publishing doesn't wait for an answer
from Anthropic, since Worklings stays on that route by design (Decisions).

Surfaces (docs, via a research pass; URLs in the run log):

- Agent teams and custom channels only work in an interactive terminal: teammates aren't spawned in `-p` or SDK
  sessions, and `--dangerously-load-development-channels` is ignored there. Remote Control needs a claude.ai login and
  isn't documented for `-p` or SDK sessions. So Worklings builds its own team layer and its own phone access.
- A program driving a session can only talk to its main agent, not to a running subagent. So every person in the org
  is their own Claude Code session; a person may still use subagents for their own fan-out.
- In `-p` mode, a call that needs approval is denied unless a hook or permission tool approves it (2.1.302+). An `http`
  `PermissionRequest` hook waits up to its `timeout` (default 600 s) and returns `{behavior: "allow" | "deny"}`.
- Headless sessions write their transcripts to the same `~/.claude/projects` store as interactive ones, so v1's
  watching (hooks and transcript tails) works on them unchanged.
- Subagents: depth 3 and 20 at once by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`,
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).

Measured against real Claude Code (Haiku, 5 Nov 2026, about 2 cents in all):

1. An `http` `PermissionRequest` hook in `claude -p` was called before the command, waited 2 s for the answer, and the
   command then ran. Approvals can wait in the office.
2. A message given to a busy session as `PostToolUse` `additionalContext` arrived mid-turn, but Haiku ignored it as a
   possible injection. With the system prompt naming that channel it acted on it.
3. A user message written to the stdin of a `--input-format stream-json` session while it was working was taken into
   the same turn at its next step (one result, the extra file created before the turn ended). This is how messages
   reach busy people: as real user turns, not as hook context.
4. The CEO's org design (Opus, no tools, the library catalogue and the org rules in the prompt, about 13 cents each)
   on three first prompts (a bilingual café website with pickup orders, a cozy iPhone game, a Swiss bookkeeping app
   sold on Shopify) gave 18, 20 and 21 people with three to five heads, every area owned and the niche ones included
   (a TWINT payments engineer and local SEO for the café, App Store privacy labels and a Mac-free iOS build for the
   game, a Swiss accounting expert and a bank-statement formats engineer for the app), plus the decisions it needed
   from the stakeholder. With no `ceo` or `head` roles in the library it borrowed `producer`, `product-manager` and
   specialists for those seats, which the new archetypes fix.

## How it works

### Words

- **Hub**: the one Worklings server on a machine, with a lobby of companies.
- **Company**: a project folder with its org, its office, a work branch and its state.
- **Person**: a role with a level (CEO, head, team lead, worker), a room, a manager, a model and a look. A person who
  has worked has a Claude Code session; one who hasn't costs nothing.
- **Desk**: the running `claude` process of a person who is working. Desks close when a person has been idle for a
  while and reopen on the same session when there is work again.
- **Task**: owner, who asked, title, brief, files, done-when, status (queued, working, blocked, in review, done,
  dropped), outcome and parent task. Tasks form the company's work tree under its goal and milestones.
- **Message**: from, to, text, time, delivered. The stakeholder can message anyone; people message their manager,
  their reports and their own team, and reach other teams through managers.
- **Question**: a choice someone puts to the stakeholder, with two to four options and free text.
- **Approval**: a permission request, described in plain words with the exact command or path one click away.
- **Status line**: one sentence a person posts when they start, finish, change step or get stuck. It is what the Now
  board, the bubbles, the timeline and Catch me up read.

### The switchboard (`src/runtime/`)

- Runs each working person as `claude -p --input-format stream-json --output-format stream-json --verbose` in the
  company's checkout (or a worktree, below), with:
  - `--session-id` for a new person, `--resume` for one who has worked before;
  - `--model` from the person's role;
  - `--append-system-prompt` with the house rules, the person's place in the org and how messages reach them;
  - `--mcp-config` for the org tools (below);
  - `--settings` with the office's hooks: `PermissionRequest` to the office with a long timeout, `Stop` and
    `SubagentStop` for liveness;
  - the user's and the project's settings, so their skills, plugins, connectors, CLAUDE.md and guard hooks all apply.
- Uses `findClaude` and the child environment from v2 (`src/server/claude.ts`): the user's own executable, no shell,
  the host session's wiring removed, the process tree killed on stop. It never reads credential files and never sets
  an auth variable; the API-key setting only tells the user how to configure their own Claude Code.
- Delivery: a message for a person with an open desk is written to its stdin and taken at the person's next step; one
  for a person without a desk opens one on their session. Messages arrive as user turns that say who sent them and
  whom they were relayed from ("From Ada, head of design, passing on from the maintainer: ...").
- Stop: interrupts a person's turn (signal, then a resumed turn with the stakeholder's instruction).
  - Changed, 11 Nov 2026: the interrupt is not a signal. The switchboard sends stream-json's `interrupt` control request
    and waits for its answer (`interruptMs`, 15 s), then writes the instruction as the next line; only a desk that
    doesn't answer is killed. A task that is cancelled, paused or moved also stops a brief already written to a busy
    desk.
- Concurrency: at most 8 people working at once by default, set per company and for the hub. The rest wait for a desk,
  and the office shows them waiting.
- Usage limits: a limit or overload result pauses the company until the reset time it reports ("Resting until 14:00"),
  without retry loops.
- Restarts: the company's state lives in `.worklings/` and every person's session is on disk, so a restarted hub picks
  up where it stopped.
- The stdin protocol is the stream-json one the Agent SDK speaks. It is pinned per Claude Code version with fixtures,
  like v1's hooks; if a version changes it, the fallback is one `claude -p --resume` turn per message, with mid-turn
  messages as hook context the system prompt names, guarded by a per-session code (fact 2).
- A harness seam (`start`, `send`, `interrupt`, approvals, usage) keeps room for Codex later.

### The org tools (an MCP server Worklings serves on localhost)

Each desk gets its own token, so every call is tied to a person and checked against what that person may do.

- Everyone: `post_status`, `report` (to their manager, closes or blocks a task), `message`, `ask` (their manager, who
  may take it to the stakeholder), `org`, `tasks`, `share_screenshot`.
- Heads and team leads: `assign` (only to their own people), `relay`, `review`.
- The CEO: `library_catalogue`, `ask_scoping` (since 12 Nov 2026), `propose_org`, `ask_stakeholder`, `set_goal` and
  milestones, `publish_dashboard`,
  `hire`, `fire`, `move`, `rehire`, `change_office` (rooms, theme, decor, looks). The CEO can hand the office changes to
  an office manager.
- Inputs are validated like everything else from outside (lengths, `safeId`, `dict()`, `plainPath`). Hiring and office
  changes go through the same code as v1's reshape, so they are reversible and confined to the project.

### The org: the CEO builds the company

- A new company starts with one person, the CEO, alone in an empty office. Its first task is the org: from the first
  prompt, what `detect` finds in the folder and the library catalogue (an org tool), it drafts the chart on the
  whiteboard and proposes it with `propose_org`.
- Changed, 12 Nov 2026 (the maintainer: "the CEO decisions especially at the start should be validated", and "based on the
  initial prompt and the complexity, ambitiousness etc the CEO should allocate in a smart way"):
  - Scoping first. When the first prompt is short, vague or leaves real choices open, the CEO's first move is
    `ask_scoping`: three to five questions (who it is for, scope and ambition, platforms, quality bar, constraints and
    must-haves), each with two to four options, its pick and a line on why. They are ordinary questions in the inbox;
    the proposal panel shows them as its first state, with "Use the CEO's picks" for every open one at once and the
    talk bar for the stakeholder's own words. Once the last answer applies, the office sends the CEO every answer in
    one message, and only then does it draft. A clear, detailed prompt skips to the proposal with fewer questions or
    none. Start stays the validation of the org; plan approval before work is unchanged.
  - A team sized to the goal. The CEO's proposals hold 2 to 25 people (the CEO and at least one maker, no longer 8 to
    25) and say why in a sentence (`sizing`), which the proposal's summary shows: a single small deliverable gets one
    to three makers reporting to the CEO and no heads, a product with several areas gets a head where an area has
    three or more people, and only an ambitious product grows toward 25. The stakeholder's own edits are held to
    neither, as before.
- The proposal is JSON checked against a schema: company name and goal, rooms, heads, team leads where a room has more
  than six people, workers, who reports to whom, models, looks and the office theme. Usually 8 to 25 people, every
  area the project needs covered, nobody doing someone else's job.
- Library roles are used where they fit and tailored; a niche area with no library role gets a new role written to the
  library's bar (mission, responsibilities, how to work, handoffs, done), checked by the library linter. The library
  gains `ceo`, a `head` archetype tailored per department, and `office-manager`.
- The office shows the proposal as an org chart. The stakeholder changes it by talking to the CEO ("merge design and
  UX", "add a Swiss privacy specialist") or by editing it, then starts the company; people walk in as they are hired.
- Writes `.claude/agents/*.md` and `.claude/studio.yaml`, whose schema gains `reportsTo`, `level` and `look` per role
  and an `office` section (theme, rooms, decor). Runtime state (sessions, tasks, messages, dashboards) stays in
  `.worklings/`, which is gitignored.
- v1's deterministic composer stays: it is the library's front door for `worklings new --offline` and for adopting an
  existing studio.

### Approvals, by the autonomy decision

- Allowed without asking: reading in the project, editing its checkout, its own commands (tests, build, dev server),
  adding dependencies (reported in a status line), commits on the company's work branch.
  - Changed, 11 Nov 2026: a person's `git commit` in the shared checkout is refused, with a note that the office commits
    each finished task. A commit would sweep in other people's half-done work there. A task's own worktree allows it.
- Asked in the inbox: push, deploy, publish, deleting or writing outside the project, branch deletion, paid APIs,
  messages to people outside the company, changes to global config.
- Questions about product and design go to the stakeholder as `ask_stakeholder` questions.
- "Always allow this" writes a scoped rule to the company's settings. Each company works on its own branch, commits per
  finished task and never pushes.

### Parallel work without collisions

- An assignment names the files a person owns; heads keep owners disjoint and integrate.
- Long or risky tasks get their own worktree and branch, merged by the head when done.
- People may use their own subagents for fan-out, as v2's studio does.

### Steering (the maintainer, 5 Nov 2026, "all six")

Every steering action works from the office and by talking, through the same code, and lands in the decision log.
Talking means a message to the CEO, or to the person concerned where the action is theirs.

Actions taken by talking on the stakeholder's behalf must cite the stakeholder's message (approving a plan, changing a
setting or a leash). The company checks that the cited message is the stakeholder's, was sent to that person, and is
newer than what it changes. Making someone Trusted by talking also waits for the stakeholder's yes in the inbox.

- Changed, 11 Nov 2026, from the gates:
  - A message the office writes in the stakeholder's name (an answer, a denial note, a plan comment, a Reconsider) is
    marked `fromOffice` and never counts as the stakeholder's word.
  - Nobody becomes Trusted without the stakeholder's yes, by talking or any other way: a leash cleared in a Trusted room,
    or a hire, rehire or move into one, asks too.
  - Under Trusted, a word that names another computer (a URL, `host:port`, `user@host:` or a UNC path) leaves the
    project and asks, and programs that reach the network ask under every leash.
  - The hub passes each person's effective leash to the approvals policy; before this, Trusted worked only in tests.
  - Plan approval is "before work" by default again; the build had it off for a while.

1. **Approve the plan.**
   - The CEO proposes a plan with `propose_plan`: the goal, milestones (title, done when) and tasks. Each task has a
     title, an owner, files, a milestone, the tasks it waits for, a brief and a done when.
   - The office shows it as an editable plan. The stakeholder approves it; reorders, cuts, edits or adds a milestone or
     a task; or comments on the plan, a milestone or a task (a comment reaches the CEO as a message).
   - Company setting "Plan approval": before work starts (the default for new companies), at every milestone, or off.
   - Nobody starts a task of an unapproved plan. The company hands out only approved tasks, and `assign` is limited to
     approved tasks or a part of one inside its files.
   - "Revise it" said to the CEO brings a new version, shown as a diff against the one before (added, removed,
     changed, moved).
   - The approved plan becomes the task tree: its tasks are created in order and handed to their owners as their turn
     comes.
   - At every milestone: the CEO reports when a milestone is done, and the next milestone's tasks wait for approval.
   - Off: the CEO's plan applies as proposed and managers assign freely, as before. Companies founded before this
     setting existed run with it off.
2. **Message a room or everyone.**
   - The recipient can be a person, a room, a team (a head and their people) or everyone. This holds in the composer
     and for `message`: the CEO may reach everyone, a head their team and room.
   - Each recipient gets a user turn naming the audience: "From Robin to the design room (message m-12): ...". A busy
     person takes it at their next step; an idle one starts a turn.
   - An all-hands briefly gathers people in the 3D view, then they go back; with reduced motion it's a cut.
3. **See your message land.**
   - Every stakeholder message has an id, and relays carry it.
   - A new `ack` org tool takes one sentence on what the person will do with a message, or why they disagree. The
     house rules require it for messages from the stakeholder and from one's manager.
   - Each stakeholder message has a trace:
     - who received it and when, and how (at the next step, or as a new turn);
     - the relays it went through;
     - each acknowledgement;
     - the task changes, reports, decisions and commits that cite it.
   - The stakeholder can name who a message is for ("for Kai"), in the composer or in words.
   - Flags show where it stalls:
     - a recipient it hasn't been delivered to;
     - one without an acknowledgement after ten minutes;
     - a manager who got it and neither passed it on nor acknowledged it;
     - a named person it hasn't reached ("not passed on to the UI designer yet").
   - Remind nudges whoever holds it; Escalate tells their manager, or the CEO.
4. **Steer the task board.**
   - Drag to set priority. The switchboard hands out work in that order: a person's next task, and who gets a desk first
     when the cap is full.
   - Pause or resume a task. A working owner gets "stop and wait" as an interrupt, and the task's turns are held until
     it resumes.
   - Cancel with a reason: the owner stops and the work stays on its branch.
     - A worktree's branch is kept.
     - In the shared checkout, the task's changed files are saved as a commit on a branch named after the task, and the
       files go back to the work branch's version.
   - Reassign with a handover note: the old owner stops, and the new one gets the brief, the note and what was done so
     far.
   - Create a task yourself (title, brief, files, owner, milestone). It reaches the owner in priority order, and their
     head is told.
5. **Decision log.**
   - It records every decision: who, when, what, and why and the alternatives where known. The sources:
     - the stakeholder's answers, approvals and Always allow rules;
     - plan approvals and edits;
     - org and office changes;
     - settings and leash changes;
     - task pauses, cancels, reassignments and new tasks;
     - what people post with a new `decide` org tool (what, why, alternatives).
   - Filter by person, room and kind. Each entry links to its message, task, question, approval or plan version.
   - Undo where reversible: Always allow rules, org and office changes, plan edits, settings and leash changes,
     cancelled tasks. An undo is an entry too.
   - Reconsider sends a decision back to whoever made it with the stakeholder's note, as a message that cites it.
6. **Per-person leash.**
   - Check with me before each task: each new task for that person waits in the inbox until the stakeholder says start.
   - Default: the company's approvals policy.
   - Trusted: the person may do routine work inside the project without asking (other programs, deletes and git
     housekeeping there), and may merge their own task's branch into the work branch. Two things still always ask:
     - setup files: .claude/, CLAUDE.md and its imports, .mcp.json, git hooks and config;
     - everything on the ask list that leaves the project or is visible to others.
   - Set per person or per room (a person's own setting wins), from their panel or by talking. A small badge shows it.
   - Model and effort per person sit next to it and apply at their next desk. Effort is Claude Code's `--effort`.

Also:
- A command palette (Ctrl+K, and a button on phones) reaches every action by typing: message, stop, pause a room,
  approve the plan, change the leash and the rest.
- The CEO changes any company setting when asked ("only four people at once", "Lena checks with me before each task")
  with a `change_settings` org tool. It goes through the same code as the office's settings and lands in the decision
  log.

### Launch prep (the maintainer, 5 Nov 2026, the end of v3)

Worklings gets ready to be adopted and starred, and ease of installation comes first. Nothing is published or deployed.

- **One command.**
  - `npx worklings` with no arguments opens the hub's lobby, with the demo company and a "Start your first company"
    flow. `npx worklings demo` and `npx worklings hub` work too.
  - The package is ready to publish: a prebuilt runtime, no native modules, a small tarball, and a friendly Node 22+
    check.
  - It is tested with `npm pack` in a clean temp folder on Windows, with macOS and Linux covered in CI.
- **First run guides people.**
  - Worklings finds `claude`. If it's missing, Worklings links to the install page; if it isn't signed in, Worklings
    says to run `claude` once.
  - It explains what a company costs on their plan before the first start.
  - `worklings doctor` checks Node, `claude` and its sign-in, git, the ports and Tailscale, each with one plain fix.
  - "Watch an existing project" installs hooks only with consent.
- **Plugin straight from GitHub.** `claude plugin marketplace add <owner>/worklings`, then
  `claude plugin install worklings@worklings`, then `/worklings:hub`, with no clone or build. The built runtime is
  committed at release or fetched on first run, whichever is smaller and safer.
- **Live web demo, no install.** A static build of the demo company and office runs entirely in the browser, with no
  server and no Claude Code. It is ready for GitHub Pages and linked from the README and the repo's About box. It's
  built, not deployed.
- **Hero video.**
  - 20 to 30 seconds of the v3 look, recorded in the repo with Playwright, as a GIF or MP4 with a poster frame.
  - It shows, in order: one sentence typed; the CEO drafting the org on the whiteboard; people walking in and working;
    an approval answered; a relay walk-over; a milestone celebration; night.
  - A short clip for each main feature as well.
- **README, v3 first.**
  - It opens with "Run a company of Claude Code agents from a 3D office", then the video.
  - "Try it in 30 seconds": the live demo, `npx`, the plugin.
  - The features, each with a clip.
  - A fair comparison table: Bot Crossing, Pixel Agents, Claude Squad and Claude Code Game Studios.
  - A FAQ: costs and plan limits, terms, privacy, Windows, macOS and Linux, and Codex later.
  - The Headcount history moves to the changelog. Terms and publishing follow the decision above.
- **The repo.**
  - A social preview image, a suggested topics list, issue and PR templates, a handful of real good first issues, a
    roadmap, a code of conduct and a security policy.
  - Fresh screenshots of the v3 look everywhere, with the v2 images replaced.

### The office

- **Lobby**: every company as a small world with its own look, showing who's working and what needs you; enter one,
  or start a new one (choose or create a folder, write the first prompt).
- **The company**: the 3D office with a room per department, the CEO's office, a meeting room and a screen showing the
  app being built.
- **Now** (v2's tab, fed by status lines): what's happening, in sentences.
  - Changed, 11 Nov 2026 (stage and dock, below): a company has no tabs and no Now. The caption on the office, the live
    strip and the feed say what is happening, in the same sentences; People is the Org board; a person's own message
    box and the composer page are gone, since the talk bar is the one box.
- **Inbox**: questions and approvals, with a count on every screen and on the phone.
- **People**: the org chart; click anyone to talk.
- **A person**: the conversation with them (real messages), their task, status and latest report, their cost, and
  "open in Claude Code" with their session id as the way out.
- **Tasks**: the work tree by room and status; a finished task shows its report and what changed, with the diff on
  request.
- **Dashboards**: built-in Progress (goal, milestones, tasks), Spend (per person and room over time, burn rate) and
  Timeline (status lines, reports, decisions), plus the CEO's dashboards: a list of widgets (stat, progress, bars,
  line, list, table) checked against a schema and drawn by the office. No HTML or script from people.
- **Preview**: the project's dev server through a proxy on its own port, so the app's scripts can't reach the office's
  API; on the office screen, full screen, and on the phone. Screenshots people share appear beside it.
- **Customize**: theme, rooms, furniture and looks, by talking to the CEO or office manager, or directly.
- **In the 3D view**: a relay is a person walking over to tell someone (v2's meetings); someone who needs the
  stakeholder waits at the front desk with a paper; a finished milestone gets a small celebration; context filling up
  shows as tiredness, and a usage-limit pause turns the office to night.
- What the stakeholder reads is status lines, reports, messages, questions and decisions. Tool-level activity stays
  out of the main views; a person's panel can show it under details.

### Stage and dock (the maintainer, 11 Nov 2026, before publishing)

After trying v3, the maintainer asked for "coolness and functionality, something that is user friendly": a bigger, friendlier
place to talk and give commands, the org as a real tree, the tasks as a card board like GitHub Projects, and dashboards
at full width. The 3D office stays the star. The interface should feel like a game HUD that belongs to the diorama
(`docs/design.md`), not a dashboard kit. It replaces the side panel with tabs, and it lands before anything is published.

- **The shell.** The office fills the window, with the company bar on top. On the right, an **inspector** for a
  person, the inbox and approvals: resizable by drag and by keyboard, it remembers its width and collapses. At the
  bottom, a **dock**.
- **The dock**, a game-style talk bar:
  - `@name`, `@room` and `@all-hands` with autocomplete pick who hears it;
  - `/commands` run the palette's commands, and Ctrl+K stays;
  - a live strip above it shows the latest lines, relays included ("Leo to Mia: darker palette");
  - it expands into the feed drawer.
- **The feed**, one company conversation like a team chat: everything the stakeholder says, every reply and every relay
  down the org as it happens (the trace and the acks, as people would report them, never tool logs). Filters by
  person, room and kind, and unread markers. Questions and approvals appear inline and can be answered there. A
  person's thread opens in the inspector beside the feed.
- **Boards over the map.** Org, Tasks and Dashboards open full width over the office, which shrinks to a live mini-map
  in a corner; clicking it or Esc returns. Every board has its own address, so Back and Forward work.
- **The org chart, a real tree**: the CEO, then heads, then leads, then workers, each with live state (working, waiting,
  asking, idle), current task, model and spend. Clicking someone opens them in the inspector to talk; relays animate
  along the lines. It pans and zooms for 40 people, is a keyboard tree with arrow keys, and on the phone a vertical
  tree that collapses. Hiring, firing and moving people stay reachable from it.
- **Tasks as a card board**, like GitHub Projects: columns by status, "waiting on you" among them; cards like sticky
  notes in the office's style, coloured by room, with the owner's face, the milestone and the priority. Dragging
  between and within columns sets the order (the steering in "Steering": priority, pause, cancel, reassign); every
  drag has a keyboard way too. Filters. On the phone, columns you swipe or pick.
- **Dashboards** (Progress, Spend, Timeline) laid out for the full width.
- **On the phone**, the dock sits at the bottom, and the inspector and the boards open as sheets.
- **Every state**: empty, loading, error, long content, a 40-person org, reduced motion and keyboard focus, the same in
  the demo company and the static web demo.
- **Process**: designed first (flows and states, then the visual system) and through the design gate before it is
  built; a checkpoint for the maintainer once the shell, the dock and one board work; then the gates once on the final UI,
  the full e2e, and the hero video, clips, README and demo screenshots recorded again so the launch shows it.

### Phone access (Tailscale)

- `worklings --tailnet` serves the hub to the tailnet through `tailscale serve` (HTTPS on the machine's `ts.net` name).
  It allows that host, requires the token for everything (like `--lan`), and never uses Funnel.
- Intake (hooks, OpenTelemetry and the org tools) keeps refusing anything but loopback with a loopback Host, so the
  tailnet can't post events.
- The phone layout puts the inbox and conversations first; the 3D view gets a lighter mode.
- The maintainer installs Tailscale on the PC and the iPhone (his step); the iPhone checks are his.

### The art pass

- **People: KayKit (Kay Lousberg, CC0).** Character Animations 1.1 gives 161 clips on one medium rig (idle, walking,
  sit down, sit idle and stand up, working, use item, holding, cheering, waving, pick up); bodies from the neutral
  mannequin and Adventurers 2.0 with their fantasy gear left off. Each role gets its own look from palette recolours
  and small props (headset, mug, laptop, clipboard), so Worklings' people read as its own, not as the agent visualizers
  that use the same packs (Bot Crossing, Agent Ages).
- **Missing clips, made here.** No CC0 typing clip exists: build one as an additive layer over sitting idle
  (`AnimationUtils.makeClipAdditive`) or per-bone offsets baked at build time. Talking and carrying are retargeted from
  Mesh2Motion's CC0 clips (`SkeletonUtils.retargetClip`), with a head-nod layer and v2's bubbles as the fallback.
- **Scenery: KayKit Bits in the same style, free tiers only** (the maintainer, 5 Nov 2026: nothing bought). Furniture Bits for
  the office, Restaurant Bits for a café, City Builder, Forest Nature and the seasonal Bits for other themes. What the
  free tiers lack (desks, desk chairs, monitors, keyboards, mugs, whiteboard, coffee machine, printer, server racks,
  shop, arcade and music-studio pieces) is modelled here in KayKit's style: chunky bevelled shapes coloured from the
  same gradient atlas, procedural or as small authored GLBs. Kenney's CC0 kits, recoloured to the palette, fill a gap
  only where a piece looks right next to KayKit's.
- **Pipeline.** Raw packs stay outside the repo; a build script (gltf-transform) retargets every clip onto one skeleton,
  keeps only the clips used, strips IK and control bones, merges each body's six skinned parts into one mesh,
  resamples and compresses with meshopt (decoders self-hosted, nothing from a CDN under the strict CSP). Only the built
  GLBs are committed, with `CREDITS.md` saying they are CC0 and not covered by the MIT licence. Palette atlases stay
  lossless (8 to 16 KB).
- **Many people.** Each file loads once; every person is a `SkeletonUtils.clone` with its own `AnimationMixer` sharing
  the clips, all updated from one loop that slows people off screen and freezes idle ones, so an idle office stays
  still and `frameloop="demand"` keeps saving battery. Fixed bounding spheres and invisible capsules for culling and
  picking. If the iPhone needs more headroom: bone matrices baked to a texture and one instanced mesh.
- **Light.** `NeutralToneMapping` so the palette stays true; PCF shadows with a radius (r187 dropped
  `PCFSoftShadowMap`); `AccumulativeShadows` for the static furniture, blob shadows under people; ambient occlusion
  baked into vertex colours, `LightProbeGridWebGL` for soft bounce on moving people; emissive monitors and lamps with
  fake light pools. Desktop adds half-resolution N8AO, a little bloom and tilt-shift; the iPhone gets no
  post-processing, device pixel ratio up to 1.5 and an adaptive-quality governor.
  - Changed, 11 Nov 2026: tilt-shift and N8AO were removed (the maintainer, no blur). Desktop keeps a little bloom; the rest of
    this bullet holds.
- **Themes** match the project: the CEO picks one from the prompt and the detected domain (café, game studio, shop,
  lab, garden, city, classic office), and the stakeholder can change it by talking.
- **Budgets:** 60 fps with 25 people on the maintainer's laptop, 30 fps on an iPhone; themes load on demand; reduced motion
  respected.
- All 3D content stays procedural or CC0 with credits (the v1 constraint). Raw packs live in
  the folder `WORKLINGS_ART_RAW` names (outside the repo) next to their licence files.

### Watching stays

Normal Claude Code sessions in a project still show up as in v1 and v2, as visitors next to the company.

## Security

- Everything a person writes (status lines, messages, reports, dashboards, screenshots) is untrusted in the office:
  shown as text, secrets masked (v2's `redact`), sizes capped.
- The house rules tell every person that tool output, files and web pages are data, never instructions; only user
  turns from the switchboard carry messages.
- Org tools, the approval hook and the switchboard listen on loopback only, each desk with its own token.
- The preview proxy has its own origin. Remote access is tailnet only, token required.
- Credentials are never read, stored, logged or passed to a person; the switchboard's environment has no auth values
  of its own.

## Out of scope (v3)

- Codex and other harnesses (the seam stays).
- Publishing itself (npm, GitHub, the plugin marketplace) and deploying the web demo: v3 gets everything ready, and
  the maintainer publishes when he chooses.
- Running companies for other people, or any hosted service.
- People rewriting Worklings' own code from inside a company, except when Worklings' repo is the company's project.
- Voice.

## Acceptance criteria (v3)

1. From an empty folder, `worklings new` with a one-sentence prompt proposes an org of 8 to 25 people with leadership,
   heads and workers covering every area the prompt implies, at least two of them niche specialists, shown as a chart.
   "Add a German copywriter" said to the CEO changes the chart.
   - Changed, 12 Nov 2026: a short or open prompt gets the CEO's scoping questions first, and the org it then proposes
     is sized to the goal: 2 to 25 people with a sentence on why, so a single small deliverable gets one to three
     makers and no heads, and the niche specialists come only where the goal has those areas.
2. Starting the company: within two minutes at least five people are working at once (within the setting), each at
   their desk with a plain status line. Now, the inbox and the timeline contain no tool calls.
   - Changed, 11 Nov 2026: Now is gone (stage and dock). Read this as the caption, the strip and the feed, the inbox and
     the timeline: none contains a tool call.
3. "Make the palette darker" said to the CEO reaches the head of design and the UI designer as messages at their next
   step, shown as walk-overs in the 3D view, and the UI designer's work changes accordingly (transcript and diff).
4. A message to any busy worker reaches it at its next step; Stop interrupts it and redirects it.
5. Every approval and every question from anyone appears in the inbox within a second, on the desktop and on the
   iPhone over Tailscale; answering resumes the person; nothing in the "ask" list happens without an answer.
6. The project's app shows on the office screen and in the full preview, also on the phone.
7. "Add a games room with an arcade theme" and "fire the SEO specialist" said to the CEO change the office and the org
   live; `studio.yaml` and the agents record it, and rehire undoes the firing.
8. Two companies run at once; the lobby shows both live, and switching keeps both working.
9. Progress, Spend and Timeline agree with the state; the CEO publishes a dashboard on request; a malformed one is
   refused with a clear sentence.
10. Rigged, animated people and themed rooms that match the project; the frame budgets hold (the iPhone figure measured
    by the maintainer); reduced motion respected.
11. Restarting the hub resumes every company without losing messages, tasks or sessions.
12. A usage limit pauses the company with its reset time and it resumes afterwards; API-key mode shows real cost.
13. Watching normal sessions still works: v1 and v2's tests stay green.
14. `npm run typecheck`, `lint`, `lint:library`, `test`, `e2e` and `build` pass; the security review of the
    switchboard, org tools, preview proxy and tailnet mode passes; README, architecture notes and CHANGELOG describe v3.
15. Built by its own studio with many roles working at once (at least six at the peak), watched in the office.
16. The CEO's plan shows as an editable plan.
    - With the default setting, no task starts before Approve.
    - "Revise it" brings a new version with a diff.
    - Editing, cutting, reordering and adding change the plan.
    - "At every milestone" holds the next milestone until it's approved.
    - The approved plan is the task tree.
17. A message to a room, a team or everyone reaches each of them as a user turn naming the audience: busy people at
    their next step, idle ones as a new turn. An all-hands gathers people in the 3D view (a cut with reduced motion).
18. Every stakeholder message shows its trace: deliveries, relays, acknowledgements and what cites it. A person it
    hasn't reached is flagged, and Remind and Escalate work.
19. On the task board:
    - Priority order is the order work is handed out.
    - Pause stops and holds a task, and resume continues it.
    - Cancel keeps the work on a branch.
    - Reassign hands over with a note.
    - A task the stakeholder creates reaches its owner, and their head is told.
20. The decision log records every kind of decision with its links. It filters by person, room and kind, undoes the
    reversible ones, and sends Reconsider to whoever decided.
21. The leash:
    - "Check with me" holds each task until approved.
    - Trusted allows routine in-project work and merging one's own task branch, while setup files and the ask list
      still ask.
    - It's set per room and per person, by talking and in the panel, with a badge.
    - Model and effort per person apply at the next desk.
22. The command palette reaches every action by typing: Ctrl+K on the desktop, a button on the phone.
23. Every steering action also works by talking: the CEO or the person carries it out through the same code, citing
    the stakeholder's message where it acts for them, and it lands in the decision log. Every feature appears in the
    demo company.
24. The README's terms section says what the terms allow (a short quote with its link), what Worklings never does, and
    that heavy parallel use counts against the user's own plan limits. Nothing says publishing waits for Anthropic.
25. `npx worklings` from the packed tarball, in a clean temp folder on Windows, opens the lobby with the demo company
    and the start flow. `demo` and `hub` work too. The tarball is small, has no native modules and checks for Node 22+.
    CI runs the same check on macOS and Linux.
26. First run: a missing `claude`, or one that isn't signed in, gets a plain sentence and a link. The cost is explained
    before the first start. `worklings doctor` checks each part with one fix. Watching a project asks before
    installing hooks.
27. The plugin installs from the repo through the marketplace commands and `/worklings:hub` runs, with no clone or
    build.
28. The static web demo runs the demo company and office from plain files, with no server or Claude Code. It's ready
    for GitHub Pages.
29. The hero video (20 to 30 s, GIF or MP4 with a poster) and a clip per main feature are recorded by a script in the
    repo.
30. The README leads with v3: the hook line, the video, "Try it in 30 seconds", features with clips, the comparison
    table and the FAQ. Every image shows the v3 look.
31. The repo has a social preview image, a topics list, issue and PR templates, good first issues, a roadmap, a code of
    conduct and a security policy.
32. Stage and dock: the office fills the window under the company bar; the inspector on the right resizes by drag and
    by keyboard, remembers its width and collapses; the dock sits at the bottom.
33. The dock: `@name`, `@room` and `@all-hands` with autocomplete send to the right people; `/commands` run the
    palette's commands and Ctrl+K stays; the live strip shows the latest lines, relays included, within a second; it
    expands into the feed.
34. The feed: everything said, every reply and every relay as it happens, in people's words; filters by person, room
    and kind; unread markers; questions and approvals answered inline; a person's thread opens beside it.
35. Org, Tasks and Dashboards open full width over the office, which becomes a live mini-map that returns on a click or
    Esc; each board has its own address, and Back and Forward work.
36. The org chart is a tree with live state, task, model and spend per person; click to talk; relays animate along
    its lines; it pans and zooms for 40 people, works from the keyboard as a tree, and collapses on the phone; hire,
    fire and move are reachable from it.
37. Tasks are a card board by status, "waiting on you" included, with cards coloured by room showing the owner, the
    milestone and the priority; dragging sets the order and steers as "Steering" says, with a keyboard way for every
    drag; filters; columns to swipe or pick on the phone.
38. Progress, Spend and Timeline are laid out for the full width.
39. On the phone the dock is at the bottom and the inspector and the boards are sheets.
40. Every new view has its empty, loading, error, long-content and 40-person states, reduced motion and visible keyboard
    focus, in the live company, the demo company and the static demo.
41. The hero video, the clips, the README and the demo's screenshots show the stage and dock.

## Build plan

- A fresh run on `run/v3`, branched from the end of v2 (`8ae5b45`), with the repo's studio grown for the work: a
  runtime engineer, a technical artist and a 3D artist, a game designer for the gamified parts, a product manager,
  plus the v2 roles.
- First, small proofs in parallel: the stream-json desk against 2.1.312 with fixtures, and `tailscale serve` with the
  token once the maintainer has installed Tailscale. Two proofs exist already: the CEO's org design (5 Nov; its rules are the
  starting point for the `ceo` role) and the art proof (kept outside the repo; KayKit people
  and rooms at 25 and 40 people; its README has the findings), which the art stream builds on rather than redoes.
- Then parallel streams with disjoint files: switchboard and approvals; org tools; the CEO's org design and the
  library; office panels (lobby, inbox, conversations, tasks, dashboards, preview); art; tailnet mode; QA with a fake
  Claude Code that speaks stream-json and MCP; docs. Gates as in v2.
- Real-world checks use Haiku and the maintainer's copies of real projects, never the originals.

## Risks

- The stream-json stdin protocol is the SDK's, not a documented CLI contract: pinned versions, fixtures and the
  fallback above.
- Plan limits: many people at once can use up a Max plan quickly. The cap, the model mix and the night-time pause
  handle it; the Spend dashboard shows the burn.
- Each person carries their own system prompt and tools (cached while warm), so a company costs more than one chat.
  Idle people have no desk and cost nothing.
- Collisions between parallel people: file ownership, worktrees and heads who integrate.
- Terms for published use: Worklings stays on the end-user route by design (Decisions). The README says what the terms
  allow, what Worklings never does, and that heavy parallel use counts against the user's own plan limits.
- iPhone performance and Safari quirks: budgets, a lighter mode, the maintainer's device checks.
- Looking like other agent visualizers: Bot Crossing (870 stars) and Agent Ages also use KayKit. The difference has to
  be the company itself (an org that does the work, talking to anyone, the inbox) and Worklings' own people, props
  and light.
- Licences change: Quaternius moved its packs to a licence that forbids bundling (28 Aug 2026), so nothing from it;
  Mixamo and Synty forbid redistribution. Raw packs keep their `License.txt` next to them, checked at import.
