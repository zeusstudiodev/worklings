# Game feel: the office that runs the company

The 3D office's moments in Worklings v3 (SPEC-v3.md): trigger, timing, priority, phone, reduced motion and cost. The
panels and their words are in `docs/design-v3.md`; v2's bubbles and meetings (`docs/design.md`) stay unless changed
here. Reception is the office's front room, the lobby the hub's view of companies; clips are KayKit's and Mesh2Motion's.

**Fantasy:** my company is busy building my thing, and it comes to me when it needs me. **Verb:** decide (answer,
approve, steer). Seconds: a glance at lit desks, walkers and the front desk. Minutes: a decision, or a word to someone
and watching it travel. Hours: a milestone, a hire, a night's rest. No tutorial: each moment's bubble says what it is.

## Rules for every moment

- **Truth first.** Every moment starts from a state change in the snapshot and runs on its clock in the cast
  (`web/src/scene/cast.ts`, pure and unit-tested like v2's meetings). Nobody wanders: a person who moves is doing
  something real. Bubbles, rows and counts follow the snapshot throughout. Postures never change per tool call.
- **The ladder**, highest first: 1 needs you (the front desk), 2 carrying your words, 3 reports going up, 4 other relays
  and meetings, 5 hires, fires and office changes, 6 celebrations, 7 ambient. A higher moment interrupts a lower one at
  once (a walker turns where they stand, v2's glide); a lower one waits up to 5 s for the person, then falls back to
  notes and bubbles. Night (section 4) is a company state above the ladder.
- **Walk budget:** 6 at once on desktops, 3 on phones, 2 of them kept for rank 2; walks to the front desk don't count
  (it has 6 places). Over budget, a moment keeps its notes and bubbles and drops the walk.
- **Nobody walks** with reduced motion, in replays faster than 4x, for events over 5 s old when seen, or for people with
  no figure (v2); a moment that ends in a place that carries state (the front desk, a new desk, gone) just puts them
  there. **The camera is yours:** no moment moves it, beyond v2's Ask pan and section 6's eased re-fit.
- **Frame tiers.** Still (nothing animates): render only on a snapshot, a label change or camera input. Ambient (people
  at work at their desks, nobody walking): 30 fps on desktops, 20 on phones. Motion (walks, transitions, celebrations,
  camera input): 60 and 30 fps, back to ambient 500 ms after the last motion.
- **Reduced motion:** nobody walks or animates, so the office stays still. Places that carry state cut (the front desk,
  arrivals and departures, night); flourishes drop (walk-overs, rounds, meetings, claps, streamers, desks dropping in).
- **Phones (375 px):** people are 4 to 8 px tall at the default fit (v2's big studio), so light, floor colour and the
  label layer carry the office and the panels lead. The lighter mode: no post-processing, pixel ratio up to 1.5, walk
  budget 3, half the particles, 22-character bubbles (v2). The governor (over 33 ms a frame for 2 s) cuts particles,
  the walk budget to 2, ambient to 15 fps, then animation under 16 px tall; never the front desk or anything yellow.
- Papers, cups and plants are drawn 1.5 times life size. Yellow stays yours: needs you, your words, your selection. No
  sound in v3: the office sits open beside work for hours, and the inbox count reaches the phone.

## 1. Relays: walking over to tell someone

**Trigger:** a message between two people with figures: `message`, `relay`, `assign` (a task and its brief), and `ask`
or `report` up to the manager; rank 2 when it passes on your words, 3 for reports, 4 otherwise. **The sender walks to
the receiver's desk**, down or up (v2 always walked the subagent to the lead). Yours have no walker: they land as notes.

- **The note is the truth.** A message not yet taken is a paper in the receiver's desk tray, **yellow when it passes on
  your words** (the switchboard's "passing on from the maintainer"), else white. It goes when they take it at their next step,
  with a Head Nod (0.8 s); if they took it before the walker arrives, the hand-off is just the nod. Notes need no walk
  and work in reduced motion and at night; a tray shows three papers, then a thicker stack.
- **On the way** the sender holds the note at chest height (an arm layer over Walking_A, made like the typing layer)
  under a bubble saying what it is: "**From you:** Make the palette darker", an assignment's title, v2's check mark and
  first sentence for a report, else the first words.
- **Pace:** 3 units a second (1.5 m/s), Walking_A's time scale matched so feet don't slide; routes over 6 s speed up to
  fit, at most 7.5 units a second (v2: 7), else no walk. Bursts leave 300 ms apart; walkers may pass through each other.
- **At the desk** the sender stands at the visitor spot beside the chair, Idle_Talking for 2.5 s (v2's stand), and puts
  the note in the tray 1.5 s in. A working receiver keeps typing and turns their head (up to 60°); an idle one turns
  the chair (up to 45°). Receiver away: the note goes in, no stand. A second sender waits a step behind, 3 s at most.
- **Your words travel at the company's pace**, each hop a real event, in order: someone whose relay starts while a note
  for them is on its way leaves when it lands (at most 6 s late). "Make the palette darker" to the CEO is a yellow note
  on the CEO's tray, the CEO walking it to the head of design, then the head to the UI designer (AC3).
- **Many at once** (one sender, one message, within 2 s): several receivers make a round, nearest desk next, 1.5 s at
  each, up to 4 stops and 15 s; three or more in different rooms, at least two idle, make a meeting (section 6). The
  rest get notes; a sender who visits nobody says "Sent notes to five people" for 2.5 s.
- **Phone:** budget 3, the rest are notes. **Reduced motion:** the note appears at once and the receiver's bubble reads
  "From Ada: Darker palette…" for 4 s ("From you:" for yours; names as design-v3.md gives them).
- **Cost:** a walker is a full-rate mixer and a position per frame for a round trip of 8 to 15 s, on v2's cached A*
  routes; a company's first assignments hold the motion tier while they last. All notes are one instanced mesh.

## 2. The front desk: someone waiting with a paper

**Trigger:** a new inbox item: an approval, a question (`ask_stakeholder`), or the CEO's proposal waiting for your OK.
The figure is the item's `from`; rank 1. Visitors never queue: their prompts are in their own Claude Code, so their
yellow bubble stays in their seat.

- **Where:** the front desk at reception's front edge, facing the camera. Waiters stand behind the counter facing you, a
  **yellow paper** at the chest: facing the camera means "with you". The default fit keeps it in view at every width
  and above the phone's sheet.
- **How many:** 6 places, 3 at the counter and 3 behind; the oldest in the middle, then left, right, then the second
  row. A seventh stands at their own desk with the paper raised and walks over when a place frees. Several items from
  one person: one place, a thicker stack.
- **Timing:** the walk starts with the item (in the inbox within a second) and fits 6 s like any walk. At the counter
  they hold one still Holding frame, so a queue waits for hours at no cost (6 still figures, one label). **Waiting
  never escalates**: no foot-tapping, sighs or red, however long; the inbox shows the times.
- **Words:** v2's bubbles for the three at the counter ("Needs your OK to push to GitHub", "Asks you: Which payment
  provider…"), none for the second row; the desk's sign is design-v3.md's label-layer button ("Front desk, 3 need
  you"). A waiter, their paper or bubble opens their item in the inbox and rings them yellow; the sign, the oldest.
- **Answered:** the paper flips to white (0.25 s) with a nod; they leave when the hub sends your answer 5 s later (Undo,
  in design-v3.md, flips it back to yellow); the line steps up, 0.5 s a place. Withdrawn or timed out: white, no nod.
- **Phone:** the sign is the 44 px target; only the first waiter's bubble shows at half height; the sign stays on the
  78% strip. **Reduced motion:** a cut to the counter and back. **Night:** the desk lamp stays on over the waiters.

## 3. A milestone's small celebration

**Trigger:** a milestone (`set_goal`) turns done and is seen within 5 s; rank 6. Missed ones aren't replayed.

- **What:** in the meeting room its card on the milestone board flips to done (0.4 s; flipped cards stay, a progress bar
  on the stage) and 24 paper streamers fall from the board for 1.6 s, in the hues of the rooms that worked on it. Its
  task owners and their managers who are idle stand (Sit_Chair_StandUp, 0.8 s), clap (Clapping, 2 s) and sit (0.8 s):
  3.6 s. An idle CEO does a Victory Fist Pump (2.2 s). The goal's last milestone: 48 streamers, and everyone idle claps.
- **Never in the way:** anyone working, walking, waiting or meeting carries on; no bubble changes, the camera stays, the
  board is off every route. One celebration per 20 s; a milestone inside that window flips its card quietly.
- **Phone:** 12 streamers, 6 clappers at most. **Reduced motion:** the card shows done at once; no claps or streamers.
- **Cost:** 3.6 s in the motion tier; the streamers are one instanced mesh moved in the vertex shader.

## 4. Tiredness, and night

**Tiredness. Trigger:** a person's context (`contextTokens`) against the point where Claude Code compacts on their model
(its window minus Claude Code's buffer, recorded per version in `docs/claude-code-surfaces.md`); rank 7.

| Level | From | You see |
|---|---|---|
| Fresh | under 50% | Nothing |
| Busy | 50% | One takeaway coffee cup on the desk (not a mug: `mug` is a look prop in `src/core/looks.ts`) |
| Long day | 75% | Two cups; a slight slouch (spine 10°, head 6° forward); the typing animation at 0.85 speed |
| Spent | 90% | Three cups; a deeper slouch (spine 18°); typing at 0.75; between steps, head on a hand |
| Compacted | context falls by half | The cups go (0.3 s) and the posture resets; no bubble |

- **It tells you** they are deep in a long stretch: each step re-reads more and costs more, and soon they will
  summarise their notes and may lose detail. A spent person about to start something new is a reason to ask their
  manager for fresh hands; "Context used" is in their panel. Never an alarm: no colour, badge, bubble or sound.
- **Phone:** too small to read; the panel has it. **Reduced motion:** cups and a still slouch. **Cost:** nothing per
  frame (one instanced mesh for the cups, pose weights for the slouch).

**Night. Trigger:** the company rests on a usage limit or an overload ("Resting until 14:00"). Never the clock: light
means work, so there is no day-night cycle. Paused or stopped by you is not night: people finish their step and rest at
their desks, monitors dim.

- **Falling:** walks finish (6 s at most) and celebrations stop. Over 2.5 s the light dims to about 30% and cools to
  blue, the mat with it (the lamp over the model goes off); monitors go dark one by one within 1 s; people lay their
  heads on folded arms (a pose authored like the typing layer, 1.2 s, staggered up to 1.5 s). Then every mixer stops.
- **One light stays:** the front desk lamp, a warm pool over the waiters and their yellow papers; a label over the door
  says what the top bar says. Clicks and messages still work: notes land in trays, answered waiters go back to rest.
- **Morning** comes when the company resumes, not at the clock time: the light rises over 2.5 s, heads lift (0.8 s,
  staggered up to 1.5 s), and each monitor lights as that person's desk reopens.
- **Phone:** the same. **Reduced motion:** night falls and lifts at once. **Cost:** 2.5 s of motion, then nothing, the
  cheapest state there is. Baked furniture shadows fade with the light; nothing re-bakes.

## 5. The lobby's small worlds, and themes

The lobby's panel, signs and phone list are in `docs/design-v3.md`; this is what each small world shows.

- **A world**: the company's building in its theme on its own base board on the mat, roof on, in a place it keeps. A
  window per person (up to 24) **lit while they work**, so busy companies glow; a figure with a yellow paper at the door
  when someone needs you; dark but for the door lamp while resting; a pennant on the roof for 30 min after a milestone.
- **Entering** lifts the roof and lowers the front walls to knee height as the view closes in (600 ms); leaving puts it
  back; reduced motion: a 150 ms crossfade. Phones have no 3D lobby: each row shows its theme's 56 px still.
- **Cost:** one scene; each world static, 2,000 triangles at most, windows lit by instance colour (not lights), the door
  figure a posed static mesh. It renders on change only: a window fades in over 1 s, and nothing else moves.

**Themes** (`THEMES` in `src/core/looks.ts`): the CEO picks from the prompt and the domain (games: game studio; AI and
data: lab; else classic office, unless the prompt is about a café, a shop, a garden, a place or music), and you change
it by talking (rank 5), for the office or one room. A theme owns floors, walls, decor, the front desk's form and the
outside; **a department's hue stays** on a rug under its desks, on chairs and on shirts. It reads from its floor
(pattern and lightness, not hue alone), its front desk (same place, six places) and one hero piece by the door.

| Theme | Picked for | Floor | The front desk is | Hero piece | Outside, in the lobby |
|---|---|---|---|---|---|
| Classic office | everything else | pale carpet tiles | a reception desk | water cooler, coat rack | brick block, rooftop unit |
| Café | food and drink | black and white checks | the espresso counter | chalkboard menu, pastry case | striped awning, two tables |
| Game studio | web and engine games | dark boards | a counter under the studio's mascot | playtest sofa and big screen, concept boards | a block with a big controller sign |
| Shop | stores and marketplaces | light oak | the till | parcel shelves, packing bench | shop window, Open sign |
| Lab | AI apps, data and ML | white tiles, blue lines | a badge desk | server rack, LEDs blinking only while someone works | white block, roof dish |
| Garden | plants, growing, outdoors | grass, a stone path | a potting bench | greenhouse arch, planters | a greenhouse |
| City | travel, maps, local services | street tiles round the rooms | a kiosk | bus stop, street lamps | corner building on a street |
| Arcade | games rooms, retro games | dark carpet, star pattern | a prize counter | a row of arcade cabinets, neon | neon sign over the door |
| Music studio | music, audio, podcasts | dark wood, rugs | a gear counter | mixing desk, speakers, vocal booth | brick, a big record sign |

KayKit's free tiers lack the water cooler, arcade cabinets, server rack, parcel shelves, chalkboard, greenhouse arch,
kiosk and studio gear, so they are modelled here; garden and city need Forest Nature and City Builder Bits (free tiers)
imported first. A theme loads on demand while the old one stays, then rooms swap (300 ms each, 120 ms apart).

## 6. Hiring and firing, the CEO's office, the meeting room, the screen

- **A sticky floor plan**, learned once: a room keeps its place and has one free desk (two over six people); a hire
  takes the first free desk in its room, a firing leaves one, a room grows only when it has none, and new rooms join at
  the edge (`studio.yaml`'s office section records the places). Heads sit nearest their door; the front strip holds
  reception (front desk, visitors' seats), the CEO's office and the meeting room.
- **Hiring** (`hire`, `rehire`, a company starting; rank 5): a new desk drops in (0.4 s, a squash on landing, six dust
  puffs); the person walks in through reception with a small plant in a pot of their room's hue ("**New:** German
  copywriter"), sets it on the desk (Interact, 1.3 s) and sits (0.8 s). It stays; a rehire brings it back to the desk.
- **A company starting** is those rules, not a script: rooms build in (floor 0.3 s, walls 0.3 s, furniture 60 ms apart,
  rooms 150 ms apart), then people arrive 0.7 s apart, heads first, room by room, within the walk budget: about 20 s for
  20 people. A click on the stage, or Escape, seats everyone at once. Phones: everyone fades in, 150 ms apart by room.
- **Firing** (`fire`; rank 5): they stand (0.8 s), pick up their plant (PickUp_Table, 1 s), walk out through reception
  ("Leaving"), wave at the door (1.2 s of Waving) and fade at the model's edge (0.4 s); cups and notes go, the desk
  stays free. Undo turns them back from wherever they are. Reversible, not a punishment: no tears, no boxes. **Handed
  over** to Claude Code: they walk out without the plant or a wave, and back in when brought back.
- **Office changes** ("add a games room") build in the same way, the office manager (if any) walking over to stand by;
  removing a room walks its people out, then lifts its furniture and lowers its floor (about 2 s). A change outside the
  view eases the fit to include it (600 ms), unless you've moved the camera since the last fit.
- **The CEO's office:** the CEO wears v2's lead gold (`#C9B458`) as a blazer; the org board has a pin per person in
  their room's hue, by level, popping in or out with hires and fires (0.3 s). A new company starts here: the CEO walks
  in and draws on the board while drafting (a box every 3 s, up to 8, until the proposal comes), then brings it to you.
- **The meeting room** (rank 4): one message to three or more people in different rooms, two of them idle. The sender
  stands at the head of the table; idle receivers walk over (6 at most, nearest first) and listen (Idle Listening, a
  Head Nod every 2 to 4 s) for 4 s from the last arrival, or from 3 s after the first if sooner. **Busy people never
  leave their desk for a meeting**: they get the note. The CEO briefing idle heads at the start is the usual case.
- **The screen**, on the meeting room's back wall beside the milestone board, faces the camera, the brightest thing in
  the office: on desktops the live app once the whole screen is in view and at least 240 px wide (AC6 asks for the app
  on the office screen; below that size an iframe is illegible and only costs a second page), otherwise and on phones
  the latest shared screenshot (0.3 s crossfade), else the company's name on a plain card; dark at night; it and its
  "Preview the app" button open Preview. Cost: build-ins and arrivals hold the motion tier while they run; everything
  else here is static.

## 7. Idle and busy

| State | Pose | Monitor and lamp | Updates |
|---|---|---|---|
| Off duty (never worked, or desk closed) | One of three rest poses by look, still, at the desk; once their desk closes, in a lounge, kitchen or games room if there is one (walking there, and back when it reopens) | Off | None |
| Idle, desk open | A rest pose at the desk, still | Monitor dim | None |
| Working | Sit_Chair_Idle with the typing layer, from the look's phase so a room never types in unison | On | Ambient rate |
| Thinking, after 4 s with no step running | Chin on hand, slow breathing | On | Ambient rate |
| Waiting for a desk (over the cap) | Reading their task paper (white), still; "Next for a desk" on the first in line | Off | None |
| Stuck | Hand on the back of the head, still; v2's bubble | On | None |
| Resting (night) | Head on folded arms | Off | None |

- **An idle office is still and free:** rest poses are single frames, so a company with nobody at work draws nothing
  until something changes. Nobody fidgets, strolls or potters.
- **Two channels.** Props say who: a department-hue shirt, an ID badge on a lanyard (the panel's badge made physical),
  the look's prop (`LOOK_PROPS`: engineers a laptop, designers a tablet, QA and reviewers a clipboard, writers a
  notebook, ops a headset), heads a nameplate, the CEO a blazer. Pose and light say what: lit monitors are the busy map
  at any size. Papers are messages, cups a long day, the plant a first day. No prop changes with the step.
- **Stop** shows on the next frame after the switchboard confirms it: typing stops, they sit back and look toward the
  camera for 1.5 s; your instruction is a yellow note in their tray, taken with a nod.
- **Cost to watch** (25 people, the maintainer's laptop): mixers and skinning under 3 ms a frame in motion, under 200 draw calls
  with props instanced. Off-screen people don't update; under 16 px tall, 10 Hz; typing never moves a label, so labels
  skip those frames. 50 people keep these rules; SPEC-v3.md's bone-texture instancing is the fallback.

## 8. Not another agent visualizer

Bot Crossing (its README, read 5 Nov 2026) and Agent Ages use the same KayKit packs. In Bot Crossing a session is a bot
building a house in a hex colony, a bot that needs you holds a `?`, a merged PR gets a jump, confetti and heart eyes,
idle bots sleep under `z` bubbles, and twelve planets have weather and a clock-driven day. Worklings, on purpose:

- **The company is the spectacle:** departments as rooms, heads by their doors, your words walking down and reports
  walking up; desk work read from light and posture, never game chores standing in for tool calls.
- **They come to you:** one front desk with its queue facing you, not icons over heads across a map.
- **People, not adventurers:** fantasy gear off, faces on, department shirts, an ID badge, a job prop, a first-day
  plant, cups on a long day; the mannequin's blank face and "Hello, my name is" sticker are visitors' default look.
- **Light means something** (work, rest, the front desk lamp; no day-night cycle, no weather), and **the world is the
  project's own**: a café is built in a café, all of it a scale model on the sage cutting mat.
- **Never from the packs:** weapons, helmets, capes, hex tiles, or the hammering, digging, fishing, combat, death, spawn
  and skeleton clips. **Never:** confetti from people, `z` bubbles, a camera that follows someone.

## Tuning and playtests

Every number here becomes a named constant in `web/src/scene/feel.ts`, commented with its section (v2's `STAND_MS`,
`FRESH_MS`, `MEETING_SPOTS` and walk speeds move there too); tests pin the rules, not the values; tune one at a time.
The demo loop stages every moment within three minutes for the e2e screenshots (1440 px, 375 px, reduced motion; H24).

For the maintainer to play, on the laptop and the iPhone:
1. A company from one sentence: does the first minute feel alive, and is the next step clear?
2. A word to the CEO: can you follow it to the person doing the work without opening a panel?
3. Three people waiting: who needs you and who came first, from the 3D view alone, on the phone too?
4. An hour of a busy company: calm or restless? Laptop fan, iPhone warmth, battery per hour.
5. Cups, night and the lobby: does each read at a glance? And with reduced motion, is anything lost?
