# How the launch film was made

| File | What it is |
|---|---|
| `hero.mp4` | The film, 30 seconds, 1920 x 1080, 60 fps, silent (12.8 MB) |
| `hero-720.mp4` | The same at 1280 x 720 and 30 fps (5.6 MB), under the 10 MB GitHub allows for a video attached in a free account's repository ([Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)). At release it is attached through GitHub's editor; check that it plays in the README page before relying on it |
| `teaser.gif` | 14.5 seconds of the film, from the made-up company's gathering to Claude Code's last words (the helpers, their costs and the tap on the phone), as a 640-pixel looping GIF at 12 frames a second (6.8 MB), which plays in any README. The lobby's fly-in made a GIF over 9 MB, so it is in the video only |
| `poster-16x9.jpg`, `poster-9x16.jpg` | The posters: Claude Code's helpers at its desk with their costs, and the prompt on the phone |

The cuts with music (16:9 and 9:16, for social posts) are kept outside the repository.

## Real and made up

Every shot carries a small label in its top corner.

- **"Demo data"**: the lobby, the café's office and the all-hands are the static demo's made-up company (Café Lumen),
  the same one https://zeusstudiodev.github.io/worklings/ shows. Nothing in those shots is a real job.
- **"Real Claude Code run"**: the helpers, their costs, the prompt on the phone, the desktop's answer and Claude Code's
  last words are real jobs, filmed while they ran.

No shot is sped up, so no shot carries a "sped up" label. The cuts drop time between shots.

## The shots

The film is cut to the track's beat (174 BPM, one beat is 0.345 seconds); the silent cut has the same timing.

| In the film | Shot | Source | Caption |
|---|---|---|---|
| 0:00.0 | The lobby: the camera glides low over the companies' buildings and dives into the café, whose roof lifts and front walls drop | Demo data | "Your Claude Code." then, on the drop at 0:01.4, "Now with an office." |
| 0:03.8 | Inside: down over the design and engineering rooms, people at their desks with their speech bubbles | Demo data | "Watch it all happen." |
| 0:07.2 | A message to everyone: the whole company gets up and walks to the meeting room | Demo data | |
| 0:10.0 | The gathering, with "From you: Pickup orders ship…" over it | Demo data | |
| 0:12.1 | Claude Code at its desk; three helpers walk over from reception and stand beside it, each with what it was asked | Real, take 5 | "Helpers fan out." |
| 0:14.8 | The camera pushes in on the four of them; beside it, the task board's helper list with each helper's cost as it rises | Real, take 5 | "Every helper, priced." |
| 0:17.6 | The `npm test` prompt on a phone, tapped Allow once at 0:20.0; beside it, the desktop office at the same moment: its card goes and its pill turns from "Waiting for your OK" to "Working" | Real, take 4 | "Approve from your phone." |
| 0:21.7 | Claude Code's last words on the card: "tidewatch is built, and npm test passes: 38 tests, 0 failures." | Real, take 4 | "Done. 38 tests pass." |
| 0:24.5 | End card: the Workling, the wordmark, the repository's address and the plugin's install line | | "Free and open source." |

The real shots come from two takes of the same job. Take 5 was filmed with the labels drawn bigger and the task board
on a phone-sized page, so its helpers and costs read better; take 4's desktop showed the prompt itself on its card at
the moment of the tap (take 5's showed Claude Code's earlier words first). Each shot is one take's own footage at one
moment; nothing from one take is laid over another.

## The real jobs

Each take was one job in a throwaway hub (its own home folder and port), one unmodified Claude Code session on Sonnet
(`ANTHROPIC_MODEL=sonnet`), signed in as usual, with the machine's own Claude Code setup: nothing in it was moved or
copied. The words, typed into the start form through the hub's API:

> Build tidewatch, a tiny Node CLI that prints the next high and low tides for a harbour from a JSON table. Keep a todo
> list and write the code first. Then start three subagents together in one message: one writes the node:test tests,
> one writes the README, and one adds a second harbour's tide table with a check that it loads. Wait for all three, then
> run npm test. No questions needed.

The project was an empty folder under `C:\Projects`, made for the film and removed after each take. Its
`.claude/settings.json` set `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (so Sonnet keeps the todo list the task board shows),
`acceptEdits`, allowed Read, Glob, Grep, Bash and PowerShell, denied the browser tools' MCP servers, and asked for
`npm test`, so the test run is the prompt the phone answers. A short `CLAUDE.md` asked it to keep the project small,
skip questions and browsers, and start subagents together and wait for them.

A Playwright script, the director (`scripts/launch/film/director.mjs`), played the stakeholder:

- It started the job and opened four browsers on it: the desk in 16:9 and in 9:16 with the office's panels hidden and
  the film camera on the desk, the task board on a phone-sized page, and the phone.
- It pushed the camera in when the helpers came, and framed the front desk when the prompt came (Claude Code takes its
  paper there to wait for you).
- On the phone it tapped Next past Claude Code's earlier words to the prompt, waited four seconds and tapped Allow
  once. A desktop browser filmed the office's own answer at the same moment.
- Off camera it allowed Claude Code's other prompts once, within half a second (`node --test …`, `node bin/tidewatch.js
  …`). It sent no words to the session.

The sessions' work was not scripted. Claude Code ended a turn while its helpers worked ("Second harbour is done. Still
waiting on the tests agent."), as it does; those words wait on the card like any others.

**What it cost:** take 4's job came to $0.85 and take 5's to $0.88, API-equivalent (the office's estimate from token
counts and the published prices); in take 5 the helpers came to $0.13, $0.09 and $0.10 of it. All five takes came to
$4.64. The director's dry runs used `test/fake-desk.mjs` and cost nothing.

**The takes:**

1. $1.07. The helpers were filmed, but the director read a pause between Claude Code's turns as the end of the job and
   missed the `npm test` prompt. It now waits for the prompt itself.
2. $0.89. Complete, but framed too wide at the prompt.
3. $0.95. Complete, closer at the front desk; the desk doesn't visibly change at the tap, so the next takes also film
   the desktop's own answer.
4. $0.85. Kept for the phone, the desktop's answer and the last words.
5. $0.88. Pages drawn at two pixels a point (bigger labels) and the board on a phone-sized page. Kept for the helpers
   and their costs.

## The demo shots

Filmed from the web app served by Vite with the film camera, on the demo's own data, by
`scripts/launch/film/demo-shots.mjs`. The all-hands is the demo's real behaviour: the director typed "Pickup orders ship
today. Thank you!" to everyone in the talk bar, off camera, and the made-up company gathered as the office always
shows it.

## The camera and the edit

- **The camera:** `web/src/scene/filmCamera.tsx`, built only into a web app made with `VITE_WORKLINGS_FILM=1`; every other
  build, the npm package and the demo leave it out. It takes keyed moves (target, angle and zoom), runs them through a
  Catmull-Rom curve with one ease over the whole move, and answers where the label anchors are. The office's panels
  were hidden with a style the director added to the page; the 3D labels and speech bubbles are the office's own.
- **Pixels:** pages drawn at 2 pixels a point (960 x 540 points for 1920 x 1080), so labels read a third bigger than at
  1.5; the phone at 405 x 720 points, 2.67 pixels a point. Chrome's screencast at 60 fps, 45 to 60 frames a second
  arriving (held to their own times).
- **The edit:** `scripts/launch/film/mkcut.mjs` writes the cut list, `edit.mjs` cuts it with ffmpeg and lays on the
  captions and labels, which `overlays.mjs` sets in the office's own fonts (Barlow Semi Condensed and Barlow), ink on the
  office's cream badge with the key words on the wordmark's highlighter. The 9:16 cut uses its own vertical takes, the
  board's phone-sized page and the phone full frame.
- **The end card's install line** is the plugin's (`claude plugin marketplace add zeusstudiodev/worklings`), since the
  npm package isn't out yet.
- **Privacy:** while filming, the director read every page's text every 300 ms for this machine's user name, home
  folder and the private terms of `scripts/check-public.mjs`, and found none. The address bar never shows, so the hub's
  token never does. The clock time on the prompt ("No answer by 11:04 AM") is the machine's.
- **Encoding:** H.264 for the videos (the hero at CRF 23), a 128-colour palette for the GIF.

## Music

The social cuts (not in the repository) use "Elevate" by Fupi from OpenGameArt,
https://opengameart.org/node/109773 ("Elevate (+ instrument tracks)"), licensed CC0 1.0: no attribution required, commercial use
allowed. The film starts 51.0 seconds into the track, so its drop lands on "Now with an office." The README's film is
silent.

## Not in it

- No Anthropic logo or branding. "Claude Code" appears only as words that say what Worklings works with.
- Nothing faster than real time, and nothing made up outside the shots labelled "Demo data".

The film scripts need ffmpeg, which the project doesn't install. The raw footage lives outside the repository.
