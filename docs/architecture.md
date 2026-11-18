# Architecture

One npm package with four parts that share the code in `src/core/`.

```
            library/ (roles, rules, skills, domains)
                 │
   detect ─► compose ─► write ──────────────► project/.claude/  (agents, rules, skills, studio.yaml)
  (src/composer)                                       │
                                                       │ read by Claude Code
 Claude Code session ──http hooks──► office server ◄───┘
        │  transcripts (JSONL) ─────► (src/server)  ──SSE snapshots──► browser (web/: React Three Fiber + HUD)
        └─ OpenTelemetry logs (opt.) ►      ▲                                │
                                            └──── reshape / replay POSTs ◄───┘
```

## src/core: shared and pure

- `studio.ts`: the `studio.yaml` schema, a validator that names the exact broken field, and the serializer.
- `infer.ts`: sorts agents, rules and review skills into rooms by keyword when a project has no `studio.yaml`.
- `events.ts`: turns hook payloads into office events and tool calls into short sentences ("Edits src/App.tsx").
  Ids that don't look like Claude Code's are dropped, and a command without a description shows only its program and
  plain words, never its values.
- `transcript.ts`: reads usage from transcripts incrementally, counting each API message once (Claude Code writes one
  line per content block), and rebuilds events for replays.
- `office.ts`: the reducer. Who is in the building, their status, current tool, tokens and cost, gate runs, team
  tasks and the activity log. Records keyed by outside ids have no prototype, so "__proto__" is just a key. Old
  sessions fold into per-person totals (`evict`), so an office left open for days stays small and its payroll whole.
  Each log line is a step (a tool call, or a failure the agent may work around) or a milestone with what it was, as it
  stood then (a request, a brief, a report, a question, an OK asked for, a refusal, a failed turn, a gate, a task). A
  brief is an Agent call met by its subagent's start, or a SendMessage that continues a subagent (kept until that
  subagent shows up when the office hasn't seen it yet); it sets the subagent's `task`, `purpose` and `briefedAt`.
- `story.ts`: `storyLines()`, the milestones as sentences ("The lead briefed the UX designer: …"), for the Story tab
  and a badge's Recent work. The catch-up account reads the whole log, steps included; snapshots carry only milestones.
- `pricing.ts`: list prices per model, checked against the pricing page (the date is shown in the office).
- `payroll.ts`: totals per role and room, and the advice the payroll board gives, plus the office's own line.
- `now.ts`: `personState`, what each person is doing in outcome words (needs your OK, has a question, stuck, on it,
  done, idle). The Now board, the headline, the bubbles and the catch-up account all read it, so they agree.
- `aside.ts`: the contract for Ask aside and Catch me up: what a snapshot carries, the estimates, the question rules
  (500 characters) and the prompts.
- `digest.ts`: builds the account Catch me up sends: a compact text of what happened between two moments, from what
  the office already knows.
- `excerpt.ts`: reads one person's transcript into a trimmed text (brief, steps, latest report) for a question.
- `redact.ts`: masks credentials (API keys, tokens, private keys, `password=...`) in text before it goes into a
  prompt or onto the screen.
- v0.2 (SPEC-v0.2.md): `presets.ts` (Lean, Balanced, Thorough), `spending.ts` (what a company costs, the live rate, budgets),
  `loads.ts` (what a person's desk loads), `accounting.ts` (reads a company run's transcripts for `scripts/accounting.ts`)
  and `too-long.ts` (the sentence a refusal for length gives). Each is described where it is used below.

## src/composer: the generator

- `detect.ts`: reads package.json, Python manifests, engine files and the folder layout; scores every domain by its
  detection signals, with a priority so a specific kind of project (an AI app, a game) beats a general one.
- `library.ts`: loads and lints the library.
- `compose.ts`: domain + rigor + detection gives the file plan. Hand-offs are written only to roles that were hired;
  rules are kept only when the project uses their stack and their folders exist.
- `write.ts`: writes the plan without clobbering edits (kept unless `--force`, which backs them up first) and owns
  only the marked block in `CLAUDE.md`.
- `tailor.ts`: the project notes a skill adds to each role, between markers so they can be replaced.

## src/server: the office

- `http.ts`: the server. `POST /hooks` and `POST /otel/v1/logs` take input only over connections from this machine
  (the socket's address, not the Host header, which anyone on a network can set); `GET /events` streams snapshots;
  `/api/*` serves state, the studio catalogue, changes and replay controls; the rest is the built web app with a strict
  CSP. Host and Origin checks stop DNS rebinding and cross-site requests. Reading live or replayed data and every
  change need the token; only the demo can be watched without it.
- `office.ts`: one office per project. It takes hooks only in live mode and only for sessions in the project's
  folder, takes OpenTelemetry cost only for sessions the hooks placed there, and follows the transcripts that
  sessions and subagents write (only `.jsonl` files in Claude Code's `projects` folder). Tails rest after a session
  ends and pick up where they stopped on a resume, sharing one set of counted message ids per session. It retires
  agents that went quiet, folds old sessions into the archive, reloads the studio when its files change, and keeps
  sending snapshots while a timed bubble is showing, since browsers time them by the snapshot's clock.
- `reshape.ts`: hire, fire, rehire, move, model and rule edits, confined to the project's `.claude/` folder. It changes
  nothing while `studio.yaml` has a mistake, and rehires only from its own archive folder. In a company a hire takes an
  optional `reportsTo` (a person id: on staff, not fired, someone who may manage the new person, else refused); left
  out, the new person reports to the head of the room they join, or to the CEO when the room has no head. The demo
  company's reshape follows the same rule.
- `src/safe-fs.ts`: every write (and the studio reader's folder walk) refuses paths that leave the project or pass
  through a symlink or junction, which a cloned repo could ship.
- `replay.ts`, `demo.ts`: play recorded sessions, or the built-in demo, into an office.
- `claude.ts`: runs the person's Claude Code in print mode (`claude -p`): finds the executable, adds the read-only
  flags, sends the prompt on stdin, kills the process tree on timeout or cancel and turns failures into sentences.
- `aside.ts`: Ask aside and Catch me up for one office: one call at a time, six a minute, answers and digests kept for
  the snapshot, the office's spend. `aside-demo.ts` has the demo's made-up answers.
- `hooks-config.ts`: adds and removes the office's hooks in a settings file, leaving everything else alone.

## Catch me up and Ask aside

Both are calls the office makes to the person's own Claude Code (Worklings holds no API key), only when the person
asks, never in the background. Who answers, and how:

| Who is asked | How it is answered | Price shown before |
|---|---|---|
| The lead of a live session | A fork: `claude -p --resume <session> --fork-session`. The copy answers from the real context; the session itself is not touched and no transcript is left. | From the latest prompt's size (`contextTokens`) |
| A subagent or contractor, or the lead in a replay | A fresh call that reads a trimmed excerpt of their own transcript (up to 60,000 characters: the brief, the latest steps and the report), up to the replay position in a replay. | From the excerpt |
| Catch me up | A fresh call that reads the account from `digest.ts` and writes 3 to 6 sentences. | From the account's length |
| Anyone, in the demo | A made-up sample marked as one; no call, no cost. | None |

- **Read-only.** Every run adds `READ_ONLY_FLAGS` (`src/server/claude.ts`): `-p --output-format json --max-turns 1
  --tools "" --disallowedTools "mcp__*" --strict-mcp-config --no-session-persistence --settings
  {"disableAllHooks":true}`, then `--model` (Haiku unless told otherwise). Callers can't pass the flags that would give
  a run tools or permissions, and a value that starts with `-` is refused so it can't turn into a flag. What was
  checked against real Claude Code is in `docs/claude-code-surfaces.md`, "Print mode".
- **A clean child environment.** `claudeEnv` starts from the office's environment and drops the wiring of the Claude
  Code session the office may be running in (`CLAUDECODE` and every `CLAUDE_CODE_*` and `CLAUDE_AGENT_SDK_*` variable),
  except the person's own settings: sign-in, provider, telemetry and network configuration, and where Git Bash is.
  Prompt caching is off (`DISABLE_PROMPT_CACHING=1`).
- **Forks only for real session ids.** A fork needs an id shaped like a UUID; any other id is answered from the
  transcript, so an id from outside can't become an argument.
- **A model that reaches for a tool** has no tools and one turn, so it ends with `error_max_turns` and no text. The
  runner turns that into a plain sentence ("It started to act on that instead of answering...") instead of an error.
- **A neutral working folder.** Calls run in an empty temporary folder (`worklings-ask-*`, removed when the office
  closes), so no project settings, hooks or CLAUDE.md load. `--resume` finds the session from any folder.
- **Limits.** One call at a time per office (a second request gets 409, and a running call can be cancelled) and six
  calls a minute (429 with `Retry-After`). Calls time out after 60 seconds, killing everything Claude Code started. Reading a transcript for a question counts against that deadline and reads
  only regular files, never a link, folder or pipe.
- **Cost.** An estimate shows before, the real cost after. A fork is priced from its own `usage`, because Claude
  Code's `total_cost_usd` for a fork includes the original session's cost. The office's calls are summed into
  `totals` and the payroll's last line, "The office", so they never hide.
- **Untrusted text.** Free text is masked as it arrives (`shownText` in `events.ts`: prompts, reports and errors from
  hooks and transcripts, replays, session titles), before it is stored or shown. Transcript text and the account pass
  through `redact.ts` and sit in a fenced block with a random
  marker, and the answer is masked and cut to 2,000 characters. Nothing logs a question, answer or transcript.
- **Finding Claude Code.** `WORKLINGS_CLAUDE` (full path to `claude.exe` or to Claude Code's `cli.js`), then the
  PATH. Tests and the end-to-end suite point it at `test/fake-claude.mjs`, which never calls a model.

### Endpoints

All need the token and a same-origin request, in every mode (the demo too). With `--lan` they are also taken only from
this machine (403, code `local-only`): the token crosses the network in plain text, and an answer can spell out a
session's context. Answers and digests come back in later
snapshots under `aside`; the response only says the call started.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/ask` | `{"agentKey": "...", "question": "..."}`, up to 500 characters | 202 `{id}`; 404 unknown person; 409 busy; 429 rate limited |
| `POST /api/catch-up` | `{}` | 202 `{id}`, or 200 with a digest (`source: "nothing-new"`) when nothing happened since the last one |
| `POST /api/aside/cancel` | `{"id": "..."}` | 200 `{cancelled: true | false}` |

## web/: the browser

The browser draws what the snapshot says and keeps almost no state of its own: it reads `snapshot.agents`,
`snapshot.aside` and `snapshot.serverTime`, runs the shared reducers from `src/core/` (`personState`, `nowBoard`) on
them, and posts questions. Pure logic sits in `.ts` files next to the components so tests can run it without a
browser.

### The scene (`scene/`)

- `layout.ts` turns the studio into a floor plan; `Building.tsx` and `Furniture.tsx` draw it.
- `Stage.tsx` renders the model with an orthographic camera fitted to the free part of the screen (what the HUD
  leaves uncovered), and only renders frames while someone is working or a new snapshot arrives. It pans just enough to show a person
  and the conversation opened beside them.
- `cast.ts` decides who is where and what they say. `castFrom(snapshot, layout, options)` is a pure function from a
  snapshot to the cast: one member per figure (desk people, extra copies beside their desk, contractors at the
  lobby), each with a status, a bubble (`bubbleFor`: outcome words, one line, cut at a word), and the legs of any walk.
  It plans meetings from `startedAt` (a brief) and `endedAt` (a report): the subagent walks to its lead's desk, stands
  for `STAND_MS`, and walks back, up to `MEETING_SPOTS` at once. `SeenLog` remembers when this browser first saw each
  brief and report, so an office opened mid-session doesn't replay old meetings (`FRESH_MS`). Nobody walks with
  reduced motion or in a replay faster than `WALKING_SPEED_LIMIT`; the bubbles carry it instead.
- `walk.ts` is the geometry for those walks: a coarse grid over the floor plan keeps walkers out of walls and desks,
  the shortest route goes through the doors and is straightened into a few stretches (`route`, cached per layout), and
  `walkMs` gives each walk 0.8 to 2 s by distance. `pointAlong` and `subPath` place someone partway along it.
- `useCast.ts` is the hook that feeds `castFrom` between snapshots. A `SceneClock` runs the snapshot's clock on from
  when it arrived (at the replay's speed in a replay, stopped when paused), a timer wakes it for the next bubble or
  walk that changes on its own (the server sends snapshots only when something happens), and a second timer on real
  time takes "Answered you" bubbles down.
- `People.tsx` and `Person.tsx` draw the cast on one clock: each figure walks and sits by its plan; the person you are
  asking wears the same yellow ring as the selected one.
- Labels (room signs, gate captions, bubbles, name tags and the conversation) are one DOM layer above the canvas:
  `labels.tsx` has the store and the projector that moves each label to its 3D anchor on every frame, and
  `LabelLayer.tsx` decides which labels exist (the selected person's name tag carries an Ask button; on phones with
  the sheet at 78% the strip above is a thumbnail where only the selected or asked person and people who need you, are
  stuck or have a question keep a label). Room signs are real buttons in the
  tab order.
- `stack.ts` keeps labels from covering each other: gate captions move clear of room signs, people's bubbles clear of
  both and of each other, ranked so those who need you keep their place, then those nearest the camera; a stack holds
  three on phones. `placeBeside` and `shiftToShow` put the conversation beside its person inside the free area. The
  order comes from where people belong, not where they are this frame, so a walker never swaps places on every step.

### The panel (`hud/`)

- `NowTab.tsx` draws the `NowBoard` that `nowBoard()` (`src/core/now.ts`) builds from the snapshot: the headline,
  the Catch me up slot, then groups (Needs you, On it, Done in the last 15 minutes) and a fold for everyone else. The
  board is computed once in `App.tsx` and shared with the top-left caption, the announcements and the tab, so they
  agree. `focusRow` puts focus back on a person's row (or on the fold's summary if it folded meanwhile).
- `CatchUp.tsx` and `catchUpModel.ts`: the button, its running line and the digests. `catchUpView()` is pure: given
  the snapshot's `aside` section it says what the line under the button reads and whether the button can be pressed
  (ready, nothing new, running, a question running). The state comes with every snapshot, so every open tab shows the
  same; the component keeps only what the office answered to this tab's own press.
- `Conversation.tsx` and `asideModel.ts`: the conversation with one person. `talkFor()` resolves who it is with (a
  role, whose calls share a thread, or one lead or contractor), `threadView()` builds the thread from the snapshot's
  answers, and `failureCopy`, `refusalCopy` and `runningLine` are the office's words for every failure and state (the
  copy table in `docs/design.md`); Catch me up reuses them. `useAskAside()` keeps drafts, the attempt not yet in a
  snapshot and the words of free-text questions per thread while the office is open. On desktops the component is a
  popover by the person (placed by `LabelLayer`); on phones, without WebGL and for people with no figure it takes the
  panel's place.
- `announce.ts` is the one polite live region: someone starting to need you, a catch-up arriving or failing, answers.
  Headlines, rows, bubbles and counters stay quiet.
- `PayrollBoard.tsx` reads `payroll()` with `snapshot.aside.spend`, which adds the "The office" line under the roles.
- `Story.tsx`: the Story tab and a badge's Recent work. It draws the lines `storyLines()` (`src/core/story.ts`) builds
  from the snapshot's milestones, newest first, with each other person's name as a button that opens them; given a
  badge's people, it keeps the lines about them.
- `TeamList.tsx`, `PersonCard.tsx`, `RoomCard.tsx`, `TopBar.tsx` and `Replay.tsx` hold the rest of
  the panel; `model.ts` has the shared words and grouping.

## Exact cost with OpenTelemetry

Set these in the shell that starts Claude Code (Claude Code ignores telemetry settings in a project's `env` block):

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:7421/otel/v1/logs
```

The office then takes `cost_usd` from each `claude_code.api_request` event and shows it instead of the estimate.
Claude Code exports telemetry for every session started from that shell, so the office takes it only for sessions its
hooks placed in the project, and uses an agent's reported cost only once telemetry has covered every request the
transcript shows (an office started mid-session hears only about later requests; until then the estimate stands).

## The plugin

`npm run build:plugin` bundles the CLI into `plugin/runtime/cli.mjs` and copies the web app and the library next to
it, so the plugin needs only Node. `plugin/bin/` puts `worklings` on the path of Claude Code's Bash tool. The skills
write through the CLI because Claude Code protects files under `.claude/` from direct edits.

## v3: the office runs the company

`SPEC-v3.md` has the why and the decisions. v1 and v2 watch Claude Code; v3 runs it: a hub serves a lobby of
companies, each a project folder with an org, an office, a work branch and its state, and every working person is
their own Claude Code session at a desk the switchboard runs.

```
 browser (lobby, office, inbox, people, tasks, dashboards, preview)
     │  SSE snapshots: LobbyView, Snapshot + company: CompanyView          ▲ POST: messages, stop, answers,
     ▼                                                                     │ approvals, start, org and office edits
 hub (src/hub) ── one Company per project (src/company) ── state in <project>/.worklings/
     │                 │  CompanyApi ▲            │ DeskControl
     │                 │             │            ▼
     │            org tools (src/orgtools) ◄── switchboard (src/runtime): a desk per working person
     │            MCP over HTTP, loopback,         claude -p --input-format stream-json --output-format stream-json
     │            a token per desk                 (the user's own claude, findClaude + claudeEnv)
     └── v1 intake (/hooks, OpenTelemetry, transcripts): visitors, and the desks' activity for the 3D scene
```

### Contracts (`src/core/`)

- `company.ts`: people and the org rules every part applies (`peopleOf`, `mayMessage`, `mayAssign`, `below`,
  `chainUp`, `toolsFor`, `turnText`), the shapes of what happens (task, message, question, approval, status line,
  report, goal, screenshot, desk, pause, settings), what the browser gets (`CompanyView`, `LobbyView`), and the two
  seams between the parts: `CompanyApi` (what the org tools and the office's API ask of a company) and `DeskControl`
  with `DeskEvents` (what a company asks of the switchboard and hears back). `STAKEHOLDER` (`@stakeholder`) and
  `THE_OFFICE` (`@office`) can never be role ids.
- `studio.ts`: `studio.yaml` gains, per role, `name`, `level` (ceo, head, lead, worker), `reportsTo` and `look`; per
  department an optional `theme`; and an `office` section (theme, rooms that aren't a department's, decor). All are
  optional, so v1 and v2 files read as before; the validator keeps the org a tree under one CEO and names the field.
  Fired roles keep their place so a rehire restores it.
- `looks.ts`: what the office can draw (bodies, props, themes, room kinds); studio.yaml, proposals and office changes
  are checked against it.
- `org.ts`: the shape of the CEO's proposal (`OrgProposal`, with `sizing`, the CEO's sentence on why that size) and
  its sizes (2 to 25 people, a team lead over six), and the CEO's scoping questions (`checkScoping`: one to five, each
  with two to four options, its pick and why). Since 12 Nov 2026 the CEO scopes a short or open prompt with
  `ask_scoping` before it drafts; `CompanyView.scoping` names those questions, `CompanyApi.askScoping` asks them and
  `answerWithPicks` answers the open ones with the CEO's picks; their answers reach the CEO in one message.
- `dashboard.ts`: the widgets a published dashboard may hold (stat, progress, bars, line, list, table).
- `snapshot.ts`: `Snapshot.company` carries the `CompanyView` for an office that runs a company; null when it only
  watches.

A change to a contract is the lead's: a stream that needs one says so in its report instead of editing these files.
`org.ts`, `dashboard.ts` and `looks.ts` belong to their streams after the first cut, which may add checks, entries
and optional fields.

### The company's browser app (`web/src/company/`)

Since the stage and dock (`docs/design-v3.md`, "Stage and dock"; `docs/design-hud.md` for the look) a company has no tab
strip. The office fills the window, and the pieces sit over it. `Shell.tsx` routes between them, counts what needs you,
keeps focus and measures what the camera must keep clear of. Since v0.8 every size opens on the office with the side panel closed and the inbox card over the talk bar
(`SPEC-v0.8.md`; `inbox/InboxCard.tsx`, `inbox/cardModel.ts`); the demo's recorded run plays from `replay/`
(`player.ts`, `replayModel.ts`, `ReplayBanner.tsx`) through the demo hub (`demo.ts`, `startReplay`).

| Folder or file | Holds |
|---|---|
| `address.ts` | Every company address, built and read purely. The path names the main view (`/c/<id>/org`, `tasks`, `plan` or `plan/v3`, `dashboards` or `dashboards/<board>`, `decisions`, `preview`, `tasks/<task>/diff`, and since v0.2 `progress`, where every entry point lands), and `?panel=` names the side panel's view (`inbox/<item>`; the inbox itself is the panel's home, `people/<person>`, `tasks/<task>`, `tasks/new`, `messages/<message>`, `decisions/<decision>`, `customize`, `settings`, `proposal`). Addresses from before the redesign still open: an old-address map reads each as its new form. `router.ts` moves between them with the History API; every change pushes, so Back undoes it |
| `insets.ts` | What the HUD covers at the 3D stage's edges, as pure numbers: the camera's fit, and the labels' area. Layouts: docked from 896 px, floating from 721, the phone's (720 px or less, or 480 px of height or less) |
| `shell/` | The frame: the company bar (`CompanyBar.tsx`, `shell/barFold.ts` for how it gives way), the side panel (`SidePanel.tsx`: resizable, remembered, hideable, a floating panel from 721 to 895 px, a sheet on phones), the board frame (`BoardFrame.tsx`) and the live mini-map (`MiniMap.tsx`), the office's map controls (`OfficeView.tsx`: Zoom, Fit, Full screen) |
| `talk/` | The dock: the talk bar (`TalkBar.tsx`), the To picker, `@` mentions and `/` commands (`talkModel.ts`), and `link.ts`, how any view reaches the bar. A leading `@` picks who hears a message; one after the first word says who it is for, and the hint row says what will happen before it is sent |
| `strip/` | The live strip over the talk bar: the latest lines, and a preference to hide it |
| `feed/` | The feed the strip opens: threads, filters, unread markers, questions and approvals answered inline, and older pages through `GET /api/c/<id>/messages?before=` (`useEarlier.ts`) |
| `org/` | The org board: the chart as a tree (pan, zoom, keyboard tree, hire, fire and move in `NodeMenu.tsx`), and on phones the outline (`Outline.tsx`) |
| `tasks/board/` | The task board: sticky notes in status columns, lanes, filters, drag and keyboard moves (`drops.ts` says what each drop does). The plan, the leash and the other steering forms stay in `tasks/` and `plan/` |
| `dashboards/`, `decisions/`, `preview/` | Boards at full width; the decision log is Dashboards' sub-view; Preview and a task's diff use the board frame |
| `inbox/`, `person/`, `trace/`, `palette/`, `settings/`, `customize/`, `proposal/` | What the side panel holds. A person's panel has their thread, state and Stop, and no box of its own: the talk bar is the one box |

`web/src/scene/portraits/` bakes each person's face from their own 3D look (`baker.ts`, one small render target, a few
per frame) and caches it (`store.ts`); cards, chart nodes and the To picker draw it, and a person with no portrait yet
shows an initial. `people/People.tsx` is the shell's fallback where the Org board is missing, and `now/nowModel.ts` now only
supplies the caption's headline and the spend line.

### Who owns what

| Area | Files | Does |
|---|---|---|
| Switchboard | `src/runtime/**`, `test/fake-desk.mjs`, `test/runtime-*.test.ts` | Desks as `claude -p` stream-json processes: a new `--session-id` or `--resume`, the role (`--agent` where 2.1.312 supports it, else the role's text in the appended prompt) and its `--model`, the paragraph of the appended system prompt on how messages reach them, `--mcp-config` and `--settings` written to a temporary folder outside the project; delivery over stdin, stop (interrupt, then the instruction), the cap and the queue, idle-out, the usage-limit pause, killing the whole process tree, the approvals policy and the PermissionRequest hook's answers, the harness seam |
| Org tools | `src/orgtools/**`, `test/orgtools-*.test.ts` | The MCP server over HTTP: transport, the tools of `ORG_TOOLS` with input schemas and caps (`LIMITS`), the caller from the desk token, the level check (`toolsFor`), refusals as sentences; calls `CompanyApi` |
| Company | `src/company/**` except `git.ts`, `src/core/company-state.ts`, `test/company-*.test.ts` except the git tests | `Company` implements `CompanyApi`: the reducer over the state, the store in `.worklings/`, routing by the org rules, tasks with disjoint files, questions and approvals with their waits, pause and resume, recovery after a restart, `CompanyView`, and each desk's plan with the house rules and the person's place in the org |
| Company git | `src/company/git.ts`, `test/company-git.test.ts` | The company's work branch, worktrees for long tasks, per-task commits and merges on that branch, a task's diff; never a push |
| Org and CEO | `src/core/org.ts`, `src/org/**`, `test/org-*.test.ts` | `checkProposal`; writing an accepted proposal as agents and studio.yaml through the composer's and reshape's code; niche roles written to the library's bar and linted; the catalogue; office changes; a firing that hands the fired person's reports to their manager; the CEO's opening turn |
| Hub | `src/hub/**`, `src/server/http.ts`, `src/server/run.ts`, `src/server/office.ts`, `src/core/office.ts`, `src/cli.ts`, `test/hub-*.test.ts` | The hub process: the registry, the lobby, the desk-token table, the routes below, SSE per company and for the lobby, `worklings hub` and `worklings new --prompt`, desks' sessions shown as their person in the office instead of as visitors |
| Panels | `web/src/company/**` (lobby, inbox, people and org chart, person panel, tasks), `web/src/App.tsx`, `web/src/hud/TopBar.tsx`, `web/src/lib/api.ts` | The lobby and the company's panels, the inbox count on every screen, routing between the lobby and a company. Since the stage and dock the company's frame is `web/src/company/Shell.tsx` and its folders (see above), not the top bar |
| Dashboards and preview | `src/core/dashboard.ts`, `src/server/preview.ts`, `web/src/company/dashboards/**`, `web/src/company/preview/**` | `checkDashboard`, the built-in Progress, Spend and Timeline, the CEO's dashboards drawn from widgets, the preview proxy on its own port and its panel |
| 3D moments | `web/src/scene/cast.ts`, `walk.ts`, `useCast.ts`, `web/src/scene/moments.ts` | Walk-overs for relays, the front desk with a paper, milestone celebrations, tiredness and night during a pause, as cast state the art draws |
| Art | `scripts/art/**`, `web/public/art/**`, `web/src/scene/**` except the moments' files, `src/core/looks.ts`, `CREDITS.md` | People, scenery, light and the pipeline from the CC0 packs |
| Tailnet | `src/server/tailnet.ts`, `test/tailnet.test.ts` | `--tailnet` through `tailscale serve`, never Funnel |
| Studio (v0.3, stream S) | `src/studio/**`, `web/src/studio/**`, `src/hub/studio.ts`, `src/hub/hold.ts`, `web/src/company/lobby/**`, `test/studio-*.test.ts`, `test/hub-studio*.test.ts`, `test/e2e/v3-studio.spec.ts` | Portfolios with a shared budget and brief, the studio chat and its tools, the lobby as the top level ("The studio over many companies" below) |

### Seams between the streams

Each part is built against these signatures, with fakes on the other side in its tests, and the hub wires the real
ones together.

- `src/company/index.ts`: `createCompany({root, prompt, stakeholder, key, org, desks, now?})` for a new company (the
  CEO alone in an empty office) and `openCompany({root, key, org, desks, now?})` for one in `.worklings/`. Both return
  a `Company`: `CompanyApi` plus `onChange(listener)` (returns an unsubscribe), `lobbyEntry()`, `sessions()` (session
  id to person, for the office), `requestApproval(person, ask)` (resolves with `{decision, always}` once the
  stakeholder answers or the ask expires), `earlierMessages(before, limit)` (a `MessagePage` of what the state keeps
  before one message, for `GET /api/c/<id>/messages`) and `close()`. `key` is the hub's HMAC key. `desks` is a factory,
  `(events: DeskEvents) => DeskControl`, so the switchboard can call back into the company it serves. `org` is an
  `OrgOps` (below), so the company never writes `.claude/` itself.
- `src/company/index.ts` also exports `companyIdAt(root)`: the id of the company in a folder's `.worklings/`, or null,
  read without opening it, so the hub can spot a folder (or a copy of one) that is already in the lobby.
- `src/org/index.ts`: `orgOps(library): OrgOps` with `found(root, prompt)` (writes the CEO-only studio and agent),
  `openingTurn({prompt, detected, studio})`, `catalogue()`, `check(raw)` (the proposal, by `checkProposal`),
  `write(root, proposal)` (agents and studio.yaml), `hire`, `fire`, `move`, `rehire` (keeping `reportsTo`, `level`,
  `name` and `look`, and handing a fired person's reports to their manager) and `changeOffice(root, change)`, each
  returning a `ReshapeResult`.
- `src/runtime/index.ts`: `createSwitchboard({companyId, root, hub, events, maxDesks, maxOpen?, idleMs, gate?, env?, claude?, now?})`
  returns a `DeskControl`. `maxDesks` is people working at once and `maxOpen` desks open at once, idle ones included
  (see "Lean and warm desks"). `hub` is `{url, issue(person), revoke(token)}`: the hub's loopback URL for `/mcp` and
  `/desk/*`, and its desk-token table. `classifyPermission(payload, {root, branch, rules})` in
  `src/runtime/approvals.ts` says `allow`, or `ask` with the kind, a plain summary and the exact detail.
  `startedBy(scratch)` (`src/runtime/descendants.ts`) gives the process ids a desk itself started and that still run,
  by the desk's scratch folder; the hub reads it only for a command that could stop a program (`stopsByPid`) and
  passes it as `ownProcesses`, so a stop that names only those ids (`taskkill /PID`, `Stop-Process -Id`, `kill` off
  Windows) needs nobody, and every other stop still asks.
- `src/orgtools/index.ts`: `orgToolsHandler({resolve})`, where `resolve(token)` gives
  `{company: CompanyApi, person, root, cwd}` (the project and the desk's checkout or worktree) or null; the hub mounts
  it at `POST /mcp` after its loopback check and answers `GET /mcp` (405) and the OAuth probes (404) itself. MCP
  2026-07-28 with the 2025-11-25 fallback, as `docs/claude-code-surfaces.md` records.
- `src/hub/index.ts`: `startHub({port, token, webDir, library, home?, claude?})` opens every company in the registry and
  serves the routes below; `src/server/run.ts`'s `runOffice` stays for `worklings office`, `replay` and `demo`.
- `src/server/preview.ts`: `createPreviews()` gives `start(companyId, root)`, `stop(companyId)`, `view(companyId)` and
  `closeAll()`; the hub fills `CompanyView.preview` from `view`.
- `src/server/tailnet.ts`: `startTailnet({port, tailscale?})` serves the hub on the machine's ts.net name and returns
  `{host, url, stop()}`; the hub adds that host to the ones it accepts.
- Web: the panels mount `<Dashboards snapshot>` from `web/src/company/dashboards/` and `<Preview snapshot>` from
  `web/src/company/preview/`; the scene reads `castFrom`'s new moment fields from `web/src/scene/moments.ts`.

### The hub's routes

The office's pages and API need the token and a same-origin request, as in v2. Desk intake is taken only from this
machine with a loopback Host, and only with a desk's own token.

| Route | Body | Answer |
|---|---|---|
| `GET /events/lobby`, `GET /api/lobby` | | SSE `LobbyView` (`event: lobby`), or the current one as JSON |
| `POST /api/companies` | `{folder, prompt}` | 201 `{id}`: the CEO starts drafting the org; a folder that already has `.worklings/` reopens its company and needs no prompt |
| `GET /events/c/<id>`, `GET /api/c/<id>/state` | | SSE `Snapshot` with `company` (`event: snapshot`), or the current one as JSON |
| `POST /api/c/<id>/messages` | `{to, text, typed?}` | 202 `{id}`: to anyone, taken at their next step; `typed: true` only for words the person typed in a box |
| `GET /api/c/<id>/messages?before=<message>&limit=<1..200>` | | 200 `MessagePage` `{messages, acks, more}`: up to `limit` (200 when left out) of the messages the company keeps before `before`, in the order it keeps them (the view's), newest first and shown as the view shows them (`src/core/message-pages.ts`), with their acknowledgements; `more` is false once nothing older is kept. 400 in a sentence for a malformed query (no `before`, an odd id, a `limit` out of range, a parameter it doesn't take, one given twice), and with code `unknown` for a `before` the company doesn't keep. The feed's "Show earlier lines" |
| `POST /api/c/<id>/stop` | `{person, instruction, typed?}` | 202 `{id}`; `typed: true` only for an instruction the person typed |
| `POST /api/c/<id>/unsend` | `{message}` | 200 the message, while it hasn't reached its person; 409 once it has |
| `POST /api/c/<id>/undo` | `{item}` | 200: an answer or decision taken back within `UNDO_MS` |
| `POST /api/c/<id>/proposal` | `{proposal}` or `{restore: true}` | 200 `{ok, proposal}` or 400 with the schema's sentences: the stakeholder's own edit, or back to the CEO's version |
| `POST /api/c/<id>/handover`, `/bringback` | `{person}` | 200 `DeskView`: "Open in Claude Code" and back; bringing back is refused while the session's transcript is still being written elsewhere |
| `POST /api/c/<id>/settings` | `{maxDesks?, removeRule?}` | 200 `CompanySettings` |
| `POST /api/c/<id>/dashboards/remove` | `{dashboard}` | 200: a published dashboard taken down |
| `POST /api/c/<id>/seen` | `{person}` | 204: the stakeholder opened their conversation |
| `POST /api/c/<id>/looked` | `{}` | 204: the stakeholder has the company open (v0.2). The web posts it when the company's shell opens and every 5 minutes while visible; the company keeps one look a minute at most (`Company.markLooked`), and any field in the body is refused with 400 |
| `DELETE /api/companies/<id>` | | 200: closes its desks and leaves the lobby; the folder and `.worklings/` stay, so adding the folder again reopens it |
| `POST /api/hub/settings` | `{maxDesks}` | 200: the hub's cap across companies |
| `GET /api/folders?path=<folder>`, `POST /api/folders` | `{parent, name}` for a new folder | `{folders, detected, notes}`: the subfolders' names a level at a time (no files), what `detect` found there in a sentence, and notes before starting (not a git repository, uncommitted changes, a company already runs there or around it); and a new folder. From this machine only, never over the tailnet or the LAN |
| `GET /api/setup`, `?fresh=1` | | `{claude, git}` from `src/doctor.ts`: whether Claude Code is found, its version, how it is signed in and whether it bills per token, and git, each with a sentence and one fix. Kept for 5 minutes; `fresh=1` checks again. The lobby's Claude Code callout reads it, and Start is blocked while Claude Code is missing or signed out |
| `GET /api/watch?folder=<folder>` | | what watching the folder would write (its `.claude/settings.local.json` and, if needed, `.gitignore`), for the consent step to show. From this machine only |
| `POST /api/watch` | `{folder, consent: true, port?}` | 200 with the plan and `installed: true`: writes the office's hooks into the folder only when `consent` is `true` (400, code `consent`, otherwise). From this machine only; the watching office itself is `worklings office <folder>` |
| `GET /api/health` | | `{ok, app: 'worklings-hub', pid}`: proof that a process is this hub, which `worklings hub --stop` checks before it stops the process the hub's lock names |
| `POST /api/hub/stop` | `{}` | 202 `{stopping, pid}`, then the hub closes as Ctrl+C does (desks, previews, the tailnet). From this machine only |
| `POST /api/c/<id>/answers` | `{question, option, text}` | 200 |
| `POST /api/c/<id>/scoping/picks` | `{}` | 200 the questions it answered: every open scoping question answered with the CEO's pick, each with its undo window; 409 when none is open |
| `POST /api/c/<id>/approvals` | `{approval, decision, always}` | 200 |
| `POST /api/c/<id>/inbox/batch` | `{batch}` | 200 `{questions, approvals, left}`: one press for a batch (v0.2); 400 with code `unknown` when nothing waits in it |
| `POST /api/c/<id>/preset` | `{preset: "lean" or "balanced" or "thorough", resize?: boolean}` | 200 `CompanySettings`. Before the start only (409 after): sets the desks at once and the models by level for whatever the stakeholder hasn't set by hand; with `resize` (default true) asks the CEO to revise a proposal to it |
| `POST /api/c/<id>/budget` | `{company?: number or null, person?: number or null}` | 200 `CompanySettings`. Dollars, API-equivalent, to the cent, $0.01 to $1,000,000; `null` clears one; `person` applies to each person. A company's spend reaching 80% of its cap puts a question in the inbox; 100% pauses (company: nobody takes another turn; person: that person, at 100% only, and their manager is told). Raising or clearing the cap lifts it |
| `POST /api/c/<id>/models` | `{ceo?, head?, lead?, worker?}` each `inherit`, `sonnet`, `opus` or `haiku` | 200 `{settings, proposal}`. Before the start only (409 after): one model for everyone at a level, in the settings and in the proposal together |
| `POST /api/c/<id>/start`, `/pause`, `/resume` | `{}` | 200 |
| `POST /api/c/<id>/office` | an `OfficeChange` | 200 `ReshapeResult` |
| `POST /api/c/<id>/preview` | `{action: "start" or "stop"}` | 200 `PreviewView`: the project's dev server behind the proxy |
| `GET /api/c/<id>/tasks/<task>/diff` | | the task's diff as text |
| `GET /api/c/<id>/screenshots/<shot>` | | the PNG |
| `/api/c/<id>/` + `ask`, `catch-up`, `aside/cancel`, `studio`, `reshape`, `sessions`, `replay` | as v2 | as v2, for that company's office |
| `POST /mcp` | MCP, `Authorization: Bearer <desk token>` | the org tools |
| `POST /desk/permission` | Claude Code's PermissionRequest payload, with the desk token | `{behavior: "allow" or "deny"}` once decided |
| `POST /desk/hook` | Stop and SubagentStop payloads, with the desk token | liveness |
| `POST /hooks`, `POST /otel/v1/logs` | as v1 | as v1, for the office whose folder holds the session |

**First run.** `src/hub/setup-routes.ts` holds the five routes above. `worklings new --prompt` runs the same Claude Code
check before it starts a company and stops with the check's sentence and fix when Claude Code is missing or signed out.
The proposal's cost line comes from `CompanyView.estimate` (`src/core/cost-estimate.ts`): dollars an hour at API prices
from the org's models, or "billed per token to your API key" when Claude Code bills that way. A company's id is its
folder's name as a slug with a number when the lobby has it, and `demo` is never an id, so a company in a folder named
`demo` can't be taken for the demo company. Started from inside Claude Code (the plugin does that), the CLI prints
links with no token, because Claude Code records the output; a terminal's links carry it.

### The spending plan (the maintainer, 13 Nov 2026; SPEC-v0.2.md)

- `src/core/presets.ts`: Lean, Balanced (the default) and Thorough: a team range (the CEO included), whether QA and review
  are seats of their own, desks at once and the model per level (CEO on Opus and everyone else on Sonnet; Thorough puts
  heads on Opus). `src/core/spending.ts`: what each costs an hour and for the whole job (a range, its basis stated), the
  live cost an hour, the budget's thresholds, and `SpendingView`, which `CompanyView.spending` carries.
- The preset and the budget live in `CompanySettings` (`preset`, `models`, `budget`). The office asks "How thorough?" itself
  (a question from `@office`, `preset: true`, Balanced its pick) when a company is founded; unanswered, Balanced stands and
  nothing waits. The CEO is told the preset in its opening turn and in the scoping answers, and `sizing` names it.
- A person with no model in a proposal gets the model of their level; `inherit` from the CEO counts as none. When
  `ANTHROPIC_MODEL` is set in the hub's environment it runs everyone: the company passes its value as `--model`, since a
  desk's model flag and agent file would otherwise beat the variable.
- Budgets: `settleBudget` (src/company/company.ts) runs after every change. For the company, 80% puts a question from
  `@office` in the inbox (`Question.budget`) and 100% pauses with `Pause.reason: 'budget'` (the switchboard's `pause(null)`:
  turns under way finish, nothing new starts) and asks again with raises to pick from. A per-person cap acts only at 100%: it
  holds that person's turns in `deliver`, asks, and tells their manager; the Spend view marks 80% (`budgetLevel`) without
  asking. State derives from the log, so a restart settles the same way.
- The whole-job estimate (`estimateJob`, `JOB_BASIS`) is calibrated on 15 real runs, pinned by `test/job-calibration.test.ts`:
  with the plan's tasks counted the range holds 14 of the 15 totals, and assuming the tasks from the team size 14 of 15 too.
  The runs predate v0.2's cuts, so the estimate says a job now should come in lower, and the view carries those lines.
- `Preset` is not a hard limit: a proposal outside the preset's team range is allowed when `sizing` says why, and the view's
  `spending.outside` says it is outside. `inherit` as a person's model means "take the level's".

### Lean and warm desks (v0.2)

How a desk is started (`src/runtime/harness.ts`; the Claude Code facts and measurements are in
`docs/claude-code-surfaces.md`, "Lean desks" and "Prompt cache on `--resume`").

- **What a person loads.** `Loads` (`src/core/loads.ts`: `tools`, `skills`, `mcp`) is on `ProposedPerson` and on the role in
  studio.yaml. `resolveLoads` fills what is missing from the level's default (`defaultLoads`), so a company from 0.1.0 reads as
  lean. The switchboard resolves it into `HarnessPlan.loads`; the harness turns it into `--tools`, `--strict-mcp-config` and
  `--setting-sources project,local` (`deskArgs`, `leanTools`).
- **What the stakeholder approved.** studio.yaml is a project file, so a role's `loads` in it counts only when it matches
  `.worklings/approved-loads.json` (`src/org/approved-loads.ts`), which `recordApproved` rewrites each time an org is written
  (the start, an accepted proposal). `approvedLoads` otherwise gives the person their level's defaults and warns once. A hand edit
  of studio.yaml therefore never takes effect by itself. The record is signed with the hub's key (HMAC over the roles and the
  company's folder; `createCompany` and `openCompany` name the key with `useApprovalKey`), so a record that is unsigned, edited or
  copied from another folder counts as none, with one warning: the stakeholder approves the org again.
- **What is carried from the user.** `readCarry` (`src/server/claude-config.ts`) reads the user's settings, the enabled plugins'
  hooks and the MCP servers they installed (`readInstalled`, which the proposal's catalogue and `library_catalogue` use, and
  `serverConfigs`, which fills a desk's `--mcp-config`). `deskSettings` puts the carried rules, hooks, sandbox, environment and
  server lists into the desk's own settings file; `Carry.complete` false, an unreadable settings file or a Claude Code that
  refuses the flags makes the desk start the standard way, with a notice (`HarnessHandlers.notice`) said once.
- **Checked on init.** `attach` compares the desk's reported `tools` and `mcp_servers` to what it was assigned
  (`LeanGuard`); a desk with MCP tools nobody assigned is killed and its person is told. `mcp.json` is deleted once init is read.
- **The same prompt, every start.** `HarnessPlan.stable` (the company and the person) names the desk's scratch folder, so the
  appended prompt is byte-for-byte the same and `--resume` reads the cache (`makeDeskFolder`). A folder left by a live
  process of another hub gets a random name instead.
- **Two limits.** `maxDesks` is people working at once (the usage limit) and `maxOpen` desks open at once (memory; default 10 a
  company, and the hub's own open cap is 16, or the working cap when that is higher, at most 60). The hub's `HubGate` holds both
  (`take(key, working)`, `takeWork`, `giveWork`): a working slot is taken when a turn starts and given back when the desk is
  idle again, and a desk keeps its process until `idleMs` or until room is needed (`settle`, `armIdle`).
- **Stopping what a desk started.** `startedBy(scratch)` in the seam above; the approvals policy lets a stop by process id through
  only for ids in that set.
- **Routine reports.** `Company.routineReport` (src/company/company.ts) reads the report's form, never its words: a `done` with a
  passed check and nothing open (or, when the office ran the check itself, nothing open), on a task whose done-when asks for no
  review and with no parts open, is recorded and the task closes without a message or a turn for the manager; a `progress` with
  nothing open is recorded too. Their next real turn carries a digest of up to 12 such reports (`takeDigest`; `rebuildDigest` after a
  restart). The CEO sleeps through all of it (a task of a milestone never wakes it); a head is still woken when a report is the last
  open task they asked for or closes their milestone. A blocked report, an open item, a failed check and the old free-text form
  (which says nothing code can read) always reach a person.
- **The report form (v0.2).** `report` takes `{ task, state, files, check: { ran, passed, tail? }, open, note? }` (`REPORT_FORM` in
  `src/core/company.ts`: note 600 characters, 8 open lines of 200, tail 400, 30 files). Nothing is refused for length: the
  `clip` fields of `src/orgtools/schema.ts` cut, and the schema states the limits in words only. The old `outcome` and `summary`
  still work (the summary is the note, cut to 600). The house rules name the tools by their full `mcp__org__` names, say how a
  report reads and tell a desk to stop its own programs by process id (`stopByPid`, for the machine's platform).

### Files over messages, verify by code first (v0.2; SPEC-v0.2.md, "Better by design", 4 to 6)

- **The brief file.** `src/company/brief.ts` writes `.worklings-shared/brief.md` (v0.3; `.worklings/brief.md` before, where Claude Code's deny rule on `.worklings/**` kept every desk from reading it, `cat` included) from the state after every change (`syncBrief`, only when
  the text changed): the request word for word between two marker lines, the scoping answers, the decisions since (answers, plan
  approvals and their comments), the contracts' files and the milestones. Only the office writes it; the approvals policy lets every
  desk read exactly that file. The house rules and every task's turn point at its absolute path (`taskExtras`) in place of the goal.
- **The office's own gate.** A done report on a task whose plan task has a `check` (or whose fix task carries one) is not trusted:
  `Company.startCheck` runs the plan's command through `src/company/check-run.ts` (the approvals policy must say `allow` for it as
  for a desk's Bash; an argument list with no shell, in the task's folder, 5 minutes, a bounded tail of output, the office's
  tokens and keys left out of its environment, everything it started stopped at the end). The task waits in `review` with
  `Task.check` (`pending`, `running`, `passed`, `failed`, `unrunnable`) for the board. Passed: it closes. Failed: it goes back to its
  owner with the end of the output without waking anyone, twice; the third failure tells the manager. Unrunnable: a person reviews
  it as before. A restart runs a cut-off check again (`resumeChecks`).
- **The final review.** The plan's `verification` task, or for a plan with none the CEO's end check (`makeEndCheck`, a task made
  once the plan's tasks are done, whose brief ends with the final handover), is handed to a fresh desk (`freshForReview`: the
  old session is dropped and no notes ride on the new one), with the diff command against `CompanyState.branchBase` and the brief
  file. Its report lists each failed requirement in `open`, starting with the task id that built it; code sends each to its maker
  as a small fix task once (`fixTasks`), then makes one re-check of those items (`settleFollowUps`). A failure the office can't
  route, or a re-check that fails, leaves the task open for a person.
- **The CEO sleeps.** After the plan is approved it takes turns only for an exception (a check that failed three times, a blocked
  report or open item, a question for it, a stall), a milestone's end (`settleMilestoneNotices`, one message with the digest) and the
  plan's end (`settleFinish`: the final handover in the house rules' fixed shape, with the cost against the estimate).

### Simple, visible, proven (v0.2; SPEC-v0.2.md, last section)

- **The checklist.** The CEO's plan carries `checklist`: each thing the stakeholder asked for as a short checkable sentence
  (`ChecklistItem`: a stable id, `k-1` from the CEO and `k-s1` for the stakeholder's own, the text, their words in `quote`,
  and the plan tasks that build it in `covers`). `src/core/checklist.ts` reads it (`readChecklist`, called by `checkPlan`
  whenever a plan sends one) and holds the rules; only the CEO's `propose_plan` passes `checklist: true`, which refuses a plan
  without one, an item no task covers and a task that builds a part and covers none, in the same answer as the linter's
  problems (integration and verification tasks, the office's final review among them, cover nothing). The stakeholder's
  edit keeps the version's checklist when it sends none (`carryChecklist`, covers pruned to the tasks left); an item left
  uncovered isn't refused, and the CEO's notice says so. `planDiff` and `planChanges` include it, `planSummaryOf` counts it
  ("It checks 7 things you asked for.") and the brief file lists it (`## Checklist`, with the verdicts once given).
- **Verdicts.** The final review (the plan's verification task, the CEO's end check or a re-check) judges every item with
  `mark_checklist`; `Company.markChecklist` takes it only from that task's owner, on the open task, for items the reviewed
  version has, and keeps `SteeringState.verdicts` (event `checklist-verdicts`, the newest per item and version, 200 at most)
  with one `decide` decision. When the review reports, each item it marked not met or partly met that no open line names
  becomes an open line (`verdictOpenLines`, led by the first covering plan task id), so verdicts drive `fixTasks` and the
  re-check as written lines do. An item nobody marked stays `unchecked`, never passed. The CEO's finish names the counts
  (`checklistCountsLine`). `CompanyView.checklist` is the approved version's checklist (else the latest's) with the verdicts.
- **The overview.** `src/core/overview.ts` (pure): `summaryOf` is the lobby card's TL;DR (`LobbyCompany.summary`, built in
  `lobbyEntryOf`; the hub fills `summary.preview` with the preview's proxy address while it is up), `stageOf` the stage in a
  word, `needsYouOf` and `needsAcross` what waits on the stakeholder and where it opens. Since you last looked:
  `CompanyState.looked` (`{last, previous}`, folded from the `looked` event by `nextLooks`), `CompanyView.looked` and
  `CompanyView.since` (`sinceStart` and `sinceOf`; null on a first look). Every entry point (lobby cards, Start, the CLI's
  link) lands on `/c/<id>/progress`; the bare `/c/<id>` stays the 3D office.

### Fewer shots (v0.3; SPEC-v0.3.md, stream Q)

- **Acceptance first.** A checklist item may carry `accept` (`src/core/acceptance.ts`): a walk on the running app in plain steps
  (`open`, `click`, `fill … with …`, `select … option …`, `check`, `see`; `{unique}` is a fresh word per run), a command, or a
  judgement. The CEO writes them in `propose_plan`, `readChecklist` refuses one the office couldn't run, and the brief lists them
  under "Acceptance checks" for the makers to build to.
- **The office looks at the app.** Before a final review or re-check is handed out (`holdForLook` in `deliver`), the office runs
  the acceptance commands through the check runner and `src/company/app-look.ts`: a throwaway copy of the project (packages
  linked in), a build for a `start` script, the dev or start script under the approvals policy, `/` and the walks' pages in
  headless Chromium at 375 and 1440 px, the walks at 375 px, screenshots under `.worklings-shared/looks/<task>-<n>/` (desks may read
  them), console errors, nothing beyond localhost, the app's tree stopped. `Task.look` keeps the result (event `task-look`), and
  the review's turn carries it fenced. Not a web app, a script that would listen widely, or no Playwright: skipped, with a note.
- **Fix rounds.** A failed acceptance walk or command goes to the maker of the covering task before the review is handed out (the
  review waits, then the office looks again); a failed review or re-check goes back too. `FIX_ROUNDS` (2) count per task that
  built a part (`TaskFollowUp.maker`), and each report's fixes are re-checked together (`TaskFollowUp.batch`); past two, a person
  decides as before. The bar's pill and Progress say "Fixing" (`stageShown`, `fixingView`), and Progress says what the office saw
  (`seenView`). The lobby's `CompanyStage` has no "fixing" (stream S owns its words).
- **Shots.** `scripts/bench/lib.mjs`'s `stepInsOf` counts the harness's step-ins after the plan's approval from `events.jsonl`;
  `shotsOf` adds a follow-up when the run didn't finish or the hidden core tests failed. The report can hold a baseline and a
  candidate company side by side (arms B0 and B1, each a frozen product run with `BENCH_PRODUCT`).

### Step-ins after the plan is approved (v0.2; SPEC-v0.2.md, "Better by design", 7)

A real run asked its stakeholder 4 to 12 times (8, 4 and 12 in three benchmark runs, 21 in a long company), almost all of it
routine: `rm -f` on a file named by a variable, a stop of `$!`, a look at a process list. The goal is none after the plan is
approved but for a product choice, money or an irreversible step.

**What asks and what doesn't** (`src/runtime/approvals.ts`; `test/runtime-approvals-inside.test.ts` has a `describe` per row,
with the look-alikes that must keep asking, and `test/runtime-approvals*.test.ts` the older rows):

| # | Never asks | Still asks, always |
|---|---|---|
| 1 | Create, edit and delete files in the project and the desk's scratch folder (`$TMPDIR`), including a path a variable names when the command sets that variable exactly once to a plain value (no space, glob or brace) that stays inside: `DIR=dist; rm -rf "$DIR"`, `export F="$TMPDIR/x" && rm -f "$F"`, `"${CLEAN:?}"`, `for f in a b; do rm "$f"; done`, `n=${p:-home}`, `rm -rf src/*/x` | A value the command works out (`"$(mktemp -d)"`, a variable nothing set), one that leaves the project (`D=../x`), one with a space, glob or brace used as a variable, a variable set twice (loops, subshells, `read`, `printf -v`, `unset`, `declare -n`, `+=`, `eval`, `source`), a wildcard followed by `..` (`src/*/../../x`), a brace list, `CDPATH` set anywhere, `cd -` and `cd ~-`, `TMPDIR=…`, `/tmp` and the rest of the temporary folder |
| 2 | The project's own scripts and common build and test tools: `npm test`, `npx vitest`, `node check.sh`, `sed -n '/a/,/b/p' f`; inline code in a closed grammar of literals (numbers, plain strings, constants, lists, records), arithmetic and printing them (`console.log`, `print`, `puts`, `echo`, `JSON.stringify`, `process.exit(n)`): `node -e "console.log(1+1)"`, `node -p "JSON.stringify({a:1})"`, `python -c "print(1)"`; words after `--` that stay inside (`npm test -- --reporter=dot`); reading the company's brief, `.worklings/brief.md` (exactly that file) | A program the office doesn't know, a script that says deploy, ship, publish or release, `sed` with `e` or `w`, any other file under `.worklings` (refused), inline code outside that grammar: any other name, a method call, `this`, a `[` lookup, a string with `$`, `@`, `#`, `{`, `}`, `\` or a backtick (0.1.0's word list let `this[x].getBuiltinModule(...)` and `breakpoint()` through), `node -r/--import/--loader`, `npx -c`, `npm exec -c`, `--registry`, `--userconfig`, `--script-shell`, `--node-options` (npm and npx), a variable that makes a program run code (`NODE_OPTIONS`, every `PYTHON*`, `npm_config_*` in any case, `YARN_*`, `PIP_*`, `BROWSER`, `JAVA_TOOL_OPTIONS`; before a command, exported, or `set` inside `cmd /c`), words after `--` in `npm test`/`npm run` that leave the project (`-- --outDir C:/elsewhere`); `WORKLINGS_*` anywhere in a command (refused) |
| 3 | A server on localhost and what talks to it: `cmd & PID=$!`, `--host localhost`, `node --inspect` on this computer; `curl` and `wget` when every address is this computer's (each word that isn't an option or an option's value is an address; one after the first `/` may be a variable) and nothing outside the project is sent; the Chrome DevTools tools on the desk's own page: a local `new_page` or `navigate_page`, screenshots and traces into the project or scratch, `resize_page`, `click` and the like | A server or debugger listening beyond this computer: `--inspect=0.0.0.0:9229` (and `-brk`, `-wait`, `-port`), `--host`, `--hostname`, `--bind`, `--ip`, `--listen` with an address that isn't loopback, a bare `--host` (vite, astro: every interface), `-H` for `next` and `gatsby` only (it means other things to `grep` and `mysql`), gunicorn's `-b`, `runserver 0.0.0.0:8000`, `http.server` without a loopback `--bind`, and static servers that listen on every interface by default unless every address given is loopback (`serve` without `-l tcp://127.0.0.1:…`, `http-server` without `-a 127.0.0.1`, `live-server` and `five-server` without `--host 127.0.0.1`, `browser-sync` without `--listen`, `light-server` without `-b`), run directly, through npx, `pnpm dlx` or `yarn dlx`, or as a package script (words passed to a script are judged at the end of its command); any address that isn't local (`curl localhost:1 evil.example`, `--url`, `localhost:$PORT@host`), `-x/--proxy`, `--resolve`, `--connect-to`, `-K/--config`, `HTTP_PROXY=`, `ALL_PROXY=` and the like (also exported or set alone), `wget -i/-H/-e/--proxy`, a file sent from outside the project (`-d @`, `-T`, `-F @`, `--post-file`), paid and messaging hosts; DevTools: **`upload_file`, `evaluate_script` and any `initScript` ask every time** (one Always allow covers the server, but never an address or path), every `*path*`, `*file*`, `*dir*` and `*source*` parameter is judged as a read or write by tool, every `*url*` must be local, and any tool the office doesn't list asks |
| 4 | Stopping what the desk started, three ways only: a literal number in its recorded family; `$!` and a variable set once from it in the same command (`cmd & PID=$!; …; kill $PID`, `kill $!`); a pid file written by exactly `echo $! > FILE` or `printf %s $! > FILE` and read with `kill $(cat FILE)` | Everything else: a stop by name, port or pattern, a lookup by port (`PID=$(netstat … \| grep …)`, `lsof -ti`; dropped in the review, because no filter can be shown to find only the desk's own), someone else's number, `$!` before a job or after `wait`, a variable set again, a pid file with other text in it, written twice or after any command the policy can't place (a script, a test run, an unknown program, a substitution), `taskkill //PID $PID` for `$!` (MSYS's number is not Windows') |
| 5 | Installing what the project already declares (`npm ci`, `npm install`, `pip install -r requirements.txt`, `npm i zod` when package.json or the lockfile lists zod, a path inside the project). The project's own lifecycle scripts (`pre`/`post` scripts, `preinstall`, `install`, `postinstall`, `prepare`) are judged like any script, and a plain `husky` prepare runs silently. **Installs run third-party lifecycle scripts** (a declared package's `postinstall`, a native build), so the registry is trusted, not checked | A package the project doesn't declare yet (`npm i left-pad`, `pnpm add zod`, `pip install requests`, `uv add`, `poetry add`): it asks, since a new dependency is code nobody chose; A package named by an address (`https://`, `git+`, `github:x/y`, `x/y`, `pkg@https://`, `name @ url`), `file:`, `link:`, a path outside the project, another registry or index (`--registry`, `--index-url`, `--extra-index-url`, `--find-links`, `--proxy`, `--userconfig`, or the same through `npm_config_*`, `YARN_*` and `PIP_*` variables), a global install, `curl … \| sh` |
| 6 | | `git push`, `npm publish`, `wrangler deploy`, `gh release`, any release-looking script (`deploy`, `ship`, `publish`), paid API and messaging hosts, spending money in a connector |
| 7 | Git's undoable routine: `git add`, `status`, `diff`, `log`, `archive HEAD \| tar -x -C "$TMPDIR/x"` (unpacking with tar or unzip into the desk's scratch folder, nothing written outside it), an exclude pattern (`tar --exclude=.git`), packing and listing archives, putting one named file back (`git checkout -- file`, `git restore --staged .`) | `.git` and `rm -rf` of the project root (`.`, `./`, `"$PWD"`, `*`), `git clean`, `git reset --hard`, `git branch -D`, `git archive -o ../x` or `--remote`, `git checkout -- .` and `git restore .` (a folder or wildcard discards work), tar with `-I`, `--use-compress-program`, `--to-command`, `--checkpoint-action`, `-F` (a shortened `--to-com` too); zip `-TT`; **unpacking into the project, every time and with no Always allow** (`tar -x`, `unzip`, `7z x`, Expand-Archive, `gunzip CLAUDE.md.gz`, `gzip -dN`: what an archive holds is only known once it is out), tar's `-P`, unzip's `-:`, **tar's `--transform`, `--xform` and `-s` in every form** (a rename can turn a folder into `.claude`; into `.worklings` it is refused); anything outside git's reach |
| 8 | | Writes under `.claude/`, `CLAUDE.md` and what it imports, `.mcp.json`, `.git/`, `.husky/`, git config, and the package managers' settings (`.npmrc`, `.yarnrc`, `.yarnrc.yml`, `pip.conf`, `pip.ini`, anywhere in the project), by every write route (a tool, a redirect, `cp`, `mv`, `tee`, a link, inline code, an archive): unchanged, no Always allow, no rule lifts them |
| 9 | Names of installed programs and what only looks at the computer: `ls` and `stat` in Program Files, `/usr`, `/opt`; `tasklist`, `netstat`, `wmic … get`, `Get-CimInstance` | Reading anything else outside the project (`~/.ssh`, `~/.cache`, `/c/Users`), `wmic … call`, a remote computer (`/node:`, `-ComputerName`), printing the environment (`printenv`, `env`, `set`, `declare -p/-x`, `export -p`, `compgen -v`), `New-Item -ItemType SymbolicLink/Junction` or `mklink` (`/D`, `/J`, `/H` read as flags; a symbolic link's target judged from the working folder and from the link's own) to a target outside the project |

What the policy is, and is not. It reads **one command's text**, in order, and decides by what that text names. Code a desk writes and then runs (a script, a test, a package's install step, the project's own `npm test`) runs with the user's own authority and does whatever it does: the policy sees only the command that starts it. **Desks are not sandboxed**: a desk is the user's own Claude Code, and the approvals are a gate against mistakes and against instructions smuggled through text a desk reads, not a wall against a desk that is set on harm. The rules above close what a single command line could do silently (a stop, a path, an address, inline code), and where a command can't be placed it asks. A later `read PID`, `export PID=…`, `for PID in`, `eval`, `source` or `wait`, or a write to the pid file, takes the trust in `$!` away; a variable the script sets twice has no value at all.

What still asks although a careful person would say yes, and why: a stop by pattern or name (it can't tell the desk's program from
another), a stop of a server found by its port (dropped: a lookup can't be shown to find only the desk's own), a program run from outside the project
(a browser in Program Files: the desk's own page goes through the DevTools tools), shell functions that write to a positional parameter
(`w() { cat > "$1"; }`: the policy doesn't follow a function's arguments), an inline PowerShell block with `try{}`, inline code
that calls a method or a builtin (`[1,2].map(...)`, `sum(range(10))`, Perl's `print if /x/`: names can be rebound and a Perl pattern
runs code), unpacking a known-good archive into the project (its content isn't read first), and a documentation
connector (it sends the query out; one Always allow covers its server).

**What an ask carries.** The inbox shows the plain sentence first and the command one click away, then the asker's recommendation and a
default that applies by itself.

- *An approval* (`Approval.advice`, from `adviceFor` in the policy): `recommend` (always `deny`: a connector is never recommended, since a server the stakeholder allowed no longer asks, and one press never lets a connector through), `why` in a sentence, `fallback` (what the desk does instead) and `ifNoAnswer: 'deny'`. Without an answer the hook's wait (about 10
  minutes) ends and the desk is told no with the fallback (`ApprovalAnswer.expired`, `fallback`), never yes: an ask is what the policy could
  not show to be safe. "Always allow" is offered wherever the rule is safe and not for outside the project, branch deletion or global
  settings (`NO_ALWAYS`); a connector's Always allow is for the whole server unless it spends, sends or deletes.
- *A question* (`Question.safe`, `fallback`, `defaultAt`): the asker says whether every option is reversible and inside the company
  (`safe`, which the office checks: a question or option that mentions paying, publishing, pushing, deleting, sending, accounts, secrets, production or anything outside the project is never safe) and what it does otherwise (`fallback`). `QUESTION_WAIT_MS` (10 minutes) after it was asked, a safe question takes the
  asker's pick (`answer.byDefault`, the decision log says the office decided) and an unsafe one is withdrawn as a no, the asker carrying
  on with its fallback. A question without a pick is never safe. The office's own questions (thoroughness, budget, a "check with me" start, scoping) are
  left alone. Timers are set again after a restart (`recover`).

**Who reaches the stakeholder.** Only the CEO. A colleague's `ask(to: "stakeholder")` becomes a question for their manager (the CEO, in a flat
company, and for a head), who is told it was meant for the stakeholder and to forward only a product choice, money or an irreversible step, with
a pick and `safe` or a `fallback` (the house rules say so in two lines, `ask` and `ask_stakeholder` take `safe` and `fallback`). From the start of a company to
the approval of its plan, not even the CEO may (`refuseBeforeApproval`): an assumption goes in the plan's note and the plan is the only thing that asks.

**Batches.** Every question and approval gets a `batch`: the id of the newest ask still waiting that was raised within `BATCH_WINDOW_MS` (90 s),
else its own id. `CompanyView.batches` lists the open ones (`InboxBatch`, oldest first) and `POST /api/c/<id>/inbox/batch {batch}` takes one
press for the lot (`answerBatch`): each question its asker's pick, each approval its recommendation (never "always"), what has no pick stays
open (`left`). Each answer has its own undo window.

**The plan in everyday words.** `CompanyView.planSummary` (`PlanSummary`, `src/core/plan-summary.ts`) describes the plan version that waits for
approval: size, makers, tasks, milestones, what starts first (up to three tasks that wait for nothing) and the whole job's estimate, with `words`
as the sentences to put above Approve. It is null once the plan is approved, so approving is one press on something the stakeholder read.

### A company shaped like a harness (v0.4; SPEC-v0.4.md)

- **The shape.** `CompanyState.shape` comes from the founded event: `harness` for companies the CLI founds (the hub's
  `shape` option; `WORKLINGS_SHAPE=classic` keeps v0.3's), `classic` for everything older and for hubs started without
  the option (the tests and the e2e world). `CompanyView.shape` carries it.
- **The seats** (`src/core/harness-shape.ts`): the Lead (the CEO seat, titled Lead from the founding), Builders (`builder`,
  `builder-2`, …), the `tester` and the `reviewer`. `harnessProposal` holds the Lead's proposal to them before
  `checkProposal` reads it (`known.harness`): job titles become seats and keep their library role as the specialisation,
  everyone reports to the Lead, a missing Tester or Reviewer is added, heads and second Testers are refused. `seatOf`
  names a person's seat from their id and level.
- **The loop** (`harnessPlan`, called by `src/company/plan.ts` on the Lead's `propose_plan`): the Lead sends milestones and
  the checklist (covers may name milestones); the office writes, per milestone, the Tester's acceptance tests (files
  `.worklings-shared/acceptance/<ms>/`) and the Builder's build of it, which waits for them and for the previous build and
  whose check is `node --test .worklings-shared/acceptance/<ms>/**/*.accept.mjs`. With two or more Builders the Lead gives
  their tasks and the contracts between them. `checkPlan(..., { harness })` always ends with the final review, given to the
  Reviewer, and the linter takes the office's tasks as they are.
- **Desks.** Each seat runs at `Preset.efforts[seat]` unless the person has their own effort; the Builder carries
  `BUILDER_QUALITY_BAR` and owns the codebase, the Tester `TESTER_RULES` (`src/company/house-rules.ts`); only the Tester's
  desk (`DeskPlan.writesAcceptance`) gets deny rules that leave `.worklings-shared/acceptance/` open, and the approvals
  policy's `acceptance` right (`src/hub/intake.ts` passes it for the Tester of a harness company).
- **Helpers.** The Builder's desk has the Agent tool. The hub reads each desk session's
  `<session>/subagents/agent-<id>.meta.json` on its poll (`src/hub/helpers.ts`); `Office.followHelper` starts the helper
  and tails its transcript, and `classifyHelper` (`src/core/office.ts`) makes it the person's: beside their desk, named
  "<title>'s helper" (`AgentState.helperOf`), in their payroll line. Subagents ask through the desk's own PermissionRequest
  hook, so the approvals policy covers them as the desk.

### Claude Code with an office around it (v0.7; SPEC-v0.7.md)

- **How the work runs** is the creator's choice (`WORK_CHOICES` in `src/core/plain.ts`: `plain`, or `team` for the solo
  shape), sent by the start form and `worklings new --team` as `work` on `POST /api/companies`; the hub's `shape` option
  (`WORKLINGS_SHAPE`) overrides it for new companies, and a request with no `work` founds a classic company.
- **The plain company** (`COMPANY_SHAPES[0]`, `src/core/plain.ts`): one person, `builder`, titled Claude Code, at level ceo,
  kept in memory (`plainStudio`, pinned in the hub's office with `Office.pinStudio`), so nothing is written into the
  project but `.worklings/`. `foundPlain` starts the job at once with the prompt verbatim as its first turn; `deliver`
  sends the person's words with nothing added; no brief file, no branch or commits, no handovers, no restart notes.
- **The launch** (`src/runtime/plain-desk.ts`): `plainDeskArgs` is `claude -p` with the job's own `--model`, `--effort` and
  `--permission-mode` (each only when set), plus the stream-json transport, `--session-id`/`--resume` and one `--settings`
  holding the office's hooks (`plainDeskSettings`): PermissionRequest to `/desk/permission`, Stop and SubagentStop to
  `/desk/hook`, PreToolUse on Bash and PowerShell to `/desk/refuse` (`src/runtime/kill-refusal.ts`). The parity contract
  test compares it with `plainClaudeArgs`.
- **Prompts and questions:** the hub asks every plain PermissionRequest in the inbox (`plainVerdict`), deciding none
  itself. A turn's end puts the session's last words in the inbox as a `plainTurn` question; the reply goes back verbatim.
- **Plan first:** `--permission-mode plan --permission-prompt-tool stdio`. Only a permission host is offered ExitPlanMode,
  and only the host can approve it, so a plan-first desk's prompts are answered from the switchboard (`hostAsk`, through
  `DeskEvents.approve` to the inbox) and its PermissionRequest hook gives no decision.
- **Granularity:** `parseLine` attaches `workSignals` (`src/core/desk-work.ts`) to lines about TodoWrite, TaskCreate and
  TaskUpdate, `task_started`/`task_notification` of subagents, and subagents' own requests; the company folds them into
  `CompanyView.todos` and `helpers` (each helper priced from its requests' usage), which `SessionBoard` shows.

### Packs (v0.9; SPEC-v0.9.md)

- **The catalogue** (`src/core/packs.ts`, pure): `PACKS` names each pack's files under `.claude/`, what it is for, what it
  costs and what the bench measured; `recommendPacks` reads the task kinds (`short`, `existing` or `new`, and the
  detector's domain) and `RECOMMENDED`, which only the bench fills. The files are in `library/packs/<id>/`, laid out as
  they land. 0.4.0 ships Kickoff alone (one rule file); check before done and the review round were measured and not
  shipped.
- **The installer** (`src/packs/install.ts`): `installPacks` checks everything first (a file of the person's own in a
  pack's place, an edited or partly removed pack, a record it can't read, a `.claude/` it can't write), then copies the
  files through `plainPath` and writes the record (`worklings-packs.json` in `.claude/`) with each file's SHA-256.
  `folderPacks` reads each pack's state, counting a file as the pack's only when it has the library's exact contents;
  `removePack` deletes the files that still match; `undoInstall` takes an install back for a job that didn't start.
- **Who installs:** the hub, in `addCompany`, after the folder checks and before the company is founded, for a plain job
  only (`packs` on `POST /api/companies`); and the CLI (`worklings new --pack`, `worklings packs add|remove`). No desk
  writes the files, so `src/runtime/approvals.ts` is untouched. The founded event keeps the ids (`CompanyState.packs`);
  `CompanyView.packs` is how each stands in the folder now (`jobPacks`, read at most every 5 s).
- **The launch doesn't change:** a pack is project setup, like the person's own `.claude/`, so `plainDeskArgs` is the same
  with or without packs; the parity contract test checks it.
- **The folder reading** (`GET /api/folders`) adds `packs` (`FolderPacks`: each pack's state, `.claude/`'s writability,
  the detected domain).
- **The web:** the start form's Add row (`web/src/company/start/PackRow.tsx`, words in `packRowModel.ts`) and the line
  under the goal in Progress (`packsLine` in `progressModel.ts`).

### One session, then a review (v0.5; SPEC-v0.5.md)

- **The solo shape** is what the CLI founds (`COMPANY_SHAPES[0]`; `WORKLINGS_SHAPE=harness|classic` for the others):
  `harnessProposal(..., 'solo')` keeps the Lead, the Builder(s) and the Reviewer and leaves a Tester out; `soloPlan`
  (`src/core/harness-shape.ts`) folds the Lead's milestones into one and gives one Builder one task for the whole request,
  checked by `npm test` in a Node project; `checkPlan(..., { harness })` adds the Reviewer's final review, and v0.3's look
  at the running app and fix rounds follow it. The Builder's first turn quotes the stakeholder's words verbatim
  (`soloGoalLines` in `src/company/plan.ts`) and its prompt carries `SOLO_BUILDER_BAR`.
- **Read-only one-liners** ran unasked in v0.5 and v0.6 through an allow-list over their tokens. v0.7 dropped it: five
  security reviews each found a critical way around it, so node `-e`/`-p` and python `-c` ask again as in 0.2.

### Accounting a run (v0.2)

`scripts/accounting.ts` (Node, no model calls, writes nothing) reads a company folder and Claude Code's transcripts and says
where the tokens went; `src/core/accounting.ts` is the pure part, free of Node APIs.

- **Reading.** `loadCompany` opens the company as the store does (`company.json`, then the later log lines) but does not check
  their signatures, so it is for runs you trust. `analyseRun` finds each person's sessions by the ids in the company's records
  (else by the house rules in a transcript), in `~/.claude/projects` or `--projects`, and in any project folder there, so a
  task's worktree is found too. `parseSession` counts each API message once and splits a desk's transcript into turns at the
  messages the office delivered (`turnText`); `addSubagent` puts a subagent's requests in the turn that was under way.
- **Classifying.** `classifyTrigger` says what began a turn (opening, brief, relay, report, nudge, answer and so on, from the
  delivered message) and `classifyWork` what it did (planning, briefing, relaying, making, checking, status, idle, from its
  tool calls). A desk's first request, with the first prompt's parts measured by their share of its characters, gives its fixed
  overhead (`overheadShares`).
- **Output.** Markdown tables, or `--json`: the dollars by what they paid for, by person, trigger, work and role, cache reads,
  fixed overhead per desk, context growth and the costliest turns; with several runs, a summary with `leversOf`, the
  estimated size of each candidate cut in SPEC-v0.2.md (upper bounds or estimates, as the notes say).
- `scripts/probe-desk-prompt.mjs` is the one tool that spends money: it starts a real desk on Haiku and prints the size of its
  first request for a named set of Claude Code's loading options, which is how the lean desks' numbers were measured.

### Steering (the maintainer, 5 Nov 2026, "all six")

SPEC-v3.md "Steering" has the six features. Here is how they're built.

**Contracts.** The lead owns them, as with the rest of v3.
- `src/core/steering.ts` holds the shared shapes:
  - the plan: `Plan`, `PlanVersion`, `PlanView`, `PlanDiff`, and the `PlanApproval` setting;
  - messages: `Recipient` and `Audience`;
  - acknowledgements and traces: `Ack`, `MessageTrace`, `TraceFlag`;
  - the task board: `TaskPause`, `TaskCancel`, `TaskHandover`, `NewTaskInput`, `TaskSteer`;
  - the decision log: `Decision`;
  - settings: `Leash`, `Effort`, `SteeringSettings`, `SettingsChange`;
  - `SteeringView`, `SteeringApi`, and the new tool names `STEERING_TOOLS`.
- Steering's fields on company.ts's shapes are optional until every writer sets them:
  - `Task.priority`, `paused`, `cancel`, `handovers`, `planTask`, `cites`;
  - `Message.audience`, `for`, `deliveredHow`, `cites`;
  - `Question.gate`, `Report.cites`, `StatusLine.cites`;
  - `DeskPlan.effort` and `leash`;
  - the turn's `priority`;
  - `CompanyView.steering`.
- `turnText` names an audience ("From Robin, the stakeholder, to the design room (message m-12)").
- `web/src/company/types.ts` has `SteeringActions` and `TabProps.steer`.

**Rules.**
- `by` is `STAKEHOLDER` from the office, or the person from their desk token.
- Where the CEO acts for the stakeholder (`approve_plan`, `change_settings`, `createTask` on their word, and steering a
  task the stakeholder asked about), `cites` names a message the stakeholder typed to the CEO, newer than what it
  changes. The company refuses anything else with a sentence.
- Making someone Trusted asks the stakeholder in the inbox first, however it comes about: by talking, by clearing a
  person's own leash in a Trusted room, or by a hire, rehire or move into one (`src/company/leash.ts`). Until the yes
  the person stays on the company's approvals.
- Plan approval is "before work" for a new company (`DEFAULT_PLAN_APPROVAL` in `src/core/steering.ts`). A company whose
  state predates the setting reads as "off" (`LEGACY_PLAN_APPROVAL`), so it runs as it did.
- Plans for big jobs (v0.2). `Plan.contracts` (optional) names each interface streams share: its `file`, the `writer`
  task and the `dependents` that wait for it. `PlanTask.kind` (optional) is `integration` or `verification`. `checkPlan`
  always refuses overlapping files without an order and contracts that can't work (the writer lacks the file, a
  dependent doesn't wait for the writer). With `structure: true`, which only the CEO's `propose_plan` passes, a big plan
  (`BIG_PLAN`: three or more people building parts in six tasks or more) must also have an integration task at each
  milestone where two or more people's work meets (large companies). Tuned from the five real plan-only runs
  (`test/plan-only-runs.test.ts`): any plan with three or more makers, of whom one's tasks wait for another's, must name a
  contract (the message gives its shape); a maker holds up to 2 tasks under Lean, 3 under Balanced and 4 under Thorough
  (`taskCap` in `src/core/size.ts`); a task of only tests or only a README is refused, and one too big counts areas
  without config, lockfiles, README and docs. The CEO is never refused for what code can fix: over-long text is cut at a
  sentence end (`src/core/cut.ts`), a brief that names a file another task owns makes the task wait for that task, and the
  final verification task of a medium or large plan is the office's (`FINAL_REVIEW`: a fixed title, the checker seat's or
  the CEO's, waiting for every chain's end, in the last milestone, no check, citing `stakeholder_words`, an org tool every
  desk has, from 0.1.0), replacing one the CEO wrote. What was cut or changed comes back in the answer and as a `note` line in
  `.worklings/refusals.jsonl`, apart from the refusals. A stakeholder's edit, its undo and plans saved by 0.1.0 never need
  any of it, and a plan sent without `contracts` keeps the version's own.
  `contractLines` (`src/company/plan.ts`) adds a task's contracts and kind to its assignment.
- Only words the stakeholder typed count as their word, and that fails closed. The web sends `typed: true` for text
  typed in a box (the talk bar, the palette's message, "Tell the CEO what to change", a Stop's
  instruction), and the company marks those messages `typed` (`Message` in `src/core/company.ts`). A button's words, a
  plain Stop's default words, messages kept from before the mark existed and the notes the office writes in the
  stakeholder's name (marked `fromOffice`: the answer to a question, the note on a denied approval, a plan comment and a
  Reconsider) never count.
- A task the stakeholder puts on the board themself is approved work, so its parts can be assigned before a plan is
  approved; one the CEO puts there on their word waits for the plan like any other work.
- Every steering action writes a `Decision`.

| Route | Body | Answer |
|---|---|---|
| `POST /api/c/<id>/plan` | `{plan, note}` | 200 `{ok, version}` or 400 with the check's sentences: the stakeholder's edit, a new version |
| `POST /api/c/<id>/plan/approve` | `{version, through}` | 200 `PlanApprovalState`; 409 when the version isn't the latest |
| `POST /api/c/<id>/plan/comment` | `{on, text}` | 200 `PlanComment`, sent to the CEO as a message |
| `POST /api/c/<id>/send` | `{to: Recipient, text, for, typed?}` | 202 `{ids}`: a person, a room, a team or everyone; `typed` as for `messages` |
| `POST /api/c/<id>/messages/<message>/remind`, `/escalate` | `{person}` | 202 `{id}` |
| `POST /api/c/<id>/tasks` | `NewTaskInput` | 201 `Task`: the stakeholder's own task; the owner's head is told |
| `POST /api/c/<id>/tasks/order` | `{tasks}` | 200: the new priority order |
| `POST /api/c/<id>/tasks/<task>/pause`, `/resume` | `{}` | 200 `Task` |
| `POST /api/c/<id>/rooms/<room>/pause`, `/resume` | `{}` | 200 `Task[]`: every open task of the room's people |
| `POST /api/c/<id>/tasks/<task>/cancel` | `{reason}` | 200 `Task`, with the branch its work stays on |
| `POST /api/c/<id>/tasks/<task>/reassign` | `{to, note}` | 200 `Task` |
| `POST /api/c/<id>/decisions/<decision>/undo` | `{}` | 200 `Decision`; 409 when it can't be undone |
| `POST /api/c/<id>/decisions/<decision>/reconsider` | `{note}` | 202 `{id}`: the message to whoever decided |
| `POST /api/c/<id>/settings` | a `SettingsChange` (and v3's `{maxDesks?, removeRule?}`) | 200 `CompanySettings` with `SteeringSettings` |

New org tools:
- Everyone: `ack {message, agree, text}` and `decide {what, why, alternatives, cites}`.
- Managers: `steer_task` (a `TaskSteer`, for their own team's tasks).
- The CEO: `propose_plan`, `approve_plan {version, through, cites}` and `change_settings` (a `SettingsChange` with
  `cites`).
- The CEO and the checker seats (`isCheckerSeat`: QA, testers, reviewers, accessibility), v0.2: `mark_checklist {task,
  items: [{item, verdict, evidence, files?, check?, page?}]}`, the final review's verdicts on the checklist (below).
- `message` takes a `Recipient` for those the org rules allow: the CEO may reach everyone, and a head their team and
  room.

**Streams.** Each owns its files and wires into shared files in small hunks, re-reading them before each edit.

| Stream | Owns | Does |
|---|---|---|
| Steering core, plan and board | `src/core/plan.ts`, `src/company/plan.ts`, `board.ts`, `leash.ts`, `decisions.ts`, their reducer `src/core/steering-state.ts`, and their hunks in `src/company/company.ts` and `src/core/company-state.ts`; `test/steering-{plan,board,leash,decisions}*.test.ts` | `checkPlan`; versions, approval and the gate (no task of an unapproved plan, assign limited to approved work, the milestone hold); the plan made into the task tree; priority, pause and resume, cancel onto a branch (with company git), reassign, create; the effective leash and the "check with me" question; `changeSettings`; the decision log from every source, undo and reconsider; `SteeringView` |
| Steering core, messages | `src/company/audience.ts`, their reducer `src/core/trace-state.ts`, and their hunks in `company.ts` and `company-state.ts`; `test/steering-{messages,trace}*.test.ts` | `send` to a room, a team or everyone (one copy per person, the audience on each); `deliveredHow`; `for`; `ack`; remind and escalate |
| Steering tools and routes | `src/orgtools/**` (the new tools and `message`'s recipients), the steering routes in `src/hub/**`, `src/company/house-rules.ts` (ack required, plan rules), `library/roles/{ceo,head}.md`; `test/orgtools-steering*.test.ts`, `test/hub-steering*.test.ts` | The tools and routes above, calling `SteeringApi`; citing checked by the company |
| Steering runtime | `src/runtime/**` | The queue in priority order; `--effort` per desk; the Trusted leash in the approvals policy (routine in-project work, merging one's own task branch), with setup files and the ask list unchanged |
| Steering web, plan and board | `src/core/planDiff.ts` (`planDiff`, pure), `web/src/company/plan/**`, the steering parts of `web/src/company/tasks/**`, the plan approval setting in Settings | The editable plan (versions, diff, approve, reorder, cut, edit, add, comment); the board's drag, pause, resume, cancel, reassign and create |
| Steering web, messages and log | `src/core/trace.ts` (`traceOf(view, message, now)` with its flags, pure), `web/src/company/trace/**`, `decisions/**`, `palette/**`, the talk bar's recipients (`web/src/company/compose/recipients.ts`), the leash badge with model and effort, and `web/src/company/steeringApi.ts` (the live binding of `SteeringActions`) | The recipient picker and "for"; each message's trace with flags, Remind and Escalate; the decision log with filters, links, undo and reconsider; the badge and controls; the command palette (Ctrl+K, a button on phones) |
| Steering demo | `src/core/demo-company.ts`, `web/src/company/demo.ts` | Every steering feature in the demo company, and `SteeringActions` over its local state; the café demo talks on its own (conversations that go round again, for the feed and strip), and its Ledger company has 40 people and 100 tasks for the big-board states |
| Steering 3D | `web/src/scene/cast.ts`, `moments.ts` | The all-hands gathering, a cut with reduced motion |

**Delivery order** (`src/runtime/switchboard.ts`). A turn carries a priority from the company: a task's turn takes the
board's priority, lowest first. A turn with none, which is a message from the stakeholder or a notice from the office,
goes before every task turn, in the order it came, both in a person's queue and among people waiting for a desk, so a
full set of desks never keeps a message behind queued work. A stop instruction goes first of all. When a task is
cancelled, paused or moved, a brief of it already written to a busy desk gets the stop notice too. A paused task stays
paused through a restart and when its person is brought back from Claude Code.

**The leash in the approvals path.** The hub's `/desk/permission` route (`src/hub/intake.ts`) passes the person's
effective leash to `classifyPermission` (`src/runtime/approvals.ts`), so Trusted takes effect in a real hub and not
only in the policy's tests. Trusted lifts the routine in-project asks: other programs run on the project's files,
git housekeeping in the person's own worktree, and merging their own task branch. It does not lift the
ask list or the setup files. Under Trusted, every word of a command that names another computer (a URL, `host:port`,
`user@host:path` or a UNC path) leaves the project and asks, and programs that reach the network ask under every
leash. A commit in the shared checkout is refused with a note that the office commits each finished task; commits are
allowed in a task's own worktree.

Order: the contracts first, then the web streams, the demo and 3D, which work against the contracts and the demo. The
core streams start once the gate fixes in `src/company` and `src/hub` land, and the tools, routes and runtime follow
as their files come free. QA's e2e covers each feature on the fake desk.

`worklings [office] [dir]`, `replay` and `demo` stay as they are. `worklings hub` opens the lobby;
`worklings new [dir] --prompt "<one sentence>"` creates a company there (through a running hub when there is one);
`worklings new` without a prompt, or with `--offline`, is v1's composer.

### The studio over many companies (v0.3; SPEC-v0.3.md, "Stream S")

The lobby is the top level: the studio chat over every company, then portfolios, then companies, then people. Stream S
owns `src/studio/`, `web/src/studio/`, `src/hub/` (with `src/hub/studio.ts` and `hold.ts`), `web/src/company/lobby/` and
the routes below.

- **Shapes** (`src/studio/model.ts`, pure, imported by the web app): `Portfolio`, `PortfolioView` (`rollUp` from the
  members' lobby entries: one line, the stages, milestones and tasks, people at work, `spent`, `level` against the budget,
  `needsYou` and the oldest need, `held`), `StudioEntry` and `StudioView`, and `StudioLobbyView`, the `LobbyView` with
  `portfolios` and `studio` that `/api/lobby` and the lobby stream send. The contract's `LobbyView` is unchanged.
- **Portfolios** (`src/studio/portfolios.ts`): `PortfolioStore` in `~/.worklings/portfolios.json`, written atomically on
  each change; a company in at most one; refusals as sentences (`OrgRefusal`). A company leaving the lobby leaves its
  portfolio (`forget`).
- **The hold** (`src/hub/hold.ts`): `holdable(control)` wraps each company's switchboard in `startHub`'s `made()`. While a
  portfolio's spend reaches its budget (`budgetLevel`, as a company's own), the hold keeps the switchboard paused with no
  end time; the company's own `pause` and `resume` (its budget, the stakeholder's Pause, a usage limit's rest) are
  remembered underneath and come back when the hold lifts. The company knows nothing of it: the hub puts
  `Pause {reason: 'budget'}` with the portfolio's sentence (`portfolioPause`) on the company's lobby entry (with a
  needs-you item) and on its snapshot's view, and the snapshot carries `portfolio: {id, name, held}` beside `company`, so
  the inbox's callout offers "Open the portfolio" (`OpenSeat.overlay`, `companySnapshot`).
- **The shared brief** reaches each member through `CompanyHandle.setSharedBrief` (optional in the contract), which the
  company writes into `.worklings-shared/brief.md` between marker lines (`briefOf(state, shared)`); never the appended prompt.
- **Settling** (`hubStudio().settle()`, every second and after a portfolio changes, and once before the first tick after
  a restart): holds, overlays, briefs (set again only when they change) and the studio chat's open relays.
- **The studio chat** (`src/studio/chat.ts`): one desk through the runtime's `claudeCode()` harness, the same lean flags
  as a company desk with no built-in tools (`--tools ""`), no skills, no user servers, only its own server (named `org`
  in its `--mcp-config`, so its tools are `mcp__org__list_companies` and so on), `--model` from the chat's setting
  (Sonnet by default), in a stable empty folder `~/.worklings/studio/room` with a stable scratch name, and `STUDIO_PROMPT`
  as its appended prompt, the same bytes every start. It starts at the stakeholder's first message, takes each message as
  a fenced turn (`turnText`), resumes its session after a restart (once with a new session when Claude Code no longer has
  it), closes after `STUDIO_IDLE_MS` idle and stops a turn after ten minutes. Each answer keeps its `costUsd`
  (`model_usage_since_last_result`). The chat's lines, relays, model, session, spend and budget live in
  `~/.worklings/studio/chat.json`. The budget ($5 by default) caps the chat's own spend: once spent, a new message is
  refused with a sentence saying how to raise it.
- **Its tools** (`src/studio/tools.ts`, served by `src/studio/mcp.ts`, the org tools' protocol: MCP 2026-07-28 with the
  2025-11-25 handshake): `list_companies`, `list_portfolios`, `read_company {company, parts?}`, `message_ceos {to:
  {company} | {portfolio} | {all: true}, text, share_from?}` and `collect_replies {relay?, wait_seconds?}`.
  Nothing approves, answers, changes settings, budgets or plans, or starts, pauses or stops work. Everything a company
  wrote comes back between two lines holding a marker made fresh for that answer. `message_ceos` goes through
  `Company.say(ceo, text, {studio: true})` (`Message.fromStudio`, `fromOffice` too: never typed, never citable, CEO only;
  `turnText` names "the studio chat"); the CEO's turn's last words come back as the office's turn reply citing it, which
  `replyIn` finds and the chat shows as that company's answer. **Kept apart**, per turn (`StudioTurn`, started by each
  stakeholder message): once a turn has read a company (`read_company`, or its CEO's answer from `collect_replies`),
  `message_ceos` sends to no other company in that turn unless `share_from` names it and the message that started the
  turn names it by its display name, as whole words in any case (`namesCompany`). A text with eight words in a row from
  another company's records (`carriedFrom`) is refused the same way. **Few relays:** three `message_ceos` calls a turn,
  one message per company a turn, and none to a company whose CEO hasn't answered the studio's last message. Company
  names the model reads outside a fence are clipped to one line of 60 characters.
- **Tokens**: the studio desk's token is issued in the hub's `DeskTokens` under the key `@studio` (never a company id)
  and lives only in its environment. `/mcp` serves it the studio's tools and never a company's; a company desk's token
  never reaches the studio's; `/desk/permission` with it is always a no (the chat has no tool that asks); `/desk/hook`
  hears it. The routes below sit behind the hub token and the same-origin check, like every `/api/` route.

| Route | Body | Answer |
|---|---|---|
| `POST /api/portfolios` | `{name, companies?, budget?, brief?}` | 201 `Portfolio`; 409 when a company is in another portfolio or the name is taken |
| `POST /api/portfolios/<id>` | any of `{name, companies, budget, brief}` (`budget: null` or `brief: null` takes it off) | 200 `Portfolio`; 404 when it is gone |
| `DELETE /api/portfolios/<id>` | | 200 the `Portfolio` it was (the lobby's Undo makes it again); its companies stay |
| `GET /api/studio` | | `StudioView` (the lobby stream carries it too) |
| `POST /api/studio/messages` | `{text}` | 202 the `StudioEntry`; 409 while it answers or once its budget is spent |
| `POST /api/studio/stop`, `/clear` | `{}` | 200 `StudioView`: stops the answer under way; a new conversation |
| `POST /api/studio/settings` | any of `{model: "sonnet" or "opus" or "haiku", budget: dollars from 0.01 to 10,000}` | 200 `{model, budget}` |

**Web** (`web/src/studio/`): the lobby reads its address (`lobbyPlace`): `/` the list (the studio chat's card, the
needs-you strip, portfolio cards, then the companies in none), `/studio` the chat, `/p/new` the new portfolio's form,
`/p/<id>` a portfolio's page with its companies' cards. These paths parse as the lobby in `address.ts`, so the shell is
unchanged. Outside the lobby, two small hunks: the inbox's callout offers "Open the portfolio" for a portfolio's pause
(`web/src/company/inbox/Inbox.tsx`), and the feed names the studio chat as the sender of its messages
(`web/src/company/feed/feedModel.ts`).

### State: `<project>/.worklings/`

- `.gitignore` holding `*`, so the folder never reaches git and the project's own files stay untouched.
- `events.jsonl`: every change, appended and flushed before it is acted on, each line signed with an HMAC whose key
  lives in `~/.worklings/hub.key`, outside every project. A line that fails its check is dropped with a warning, so a
  person who edits the file can't forge a message from the stakeholder.
- `company.json`: the state folded from the log, written atomically from time to time, so a restart replays only the
  tail.
- `approved-loads.json`: what each role's desk may load, as the stakeholder approved it (v0.2; `src/org/approved-loads.ts`),
  signed with the same key as the log; an unsigned or failing record grants nothing.
- `shots/`: screenshots people shared. Desk tokens and desk configs are never written here: they live in memory and
  in a temporary folder outside the project, removed when the desk closes.
- The hub's registry is `~/.worklings/companies.json` (id and folder per company). A restarted hub reopens every
  company, counts approvals that were open as expired, and gives every person who had undelivered messages or a task
  in progress a resumed turn on their own session.

### Trust

A desk is the user's own Claude Code with the user's authority, as when they run Claude Code themselves with edits
accepted and the project's commands allowed. The approvals policy gates what Claude Code's tools do directly: push,
deploy, publish, writing or deleting outside the project, changes under `.claude/`, branch deletion, paid APIs,
messages to people outside the company and global config. That covers mistakes and most prompt injection. Code a desk
writes and then runs (a script, the project's own tests) runs as the user and can reach whatever the user can,
the office's token included: Worklings is not a sandbox. Run companies on projects whose content you trust, as you
would Claude Code. Desk tokens tie each org-tool call to its person; message bodies are fenced so a body can't pass
for a turn of its own. Isolating desks per OS user or container is the way to go further, and is not in v3
(security review, 5 Nov 2026).

### Rules every stream keeps

- The user's own `claude` through `findClaude` and `claudeEnv`, an argument list and never a shell, the process tree
  killed on stop; never the Agent SDK, never a credential read, set or passed.
- Desks run lean (v0.2): the project's and local settings, the tools of their level and only the MCP servers they were
  assigned. The user's deny and ask rules, hooks, sandbox, environment and MCP allow and deny lists are copied into the desk's
  own settings file, complete or not at all; where they can't be, the desk starts the standard way and reads the user's settings
  itself. Worklings adds its hooks and org tools through `--settings` and `--mcp-config`, and denies desks `.worklings/`.
- Everything a person writes is untrusted: capped (`LIMITS`), masked (`redact.ts`) and shown as text. Only user turns
  from the switchboard carry messages, and the house rules say so.
- Outcome words in every view the stakeholder reads: status lines, reports, messages, questions, decisions. Tool-level
  activity stays under a person's details.
- Tests use fakes (`test/fake-desk.mjs`, a fake tailscale) and `tempDir()`; a test never reaches the real Claude Code.
