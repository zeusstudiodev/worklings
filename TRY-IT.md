# Try Worklings v3

A company of Claude Code sessions you run from a 3D office: you write one sentence, a CEO proposes the org, and the
people work, talk and report while you answer their questions. Nothing is published; this runs from the repo.

## Start it (PowerShell)

```powershell
cd path\to\your-clone   # the repo, branch run/v3
npm install
npm run build
node dist/bin.js doctor    # Node, Claude Code and its sign-in, git, the hub's port, Tailscale
node dist/bin.js           # the hub opens its lobby in your browser
```

The hub prints its link, `http://127.0.0.1:7430/?token=…`: the token is in it, so use that link in another browser.

Your v2 office on 7421 is separate and keeps running. `node dist/bin.js hub --stop` stops the hub and closes every
desk first. The doctor's last line says `npx worklings`: that works only once the package is published, so use
`node dist/bin.js` until then.

## A short tour

1. **The demo company** ("Open the demo company" in the lobby): made up and free. The office fills the window and
   its people talk on their own: watch the strip above the talk bar and click it to open the feed. Click people, open
   the inbox (right), then **Org**, **Tasks** and **Dashboards** in the company bar: each opens over the office, which
   shrinks to a mini-map (click it or press Esc to go back). Try dragging a card on Tasks, and Settings in the company
   menu; Ctrl+K opens the command palette. Lobby, from inside the demo, opens the demo's own made-up lobby, where
   Ledger has 40 people and 100 tasks. On a phone, the feed opens from the strip too, or from the search key ("Open
   the feed").
2. **Start a company**: "Start your first company" in a new lobby ("Start a new company" once there is one), an
   empty folder (say `C:\worklings-try\bakery`) and one sentence on what to build. A short sentence ("A plant-care app") meets the CEO's three to five scoping
   questions first, each with its pick: answer them, or press "Use the CEO's picks". A clear, detailed sentence skips
   them. The office also asks "How thorough?" first: Lean, Balanced or Thorough, each with what it costs (unanswered,
   Balanced stands). The CEO then drafts an org sized to that choice and the goal, with a line on why: Lean is 2 to 4
   people and no heads, Balanced 3 to 10, Thorough 6 to 25. Cut it down, set models, then check what each person's desk
   loads: by default the tools of their level and nothing else, and the CEO may give someone one of your installed MCP
   servers. Then "Start the company". Within a minute the CEO proposes a plan, and nothing starts until you approve
   it: open it from the inbox, or tell the CEO "approve the plan". Settings can make it ask at every milestone, or not
   at all. A big job's plan names the interfaces its parts share, an integration task at each milestone and a last check
   against your own words.
3. **Talk**: the talk bar at the foot of the office is the one box. Click anyone, or type `@` and pick them, then
   write. Tell the CEO "make the palette darker" and watch it walk down to the person who owns it, or "add a games
   room with an arcade theme" and watch the office change. `@Ada ask @Kai to darken the palette` goes to Ada, who
   passes it on to Kai; the bar says so before you send. `/` lists commands, including `/hire`, `/fire`, `/move` and
   `/rehire`. On a phone, Enter starts a new line: press Send.
4. **The inbox** collects questions and approvals: anything outside the folder, pushes, deploys and publishing ask
   you first; the feed shows them too and takes your answer inline. On a phone the office opens first and the inbox
   peeks from the bottom: pull it up. "Pause work" in the company menu means nobody takes another turn until "Resume
   work"; idle desks close by themselves after five minutes.
5. **The preview** shows the project's dev server once someone starts one, in a board over the office;
   **Dashboards** has Progress, Spend, the Timeline and the decision log.

## Keep usage low on Pro

Every person at work is one Claude Code session on your plan. The proposal says what the company costs an hour, and a
rough range for the whole job, before you press Start. My test run (CEO, a head and a worker, all on Haiku, seven
minutes) cost $0.12 API-equivalent, before v0.2.

- **Preset**: choose Lean when the office asks "How thorough?", or on the proposal. It is the biggest lever: fewer
  people, no heads, makers test their own work, 3 working at once.
- **Budget** (Settings): a cap for the company and one for each person, in dollars at API prices. At 80% of the
  company's cap the inbox tells you; at 100% nothing new starts until you raise or clear it. Turns already running
  finish.
- **Desks at once** (Settings in the company menu; the lobby's Settings has it too) is 5 on Balanced, 3 on Lean and 8 on
  Thorough. Set it to 2 or 3 before you start the company: it is the real limit, because the CEO may hire people its plan
  needs even after you cut the proposal down.
- **Fewer people**: remove people from the proposal before "Start the company".
- **What a desk loads**: leave MCP servers and skills off a person unless their work needs them. Each server adds its
  tool names to every request that person makes (1.8k tokens for one server of 56 tools in my probe), and without
  the lean defaults a desk carried 52.9k tokens before it did anything; a maker's is 13.6k now.
- **Models**: the CEO is on Opus and everyone else on Sonnet in a new company. Set Model in the proposal or in a
  person's Details, or one model for a whole level. For the cheapest first look, start the hub from a PowerShell where
  you ran:

  ```powershell
  $env:ANTHROPIC_MODEL = "haiku"
  $env:ANTHROPIC_DEFAULT_SONNET_MODEL = "claude-haiku-5-5"
  $env:ANTHROPIC_DEFAULT_OPUS_MODEL = "claude-haiku-5-5"
  ```

- Pause work when you stop watching. Spend shows what each person cost.

## Not done yet

- The gates and reviews on the whole of v3 have passed, and the hero video, clips and screenshots show the stage and
  dock. The last full checks run at the end.
- Nothing is published: the npm package, the plugin from GitHub and the web demo are built and checked locally only.
  Tailscale on your iPhone waits for you.

## Report

Tell me in this chat what you did, what you expected and what happened; a screenshot helps. When something breaks,
the company's own log is in `<folder>\.worklings\`.
