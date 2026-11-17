# Worklings v0.8: office first, one card at a time, and a demo you can start

The maintainer, 16 Nov 2026, after looking at 0.2.0's company screen and demo:

> "the UI is a bit crowded, we should simplify perhaps, like maybe the inbox as cards presented to you once a time"

> "the github page should show not just built and full projects but also trying how it looks like creating one from
> scratch, as a demo."

0.2.0 is "Claude Code, with an office around it": a new job is one unmodified Claude Code session, and a team of roles
is an experimental choice. It has two audiences: engineers who live in Claude Code, and casual vibecoders who want it
fun, visual and easy. v0.8 makes the screen calmer for both without removing anything: every piece moves one click away.
It keeps the look (the cozy low-poly office, the badge paper, the palette, Barlow) and changes what shows by default.

## Decisions (the maintainer, 16 Nov 2026)

1. **Office first.** The office fills the screen. By default the screen shows three things:
   - a slim top bar: back to the lobby, the company's name, its status, the budget meter and More;
   - the next thing that needs you, as one card;
   - the talk bar.

   Progress, Tasks and the full inbox open on demand, one panel at a time. Room labels and activity chips show only
   where something happens now. The summary box (the caption), the "Needs you" list in Progress and the relay lines
   over the talk bar (the live strip) go. Nothing leaves the product: each moves one click away. This holds for plain
   jobs and team companies alike.
2. **One inbox card, docked.** The oldest open item sits as one card above the talk bar: who asks, the question or
   approval, its buttons (the inbox's own, "Answer in your own words" included), and "1 of N" with Next and Skip. An
   answer slides the next card in (a cut under reduced motion). "See all" opens the full list. On a phone the card is a
   bottom sheet that never covers the talk bar's box while you type. Tab order runs bar, card, talk bar; focus moves to
   the next card after an answer, and the count is said politely. With nothing waiting no card shows; "Nothing needs
   you" sits in the inbox list, not on the stage.
3. **"Create one from scratch" in the demo, as a replay of a real run.** One real 0.2 plain job is recorded once, start
   to done, through a throwaway hub, sanitized and stored as a fixture. The demo lobby gets "Try it: start a project",
   which opens the real start form prefilled with the recorded prompt. Nothing runs in the browser, so words that differ
   from the recording's get a line saying the demo replays the recorded run of "<prompt>". Start plays the run sped up,
   labelled "Recorded run, sped up ×N": Claude Code sits down, the board fills, helpers appear with their cost, the
   permission card waits for the visitor's tap and carries on when tapped, and it ends with the finished result and the
   handover. The demo lobby also shows a plain one-session job beside the team companies, since plain is the default.

## What moved where

| Before (0.2.0, all at once at 1440 in the demo company) | v0.8 |
|---|---|
| The caption (summary box) over the office's top left: what needs you, who works on what, the last report | Gone from the stage. Its words live in Progress's head (stage, figures, "since you last looked") and in the card's count. The bar's status pill keeps its sentence as a tooltip and for screen readers |
| The map keys (Zoom out, Zoom in, Fit, Full screen) over the office's top right | More, as phones already had them ("Fit the office in view", "Zoom in", "Zoom out", "Full screen"). The mouse wheel, pinch and drag still move the camera |
| Progress, Office and Tasks as a views row in the bar (a row of three under it on phones) | More's Views group, first: Progress, Tasks, then the org chart, dashboards, decision log, spending, timeline and your messages. The palette (Ctrl+K) has all of them. Their addresses are unchanged |
| Inbox key with its count in the bar | The card's "1 of N" and See all; Inbox with its count first in More; the palette's "Open the inbox" |
| The side panel open on the inbox by default on desktops | Closed by default. It opens for what you asked for (See all, a person, a task, Settings, Customize, a `?panel=` address) and closes with its own Close |
| Progress as a column beside the office, with the inbox beside it on request | Progress stays a column; opening it closes the inbox panel, and opening the inbox closes Progress (one panel at a time) |
| "Needs you" in Progress, a second list of the inbox's items | One line: "Three things need you. The next one is above the talk bar." (or "Nothing needs you"), with See all |
| The live strip: three relay lines stacked over the talk bar | Off by default. The feed (the talk bar's Feed key) has every line; More's "Show the live strip" turns the strip back on for this browser |
| Every room's sign; every person's bubble, "Next for a desk" and the front desk's "4 need you" | Room signs only over rooms where someone works now; bubbles only for people working now, the stuck, meetings and replies; the front desk's sign is gone (the card is that sign). Hovering or focusing a person still shows them, the selected room's sign stays, and the org chart lists everyone |

## Layout

The window is the office. Over it, three pieces of badge paper, as in `docs/design-hud.md` (12 px gutters, 8 on phones):

- **The bar**, one row of two tiles: left, Lobby (with its count of what needs you elsewhere), the name, the status pill
  and the Demo mark; right, the budget meter and More. No views row anywhere.
- **The card**, docked over the talk bar and as wide as it (`min(760, main − 24)`), its foot one gutter above the talk
  bar's top. Its height is its content, capped at `min(46vh, 420px)` with the body scrolling inside.
- **The talk bar**, unchanged, with Feed at its end.

| Width | Bar | Card | Panels |
|---|---|---|---|
| 1440 x 900 | Lobby, name, pill, Demo; meter, More | 760 wide, centred in the main view over the talk bar | Side panel docks on the right (360) when opened; Progress a 560 column on the left |
| 1024 x 768 | Same; the name caps at 180 when short of room | 656 to 760 | Side panel docks at 320 |
| 768 x 1024 | Same; the meter folds to its figure | 744 | Side panel floats (300) over the right; the card and talk bar keep the main view |
| 375 x 812 | Lobby glyph with count, name, state dot; More | A bottom sheet over the talk bar: its head (who asks, "1 of 3", See all) always shows; the body (the words and the buttons) under it, scrolling past 46% of the height | Sheets, one at a time, as before |

On a phone, focusing the talk bar's box folds the card to its head line (who asks and "1 of N"), so the keyboard and the
box never sit under it; typing in the card's own box raises the card over the talk bar, which hides as the side panel's
sheets already make it.

## States

| State | What shows |
|---|---|
| Loading the company | The shell's "Connecting" screen, as before; no card until the snapshot arrives |
| Nothing waits | No card. The inbox list says "Nothing needs you." and Progress's line says so too |
| One item | The card without "1 of 1"'s Next and Skip (there is nowhere to go) |
| Many items (25 in the café at peak) | "1 of 25", Next and Skip; Skip moves the item to the end of this visit's order, Next shows the next without changing the order; the order resets on reload |
| Long text | The question clamps to four lines with "Read all of it", as the inbox's own item does; the card's body scrolls inside its cap |
| A batch (questions raised together) | The card shows the batch's first item with "1 of N"; the batch's one-press answer stays in the full list |
| The proposal or the plan waiting | Its own card: "The CEO's proposal is ready for you" / "The CEO's plan waits for your approval", with its Open button |
| Answered | The card shows the inbox's own one line with Undo for the hub's five seconds, then the next card slides in; Undo brings the item back to the card |
| Error (a refused answer) | The inbox's own refusal line on the card, the item stays |
| Offline hub | The card stays with its buttons disabled and the inbox's reconnecting words; answers wait |
| Reduced motion, Still office | The card swaps without sliding |
| Keyboard | Tab: skip links, bar, card (its words, then its buttons, then Next, Skip, See all), talk bar. After an answer focus goes to the next card's first line; with none left, to the talk bar's box. The card is a `region` named "Needs you", and "2 of 5 need you" is said in the polite live region when the count changes |
| Plain job | The same three pieces; the card shows Claude Code's own permission prompts and the end-of-turn words ("Reply" in your own words) |
| Finished | The handover card leads the inbox list; the card shows the end-of-turn words, if any wait |

## The demo replay

- **Recording.** `scripts/record-demo-run.mjs` (costs money; the maintainer's rules for real checks apply) starts a
  throwaway hub (own `WORKLINGS_HOME`, own port, empty temp project, `CLAUDECODE` unset, the real `claude` with its usual
  config and sign-in; `CLAUDE_CONFIG_DIR` is never moved and no credentials are read or copied), founds one plain job
  on Sonnet with `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in the project's `.claude/settings.json` (Sonnet 5.5 keeps no todo
  list without it), in acceptEdits, with every command allowed but `npm test`. It records every snapshot the hub
  streams, answers each prompt like a person after a few seconds, and stops once the turn's last words wait, no helper
  works and nothing has moved for a while, or at its spending cap. The run that was kept asked four times, not once:
  Claude Code still asked for two compound commands (`cd … && …`) and ran `npm test` twice, so the replay waits on four
  taps.
- **Sanitizing.** `scripts/make-demo-replay.mjs` turns the raw stream into `web/src/company/replay/recording.json`: frames
  as changes from the frame before, times relative to the start, the temp paths replaced by `C:\Users\you\Projects\haiku-check`,
  the machine's user and home folder by `you`, and the hub's own ids and token never kept. It refuses to write when the
  privacy scan (`scripts/check-public.mjs`) or its own scan (user name, home path, temp folder, token) finds anything.
- **Playing.** The demo founds a replay company from the frames; a clock drives them at ×8. Reduced motion doesn't change
  the speed (the frames are data; the office calms as it always does). At each permission prompt the clock stops until
  the visitor answers on the card. Allow carries on; Deny says "In the recorded run this was allowed, so the replay
  carries on as it did." and carries on. The replay ends on the last frame, with the job's last words in the inbox and the
  handover. A banner over the stage says "Recorded run, sped up ×8", with Replay and Skip to the end.
- **Honesty.** The start form in the demo says what Start does. When the words differ from the recording's, a note under
  the box says: "Nothing runs in your browser, so the demo replays the recorded run of “<prompt>”." The banner repeats
  the prompt it replays.

## Not in scope

- No change to the hub, the desks, the parity contract or what a job does.
- No new brand: the same tokens, type and art.

## Done for v0.8

- This spec, then small commits on `run/v0.8`.
- e2e: specs the change made untrue updated (each commit says which behaviour changed), and new coverage for the card
  (answer, next, skip, see all, keyboard, the phone sheet) and the replay (start, tap the permission, finish).
- Typecheck, lint, `lint:library`, `npm test`, build, `build:site` and the site suite, the e2e projects with only the
  known failures (`v3-company:10` and `v3-dashboards:77` at both sizes, `v3-progress:215` at 768), `check:public`.
- Screenshots at 1440 and 375 (before and after, the card, the phone sheet, three moments of the replay) in the
  maintainer's bench folder.
- What still needs a real iPhone: the card's sheet over the keyboard, safe areas, fixed and sticky pieces, `dvh`.
