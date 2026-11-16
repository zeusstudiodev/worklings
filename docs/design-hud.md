# The HUD: stage and dock

The visual system for `SPEC-v3.md` "Stage and dock" (the maintainer, 11 Nov 2026; AC32 to AC41; H55 to H66). The flows,
structure, states and words are in `docs/design-v3.md`, "Stage and dock"; the palette, type, principles and copy rules
in `docs/design.md`; the 3D moments in `docs/game-feel.md`. This file says how each piece looks, where it sits, how it
folds and how it moves. It was revised after the design gate of 11 Nov 2026 and its confirming round.

Mockups, drawn over real screenshots of the demo company's office (the static web demo), are in the maintainer's
evidence folder outside the repo (`<evidence>/v3-redesign-design/mockups/`) with their sources: `hud.css` holds every
token and component below as working CSS, `kit.js` the drawn icons, the shell and the measured folds, `shoot.mjs` the
Playwright script that screenshots them at each size (and in a variant, such as the side panel shown or the bar
scrolled away) and measures how much of the window the solid HUD covers (`coverage.json`).

| Mockup | Shows | Renders (`<name>-<size>.png`) |
|---|---|---|
| `01-shell-person` | Mina open in the side panel: her question with Answer, the separator, the office's zoom keys; at 768 the side panel floats | 1440, 1024, 768x1024, 375 |
| `02-talk-mention` | `@de` picking who hears it, the list over the office, the hint row | 1440, 1024, 375 |
| `03-feed` | The feed risen out of the talk bar: a relay chain on its rail, New, an approval answered inline; Ada beside it; at 768 the feed ends short of the floating side panel | 1440, 1024, 768x1024, 375 |
| `04-org` | Café Lumen's chart: whole at 100% at 1440 and at 89% at 1024, chips at 66% at 768 and at the 40% floor beside a floating side panel, with the head in two rows; a relay, More beside the focused node; the phone's outline | 1440, 1024, 768x1024, 768x1024-panel, 375 |
| `05-tasks` | The task board mid-drag over Queued, the columns that refuse it; at 768 with and without the floating side panel; at 1024 every column scrolled to its end, clear of the strip, the talk bar and the mini-map; the phone's column chips and Move sheet | 1440, 1024, 1024-scrolled, 768x1024, 768x1024-panel, 375 |
| `06-dashboards` | Progress at full width with the rail; under 1100 px of board the rail as a row; under 640 the picker and four columns (768 beside the floating side panel); the phone's stack | 1440, 1024, 768x1024, 768x1024-panel, 375 |
| `07-office` | The office with the side panel hidden at every width: the bar giving way on laptops, the floating range, 320 px; Zoom out, Zoom in and Fit; on phones the two zoom keys | 1440, 1366x657, 1280x720, 1024, 768x1024, 375, 320x568 |
| `08-inbox` | The inbox as the side panel's home; the short phone layout at 1440 and 200% (720 x 450), a phone on its side (844 x 390) and 1280 x 1024 at 400% (320 x 256), the last two also with the bar scrolled away | 1440, 1024, 375, 720x450, 844x390, 844x390-scrolled, 320x256, 320x256-scrolled |
| `09-states` | Every piece in every state, on one sheet; on phones the talk bar's compact states | 1440-full, 375-full |
| `10-phone-talk` | The compact talk bar's twelve states, at 375 and 320 | 375-full, 320x568-full |
| `11-org-40` | Ledger grown to 40 people at its opening zoom, every chip with its whole first name: 47% at 1440 with the side panel open, 46% at 1024 with it hidden; with it open at 1024 the 40% floor, centred on the CEO | 1440, 1024, 1024-panel |
| `12-send-flight` | Send's paper flying from the talk bar to Mina's desk, as a storyboard | 1440 |
| `13-task-lanes` | The task board grouped by person (two lanes closed, their counts under the columns) and by room; on the phone, the current column with a section per lane | 1440, 1440-room, 375 |

The faces in the mockups are the art proof's own KayKit bodies, cut from its renders: the Portrait component
(`design-v3.md`, decision 7) renders each look's head once, and they look like that. Labels over the office are baked
into the backdrops, so in the narrow renders some run under the floating side panel; the product keeps them in their
area (below). The board for the maintainer's checkpoint (H65) is Tasks, `05-tasks` and its lanes, `13-task-lanes`.

## Decisions

1. **Paper on the mat.** Every HUD piece is a solid tile of badge paper floating one gutter (12 px, 8 on phones) inside
   the window, and the model shows between the tiles. No full-width bars, no frosted glass, no blur over the model:
   the maintainer turned the tilt-shift off for its soft edges, and a blurred panel would bring them back.
2. **Keycaps, not pills.** A control that stands over the model is a chunky key with a 3 px darker bottom edge that
   sinks when pressed, the way KayKit's bevelled pieces and the front desk's sign already look. Inside a tile, keys lie
   flat until the pointer finds them. They are the one button system: forms use them too (Keys and tiles).
3. **Boards are the mat seen from above.** Org, Tasks and Dashboards lie on the same sage cutting mat, with its grid and
   ruler, and the people, tasks and figures are paper laid on it: ID badges, sticky notes, index cards. The office
   shrinks into the corner and the table it stands on stays.
4. **Colour keeps its two meanings** (design.md): a room's hue means that room, the highlighter means you (needs you,
   your words, what you picked, now). Paper in a room's colour is 34% of the hue over badge with a 62% glue band;
   Content's and the lead's gold are 24% and 40%, cream as design.md keeps Content, so yellow paper only ever means you.
   Words on paper and on the highlighter are always ink.
5. **Faces everywhere a person is named** in a list, a node, a note, the To or a line: a portrait of their 3D look on a
   disc of their room's hue, the same person you watch at their desk.
6. **Light only**, as today. Night (a company resting) darkens the 3D office and the mini-map, not the HUD.
7. **Motion carries words.** What travels is a message: your paper flying from Send into the office, a paper along the
   org chart's lines, a line rising into the strip, the feed rising out of the talk bar. Everything else settles in 80
   to 250 ms. All of it cuts with reduced motion or Still office.
8. **Nothing is veiled.** Dimming (a column that refuses a drag, people Find passes over) sinks things flat instead of
   laying a tint over their words, so every word keeps its contrast.
9. **The main view sets the layout, not the window.** Everything over the office or a board is placed and folds in the
   main view (the window less the side panel and its two gutters; the CSS container `main`), docked or floating, and
   the bar folds by its own width. So 1440 with the side panel open lays out like a 1056 px window, 768 with it
   floating like a 444 px one, and every width between the drawn ones has its form. What folds measures its own room.
10. **Open is the key's "on" mark; focus is the ring.** A node open in the side panel sinks like a pressed key
    (badge-pressed paper; a note keeps its room's paper and loses its lift), with a 2 px ink edge and a highlighter bar
    on an ink line at its foot. Focus keeps v2's ring. They never look alike, and both can show at once.
11. **Zoom changes form, never type size.** The org chart's words never render under 12 px: zoomed out, nodes take a
    smaller form at their own size instead of shrinking, and a chip always shows its whole first name.
12. **Type follows the browser's text size.** Every size is in rem and every layout switch that holds words is in em
    (media queries) or rem (the main view's container), so a larger default text size reaches the compact and phone
    layouts as zoom does.

## How the HUD sits over the office

**Solid**, opaque badge paper: the bar's tiles, the caption, the map keys, the side panel, the talk bar, the feed, the
lists, the mini-map's frame, every board's paper, column trays, lane ribbons, the sheets. **See-through**: the gaps
between tiles, the strip (its lines are separate bubbles with the model between them), the separator's band (only its
grip is drawn). **Translucent** only on the mat and never under words: the grid's lines (badge at 5% and 11%) and a
refusing column's outline (16%). Nothing translucent lies over the 3D model, where a busy scene behind it would make
contrast unpredictable.

How much of the window the solid HUD covers (`coverage.json`, a 4 px grid over the pieces marked solid):

| View | 1440 x 900 | 1024 x 768 | 768 x 1024 | 375 x 812 |
|---|---|---|---|---|
| Office, side panel hidden (`07`) | 14%: 86% is the office | 21% | 19% | 23% (320 x 568: 34%) |
| Office, side panel open (`01`, `08`; a first visit) | 37% | 48% | 51%, floating | 80%: the office is the strip above the sheet |
| Office, the `@` list open (`02`) | 24% | 37% | | 50%, and the keyboard takes 37% more |
| The feed open (`03`) | 67% | 82% | 79%, beside the floating side panel | 91% |
| A board (`04` to `06`, `13`) | 12 to 13%: the bar, the talk bar, a strip line, the mini-map | 13 to 14% | 11 to 12%; 42% with the floating side panel | 89 to 94%: the board's sheet |
| 40 people on the chart (`11`) | 32%, side panel open | 13%; 40% with it open | | |

Laptops (`07`): 20% at 1366 x 657, 19% at 1280 x 720. Short windows (`08`): 93% at 720 x 450, 92% at 844 x 390 (96%
with the bar scrolled away), 84% at 320 x 256 (91%): there the inbox's sheet is the view, as the flows say.

**The stage takes two insets**, two rectangles the HUD hands it: the camera's fit and the labels' area.
- **The camera's fit** is the window less the bar's band at the top (68 px: 12 + 44 + 12; phones 124 px with the views
  row), the side panel and its gutter on the right when docked (its width + 24, or 36 for the pull; a floating side
  panel keeps the hidden insets, so opening it never moves the office), and the talk bar with one strip line at the
  bottom (12 + the talk bar + 8 + 30: 106 px with a one-line talk bar; phones 116 px and the safe area). Strip lines
  coming and going never move the camera.
- **The labels' area** is the fit's area made smaller: it starts 8 px under the caption and the map keys, ends 12 px
  left of the side panel whenever it shows (docked or floating), and ends above the strip's three lines (12 + the talk
  bar + 8 + 3 x 30 + 2 x 4: 174 px with a one-line talk bar; on a board and on phones one line). A label whose person
  stands outside it waits at its edge, as v2's do; a label with focus stays there too, never under a HUD piece.

**Measured sizes.** ResizeObservers write what the layout depends on as custom properties: `--talk-now` (the talk bar's
height, as it grows to six lines), `--head-h` (a board head's height, two rows at its last fold), `--keys-w` (the
office's map keys' width, folded or not). The strip rides on the talk bar, and the labels' area, the caption and the
boards' scroll padding follow them.

**Layers**, bottom to top (`--z-*`): the stage; the labels (2); the caption and map keys (10); the strip and the talk bar
(15); the mini-map (16); the side panel (18) and its separator (19); the bar (20); the feed (22); sheets (24). Popovers
open in the top layer: the `@` and `/` lists, the To's picker, menus, the feed's Who and Kind, tooltips, so they sit
above the feed and the side panel. The talk bar's lists are `popover="manual"` (an automatic popover would close on the
first click in the box), placed from the box's rectangle in script, with anchor positioning only as an enhancement. The
palette and the phone's dialogs (`showModal`) are above everything.

### Focus is never hidden

Nothing that can take focus ends up under the talk bar, the strip, the mini-map, the open feed or a floating side panel:
- **Boards**: every scroller (a column, the board's sideways scroll, the dashboards' grid, the plan, the timeline) has
  `scroll-padding-bottom: var(--dock-clear)` and pads its foot by the same. `--dock-clear` is 12 px plus the height of
  the highest thing at the window's foot: the talk bar now + 8 + one strip line (30), or the mini-map's top where it
  stands higher. That is 118 px with a one-line talk bar beside the thumbnail, 159 where the thumbnail rises above the
  talk bar (under a 900 px main view), and 220 beside the whole mini-map. So the last card, its Answer and "And 22 more"
  scroll clear of all of them (`05-tasks-1024-scrolled`), and keys moving focus (`scrollIntoView({ block: 'nearest' })`)
  honour it. When the talk bar grows over a focused card while you type, the scroller brings the card back above it.
- **A floating side panel** covers no board: while it shows, the board lays out in the main view it leaves, and the
  mini-map stands under the panel's foot, outside the main view.
- **The org chart** is a pan, not a scroller, and its pan layer clips: the view pans so the focused node sits inside
  the chart's free rectangle: under the head (`--head-h` + 12), 12 px left of the side panel, above `--dock-clear`, and
  clear of the mini-map's corner by 12 px.
- **The office**: labels keep to their area (above). The caption, the map keys, the strip and the talk bar never
  overlap one another at any width (the caption takes what the measured map keys leave, or a row under them; strip
  lines stop at the main view's edge).
- **The feed**: what it covers is `inert`, so focus can't go there; its lines scroll above its foot (the talk bar) with
  the same padding.
- **The side panel**: docked, nothing covers it; floating, it ends one gutter above the talk bar (and above the
  mini-map on a board). On phones every sheet ends above the strip's line; the feed's goes down to the talk bar,
  since the strip hides while it is open.
- **Lists and menus** are in the top layer, so nothing covers them; the active option scrolls into view inside them.

## Layouts

Which layout applies, from the flows (`design-v3.md`, The shell). The switches are in em, so they follow the
browser's text size: 720 px is 45em, 480 is 30em, 560 is 35em, 400 is 25em, 360 is 22.5em, 721 to 895 is 45.0625em to
55.9375em.

| Where | Layout |
|---|---|
| Width 720 px or less, or height 480 px or less | The phone layout |
| The phone layout under 560 px tall | Its short form: the views fold into one Views key in the bar (the current view's glyph and a caret, a menu of the four with the current one marked); the strip hides and Feed, its glyph and count, joins the talk bar; the hint row shows only while the box has focus; every sheet fills between the bar and the talk bar |
| Under 400 px tall | The bar scrolls away with the sheet under it; only the talk bar stays (`08-inbox-*-scrolled`) |
| Under 360 px wide | The views keep their words and drop their glyphs; Actions folds into Company (the bar's six keys don't fit 304 px); the To is its face alone, its words in its name |
| 721 to 895 px | The side panel floats: 300 px over the window's right, from under the bar's band to one gutter above the talk bar (and above the mini-map on a board), with no separator and no pull. While it shows, everything over the main view lays out in the width it leaves, as when it docks (the main view is 444 px at 768): boards (the chart's fit, the columns, the grid), the feed, the strip, the caption, the map keys and board heads. Only the 3D office (the hidden insets) and the talk bar keep the whole width, and the mini-map stays in the window's corner under the panel's foot |
| From 896 px | The side panel docks: 300 to `min(560, window − 596)`; 320 by default below 1280, 360 from 1280 |
| A main view under 640 px | The compact talk bar (phones, and a docked side panel that leaves less) |

**Folding by the main view** (container `main`, its width, in rem):

| Piece | Rule |
|---|---|
| Caption | `min(520, main − the map keys − 3 gutters)`, 3 lines: the map keys measure 261 px, 186 with Full screen as its glyph. 520 at 1440 and 1024, 471 at 768, 222 beside the floating side panel at 768; at 721 beside it a row under the map keys (below) |
| The To | Its words cut at 240 px; 180 under a 760 px main view; under 640 the compact form (face and first name, 96 px at most); under 360 the face |
| Talk bar | `min(760, main − 24)`: 760 at 1440, 656 at 1024 with the side panel open (main 680), 744 at 768 (under a floating side panel too) |
| The feed | The talk bar's width; beside a floating side panel it rises from the talk bar's left end and stops at the main view's edge (432 px at 768), and the talk bar's right end keeps its round corner |
| Strip lines | At most the talk bar's width and the main view less a gutter (432 px beside a floating side panel); where the mini-map rises above the talk bar, they stop a gutter short of it |
| Dashboards | At 1100 px of board the rail becomes a row of keys, Ask the CEO last, and the grid has 8 columns; under 640 the rail is the phone's picker ("Dashboard: Progress") and the grid has 4 columns, stats two to a row |
| Mini-map | Whole (240 x 150 and its caption) where the main view is 1288 px or wider: 264 px beside a 760 px talk bar; else the 104 x 56 thumbnail; under 900 px it rises one gutter above the talk bar. Beside a floating side panel it stays in the window's corner under the panel's foot |
| Org chart | Opens at the zoom that fits (The org chart, below) |

**What folds measures its own room**, one step at a time: the bar, a board's head and the office's top row. The build
measures each piece's full and folded widths once (again when its content changes), computes the step from them on
each resize (a ResizeObserver), and never folds and re-measures in a loop, which oscillates at the thresholds. In the
mockups `kit.js` stands in for it, so every still shows the step its width takes.

- **A board's head**, in the flows' order: 1, the summary goes; 2, the filters fold into Filter; 3, actions become named
  glyph keys (Hire someone, Add a task) and "Fit the chart" becomes "Fit"; 4, the search field narrows to 120 px,
  cutting its placeholder; 5, the controls take a second row under the title, while "Back to the office" stays on the
  title's row in its words and the zoom keeps its percentage. The board's content starts under the taller head
  (`--head-h`: 108 px in two rows). The Org head takes steps 1 to 3 at 768 and all five beside the floating side panel
  (`04-org-768x1024`, `-panel`); nothing scrolls sideways at any width.
- **The office's top row**: first Full screen becomes its named glyph; then, where the caption would be under 200 px,
  the caption takes a row under the map keys (at 721 with the side panel floating).
- **The bar**, by its own width (the window less 24), in the flows' order. The widths are the worst case (a 220 px name,
  the widest ledger figures) at which each step is sure to apply; measured, a short name keeps its views' words longer.

| Bar width | What gives way |
|---|---|
| 1555 | Burn |
| 1463 | Waiting for a desk |
| 1353 | The views' words: glyphs with names and tooltips |
| 1129 | Preview, into Company (which becomes its glyph), then Lobby's word (its glyph and count stay); the name caps at 180 |
| 933 (a 957 px window) | The ledger, the state pill's word (its dot stays) and Inbox's word, as on phones |
| then | The name, cut down to 140 px at the least (the whole in `title`) |

## Tokens

The v2 and v3 tokens in `web/src/styles.css` stay as they are; these join them in `:root`.

**Colour**

| Token | Value | Role |
|---|---|---|
| `--mat-shade` | `#204b3a` | The boards' surface: the mat as the desktop camera draws it (tone mapping and baked occlusion darken `--mat`), so the office can shrink into the corner and the mat around it stays the same colour. Phones, which draw no post-processing, use `--mat` |
| `--mat-ink` | `#fcfbf7` (badge) | Every word on the mat: board titles and summaries, column reasons and counts |
| `--mat-line` | `#9db0a6` | The org chart's lines |
| `--lane-fill` | `#2f5747` | A column's tray, opaque; the Cancelled rail |
| `--lane-lit` | `#3d6253` | A column that would take the dragged note; the rail under the pointer |
| `--grid-minor`, `--grid-major` | badge at 5%, 11% | The mat's 24 px grid and its 120 px lines on boards |
| `--paper` | `color-mix(in srgb, var(--hue) 34%, var(--badge))`; Content and lead gold 24% | A sticky note in its room's colour |
| `--paper-band` | the hue at 62% over badge; Content and lead gold 40% | A note's glue band; the "In Design" tag |
| `--paper-reply` | the hue at 24% over white | Their bubble in a thread (v2's, named) |
| `--dim-paper` | `#afbdb5` | A node Find passes over |

`--mat-ink-soft` (`#c9d3cc`) and the translucent tray (`--lane`, badge at 7%) are gone from the product: soft words over
a grid line are 4.7:1 on the desktop mat, barely over the line, and 3.7:1 on the phone's, so the mat has no soft words,
and opaque trays keep every word's contrast.

**Elevation.** Shadows are crisp: a hard 1 to 2 px contact line under every piece and one short shadow, never a wide
blur over the model.

| Level | Token | Value | For |
|---|---|---|---|
| Sunk | `--sunk` | `inset 0 2px 0 rgb(24 36 31 / .18)` | Pressed keys, the view you are in, fields (with their edge) |
| Bevel | `--bevel`, `--bevel-ink` | `inset 0 -3px 0 rgb(24 36 31 / .14)`; `rgb(0 0 0 / .4)` on ink | The bottom edge of every raised piece |
| Lying | `--lift-1` | `0 1px 0 rgb(10 24 18 / .32), 0 4px 8px -4px rgb(10 24 18 / .5)` | Paper on the mat: nodes, cards, lane ribbons, keys on boards, strip lines, the caption |
| Standing | `--lift-2` | `0 2px 0 rgb(10 24 18 / .28), 0 12px 20px -12px rgb(10 24 18 / .6)` | Tiles and keys over the model: the bar, the talk bar, map keys, the mini-map, the pull |
| Held | `--lift-3` | `0 2px 0 rgb(10 24 18 / .28), 0 22px 44px -22px rgb(10 24 18 / .62)` | What holds content over the model: the side panel, the feed, lists, menus (replaces `--shadow-panel`); a standing key under the pointer |
| In the hand | `--lift-4` | `0 6px 0 rgb(10 24 18 / .14), 0 26px 34px -14px rgb(10 24 18 / .6)` | A dragged note |
| Ring | `--ring` | `0 0 0 6px var(--highlighter)` | Focus, with v2's 3 px ink outline 2 px out; 8 px on the mat |

**Type**: v2's scale and nothing new, set in rem so it follows the browser's text size (12 px is 0.75rem at the
default 16). Barlow 400, 500 and 600; Semi Condensed 500 and 600 for figures, signs and compact labels; tabular figures
for money, counts, times, places in line, the ledger and the zoom. 12 px (0.75rem) is the floor everywhere, the chart's
chips included. Line heights are unitless; what holds words (keys, tiles, strip lines, nodes, the hint row) is sized by
`min-height` and padding, so it grows with them; the 3D scene, the chart's column pitch and the gutters stay in px.
Today's 402 sizes in px are converted in the build's every-state step.

| Size | rem | Face | For |
|---|---|---|---|
| 12 | 0.75 | Barlow 400 to 600, Semi Condensed 600 | Times and ages, the hint row, ledger labels, tags, key hints, glue bands, places in line, milestones, node titles, chip names (Semi Condensed) |
| 13 | 0.8125 | Barlow 500 and 600 | Chips, small keys, state chips, strip lines, meta lines, the office's own lines, compact node names, "Part of" lines |
| 14 | 0.875 | Barlow 400 to 600 | Feed lines, threads, the side panel's facts, note titles (600), card text, map keys, the To, lane ribbons |
| 15 | 0.9375 | Barlow; Semi Condensed 600 | Desktop body, keys, the talk bar's box, node names (600), column and room signs (Semi Condensed) |
| 16 | 1 | Barlow | Phone body and every phone field (iOS zooms into anything smaller) |
| 19 | 1.1875 | Semi Condensed 600 | The company's name, side panel and feed titles, ledger figures, sheet titles |
| 24 | 1.5 | Semi Condensed 600 | Board titles, a person's name on their badge |
| 28 | 1.75 | Semi Condensed 600 | Stat figures |

**Space**: steps of 2 inside a piece (2, 4, 6, 8, 10, 12, 14) and 12, 16, 24 and 32 between pieces. One gutter for
every floating piece: 12 px on desktops, 8 on phones, between pieces and from the window's edges. The odd values in
`hud.css` (3, 5, 7, 9) are a key's 3 px lip added under its words and 1 px optical nudges; they belong to their
component, not to the scale.

**Radius**: v2's steps. 3 to 4 (sticky notes, signs, papers, tags), 10 (keys inside tiles, fields, nodes, items,
options, lane ribbons), 14 (tiles, standing keys, strip lines, cards, the mini-map, column trays), 16 (the side panel,
the talk bar, the feed, sheets), 999 (chips, state chips, counts), 50% (faces, discs).

**Geometry**

| | 1440 | 1024 | 768 | 375 |
|---|---|---|---|---|
| Bar | 44 px tiles in a 68 px band | the same, given way | the same, given way further | 44 px tiles 8 px in, then the views row: a 56 px tile of four 44 px keys |
| Side panel | docked, 360 px | docked, 320 px | floating, 300 px; the main view 444 while it shows | a sheet |
| Talk bar | 760 x 56, 12 px from the foot | 656 with the side panel open | 744, under the floating side panel too | the width less 16, 56 px |
| Mini-map | whole with the side panel hidden; the thumbnail with it open | the thumbnail | the thumbnail, one gutter above the talk bar, in the window's corner | none |

**Motion**: `--t-press` 80 ms, `--t-hover` 120, `--t-quick` 150, `--t-move` 220, `--t-stage` 250, `--t-hop` 300,
`--t-refit` 350, `--t-ring` 400, `--t-flight` 450 (a typical flight; it runs 300 to 520 by distance), `--t-fade`
1000; `--ease-out` `cubic-bezier(.2, .8, .2, 1)` for arrivals, `--ease-in-out` `cubic-bezier(.65, 0, .35, 1)` for
travel, `--ease-settle` `cubic-bezier(.3, 1.35, .5, 1)` for a note landing (a small overshoot, like a desk dropping in).

## Components

### Keys and tiles

| Variant | Look |
|---|---|
| Standing key | Badge, 44 px tall (icon keys 44 x 44), 15/600, radius 14, bevel and `--lift-2`. Over the model and on the bar |
| Key in a tile | Transparent, 36 px (44 on phones), radius 10; the tile (badge, radius 14, bevel, `--lift-2`) is the piece |
| Small key | 32 px (44 on phones), 13/600, radius 10. Inside panels, notes, items and the hint row |
| On the mat | `--lift-1` instead of `--lift-2`: it lies on the board |
| Primary | Ink fill, badge words (15.5:1), `--bevel-ink`. Send, Run, Next, Stop and send, Allow once, Answer, Message Kai |
| Line | Badge with a 1.5 px ink-soft edge. Always allow, Deny, Details, Resume, Move, Back, Try again, Stop and wait |
| Danger | Danger words and a 1.5 px danger edge. Cancel the task, Fire |

| State | Standing key | Key in a tile | Primary |
|---|---|---|---|
| Hover | Turns white, rises 2 px to `--lift-3` (the fill alone was 1.04:1) | Badge-hover fill | Ink-hover |
| Focus | v2's ring: 3 px ink outline 2 px out, the highlighter 6 px around it | The same | The same |
| Pressed | Sinks 2 px, the lip moves to the top (`--sunk`) | Badge-pressed, flat | Ink-deep, an inner top shadow |
| On, the view you are in | Badge-pressed, sunk, and a 3 px highlighter bar on a 1 px ink line under the words, 10 px in from the sides | The same | |
| Busy | The 8 px highlighter dot leads the words ("Allowing") and pulses, still with reduced motion; `aria-disabled` | | |
| Unavailable | Full opacity, flat, ink-soft words, a 1.5 px badge-line edge, `cursor: not-allowed`, still focusable (`aria-disabled`) | The same | White fill, an ink-soft glyph |

**One button system.** These keys are the only buttons: v2's `.button` in forms, the plan and the proposal takes their
look (its primary as the Primary key, its default as the Line key, its danger as the Danger key, its quiet form as a
link), changed once in the shared Button so every form follows; inside panels and forms they are small keys, 44 px on
phones.

Counts: v3's (highlighter, ink tabular figures, 20 px) for what needs you; ink with badge figures for what's new and
doesn't need you (Feed's replies); badge with ink figures and a 1.5 px ink-soft edge for a plain number (a closed
lane's tasks in a column). An unseen reply is an 8 px ink dot. Chips (filters, pickers, the phone's columns):
32 px (44 on phones), 13/600, radius 999, a 2 px bottom lip; picked, white with a 1.5 px ink edge; a picker's label
("Who") in 500 ink-soft before its value. State chips stay v3's `.state-pill` (pill fill, a 7 px mark, the word), with a
Paused mark (two bars). Tags stay v3's outline tags.

### Faces

- A disc in the room's hue with the person's portrait (head and shoulders, rendered once per look, cached as a 128 px
  image), a 1.5 px badge ring (3 px at 64). Sizes 16, 20 (chips, "For Kai"), 24 (strip, notes), 28 (lists, the To, the
  feed, compact nodes), 32 (nodes), 40, 64 (the side panel's badge).
- The state mark at the foot, 11 px (16 at 64): working ok, needs you highlighter with an ink-soft edge, waiting a ring,
  stuck danger, resting rest-blue. The words always say it too.
- Needs you: a 4 px highlighter ring around the disc, as their bubble turns yellow in the office.
- You: an ink disc with "You" (Semi Condensed 600). A room, a team, all hands: a glyph on an ink disc (a room's on its
  hue). Visitors: the mannequin on the no-hue disc. Several people: up to three discs overlapping by 10 px.
- Before Portrait exists, or without WebGL: the first letter, Semi Condensed 600 ink, on `--paper` (10.4:1 or better).

### The company bar

- Tiles in one row, 12 px from the window: [Lobby, the name, its state] [the views], a gap, then [the ledger]
  [Inbox and its count] [Preview, Actions, Company, the side panel's toggle]. Each 44 px tall; the name 19 Semi
  Condensed, 220 px at most, giving way as above.
- The views are one tile of keys, `nav` "Views", each its glyph and word while the bar has room; the view you are in
  pressed with its highlighter bar.
- Inbox is a standing key, pressed (`aria-current`) while the side panel shows the inbox.
- Phones: [Lobby's glyph with a dot when other companies need you, the name, a state dot] [Inbox's glyph and count]
  [Actions] [Company's glyph]; under it the views row, four keys with glyph and word (words only under 360 px). Short
  windows: the Views key joins the bar after the name. Under 400 px tall the bar scrolls with the page.
- On a board the bar's tiles lie on the mat (`--lift-1`).

### The office view

- The caption: a badge tile, 14/500, 3 lines at most (a 10 px bottom border in its paper, not padding, so a fourth line
  never peeks), radius 14, `--lift-1`, its first sentence marked with the highlighter stroke (v2's `.caption__needs`)
  and a link to the inbox. Width by the main view (Layouts).
- The map keys at the main view's top right: one tile with Zoom out, Zoom in (34 px glyph keys, named, with tooltips)
  and Fit (its word always shown, named "Fit the office in view"), as the chart's zoom tile has, then Full screen, a
  standing key 40 px tall, 14/600 with 16 px glyphs; together 261 px, 186 with Full screen as its named glyph (they fold
  by measuring, Layouts). Each zoom press steps the camera about 1.25x toward whoever is open in the side panel, else the
  middle of the labels' area, within the camera's limits.
- Phones: Zoom out and Zoom in as two 44 px keys over the office's top right, while the office has the screen or its
  sheet is lowered; both also sit in Company beside "Fit the office in view" (and Full screen where the browser allows
  it).

### The side panel

- Badge, radius 16, `--lift-3`, one gutter from the window's right and foot and from the bar's band; floating (721 to
  895 px), the same paper over the window's right, ending one gutter above the talk bar (above the mini-map on a
  board), while everything over the main view lays out in the width it leaves (Layouts).
- Its head (56 px): the title 19 Semi Condensed, Back, "Back to the inbox" (the ×, named so, with that tooltip) and Hide
  ("Hide the side panel") as keys in the panel. The inbox: "Inbox" and "Four need you, oldest first." under it in 13
  ink-soft; where the bar's ledger has gone (phones, and windows under 957 px) the headline's sentences and "$40.27
  spent, API-equivalent." come first.
- A person: v2's ID badge, grown into the panel's head: the 72 px band in their room's hue with the lanyard slot
  (80 px on phones, so the face clears Back's 44 px key), Back and the × as translucent keys on it (ink-deep, 5.3:1 or
  better on every hue); their 64 px face overlapping the band; the name 24 Semi Condensed, the cost 19 tabular; then
  v3's facts, "Message Kai" (primary), Details, Stop and the thread. A question of theirs that waits is an item with
  its question, "Asked 6 min ago. You answer it in the inbox." and Answer (primary), which opens the inbox on it. No box:
  the talk bar is the one box.
- The plan's item says what waits and what changed ("The launch plan, version 3: three milestones and 51 tasks", 15/600)
  with Open the plan (primary). Nothing approves from the item.
- **The separator** is the side panel's left edge: an 8 px band (16 on touch screens), `col-resize`, its grip always
  shown and opaque: 6 x 44 px of badge with a 1.5 px ink edge and a 2 px contact shadow, so the edge stands out on paper
  or light wood and the fill on the mat. Hover and focus grow the grip to 60 px; focus adds the 3 px ink outline and the
  highlighter around the grip. Its tooltip: "Drag to resize it, or press to switch between narrow, default and wide."
- **Hidden**, the same element collapses into the pull on the window's right edge: 24 x 64 px, badge, radius 10 on its
  left, bevel and `--lift-2`, a left caret over the inbox's count. It is the separator (`role="separator"`,
  `aria-valuenow` 0, "Hidden"), not a button; its tooltip "Press to show the side panel, or drag it out." Hover widens
  it to 28 px with `--lift-3`; focus, the ring (its right side runs off the window). Floating, there is no separator and
  no pull: the bar's toggle shows and hides it.
- Inside, v3's pieces unchanged: inbox items (white, the 3 px highlighter rule on their left), choice buttons, undo
  lines, the trace, forms.

### The talk bar

A tile (radius 16, `--lift-2`, 6 px padding, its bevel at the foot), centred over the main view, 12 px above the
window's foot. Left to right: the To, the box, Send, Feed; the hint row under them while the box has focus or words.

- **The To**: a slot piece (note fill, a 1 px badge-line edge and a 2 px lip), 44 px, the face (28) and "To Mara, CEO"
  in 14/600 with a caret, cut as Layouts says (the whole in its name, described "Change who hears it").
  - Picked with `@` for this message: a second line, "For this message only", 12/500 ink-soft (5.6:1 on note).
  - Several people: their faces overlapping, "To Kai and Mina" with that second line.
  - A command: ink fill, badge words and the command glyph ("Cancel “Cart summary”"), its step as the second line in
    mat-ink ("Step 2 of 2").
  - Stop: danger words and a 2 px danger edge ("Stop Kai"); Send and Feed become "Stop and send" (primary) and "Stop
    and wait", with Cancel in the hint row (compact: both "Stop and wait" and Cancel in the hint row).
- **The box**: white, 44 px for one line, growing to six lines or a third of the window's height, whichever is less,
  then scrolling; radius 10, a 1.5 px ink-soft edge and a 2 px inner shadow at its top (a slot cut into the tile),
  15 px (16 on phones). The talk bar grows upward with it. Placeholder: "Say something to Mara". Focus: a 2 px ink edge
  and the highlighter 4 px around it, and a 2 px transparent outline, never `outline: none`, so forced colours paint
  it. Refused: a 2 px danger edge, the words kept. Reconnecting: note fill and a badge-line edge.
- **Send**: primary; a word key while it does something else ("Next", "Run", "Stop and send"); on phones a 48 x 44 key
  with the paper-plane glyph, named "Send". Unavailable while the box is empty, over 4,000 characters or reconnecting.
- **Feed**: a standing key with its glyph and word, then an ink count of new replies and disagreements, or an 8 px ink
  dot when only other lines are new; never yellow, since they don't need you. Compact: its glyph and count. Phones: the
  strip is the way in; short windows: a 48 x 44 key with the count on its corner.
- **The hint row** (while the box has focus or words; in short windows only with focus): 12 ink-soft, 4 px under the
  box, one sentence at a time. A key's name in ink 600 ("Enter or Tab picks"); an empty box with focus teaches "@ picks
  who hears it. / runs a command."; a refusal in danger 600 with its key; the counter on the right, tabular, danger
  600 when over; keys in it are small line keys (44 px on phones): Try again, "Send to the CEO instead", Back, Stop and
  wait, Cancel.
- **"For Kai"**: a chip (note fill, 32 px, the face 20, 13/600) at the start of the box, with a 24 px remove key named
  "Not for Kai" (on phones the chip sits in the hint row, 44 px, its remove key 44 x 44).
- **Targets**: the To is 44 px wide at the least, its face alone included; every key in the bar is 44 px tall.
- **The compact talk bar** (`10-phone-talk`, a main view under 640 px and phones): the To as the face and first name
  (96 px at most; several picks their faces; under 360 px the face alone), the box, Send as its icon key, Feed as its
  glyph and count (none on phones). What the To can't say takes a row above the box at the bar's full width, 36 px,
  14/600: Stop, "Stop Kai" on note with a 2 px danger edge; a command, "Cancel “Cart summary”, step 2 of 2" in badge on
  ink with its glyph. Then Send becomes the word key, and the mode's other keys sit in the hint row.
- **The `@` and `/` lists**: a manual popover (`popover="manual"`) above the box's left edge (badge, radius 14,
  `--lift-3`), 400 px wide (the full width on phones), eight rows then it scrolls (four on phones, above the
  keyboard). Group headings 12/600 ink-soft; options 44 px: the face or a glyph disc, the name in 15 with what you
  typed underlined (2 px, 600), the reach under it in 12 ink-soft ("Four people, Ada passes it on"). The active option:
  highlighter fill, ink words (11:1). Hover: badge-hover. Key hints in its foot on desktops.

### The live strip

- Bubbles over the model, left-aligned to the talk bar, stacked upward from it 4 px apart: three on the office, one on
  a board and on phones, where it never fades and ends with Feed's count of new replies (ink, in the button's name);
  "Nothing said yet" before anything is. Hidden while the feed is open, in short windows and when "Hide the live
  strip" is on (Company menu; on phones a Feed key with the count takes its place).
- A line: badge, radius 14, `--lift-1`, 30 px (36 on phones), 13/500, at most the talk bar's width: who (a face; for a
  hop two faces and an arrow; you an ink "You" disc), "Ada to Mina:" in 600 and the words cut at a word with "…", the
  age 12 tabular.
- Your words passed on lead with the paper glyph. A question, an approval or the plan waiting is a highlighter line.
  Someone stuck is in the danger tint (stuck-ink on stuck-fill). A stall leads with the clock glyph; a report with v2's
  ink check mark. A burst is one line whose count grows in place ("18 people acknowledged your message.").
- The strip is one button ("Open the feed, 2 new replies"): hover turns every line white (yellow ones
  highlighter-hover) and lifts it 2 px; focus rings the whole stack; on phones its button is 44 px tall around the line.

### The feed

- The talk bar grown upward into one piece: the feed above (badge, radius 16 16 6 6, `--lift-3`), the talk bar as its
  foot (radius 6 6 16 16), the same width, `min(600, 62% of the main view's height)` tall. Beside a floating side panel
  it rises from the talk bar's left end and stops at the main view's edge (432 px at 768), and the talk bar's right end
  keeps its round corner (`03-feed-768x1024`). Phones: from under the views row to the talk bar.
- Its head: "Feed" 19 Semi Condensed, Who and Kind as native selects styled as chips (Filter on phones), Catch me up (a
  small line key, 44 px on phones), Close; it wraps to a second row where the feed is narrow.
- A line: a 28 px column for the speaker's face (yours the ink disc), the sentence in 14 with names as 600 buttons
  underlined in the rule colour, the time in 12 tabular on the right; their words under it in 14 ink, a relay's note in
  quotes; yours in an ink bubble (badge words, radius 4 12 12 12).
- Threads: what follows from your message hangs on a 2 px rail (rule colour) from your face, a 19 px branch to each
  line. While the thread carries your words the rail is highlighter and each relay leads with the paper glyph.
- New: a 2 px ink rule with an ink pill, "New". A burst: overlapping 20 px faces, then the sentence and Show them. Lines
  waiting below: an ink pill key, "3 new lines", centred at the foot. Days: 12 Semi Condensed between hairlines.
- An item that needs you sits under its line as the inbox's item, answered there with the same undo.

### Boards over the map

- The surface: `--mat-shade` with the 24 px grid and the 120 px lines, the cutting mat's ruler along its top under the
  bar (ticks every 24 px, longer every 120). Phones: `--mat` and the 24 px grid.
- The head (56 px, 108 in two rows) on the mat: the title 24 Semi Condensed and the summary 14, both mat-ink; sub-views
  as a tile of keys (Board, Plan with its count), filters as chips, actions and "Back to the office" as keys lying on
  the mat; it folds by measuring its own room (Layouts), and the board's content starts under it.
- What a press did: a badge strip under the head for 10 s, v3's undo line in it.
- Loading ("Opening the task board…"): blank paper at badge 14% in the shapes to come, still. Error: a badge callout in
  the middle with its sentence. Reconnecting: v3's line as a note-filled row under the bar, across the width.
- **The mini-map**: a badge frame (6 px, radius 14, bevel and `--lift-2`) round the live office (240 x 150, radius 9, a
  1 px dark inner edge), the company's state top left in the bar pill's word and mark (a badge chip: "Working" with the
  ok disc; "Resting until 14:00" with the rest dot, over the night office; "Paused by you" with two bars; "Stopped"
  with a square), the needs-you count top right, and a 34 px caption: "Back to the office" 13/600 and the Esc key cap
  (gone in full screen, where the browser takes the first Escape). The thumbnail (104 x 56) keeps the mark and the
  count; its words are in its name ("Back to the office. Working, 4 need you."). It sits in the main view's bottom-right
  corner on the talk bar's baseline (beside a floating side panel, the window's corner under the panel's foot), hides
  while the feed is open over a board, and without WebGL. Focus: the ring.

### The org chart

- **A node** is an ID badge lying on the mat: badge paper, 216 x 76 (narrowing to 200 with its column), radius 10, the
  room's hue as a 5 px edge on its left (the room signs' edge), bevel and `--lift-1`. Top row: the face (32), the name
  15/600 and the title 12 ink-soft under it, a numbers column on the right (the spend 13 Semi Condensed tabular over the
  model 12 ink-soft). Under them one row: the state chip and the work line, 12, cut with "…". The leash, when not
  Default, is a 17 px outline tab on the node's top edge ("Trusted").
- **Zoom and form.** The zoom sets the column pitch, 240 px x the zoom, from the floor to 150%. From 100% up the whole
  chart scales, words included. Under 100% nothing scales: a node is its column less the gap and changes form as the
  column narrows, so no word is under 12 px. The maintainer's brief puts live state, task, model and spend on each node, so the
  whole form holds on as long as it can.

| Zoom | Form | Size | Shows |
|---|---|---|---|
| 88% to 100% | Whole | 200 to 216 x 76 (the column less 12; 24 px apart at 100%) | Everything above; the title and work line cut with "…" |
| 75% to 88% | Compact | the column less 12 (168 to 199) x 48 | The face (28), the name 13/600, the state in words (12; needs you on the highlighter) |
| The floor to 75% | Chip | the column less 8 (88 to 172) x 32 | The face (20) with the state's mark on its corner, the name 12 Semi Condensed 600 |

- **The floor** is the zoom where every chip still shows its whole label: the face, its padding and gap (45 px), the
  longest label, 8 px of padding and the 8 px gap, over 240; 40% at the least, which holds for first names of six
  letters (Ledger's). A label is the first name; two people with the same first name add their title's first word
  ("Sam, QA", "Sam, SEO"). Never two letters.
- Rows by the form's own height, not scaled: the heads 52 px under the CEO's row (the bus and the room signs, which keep
  their size above their heads), reports 20 px under their manager, then 8 px apart for whole nodes, 12 for compact,
  8 for chips.
- A chip's mark has a shape as well as a colour, so it never rests on colour alone: working an ok disc, idle an
  ink-soft dash, waiting an ink-soft ring, needs you a highlighter square with an ink edge (and the face's ring), stuck
  a danger triangle, resting a half disc. It sits on the face's bottom-right corner with a 1.5 px badge ring, as faces
  carry theirs, which gives the name its room. The full name and state show on hover and focus and are always in the
  node's name.
- **Opening** (the flows): fitted to the main view with 20 px of mat each side, at 100% at most, down to the floor;
  where even the floor doesn't fit, at the floor centred on the CEO. Café Lumen's 18 open whole at 1440 with the side panel open (99%: the chart is 610 px tall, the free area 641 px
  less the 18 px of mat), compact where the free area is shorter (the side panel hidden at 1440, 87%; 1024 with it hidden, 87%); chips at 1024 with it open (58%), at 768 (66%)
  and at the floor beside the floating side panel (40%). Ledger's 40 (21 shown: rooms nobody works in start closed) open all in view at 43% at 1440 with the side
  panel open (59% hidden) and 41% at 1024 with it hidden; at 1024 with it open, at the floor (40%), centred on the CEO.
- **States**: hover rises 2 px to `--lift-2`; open in the side panel, the on mark (badge-pressed, a 2 px ink edge, a
  highlighter bar on an ink line at the foot); focus, the ring 8 px out; needs you, the face's ring and the highlighter
  chip; stuck, the danger chip; a paper landing, a 3 px highlighter ring 6 px out that fades (400 ms); not matching
  Find, flat on `--dim-paper` with every word in ink and the face greyed.
- **More** (the ⋯ key) sits 6 px beside the node, never inside it: 32 x 32 (44 on touch screens), badge, radius 8,
  bevel and `--lift-1`, named "More for Kai". It shows on hover and focus and always on touch screens.
- **Moved to another room** without a new manager: the node stays under its manager, its edge in its new room's hue,
  and a tag on its top edge, right: "In Design", 12 Semi Condensed 600 ink-deep on that room's band colour with a 1.5 px
  ink edge (8.6:1 or better).
- **Lines**: 2 px `--mat-line`, elbows with 6 px corners; someone beside the CEO who manages nobody, and someone whose
  manager left ("Reported to Lena, who left", 12 mat-ink by the line), hang on dashed lines; "You" is an ink tag above
  the CEO. Rooms are named by room signs over their heads. A folded manager has a pill on its line ("+6" and the count
  of who needs you); "Add someone to Design" is dashed paper (1.5 px, badge at 55%) at the column's foot.
- **A relay**: the hop's line turns highlighter (3 px) while a paper (18 x 14, two ink lines) travels along it, yellow
  when it carries your words and white otherwise (game-feel's notes); the receiver rings once.
- The head: Find someone (a field), Hire someone, a tile with Zoom out, the percentage, Zoom in and "Fit the chart" (the
  corners glyph and its word: "Fit" when the head folds, never the glyph alone), Back to the office. Its pan layer clips,
  so a focus move never scrolls the page under it.
- **Phones**: the outline in the board's sheet, rows of badge paper (the hue edge, the face 32, the name 16/600, the
  title 13, the cost; the chip and work line), 22 px in per level on 2 px elbows; a folded manager is a row, "Theo, head
  of engineering, and 8 more", with its count.

### The task board

- **Columns** are opaque trays on the mat (`--lane-fill`, radius 14 at the top), 248 px (168 with no cards), 14 px
  apart, running to the board's foot; heads stay while the column scrolls inside itself. The head: the column's sign
  (badge, radius 4, 15 Semi Condensed 600 with the status's mark: a ring for Queued, the ok dot for Working, two bars
  for Paused, the danger dot for Blocked) and its count in 13 mat-ink. Waiting for you's sign has a 6 px highlighter
  edge where a room sign has its hue.
- **Done and Cancelled** show their newest ten, then "And 22 more": a key lying on the mat across the column, 40 px
  (44 on phones). **Cancelled** starts as a 52 px rail: the tray with its count and "Cancelled" on its side, one press
  target named "Cancelled, 6 tasks"; under the pointer or a dragged note it lights (`--lane-lit`) and opens.
- **A note**: `--paper` in the owner's room colour, radius 3 at the top and 4 at the foot, a 1 px contact line and a
  short shadow, a folded corner (an 18 px triangle at 10% ink) at its foot. The glue band (26 px, `--paper-band`) holds
  the room's name in 12 Semi Condensed ink-deep, and on the right the place in line, an ink pill with badge figures
  ("4th"). Then the title 14/600 (three lines), a subtask's "Part of: Pickup orders work" (13 ink, the milestone flag)
  or a parent's progress (six 8 x 6 segments with an ink edge, the done ones filled, and "3 of 6 subtasks done" 13/600),
  the task line 13 ink, a foot with the face (24) and first name and, on the right, the milestone's flag and name (12
  Semi Condensed, cut at 24 characters), and at most one small key (Answer, Resume, Undo the cancel, Open the plan).
- **A note is a link** to its task, its whole face the target: the title's link stretched over the note (a
  pseudo-element), with Move and the note's key outside the `<a>`, since a link can't hold buttons. Move is a 28 x 24
  key on the band that shows on hover and focus and always on touch screens; hidden, it is visually hidden (clipped),
  never `display: none`, so a screen reader finds it on every note.
- **States**: hover rises 2 px; focus, v2's ring with the highlighter 8 px out, so it reads on the mat; open in the side
  panel, the on mark (as nodes). Waiting for you: the band turns highlighter and says what for ("Waits for your OK").
  Its owner stuck: the trouble tag ("Stuck for 4 min", stuck-ink on stuck-fill) and the face's danger mark. New, or
  moved column or owner, since you last left the board: an 8 px ink dot on the band until you leave it again (a first
  visit marks nothing). Done: plain badge paper, the band badge-line with the highlighter tick box
  and "Done". Cancelled: plain paper, the band in pill colour, the title struck through in ink-soft.
- **A drag**: the note in the hand tilts −2.5°, grows 3% and takes `--lift-4`, with the grabbing cursor; where it came
  from keeps a hatched outline (2 px at badge 55%). Where it would land: a 4 px line in mat-ink with 10 px round ends
  and a 1 px ink edge. The column under it lights: `--lane-lit` and a 2 px edge at badge 70%. Columns that refuse it
  sink: their tray goes (a 1.5 px outline at 16% keeps their place), their notes lie flat, and the reason shows under
  their sign in 13 mat-ink. The drop forms (cancel, reassign) are today's forms on a badge tile under the note, with
  `--lift-2`.
- **Lanes** (Group: Person and Group: Room; `13-task-lanes`). Lanes stack down the board under the same sticky column
  heads and on the same trays, in the org's order, for owners with open tasks (by room: rooms with open tasks). Each
  lane starts with a ribbon across every column: badge paper, 44 px, radius 10, bevel and `--lift-1`, 14/600: a caret,
  the face (28) or the room's sign, and "Noah, backend engineer, three tasks". The ribbon is the lane's toggle
  (`aria-expanded`); hover turns it white, focus rings it. Under it a row of cells, one per column, holds the lane's
  notes; an empty cell stays empty (the columns' empty sentences show only without lanes). In a lane, Done and Cancelled
  show their newest three, then "And 4 more". Closed, the row under the ribbon holds only the lane's count under each
  column that has its tasks (a plain count: badge, ink figures, an ink-soft edge). Columns keep their width rule, 248 px
  where any open lane has a note and 168 without. A drop in another person's lane reassigns; across rooms it is refused,
  and that lane sinks as a refusing column does.
- **Phones**: one column at a time under chips for each column (Waiting for you's count on the highlighter; picked,
  white with an ink edge), Filter, Add a task and Plan as chips under them; grouped, the column shows a section per lane
  under its ribbon (the ribbon says how many of the lane's notes are in this column, "1 here", "none here"); notes show
  Move as a 44 px line key; Move opens an action sheet (badge, from the foot, over an ink scrim at 45%, 48 px options
  in today's words: Move to the top, Up, Down, Move to the bottom, Pause or Resume, Reassign…, Cancel the task… in
  danger, Open; then Close).

### Dashboards

- The rail: a badge tile (200 px, `--lift-1`) of keys, the current one pressed with its highlighter bar; "Made by the
  CEO" in 12/600 ink-soft; "Ask the CEO for a dashboard" a line key. Under 1100 px of board it is a row of keys, Ask the
  CEO at its end.
- Cards on a 12-column grid with 16 px gaps (8 columns under 1100 px): badge, radius 14, bevel and `--lift-1`, padding
  14 16 16, titles 15 Semi Condensed. A stat: the figure 28 Semi Condensed, its unit 19 ink-soft, the label 14/600, a
  note 13 ink-soft; Waiting for you marks its figure with the highlighter stroke. Progress: an 8 px ink bar on a
  badge-line track, the value in 13 Semi Condensed ink-soft. Bars: 14 px in room hues with a 2 px darker foot, the value
  printed at the end of each. A line: 2.5 px ink on badge-line gridlines, the last value labelled.
- Under 640 px of board (beside a floating side panel) and on phones: a picker chip ("Dashboard: Progress") in the
  rail's place, stats two to a row, the rest full width (4 columns on boards, one on phones).

### Sheets on the phone

- Sheets float between the views row and the strip, radius 16, `--lift-3` upward, with a grabber (a 40 x 5 rule pill
  in a 20 px zone). The side panel's sheet is badge paper at 78% of that space with "Show the office" (a 44 px key) on
  the office above it; a person's sheet opens with their ID band. A board's sheet is the mat with its grid and a 1.5 px
  light edge, its words in mat-ink. The feed's sheet is badge paper from the views row to the talk bar.
- Short windows: sheets fill between the bar and the talk bar, and "Show the office" goes. Under 400 px tall the page
  scrolls: the bar and the sheet's head go up with it; the talk bar stays.
- With a sheet up the talk bar stays at the foot, full width; with a field in a sheet focused it hides (flows).

## Motion

Only transform and opacity animate, except what follows the pointer (the side panel's width, a dragged note).

| What | How | Time and easing | Reduced motion and Still office |
|---|---|---|---|
| A key pressed | Sinks 2 px, its lip moves to the top | 80 ms, ease-out | The colour change alone |
| Hover | Fills turn; standing keys, nodes, notes and strip lines rise 2 px | 120 ms | Fills alone |
| Send's flight | Your paper lifts off Send and arcs into the office (below) | 80 ms lift; 300 to 520 ms flight by distance, ease-in-out; 120 ms hand-off | Nothing flies: the line appears in the strip, the note is in the tray |
| The side panel shown or hidden | Slides in from the right edge; docked, the camera refits after | 220 ms ease-out in, ease-in-out out; the refit 350 ms | Cut; the camera jumps |
| The side panel resized | Follows the pointer; the camera refits once on release | 350 ms | The refit jumps |
| The office's zoom keys | A step of about 1.25x toward whoever is open in the side panel, else the middle of the labels' area | 220 ms ease-out | Jumps |
| The pan to a focused node | The chart pans until the node sits in its free rectangle | 220 ms ease-in-out | Jumps |
| A strip line | Rises 6 px and fades in, pushing the oldest out. Each stays at least a quarter second; lines that come faster are skipped for the newest; a burst's count grows in place; after 5 quiet minutes every line fades (not on phones) | In 150 ms ease-out; the fade 1 s ease-in-out | Lines appear and go without fading or moving |
| The feed | Rises out of the talk bar, 12 px and a fade | 220 ms ease-out, closing 150 ms | Cut |
| The `@` and `/` lists, menus | A 4 px rise and a fade | 150 ms ease-out | Cut |
| A board opens | Rises 12 px and fades in while the office shrinks into the mini-map's corner; closing reverses | 150 ms and 250 ms ease-in-out | Cut |
| The chart's zoom | Columns spread or close; a node changing form cross-fades | 220 ms ease-in-out; the cross-fade 120 ms | Jumps |
| A relay on the chart | A paper along each hop, the hop's line lit while it passes; the receiver rings | 300 ms a hop, 1.2 s at most, ease-in-out; the ring 400 ms | No paper or ring: the receiver's work line says "From Ada" with the paper glyph for 4 s |
| A note picked up | Tilts −2.5°, grows 3%, lifts | 120 ms ease-out | No tilt or growth; it still follows the hand |
| A note dropped | Settles into place with a small overshoot while the others make room | 220 ms, ease-settle and ease-in-out | The notes jump |
| A drop refused | The note flies back | 220 ms ease-in-out | It jumps back |
| Someone fired | Their node fades out | 150 ms | Cut |
| Someone hired | Their node fades in and rises 4 px into place while the column makes room | 220 ms ease-out | Cut |
| A manager opened or closed | Their reports fade in under them (or out), the columns beside them make room | 150 ms fade, 220 ms ease-in-out for the room | Cut |
| A lane opened or closed | Its cells fade in under the ribbon (or out), the lanes below make room | 150 ms fade, 220 ms ease-in-out | Cut |
| The Cancelled rail opening | The column takes its width at once and its notes fade in | 150 ms | Cut |
| A count goes up | Pops once to 115% | 200 ms ease-out | No pop |
| Running marks | v2's highlighter pulse (Busy keys); the mini-map's working disc | 2.4 s, a loop | Still |
| A sheet | Slides up from the foot | 220 ms ease-out | Cut |
| "Show the office" | The side panel's sheet slides down to half the space, the office comes into view above it | 220 ms ease-out | Cut |

**Send's flight** (decision 10 of the gate; `12-send-flight`). It starts the moment Send is pressed; the strip's line
("You to Mina: …") appears at the same time, so the strip says it within a second whether or not anything flies.
- **The paper**: the HUD's own copy of game-feel's note, 22 x 17 px, highlighter with two ink lines, radius 2, its
  contact shadow. It lifts off Send's top centre: 8 px up and to 110% in 80 ms, ease-out.
- **The path**: a quadratic arc from Send to the target, its control point above the line between them by 30% of its
  length and toward the start, so the paper climbs over the strip and the talk bar first and turns down onto the
  target. 300 ms plus 0.25 ms a pixel, at most 520 ms, ease-in-out. On the way it turns from −10° to +6° and shrinks to
  the 3D note's size on screen at the target (about 55%). One element, moved by `transform` each frame (or
  `offset-path`), above everything (`--z-top`), never catching the pointer.
- **The target**, projected from the 3D anchor each frame so a moving camera doesn't lose it: the person's desk tray; a
  room's sign for a room; the team's head's tray for a team; the middle of the office for all hands. Several picks: one
  paper each, 60 ms apart, in the To's order. Over a board: the mini-map's centre (the whole or the thumbnail). A target
  outside the view, or in view but under a floating side panel: the paper flies to the edge of the labels' area toward
  it and fades there; the camera never moves.
- **The hand-off**: at the target the HUD paper fades out over 120 ms while the office's own note appears in the tray in
  the same frame; from there game-feel's walk-overs carry it (`docs/game-feel.md`). Over the mini-map it just fades in.
- **Reduced motion or Still office**: nothing flies or fades; the line is in the strip and the 3D note is in the tray
  as game-feel's reduced form puts it.

Never: blur, parallax, loops beyond the running marks, or anything moving on its own except what reports work.

## Contrast

WCAG AA, checked by computing relative luminance for every pair (the script's output, rounded). Words need 4.5:1,
shapes and edges 3:1.

**Words**

| Pair | Ratio |
|---|---|
| Ink on badge (words, keys, tiles) | 15.5 |
| Ink-soft on badge (meta, hints, ages) | 6.1 |
| Ink on white, ink-soft on white (the box, its placeholder) | 16.0, 6.3 |
| Ink on note, ink-soft on note (the To, "For this message only") | 14.2, 5.6 |
| Ink on pill (state chips) | 13.6 |
| Danger on badge, on note, on pill (refusals, Stop, the Stuck chip) | 5.5, 5.0, 4.8 |
| Ink on badge-pressed, ink-soft on badge-pressed (the view you are in; an open node's title) | 12.6, 5.0 |
| Ink on highlighter (counts, needs you, the caption's link, the active option) | 11.0 |
| Badge on ink; mat-ink on ink (primary keys, your words, a command's To and its step) | 15.5 |
| Stuck-ink on stuck-fill (the trouble tag) | 8.3 |
| Mat-ink on mat-shade, over a major grid line, on a tray, on a lit tray, on the phone's mat | 9.5, 7.0, 7.9, 6.6, 7.2 |
| Ink on `--dim-paper` (a node Find passes over) | 8.2 |
| Ink on sticky paper (34%), the worst room (Security) | 10.4 |
| Ink-deep on a glue band (62%), worst (Security); the "In Design" tag on it | 8.6 |
| Ink on Content's paper (24%), ink-deep on its band (40%); the lead's gold | 13.7, 14.8; 13.3, 14.2 |
| Ink on a reply bubble (24% on white), worst (Security) | 12.1 |
| Ink-deep on an ID band (the full hue), worst (Direction) | 5.3 |

**Shapes and edges**

| Pair | Ratio |
|---|---|
| Chip marks on badge: ok disc, danger triangle, ink-soft dash and ring, rest half disc, the needs-you square's ink edge | 5.7, 5.5, 6.1, 4.7, 15.5 |
| The mini-map's working disc (ok) on its chip | 5.7 |
| Focus: the ink outline on badge, against its highlighter halo | 15.5, 11.0 |
| Focus: the highlighter halo on mat-shade, on a tray, on the phone's mat | 6.8, 5.6, 5.1 |
| Open: the 2 px ink edge on badge-pressed; the highlighter bar on its ink line | 12.6, 11.0 |
| The box's edge, with focus | 6.3, 16.0 |
| Stop's 2 px danger edge on note | 5.0 |
| Line keys' edge (Back, Try again) on badge | 6.1 |
| The separator's grip: its ink edge on paper, on light wood; its fill on the mat | 15.5, 6.8, 9.5 |
| The org chart's lines on mat-shade, over a grid line; a lit relay line | 4.3, 3.2; 6.8 |
| The landing line, the taking column's edge, a dragged note's origin outline | 6.6, 4.2, 3.6 |
| Subtask segments on paper; progress fill on its track | 10.8, 12.4 |
| A plain count's ink-soft edge on badge (a closed lane), on its tray; lane ribbons' words (ink on badge) | 6.1, 7.9; 15.5 |
| A chip's mark on its 1.5 px badge ring (the marks' ratios above hold on badge) | as above |

- What failed and changed: Content's notes at 34% read as the highlighter, so Content and the lead's gold are 24%
  (cream); ink-soft on the highlighter is 4.3:1, so words on yellow are always ink; mat-ink-soft over a grid line is
  3.7:1 on the phone's mat (4.7:1 on the desktop's), so every word on the mat is mat-ink; the "In Design" tag on the
  full hue was 4.4:1 on Direction's, so it is ink-deep on the band colour; the mini-map's yellow working dot was 1.4:1 on
  its chip, so it is the pill's ok disc; the grip's ink-soft edge was 2.7:1 on light wood, so it is ink. From the first
  pass: ink-soft on sticky paper is 4.1:1 on Security's, so notes use ink only; a 35% origin outline was 2.6:1, so it is
  55%; veiling took ink-soft to 2.6:1, so dimmed things sink flat.
- The highlighter on badge is 1.4:1, so on paper yellow never works alone: the focus ring has its ink outline, counts
  their ink figures, the needs-you square its ink edge, an inbox item's 3 px rule its sentence, the open mark its ink
  line.
- Room-hue bars on cards are under 3:1 on badge for Content (1.8:1), so every bar has its value printed and Show the
  numbers. Colour never carries meaning alone: notes name their room on the band, states have words, marks have
  shapes.

## Targets

- Phones: 44 px at least for every key, chip, option, row, the To (44 px wide at the least, its face alone at 320),
  Send (48 x 44), the views, the Views key, the strip's button, "Show the office", the office's zoom keys, Move, the
  hint row's keys, "For Kai" and its remove key (44 x 44), Feed in short windows (48 x 44), the feed's Catch me up,
  lane ribbons, "And 22 more", and the action sheet's options (48).
- Desktops: 24 px at least (WCAG 2.5.8). The smallest are Move on a note (28 x 24) and the separator: an 8 px band (16
  on touch screens) with no other target within 12 px of its middle; its grip is always shown and opaque. More beside a
  node is 32 px, 44 on touch screens.
- Dragging always has a press-and-pick way (WCAG 2.5.7): Move's menu and Space for notes; the zoom keys, Fit and Find for
  the chart; for the side panel, a press on the separator steps through narrow, default and wide, and Hide, the toggle,
  the pull and the separator's keys do the rest.

## Icons

Drawn here, as v2's are: a 20-unit grid, 1.8 stroke, round caps and joins, `currentColor`, 20 px in keys and 16 px in
small keys and lines. No icon font or library. The set: office (the diorama's box), org, tasks (two notes), dashboards
(bars), feed (two bubbles), inbox (a tray), preview (a screen), actions (the search glass), Company (three lines),
carets, back, send (a paper plane), close, side panel, hide and show, more (three dots), milestone (a flag), pause,
check, plus, minus, fit (corners), full screen, filter, relay (an arrow), note, hire (a person and plus), stall (a
clock), all hands (a megaphone), team, room (a house), undo, stop, details, warning, command. Your words have their own
shape, the paper: a small yellow note with two ink lines, the same as the 3D one. An icon is never alone without a
name: glyph-only keys (the views when folded, Company, Hire on a narrow board) have names and tooltips, and Fit always
shows its word.

## Forced colours, zoom, long content

- Forced colours: tiles, notes, lane ribbons and the grip get a 1 px `CanvasText` border; the view you are in, pressed
  keys and the open mark keep an underline or bar in `Highlight`; focus keeps its outline everywhere, the box's
  included (its transparent outline is what forced colours paint); highlighter fills fall back to `Highlight`; chip
  marks keep their shapes in `CanvasText`; notes keep their room's name.
- Text size: with type in rem and the switches in em, a larger default text size grows every word and moves the layout
  switches with it. Check at Chrome's "Very large" (24 px) at 1440 and 375; on the iPhone, Safari's own text size is
  page zoom and works either way.
- Zoom: 1440 x 900 at 200% is 720 x 450, the phone layout's short form (`08-inbox-720x450`: the inbox's sheet fills
  between the bar and the talk bar); 1280 x 1024 at 400% is 320 x 256, where the bar scrolls away
  (`08-inbox-320x256-scrolled`). Nothing scrolls sideways at any size in the flows' list, and the box always has room
  to type.
- Long content: names, titles and milestones are one line with "…" on nodes, notes, chips, the To and the strip, whole
  in the side panel and in accessible names; the company's name keeps 140 px and gives way last; note titles take three
  lines; the talk bar grows to six lines or a third of the window.

## Agreed with the flows

`docs/design-v3.md`, "Stage and dock", is the flows, structure and words; this file is the look, the numbers it points
to and the motion. After the design gate of 11 Nov 2026 the two were rewritten together.

- **Taken from the flows**: the layouts and where they switch (phones at 720 wide or 480 tall, the short form under
  560 and the scroll-away under 400, floating from 721 to 895, docked from 896, the compact talk bar under a 640 px main
  view, words only under 360); the side panel's widths and defaults; the bar's order of giving way; the talk bar as the
  one box, its order and hint row, its words and states, the compact rows for Stop and a command, several picks as
  faces in the To with their names in the hint row; the strip's kinds, three lines on the office and one elsewhere, how
  lines age (nothing pins; at least a quarter second; skipped for the newest; bursts fold; a fade after 5 quiet minutes; never
  on phones) and "Hide the live strip"; the feed's height and its rise; the mini-map's name and the bar pill's word; the
  board heads' folds; the chart's opening rule (fit, at most 100%, down to the floor), More beside a node, "In
  Design"; cards as links with Move visually hidden, "Part of", "3 of 6 subtasks done", "And 22 more", the Cancelled
  rail; Send's flight targets; the separator and the pull as one control.
- **Taken by the flows from here**: one 12 px gutter (8 on phones); the bar as 44 px tiles in a 68 px band; the side
  panel floating one gutter in; the mini-map on the talk bar's baseline, the thumbnail where the corner is tight; nodes
  216 x 76 and the forms and zooms in The org chart; the open mark; the widths in Layouts; the motion values; a light
  landing line with an ink edge; refused columns and unmatched nodes sinking flat; the 24 px pull.
- **Settled by the lead**: Fit shows its word everywhere; strip lines age as the flows say; the Move sheet keeps
  "Reassign…" and "Cancel the task…"; the talk bar at 1024 is 656 px by the formula; Send's flight timing and path are
  here.
- **Settled in the confirming round** (the lead's round 3, 11 Nov 2026), written in both documents: while the side
  panel floats and shows, everything over the main view lays out in the width it leaves, the talk bar and the 3D office
  keeping the whole width and the mini-map its corner; board heads and the office's top row fold by measuring, in five
  and two steps; the office has Zoom out and Zoom in beside Fit (two 44 px keys on phones); type in rem and switches in
  em; the box's transparent outline; the chart whole from 88% (narrowing to 200 px), compact from 75%, chips down to the
  floor where every chip shows its whole first name; Café Lumen whole at 1440 with the side panel open and at 1024 with
  it hidden (at 1024 with it open it is chips: whole can't fit 680 px); the task board's lanes; one button system; the
  space scale.
- **Where the two differed** and how it was settled, between the two designers: the bar's order gained its fifth step
  (the ledger, the pill's word and Inbox's word below a 957 px window, the inbox then starting with the spend); under
  360 px Actions folds into Company; where even the floor doesn't fit, the chart opens at 40% centred on the CEO (at
  1024 with the side panel open, 6 of Ledger's 9 columns), not with every head in view. Nothing is left open.
