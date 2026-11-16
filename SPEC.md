# Worklings: spec for v1

Working name. Decide the final name before anything is published (see Naming).

## Goal

Staff any software project with an AI studio for Claude Code, then watch the studio work in a 3D office.

Two halves that are one product:

1. **Generator.** Describe a project (or point at a repo) and get a studio fitted to it: Claude Code subagents (roles),
   path-scoped rules, workflow skills and review gates, plus a `studio.yaml` manifest that says which department each
   role sits in.
2. **Office.** A local 3D diorama of that studio. Departments are rooms, roles are desks, rules hang as posters, gates
   are doors. Live Claude Code sessions animate the people, and every person and room shows tokens and API-equivalent
   cost. From the office you can reshape the studio: hire, fire, move, promote or demote roles and edit rules.

Why: [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) showed that a studio structure
helps, and also (its own measurement) that more roles and gates cost tokens without producing a better game. Seeing
who burns tokens for what is the feedback loop that keeps a studio lean, and it is the fun part.

## Decisions (the maintainer, 4 Nov 2026)

- Generator: **curated roles, tailored.** A hand-written library of role archetypes and domain blueprints; the
  generator picks, trims and fills them for the project, and Claude tailors them further when run as a skill.
- Office: **watch + reshape.** Live view and stats, plus hire, fire, move and edit rules, written back to `.claude/`.
  No control over running sessions.
- Look: **cozy low-poly diorama.** Isometric dollhouse cutaway, one room per department, soft light, toy-like people.
- Domains: **broad and shallow.** Twelve domain blueprints plus a generic fallback, each lighter than a full studio.

## Users and main flows

Developers who use Claude Code, solo or in small teams, who want structure without hand-writing 40 agent files.

1. **New studio.** In Claude Code: `/worklings:new a habit tracker for iPhone with streaks` (or `worklings new` in a
   terminal). It detects the stack if a repo exists, proposes a domain and a lean team, asks at most four questions,
   writes the studio and offers to open the office.
2. **Watch.** `worklings` (or `/worklings:office`) starts a local server and opens the office. With live hooks
   installed, the lead and every subagent appear, walk to their desks, show what they are doing and count tokens.
3. **Reshape.** Click a role: see what it costs and does, fire it (archived, reversible), demote it to a cheaper model,
   move it to another room. Click a room: hire from the library, read and edit its rules.
4. **Adopt.** Open an existing studio (Game Studios, agency-agents, hand-written agents): the office infers rooms from
   the agents and writes a `studio.yaml` only when asked.
5. **Replay and demo.** Replay a past session of this project from its transcripts, or run the built-in demo without
   Claude Code at all (for the README, and for people deciding whether to install).

## Scope (v1)

### Library (`library/`)
- The rooms (direction, design, engineering, quality, security, content, data, ops, art) with colour, furniture and
  the Claude Code agent `color` each maps to. Built into the code (`src/core/departments.ts`) rather than a
  `departments.yaml`, because the office's floor plan and furniture depend on them; a project adds its own rooms in
  `studio.yaml`, borrowing a base room's look. (Changed during the build, 4 Nov 2026.)
- About 35 role archetypes (`roles/*.md`): Claude Code subagent frontmatter plus a body with mission, responsibilities,
  how to work, handoffs, definition of done and a `## This project` section the generator fills.
- 12 domain blueprints plus `generic` (`domains/*.yaml`): mobile app, web app/SaaS, website, web game, engine game,
  API service, browser extension, CLI/library, data/ML, AI app, desktop app, automation/scrapers. Each lists detection
  signals, departments, roles per rigor tier, rules, skills and gates.
- Path-scoped rules per stack (`rules/*.md`), workflow skills (`skills/*/SKILL.md`), review gates (gate skills).
- Rigor tiers: `lean` (default, 3 to 5 roles, gates available but optional), `standard`, `full`.

### Generator
- `worklings detect`: stack and domain detection from package.json, pyproject, manifest.json, engine files and layout.
- `worklings new|compose`: domain + rigor + detected stack -> a file plan -> written studio. Deterministic, tested,
  complete without an LLM. Never overwrites user files without `--force`; CLAUDE.md gets a marker-delimited block.
- `/worklings:new` skill: wraps the CLI, asks up to four questions when interactive, then tailors each role's
  `## This project` section to the idea and the repo.

### Office
- `worklings` / `worklings office`: local server on 127.0.0.1 plus the web app.
- Sources: Claude Code `http` hooks (live events), transcript JSONL (tokens, models, skills, replay), optional
  OpenTelemetry receiver for exact per-agent cost.
- `worklings hooks install|uninstall|status`: writes the hook block to the project's `.claude/settings.local.json`
  (gitignored), never to the user's global settings unless asked with `--user`.
- 3D: rooms laid out from the manifest, desks, rule posters, gate doors, lobby, lead office; procedural low-poly
  people with role accessories and states (idle, walking, working, thinking, waiting for permission, error, done);
  bubbles with the current tool and target; contractors (built-in or unknown agent types) in the lobby; agent-team
  teammates and their task board.
- HUD: session totals (input, output, cache, cost, burn rate, active agents), connection state; person and room panels;
  payroll board (per role and room, idle desks, top burners, fire suggestions); an accessible list view of the team.
- Reshape: hire, fire (to `.claude/studio/fired/`, since Claude Code loads `.claude/agents/` recursively), rehire,
  move room, change model, edit rule. Token-protected, path-validated, confirm before write.
- Replay of a past session; built-in demo studio and script, labelled as a demo.

### Plugin and packaging
- `plugin/`: a self-contained Claude Code plugin (skills `new`, `adopt`, `hire`, `fire`, `office`, plus a `bin/`
  shim and the bundled runtime and library), and `.claude-plugin/marketplace.json` so the repo is its own marketplace.
- npm package `worklings` (free on npm as of 5 Nov 2026) with the same CLI. Nothing is published in v1 without the maintainer's OK.

## Out of scope (v1)

- Controlling sessions from the office (starting agents, assigning tasks, approving permissions).
- Harnesses other than Claude Code (a provider seam stays open for Codex and others).
- A multi-project "campus" view, hosted service, accounts, analytics or any telemetry of our own.
- Publishing to npm, GitHub or a marketplace, and a public demo site (later, with the maintainer's OK).
- An office layout editor or custom 3D asset packs.

## Architecture

```
library/         curated content (roles, domains, rules, skills, departments)
src/core/        isomorphic: types, studio.yaml schema, inference, hook normalisation, state reducer, usage, pricing
src/composer/    node: detection, library loading, composition, safe writer
src/server/      node: http server, SSE, hook endpoint, transcript tailer, OTel receiver, reshape API, static files
src/cli.ts       node entry: office, new/compose, detect, adopt, hooks, replay, demo
web/             Vite + React + React Three Fiber office, HUD and panels
plugin/          Claude Code plugin (skills, bin shim, bundled runtime at build)
test/            unit and integration tests, fixtures captured from real Claude Code sessions; e2e/ for Playwright
docs/            architecture, Claude Code surfaces, contributing a role or domain
```

- One npm package. The server owns state and pushes snapshots over Server-Sent Events (no WebSocket dependency);
  the browser sends reshape actions as authenticated POSTs.
- Claude Code surfaces (checked against docs and a real 2.1.312 session, see `docs/claude-code-surfaces.md`):
  - Hooks carry `agent_id` and `agent_type` for subagent calls; `http` hooks POST the same JSON as command hooks and
    fail open (`onFailure: continue` is the default), so a stopped office never blocks a session.
  - Subagent transcripts live in `<session>/subagents/agent-<id>.jsonl` next to a `.meta.json` with `agentType`.
    Assistant entries repeat `usage` once per content block, so totals dedupe by `message.id`. The format is
    internal and can change: the parser is defensive and fixture-tested per Claude Code version.
  - OpenTelemetry `api_request` events carry `cost_usd` per `agent_id`; when enabled they replace estimated cost.
- Security: binds to 127.0.0.1 by default; a random token guards SSE, every read of live or replayed data (the demo
  is open) and every write; hooks and OpenTelemetry are taken only over connections from this machine and only for
  sessions in the project's folder; Host and Origin checks stop DNS rebinding and cross-site posts; ids from outside
  are validated and kept in records without a prototype; transcripts are read only from Claude Code's `projects`
  folder; writes are confined to the project's `.claude/` folder and `CLAUDE.md` and never go through a link; `--lan`
  exists for watching from a phone, with a token that lasts one run.

## Acceptance criteria

1. For every domain at every rigor tier, `worklings new` writes a studio that passes the library linter, and Claude
   Code loads the generated agents (checked for real on at least two domains).
2. `/worklings:new "<idea>"` from the plugin writes a tailored studio in a fresh folder and in a copy of a real project.
3. `worklings` opens the office for a project with `studio.yaml`, and for a Game Studios checkout without one.
4. With hooks installed, a real Claude Code session's lead and subagents appear within two seconds, animate on tool
   use, show permission waits, and show per-agent tokens and cost.
5. Reshape actions change exactly the expected files and are reversible.
6. Replay works on a real past session; the demo works with no Claude Code installed.
7. Loading, empty, disconnected and error states; long names; 50+ agents; 375 px; reduced motion; keyboard access.
8. Security review passes for the server and the file writes.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e` and `npm run build` pass.
10. README, CONTRIBUTING, architecture notes and an MIT licence are in the repo.

## Constraints

- Node 22+ for users (Node 20 reached end of life in April 2026); Windows, macOS and Linux paths (the dev machine is
  Windows).
- No paid services. The office makes no model calls; generation runs in the user's own Claude Code session.
- All 3D content is procedural or CC0, so the repo has no licensing holes.
- No "Claude" in the product name (trademark); "for Claude Code" as the descriptor.

## Assumptions (Claude's calls, 4 Nov 2026)

- Local git repo on branch `run/v1`, MIT licence, nothing pushed or published.
- Cost is shown as API-equivalent dollars, labelled as an estimate unless OpenTelemetry supplies it.
- Live hooks are opt-in per project; without them the office still shows the studio and can replay transcripts.
- Department colours map onto the eight colours Claude Code supports for agents, so the CLI and the office agree.
- Gates are skills: a gate "runs" when the Skill tool invokes it, which the office shows as its door lighting up.
- Dogfooding happens on copies of the maintainer's projects, never in place.

## Risks

- Crowded space (Pixel Agents, Claw3D, SEO Office, a brand-new 3D Claude Code office): the studio-is-the-building link
  and the token economics are the differentiation, so they must be excellent.
- Claude Code changes fast: hooks and OpenTelemetry are the stable surfaces, transcripts the fallback.
- WebGL on iPhone needs a real-device check when watching over `--lan`.
- Publishing: Worklings is published by Zeus Studio (https://zeusstudio.dev), from its GitHub organization.

## Naming (decide before publishing)

`headcount` is taken on npm (a scoped package works). Free on npm as of 4 Nov 2026: `studiokit`, `openplan` (but
Deltek sells "Open Plan" project software). Pick a final name before the first public release.

The maintainer, 4 Nov 2026: the final name has no "Claude" in it (Anthropic made Clawdbot rename over its trademark in
January 2026), and it should fit other agent harnesses too, since Codex support may come later. "For Claude Code"
stays the descriptor.

The maintainer, later on 4 Nov 2026: the name is **Worklings**: the package and CLI, plugin and marketplace, slash commands
(`/worklings:new`, `/worklings:office`), environment variables (`WORKLINGS_CLAUDE` and the rest), UI copy, docs and
test names. The repo folder stays `headcount` and the branches keep their names until the maintainer says otherwise (other
sessions and the watching office point at that path). Files written by earlier versions (hook markers, CLAUDE.md
blocks, role notes) keep working.

# v2: what everyone is doing, Catch me up, and asking anyone

## Why

The maintainer, 4 Nov 2026: the look matters, and so does the function. At a glance the office should say what everyone is
doing, and you should be able to walk up to any agent and ask what it is on, the way `/btw` asks a side question in
Claude Code without interrupting. And the tool should build itself: v2 is built in this repo by its own studio while
the office watches.

## Decisions (the maintainer, 4 Nov 2026)

- **Ask aside** answers from the person's real context through the user's own Claude Code: a read-only copy of the
  session answers, never the session itself, so it never interrupts or changes it. Haiku by default, cost shown before
  and after.
- **TL;DR**: a live Now board that costs nothing (built from what the office already sees), plus a Catch me up button
  that has Haiku write a short digest on demand.
- **Dogfooding**: a session started inside this repo builds v2, staffed by the repo's own studio
  (`.claude/studio.yaml`: the standard web-app studio without the devops engineer, plus the docs writer, tailored to
  this repo), with the office open on port 7421.

This changes one v1 constraint: the office now makes model calls, but only when the person asks (Catch me up or a
question), only through the user's own Claude Code CLI (Worklings holds no API key), read-only, never in the demo.

**Changed during the build (the maintainer, 4 Nov 2026, after watching the office):** the goal is the outcome, not the
activity. He wants to see at any moment what each person is doing, why, whether they need him and whether they need
to know more, and to work mainly in the 3D view. So, within v2:
- The Now board and its headline are outcome-first: each person's goal, the request of the person it serves, and a
  plain state (on it, needs you, stuck, has a question, done with its result). No tool-by-tool or file-by-file lines
  on the Now tab; the Log keeps that detail.
- Ask aside becomes a conversation with the person inside the 3D view, anchored to them (a bottom sheet on phones),
  instead of a box in the badge.
- People meet to talk in the 3D view: the lead and a subagent come together when the lead briefs it and when it
  reports back (with reduced motion, nobody walks and speech bubbles carry it).
- Later the same evening: summaries, not a log. Everything the person reads (Now, the activity feed, a badge's recent
  work) is a human, high-level account: who is on what, what got done, what is blocked, what needs them. Tool calls
  and file reads never show. And the product is renamed **Worklings** (see Naming).
Bigger changes go to v3 (below).

## Facts checked (4 Nov 2026, Claude Code 2.1.312 and its docs)

- `/btw` asks about the current session without adding to it, while Claude works, with no tools and one response. It
  is interactive only: nothing outside the session can trigger it.
- `claude -p --resume <id> --fork-session` answers in a copy of a main session. `--tools ""` removes built-in tools
  (add `--disallowedTools "mcp__*"` for MCP), `--max-turns 1` limits it to one turn, `--model` picks the model,
  `--no-session-persistence` keeps print-mode sessions off disk. The docs don't say whether that last flag holds with
  `--resume --fork-session`, or whether the original is untouched; `CLAUDE_CODE_SKIP_PROMPT_HISTORY` also suppresses
  transcript writes. Test before relying on them.
- Subagents can't be resumed or forked from the command line, only main sessions.
- A cheaper model never reuses the session's prompt cache, and removing tools likely breaks the cache too, so a
  question pays for the whole context: on Haiku 5.5 about 1 to 5 cents for 10K to 100K tokens.

## Scope (v2)

1. **Now**, the first tab, free and live:
   - A headline for the studio: who is at work and on what, who needs you, the latest report. For example: "Three at
     work: the lead plans the importer, QA runs the end-to-end suite, the backend engineer waits for your OK. Last
     report 2 min ago from the UX designer."
   - One row per person who is working, waiting, or reported in the last 15 minutes (the rest folded away): who, what
     they were asked, what they are doing now and since when, their last report, files touched, cost so far. A row
     opens that person's badge.
   - Built only from what the office already has (add when each agent's status last changed to the reducer).
   - Live, replay, demo, empty, long-content, phone, keyboard and reduced-motion states designed.
2. **Catch me up**, on demand: a button on the Now tab. The server writes a compact account of what happened since the
   person last caught up (or the last hour): activity, briefs, reports, files, gates, costs. Claude Code turns it into
   3 to 6 plain sentences: who did what, what is blocked, what needs the person. Shown with its time and cost; the
   estimate shows before.
3. **Ask aside**, on demand, in every person's badge: three suggested questions (what are you working on, what is
   left, is anything blocking you) and free text up to 500 characters.
   - The lead (a main session): a forked, read-only, one-turn Haiku call on the session, with a short system prompt to
     answer in the first person, briefly. It must leave the original transcript unchanged and no new transcript
     behind, and work while the session runs.
   - Subagents and contractors: their own transcript (brief, steps, results and report, trimmed to a budget) goes to a
     fresh read-only Haiku call with a first-person system prompt.
   - The answer and its cost show in the badge (the last few kept while the office runs); one question at a time per
     office, and a running one can be cancelled.
4. **The office's own spend** is a payroll line of its own ("The office"), so it never hides what it costs.
5. **Plumbing and safety**:
   - One module runs Claude Code headless: finds the executable (`WORKLINGS_CLAUDE`, then PATH with Windows
     extensions), spawns it with an argument list (no shell), passes untrusted text safely, times out at 60 s and
     kills, parses the JSON result (`result`, `total_cost_usd`, `usage`), and turns failures into clear messages (not
     installed, not signed in, timed out, limit reached).
   - New endpoints need the token and a same-origin request, cap their bodies, and allow one call in flight and a few
     per minute.
   - Demo: scripted sample answers and digest, marked as samples, no model call. Replay: allowed, from the transcripts
     up to the replay position.
   - Tests use a fake `claude` executable; one real run with Haiku proves the wiring, with its cost in the evidence.

## Out of scope (v2)

Sending messages to a session or changing it; Codex or other harnesses; the rename; notifications; keeping answers
after the office restarts.

## Acceptance criteria (v2)

1. The Now tab shows a correct headline and rows in live, replay and demo, updates within a second, works at 375 px,
   by keyboard and with a screen reader, and costs nothing.
2. Catch me up returns a digest from real Claude Code (Haiku) with its cost; failures read clearly; the demo shows a
   sample.
3. Asking the lead answers from its real context without changing its transcript or leaving a new one; asking a
   subagent answers from its transcript; cost shows before and after; nothing works without the token.
4. The office's own spend shows in the payroll.
5. Security review passes for the new endpoints and the process spawning.
6. `npm run typecheck`, `lint`, `lint:library`, `test`, `e2e` and `build` pass; README, architecture notes and CHANGELOG
   describe v2.
7. Built in this repo by its own studio with the office watching: the replay of the build shows the roles at work.

# v3: direction

The maintainer, 4 Nov 2026, watching v2 being built: the office runs the company. An org from the first prompt, messaging any
employee with the message relayed down the tree, approvals and the browser view inside the office, several offices at
once (switching sessions means going to another office), remote access, and a real art pass (distinct characters,
a richer environment, customization). This reverses the v1 decision that the office never controls sessions.

The full v3 spec is `SPEC-v3.md`, written with the maintainer once v2 is done; v3 is built on `run/v3` from the end of
`run/v2`.
