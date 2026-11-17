# How the launch film was made

| File | What it is |
|---|---|
| `hero.mp4` | The hero, 39 seconds, 1920 x 1080, 30 fps, silent |
| `hero-720.mp4` | The same at 1280 x 720 (2.4 MB), under the 10 MB GitHub allows for a video attached in a free account's repository ([Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)). At release it is attached through GitHub's editor; check that it plays in the README page before relying on it |
| `teaser.gif` | 14 seconds of the hero (from the office to the tap on the phone) as a 640-pixel looping GIF, which plays in any README |
| `poster-16x9.jpg`, `poster-9x16.jpg` | The posters: the office with Claude Code and its two helpers, and the prompt on the phone |

## What was filmed

Worklings 0.3.0 as it stood on the `run/v0.8` branch, on 17 November 2026, with three real jobs started in a row from
the lobby. Each job is one unmodified Claude Code session on Sonnet (`ANTHROPIC_MODEL=sonnet`), signed in as usual,
with the machine's own Claude Code setup: nothing in it was moved or copied. The three sentences, typed into the start
form:

- **plant-swap:** "A one-page site for our street's plant swap: date, place, what to bring, and a sign-up form that
  remembers who is coming. One index.html, no libraries. No questions needed."
- **seed-snake:** "A tiny browser game in one index.html: a snake that eats seeds and grows, with a score and R to
  restart. No libraries. No questions needed."
- **tidewatch** (the one the film follows): "Build tidewatch, a tiny Node CLI that prints the next high and low tides
  for a harbour from a JSON table. Keep a todo list, write the code, then have one subagent write the node:test tests
  and another the README, then run npm test. No questions needed."

Each project was an empty folder under `C:\Projects`, made for the film and removed after it. Its
`.claude/settings.json`:

- `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, so Sonnet keeps the todo list the task board shows (it keeps none by default);
- `permissions.defaultMode: acceptEdits`, `allow` Read, Glob, Grep, Bash and PowerShell, and `ask` for `npm test`, so
  the test run is the prompt the phone answers;
- `deny` for the browser tools' MCP servers this machine has, because the first take's sessions reached for a browser.

And a short `CLAUDE.md`:

> - A small project for a short screen recording. Build it in this folder and keep it small.
> - Skip questions, plans for approval, reviews and device checks: decide yourself and say what you decided.
> - Don't open a browser or use browser tools. Check what you built with node.
> - When you use subagents, start them together in one message and wait for them; don't end your turn while they work.
> - Name files by their path inside this folder. Finish with a short summary of what you built and how you checked it.

In the first four takes Claude Code started both subagents in the background anyway and ended a turn while they worked
("Both subagents are running... I'm waiting for them to finish before I run npm test."). Those words stayed on the inbox
card after the session had moved on, so the phone showed "1 of 2" and had to tap Next to reach the prompt, and the
finished job read "Waiting for your OK" under "Claude Code asks you.". That was fixed before the kept take: the office
now takes back a session's end-of-turn words when it goes on by itself, says "Your turn" for a job that only waits for
a reply, and "Claude Code asks you." only over words that end in a question. In the kept take the prompt is the only
thing on the phone's card.

A Playwright script, the "director", played the stakeholder against a throwaway hub (its own home folder and port):

- It typed the three sentences and started the three jobs, then opened Tidewatch's office.
- It opened the task board from More.
- It answered the `npm test` prompt from a phone-sized browser (390 x 844 points), tapping Allow once on the inbox card.
- It opened the results and Tidewatch's last words, then went back to the lobby.

The sessions' work was not scripted. Off screen, the director allowed the other prompts once, through the hub's API, a
few seconds after each arrived: two in the kept take ("Run game logic checks in node" and "Run page script against
stubbed DOM"). It sent no words to any session.

**What it cost:** the kept take's three jobs came to $0.83 API-equivalent, the office's estimate from token counts and
the published prices: Tidewatch $0.60 (of which its helpers $0.12 and $0.09), the plant swap page $0.14 and the game
$0.10. The whole job, from the first sentence to Tidewatch's last words, took 2.2 minutes. All five takes together
came to $5.47.

**The takes:**

1. $1.50. The phone shot failed: the card showed Claude Code's earlier words first and the director didn't move on to
   the prompt. The projects were on a substituted drive letter, which Claude Code resolved to the real folder under the
   user folder, so the projects moved to `C:\Projects`. The prompt read "Run Run npm test", a bug in how the inbox
   words a command's description, fixed before the next take.
2. $1.20. The phone shot failed again: the director looked for the Next button by the wrong name.
3. $0.97. Complete, but the `npm test` prompt came seconds after the board opened, so the board was only on screen
   sped up, for under half a second.
4. $0.97. The first cut was made from it, with the board held in real time before any speed-up. Its frames showed the
   stale words and the "Waiting for your OK" wording above, which were fixed in the office.
5. $0.83. Kept: the same director and edit, on the fixed office.

## The shots

| In the film | Shot | Speed |
|---|---|---|
| 0:00 | The lobby: three sentences typed, three jobs started | Sped up ×4 |
| 0:06 | Tidewatch's office opens: the person at the desk | Real time |
| 0:08 | The office while Claude Code builds; two helpers appear with their own labels | Sped up ×8 |
| 0:10 | The helpers at work, then More (1 at work), Tasks: Claude Code's list and its helpers' costs | Real time |
| 0:16 | The board: two of three done, `npm test` doing, and Waiting for your OK | Real time |
| 0:18 | On the phone: the prompt on the card, Allow once | Real time |
| 0:22 | The plant swap page | Real time |
| 0:26 | The snake game, played | Real time |
| 0:30 | Tidewatch's last words: "Claude Code finished its turn.", "npm test passes: 8 tests, 0 failures", and Your turn | Real time |
| 0:34 | The lobby, three jobs at Your turn | Real time |
| 0:37 | End card | |

## The edit

- **Pixels:** the browser drew the page at 1.5 times its 1280 x 720 points, so the screencast's frames are a native
  1920 x 1080 and nothing is scaled up. The phone was drawn at twice its points and is shown at 470 x 1016 inside a
  drawn frame, beside one line of text.
- **Speed:** every piece that plays faster than it happened says so on screen. The office's ×8 pieces carry the
  "Sped up ×8" pill the director put in the page while filming, so the label is in the footage itself; the lobby's
  typing gets the same pill, set in the office's font, laid on in the edit. Pieces without a pill play in real time.
  The cuts drop time without saying so: between the shots, and while the jobs finished after the tap. A sped-up piece
  that would be under 0.6 seconds on screen is left out rather than flashed (the board's wait for the prompt, here).
- **The results** (0:22 to 0:30) are the kept take's own `index.html` files, opened again in the same browser after
  the take ended, because the take's own footage caught the game already over: it starts moving as soon as the page
  loads. The director pressed R and steered with the arrow keys, reading where the snake and the seed were from the
  game's own state. The pages themselves are as Claude Code wrote them.
- **The cursor** in the browser is drawn by the director, since a screencast has none; it also shows on the phone.
- **Privacy:** while filming, a guard read the page's text every 300 ms for this machine's user name, home folder and
  private terms, and found none in any shot. The address bar never shows, so the hub's token never does. The clock
  time on the phone's prompt ("No answer by ...") is the machine's.
- **Encoding:** ffmpeg, H.264 for the videos and a 128-colour palette for the GIF.

## Not in it

- No Anthropic logo or branding. "Claude Code" appears only as words that say what Worklings works with.
- No sound: GitHub and most feeds play video muted.

The director, the edit and the raw footage live outside this repository; they need ffmpeg, which the project doesn't.
