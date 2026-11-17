---
name: verify
description: How to run and exercise Worklings (the studio generator, the 3D office and, since v3, the company the office runs) end to end to verify a change - checks, the demo office and demo company, a hub with a fake desk, the integration test, the end-to-end projects and their screenshots, a live office on a throwaway project, real Claude Code sessions and the plugin.
---

# Verify a change to Worklings

1. **Checks**: `npm run -s typecheck && npm run -s lint:library && npm test --silent` (the Stop hook runs this, about
   30 s), plus `npm run -s lint`. After changes to `web/` or `src/server/` or `src/hub/`, `npm run e2e` (about 2 minutes
   for v1 and v2, longer with v3's projects): it builds, starts four offices (the demo, a generated web-app project,
   an empty folder, a 50-agent studio) and two hubs (one for the usage-limit rest) with a fake dev app, and writes screenshots to `test-results/evidence/`. Look at them; a passing test says
   nothing about layout. Every port is free-by-choice: `test/e2e/addresses.ts` asks the system for seven free ones when
   `playwright.config.ts` loads and hands them to the workers in `E2E_PORTS`, so runs and other projects never collide on
   one (specs read addresses from that file, never a literal port). Never start things on 7421 or 7430 yourself (the
   office's and the hub's defaults); when a port you want is taken, use another.
   `npm run e2e` empties `test-results/` when it starts: copy evidence you want to keep first. To run only v3's
   screens, `npm run e2e -- --project=v3 --project=v3-phone` (1440 px and 375 px); `npx playwright test --list
   --project=v3` lists them without running anything. The stage and dock's `v3-shell`, `v3-boards`, `v3-task-board` and `v3-org`
   specs also run at 1024 x 768 (`--project=v3-1024`, side panel docked at 320 px), 768 x 1024
   (`--project=v3-768`, side panel floating) and 812 x 375 (`--project=v3-phone-side`, the phone layout's short form).
   The v3 specs are `test/e2e/v3-*.spec.ts`: the company, shell, boards, talk, task board, lobby,
   inbox, messages, desks, dashboards, preview and rest, the steering ones (`v3-steering-plan`, `-messages`,
   `-board`, `-decisions`, `-leash`, `-palette`, `-talking`, `-demo`), `v3-org`, `v3-people`, `v3-feed`, `v3-history`,
   `v3-changes`, `v3-moments`, `v3-fullscreen`, `v3-every-state` (every state of each screen), `v3-first-run` (the
   Claude Code callout, the cost line, watching a project), `v3-site-storage` (the static demo with the browser's site
   data blocked) and the web-fixes specs. Their kit is `test/e2e/v3-kit.ts`: `openPanel(page, id, panel)` and `openBoard(page, id, board)` open
   a company at a `?panel=` view or a board; `sheetUp` opens the inbox in the side panel when it isn't up (v0.8: it is
   closed until asked for), `openInbox` does it through More, and `inboxCard` is the card over the talk bar; `talk(page, to, words)` says something through the talk bar, with leading `@` mentions picking who hears
   it; `cardDrag` drags a task card on desktop sizes. Its `running()` founds a company and starts it with plan
   approval off, because the default ("before work") refuses `assign` until the plan is approved; pass `planApproval`
   to keep the default. The plan specs and the new-company spec exercise the default: the fake desk's `byText` rule
   makes the CEO's start turn pick the `plan` scenario. Specs pass browser code to `page.evaluate` as a string, since
   the Node typecheck has no DOM types.
   The static demo has its own check, apart from these projects: `npx playwright test -c test/site` (run
   `npm run build:site` first) serves `dist/site` at `/worklings/` and drives it at 1440 and 375 px.
2. **Look at the office**: `preview_start headcount-demo` (built demo, port 4326; run `npm run build` first) or
   `npm run dev` (hot reload on 4325). The Browser pane throttles animation frames while hidden, so it may stay blank
   until you interact; for screenshots at known moments use a Playwright script (`@playwright/test` is installed;
   launch Chromium with `--enable-gpu --use-angle=d3d11` for the real GPU).
3. **Demo timeline** (seconds into each 150 s loop): 5 UX designer starts, 22 design gate, 32 mobile engineer, 43-47
   failing typecheck (error bubble), 50 Explore contractor walks in, 57-64 permission wait (yellow bubble), 84 QA,
   88 accessibility gate, 106 code gate, 118 lead done. The release manager never works (idle-desk advice).
4. **Demo company (v3, free, no hub)**: the demo also holds a made-up company. Open `/c/demo` on the demo's or the dev
   server's address (`http://localhost:4325/c/demo` under `npm run dev`; `?demo` on any address works too). The lobby,
   the proposal, the inbox, answers with Undo, the talk bar, the org, task and dashboard boards and the preview all work against local made-up data
   (`web/src/company/demo.ts`, `src/core/demo-company.ts`), and its replies are samples. Use it to look at layout and
   copy for every state. It proves nothing about the hub.
5. **A hub with a fake desk (v3, free)**: the real hub with every real part and only Claude Code faked. In a shell,
   with a temp `WORKLINGS_HOME`, a port in 4380 to 4389 and `CLAUDECODE` unset:
   ```bash
   export WORKLINGS_HOME=$(mktemp -d) WORKLINGS_CLAUDE="$PWD/test/fake-desk.mjs"
   export FAKE_DESK_SESSIONS=$WORKLINGS_HOME/sessions FAKE_DESK_LOG=$WORKLINGS_HOME/desk.jsonl
   node src/cli.ts hub --port 4380 --no-open
   node src/cli.ts new <temp project> --prompt "A plant-care app" --port 4380 --no-open
   ```
   Open the printed link (it carries the token; the token is in `$WORKLINGS_HOME/.worklings/token`) and check the lobby.
   With no script the fake desk only answers, so the CEO never proposes: to see a proposal, a status line or an
   approval, give `FAKE_DESK_SCRIPT` a script (the header of `test/fake-desk.mjs` lists the steps, and
   `test/e2e/v3-world.ts` has the scripts and the org the e2e hub uses). The CEO's scoping questions (a short prompt meets them before any proposal) are the
   `ask_scoping` org call: a script whose default is `[{"org":"ask_scoping","arguments":{"questions":[...]}},
   {"say":"..."}]` leaves each company with its questions open (the lobby's `needsYou` counts them), and the e2e world's
   `scope` and `found-scoped` scenarios play the whole round (questions, "Use the CEO's picks", then the draft).
   `FAKE_DESK_LOG` records every argument, line
   and call a desk made, so you can see what Worklings sent. Stop the hub with Ctrl+C or by killing its process tree.
   Never point `WORKLINGS_CLAUDE` anywhere near the real Claude Code for this, and delete the temp folders afterwards.
6. **The integration test (v3)**: `npx vitest run test/hub-integration.test.ts` (about 30 s) takes one company from the
   first prompt to a hub restart over HTTP and SSE, as the browser does: the proposal, the start, messages, Stop,
   approvals and questions, a usage-limit rest, a restart. It is the quickest proof that the parts still fit. Its steps
   build on each other, so a failure in step 3 may be step 2's. The unit tests around it (`test/company-*.test.ts`,
   `runtime-*`, `orgtools-*`, `hub-*`, `panels-*`, `tailnet.test.ts`) use the same fakes.
7. **Live office for real (v1 and v2)**: in a temp folder `node dist/cli.js new <dir> --domain generic`, then
   `node dist/cli.js hooks install <dir> --port 4393` and `node dist/cli.js office <dir> --port 4393 --no-open`. Run
   `claude.exe -p "Use the code-reviewer subagent to review add.js" --model haiku --permission-mode acceptEdits` in
   that folder with `CLAUDECODE` unset and call `claude.exe` directly (through a shell the prompt gets split). Then
   `GET /api/state` shows the lead and the code reviewer with tokens; the cost should equal the run's
   `total_cost_usd`. Delete the temp folders afterwards.
8. **Plugin**: `npm run build:plugin`, `claude plugin validate ./plugin`, then `claude.exe --plugin-dir ./plugin -p
   "/worklings:new <idea>"` in a temp folder or a copy of a project (never the original). Tailored notes appear between
   `<!-- worklings:notes -->` markers in each role's `## This project` section.
9. **Replay**: `node dist/cli.js replay <dir> --session latest --speed 60 --no-open` replays a recorded session;
   long idle gaps are skipped.
10. **Ask aside and Catch me up** call Claude Code, so tests never use the real one. `WORKLINGS_CLAUDE` points at
    `test/fake-claude.mjs` (modes `ok`, `slow`, `hang`, `not-signed-in`, `limit`, `too-long`, `bad-json`, `crash`,
    `flood` via `FAKE_CLAUDE_MODE`; `FAKE_CLAUDE_LOG` records every run's arguments and folder). A company's desks use
    `test/fake-desk.mjs` instead (step 5). Unit tests: `npx vitest run test/claude.test.ts test/aside.test.ts`. By hand:
    `echo hi | node test/fake-claude.mjs -p --output-format json`. The e2e live office runs with the fake,
    and `test/e2e/live.ts` plays the captured Claude Code 2.1.312 session into it (transcripts first, then the hooks),
    so specs get a real lead and code reviewer without a model. The demo office answers with made-up samples and needs
    no fake.
11. **Real Claude Code, costs money** (run from a terminal with `CLAUDECODE` unset, Haiku unless quality is the point,
    a neutral working folder, never in a loop):
    - `node scripts/check-fork.mjs` (about $0.09 when last run) and `node scripts/check-aside.mjs` (about $0.06): a
      fork answers from the real session and leaves its transcript unchanged, nothing is left on disk, the office's
      spend line adds up.
    - `node scripts/check-desk.mjs` (about $0.04 and 9 minutes): the stream-json protocol the switchboard relies on,
      against the real Claude Code. `node scripts/check-orgtools.mjs` (about $0.03; `--probe` is free): the MCP server
      the org tools run on.
    - They write reports to `test-results/`, which `npm run e2e` empties, and fixtures to
      `test/fixtures/claude-<version>/` only when every required step passes. Re-run them after a Claude Code update
      and read the fixture diff.
    - A real company run (the CEO's draft or more) goes through a throwaway hub: its own `WORKLINGS_HOME` and port, an
      empty temp project, `CLAUDECODE` unset, and `ANTHROPIC_MODEL` set to Sonnet for the CEO (two real drafts cost
      $0.37 and $0.45). Never point it at one of the maintainer's real projects, and keep screenshots of his private projects
      out of the repo.
12. **Phone layout without a phone**: the `v3-phone` project (375 px, a Pixel 7 profile) and the screenshots it writes;
    `v3-phone-side` (812 x 375) for a phone on its side. On a phone the side panel and the boards are sheets, and the
    office opens with the inbox card as a sheet over the talk bar. This is Chromium; it does not reproduce iOS Safari. By hand: the demo
    company at `/c/demo` with the window at 375 px, then `/c/demo?panel=settings`.
13. **Proof** for a report: the check output, the integration test and e2e results and the screenshots you looked at.
    Say which of 5 to 12 you ran. Not covered by any of this, and only the maintainer can check:
    - **A real iPhone over Tailscale.** `worklings hub --tailnet` has been tested only against `test/fake-tailscale.mjs`.
      On the phone: Tailscale signed in to the same tailnet, MagicDNS and HTTPS certificates on, the printed link opens
      the lobby, the inbox count updates within a second of an approval, the preview opens on its own HTTPS port, and
      the link stops working without the token.
    - **iOS Safari's rendering and speed**: the 30 fps target with 25 people, WebGL memory, the lighter phone mode,
      safe areas, the keyboard over the conversation box, the sheet's scrolling.
    - **Real usage limits** (the rest and wake-up are proven with a scripted limit), and Claude Code versions other than
      2.1.312.
    - **A real iPhone watching a v1 or v2 office over `--lan`.**
