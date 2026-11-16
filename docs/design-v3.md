# Office design, v3: the office runs the company

`docs/design.md` still holds the palette, type, principles, copy rules and v2's panels. This file adds the panels of
`SPEC-v3.md`, built on the shapes in `src/core/company.ts`. The 3D moments (walking in, walk-over relays, the front
desk, celebrations, tiredness, night, entering a company) are `docs/game-feel.md`'s; here they get only a panel's words.

**Stage and dock (11 Nov 2026), at the end of this file, replaces the tabs, the wide view, the addresses and where each
panel lives.** The panels themselves, their words and their states below still hold inside the new places.

## Decisions

1. **Two kinds of office.** A company gets this panel; a folder the hub only watches keeps v2's office (Now, Team,
   Payroll, Story). Sessions a company didn't start are visitors: last on People, with v2's badge and Ask aside.
2. **Tabs:** Now, Inbox, People, Tasks, Dashboards. Team becomes People; Payroll and Story become the Spend and
   Timeline dashboards. Preview, Customize and Settings open from the top bar. Tabs size to their labels and scroll
   sideways when they don't fit (200% zoom).
3. **One place to answer.** Questions and approvals are answered only in the inbox; everything else points there.
4. **The conversation is part of the person's panel**, under their status and task, with the box at its foot. A
   message now has effect, so Stop and what they are doing belong beside it, and a popover would chase people on
   walk-overs. v2's popover in the scene stays for visitors. This changes part of what the maintainer chose in v2.
5. **Names** through `introduce()`: "Ada, head of design" first in a row or sentence, then "Ada". You are "you".
6. **Undo, not confirm.** An answer waits 5 s on the hub with Undo; firing, office changes and proposal edits apply at
   once with Undo in place; a message can be unsent until it is delivered. v3 adds no modal dialog that asks you to
   confirm; the command palette is a modal launcher, the one exception (see "Steering").
7. **The wide view** is the one new surface, for what 384 px can't hold (the org chart, a diff, the preview, a
   dashboard opened wide): over the stage, left of the panel, with a title and Close. Phones show it full screen.
8. **Addresses** (History API): `/`, `/new`, `/c/:company` (Now; phones open Inbox while anything waits) and under it
   `proposal`, `inbox`, `people[/:person]`, `tasks[/:task[/diff]]`, `dashboards/:board`, `preview`, `customize`,
   `settings`. Every view pushes an address, tabs included, so Back (and the iPhone's swipe) returns to the view before
   it, with focus there (v2); only an address put right to what shows (the proposal while the CEO drafts, the inbox a
   phone opens on) replaces one, and coming back to Now doesn't open the inbox again. The hub answers each path with the
   app; something gone lands on the lobby or the tab: "That company isn't in the lobby any more."

## The top bar and the company's state

- Left pill: "Lobby" (a link, with a count when other companies need you), the company's name, its state. Ledger
  (v2's): At work, Waiting for a desk (when any), API-equivalent or Spend, Burn. Then "Inbox" with its count, "Preview",
  "Company" (a disclosure: Customize the office, Settings, Pause work or Resume work), Fit. On every company view.
- Phones: Lobby, the name with a state dot, Inbox, Company (Preview moves into it; spend moves under Now's headline).
  The browser tab reads "(3) Plant Pal in Worklings", and "(5) Worklings lobby" with the total.

**v0.2, simpler** (the maintainer, 13 Nov 2026, after the screens: the default screen shows only what someone who isn't
technical needs; nothing is removed, things move, and every address, `/` command, palette entry and shortcut works):
- Left: Lobby with its count, the name, one stage pill (the Demo pill only on the demo). Middle: Progress, Office,
  Tasks. Right: the budget meter, "$40 of $60" with a 3 px bar for the share spent ("$4.20" without a budget; whole
  dollars from ten up), a link to the Spending view whose tooltip and name carry "API-equivalent" and the budget's
  sentence; Inbox with its count, which shows the inbox in the side panel and hides the panel when the inbox already
  shows (the panel's own toggle key is gone; the panel's Hide and its separator stay); Preview only while the app runs;
  More.
- **One stage everywhere.** The pill is the stage (`stageOf` in `src/core/overview.ts`, through `stageOfView` and
  `stagePill`): Scoping, Waiting for your OK, Working, Checking, Done, Paused, Stuck, in the tones the dot always had.
  The lobby's card, its world's sign and progress's heading say the same word. The office's longer sentence ("Resting
  until 14:00, when your plan's limit resets.") stays the pill's detail and the caption.
- **More** opens with "Now": At work, Waiting for a desk (when any) and Burn, last 5 min, then the money in words ("$40.27
  of the $60 budget spent, API-equivalent", See spending). Then the Views group, then Find an action (the palette, still
  Ctrl+K), Preview while it isn't on the bar, Full screen, the map keys on a phone's office, and the rest as before.
- It gives way in four steps (`shell/barFold.ts`): the views' words; Preview into More, Lobby's word and More's word;
  the meter, the pill's word and Inbox's word; then the name, down to 140 px.
- Phones: Lobby, the name with its stage dot, Inbox, More (Actions is Find an action inside it).
- The stage's − + Fit and Full screen show on the Office view only; beside progress the stage fits itself.

| Phase and pause | Pill | Headline's first sentence and the lobby row |
|---|---|---|
| founding | Drafting the org | The CEO is drafting your company. |
| proposed | Proposal ready | The CEO's proposal is ready for you. |
| running, someone at work | Working | Six at work on “Pickup orders work”. Two wait for a desk. |
| running, nobody at work | Idle | Nobody is at work. Last report 25 min ago from Kai. |
| pause, usage limit | Resting until 14:00 | Resting until 14:00, when your plan's limit resets. Work picks up by itself. |
| pause, overloaded | Resting until 14:05 | Resting until 14:05: Claude is overloaded. |
| pause, by you | Paused by you | You paused work at 13:10. |
| stopped | Stopped | Stopped. Nobody works until you resume it. |
| a problem | Can't run | The problem and its fix, as "Its folder isn't at C:\…\plant-pal any more." |

## Lobby

- Desktops: the stage is the mat with each company as a small world in its theme (game-feel), its sign a button with
  the name, state and count; the panel lists the same, the accessible twin. A click on a world or a row enters, and
  the others keep working; the live region names the company ("Café Lumen: Kai needs your OK.").
- Panel: "Companies" (`h2`), "Start a new company" (primary), "Six of eight desks in use across companies." with
  Settings (the hub's desks), the companies by name, then "Watching" (folders the hub only watches, each with "Start a
  company here").
- A row is one button (v2's `.row`): the name; the folder cut in the middle ("C:\Users\…\plant-pal"); the state
  sentence; the latest status line ("Kai: Wiring the streak card to the store."); the count and "$4.20 spent". "Open
  the inbox" under it while anything waits. Phones: rows only, each with its theme's 56 px still.
- First run: an empty mat and the start form under "Worklings runs a company of Claude Code sessions that builds what
  you describe. Pick a folder and say what to build." Hub-wide problems are a callout over the list and stop Start:
  Claude Code missing or signed out (v2's copy), "Your Claude usage limit was reached. Every company rests until 14:00."

**v0.2, the lobby as the overview of every company** (SPEC-v0.2.md, "Simple, visible, proven", 1). The row above becomes
a card, the company's TL;DR before you go in, written by code from the board, the ledger and the log (`summary` on the
lobby entry, `summaryOf` in `src/core/overview.ts`; the words in `web/src/company/lobby/lobbyModel.ts`). Still rows in
the panel's one sheet, not floating cards; one button per company, and it lands on the company's **progress**
(`/c/<id>/progress`), as a world on the mat does.

| Line | Says | Left out |
|---|---|---|
| Name and stage | The name (told apart from another of the same name for screen readers), and the stage as a state pill: "Scoping", "Waiting for your OK" (the highlighter), "Working", "Checking", "Done", "Paused", "Stuck" | |
| Your words | The goal's first sentence in quotation marks, italic, two lines at most | No prompt yet |
| How far | "1 of 3 milestones, 11 of 16 tasks." and the dashboards' bar (6 px, ink on the badge line), the share of tasks done | "No plan yet." and no bar |
| Needs you | The count and the oldest item on the highlighter bar: "Mina: Which pickup window should guests see?", two lines | Nothing waits |
| Finished | "Finished: Order status page; Menu page layout; …", the last three, two lines | Nothing finished |
| Now | "Now: Theo on “Pickup orders”, Kai on “Pickup slot picker”, Ines and one more.", two lines | Nobody at work |
| Checklist | "Checklist: 5 of 6 met, 1 partly met." once the final review has marked anything | Before the review |
| Money and time | "$4.20 of $20 budget." ("$4.20, no budget", "Nothing spent yet") on the left, "Moved 12 min ago." on the right | |

- Under the card, links as before: "Open the inbox" while anything waits, "Open the preview" (a new tab) while the app
  runs, and Remove for a company that can't run. A company the hub can't summarise (one that can't run) keeps the
  old row: its folder, the state sentence with its fix, the latest status line.
- **Needs you**, a strip above the cards on note paper: what waits on you across every company, oldest first
  (`needsAcross`). Each item is a link, "Café Lumen:" small over its line ("Mina: Which pickup window…", two lines)
  with its age on the right, on the highlighter bar (the danger colour for work that has stopped). It opens the right
  company at the right place: the inbox on its question or approval, the proposal, the plan, or progress. One number:
  the heading's highlighter count is every item, three show, and "Show all 14" opens every one (`needsStrip` in
  `lobbyModel.ts`; `needsAcross` drops none). Gone when nothing waits.
- The world's sign on the mat says "Done" for a finished company, as the bar's pill does.
- No ids, paths or tool names on a card; times through `coarseAge`, money with the budget beside it.
- Phones: the same cards, each with its theme's 56 px still; the strip's items are 44 px targets.

## Progress

v0.2 (SPEC-v0.2.md, "Simple, visible, proven", 2 to 4): one plain view of where a company stands, for someone who isn't
technical, and where every entry point lands: a card or a world in the lobby, the needs-you strip, Start, the CLI's
link. Its address is `/c/<id>/progress`; the bare `/c/<id>` stays the office, so every older address and spec opens
what it did. Code: `web/src/company/progress/` (`progressModel.ts` writes the words, `Progress.tsx` draws them,
`ChecklistRows.tsx` is shared with the handover).

**Where it sits.** Desktops: a sheet of badge paper on the left of the stage (radius 16, the bevel and `--lift-3`, as
the side panel holds content), `min(35rem, 42vw)` wide, from under the bar's band to the dock's clearance, scrolling
inside. The office draws whole beside it: the shell measures the column's right edge into the stage's insets, so the
camera's fit and the labels' area start one gutter right of it. The map keys stay at the office's top right; the
caption doesn't show (the column says it all), the strip keeps one line, and Escape doesn't close it (it is a place,
not a board). The side panel starts closed beside it on desktops (`sideShownAt` in `panelView.ts`): the column already
says what needs you, and the office gets the room. Inbox, a link to the inbox, the panel's pull on the right edge, a
`?panel=` address and a needs-you link to an inbox item open it there; leaving progress forgets it. Phones: the column fills the room between the views row and the talk bar; the stage doesn't draw under
it, and the inbox's sheet doesn't peek (the Inbox key opens it, and "Show progress" lowers it).

**Top to bottom.**
1. "Progress" (19 Semi Condensed) and the stage as a state pill.
2. "You asked for" and your words, the prompt's first sentence and the rest after it ("Read all of it" past 200
   characters), on the highlighter bar over an ink line: yours, as the view you are in is marked.
3. How far: "1 of 3 milestones, 5 of 16 tasks" (19 Semi Condensed, tabular) with the money on the right ("$40.27 of $60
   budget"), and the 8 px bar under them.
4. On note paper, while there is one: "Since you last looked, 3 h ago: three tasks finished, 18 decisions made and $9.10
   spent." with "See what", which jumps to the section at the foot.
5. **Needs you** with its count: rows on the highlighter bar, oldest first, each with what it is ("A question", "Your
   OK", "The plan", "A milestone", "The budget", "The CEO's question", "The proposal"), its line, who and how long ago
   ("Mina, 6 min ago"; "The office" for its own), and a small line key: "Answer" (the inbox on that item), "Open the
   plan", "Open the proposal". Work that stopped is a row in the danger colour with no key: this view is where it
   shows. Three show, then "Show all six". Empty: "Nothing needs you. The company carries on by itself and asks here
   when it needs you."
6. **Checklist** (below). Empty: "No checklist yet. The CEO writes one with the plan: each thing you asked for, as a
   sentence that can be checked, and the tasks that build it."
7. **Milestones** of the approved plan (else the latest version; else the goal's milestones and the board): each a fold
   with its number in a disc (ink when done, an ink ring on the one work is on), the title, "4 of 6 tasks done" ("Done",
   "Not started", "No tasks yet") and a 4 px bar. Done milestones start folded. Inside, each plan task: its title (a
   link to its card in the side panel once it is on the board), the owner's name, and a status word in a pill:
   "Done", "Working", "Checking" (in review, or the final review at work), "Waiting", "Stuck", "Paused", "Dropped"
   (struck through), "Not started". "Plus 7 smaller tasks the team split off. Open the task board" counts the board's
   tasks the plan doesn't list. Empty: "No plan yet. The CEO proposes one, and you approve it before work starts."
   (founding and proposed companies say when the plan comes).
8. **Since you last looked**: "You last looked 3 h ago." and the summary; "Three tasks finished", each with who and
   when, and the files it changed folded under it (a caret says so: the one place a path shows, a press away); "Two
   decisions", each with who and when; then "Spent $1.80" and "Waiting for you: One thing waits for you." (a link that
   opens the inbox). A first visit: "This is your first look. Next time, what happened while you were away shows
   here." An office from before 0.2, which keeps no visits, leaves the section out.

**The checklist's rows** (here and in the handover). A 20 px mark and the state in a word on the right: met (an ok
disc with a check), "Partly met" (a half disc), "Not met" (the danger ring with a cross, on stuck fill), "Not checked"
(a dashed ring; the word in an outline pill). The item's sentence (15/500), your words in italic under it, the tasks
that build it as links with their status word (progress only), "No task covers this yet." in the waiting ink, and
"What the review saw" one press away: the note, "Ran npm test: it passed." (ok ink; "it failed" in the danger colour),
the files, "Open /menu on the preview" (a new tab, only while the app runs and the page is a path on it) and "Checked
by Nils, 20 min ago." Over the list: "Six things to check. The final review marks each one met, partly met or not
met." before the review, "5 of 6 met, 1 partly met." after it. An unmarked item is never counted as met.

**The plan's checklist.** On the plan page, between the goal and the milestones: "The checklist", a line on what it is
for, then each item numbered with your words and "Covered by “Menu page layout”, “Menu data”". On the latest version
each has Edit (its sentence, and "Covered by" picked from the plan's tasks as "Waits for" is; your words shown, not
editable) and Remove; "Add something you asked for" adds one of yours (`k-s1`). Each change goes into the draft with
Undo in place, like any change to the plan, and the version's "What changed" lists checklist items added, removed and
changed. Cutting a task takes it out of every item it covered; an item left uncovered says "No task covers this yet",
and the office tells the CEO rather than refusing your edit. "What you are approving" adds "It checks seven things you
asked for." until the office's own summary says it.

**The handover** leads with the checklist: "What you asked for", the counts, the rows with the evidence of anything not
met already open, then "From the CEO" and their paragraphs, then the cost against the estimate.

**More.** The views are Progress, Office and Tasks (three keys in the phone's views row). The Company menu is now
**More**: "Now" first (At work, Waiting for a desk, Burn and the money), then a "Views" group (Org chart, Dashboards,
Decision log once the company runs, Spending, Timeline, Your messages, which opens the feed), a rule, then Find an action,
Preview unless the bar shows it, Full screen and what it held (Customize the office, Settings, Pause or Resume work,
Raise the budget, Try now, Still office, the live strip; the map keys on phones). More is marked current
while the org chart, a dashboard or the decision log is the main view. A short window's one Views key lists all of
them. The palette has "Open progress"; every `open:*` command and every address still works.

| State | Progress shows |
|---|---|
| Founding, proposed | Your words, "No plan yet", the proposal or the CEO's questions under Needs you, no checklist |
| Plan waiting | "Waiting for your OK", the plan under Needs you with "Open the plan" |
| Working | The bar, who needs you, the checklist not checked yet, the milestones with words |
| Checking | "Checking": the final review at work shows "Checking" on its task |
| Done | "Done", every milestone done and folded, the checklist marked, the handover in the inbox |
| Paused, stuck | The stage says so; stopped work is a row in Needs you |
| No WebGL | The column as above; the office's place shows its notice |
| Loading, failed | The column's paper with its title and "Opening progress…", or "This view couldn't load…" |
| 375 px | Full width between the views row and the talk bar, 16 px body, 44 px keys |
| Reduced motion | The bars don't animate; carets turn without easing |

## Start a company

`/new` is one form (phones: the full sheet).
1. **Folder**: a path field with suggestions (recent folders, the parents of companies) and "Browse", folders the hub
   reads a level at a time, with "New folder here"; under it, what `detect` found ("A Vite and React app."). Refusals
   say the fix: "That folder doesn't exist. Make it with New folder here.", "Café Lumen already runs here. Open it from
   the lobby.", "That's inside Plant Pal's folder. Pick another." Notes that don't block: "Not a git repository:
   starting runs git init so the work has its own branch.", "It has uncommitted changes; the company leaves them be."
2. **What to build**: "What should the company build?", 4 rows growing to 10, hint "One sentence is enough. The CEO
   asks about the rest." Three examples fill the box and start nothing. Empty: "Say what to build." 4,000 characters.
3. **"Start the company"** (primary), with "The CEO drafts your org on your Claude Code model: about 15¢ on Opus, less
   on Sonnet." (the CEO role inherits the model). Errors show under it and keep both fields; nothing is created until
   the press succeeds.

## The proposal

Until the start the panel has no tabs: the state, the CEO's questions, the summary, the conversation with the CEO and
Start. The stage shows the CEO alone at the board; the chart opens in the wide view once there is one. A ready
proposal counts as one thing that needs you: the CEO waits at the front desk with it, and Inbox opens this view.

| State | The panel says |
|---|---|
| Scoping (12 Nov 2026) | "A few questions first": "Juno has four questions before drafting your company. Answer each, or use the CEO's picks." Your prompt in italic, then each question with its choices, the CEO's pick tagged and "Why the CEO picks “…”: …" under them, "Answer in your own words", Undo for a few seconds after each answer; "Use the CEO's picks" (primary) for every open one; "In your own words" points at the talk bar. The pill reads "Questions for you"; the dock's org suggestions wait for the draft |
| Drafting | "The CEO is drafting your company. About a minute." ("from your answers" after scoping, with "Your answers" listed) Your prompt in italic, what `detect` found, the CEO's status lines as they come, the running mark with seconds, "Stop the CEO" |
| Fixing | "The CEO's draft didn't check out (two rooms had the same name), so it's fixing it." (`proposeOrg`'s first error). After three: "The CEO couldn't draft a valid org." with "Try again" |
| Ready | The questions, the summary, the chart |
| Failed | "Couldn't draft your company." and v2's failure copy, with "Try again" |
| Stopped | "You stopped the CEO." with "Draft again" |

- Questions (`OrgProposal.questions`) use the inbox's item; an answer goes to the CEO as a message so it can revise.
  Open ones don't block: "Two questions are open. Starting uses the CEO's picks for them."
- Summary: name and goal, "18 people in five rooms: three heads, a team lead and 14 workers.", the CEO's sentence on
  why that size, "What you told the CEO first" (the scoping answers, folded), "Models: two on Opus,
  13 on Sonnet, three on Haiku.", "Theme: café.", "Written for this company: TWINT payments engineer."
- The chart: you, the CEO and the office manager, then a column per room in its hue (head, team leads, workers). A
  card shows name, title, model and "New role" when the CEO wrote it; after a revision, "Added" or "Changed: moved from
  Design", with people taken out listed under the columns. Columns wrap; tall ones scroll; phones use People's outline.
- Changing it by talking: "Tell the CEO what to change", with suggestions that fill the box ("Merge design and UX",
  "Add a … specialist", "Fewer people"). Directly: a card opens a form in the panel (Name, Title, Room, Reports to,
  Model, what they own, "Take out of the proposal"); each column ends with "Add someone" (a library role, or "Describe
  a role" for the CEO to write), and "Add a room" follows the last. Undo in place; "Back to the CEO's version".
- Only the schema blocks Start, with the fix: "Design has seven people and no team lead. Add one, move someone, or ask
  the CEO." and "Ask the CEO to fix it". The CEO's 2 to 25 never blocks the stakeholder's own edit.
- "Start the company" (primary, also in the chart's header): "Everyone is hired now and walks in. Nobody costs
  anything until they have work." It goes to Now. Leaving keeps the draft ("Proposal ready" in the lobby).

## Inbox

**Needs you**: open questions and approvals, longest waiting first, under "Three need you, oldest first." (empty:
"Nothing needs you."). An item is a row with a 3 px highlighter rule on its left while it waits.
- A question: "Mina, UI designer, asks you. Ada has a copy." (no copy line when the CEO asks), "Asked 2 min ago."; the
  question (four lines, then "Read all of it"); "For: Pay with TWINT at pickup" (the task, a link); two to four choice
  buttons with the options' words, the `recommended` one tagged "Their pick". A press answers. "Answer in your own
  words" opens a box (1,000 characters) with "Send answer"; "Message Mina" opens her conversation and leaves the item.
- An approval: "Kai, frontend engineer, wants your OK. Waiting 3 min."; its `summary` in 15 px/600; "For: {their
  task}"; "Show the command" (a `details` with `detail` in monospace, wrapped anywhere, and Copy; "Show the path" for
  files); "Allow once" (primary), "Always allow", "Deny", in Claude Code's order; then "Always allow adds a rule for
  this company: any git push to origin." (not offered outside the project, for deleting branches or global config)
  and "No answer by 15:20 counts as a no." (`expiresAt`).

| After | The item shows |
|---|---|
| A press | One line with a still mark: "Allowing once. Undo" ("Answering: Stripe. Undo", "Denying. Undo"); the count drops. The hub sends it after 5 s, so leaving the page loses nothing: "Allowed once at 14:32. Kai carries on." Undo restores the item with focus on its first button. A denial adds "Tell Kai why (optional)", a box and Send |
| Answering on | Focus moves to the next item's first line, or to "Nothing needs you."; collapsed lines stay until you leave the tab, then join Answered |
| Gone first | "Withdrawn: Kai was stopped.", "Withdrawn: Kai was fired.", "Answered in another window: allowed once at 14:31.", "Timed out at 15:20, so Kai was told no.", each with "Message Kai" |
| Resting, paused | Answerable, under "Answers reach people when the company wakes at 14:00." |
| Disconnected | Buttons unavailable under v2's reconnecting line; the browser queues nothing, so nobody acts on a stale answer |
| Refused | The item comes back with "Couldn't send your answer. The office didn't answer. Try again." |

**Conversations**: everyone you have messages with, newest first: name and title, the last line ("You: …" when yours),
its age and an ink dot ("New" to screen readers) for anything since you last opened them; heading "Conversations, two
new". Empty: "No conversations yet. Message anyone from People." and "Message the CEO". **Answered** (`details`, "14
answered today"): the question, your answer and when; older ones are on the Timeline.

**The count** is `CompanyView.inbox`; messages never add to it. It shows in the top bar, the Inbox tab, the lobby
(each company and the total), the browser tab and the phone's top bar. Whoever waits on you stands at the front desk:
clicking one opens the inbox on their item, and its sign ("Front desk, 3 need you", a label-layer button) on the oldest.

## People and a person

**People** is the org chart as an indented list by `reportsTo`: "You", the CEO, the office manager, each head under
their room's name (a button to v2's room card), then team leads and workers, 16 px in per level. A row is v2's `.row`:
hue marker, name over title, state word and status line, cost. "Find someone" above 12 people ("4 of 31 people");
above 25, rooms fold to their head unless someone there works or needs you. Then "Visitors", the fold "Fired (2)" with
Rehire, and "See the chart" (desktops: the proposal's chart, read-only).

| Desk and work | Word | Row line |
|---|---|---|
| working | Working | The status line, with "for 12 min" once it is over 10 min old |
| an open question or approval | Needs your answer, Needs your OK | "Waiting for your OK: push to GitHub. 3 min." with Answer |
| waiting | Waiting for a desk | "Has work and waits for a desk, second in line." |
| task blocked | Blocked | The blocking report's first sentence |
| failed | Stuck | "Stuck for 4 min." with `problem` on its own line, after v2's 30 s |
| starting, stopping | Starting, Stopping | The status line |
| idle | Idle | "Done for now. Last report at 14:20." |
| closed, no work | Off duty | "Nothing assigned." |
| handed over | In Claude Code | "With you in Claude Code since 14:40." |

**A person** opens from any name button, a click on them in the scene or a Conversations row; focus goes to their name,
or to the box when a "Message" button opened them (desktops). Top to bottom: Back, the name (`h2`), "Frontend engineer
in Engineering, reports to Ada." (links), cost; the state pill, status line and age, "Task: Build the streak card",
"Latest report, 14:20: …" (two lines, then "Read all of it"), "Stop" (while working), "Details"; the thread at its end;
the box, pinned to the foot.
- **Yours**: right, ink; under it "Waits for Kai's next step." or "Waits for a desk, second in line." with "Unsend",
  then "Delivered 14:32." (after a Stop, "Stopped Kai and delivered 14:32."). Refused: "Couldn't send: {why}." with
  "Try again", the words kept.
- **Theirs to you**: left, in their hue at 24% (v2); the CEO's reports to you too.
- **Yours, passed on** (`origin` is you): left, in the passer's tint, "Ada passed on your message", then "From you,
  through the CEO and Ada." and the relay's note.
- **The office's lines** (no bubble, 13 px ink-soft): "Kai passed it on to Mina, UI designer.", "Ada assigned Kai: Build
  the streak card.", "Kai reported to Ada: Card renders…" (ink check mark), "The company was restarted." Messages with
  colleagues are in Details. Long messages clamp at 12 lines; new ones scroll in only if the thread was at its end.

The box: "Message Kai", 2 rows growing to 6, Enter sends, Shift+Enter breaks a line, 4,000 characters, "Send". Its hint
says what will happen: "Kai reads it at their next step.", "Kai starts on it now.", "Kai gets it when a desk is free,
second in line.", "Ada passes it on to whoever it concerns." (managers), "Kai reads it when the company wakes at
14:00.", "Kai is with you in Claude Code. It waits until you bring them back." Drafts stay per person.

**Stop** (`stop(person, instruction)`): the box becomes "Stop Kai and say what to do instead" (a draft becomes the
instruction) with "Stop and send" (primary), "Stop and wait" (sends "Stop here and wait for my next message.") and
"Cancel". Stopping loses nothing, so nothing asks first. An approval Kai was waiting on is withdrawn.

**Details** replaces the thread ("Back to the conversation"): v2's stats; Model, Room and Look, saved like v2's levers;
"Context used: 64%" (tiredness in words); "Messages with others" (20, then a count); "Steps", the only place tool calls
show; "Fire Kai" (not for the CEO), at once, then the result's sentence ("Kai was fired. Their task goes back to Ada.")
and Undo; "Open in Claude Code": "The office pauses Kai and hands you the session. In a terminal, in this folder, run:"
the folder (their worktree if any) and `claude --resume <session id>`, each with Copy, then "Hand Kai over". Kai shows
In Claude Code and messages wait; "Bring Kai back" reopens their desk on the session ("Close Kai's session in Claude
Code first." while it's still open there).

## Tasks

- The goal, then each milestone with a bar and "8 of 10 tasks done" (or "Done at 13:40").
- "By status" or "By room" (segmented, `aria-pressed`, remembered); "Find a task" above 20. By status: Blocked,
  Working, In review, Queued, then folds for Done and Dropped, with counts. By room: the tree per room, subtasks 16 px in.
- A row is one button: the title (two lines), then "Kai, frontend engineer. Working for 12 min.", "Blocked: waits for
  your OK to use a paid API." with Answer, or "Done at 14:20. 4 files changed."
- A task replaces the tab: Back, the title (`h2`), its pill; "Kai, frontend engineer, owns it. Ada asked at 13:02.";
  "Part of: Pickup orders work"; the brief (six lines, "Read all of it"), Done when, the files it owns; subtasks; the
  outcome; "What changed": "4 files, 120 lines added and 12 removed, in a1b2c3d on worklings/plant-pal.", the files
  with their counts and "Show the diff" (before it's done: "Changes land in one commit when it's done."); "Message Kai".
- The diff (wide view; phones full screen): a `details` per file, the first five open; unified, with line numbers and
  + and − in the gutter; 500 lines a file, then "412 more lines: git show a1b2c3d -- src/streak/Card.tsx" with Copy;
  "A binary file changed."; loading "Reading the diff…"; failed "Couldn't read the diff: {git's first line}."
- Empty: "No tasks yet. The heads split the goal into tasks once the company starts." All done: "All 51 tasks are done."

## Dashboards

- A `select`, "Dashboard": Progress, Spend, Timeline, then the group "Made by the CEO"; beside it "Open wide"
  (desktops, two columns); under it "Ask the CEO for a dashboard" (the CEO's box gets "Make a dashboard that shows ").
  The tab reopens the last one viewed.
- **Progress**: stats (tasks done "24 of 51", working, blocked, waiting for you), the goal, a progress per milestone,
  tasks done per room (bars in room hues), blocked tasks with why (a list), tasks done over time (a line).
- **Spend**: "Today", "7 days", "All" (segmented); stats (spent, burn); by hour (bars); by room (bars in room hues); by
  person (v2's payroll table, "Worth a look", "The office" last); labelled API-equivalent or Spend as in v2.
- **Timeline**: v2's story lines plus status lines, reports and decisions, newest first, under hour headings ("14:00",
  then "Yesterday", "Mon 3 Nov"); one person's status lines in an hour fold into the latest ("and 5 earlier
  updates"). Filters: "Who" (everyone, a room, a person) and a "Status lines" checkbox, on. New lines: "You allowed Kai
  to push to GitHub, once.", "The CEO hired Lena, German copywriter.", "Milestone done: Menu pages live."
- **The CEO's**: the title (`h3`), "Made by the CEO at 14:02.", the widgets, "Ask the CEO to change it", "Remove this
  dashboard" (Undo in place). None yet: the group is left out and "Ask the CEO for a dashboard" stays.
- Empty: Progress "No goal yet. The CEO sets one when the company starts."; Spend "Nothing spent yet."; Timeline v2's
  "Nothing to tell yet."

| Widget | Drawn as | Also in words |
|---|---|---|
| stat | A 28 px Semi Condensed figure with its unit, the title under it, the note under that | It is words |
| progress | An 8 px bar, ink on `--badge-line` | "8 of 10" beside it |
| bars | Horizontal bars, label left, value right; 12, then "and 4 more" | "Show the numbers", a table |
| line | An ink line on light gridlines, 3 to 5 ticks, the last value labelled | A sentence (first, last, highest) and the table |
| list, table | A list of 20, a table of 50 rows, then a fold; a wide table scrolls in a labelled region | It is words |

- Marks are ink; room hues only for bars that are rooms. A malformed dashboard is refused with `publishDashboard`'s
  sentence naming the widget and the fix ("The office turned down the CEO's dashboard “Launch checklist”: the third
  widget is a line with no points."), on the CEO's thread, the Timeline and a note atop the tab until the next
  publish; a refused update leaves the last good one up.

## Preview

- Opens from "Preview", the office's screen (a "Preview the app" label-layer button) or a shared screenshot. Desktops:
  the wide view, the app (`PreviewView.url`, its own origin) left, "Screenshots" right (240 px). Phones: full screen
  under a bar with Back, the path, Reload and "Screenshots (4)".
- The bar: the path (Enter goes), Reload, "Phone", "Tablet", "Full width" (segmented; Phone frames 375 by 812), "Open
  in a new tab", "Full screen" (iPhones fill the window instead), Close.
- Screenshots: newest first, a thumbnail, "Kai, 14:20", the caption as text; one enlarges in place, Escape or Back
  returns. None: "No screenshots yet. People share one when they want you to see something."

| `state` | Shows |
|---|---|
| off, with a `command` | "The app isn't running." and "Start the app" (the command shown under it) |
| off, no `command` | "This project has no app to preview. Screenshots people share still show here." |
| starting | "Starting the app…" over an empty frame |
| up | The app |
| down | "The app didn't answer. {problem}" with Reload and "Start the app" |

## Customize and Settings

Both replace the tabs so the office stays in view (phones: the sheet at half). A direct change is an `OfficeChange` or
a reshape, applied at once with "Changed. Undo" in place for 10 s; a refusal shows under its control ("studio.yaml has
a mistake on line 12, so nothing changes until it's fixed.").
- **Say it**: "Tell the office manager" (the CEO without one), with suggestions that fill the box ("Make it a café",
  "Add a games room with an arcade theme").
- **Theme**: the nine themes as a radio group of named swatches; while one loads, "Loading the café. The office keeps
  its look until it's ready." **Rooms**: each with its theme ("Same as the office" or one of the nine); extra rooms with
  "Remove the room"; "Add a room": a name, a kind (meeting room, lounge, games room, kitchen), an optional theme.
- **Decor**: the pieces, each with Remove; "Add a piece" from the theme's catalogue, placed by the office; at 40, "The
  office holds 40 pieces. Remove one to add another." **Looks**: pick a person, then Body, Skin, Hair, Outfit ("Their
  room's colour" first and default, so colour still means department) and Prop; the scene pans to them.

| Setting | Says |
|---|---|
| Desks at once | 1 to 20, with Save: "Up to eight people work at once. More is faster and uses your plan faster." The lobby's Settings holds the hub's |
| Allowed without asking | Routine work in a sentence (reading and editing the project, its own commands, new dependencies, commits on the work branch), then each Always allow rule with Remove |
| Always asked | Push, deploy, publish, anything outside the project, deleting branches, paid APIs, messages outside the company, global config |
| Your Claude account | "Runs your own Claude Code. On a plan, costs are API-equivalent estimates." or "Claude Code uses an API key, so costs are real." It never asks for a key |
| Work branch | "worklings/plant-pal. The company commits there and never pushes." |
| Remove from the lobby | Closes every desk and keeps the folder and `.worklings/`; Undo in place |

## Now, rest and desks

- The headline's first sentence is the inbox's ("Kai needs your OK to push to GitHub.", "The CEO has a question for
  you.", "Three things need you.") followed by "Open the inbox", or the state table's; then v2's: who is at work on
  which milestone, and the latest report. Phones add "$4.20 spent, API-equivalent."
- Under it: Catch me up (v2; its account now reads status lines, reports, messages and decisions) and "Message the CEO".
- Groups: Waiting for you (with Answer), Stuck, Working, Waiting for a desk (five, then "and 9 more"), Done in the last
  15 minutes, the fold Everyone else, Visitors. A row leads with the status line, then the task ("On it: Build the
  streak card." before the first status line).
- Waiting for a desk says why: "The company is using its eight desks." or "The hub's eight desks are in use: Café
  Lumen has five."
- Resting: nothing starts; "Try now" tries once, and a new limit sets a new time. Every company on the account rests
  and the lobby says so; night falls (game-feel). Pause work: everyone stops after their current step; Resume work
  undoes it. A restarted hub picks up where it stopped and delivers what waited.

## Steering

What was built for `SPEC-v3.md` "Steering", all in the panel and wide-view patterns above. Each action applies at once
through the steering actions, says in a sentence where it was pressed why it was refused, and lands in the decision
log. The same actions work in the demo company over local state.

- **The plan** (`plan`, `plan/v3` for an older version). It shows where the plan stands and what can be approved; your
  changes, kept as a draft until you save them as one new version (with Undo); what the latest version changed from the
  one before (added, removed, changed, moved); the plan itself, edited in place (reorder, cut, edit, add); comments to the
  CEO; the versions; and the Plan approval setting (before work, at every milestone, off; the first for new companies),
  which also sits in Settings. A plan waiting for approval is an inbox item, "Open the plan", that counts in what needs
  you, leads Now and turns the company's pill to "Waiting for you".
- **The composer** (`send`, `send/room/design`). "To" picks a person, a room, a team or everyone; "For" names the people it
  should reach, so its trace flags anyone it doesn't. Each is a native select. In a person's panel the pickers stay
  folded into the box's label row until wanted, so the conversation keeps the room. Under the box: where it went, and
  your earlier messages to rooms and everyone.
- **The trace** (`messages/<id>`). Under each of your messages, one plain line says how far it got, who acknowledged it
  or disagrees and where it stalls, with "Where it went" opening the whole trace: who got it, when and how, through whom,
  each acknowledgement and what came of it. A stall shows Remind and Escalate. The line is never a live region.
- **The board.** The priority list can be dragged, or moved with Up and Down. A task has its place in line, pause and
  resume, cancel with a reason, reassign with a handover note, and a task you create for anyone.
- **The decision log** (`decisions`, `decisions/<id>`). Filters by person, room and kind; each decision with who, when,
  what, why, the alternatives and its links; Undo where it can be taken back, in the office's undo pattern (at once,
  then "Undone. Undo" in place); Reconsider sends a note to whoever made it.
- **The leash** shows beside a name as "Checks with you" or "Trusted", and nothing for Default: an outline tag in
  ink-soft, since yellow means "needs you". A person's panel, a room and Settings (an overview of every room and of
  people with their own) have the controls, which are selects with Save, then "Saved. Undo" in place. Model and effort
  sit beside it and apply at the person's next desk. Trusted asks you in the inbox first, however it comes about.
- **The command palette** (Ctrl+K, Cmd+K on a Mac, or the Actions button, which phones rely on). Typing finds any action,
  its arguments are asked one at a time and Enter runs it; the result shows in a toast with Undo.

**The palette is a modal dialog, which decision 6 said v3 would not add.** That decision is about answers: nothing the
stakeholder has to decide should hide behind a dialog or ask "are you sure". The palette decides nothing for you. It is
a launcher that holds focus while you type, closes with Escape, restores focus to what opened it, and leaves every
answer in the inbox and on the pages, where Undo still applies. It is a native `dialog` opened with `showModal`
holding an ARIA combobox, so the office behind it is inert while it is open, which is what a keyboard and a screen
reader want from a command line. It is the one modal dialog in v3.

## First run

- **Claude Code's state** (`GET /api/setup`). A callout over the lobby's list when Claude Code is missing or signed out:
  the check's sentence, its one fix with the page that explains it, and "Check again", which asks the hub afresh. While
  it stands, Start is unavailable. The result of "Check again" is announced once, by the lobby.
- **The cost** goes above Start on the proposal as one line, "About $4 an hour at API prices; on Pro or Max it counts
  against your limits." (or "billed per token to your API key"), with the breakdown below it.
- **Watch an existing project.** A folder, then what watching it would write into the folder's
  `.claude/settings.local.json`, then the hooks only on an explicit "Add the hooks" (`POST /api/watch` needs consent).
- **On the command line,** `worklings new --prompt` runs the same Claude Code check and stops with its sentence before
  it starts a company.

## Phone (375 px, over Tailscale)

- First visit: the access link, which the CLI also prints as a QR code. Locked: "Open the link worklings printed, or
  scan its QR code with this phone."
- A company opens on Inbox when anything waits or a message is new, else on Now, the sheet at 78% under v2's thumbnail
  strip (no room signs; bubbles only for the selected person and whoever needs you). The strip is a button, "Show the
  office", that lowers the sheet to half. The scene runs light: no post-processing, pixel ratio 1.5 at most, no drawing
  while the sheet is at full height.
- A person, a task, Customize or Settings fills the sheet; the box sits above the keyboard and the sheet takes the full
  height while typing (v2). Wide views are full screen with Back. Controls are 44 px; an item's buttons stack.
- Only the iPhone shows: the keyboard over the box, safe areas, the back swipe, the preview frame, waking from sleep.

## Every panel

- Loading: v2's "Opening the office" until the first snapshot; panels draw from it, so only the drafting CEO, the
  folder list ("Reading C:\Users\jamie…"), the diff, the preview and a theme have loading lines (above).
- Locked: v2's access-link screen. Disconnected: each panel keeps its last view under "Reconnecting to the office.
  This is how things stood at 14:32."; whatever sends is unavailable with that line as the reason; drafts stay.
- Empty, beyond the sections: People "Only the CEO is left. Tell the CEO who to hire."; a person "No messages yet. Kai
  reads what you send here at their next step."
- Long content: names and titles one line in rows, wrapping in headings; status lines two lines; reports 240
  characters on rows, whole in their panel; messages 12 lines; commands wrap anywhere; folders cut in the middle.
  People's text is plain, masked and capped (`LIMITS`).
- 50+ people: People finds and folds; Now shows the desk cap at work and five waiting; the chart wraps and scrolls;
  Tasks folds Done; ten companies scroll the lobby's list.
- Reduced motion: nothing in the panels slides or fades, counts don't pulse, the running mark is still.
- Keyboard: a hidden "Skip to the panel" first, then the top bar, the scene's signs, the panel. Entering a company
  focuses its hidden `h1` ("Plant Pal office"); tabs take arrow keys (v2); an item's answers are buttons, not a radio
  group, since each press answers; a wide view takes focus on its title and returns it on Close or Escape; no
  single-key shortcuts.
- Screen reader: Inbox is "Inbox, 3 need you". v2's live region adds a new item ("Kai needs your OK to push to
  GitHub.", with the company's name when it's another), "The CEO replied to you.", "The CEO's proposal is ready.",
  "Plant Pal is resting until 14:00." and its waking, "Allowed. Kai carries on.", and your own actions' failures;
  several within 10 s make one sentence. Rows, counts, status lines and the Timeline are never live.

## New components

For the UI designer to finish from design.md's scales; the rest is v2's (`.row`, `.button`, `.link`, `.pill`, `.note`,
`.callout`, `.talk__*`, `details`).
- **Count**: highlighter fill, ink tabular figures, radius 999, 20 px at least; only for what needs you; none at zero.
- **Choice button**: answers on press; white, 1.5 px `--ink-soft` edge, radius 10, 44 px tall at every width, text
  wraps; "Their pick" an ink-soft outline tag, since yellow means now and needs you.
- **Wide view**: badge fill, radius 16, `--shadow-panel`, 12 px inside the free stage, title and Close, v2's 150 ms fade.
- **Org card** and the **widgets** above. Allow once is `.button--primary`; Always allow and Deny are `.button` (denying
  is the safe answer); Fire stays `.button--danger`. The **diff** is the one place colour isn't department (a code
  convention): added on `--ok`, removed on `--danger`, both at 10%, with + and − so colour is never the only sign.

## Stage and dock

The maintainer, 11 Nov 2026 (`SPEC-v3.md` "Stage and dock", AC32 to AC41): the office fills the window, a talk bar sits at the
bottom, what you open shows in a side panel on the right, and the org, the tasks and the dashboards open as boards over
the office. This section is the flows, structure, states and words. `docs/design-hud.md` is the visual system (surfaces,
type, colour, motion values). Sketches of the structure at 1440, 1024, 768, 375 and 320 px, and of the phone's talk bar
states, are in the maintainer's evidence folder outside the repo, `<evidence>/v3-redesign-design/` (`sketch-*.png`;
structure only, not the look).

It replaces, above: decision 2 (the tabs), the box in a person's panel (decision 4), decision 7 (the wide view), the
addresses of decision 8, the top bar's buttons, the Now tab, People as a desktop view, the composer page, the Tasks
tab's list views and "Open wide". Everything else above holds inside the new places: the inbox's items and their undo, a
person's panel, the trace, the decision log, the plan, the leash, the palette, Customize, Settings, Preview, the
proposal's forms, first run.

### Decisions

1. **One main view, a side panel beside it, the talk bar under it.** The main view is the office or a board (Org, Tasks,
   Dashboards; Preview and a task's diff use the same frame). The side panel (the inspector) holds what you opened: the
   inbox, a person, a task, where a message went, a decision, Customize, Settings, the proposal. The talk bar (the dock)
   is on every company view. People read "side panel" and "talk bar".
2. **The talk bar is the one box for talking.** A person's panel keeps their thread, state and Stop but loses its box,
   and the composer page goes. The bar sends to whoever its To names, said in words at the box ("To Ada, head of
   design") before anything is sent. Opening someone makes them the To only while the box is empty, so a half-written
   message never changes hands; with words in the box, "Message Ada" switches it. One place to type, at every width. The
   one exception is v2's Ask aside, which keeps its own box for visitors. The maintainer OKs this at the checkpoint (H65).
3. **Answers in two places, one state.** Questions and approvals are answered in the inbox and inline in the feed: the
   same items, the same 5 s undo, and an answer in one shows in the other. Cards, rows and a person's panel show what
   waits with Answer, which opens the inbox on it.
4. **Undo, not confirm, still.** Two drags need words: cancelling a task needs a reason and reassigning it takes a
   handover note. Each opens today's form where the card landed, and nothing happens until its button is pressed; the
   form is the confirmation. Every other drag applies at once with Undo.
5. **Every change of address pushes, and Back undoes it** (decision 8 as fixed on 11 Nov 2026): a board, a board's
   sub-view, a side panel view. Closing something goes back when the entry before is where closing leads.
6. **Words.** "Waiting for you" for the column the maintainer called "waiting on you": the product already says it in the state
   pill, on Progress, in people's rows ("Waiting for your OK") and in the board's own sentence ("three wait for you").
   The columns use the task words in use: Queued, Working, Paused, Blocked, In review, Done, Cancelled. Buttons and
   forms keep today's words (Reassign, Cancel the task, Keep it).
7. **Faces.** Cards, chart nodes, the To and the mention list show a person's face: a portrait rendered once from their
   look (a new component, Portrait, because a name alone doesn't make a card board or a chart friendly). Until it
   exists, their initial on their room's tint.
8. **`@` at the start picks who hears it; after the first word it says who it's for.** "@Kai make the buttons bigger"
   goes to Kai. "@Ada ask @Kai to darken the palette" goes to Ada, for Kai: Ada passes it on, and Where it went shows
   whether it reaches him. It fits the relay model, but the maintainer's brief says `@name` picks who hears it, and anyone used
   to chat reads "Hey @Kai" as talking to Kai. So the list after the first word ends with "Send it to Kai instead", and
   the hint row says what will happen before anything is sent ("Mara gets it and passes it on to Kai."). The maintainer OKs
   this at the checkpoint (H65).

### The shell

| | 1440 × 900 | 1024 × 768 | 768 × 1024 | 375 × 812 |
|---|---|---|---|---|
| Company bar | a row of 44 px tiles one gutter from the window's top (a 68 px band; the model shows between them) | the same; what doesn't fit gives way (below) | the same, with more given way | 44 px tiles 8 px in, under the safe area |
| View switcher | a tile in the bar: glyph and word while the bar has room | named glyphs | named glyphs | a row of four 44 px keys under the bar; words only under 360 px |
| Main view | under the bar's band, left of the side panel | the same | under the bar's band: the office the window's whole width; a board, the feed and every piece over the office the width the floating side panel leaves (444 px; the feed and the strip 432), as when it docks | between the views row and the talk bar |
| Side panel | docked on the right, one gutter in from the window's edge, its foot and the bar's band; 360 px | docked, 320 px | floating over the main view's right: 300 px, from under the bar's band to one gutter above the talk bar | a sheet (The phone) |
| Talk bar | centred over the main view, one gutter above the foot, `min(760, main view − 24)` wide (760 here), 56 px for one line | 656 px with the side panel open (main view 680) | 744 px, under the floating side panel | the width less 16, at the bottom, 56 px plus the safe area |
| Live strip | above the talk bar, on its left edge: 3 lines on the office, 1 on a board | the same | the same, ending short of the floating side panel | 1 line, with Feed's count at its end |
| Caption | the office's top left, one gutter in, `min(520, main view − map controls − 3 gutters)` wide, 3 lines | 383 px with the side panel open (520 hidden) | 471 px; 222 beside the floating side panel, and under the map controls where it would be narrower than 200 | none: the inbox starts with it |
| Map controls | the office's top right: Zoom out, Zoom in, Fit, Full screen | the same | the same, left of the floating side panel while it shows | Zoom out and Zoom in over the office; all of them in the Company menu |
| Mini-map | on a board: 240 × 150 with its caption, in the main view's bottom right on the talk bar's baseline; a 104 × 56 thumbnail where that corner has less than 264 px beside the talk bar (a main view under 1288 px), above the talk bar under a 900 px main view | the thumbnail, above the talk bar | the thumbnail; the floating side panel ends above it | none: Office in the views row |

One gutter, 12 px (8 on phones), keeps every floating piece from the window and from the others. Which layout applies:
- **The phone layout** at a width of 720 px or less, or a height of 480 px or less: phones either way up, and a 1366 or
  1440 laptop at 200% zoom (The phone).
- **The side panel floats** from 721 px to 895 px wide (an iPad upright, half a laptop screen, a laptop at 175%): there
  the main view's 560 px and the side panel's 300 can't sit side by side. It lies over the right of the main view at
  300 px, from under the bar's band to one gutter above the talk bar (and above the mini-map on a board). It has no
  separator and no pull; Hide, the bar's toggle and anything that opens into it work as usual. While it shows,
  everything drawn over the main view lays out in the width it leaves (444 px at 768), as when it docks: a board (the
  chart's fit, the columns, the grid), the feed, the strip, the caption, the map controls, a board's head and the
  labels. Only the 3D office stays the whole width under it, the camera keeping the insets of a hidden side panel so
  opening it never moves the office, and the talk bar keeps the whole width under the panel and the feed.
- **The side panel docks** from 896 px: the main view keeps at least 560 px, so the side panel is 300 to
  `min(560, window − 596)` wide. Its default is 320 px below 1280 and 360 from 1280, or the widest if that is less.
- **The compact talk bar** wherever the main view is narrower than 640 px (phones, and a docked side panel that leaves
  less, as from 896 to about 980 px at the default width): the To as a face and first name, Feed as its glyph and count
  (The talk bar).
- **Under 360 px** the views drop their glyphs and keep their words, so nothing scrolls sideways at 320.
- **Text size.** The sizes here are at the browser's default text size. Every new font size is in rem, every switch
  that holds words is in em (720 px is 45em, 480 is 30em, 896 is 56em; the main view's 640 is 40rem), and pieces that
  hold words grow with them, so the HUD follows the browser's text size and a larger setting reaches the compact and
  phone layouts as zoom does. Converting today's px sizes is a build item in the every-state step (step 10).

**The company bar**, left to right: Lobby with the count of what needs you elsewhere, the company's name and state pill
("Demo" in the demo), the view switcher, a gap, the ledger (At work, Waiting for a desk while anyone waits, Spend or
API-equivalent, Burn), Preview, Inbox with its count, Actions (the palette), Company, and the side panel's toggle.
- When the bar runs short of room, its pieces give way in this order: Burn; Waiting for a desk; the views' words
  (glyphs with names and tooltips); Preview (into Company, which becomes an icon) and Lobby's word (its icon and count
  stay) together; the ledger, the state pill's word (its dot stays) and Inbox's word (its count stays), as on phones;
  then the name, cut down to 140 px at the least (the whole in `title`). The bar measures each piece's whole width once
  (again when its content changes), works out from those widths how many steps it needs, and works it out again when
  the bar resizes; it never folds and measures again in a loop, which would flicker at the thresholds. So a short name
  keeps the views' words longer; design-hud gives the widths where each step is sure to apply. Where the ledger has
  given way, the inbox starts with the spend, as on phones.
- Phones: Lobby (its glyph, with a dot while something needs you elsewhere; its name carries the count, "Lobby, 2 need
  you elsewhere"), the name with a state dot, Inbox, Actions, Company; under 360 px Actions goes into Company.
- Company holds Customize the office, Settings, Decision log, Pause work or Resume work, Try now (while resting), Still
  office and "Hide the live strip"; on phones also Preview, Zoom out, Zoom in, Fit the office in view and Full screen
  where the browser allows it.
- The switcher is a `nav` named "Views" with four links (icon and word), Office, Org, Tasks, Dashboards, the current one
  `aria-current="page"`. Not tabs: each is a place with an address. A board's link stays current on its sub-views.
- v0.2 ("Progress", above): the switcher's links are Progress, Office and Tasks, and Company is **More**, its views
  first (Org chart, Dashboards, Decision log, Spending, Timeline, Your messages), marked current while one of them shows.
- The inbox count lives on Inbox in the bar at every width, in the browser tab ("(6) Café Lumen in Worklings") and in
  the lobby; the side panel's Inbox heading carries it for screen readers ("Inbox, 6 need you"). Waiting for you on the
  board counts tasks, not the inbox. Inbox is marked current (`aria-current="true"`) while the side panel shows the
  inbox; pressing it then shows the side panel if it was hidden and puts focus on the inbox's heading. It never hides
  the panel: the toggle does.
- The toggle reads "Hide the side panel" or "Show the side panel" (`aria-expanded`, `aria-controls`); none on phones.

**The office view**
- The caption is v2's headline (the inbox's sentence, who is at work on what, the latest report), in the main region,
  not live, and gone while a board is open. Its first sentence, when something needs you, is a link to the inbox ("Four
  things need you."); the rest is text.
- Map controls: one tile of "Zoom out" and "Zoom in" (glyph keys with those names and tooltips) and "Fit" with its
  word (the camera's fit, which sat in the bar as a corners icon and was read as full screen), then "Full screen" or
  "Exit full screen" (the Fullscreen API on the whole app; left out where `document.fullscreenEnabled` is false, as on
  the iPhone). Each zoom press steps the camera about 1.25 times, toward whoever is open in the side panel, else the
  middle of the labels' area, within the camera's limits; with reduced motion the step jumps. Pinching and the wheel
  stay, but no zoom needs them (WCAG 2.5.1, 2.5.7). The office's top row folds by measuring too: first Full screen
  becomes its named glyph; then, where the caption would be narrower than 200 px, the caption moves to a row under the
  map controls.
- The labels over the model stay. Their free area ends above the whole strip (three lines on the office, whether or not
  they are showing) and keeps clear of the caption, the map controls and the side panel, docked or floating, so a label
  with focus is never under a HUD piece. The camera's fit reserves one strip line, as design-hud says; a label whose
  person stands lower stays at the free area's edge, as v2's labels do. So the stage takes two insets: the camera's fit
  (the bar's band, a docked side panel, the talk bar and one strip line) and the labels' area (that, less any side
  panel, the caption, the map controls and all three strip lines).
- A click on someone opens them in the side panel (and makes them the To while the box is empty); a room's sign opens
  v2's room card there; the front desk opens the inbox on its item; the office screen opens Preview.
- Enter with focus on nothing (the page or the canvas) puts focus in the talk bar, a game's "Enter to talk". Enter is
  not a character key, so it needs no switch to turn it off.

**The side panel**

| View (`?panel=`) | Opens from | Title (`h2`) |
|---|---|---|
| none: the inbox | Inbox in the bar, "Back to the inbox" on anything else | "Inbox" |
| `inbox/q-3` | the front desk, Answer on a card or a row | "Inbox", on the item, focus on it |
| `people/kai` | a name anywhere, a click in the office, a chart node | their name |
| `tasks/t-12`, `tasks/new` | a card, a task's link, Add a task | the task's title, "Add a task" |
| `messages/m-12` | Where it went | "Where your message went" |
| `decisions/d-4` | the decision log, a feed line | the decision's page |
| `customize`, `settings` | the Company menu, the palette | "Customize the office", "Settings" |
| `proposal` | before the start it is the home | the proposal's heading |

- v2's room card and a visitor's badge open here without an address, with their own Back, as today.
- Header: Back (only when the entry before is another side panel view over the same main view, or the feed; it is the
  browser's Back), the title, "Back to the inbox" (an × with that name and tooltip: `goBack` to the address without
  `panel`) and Hide (named "Hide the side panel"). The inbox has its title, its count sentence ("Five need you, oldest
  first.") and Hide.
- The views are today's panels. A person's panel has no box: "Message Kai" (its primary button) makes Kai the To even
  with words in the box (the words stay, and the box says its new To) and puts focus there; Stop turns the talk bar into
  Stop (below). A question or approval of theirs that waits shows as a row with Answer, which opens the inbox on it,
  as cards and the feed's rows do (decision 3). Its "Send to more people" goes: the talk bar reaches rooms, teams and
  all hands.
- Before the start the home is the proposal: state, the CEO's questions, the summary, the cost, Start.
- The plan's item in the inbox says what waits and what changed ("The launch plan, version 3: three milestones and 51
  tasks. What changed: Pickup orders split in two, one task added."), with Open the plan. No approving from the item:
  a plan approval has no Undo, so it happens on the plan page, where the plan can be read.
- Resting, paused, stopped or can't run: a callout tops the inbox with the state's sentence and its action (Try now,
  Resume work, the fix). On phones, and wherever the bar's ledger has given way, the headline's sentences and "$40.27
  spent, API-equivalent." come first.
- Resize: its left edge is a separator (the window splitter pattern): `role="separator"`, `aria-orientation="vertical"`,
  `aria-controls` the side panel, `aria-valuemin` 0 (hidden), `aria-valuemax` the widest, `aria-valuenow` its width
  (300 at the least) with `aria-valuetext` "360 pixels wide". It is named "Resize the side panel" and described "Left
  and Right resize it, Enter hides it."; its tooltip, for the pointer, says "Drag to resize it, or press to switch
  between narrow, default and wide." 8 px to grab, 16 on touch screens, `col-resize`, its grip always shown
  (design-hud). Dragging follows the pointer between 300 and the widest: the side panel and the pieces over the main
  view follow by CSS while the office's canvas and camera stay as they are, then refit once when you let go, so a drag
  never resizes the 3D view on every move. A press without dragging steps through narrow (300), the default and wide
  (the widest), so the width never needs a drag (WCAG 2.5.7).
- Keys on the separator: Left and Right move the edge 16 px (Left widens), 64 with Shift; Home is the narrowest, End the
  widest; Enter hides the side panel, and focus stays on the separator.
- Hidden: the main view takes the width, and the separator stays on the window's right edge, collapsed into a 24 × 64 px
  pull with the inbox's count (the same control and name, `aria-valuenow` 0, `aria-valuetext` "Hidden", described
  "Enter or a press shows it again.", its tooltip "Press to show the side panel, or drag it out."). Enter on it, or a
  press, shows the side panel again at its last width, with focus still on it; pulled out as a drag, it opens at the
  width you let go at. The bar's toggle and anything that opens into the side panel bring it back too. "Back to the
  inbox" keeps it shown on the inbox; only Hide, the toggle and Enter on the separator hide it. Hide from inside the
  side panel puts focus on the pull (floating, on the bar's toggle).
- Memory: its width and whether it is hidden, one preference for this browser in `localStorage` (read in try/catch:
  blocked storage gives the defaults), fitted to the window when read. First visit: shown, at the default width.

**Focus order:** "Skip to the talk bar" and "Skip to the side panel" (shown on focus), the bar, the main view (the
office's controls and labels, or the board), the feed while it is open, the strip's button, the talk bar, the separator,
the side panel. While the feed is open, what lies under it (the labels, or a board's content) is out of the order
(`inert`); the caption, the map controls and a board's head above it stay.

**Escape** is one handler in the shell. By where focus is, the first that applies:
1. A tooltip, or a name revealed on hover or focus, hides.
2. A search field with words clears them, as search fields do (the talk bar's box never clears on Escape).
3. An open list, menu or picker closes, with focus back on its button or the box.
4. A drop form or a lifted card goes back.
5. The palette closes.
6. In the talk bar, a recalled message goes back to your draft, a command steps back and Stop ends. Past those,
   Escape in the talk bar does nothing: it never closes the feed or a board while you type.
7. In the feed, the feed closes.
8. While a board is open, in the board or on nothing, the board closes.
9. On nothing with nothing open, a company's walk-in skips, as today.

In the side panel, nothing past 5: Back, "Back to the inbox" and Hide do the rest. In full screen the browser takes the
first Escape to leave full screen, so the mini-map drops its Esc key cap there.

### The talk bar

**v0.2, simpler** (the maintainer, 13 Nov 2026): the To, the box, Send, and Feed as a small key, its glyph and count with
"Feed" or "Feed, 2 new replies" as its name and tooltip. The live strip rides on the bar on the Office view only, not on
progress or a board (a phone there shows its Feed key instead). When the box is empty and has focus, three or four
chips sit over it, taken from the palette's suggested commands (`talkChips`): "Catch me up", "Ask Mara how it's going"
(the message command, its words filled in, waiting for Send in the palette), "Raise the budget" while the budget has
paused work, "Resume work" or "Pause work". A chip runs its command as the palette does: at once when it needs nothing
(with the palette's toast and Undo), else in the palette at its first step. The palette itself offers eight before
anything is typed (three recent at most, then suggested); typing finds every command.

Left to right: the To, the box, Send, Feed. While the box has focus or words, a 20 px row under it holds the hint; it
is the box's description for screen readers (`aria-describedby`), "For Kai" included. Compact (a main view under
640 px, and phones): the To as a face and first name, 96 px at most (under 360 px the face alone, its words in its
name), the box, Send, and Feed as its glyph and count (on phones Feed is the strip). Several picks show their faces in
the To and their names in the hint row; Stop and a command take a row above the box at the bar's full width (The
phone).

Feed shows a number for new replies to you and disagreements with your messages (ink, not yellow: they don't need you),
and a dot when only other lines are new: "Feed, 2 new replies" or "Feed, new lines". Questions and approvals count in
the inbox, not here. It is a toggle (`aria-expanded`, `aria-controls` the feed), named "Close the feed" while the feed
is open.

**The hint row** says one thing at a time, the newest first:
- for 10 s, or until you type: what just happened, with its key (a send with Unsend, a command's result with Undo, a
  refusal with Try again);
- while you type: what will happen (`sendHint`), or why a mention stays as words;
- in an empty box with focus: "Type @ to choose who hears it, / for a command." (the placeholder can't teach it: it is cut in a
  narrow box and gone at the first key);
- while the office reconnects: "Sending waits until the office is back. Your words stay."

"For Kai" chips and, from 3,500 characters, the counter sit at its end.

**Who hears it**
- The To shows a face and "To Mara, CEO" ("To the design room", "To Ada's team", "To all hands", "To Kai and Mina"). It
  is a button named by those words, whole when they are cut, described "Change who hears it", with
  `aria-haspopup="dialog"` and `aria-expanded`.
- It starts on the CEO and is kept per company for the tab (`sessionStorage`). What changes it:
  - Opening someone, from the office, the chart, a name in the feed or an address (`TalkControl.offer`), but only while
    the box is empty. With words in the box the To stays, so a half-written message never changes hands; the person's
    panel offers "Message Kai". A pick for this message counts as words: after "@design", opening Kai leaves the To on
    the design room.
  - "Message Kai", Reply in the feed and buttons that say so ("Ask Mara to hire someone", "Ask the CEO for a
    dashboard"), even with words in the box (`TalkControl.to`): the words stay, the box says its new To, and focus goes
    there. Words a button suggests ("Hire ") go in only when the box is empty.
  - Its picker, a leading `@` (for one message), and Stop (below).
  - Not a visitor: visitors keep Ask aside, in their badge, the one other box (decision 2).
- When the To's person leaves the company, or its room or team is gone, the To falls back to the CEO at once, said at
  the box and in the live region: "Kai left the company. To the CEO now.", "Ada's team is gone. To the CEO now." The
  words stay.

**The To's picker.** Pressing the To opens "Who hears it", a popover over it (not modal, in the top layer): a search
field, "Find someone, a room or a team" (the palette's combobox), above a list grouped as All hands, Rooms, Teams and
People (the composer's `recipientChoices`), each with its reach: "The design room, four people", "Everyone, 18 people.
They gather in the office for a moment." Focus starts in the field; Up and Down choose, Enter or a press picks. A pick
closes it, sets the To and puts focus in the box. Escape clears the field's words, then closes it with focus back on
the To; a press outside closes it too. Nothing matching: "No one called “zo”." in the field's status. Phones: a sheet
(The phone).

**`@` at the start**
- `@` at the very start of the box opens the same choices as a list over the box (the lists, below), filtered by what
  follows: first names, titles, rooms, teams and ids, case and accents ignored. People whose first name starts with
  what you typed come first, then titles, then rooms and teams; all hands only from "@al" or "@ev" (`@all`,
  `@everyone`, `@all-hands`), so a slip of a key never reaches 18 people.
- Picked (Enter, Tab or a press): the typed `@…` leaves the box, and the To shows the pick, marked as for this message
  only; the live region says "To the design room, for this message only." Backspace in the empty box drops the last
  pick ("To Mara, CEO."). After sending, the To you set comes back.
- Typed and not picked: a mention counts only when it is exact, case and accents ignored: a first name, a name or a
  title as the list shows it ("@head of design"), a room's or a team's name, or `@all`, `@everyone` or `@all-hands` for
  all hands, exactly as the list shows them; the longest that matches, ending at a space or punctuation. Then it works
  as a pick, said the same way, but the words stay in the box as you typed them (they aren't sent: the To says who hears
  it), and deleting them undoes it. Anything else stays as words, and the hint row says so as soon as the mention ends,
  before anything is sent: "@ka isn't anyone's name, so it stays as words." or "Two people are called Sam, so it stays
  as words. Pick one from the list." Pasted text follows the same rule.
- Several picks before the first word all hear it: "@Kai @Mina make the buttons bigger" goes to both, one copy each
  (steering's `send` takes one recipient, so the bar sends once per pick, and someone a picked room or team already
  covers gets one copy). The To reads "To Kai and Mina" (three names, then "and two more"). From the fourth person, when
  one room or team holds them all, the list offers it first ("Ada's team, all four of them and Ada").

**`@` after the first word: who it's for** (decision 8)
- After the first word, `@` after a space lists people under "Who it's for. You'll see if it reaches them." The list
  ends with "Send it to Kai instead" for its top match, which makes Kai the To for this message, as a leading `@` does.
- A pick writes "@Kai" in the words and adds "For Kai" (beside the To; compact, in the hint row), and the hint says what
  will happen: "Mara gets it and passes it on to Kai." Where it went flags anyone it doesn't reach. So "@Ada ask @Kai to
  darken the palette" goes to Ada, for Kai. Deleting the word removes it, and so does the chip's "Not for Kai".
- Typed and not picked: the rule above. An exact match adds "For Kai"; anything else stays as words, with the hint's
  sentence.
- An `@` inside a word, as in an email address, opens nothing.

**Commands**
- `/` at the very start opens "Commands": the palette's (`paletteModel`, run through `palette/run.ts`), suggested first,
  then by section, filtered as you type ("/pause des" finds "Pause the design room"), in the same kind of list.
- A command's steps are asked in the bar. The To becomes the command ("Cancel “Cart summary”"; compact, a row above the
  box) and the box asks the step: its name becomes the step's question ("Why cancel it?") and its description says
  where you are ("Cancel “Cart summary”, step 2 of 2"); each new step is said. A choice step shows its options in the
  list. Send reads "Next" on a step that isn't the last and "Run" on the last, and Enter does the same. Escape steps
  back; from the first step, back to the list with what you had typed.
- New commands: "Open the org chart", "Open the task board", "Open the plan", "Open the dashboards", "Open the decision
  log", "Open the feed", "Catch me up" (live offices). With the org chart (step 6): "Hire someone" (`/hire`: the room,
  then the role; the new person reports to the room's head, or to the CEO when the room has none; the demo company,
  which has no library, asks the CEO instead), "Fire Kai" (`/fire`), "Move Kai to another room" (`/move`, then the
  room) and "Rehire Pia" (`/rehire`, from the fired). The palette's "Open the People tab" and the like become these.
- No match: "No command matches. Enter sends it as a message."
- The result shows in the hint row for 10 s with Undo ("Paused “Cart summary”. Noah stops and waits. Undo") and in the
  live region. Ctrl+K and the palette stay.

**The lists** (`@`, `/` and a command's choices) are one pattern. The box is a `textarea` and keeps its textbox role
(ARIA allows no combobox role on it), with `aria-autocomplete="list"`, `aria-controls` naming a `listbox` of `group`s
and `option`s, and `aria-activedescendant` on the active option while the list is open.
- Up and Down move through the options while the list is open; they recall history only while it is closed. Enter or
  Tab picks, and focus stays in the box; Escape closes the list and keeps the words; Home, End, Left and Right stay
  caret keys; a press on an option picks it.
- The active option scrolls into view. Eight rows, grouped, then the list scrolls (phones: four, at full width).
- A status by the box says how many match when the list opens and when the number changes, once typing pauses (about
  half a second): "Five match. Up and Down choose, Enter picks.", or its no-match sentence.
- The list is a manual popover (`popover="manual"`) in the top layer, so it opens over the feed and the side panel; an
  `auto` one would close at the first click in the box. It is placed from the box's rectangle in script, with anchor
  positioning only as an enhancement.

**Typing**
- Enter sends, Shift+Enter starts a new line; on touch-first screens (`(hover: none) and (pointer: coarse)`) Return
  starts a new line and Send sends.
- The box grows from one line to six (or a third of the window's height, if that is less), then scrolls. 4,000
  characters; the counter "3,620 of 4,000" from 3,500; over: "4,120 of 4,000. Shorten it by 120 to send." in the danger
  colour, the box `aria-invalid` and the sentence said once, Send unavailable, nothing cut.
- History: Up in an empty box, or on a recalled entry you haven't changed, brings back what you sent before with its To;
  Down goes forward to your draft; Escape returns to it. The last 50 per company in this browser. In a box with words,
  Up moves the caret as usual.
- The draft stays while the tab is open, one per company whatever the To: the To changes on an empty box or by your
  choice, so drafts no longer swap with it. Only the per-To keying goes: the draft stays keyed by the company
  (`draftScope`, which Plan.tsx keys its own draft with too).
- Whatever leaves the box is typed (`Message.typed`), words a suggestion put there included; Stop and wait's own words
  aren't.
- The placeholder follows the To: "Say something to Mara" ("Say something to the design room"). The box's name:
  "Message to Mara, CEO".

**Sending**
- Send is unavailable with an empty box (`aria-disabled`, focus stays).
- Sent: the box clears and keeps focus. The message shows at once in the strip, the feed and the person's thread; the
  hint row and the live region say "Sent. Mara reads it at their next step." (`sendHint`'s sentence after "Sent."), with
  Unsend, which the feed and the thread keep until it lands. Unsend puts the words back in the box unless you've started
  something new there, puts focus in the box, and says "Unsent. Your words are back in the box."
- The hint while you type is `sendHint`'s: "Mara reads it at their next step.", "Kai starts on it now.", "Ada passes it
  on to whoever it concerns.", "All 18 get it, and gather in the office for a moment.", "Kai reads it when the company
  wakes at 14:00." Its for-line becomes the sentence above ("Mara gets it and passes it on to Kai.").
- Send's flight: your yellow note lifts off the talk bar and arcs into the office to the receiver's desk (a room's sign,
  a team's head, the middle of the office for all hands; one note each for several picks), where the 3D note of
  `docs/game-feel.md` takes over; over a board it lands on the mini-map. A desk out of view, or under the floating side
  panel, gets the note flown to the edge of the labels' area toward it, where it fades, and the camera doesn't move. The
  strip's line appears as the note lifts, not when it lands. With reduced motion or Still office nothing flies, and the
  line appears in the strip. Its timing is in design-hud's motion table.
- Refused: the words come back into the box (unless you've started something new) and the hint row says "Couldn't
  send: {why}." with Try again, said in the live region.
- Several picks: the copies go one at a time, in the To's order. If some went and one was refused, the box clears, the
  sent ones show as sent, and the hint row says "Sent to Kai. Couldn't send to Mina: {why}." with Try again, which
  sends only to the picks it didn't reach. Unsend takes back every copy still waiting.
- Refused because its person left: "Couldn't send: Kai left the company." with "Send to the CEO instead" in place of
  Try again (the To is the CEO already).
- Reconnecting: Send unavailable, and the hint row's sentence above.

**Stop** (a person's Stop, `/stop`, or Stop in a chart node's More): the To's place reads "Stop Kai", outlined in the
danger colour (not a button while Stop lasts; compact, a danger-edged row above the box), and the box is named "Stop Kai
and say what to do instead", which the hint row says too. The draft becomes the instruction. Send and Feed become "Stop
and send" (primary) and "Stop and wait", and Cancel sits in the hint row (compact: Send reads "Stop and send", and "Stop
and wait" and Cancel both sit in the hint row). Focus goes to the box and Escape cancels. As before nothing asks first,
and an approval Kai waited on is withdrawn. Opening someone else ends Stop, and the words stay.

**Before the start** the To is the CEO and stays so; placeholder "Tell the CEO what to change"; the proposal's
suggestions ("Merge design and UX", "Add a … specialist", "Fewer people") take the strip's place and fill the box; `@`
says "Until the start you talk to the CEO." and `/` says "Commands work once the company starts. Until then, tell the
CEO what you want."

### The live strip

- It shows the feed's newest lines, every kind (the feed's filters don't apply), each as one line cut at a word with
  "…", with the speakers' faces (sender, an arrow, receiver: decorative, the words say it) and the line's age on the
  right ("just now", "2 min"):

| Line | The strip says |
|---|---|
| Yours | "You to Mara: Make the palette darker." |
| A reply | "Mara to you: Done, the menu uses the darker tokens." |
| Your words passed on | "Ada to Mina: your darker palette, for the slot cards too" (her note; with none, the words she passed on: "Ada to Mina: “Make the palette darker.”"), with the yellow note mark (your words, as in the office) |
| An acknowledgement | "Mina acknowledged: Darkening the tokens now." or "Tom disagrees: The SEO copy needs the old colours."; a burst folds: "18 people acknowledged your message." |
| A stall | "Your message hasn't reached Mina yet. Ada has it." |
| A question, an approval, the plan | "Mina asks you: 15-minute or 30-minute windows?", "Kai needs your OK: push the work branch to GitHub", "Mara: the plan waits for your OK", on the highlighter |
| Someone stuck | "Sofia is stuck: the TWINT sandbox turned down the test merchant ID", in the danger tint |
| Work, talk between people | "Lena reported to Clara: the German pastry descriptions are in", "Ines to Noah: Order API next, the slot picker needs it" |
| A decision | "Ines decided: Checkout in three steps." |
| Milestones, the org | "Milestone done: Menu pages live.", "Mara hired Lena, German copywriter." |

- How lines come and go: three on the office (the newest nearest the bar), one on a board and on phones. A new line
  pushes the oldest out, within a second of happening (AC33). Lines that need you come and go like the rest: the inbox's
  count, the caption's first sentence, the front desk and the mini-map's count hold what waits, so nothing pins the
  strip and a relay always shows. Each line stays at least a quarter second, so a relay still shows within the second
  AC33 promises; lines that come faster don't queue: when the quarter second is up the newest show and the ones
  between are skipped (the feed has them all). Bursts fold as the feed folds
  them, the count growing in place. With nothing new for 5 minutes the lines fade away, so a quiet office is clean.
  Hidden while the feed is open.
- A press opens the feed at that line. For the keyboard and screen readers the strip is one button, "Open the feed"
  ("Open the feed, 2 new replies"), with `aria-expanded` and `aria-controls` the feed, its lines inside it as text
  (it opens at the newest). Nothing in it is live.
- "Hide the live strip" in the Company menu ("Show the live strip" once hidden; one preference for this browser) takes
  it away for anyone it distracts (WCAG 2.2.2); Feed keeps its count, and on phones a Feed key with the count takes the
  strip's place.
- Phones: one line, with Feed's count of new replies at its end (ink, in the button's name). It doesn't fade, so the
  way into the feed is always there; before anything is said, "Nothing said yet".
- Reduced motion or Still office: lines come and go without fading or moving.

### The feed

Feed, or a press on the strip, opens the talk bar upward into it: the bar's width,
`min(600, 62% of the main view's height)` tall, the talk bar at its foot. While the side panel floats and shows, the
feed takes only the width the panel leaves (432 px at 768) and the talk bar stays the whole width under both, so a
person opened from the feed shows beside it, as AC34 asks. Escape in the feed, Close or Feed ("Close the feed") shuts
it. Focus goes to its heading when it opens and back to Feed when it closes. Right after the heading, "Jump to the new
lines" (shown on focus) puts focus on the New rule (`tabindex="-1"`, "New lines start here"), or on the last line when
nothing is new, so a screen reader doesn't start above 200 lines.

Header: "Feed" (`h2`), Who (everyone, the rooms, the people by room) and Kind, both native `select`s with option groups
styled as chips, Catch me up and its line (live offices; v2's states unchanged, the digest pinned above the lines),
Close.

| Kind (the filter) | Line | Under it | In the line |
|---|---|---|---|
| Your messages and replies | "You wrote to Mara, CEO" (to the design room, to Ada's team, to everyone, to Kai and Mina; "You stopped Kai") | your words | the trace's line ("Passed on to Ada and Mina. Mina acknowledged.") and Where it went, one per copy when you picked several people; Unsend while it waits |
| | "Mara replied" (to one of yours), "Mara wrote to you" | their words | Reply (the To becomes them, focus to the box); a dot until seen |
| Passed on | "Mara passed your message on to Ada, head of design" (later hops: "Ada passed it on to Mina, UI designer"), with the note mark, yellow for your words | their note, in quotes | |
| | "Mina acknowledged your message", "Tom disagrees with your message" | their sentence | |
| | "Your message to Ada hasn't reached Mina yet." | "12 min. Ada has it." | Remind Ada, Escalate to the CEO |
| Needs you | "Mina, UI designer, asks you", "Kai, frontend engineer, wants your OK", "The office asks before Lena starts “Order confirmation in both languages”", "The CEO's plan, version 3, waits for your approval" | the item as the inbox shows it | its answers, or Open the plan |
| Work | "Ines assigned Kai: Build the slot picker", "Kai reported to Ines", "Ines paused “Cart summary”", "Sofia is stuck: the TWINT sandbox turned down the test merchant ID" (once, when someone becomes Stuck by the 30 s rule; only the desks' state knows it, so a reload keeps only who is stuck now) | a report's first two lines | the task, as a link |
| Decisions | "Ines decided", "You paused “Slot picker visuals”" | what, and why in a line | Open the decision |
| Company | the log's sentence: "Milestone done: Menu pages live.", "Mara hired Lena, German copywriter.", "The CEO proposed version 3 of the plan.", "Resting until 14:00." | | its link, if it has one |
| Between people | "Ines wrote to Kai" | their words | |

- Never in it: status lines (the bubbles, the chart and the Timeline have them), tool calls, steps.
- A line: the speaker's face and room marker (yours in ink), the sentence with names as buttons that open the person,
  the time on the right ("14:02"), the words under it. Words are plain, masked and capped as everywhere; messages show 6
  lines, then "Read all of it".
- Oldest at the top. It opens on the New line, else at the bottom. A new line scrolls in only if you were at the bottom;
  otherwise "3 new lines" waits at the foot and takes you there, focus on the first of them.
- **Threads:** your message and what follows from it (relays, acknowledgements, stalls, and work, decisions and replies
  that cite it) hang under it on a rail while they come in a row; one that comes after other lines starts with "On your
  message: “Make the palette darker”", a link to where it went. A relay whose message has left the view still writes
  that line, from its own words and `origin`.
- One speaker's lines of one kind within 2 minutes share a header; each keeps its sentence for screen readers.
- Bursts: four or more lines of one kind on one thread within a minute fold into one: "18 people acknowledged your
  message." with Show them.
- Days get a line ("Yesterday", "Mon 3 Nov"), an `h3`.
- **Older lines:** the view carries the company's newest 200 messages (`VIEW_LIMITS`). At the top, "Show earlier lines"
  asks the office for the 200 before them, with their acknowledgements, and focus goes to the first line it adds. The
  office keeps a company's newest 5,000 messages (`STATE_LIMITS`). Only when the route says nothing older is kept
  (`more: false`, or its `unknown` refusal for a message that has left those 5,000) does the feed end with "Earlier
  lines aren't kept in the office." This is a contract change, the lead's: a route,
  `GET /api/c/<id>/messages?before=<message id>&limit=<1 to 200>`, answering the messages older than the one named,
  newest first, with their acknowledgements and whether more are kept (`MessagePage`); the demo serves the same from its
  made-up history. The feed uses it after the checkpoint (Build order); until then it reaches as far as the view and
  says nothing at its top, since older lines are kept, only not shown yet. Pages hold messages and their
  acknowledgements; work, decisions and the log's lines reach back as far as the view carries them (the Timeline shows
  what the view carries, too).
- Filters: Who matches the speaker or the one spoken to (a room: anyone in it); Kind is the table's first column,
  Everything by default. With one on: "Showing lines with Kai." and Show everything; nothing matching: "Nothing with Kai
  yet." The sentence is a `role="status"` by the filters, said once. Kept per company for the tab.
- **Unread:** "New" (an ink rule; "New lines start here" to screen readers) sits above the first line since you last
  closed the feed, in this browser, until you close it. A reply to you keeps its dot until it has been on screen in the
  open feed for a second or you open their thread; then they are marked seen (`markSeen`), so the inbox's Conversations
  agree.
- **Answering inline:** the inbox's items (choice buttons, Show the command, Allow once, Always allow, Deny, Answer in
  your own words, Message Mina) with its undo: "Answering: 15-minute windows. Undo", then "You answered 15-minute
  windows at 14:07." in the line. A pressed answer's Undo takes focus; when Undo goes, focus moves to the line itself
  (`tabindex="-1"`). Gone first: the inbox's lines ("Withdrawn: Kai was stopped.").
- A name opens that person's panel beside the feed (their thread); Where it went opens the trace; a task opens the task.

### Boards over the map

- The board fills the main view under the bar. The office goes into the mini-map, bottom right beside the talk bar: the
  same canvas, shrunk into the corner and fitted, still drawing on demand, without labels. It is a button, "Back to the
  office" with an Escape key cap, the office live in it, and two marks of its own: the company's state in the bar
  pill's word ("Working", "Idle", "Resting until 14:00", "Paused by you", "Stopped") and the count of what needs you,
  both in its name ("Back to the office. Working, 4 need you."). It hides while the feed is open over a board, and
  without WebGL.
- Header: the title (`h2`, focus goes there) and, where it helps, a sentence about the board ("18 people in five rooms.
  Six at work.", "51 tasks: 24 done, eight working, three wait for you."), its sub-views, filters, actions, and "Back to
  the office" at the right end. It folds by its own measured room, as the company bar does (each piece measured once,
  the step worked out again when the head resizes), in this order: the sentence goes; the filters go into Filter; the
  actions become their named glyph keys ("Hire someone"), and "Fit the chart" becomes "Fit" (a word, never the glyph
  alone); the search field narrows to 120 px; last, the head takes two rows, the title and "Back to the office" over
  the rest, and the board's content starts under it. "Back to the office" keeps its words through every step. So the
  head always fits, the Org board's at 768 with or without the side panel included, and nothing scrolls sideways.
  Results of what you do on a board show in a row under it for 10 s, with Undo where it can be taken back (each board
  says which), and in the live region.
- It opens by rising 12 px and fading in over 150 ms while the office shrinks into the corner over 250 ms, and closes
  the other way; both cut with reduced motion or Still office.
- Back to the office: the mini-map, "Back to the office", Office in the switcher, Escape and Back. Focus returns to what
  opened the board, else the office's heading (`h1`, "Café Lumen office"). The camera comes back as you left it, not
  refitted, so a room you had zoomed into is still there.
- The talk bar and one line of the strip stay. Every board's scroller keeps them clear (the talk bar with its hint row
  and growth, one strip line and a gutter) and the mini-map's corner too: its last card, its Answer and "And 22 more"
  scroll above them, and focus moved by keys never lands under them (scroll padding; design-hud has the rules).
- Preview and a task's diff use the frame without the mini-map, which would cover the app or the code: "Preview" and
  "Changes in “Build the streak card”", the diff with "Back to the task".
- Where the rest lives: the plan is the Tasks board's Plan; the decision log is the Dashboards board's Decisions, a
  decision opening in the side panel; Settings and Customize are side panel views; the composer is the talk bar; the
  inbox is the side panel's home; Catch me up is in the feed; Now's headline is the caption, and its groups are the
  chart's states and the board's columns.

**Addresses**

| Address | Main view |
|---|---|
| `/c/cafe` | the office |
| `/c/cafe/org` | Org chart |
| `/c/cafe/tasks`, `/c/cafe/plan`, `/c/cafe/plan/v2` | Tasks: Board, Plan, an older version |
| `/c/cafe/dashboards`, `…/spend`, `…/timeline`, `…/<id>` | Dashboards (the CEO's by id) |
| `/c/cafe/decisions` | Dashboards: Decisions |
| `/c/cafe/preview`, `/c/cafe/tasks/t-12/diff` | Preview, a diff (no mini-map) |

- `?panel=` adds the side panel's view to any of them (the table above); none means the inbox. On desktops it stays when
  the main view changes: the switcher's links carry it, so Kai stays open beside whichever board you go to. On phones,
  where the side panel is a sheet, the views row drops it.
- Every change of address pushes; closing something goes back when the entry before is where it leads, else it goes
  there as a new entry (`goBack`; today's replace changes on purpose). Back returns focus where it was (the router's
  focus keys); Forward opens again what Back closed, with focus on its title. Not addresses: filters, the feed, the To,
  the side panel's width and whether it is hidden. A reload keeps the main view and the side panel's view.
- The page's title follows the main view, so Back and Forward say where they land: "(6) Org chart, Café Lumen in
  Worklings", "(6) Café Lumen in Worklings" on the office.
- Old addresses still work and are replaced on load: `inbox` → `/c/cafe`, `inbox/q-3` → `?panel=inbox/q-3`, `people` →
  `org`, `people/kai` → `?panel=people/kai`, `people/kai/message` → the same with Kai as the To and focus in the talk
  bar, `tasks/t-12` → `tasks?panel=tasks/t-12`, `messages/m-12` → `?panel=messages/m-12`, `decisions/d-4` →
  `decisions?panel=decisions/d-4`, `send…` → the office with the To set and focus in the talk bar, `customize` and
  `settings` → `?panel=…`, `proposal` → the office.
- Something gone: the side panel says "That person isn't in the company any more." or "That task isn't on the board any
  more." with Show the inbox.
- The router compares path and search; `?token=` and `?demo` keep their meaning and leave the address as today.

### The org chart

**Layout** (a pure function, `orgLayout`, tested from 1 to 60 people):
- The CEO on top, "You" above with a line down (decorative). CEO reports who manage nobody (the office manager, a
  specialist) stand in a column beside the CEO on a dashed line.
- Under the CEO the heads in a row, in People's order, each room's name above its group (decorative: the head says it).
- Under a manager, their workers in one column, then their team leads side by side, each with their own column; width
  grows with managers, not with people.
- Elbow lines from a manager to each report. Someone whose manager left hangs under the CEO on a dashed line, "Reported
  to Lena, who left". Someone moved to another room stays under their manager, their node in their own room's colour
  with "In Design" on it, so the chart shows what Move left undone.
- Nodes 216 × 76 at 100% (the state chip shares a row with the work line), 24 px between columns, 8 between rows in a column and 20 under a manager.
  Visitors are listed under the chart.

**A node:** face, name and title (one line each), spend and model, the state chip and a line about their work, plus the
leash's tag unless it is Default.

| State (`workOf`) | Chip | Line |
|---|---|---|
| working | Working | the task's title, "for 12 min" from 10 min |
| needs-ok, needs-answer | Needs your OK, Needs your answer (highlighter) | the request's or the question's first words |
| waiting | Waiting for a desk | "Second in line." |
| blocked | Blocked | the block's first words |
| stuck | Stuck for 4 min (danger) | |
| starting, stopping | Starting, Stopping | the task |
| idle | Idle | "Done for now." |
| off | Off duty | "Nothing assigned." |
| away | In Claude Code | "With you since 14:40." |
| their task paused | Paused | the task |

**Using it**
- A click, or Enter, opens them in the side panel (and makes them the To while the box is empty); whoever is open
  there is marked open (design-hud).
- Keyboard: one tree (`role="tree"` named "Org chart", nodes `treeitem` in a flat list with level, set size, position
  and `aria-expanded` on managers), one tab stop, the tree pattern's keys: Up and Down through the visible nodes in
  order (a column top to bottom, then the next), Right opens a manager or goes to their first report, Left closes or
  goes to the manager, Home and End, typing a name jumps there. The view pans to keep the focused node in sight. Tab
  from a node reaches its More, then leaves the chart.
- A node's name says who and how they are: "Kai, frontend engineer, Engineering. Needs your OK: push the work branch to
  GitHub." Figures that tick go in its description, so a focused node doesn't repeat itself every few seconds: "For
  12 min. Sonnet, $4.66. Shift+F10 for more." (`aria-keyshortcuts`).
- While a node has focus, the company goes on: focus follows the person by id through any change of layout; when they
  leave, focus goes to their manager's node, else the CEO's, and the tree's one tab stop is always on a node that
  exists. Nothing opens or closes under focus: a closed manager's line says what changed beneath them instead.
- Pan by dragging the background, with the wheel (Shift for sideways) or a trackpad; a press on the background without
  dragging centres the view there. Zoom with Ctrl+wheel or a pinch at the pointer, or the header's Zoom out, the
  percentage, Zoom in and "Fit the chart" (its word shown: the corners icon alone is what read as full screen in today's
  bar), which zoom toward the focused or open node; from the floor (below) to 150%; a double-click on the background
  fits. The browser's
  own Ctrl and plus stays its zoom, and the zoom keys' tooltip says so.
- Zoom sets how far apart the columns are; under 100% it changes the nodes' form instead of shrinking their words,
  which never go under 12 px (design-hud draws the forms). The whole node comes first: the maintainer's brief puts live state,
  task, model and spend on every node, so it narrows to 200 px (its title and work line cut with "…") before anything
  else gives, and stays whole from 88%. Café Lumen's 18 open whole at 1440 x 900 with the side panel open (the chart is 610 px tall, the free area above the
  talk bar and strip 641 px). Only where the whole node can't fit does a compact one take over (face, name, the state in words; 75% to
  88%), then a chip (face, name, its state mark on the face's corner), down to the floor: the zoom where every chip
  still shows its whole label, 40% at the least. A chip's label is at least the whole first name, never two letters;
  people have first names only, so two with the same one add their title's first word ("Sam, QA", "Sam, SEO"). From
  100% up the chart simply scales.
- It opens fitted to the width, at 100% at most, down to the floor; if even the floor doesn't fit, it opens at the
  floor centred on the CEO. Zoom and pan are kept per company for the tab.
- Managers open and close (a small control, and Left and Right); a closed one shows "+6" and the most urgent state under
  it ("Six more under Theo, one needs you").
- "Find someone" (name, title or room): the rest dim, "4 of 18 match" (a `role="status"` by the field, said once typing
  pauses), Enter focuses the first and pans to it.

**Relays along the lines**
- A message between two people (a relay, a message, an assignment, a report, a question to a manager) sends a paper
  along the lines from one node to the other, through their shared manager: yellow when it carries your words, white
  otherwise, as game-feel's notes. 300 ms a hop, 1.2 s at most; the receiver's node rings once. Yours start from "You".
- Six at once at most; past that, receivers only ring. An all-hands sends one paper to each head, then every node rings.
  A node rings at most once a second.
- Reduced motion or Still office: no paper; the receiver shows a paper mark and "From Ada" in its work line for 4 s.

**Hire, fire, move**
- Header: "Hire someone" opens "Ask Mara to hire someone" (the talk bar, To Mara, "Hire ", focus there) and "Hire into a
  room" (the rooms, then v2's room card in the side panel with what can be hired; the demo, which has no library, fills
  the talk bar to ask the CEO instead). "Fired (2)" lists them with Rehire.
- Hiring into a room makes the new person report to the room's head, or to the CEO when the room has none (the hire
  carries `reportsTo`, a small contract change: `ReshapeAction` gains it). Its result is a company sentence: "Lena
  joined Content as German copywriter, reporting to Clara. Undo".
- A node's "More" (⋯) shows on hover and on focus, and always on touch screens, beside the node rather than inside it;
  the context menu key (Shift+F10) on the focused node opens the same menu: Message Kai, Stop Kai (while working),
  Change Kai's model, Move Kai to another room, Fire Kai. Each is also in the side panel (Enter, then Details) and in
  the palette and the talk bar (`/hire`, `/fire`, `/move`, `/rehire`).
- Fire applies at once: the node fades out over 150 ms (a cut with reduced motion), focus goes to their manager's node,
  and "Kai was fired. Their task goes back to Ines. Undo" shows under the header for 10 s and is announced.
- Move: Details in the side panel with Room focused, or `/move`. The manager stays, and the result says so: "Kai moved
  to Design and still reports to Ines. Ask Mara to give Kai a manager there. Undo". A new manager is by talking ("Ask
  Mara to move Kai").
- Hire, fire, rehire and move are decisions Undo takes back, until something later changes the same person.

**40 people:** the chart opens in the largest form that fits all 40 (chips at 1440; design-hud has the zooms and draws
it), their words at 12 px; where even the floor doesn't fit, as at 1024 with the side panel open, it opens at the
floor centred on the CEO. The full name shows on hover and focus and is always in a node's accessible name. Over 25
people, rooms where nobody works or needs you start closed (People's rule); Find someone does the rest.

**Before the start** the chart is the proposal: name, title, model, "New role" when the CEO wrote it, and after a
revision "Added" or "Changed: moved from Design", with "Taken out: Pia, brand designer." under the chart. A node opens
the proposal's form in the side panel; each manager's column ends with "Add someone to Design" (a dashed node), the row
of heads with "Add a room"; "Start the company" (primary) is in the header, with the proposal's cost line beside it
("About $3 an hour at API prices; on Pro or Max it counts against your limits."), so the cost is seen even with the side
panel hidden. While the CEO drafts: the CEO alone, "The CEO is drafting your company. About a minute." and their status
lines. The first proposal opens the chart once, as the wide view did; revisions don't move you, the side panel says
what changed.

**Phones:** People's outline as the tree (the same pattern: `treeitem`s, not buttons): rows with face, name and title,
the state word and the work line; managers open and close, a closed one reading "Theo, head of engineering, and 7 more"
with the count of who needs you under them; a row opens their sheet; Find someone and Hire above. No pan or zoom;
relays mark the row.

### The task board

| Column | Holds | Order | Empty |
|---|---|---|---|
| Waiting for you | the plan waiting (first, as a card); tasks whose owner waits on your answer or OK, or held for your start | longest waiting first | "Nothing waits for you." |
| Queued | open tasks not started | the order work is handed out in | "Nothing queued." |
| Working | started, owners waiting for a desk included | that order | "Nobody is on a task." |
| Paused | | that order | "Drop a task here to pause it." |
| Blocked | | that order | "Nothing is blocked." |
| In review | | that order | "Nothing waits for review." |
| Done | | newest first | "Nothing done yet." |
| Cancelled | cancelled and dropped | newest first | "Drop a task here to cancel it." |

- A task shows once: Waiting for you wins over Paused, Paused over its status. An approval or question whose person has
  no task shows only in the inbox and the feed.
- Paused and Cancelled are columns because the spec's drags between columns pause and cancel; they are where you drop a
  card to do it, and where you look for what is held or dropped.
- Columns are 248 px with cards and 168 px without; the board scrolls sideways under sticky column heads; Cancelled
  starts as a 52 px rail with its count and opens on a press or under a dragged card. Waiting for you's head has the
  highlighter rule while it has cards.
- Done and Cancelled show their newest ten, then "And 22 more", which shows the rest; the other columns show every card
  and scroll inside themselves (a fixed count, so nothing measures notes on every snapshot).

**A card**, a sticky note in the owner's room colour:
- The title (3 lines); its place in line at the top right ("4th"; "Fourth of 14 in line" to screen readers), for open
  tasks, counted over every open task: the switchboard's order.
- The owner's face and first name; the milestone, one line, cut at 24 characters. A subtask says what it is part of
  ("Part of: Pickup orders work"), and its parent how far its parts are ("3 of 6 subtasks done").
- One line in the task rows' words: Queued "Next for Noah." or "Third for Lena." (their own order); Working "Working for
  22 min." or "Waits for a desk, first in line."; Paused "Paused by you at 19:40."; Blocked "Blocked: needs the order
  API."; Waiting for you "Waits for your OK: push the work branch to GitHub.", "Waits for your answer: 15-minute or
  30-minute windows?" or "Waits for you to start it."; Done "Done at 16:45. 6 files changed."; Cancelled "Cancelled by
  you at 14:20: not needed for the launch."
- One button at most: Answer (the inbox on its item, in the side panel), Resume, Undo (named "Undo the cancel", while it
  can be undone), Open the plan.
- A press anywhere on the note opens the task in the side panel; the open one is marked open (design-hud).
- New since you looked: a card that is new, or changed column or owner, since you last left the board, in this browser,
  carries design-hud's ink dot until you leave it again ("Changed since you looked." in its description). A first visit
  marks nothing.
- What a card is to the keyboard and screen readers: its focus target is a link to its own address
  (`?panel=tasks/t-12`, what opening it does), named by its title. The owner, the line, the milestone and its place in
  line are its description ("Noah. Working for 22 min. Pickup orders. Fourth of 14 in line."), so ticking minutes never
  change its name. Enter follows the link. The title's link stretches over the whole note, its press target, while
  Move and the note's one key sit outside the link (a link can't hold buttons). Each column is a list under its
  heading.

**Dragging** (a mouse, or on touch screens after a 400 ms press and hold):

| Dragged | Dropped | Means | Then |
|---|---|---|---|
| a card in Queued, Working, Paused, Blocked or In review | in its own column | its place in line, before the card it lands above | at once: "Moved “Cart summary”: now fourth of 14 in line. Undo" |
| from Queued, Working, Blocked, In review or Waiting for you | on Paused | pause | at once: "Paused “Cart summary”. Noah stops and waits. Undo" |
| from Paused | on the column it came from, which lights up | resume, at that place in line | at once: "Resumed “Cart summary”. Noah carries on. Undo" |
| from Queued (not paused) | on Working | start it next: it jumps to the front of the whole open order, so it starts now if its owner is free, else right after their current task (the maintainer, 12 Nov 2026) | at once: "“Cart summary” goes to the front. Starts now." or "… Next for Noah, after “Order API”." and Undo, which puts the order back |
| any open card | on Cancelled | cancel | a form under it (below); nothing happens until Cancel the task |
| any open card | in another person's lane (Group: Person) | reassign | a form under it (below) |
| any open card | on any other column, Waiting for you and Done included | | refused: the column sinks and says why |
| a Done or Cancelled card, the plan's card | | | doesn't lift (the plan isn't a task: Enter opens it) |

- While dragging: the card lifts, a line shows where it would land, columns it can't go to sink with their reason under
  the head ("Cards land here when someone needs you.", "Tasks reach Working when their owner starts them." for a card that isn't Queued, "Tasks get
  here by themselves as the work goes." on Blocked and In review, "Done tasks stay done.", "Started tasks don't go back
  to Queued." on Queued for a started card, and for a paused card "It goes back to Queued: drop it there to resume
  it."; a card lifted out of Waiting for you: "Answer it to move it on."), and the board scrolls near its edges. A
  card's own column never sinks: let go over Waiting for you, a card from there goes back quietly, and that column
  neither sinks nor lights for its own cards. A drop below a column's last card lands right after it in the whole order.
  Escape, or letting go outside the board, puts it back.
- Cancelling: today's cancel form, under the card in Cancelled: "Cancel “Cart summary”", "Why (they read it)" (needed),
  `cancelHint` ("Noah stops, and what they changed is kept on a branch named after the task."), "Cancel the task"
  (danger) and "Keep it". Focus goes to the reason; Escape or Keep it puts the card back.
- Reassigning: today's reassign form, under the card in its new lane, with the lane's person chosen: "Reassign “Cart
  summary”", "A handover note (optional)", `handoverHint`, "Reassign to Kai" (primary) and "Keep it with Noah". Focus
  goes to the handover note; Escape or Keep it puts the card back.
- Results show under the header for 10 s and in the live region; a refusal shows there in its sentence and the card goes
  back. Moves in line, pauses, resumes and cancels have Undo (UndoLine). A reassignment has none: the new owner may
  have started, so handing it back is another Reassign.
- While a card is lifted, by the pointer or the keyboard, the company goes on. Its place is kept by the card it would
  land before, not by a count, so cards coming and going don't move it (if that card leaves, the next one holds the
  place). When a change makes the drop impossible (the task started, was cancelled or reassigned, or its column now
  refuses it), the card goes back and says why: "Cart summary started meanwhile, so it went back." When the task leaves
  the board, the lift ends and focus goes to the card that took its place, else to the column's heading. Reconnecting
  ends a lift: the card goes back, with the reconnecting sentence.

**The keyboard way**
- The board is one tab stop, with roving focus on the cards' links. Arrow keys move between cards (Up and Down in a
  column, Left and Right to the nearest card in the next column that has cards, Home and End in the column). Down from
  a column's last card shown reaches its "And 22 more": Enter shows the rest, and focus goes to the first card it
  showed. Right from the last column reaches the Cancelled rail (named "Cancelled, 6 tasks"): Enter or Right opens it.
  Enter on a card opens the task; Space picks it up; Tab goes on to that card's Move and its button, then out of the
  board. Arrows and Space are keys added to the links for sighted keyboard users.
- Picked up: Up and Down move it in its column, Left and Right to the next column it can go to, saying why it skipped
  others; Space or Enter puts it there (opening a form where one is needed); Escape puts it back. The row under the
  header says "Moving “Cart summary”. Arrow keys move it, Space puts it here, Escape puts it back." Each step is said in
  a status of its own, replaced at every step so only the latest is read (results stay in the live region): "Before
  Pickup slot picker, fourth of 14 in Queued.", "Over Paused: dropping it here pauses it. Skipped Blocked: tasks get here
  by themselves as the work goes." (one clause per skipped column, in its own reason).
- Move (a menu button on every open task's card, named "Move “Cart summary”"; none on Done, Cancelled or the plan's
  card, where none of its items apply), in today's words: Start next (a Queued card that isn't paused: the drop on Working),
  Move to the top, Up, Down, Move to
  the bottom (in its column, left out where they can't apply), Pick up (the same as Space), Pause or Resume, Reassign…
  and Cancel the task… (today's forms, on the card where it is), Open. It shows on hover and focus and always on touch
  screens; hidden, it stays in the accessibility tree (visually hidden, never `display: none`), so a screen reader
  finds it on every open task's card.
- The screen reader path: a screen reader may keep the arrow keys and Space for itself, so the lift is for sighted
  keyboard users. Someone with a screen reader follows a card's link to the task in the side panel, which keeps
  today's controls (its place in line, Pause, Reassign, Cancel the task), or uses Move, whose menu covers every drop.
  So someone who never drags has them all. After any move, focus stays on the card in its new place.

**Filters and grouping**, in the header: Who (everyone, a room, a person), Milestone, "Find a task", Group (None, Person
or Room, as GitHub Projects groups a board); "12 of 51 tasks" (a `role="status"` by the filters, said once typing
pauses) and Show all while a filter is on; kept per company for the tab.
- Lanes stack down the board under the same sticky column heads, each a row of the status columns. A lane's head is a
  row of its own: a face or a room's sign, its name and count ("Noah, backend engineer, three tasks"), and a toggle that
  closes it (`aria-expanded`); closed, a row right under its head keeps a count for each column, aligned to the columns
  ("One queued, one working, one waits for you." to screen readers). In a lane, Done and Cancelled show their newest
  three, then "And 9 more"; an empty cell stays empty (a column's empty sentence shows only without lanes). The arrow
  keys run down a column through the open lanes, and across the columns within one; each lane's head is a heading.
- Group: Person makes a lane per owner with open tasks, in the org's order. A drop anywhere in another person's lane
  reassigns, whatever its column: the form opens under the card where it landed, and once reassigned the card shows in
  the column its status gives. In its own lane, the columns mean what they mean without lanes.
- Group: Room makes a lane per room, in People's order, for reading; a drop across rooms is refused ("Pick the person:
  group by person, or use Reassign.").
- Both are drawn before build step 4 (design-hud), since the maintainer sees the board at his checkpoint.
- With filters on, a drop lands before the card it lands above.

Also in the header: Board and Plan (Plan carries the count while the plan waits) and "Add a task" (`?panel=tasks/new`).
The plan is today's, in an 880 px reading column with its approve bar kept in view; from 1280 px a column at its right
holds the versions, the comments and the Plan approval setting.

Empty: "No tasks yet. The heads split the goal into tasks once the company starts."; with the plan waiting, "No tasks
yet: the CEO's plan waits for your approval." and Open the plan; all done, "All 51 tasks are done."

**Phones:** one column at a time. Chips name the columns with their counts (scrolling sideways; Waiting for you's count
on the highlighter): a `tablist`, each column a `tabpanel`, only the current one in the tab order and the others
`inert`; a sideways swipe moves to the next column (scroll snap) and makes its chip current. Filter (a sheet with
Group, Who, Milestone and Find), Add a task and Plan sit under them. Cards are the same links, each open task's with
Move as a 44 px button, which opens the menu as an action sheet: a native `<dialog>` opened with `showModal`, focus on
its first option; Escape, Close or a press on the scrim closes it, with focus back on Move. No dragging. With a group
on, the current column's panel shows a section per lane, each under its lane's head row.

### Dashboards at full width

- A rail on the left, 200 px: Progress, Spend, Timeline, Decisions, then "Made by the CEO" with theirs, then "Ask the
  CEO for a dashboard" (the talk bar, To the CEO, "Make a dashboard that shows "). The header says which and when
  ("Progress, as of 14:32."; on one of the CEO's, "Made by the CEO at 14:02."). Under 1100 px of board the rail is a row
  of links; phones keep today's select.
- A 12-column grid with 16 px gaps; widgets keep their words and fallbacks.
  - Progress: four stats (Tasks done "24 of 51", Working, Blocked, Waiting for you); the goal with each milestone's bar
    (7 columns) beside tasks done per room (5); tasks done over time (8) beside blocked tasks with why (4).
  - Spend: Today, 7 days, All on top; spent and burn; by hour (8) beside by room (4); by person (12).
  - Timeline and Decisions: a 760 px list with its filters in a 280 px column on the right (Timeline: Who, Status lines;
    Decisions: person, room, kind); a decision opens in the side panel.
  - The CEO's, in order: stat 3 columns, progress and bars 6, line 8, list 6, table 12.
- Under 1100 px of board the grid has 8 columns: stats take 2, the rest the full width. Phones: one column, stats two to
  a row.

### The phone

The phone layout applies at a width of 720 px or less, or a height of 480 px or less (The shell): phones either way up,
and laptops at 200% zoom.
- Top: the bar (Lobby with its dot, the name and its dot, Inbox, Actions, Company) and the views row (Office, Org,
  Tasks, Dashboards; 44 px targets; words only under 360 px, so nothing scrolls sideways at 320).
- Bottom: the talk bar at full width (the To as face and first name, 96 px at most; the box; Send as a 48 × 44 icon key
  named "Send"), above the safe area, and the strip's one line above it, Feed's count at its end.
- The talk bar's other states, at 375 and at 320 alike (design-hud draws them):
  - A pick for this message only: the To shows it (a room as its glyph and word) and the hint row says it: "To the
    design room, for this message only. Ada passes it on to whoever it concerns."
  - Several picks: the To shows their faces (named "To Kai and Mina") and the hint row says it: "To Kai and Mina, for
    this message only: a copy each."
  - Stop and a command take a row above the box at the bar's full width: "Stop Kai", danger-edged, with the box named
    and hinted "Stop Kai and say what to do instead"; "Cancel “Cart summary”, step 2 of 2", with the step's hint.
  - Send becomes a word key: "Stop and send", "Next", "Run". "Stop and wait" and Cancel sit in the hint row as 44 px
    keys; a command's hint row holds Back (a step back, as Escape).
  - "For Kai" chips sit in the hint row, each with a 44 px "Not for Kai".
  - Refused, partly refused and over the limit: their sentences in the hint row, with Try again or "Send to the CEO
    instead" as a 44 px key.
  - Under 360 px the To is the face alone: its words stay in its name and in the placeholder ("Say something to
    Mara").
- Sheets sit between the views row and the strip's line above the talk bar: a board fills that space; the side panel
  opens at 78% of it, with the office live above as "Show the office" (which lowers it to half; Customize and Settings
  open at half); the feed opens from under the views row down to the talk bar (the strip hides while it is open), with
  Feed, Catch me up, Filter and Close. The side panel's sheet lies over a board's
  and over the feed's: Close, Back and the swipe return to what was under it, the feed at the line you left. Whatever a
  sheet lies over is `inert`.
- Closing a sheet: Back and the iPhone's back swipe, Close, or a swipe down on its grabber or header. A press in the
  views row closes the side panel's sheet (the views row drops `?panel=`). The feed's sheet pushes an entry with the
  same address, marked in the entry's state, so the swipe closes it; a reload of that entry shows the page without the
  feed. The inbox's sheet, which has no address of its own, gets the same marked entry, so Back and the swipe close it
  instead of leaving the company.
- The To's sheet ("Who hears it") and the Move action sheet are native `<dialog>`s opened with `showModal`. Focus starts
  on the first option (in the To's sheet, under its search field, so the keyboard doesn't rise over the choices until
  you tap the field). The To's sheet lists its options as buttons under their group headings ("Kai, UI designer"), the
  current To pressed (`aria-pressed`). Escape, Close or a press on the scrim closes them, with focus back on the To or
  Move; a pick in the To's sheet closes it and puts focus in the box.
- Short windows, under 560 px tall (a phone on its side, a laptop at 200%): the views fold into the bar as one Views
  key named with the current view ("Views, Org"), a disclosure of the four links, the current one
  `aria-current="page"`; the strip hides and Feed, with its count, joins the talk bar;
  the hint row shows only while the box has focus; sheets take the whole height between the bar and the talk bar.
  Under 400 px tall the bar scrolls away with what is under it, so only the talk bar stays fixed (design-hud draws
  both).
- The keyboard: the talk bar rides on it (`visualViewport`, as the sheet does today) and sheets take what is left; the
  strip gives way to the hint while you type. While a field in a sheet has focus the talk bar hides, so forms keep their
  room. The talk bar's lists open above it, full width, four rows, then scroll.
- Every gesture has a button: columns (the chips), a sheet down (Close), the office's pinch (Zoom in and Zoom out, two
  44 px keys over the office while it has the screen or a sheet is lowered, and in Company beside "Fit the office in
  view").
- A company opens on the office, with the inbox's sheet up when anything waits or a reply is new (today's rule).
- Only the iPhone shows: the keyboard over the talk bar, safe areas in both orientations, the back swipe on sheets,
  scroll snap on the columns, press and hold on an iPad.

### Every state

**First use**
- A company's first opening in this browser: the side panel shown on the inbox at its default width (floating from 721
  to 895 px); the hint row teaches `@` and `/` whenever the box is empty and has focus; no tour.
- Nothing said yet: an empty strip (phones: "Nothing said yet"); the feed says "Nothing said yet. What you say, the
  replies and how your words travel down the org show up here."; Feed has no count.
- A new company: the proposal as above; Start puts focus on the side panel's heading, where the plan will wait.

**Empty:** each view's line is in its section (the inbox, the feed, every column, the board, the chart with only the
CEO); the dashboards, the plan and the decision log keep today's.

**Loading**
- The company: v2's "Opening the office" until the first snapshot, as today.
- A board's code: the frame with its title and "Opening the org chart…" ("Opening the task board…", "Opening the
  dashboards…"), the mini-map already there. A side panel view's code: "Opening…" under its title.
- As today: "Reading the diff…", "Starting the app…", a theme's loading line. The rest draws from the snapshot.

**Error**
- A board or a side panel view that fails to load or draw: its fallback sentence and "This view couldn't load. Reload
  the page to try again.", said in the live region too; everything else works.
- No 3D (no WebGL, or it failed): the office view shows today's callout, boards have no mini-map, and Back to the office
  and Office in the switcher still work.
- A refused action: its sentence where it was pressed (the hint row, the row under a board's header, the side panel),
  with words and drafts kept. An address naming something gone: the side panel's line (Addresses).

**Reconnecting**
- A row under the bar across the width (`role="status"`, as today's): "Reconnecting to the office. This is how things
  stood at 14:32."
- What sends is unavailable with that line as the reason: Send, Next and Run, Unsend, inline answers, Move's items,
  drags (cards don't lift, and a lifted card goes back), the chart's More, Hire and Fire. The talk bar's hint row says
  "Sending waits until the office is back. Your words stay." Drafts stay. The strip and the feed stop, the feed ending
  with "Reconnecting to the office."; the mini-map keeps its last frame.

**Long content**
- Names, titles and milestones: one line with "…" on nodes, cards, chips and the strip; whole in the side panel and in
  accessible names. The company's name keeps at least 140 px in the bar and gives way last.
- Task titles 3 lines on cards; questions 4 lines then "Read all of it"; messages 6 lines in the feed; commands wrap
  anywhere; the talk bar grows to six lines (or a third of the window's height); columns scroll inside themselves.

**Narrow and short windows** (The shell, The phone): the side panel floats from 721 to 895 px; the compact talk bar
under a 640 px main view; the phone layout at 720 px wide or 480 px tall, its short form under 560 px tall and its bar
scrolling away under 400; words only in the views under 360 px. Checked at 1440 × 900, 1366 × 657 (a laptop with the
browser's own bars), 1024 × 768, 768 × 1024, 768 × 432 (a 1536 laptop at 200%), 720 × 450 (1440 at 200%), 844 × 390
and 812 × 375 (phones on their side), 375 × 812, 320 × 568 and 320 × 256 (1280 × 1024 at 400%), every board and the
feed at 768 × 1024 with the side panel floating, and at 1440 and 375 with the browser's largest text size (24 px).
Nothing scrolls sideways at any of them, nothing lies under the floating side panel, and the box always has room to
type.

**40 people:** the chart as above; the mention list shows eight rows, grouped, then scrolls; Who lists people by room;
the feed folds bursts; Group: Person lanes close; nothing else changes.

**Reduced motion and Still office:** nothing slides, fades or travels (boards, the mini-map, the feed, sheets, strip
lines, cards settling, nodes leaving, the chart's papers); panning and the zoom keys' steps jump. A dragged card still
follows your hand.

**Forced colours:** every focusable piece keeps an outline, transparent until a contrast theme paints it, the talk
bar's box included (never `outline: none`); design-hud has the rest.

**Where focus goes**

| After | Focus |
|---|---|
| A board opens | its title |
| A board closes | what opened it, else the office's heading |
| Something opens in the side panel | its title; Back or "Back to the inbox" returns it to the opener |
| Message Kai, Reply, Stop, "Ask Mara to…", a `send` address | the talk bar's box |
| Sending, Unsend | stays in the box (Unsend's words come back there) |
| A pick in the To's picker or sheet; Escape there | the box; the To |
| The feed opens, closes | its heading, Feed |
| "Jump to the new lines", "3 new lines", "Show earlier lines" | the New rule, the first line shown |
| An inline answer | its Undo, then its line |
| A drag, a move, a drop form's button | the card, where it is now |
| "And 22 more", the Cancelled rail opening | the first card it showed |
| A lifted card's task leaves the board | the card that took its place, else the column's heading |
| Firing from the chart, or a focused node's person leaving | their manager's node, else the CEO's |
| Hide from inside the side panel | the pull (floating: the bar's toggle) |
| Enter on the separator or the pull | stays there |
| Showing the side panel with the bar's toggle | the panel's title |
| A phone's action sheet or To's sheet closes | Move, or the To |

**Screen reader:** the office's one polite live region, as today, says:
- each send ("Sent. Mara reads it at their next step."), a partly refused one ("Sent to Kai. Couldn't send to
  Mina: …"), a refusal, and Unsend's result ("Unsent. Your words are back in the box.");
- each change of who hears it by `@`, Backspace or a person leaving ("To the design room, for this message only.", "To
  Mara, CEO.", "Kai left the company. To the CEO now.");
- a command's steps and results, moves and drops ("Moved “Cart summary”: now fourth of 14 in line."), steering
  results, firings, hires and moves, and a view that fails to load.

A lifted card's steps have a status of their own, replaced at each step. The results of typing are `role="status"`
regions by their fields, said once typing pauses (about half a second): Find's and the filters' counts ("4 of 18
match", "12 of 51 tasks"), the feed's filter sentences, and the lists' counts and no-match sentences. Never live: the
strip, the feed, the chart, the board and the company's counts (the inbox, Feed, the columns).

**The demo company and the static demo**
- Everything works over local state, as steering does today: sends get sample replies, relays and acknowledgements
  within seconds; drags steer; the chart fires and rehires.
- The demo plays a slow loop of talk so the strip and the chart live: about every 20 s the next line of a script (a
  relay chain about the pickup flow, an acknowledgement, a report, a decision, a milestone), with its walk-over.
- Ledger, the demo's paused company, grows to 40 people, so the 40-person chart, board and lists are in the demo and the
  static demo.
- Catch me up isn't offered in the demo company, as today. "Show earlier lines" pages through a made-up history, so
  the feed's older lines work in the static demo too.
- The static demo: the layout starts under its banner; it has no reconnecting state; deep links with `?panel=` work as
  GitHub Pages serves them (`404.html`).

### Copy

Words not given above, in the project's voice:

| Where | Words |
|---|---|
| Views | "Office", "Org", "Tasks", "Dashboards" (the nav: "Views"; a short window's menu key: "Views") |
| Map controls | "Zoom out", "Zoom in", "Fit" (named "Fit the office in view"), "Full screen", "Exit full screen" |
| Company menu | today's items, and "Hide the live strip" or "Show the live strip" |
| Side panel | "Inbox", "Back", "Back to the inbox" (the ×), "Hide the side panel", "Show the side panel", "Resize the side panel" (described "Left and Right resize it, Enter hides it."; its tooltip "Drag to resize it, or press to switch between narrow, default and wide."; hidden, described "Enter or a press shows it again." with the tooltip "Press to show the side panel, or drag it out."), "Show the inbox", "Message Kai", "Answer" |
| Inbox, empty | "Nothing needs you." and "No conversations yet. Talk to anyone from the talk bar." |
| Talk bar | "To Mara, CEO" (described "Change who hears it"), "To Kai and Mina, for this message only", "Who hears it", "Find someone, a room or a team", "All hands", "Say something to Mara", "Type @ to choose who hears it, / for a command.", "Who it's for. You'll see if it reaches them.", "Send it to Kai instead", "For Kai" (its remove key "Not for Kai"), "Mara gets it and passes it on to Kai.", "@ka isn't anyone's name, so it stays as words.", "Two people are called Sam, so it stays as words. Pick one from the list.", "Five match. Up and Down choose, Enter picks.", "No one called “zo”.", "Send", "Next", "Run", "Back", "Stop Kai and say what to do instead", "Stop and send", "Stop and wait", "Cancel", "Feed", "Close the feed" |
| Sending | "Sent. Mara reads it at their next step.", "Unsend", "Unsent. Your words are back in the box.", "Couldn't send: {why}.", "Sent to Kai. Couldn't send to Mina: {why}.", "Try again", "Kai left the company. To the CEO now.", "Send to the CEO instead", "Sending waits until the office is back. Your words stay.", "4,120 of 4,000. Shorten it by 120 to send." |
| Strip | "Open the feed", "Nothing said yet" |
| Feed | "Feed", "Who", "Kind", "Everything", "Your messages and replies", "Passed on", "Needs you", "Work", "Decisions", "Company", "Between people", "Show everything", "Jump to the new lines", "New lines start here", "Show earlier lines", "Earlier lines aren't kept in the office.", "3 new lines", "Show them", "Hide them", "Read all of it" |
| Boards | "Back to the office" (the mini-map: "Back to the office. Working, 4 need you."), "Filter", "Opening the org chart…" |
| Org chart | "Org chart", "18 people in five rooms. Six at work.", "Find someone" (hint "Name, title or room"), "4 of 18 match", "Hire someone", "Ask Mara to hire someone", "Hire into a room", "Fired (2)", "Rehire", "Zoom out", "Zoom in", "Fit the chart" ("Fit" under a 760 px main view), "More for Kai", "In Design", "Lena joined Content as German copywriter, reporting to Clara.", "Kai moved to Design and still reports to Ines. Ask Mara to give Kai a manager there.", "Add someone to Design", "Add a room", "Start the company"; only the CEO left: "Only the CEO is here. Tell the CEO who to hire." with "Message the CEO" |
| Commands | "Open the org chart", "Open the task board", "Open the plan", "Open the dashboards", "Open the decision log", "Open the feed", "Catch me up", "Hire someone", "Fire Kai", "Move Kai to another room", "Rehire Pia", "No command matches. Enter sends it as a message." |
| Task board | "Tasks", "Board", "Plan", "Who", "Milestone", "Find a task", "Group", "None", "Person", "Room", "Add a task", "12 of 51 tasks", "Show all", "Move" (named "Move “Cart summary”"), "Pick up", "Answer", "Resume", "Undo" (named "Undo the cancel"), "Open the plan", "And 22 more", "Cancelled, 6 tasks", "Part of: Pickup orders work", "3 of 6 subtasks done", "Tasks get here by themselves as the work goes."; lanes: "Noah, backend engineer, three tasks", "One queued, one working, one waits for you.", "Pick the person: group by person, or use Reassign." |
| Dashboards | "Progress", "Spend", "Timeline", "Decisions", "Made by the CEO", "Ask the CEO for a dashboard", "Progress, as of 14:32." |
| Phone | "Show the office", "Show more", "Filter", "Close" (the sheets), "Views" |

### What stays, what goes

- **Stays, moved into the new places:** the 3D office, its labels and moments; the lobby, the start form, first run; the
  inbox's items, Conversations and Answered; a person's panel and Details, Stop's words, the leash, model and effort;
  the trace, the decision log, the plan, the task page and its steering, the new task form, the diff, Preview,
  Customize, Settings, the proposal's panel and forms; the palette and its model; v2's room card, badges and Ask aside;
  the dashboards' widgets; the bar's Lobby, state pill, ledger and Company menu; the live region, the router's focus
  keys, Count, ChoiceButton, UndoLine, StatePill, Segmented.
- **Goes:** the tab strip and Now (the headline is the caption, Catch me up is in the feed, its groups are the chart's
  states and the board's columns); People as a desktop view and "See the chart" (it stays as the phone's outline); the
  composer page; the box in a person's panel and its "Send to more people"; drafts kept per To (`draftScope` stays,
  keyed by the company); the wide
  view and "Open wide"; Fit in the bar; "By status, By room, By priority"; `PANEL_WIDTH` and the fixed
  `DESKTOP_INSETS` (the stage takes two insets, the camera's fit and the labels' area, from the side panel, the talk bar
  and the strip).
- **New components:** the shell (view switcher, map controls, side panel with its separator and pull, docked or
  floating, board frame with the mini-map); the talk bar (the To and its picker, the lists, hint row, Stop, the compact
  rows); the live strip; the feed (`feedModel`, pure and tested: lines, threads, folds, unread); the org chart
  (`orgLayout`, pure and tested; the tree's keys; pan and zoom; papers); the task board (its columns' model, drags, the
  keyboard move, drop forms); the dashboard grid; Portrait.
- **Contract changes, the lead's:** the paged messages route, `earlierMessages` and `MessagePage` (The feed);
  `reportsTo` on a hire (`ReshapeAction`).

### Build order

1. **Addresses:** the parser and its old-address map, `?panel=`, pushing, comparing path and search; unit tests.
2. **The shell:** the bar with the switcher and toggle and the order its pieces give way in, the office with caption
   and map controls (Fit, Full screen), the side panel (its views, header, separator by drag and keys, memory, hiding,
   the pull, floating from 721 to 895 px) with today's panels moved in; the stage's insets from it; the phone layout's
   switch at 720 px wide or 480 px tall. e2e (H56) at 1440, 768 and 375.
3. **The talk bar, the strip and a first feed:** the To and its picker, `@` at the start and after the first word with
   the exact-match rule, the lists' pattern, `/` commands and their steps, history, Stop, the hint row, sends one copy
   at a time with partial refusals, the compact rows; the person's box, "Send to more people" and the composer page
   go; the strip's lines; the feed's lines in order; Send's flight (or the polish step, if the hand-off to the 3D note
   needs more). e2e (H57).
4. **The board frame and the task board:** the frame, the mini-map, Escape and Back; columns, cards as links, drags and
   their forms, Move, picking a card up with Space, filters, Plan as a sub-view. e2e (H59, H61). **Checkpoint for
   the maintainer (H65): steps 1 to 4 at 1440 and 375.** The note to him says what the feed doesn't have yet (threads, inline
   answers, filters, older lines), so his comments land where they help, and asks him to OK two choices: the talk bar
   as the one box (opening someone makes them the To only while it is empty), and `@` after the first word meaning
   "for" (decision 8). It also asks whether a Queued card dropped on Working should mean "start it now" (the maintainer said
   yes on 12 Nov 2026: it starts next, see the drop table).
5. **The feed in full:** kinds, threads, folds, filters, unread, inline answers, Catch me up; "Show earlier lines" on
   the lead's paged route, with the demo's history. e2e (H58).
6. **The org chart:** layout, nodes, the tree's keys, pan and zoom, Find, papers, hire, fire, rehire and move with their
   commands in the palette and the talk bar (and `reportsTo` on a hire), the proposal, the phone's outline. Unit tests
   for the layout at 1, 8, 18, 40 and 60 people; e2e (H60).
7. **Dashboards at full width,** Decisions in the board, Preview and the diff in the frame. e2e (H62).
8. **Portraits.**
9. **The phone together** (every step builds its 375 layout; this checks sheets, gestures, the keyboard and safe areas
   as a whole, and the short form on a phone on its side; H63) and the demo's additions (the talk loop, Ledger at 40).
10. **Every state** (H64) at 1440 and 375, and at the sizes in Every state's "Narrow and short windows", in the live
    company, the demo company and the static demo, with today's px font sizes turned into rem across the whole app (so
    the side panel's words grow with the HUD's); then the gates once on the final UI, the full e2e, and the launch
    assets (H66).

### Where this meets the visual system

`docs/design-hud.md` (the look, from the same brief) takes this section's structure, words and numbers, and this section
points to it for sizes, forms and motion. Taken from it here: one 12 px gutter (8 on phones) for every floating piece;
the company bar as a row of 44 px tiles in a 68 px band; the side panel floating one gutter in; the mini-map on the talk
bar's baseline, a 104 × 56 thumbnail where the corner is tight; nodes 216 × 80; a light landing line with an ink edge;
the 24 px pull; the caption's first sentence opening the inbox; refused columns and unmatched nodes sinking flat rather
than veiled.

Settled between the two (the lead, and the design gate of 11 Nov 2026):
- Fit shows its word everywhere: "Fit" on the office, "Fit the chart" on the chart. The corners glyph never stands
  alone.
- Strip lines come and go as The live strip says (nothing pins, the newest within a second, bursts fold, all fade after
  5 quiet minutes), and design-hud's motion row follows.
- The phone's Move sheet keeps today's words: "Reassign…" and "Cancel the task…".
- The shell's sizes: the phone layout at 720 px wide or 480 px tall, the side panel floating from 721 to 895 px and
  docked from 896 (320 px by default below 1280, 360 from 1280), the talk bar's `min(760, main view − 24)` (656 px at
  1024 with the side panel open), the compact talk bar under a 640 px main view, the views' words only under 360 px.
  The caption follows the main view's width, not the window's; a floating side panel takes its width away from
  everything over the main view but the 3D office and the talk bar. Sizes in rem, layout switches in em.
- The labels' free area ends above the whole strip. Focus is never hidden under the talk bar, the strip, the mini-map
  or the open feed: design-hud's scroll padding and placement rules.
- The separator and the pull are one control; its grip is always shown and opaque. A press steps through narrow,
  default and wide, which the accessibility review found enough for WCAG 2.5.7.
- The chart's zoom changes the nodes' form under 100% and never shrinks words under 12 px: the whole node first, down
  to 200 px (from 88%), then compact, then a chip down to the floor (40% at the least) that keeps its whole label;
  design-hud draws them
  and gives the zooms.
- The company bar and a board's head give way by measuring their own room, step by step (The shell, Boards over the
  map); design-hud gives the widths where each of the bar's steps is sure to apply.
- Zoom in and Zoom out beside Fit on the office and on the chart, over the office on phones.
- The compact talk bar's rows and keys at 375 and 320, and the short phone layout, as The phone says; design-hud draws
  them.
- The mini-map's state uses the bar pill's word. Send's flight follows the paths in Sending; its timing is design-hud's.
- Yellow means you: notes in yellow-family rooms (Content, the lead's gold) turn cream, as `docs/design.md` keeps them.
- Open (in the side panel) and focus look different on nodes and notes (design-hud).
- Where the two differed in the second round, the designers settled it together: the bar's fifth step (the ledger, the
  pill's word and Inbox's word, the inbox then starting with the spend), Actions into Company under 360 px, and the
  chart opening at 40% centred on the CEO where even the floor doesn't fit; several picks as faces in the To on phones
  and Stop's row saying "Stop Kai" came from design-hud's drawings. Nothing is left open between the two.
