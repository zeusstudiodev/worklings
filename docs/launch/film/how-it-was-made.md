# How the launch film was made

| File | What it is |
|---|---|
| `hero.mp4` | The hero, 82 seconds, 1920 x 1080, silent |
| `hero-720.mp4` | The same at 1280 x 720, under the 10 MB GitHub allows for a video attached in a free account's repository ([Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)). At release it is attached through GitHub's editor; check that it plays in the README page before relying on it |
| `teaser.gif` | 18 seconds of the social cut as a 640-pixel looping GIF, which plays in any README |
| `poster-16x9.jpg`, `poster-9x16.jpg` | The posters, from the opening shot |

A 21-second social cut in 16:9 and 9:16 comes from the same edit. It isn't kept in the repository: it is for posting,
not for the README.

## What was filmed

One real company, from one sentence to done, on 12 November 2026:

- **The sentence:** "A website for my corner bakery, with pickup pre-orders".
- **The company:** the CEO and five people (a designer, a frontend engineer, a backend engineer, a copywriter and a QA
  tester), every one a Claude Code session on Sonnet.
- **The work:** 11 tasks in four milestones (foundation, public site, ordering and admin, verified), in about 74
  minutes of work, for $14 to $15 API-equivalent: the office's estimate from token counts and the published prices.
  Its readings after the company was reopened (below) ranged from $14.15 to $14.74.
- **The result:** an Astro site with pickup ordering and an admin page. The CEO's last report says "nothing is deployed,
  and nothing was pushed except the branch you asked Leo to push".

A Playwright script, the "director", played the stakeholder:

- It started a throwaway hub (its own home folder and port, a private build of the web app) and drove the office in a
  browser as a person would.
- It typed the sentence and answered the CEO's questions with the CEO's own picks.
- It started the company from the org chart and approved the plan.
- It asked the CEO for a change and asked an engineer to push, then answered that push from a phone-sized browser.
- It opened the preview, the dashboards and the feed.

The people's work was not scripted. While it filmed, the director answered what would have stalled the company the way
an unattended stakeholder would:

- **Routine tool asks:** allowed, 11 times.
- **Asks to stop programs, reach outside the project or push:** refused, 9 times. They include a write one folder above
  the project, caught by the office's approvals, and the first take's push.
- **The CEO's questions:** answered 11 times with the CEO's own pick, except one about a browser on this PC, answered
  in words: leave it alone and test without it.

The first hour was one take. It stopped at its cap with two of four milestones done, and it missed a few moments:

- The CEO was busy when the change was asked, so no walk-over was filmed.
- The phone's tap landed on another approval.
- A dev server a desk had left running locked the preview.

The same company was then reopened from its folder by a new hub with the same home, and those moments were filmed
again there:

- the CEO taking the change and walking over to pass it on;
- the push waiting in the inbox and answered on the phone;
- the preview;
- the CEO's last report.

The company finished during that reopen. Each reopen writes "The office restarted and picked up where it stopped" into
the feed, and three of those lines show in the last shot.

## The edit

- **Native camera moves:** the browser drew the office at twice its pixels (3840 x 2160), and the 3D shots were
  zoomed by the office's own camera while filming, so text stays sharp at 1080p. The edit never scales a frame past the
  pixels it was captured at; the portrait cut crops from the same 4K frames.
- **Captions:** Remotion renders one edit list in 16:9 and 9:16. Captions are set in the office's fonts (Barlow, SIL
  OFL) and colours, placed by where the subject sits in each shot.
- **Speed:** every shot that plays faster than it happened says so ("Sped up 4x"). The time-lapse also says how many
  real minutes it covers.
- **Smoothing:** the preview's scroll was smoothed with ffmpeg's motion interpolation, because the screen recorder had
  dropped frames while the PC was busy. Nothing else was retouched.
- **The pull-back near the end:** it was filmed while people were still at work, so it carries no caption. "Done" is
  said over the CEO's actual report.
- **Privacy:** while filming, a guard read the page's text every 300 ms for the machine user's name and home folder,
  and the edit stays clear of any frame it flagged (none in the cut). The address bar never shows, so the hub's token
  never does.

## Not in it

- No Anthropic logo or branding. "Claude Code" appears only as words that say what Worklings works with.
- The hero and README versions are silent, since GitHub and most feeds play video muted.

The director, the edit and the raw footage live outside this repository, because they need a video toolchain (Remotion,
ffmpeg) the project doesn't. Remotion is free for individuals under its licence; a company of four or more people needs
its company licence.
