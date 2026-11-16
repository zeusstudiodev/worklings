# Office design

The office is a scale model of the studio, built on a cutting mat on someone's desk. The model is the one memorable
thing on screen; everything around it stays quiet.

## Palette

| Name | Hex | Use |
|---|---|---|
| Mat | `#3E5B4E` | The stage the model stands on |
| Mat grid | `#5E7D6F` | Grid lines and ruler marks on the mat |
| Badge | `#FCFBF7` | HUD surfaces: the panel, badges, the ledger |
| Ink | `#18241F` | Text (a green-black that belongs to the mat) |
| Ink soft | `#55635C` | Secondary text |
| Highlighter | `#F2D541` | Live state, selection, gates while they run |

Departments use a wayfinding system: one hue each, used for the room floor (as a tint), chairs, shirts, list markers
and the `color` field Claude Code shows for the agent.

| Room | Hue | | Room | Hue |
|---|---|---|---|---|
| Direction | `#8E7CC3` | | Data & AI | `#3FA5A0` |
| Design | `#E58FA0` | | Quality | `#6FAE6A` |
| Art & Audio | `#E9A36B` | | Security | `#D9625B` |
| Engineering | `#5B8FC7` | | Content | `#E2BF4F` |
| Ops & Release | `#E07F3C` | | | |

## Type

Barlow, a grotesk drawn from highway signage, in two widths: regular for text and controls, Semi Condensed for
numbers and compact labels. Figures are tabular wherever they line up. Sentence case everywhere; no all-caps labels.

## Layout

```
desktop                                                    phone
+----------------------------------------------+-------+   +---------------------+
| Worklings Plant Pal (live)  tokens spend fit | Now   |   | ● live   $3.12  fit |
| the headline, unless Now is open             | Team  |   |                     |
|          the model on the mat                | Pay   |   |   the model         |
|                                              | Story |   |                     |
|                                              |       |   +---------------------+
|                                              |       |   | Now  Team Pay Story |  bottom sheet
+----------------------------------------------+-------+   +---------------------+
```

Content is left-aligned. The panel is one sheet with rows, not a stack of cards; the only card is the ID badge of the
selected person.

## Principles

1. The model is the hero. HUD type is small and calm; it never covers the building on a phone until asked.
2. Colour means department, nothing else. Yellow means "happening now" or "selected".
3. Numbers are money. Tokens and dollars are set in tabular figures with their units, and estimates say they are
   estimates ("API-equivalent").
4. Motion follows the agents. People move only when work happens; an idle studio is still and costs no battery.
   With reduced motion, nobody walks and state shows through colour and badges.
5. Everything the 3D view shows is also in the team list, which works with a keyboard and a screen reader.

## Now, Catch me up and Ask aside

v2 (SPEC.md) puts the outcome first: at any moment the office says what each person is trying to get done, for which
of your requests, whether they need you and what they reported. Now is free and live. Catch me up and Ask aside call
Haiku through your own Claude Code only when you press them, with the cost shown before and after. Everything you read
is an account of the work, never its tool calls or file reads: the Story tab and a badge's Recent work tell milestones
(see "The story").

### What a person is doing, in plain words

The office claims only what it sees; beyond a closing question mark, nothing is read into wording.

| State | When | Row says |
|---|---|---|
| On it | Working or thinking | On it for 12 min |
| Needs your OK | A permission prompt is open | Needs your OK to run npm install. Waiting 3 min. |
| Needs your answer | AskUserQuestion, an elicitation or an agent-needs-input notice is open | Needs your answer: Which chart library should I use? Waiting 3 min. |
| Has a question | The lead's last message, or a subagent's report, ends with a question | Has a question: Want me to run the end-to-end suite too? Asked 2 min ago. |
| Stuck | An error has stood for 30 s, or the turn stopped on an error | Stuck for 2 min. (The error follows on its own line.) |
| Done | It reported back, or the lead ended its turn | Done 3 min ago. (The result follows.) |

- An error that clears within 30 s reads as On it, so nothing flickers on a failed command.
- The lead's question stands until your next message; a subagent's until its lead's turn ends.
- A denied permission is a fact on the row ("Wasn't allowed to run npm install"), not a state: the agent may have
  found another way.
- The goal is a subagent's brief or, for the lead, your request (`purpose`); a subagent's `purpose` is the request it
  serves. Times on Now are coarse: "under a minute", "12 min", "1 h 5 min"; ages "just now", "4 min ago", "2 h ago".
  A replay runs on its own clock (the snapshot's time is the replay position, so pausing stops it).

### The headline

Up to three sentences, each left out when empty:

1. Who needs you. One clause per state, in this order: needs you (your OK or answer), has a question, stuck. One or
   two names per clause, then a count: "the backend engineer needs your OK", "the backend engineer and the QA
   engineer need you", "three people need you"; "the lead has a question for you" ("for you" only for the lead), "two
   people have questions"; "the mobile engineer is stuck". Clauses join with commas and ", and".
2. Who is at work and on what. The count is the top bar's At work figure. One session at work: its request, quoted as
   written (first sentence, eight words at most, "…" inside the quotes). Several: "on two requests". One person: their
   name and their own goal. Unknown request: the count alone. Everyone at work already named in sentence 1: "Nobody
   else is at work." Nobody: "Nobody is at work." ("Nobody is at work yet." before anyone has worked.)
3. The latest report: "Last report 2 min ago from the UX designer.", left out when that person is named in sentence 1.

- Counts are words from one to twelve, numerals from 13. Names: role titles through `inSentence` with "the";
  contractors as "the Explore agent"; with more than one session, "the lead in session 3f2a1c" (Team says "Lead,
  session 3f2a1c").
- It changes when a state, goal or request changes, and once a minute for the age; never on a tool call. Plain text,
  no links.

| Case | Headline |
|---|---|
| One | The lead is at work on “Add a watering streak to the home screen”. Last report 4 min ago from the UX designer. |
| Three, one waiting | The backend engineer needs your OK. Three at work on “Plan the importer”. Last report 2 min ago from the UX designer. |
| Twelve | The backend engineer and the QA engineer need you, the lead has a question for you, and the mobile engineer is stuck. Twelve at work on two requests. Last report just now from the code reviewer. |
| Only someone waiting | The mobile engineer needs your OK. Nobody else is at work. Last report 1 min ago from the copywriter. |
| Nobody | Nobody is at work. Last report 25 min ago from the lead. |

Over the scene (desktop): sentences 1 and 2 also sit as a caption at the top left of the stage, under the top bar, up
to three lines, whenever the panel shows something other than Now, so the headline is in view exactly once. Clicking
it opens Now. It is `aria-hidden` and not focusable (the panel's copy is the accessible one); the camera's fit leaves
room for it and the No studio callout moves below it. Phones get no caption: the model stays uncovered and the
headline opens the sheet.

### The Now tab

- Tabs: Now, Team, Payroll, Story; Now is first and opens by default. The Waiting for Claude Code callout moves from
  Team to Now.
- Top to bottom: the headline, Catch me up, three groups (`h3`) and a fold:
  - "Needs you": needs your OK or your answer (longest waiting first), stuck (longest first), has a question (newest
    first).
  - "On it": by session, most recently active first; its lead, then its people, newest first.
  - "Done in the last 15 minutes": newest first.
  - Everyone else folds into a closed `<details>`, "9 people worked earlier": newest first, 20 rows, then Team's line
    ("31 more. The payroll counts them all."). Roles that never worked stay on Team.
- A row keeps the Team row's marker, name and cost, then:
  1. The goal, as written. One line.
  2. For subagents: "For your request: Add a watering streak to the home screen". One line; left out when unknown.
  3. The state line, coloured as on Team (Needs you rows carry the yellow Needs you pill). Up to two lines.
  4. Done or has a question: the result, two lines (left out when it is only the question). Stuck: the error, one
     line.
  5. Quiet facts, small and muted, only when true: "Busy with one step for 4 min" (a step over a minute), "3 files
     changed", "Wasn't allowed to run npm install".
  6. An Ask button (named "Ask the QA engineer" for screen readers) that opens the conversation.
- Text is cut with an ellipsis at those line counts, and in the DOM at 160 characters (240 for a result), so a screen
  reader never reads out a pasted log.
- The name is the row's main button and the whole row is its click and tap target: a screen reader hears "QA
  engineer, button" and reads the rest as text (Team rows are whole buttons; these are too long to be one). It opens
  that person's badge for that call, with focus on the badge's title; Back returns focus to the row (or the fold's
  summary if it folded meanwhile, else the tab). The badge opens with the same lines, the result in full and an Ask
  button; its Recent work tells that person's milestones.

| Office | Now shows |
|---|---|
| Live, people at work | Headline, Catch me up, groups |
| Live, everyone done | "Nobody is at work. Last report …", Catch me up, Done if any, the fold |
| No sessions yet | "Nobody is at work yet." and the Waiting for Claude Code callout; no Catch me up |
| Replay | As live, on the replay's clock; the 15 minutes are replay minutes; no announcements |
| Demo | As live, from the looping script; Catch me up and Ask give samples |
| Disconnected | The last view with its clock stopped, under "Reconnecting to the office. This is how things stood at 14:32." Catch me up and Ask wait, with the same note |
| Locked | Live and replay show the access link screen; a demo opened without its link shows the locked copy in Catch me up and Ask before anyone presses |
| 50 people, several sessions | Every person at work has a row, Needs you on top; leads are "Lead, session 3f2a1c" |
| Phone, 375 px | The sheet opens at half the screen (was 36%), so the headline, Catch me up and a first row show; Show more still takes it to 78% |

- Keyboard: tabs, Catch me up (and Cancel while it runs), the earlier catch-ups summary, then each row's name and Ask,
  the fold's summary and the rows inside it. Nothing moves focus unasked.
- Screen reader: one polite, visually hidden live region for the office. It says only: someone starting to need you
  ("The backend engineer needs your OK."; live and demo; several within 10 s in one sentence), "Your catch-up is
  ready.", a question sent ("Question sent to the QA engineer.") or turned down (its refusal copy), answers and failures. Not live: the headline, rows, bubbles, counters, elapsed seconds, and the badge's
  status section (aria-live today, so it reads out every tool call: drop that).
- Reduced motion: nothing on Now or in the conversation animates; rows don't slide when they reorder; a running call
  shows a still yellow mark and counting seconds.

### Bubbles over people

Bubbles say the outcome, not the tool call (`bubbleFor` in `web/src/scene/cast.ts`). One line, cut at a word to fit
(about 28 characters, 22 on phones) with "…". When several apply, the first row wins; during a meeting its lines take
over, except Needs your OK and Needs your answer. Bubbles may pass over room signs; a sign one cuts through (a third
of its height across a third of its width) hides until it moves on rather than show a fragment, and a sign gives way to
a yellow bubble wherever they meet. A label
near the side of the screen moves in until it fits, keeping its line over its person; on phones a running gate's label
is one line, its name alone. The lower a bubble ends on screen, the higher it lies, so a line
down from a lifted bubble never crosses another's words; while someone walks, lifts change without easing.

| Person | Bubble |
|---|---|
| Needs your OK or your answer | "Needs your OK to run npm install", "Asks you: Which chart library…"; yellow |
| Answering one of your questions | "Answering you…", yellow; then "Answered you" for up to 2 min while their conversation is closed |
| Stuck | "Stuck for 2 min", in the error colour |
| Has a question | The lead: "Asks you: Want me to run the…"; a subagent: "Asks the lead: Should it repeat…" |
| Reporting back | The report's first sentence after an ink check mark (no fill: green means on it in the panel), with a capital, through the meeting and 8 s after |
| The lead, turn done | The first sentence of its last message after an ink check mark, until your next message |
| On it | The goal in a few words ("Design the streak card…") after a small dot that pulses while a step runs and stays still between steps (always still with reduced motion). No goal known: "On it" |
| Off duty | None |

### Meetings: briefs and reports

When the lead briefs someone, and when someone reports back, the two meet at the lead's desk.

- The subagent walks to its own lead and back; the lead stays at its desk and turns to face them. Desk people start
  from their desk; a role's extra copies and contractors start at the lobby door, and contractors leave through it
  after reporting.
- Up to four meet at once, in an arc in front of the desk; beyond four, the rest don't walk and their bubbles carry it.
- Timing: the walk takes 0.8 to 2 s by distance, they stand together for 2.5 s, then walk back; a new meeting
  mid-walk turns them around. Under 6.5 s in all.
- Brief: the lead's bubble says the goal and the subagent's says "On it". Several briefed at once: the lead says
  "Briefs three people" and each subagent shows its own goal. Report: the subagent's bubble says the report's first
  sentence; the lead keeps its own bubble.
- Never in the way of real work: bubbles, rows and the headline follow the snapshot throughout, and someone who needs
  you mid-walk turns yellow and keeps walking. The camera never moves for a meeting.
- Nobody walks with reduced motion, in replays faster than 4x, for events more than 5 s old when they arrive (an
  office opened mid-session) or for people with no figure. Bubbles alone carry it: the lead's brief for 2.5 s, the
  report at the desk for 8 s.

### The story

The Story tab (it was the Log) and a badge's Recent work tell what happened as milestones, newest first (`storyLines`
in `src/core/story.ts`). Tool calls, file reads, searches, commands, a failed command the agent works around, a
background task finishing and compaction are the log's steps: Catch me up's account reads them, the story never shows
them, and snapshots carry only milestones.

| Milestone | Line |
|---|---|
| Your message | "You asked: Add a watering streak to the home screen…"; under four words, "You replied: yes go on". With several sessions, "You asked the lead in session 3f2a1c: …" |
| A brief: an Agent call and its subagent's start, or a SendMessage that continues a subagent | "The lead briefed the UX designer: Design the streak card…", one line for the call and the start. Task unknown (the office missed the call): "The lead briefed the QA engineer" |
| A report | "The UX designer reported back: Spec in docs/streak-card.md…"; one that ends with a question: "The QA engineer reported back with a question: Two fail. Retry?" |
| The lead's last word | "The lead finished: The streak card is in…"; with a question: "The lead finished with a question for you: Built it. Want the docs too?" |
| A permission prompt | "The mobile engineer asked for your OK to run npx expo install expo-haptics" |
| AskUserQuestion | "The lead asked you: Which chart library?" |
| Claude Code waits for you | "The lead needed you in Claude Code: …", left out when it is a permission prompt's own notice (within 5 s) |
| A denied permission | "The backend engineer wasn't allowed to run npm publish" |
| A failed turn | "The lead stopped on an error: API Error: overloaded" |
| A gate | "The UI designer ran the design gate" |
| An agent-team task | "The lead added a task: Write the parser", "The backend engineer finished a task: Write the parser", once each |

- Past tense, so a line stays true after you answer; who needs you now is the Now tab's job.
- A line: the marker of whoever starts it (yours in ink), who did what in 14 px (names in 600, each other person a
  `.link` button that opens them), the time on the right in 12 px ink-soft ("14:32"), and under it what it was about:
  your words in italic, an error in the danger colour. Text goes through `plainText`, is masked again (a Markdown mark
  can hide a secret's shape) and is cut at 160 characters, 240 for a report or a last word.
- Names as the office says them (`nameInSentence`). Someone the office let go of keeps the name the log gave them,
  without a button.
- Recent work: the lines about the badge's people (a brief is both the lead's and the subagent's); their own names are
  plain text there. Empty: "Nothing recent to tell." The tab, empty: "Nothing to tell yet. Requests, briefs, reports
  and questions show up here as they happen."
- The log keeps 300 steps and 200 milestones apart, so tool calls never push the story out; a snapshot carries the
  latest 120 milestones.
- Keyboard: the tab, then each line's name buttons in order. Screen reader: an ordered list, each line its sentence
  and then the time; nothing in it is live.

### Catch me up

The button sits under the headline with one line under it, and the newest digest under that; the button never moves.

| State | Shows |
|---|---|
| Ready | "Covers 13:32 to now. About 1¢ on Haiku." The start is the latest of your last catch-up, an hour ago and the first thing the office saw. The estimate comes with each snapshot, so every tab agrees |
| Nothing new | The button is unavailable (`aria-disabled`, still focusable): "Nothing new since your last catch-up at 14:32." or "Nothing happened in the last hour." No call is made; if the server is the one to find out, the same line comes back |
| Running | Button unavailable; "Haiku is writing your catch-up, 12s so far." with a yellow mark and Cancel; from 30 s, "It stops at 60s." Every tab shows it and can cancel it |
| Done | Heading "Your catch-up from 13:32 to 14:32", the digest, then "Written 12 min ago for 0.4¢ on Haiku." The next one takes its place and the two before fold under "2 earlier catch-ups"; all go when the office restarts |
| A question is running | Button unavailable; the question's running line, with its Cancel |
| Cancelled or failed | "Cancelled." or the failure copy, until the next call; the button is ready again |
| Demo | "The demo makes up its catch-ups, so they're free." Running lasts two seconds; a scripted sample picked by where the loop is, headed "Sample catch-up" and signed "Made up for the demo. No call to Claude Code." |
| Replay | "Covers the replay from the start to 3m 20s." (or from your last catch-up in it); heading "Your catch-up on the replay up to 3m 20s"; switching the replayed session clears the digests |

- The digest is 3 to 6 plain sentences, outcome first: what got done and for which request, who needs you or has a
  question, what is stuck, what is still going. Names as the office says them; no paths, commands or tool names unless
  they are the result; no Markdown.
- Money: estimates "Less than 1¢" (under half a cent), "About 2¢", "About $1.20"; costs as Claude Code reports them,
  "0.4¢" under 10¢, then "14¢", then "$1.20".
- Focus stays on the button while it runs; the arrival is announced and focus doesn't move. If Cancel had focus when
  the run ended, focus returns to the button.

### Ask aside: a conversation in the scene

- An Ask button opens it from three places: the name tag of the selected person in the scene (clicking a person still
  only selects them), their badge and their Now row. "Ask", not "Talk": in v2 people answer but can't act on it.
- It doesn't change the panel: Now stays Now and an open badge stays open. The person you're asking gets the yellow
  ring.
- Desktop: a non-modal popover by the person, like a speech bubble (about 320 px wide, up to 560 px tall; the thread
  scrolls and the box stays at its foot), placed by the label layer and kept inside the stage. If the person or the
  popover at its full height would be off screen or under the panel, the camera pans just enough to show both (no
  zoom; instant with reduced motion), then stays put, so the popover grows downward as answers come in. If you pan
  away later, the popover follows its person and clamps to the stage edge. If its person leaves the scene (a
  contractor out of the lobby door), the conversation takes the panel's place, with its draft; focus follows if it
  was inside.
- Phone, 375 px: a popover by the person leaves no room for the model or the keyboard, so the conversation fills the
  sheet (78%, full height while the keyboard is up) with the person's name and Back, and the camera pans the person
  into the strip above. Without WebGL, or for a person with no figure (a fourth copy of a role, a contractor beyond
  the lobby's seats), it takes the panel's place the same way at any width. Check the keyboard on a real iPhone.
- Focus goes to the box when it opens on a desktop, and to the heading on a phone, so the keyboard doesn't cover the
  thread until you tap the box. It closes with Escape (focus inside it), its Close button, a click on the
  scene outside it (another person: selects them; the mat: also clears the selection) or Back on a phone; clicks in
  the panel don't close it. Focus returns to the Ask button that opened it, and an unsent draft is kept for next time.
  One conversation at a time.

Top to bottom:
1. "Ask the QA engineer", Close, then "About 2¢ on Haiku for each answer." (from `contextTokens` for the lead, the
   transcript excerpt's size for a subagent, at Haiku's price; with nothing to size it, "The cost shows with the
   answer."). A role with several calls adds "Questions go to its call from 14:02."
2. The thread, oldest first, the last three answered exchanges: your question as your bubble on the right, in ink; the
   answer, in the first person, as their bubble on the left in their hue, signed "2 min ago, 0.6¢ on Haiku"; the
   office's own lines (running, cancelled, failures) as plain notes between them. Each entry starts with a visually
   hidden speaker ("You", "QA engineer", "The office"). Answers belong to a role across its calls, to the lead per
   session and to a contractor per call.
3. Suggested questions that ask at once: "What are you working on?", "What's left?", "Is anything blocking you?".
   They wrap, and are 44 px tall on phones.
4. "Or ask your own question": a two-row box that grows to five; Enter asks, Shift+Enter starts a new line. Under it,
   "Answers come from a read-only copy of the session and never interrupt it." and "120 of 500". Over 500: "520 of
   500. Shorten it by 20 to ask." in red, Ask unavailable, nothing cut.
5. Ask.

| State | Shows |
|---|---|
| Running | Your bubble joins the thread and the box clears (the next question can be typed). A pending answer bubble reads "The QA engineer is answering, 6s so far." with Cancel; from 30 s, "It stops at 60s." Ask and the suggestions are unavailable (`aria-disabled`, so focus stays put). Every other conversation and Catch me up show the same line with Cancel. Once Cancel is pressed the line reads "Cancelling…" with a still mark and Cancel unavailable until the call is gone: stopping Claude Code takes a second or two |
| Answered | The pending bubble becomes the answer, announced as "The QA engineer answers: …"; focus stays where it is |
| Failed or cancelled | Under your bubble, the office's line ("Cancelled." or the failure copy) and Ask again, until the next question. If Cancel or Ask again had focus when it went, focus goes to the box |
| Hasn't worked yet | Instead of the controls: "You can ask the docs writer once it has worked in a session." |
| No transcript | Instead of the controls: the no-transcript copy |
| Demo | "Answers in the demo are made-up samples, so they're free." Suggestions get a scripted sample per person; free text gets "This is the demo, so I can't really read your question. In a live office I'd answer from my own session." Each is signed "Sample answer, made up for the demo." |
| Replay | Line 1 adds "From the session as it stood at 3m 20s." and answers are signed with their position |

- Answers: first person, one to four sentences, about the goal, what's left and what's in the way; "I don't know" when
  the context doesn't say; no step-by-step narration. A new answer scrolls into view only if the thread was at its end.

### Failures

Ask starts with "Couldn't get an answer." and Catch me up with "Couldn't write your catch-up.", then:

| Code | Copy |
|---|---|
| not-installed | Worklings asks through your own Claude Code and couldn't find it. Install Claude Code, or set WORKLINGS_CLAUDE to its path, then restart the office. |
| not-signed-in | Claude Code isn't signed in. Run `claude` in a terminal, sign in, then try again. |
| timed-out | Claude Code took more than 60 seconds, so the office stopped it. Try again. |
| limit | You've reached your Claude usage limit. It resets at 15:00. (Reset time unknown: "Try again when it resets.") |
| too-long | The lead's conversation is too long for Haiku. Ask it with /btw in Claude Code instead. (Lead only: Catch me up trims its account to fit, and its heading says what it covers.) |
| bad-output | Claude Code sent back something the office couldn't read. Try again, or update Claude Code if it keeps happening. |
| failed | Claude Code stopped with an error: {its first line}. Try again. |
| busy | The office is already on a question or a catch-up and does one at a time. Wait for it or cancel it. |
| rate-limited | The office takes a few calls a minute. Try again in 40 seconds. (Unknown wait: "in a minute".) |
| no-transcript | The office can't find the QA engineer's transcript on this machine, so there's nothing to answer from. |
| locked | Open the office from the link the CLI printed. It carries the access token. |
| office unreachable | The office didn't answer. Is it still running? |

- Busy, locked and nothing new show before anyone presses when the office already knows; this copy covers races.
- Calls that never reached the model cost nothing. Timed-out and cancelled calls count at their estimate in The office
  line, since Claude Code doesn't report what they used.

### The office's own spend

- A payroll line "The office", pinned under the roles (its own row after a rule, never sorted among them), shown from
  the first call. Sub-label "3 questions and 1 catch-up"; tokens and cost as Claude Code reports them; share like any
  line. It counts in the payroll total and the top bar, so no figure leaves it out. No badge: the name isn't a button.
- Demo: samples count at $0 ("2 samples, free"), so the demo shows where the line sits. Replay: real calls, counted.

### What the reducer still needs

Beyond `purpose`, `statusSince`, `reportedAt` and `contextTokens`:
- A message under four words ("yes", "go on") leaves the lead's `purpose` as it was.
- The question a turn or report ends with, kept before the 200-character cut, and the question an AskUserQuestion
  asks (without it, the row says "Needs your answer in Claude Code").

### Visual details

Catch me up and the conversation use the scales already in `styles.css`. Text: 12 px for signatures and counters,
13 px for meta lines, notes and chips, 14 px for the digest and the thread, 19 px Semi Condensed for the
conversation's title. Spacing in 4 px steps. Radius: 8 to 10 for controls, 14 for chat bubbles, 16 for the popover,
999 for chips. Times, counts and money in tabular figures.

- Control edges (the box, suggestion chips) are 1.5 px `--ink-soft`, 6.3:1 on white. `#cfc9bc` is 1.65:1, under the
  3:1 a control's edge needs, so it stays for decorative rules.
- Unavailable controls (Catch me up, suggestions, Ask, Ask again) keep full opacity: `--ink-soft` text, a
  `--badge-line` edge, `cursor: not-allowed`. Opacity 0.45 takes ink to 2.8:1; the line beside them says why they wait.
- The running mark is the 8 px highlighter dot with its soft halo, pulsing like the live dot (`pulse`, 2.4 s) and
  still with reduced motion. The words beside it carry the state; their seconds are tabular so the line doesn't jitter.

Catch me up
- The outline `.button` (secondary, so the headline stays the one focal point) 12 px under the headline, its line
  6 px under it, the newest digest 12 px under that.
- The digest has no card: a 3 px `#cfc9bc` rule on its left, 12 px in; heading 14 px/600, text 14 px/1.45 in ink,
  signature 12 px ink-soft.
- Phones: the half sheet still shows the first row under a digest, so the digest clamps to three lines with "Read all
  of it" (a `.link` with a 44 px target) that opens it in place. The button is 44 px tall.

The popover (desktops)
- 320 px wide and up to 560 px tall, or the free area's width and height where those are smaller, badge fill, radius
  16, `--shadow-panel`, padding 16 px. It sits above the labels and stays 12 px inside what the top bar and the panel
  leave free; it may cover the caption. On screens under 600 px tall (200% zoom, a phone on its side) the thread keeps
  its height and the whole conversation scrolls, so the box and Ask stay in reach; the sheet does the same.
- Beside the person, never over their own label: its top 4 px below the foot of their label (bubble and name tag),
  28 px to their right, or to their left when only that side has room. It changes sides only when the other side has
  room and this one lacks 24 px, so it doesn't flicker while you pan. Held up by the foot of the stage, it would cover
  their label: it moves along its side until it clears it, as far as the free area allows.
- The tail is a 16 px square turned 45°, badge fill, 7 px of it outside the edge that faces the person, its middle
  20 px below the popover's top so it points at their head. A clamped popover slides it along that edge (a `--tail-y`
  kept 20 px from the corners); with the person more than 20 px outside the popover's span it hides, and the yellow
  ring alone marks them.
- It opens with a 150 ms fade and a 4 px slide from the person's side (opacity and transform), at once with reduced
  motion.

The thread
- Bubbles in 14 px/1.4, padding 8 by 12 px, up to 88% of the thread's width (92% on phones), radius 14 with the corner
  toward the speaker at 4 px; 12 px between exchanges.
- Yours, on the right: ink fill, badge text (15.5:1).
- Theirs, on the left: `color-mix(in srgb, var(--hue) 24%, #fff)` with ink text, 12:1 or better in every room colour.
  Never the full hue: ink on Direction and Security is 4.4:1. At 24% the lead's and Content's tints stay cream, so
  yellow still means now, selected and needs you.
- Pending: their bubble with the running mark and ink-soft text (4.7:1 or better on every tint; Security's is 4.76:1).
- The signature sits under the bubble, outside it: 12 px ink-soft. The office's lines have no bubble: 13 px ink-soft;
  a failure is in ink with its first sentence in 600, then Ask again as a `.link`.

Controls
- Suggestions wrap 6 px apart: 13 px/500 ink on white, padding 5 by 11 px, 32 px tall (44 on phones), control edge.
- The box: white, control edge (ink while focused, with the focus ring), radius 10, padding 8 by 10 px, Barlow 14 px
  (16 on phones, or iOS zooms in), two rows growing to five. Under it the hint (12 px ink-soft) and the counter (12 px,
  danger and 600 when over) share a line. Ask is the primary `.button`, on the right.
- Ask on the name tag: badge fill, ink text, 24 px tall; not yellow, which the tag already uses for the cost and the
  scene for needs you. The tag's title cuts at 200 px with "…" so the cost and Ask always show. Phones leave it out:
  the badge in the sheet has Ask.
- Ask on a Now row: a `.link` at the end of the row's last line, 24 px target (44 on phones), so a long Done group
  isn't a column of outlined buttons.

Phones
- The conversation sheet: Back (44 px tall) and the title on top, the thread, the controls pinned at the foot above
  the safe-area inset. The sheet's handle hides while it is there (it holds the sheet at 78%); Back closes it.
- At 78% (Show more, a badge, a conversation) the strip above is a thumbnail: no room signs, gate labels or bubbles
  except the selected or asked person's and anyone who needs you. At half height a stack holds three bubbles at most,
  the most important first, and no bubble rises under the top bar.
