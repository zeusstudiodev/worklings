# Why Worklings leaves Claude Code alone

Worklings is Claude Code with an office around it: your own, unmodified Claude Code sessions, with one inbox for what
they ask, live costs per job and per helper, budgets, their to-do lists and helpers on screen, and several projects at
once in a 3D office. This page is why it is built that way, and the measurements behind it.

We first tried to make Claude Code better with an org chart: a company of agents, with a CEO, heads and makers, each one
a Claude Code session. We measured that company against one plain Claude Code session four times. It never reliably beat
it, it cost more and it needed a person to step in more often. Each loss traced back to something the company changed
about how Claude Code works.

So we stopped steering Claude Code and built what was missing around it: a way to see, control and enjoy many sessions at
once. A test now holds Worklings' launch of Claude Code to plain `claude -p`, and a paired benchmark found the same
results and the same cost as plain Claude Code. Every number below comes from a bench report, named where it is used.

## What we built

The first versions (0.1.0, then v0.2 to v0.6 on working branches) ran a company. A CEO asked scoping questions, proposed
an org and a plan, and the person approved it. Heads split the work into tasks, makers built them, and reviewers checked
them. Each person was a Claude Code session with its own desk, prompt, tools and approvals. Messages went through org
tools over MCP. Later versions shrank the company: a Lead, a Builder, a Tester and a Reviewer (v0.4), then a Lead, one
Builder and a Reviewer with a fix round (v0.5 and v0.6).

## How we measured it

- **Two arms on the same task:** one Claude Code session given the task once, and the company given the same words.
- **Same model:** Sonnet for every builder.
- **Same effort and a neutral setup** from v0.4 on: both arms load only the project's and local settings, with no user
  CLAUDE.md, user skills or MCP servers, and the one session runs at the effort of the company's Builder (high). v0.3 did
  not do this; see below.
- **Hidden tests** the sessions never see: core acceptance tests, edge cases and, for the full-stack task, UI flows
  driven in a browser at 1440 and 375 px.
- **A blind review:** Opus reads both projects as "solution 1" and "solution 2", runs their installs, builds and tests,
  and scores them from 1 to 10 on six criteria and overall. Each review has two rounds with the order swapped, so a
  preference for a position cancels out.
- **Step-ins:** each time the company stopped for its person: an approval or an answer. The one session ran headless on
  one prompt, so nobody stepped in there.
- **Cost:** Claude Code's own figure for the one session, the office's estimate from token counts at list prices for the
  company. Both are API-equivalent.
- One run per arm and task. That is the weak point, and the reason v0.7's bench was built differently.

The bench scripts are in [scripts/bench/](../scripts/bench/). The task files and raw outputs are not in the repo.

## The results

| Bench | The company | Tasks | Blind review (1 to 10), one session / company | Hidden tests passed, one session / company | Company cost vs one session | Step-ins per company run |
|---|---|---|---|---|---|---|
| v0.3, 14 Nov | Job titles, two versions | 3 | 8.8 / 6.7 and 6.3 | 79/79 / 79/79 and 75/79 | 1.12x and 0.94x | 2.0 and 1.0 |
| v0.4, 15 Nov | Lead, Builder, Tester, Reviewer | 4 | 8.5 / 7.3 | 160/160 / 158/160 | 1.96x (1.35x to 7.1x per task) | 3.5 |
| v0.5, 15 Nov | Lead, one Builder on the person's words, Reviewer, fix round | 3 | 8.5 / 8.0 | 160/160 / 160/160 | 1.22x (1.04x to 3.7x per task) | 2.7 |
| v0.6, 15 Nov | v0.5 with a strict Opus Reviewer | 2 | 8.5 / 8.0 and 8.0 / 8.5 | 131/131 / 131/131 | 1.9x and 2.4x | 9 and 24 |

Sources: the v0.3, v0.4 and v0.5 bench reports; for v0.6, the reports of its runs and the notes of its reviews. v0.5
reused v0.4's one-session outputs, and so did v0.6 for the household task. The book club task has no hidden tests, so
v0.3's 79 tests cover two of its three tasks. The bookshop's UI suite had a bug of its own, fixed before its score
counted. The tasks: a feature in existing code, a markdown link checker (a CLI), a book club web app, a household web
app with an API and UI flows, and a second-hand bookshop's stock app.

- **Head to head**, scores within 0.25 counting as a tie: the company lost 13 of 15 comparisons. From v0.4 on, with the
  fair setup, it lost 7 of 9. It won two: the feature task in v0.5 (9.0 against 8.0, at 3.7x the cost) and the bookshop
  in v0.6 (8.5 against 8.0 over two reviews, at 2.4x the cost).
- **Would the reviewer ship it?** One session: 6 of 6 rounds in v0.3, 8 of 8 in v0.4, 4 of 6 in v0.5. The company: 0 of
  12 in v0.3, 0 of 8 in v0.4, 2 of 6 in v0.5.
- **Time:** the company took longer in every bench (median 5.3 and 6.8 min against 4.2 in v0.3, 9.9 against 5.3 in v0.4,
  6.8 against 5.5 in v0.5).
- **Noise:** the same one-session outputs scored differently in different reviews: the feature 9.0, then 8.0; the
  household app 9.0, 9.0 and 8.5. With one run per arm and absolute scores, a gap under about 1 point means little. The
  company's two wins are at or inside that.
- **v0.3 was not a fair fight.** Its one session ran the maintainer's own Claude Code setup (a strict global CLAUDE.md,
  108 skills, 7 MCP servers, effort xhigh), while every company desk ran lean at medium effort
  ([SPEC-v0.4.md](../SPEC-v0.4.md)). v0.4 made both arms neutral at the same effort. On v0.3's three tasks the neutral
  session scored 8.3 against the earlier 8.8, so setup and effort explain part of v0.3's gap; the company still trailed
  by 1.2 points in v0.4.

## Why the company lost

Every loss we could trace came from something the company changed about the work, not from a lack of hands:

- **A paraphrased brief.** In v0.3 a manager passed the maker its own summary of the request, not the request.
- **A smaller finish line.** In v0.4 the Builder aimed at each milestone's acceptance tests and stopped when they passed.
  The reviews called its work correct and faithful to the spec but minimal: a plainer UI, fewer conveniences and thinner
  tests, where the one session added polish, secure defaults and extra edge cases.
- **Stripped tools and setup.** Lean desks got only the tools their role was assigned, with no web tools, and in v0.3
  none of the skills and setup the one session had.
- **Lower effort.** v0.3's company desks ran at medium.
- **A long appended prompt.** 27 kB of the office's text on top of Claude Code's own ([SPEC-v0.7.md](../SPEC-v0.7.md)).
- **Approvals the one session never faced.** Most step-ins were the office's own policy asking about inline `node -e`
  and `python -c` scripts, which the one session, running without prompts, never had to ask about.
- **Fixed overhead.** The Lead, Tester and Reviewer cost about $0.6 to $1.5 a run whatever the size of the job, which is
  how a feature that one session built for $0.12 cost the company $0.85 (v0.4).
- **A lenient internal review.** In v0.5 the company's own Reviewer (Sonnet, medium effort) passed every requirement, so
  its fix round never ran (and a bug, found later, meant review findings could not have reached the Builder anyway). The
  gaps the blind review found were polish and edge cases, not unmet requirements.

The one change that helped, once, was **a strict independent review followed by a fix round** (v0.6): a Reviewer on Opus
that runs the app as a user would and hunts past the happy path. On the bookshop it found a real bug (on Node 22.5 to
22.12, `node:sqlite` needs a flag, so `npm start` crashed though the request said "Node 22 or later"), the Builder fixed
it, and both blind reviews named the same difference: the company wrote automated UI tests and the one session wrote
none. The company came out 8.5 against 8.0, inside the noise, at 2.4x the cost. On the household task a broken
acceptance check used up both fix rounds before the review ran, and the company scored 8.0 against 8.5. Anyone can add
the same review step to plain Claude Code.

Outside work points the same way. Anthropic's write-up of its
[multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) finds that parallel
agents win on breadth-first research, use about 15 times the tokens of a chat, and fit work with tight dependencies,
including most coding, poorly. Cognition's [Don't build multi-agents](https://cognition.ai/blog/dont-build-multi-agents)
argues that agents that don't share the full context make conflicting implicit decisions, which is what our paraphrase
and milestone losses look like.

## What Worklings became

v0.7 ([SPEC-v0.7.md](../SPEC-v0.7.md)) stopped trying to beat Claude Code with an org chart. A new job is one unmodified
Claude Code session on the person's own words, with their own setup, tools, model, effort and permission mode. The
office around it adds what a terminal doesn't have: one inbox for Claude Code's own permission prompts and end-of-turn
questions, its todo list as a task board when the model keeps one, its subagents as helpers with their own cost,
budgets, a lobby of projects, a studio chat across them, and a phone layout over the person's own tailnet. The team of roles is still there as an experimental option.

"Not worse than Claude Code" is built in, then checked:

- **A parity contract test** ([test/parity-contract.test.ts](../test/parity-contract.test.ts)) builds a job's launch
  and compares it with plain `claude -p` on the same inputs. It passes only if the differences are exactly the allowed
  list in [src/core/plain.ts](../src/core/plain.ts): the flags the office reads the stream with, a session id so a job
  can be resumed, a budget cap that stops a job but never steers it, and one settings file with the office's hooks.
  Adding a flag, appending prompt text or removing a tool fails it. One known gap is written into the test: `CLAUDE_CODE_*`
  variables set in the shell that starts Worklings don't reach the session (the same variables set in Claude Code's
  settings files do).
- **The office refuses one thing** Claude Code would allow: stopping programs machine-wide, by name, pattern or port
  lookup. Everything else is asked exactly when Claude Code would ask.

## The parity bench

Blank Claude Code against blank Claude Code inside Worklings (the v0.7 bench report).

- **Setup:** 20 pairs, two per task over 10 tasks. Existing code: a bug fix, a feature, a refactor guarded by tests and
  a change across several files. New projects: two web apps, a CLI, an API, a game and a data script. Both arms used a
  blank profile (project and local settings only, an empty MCP config, no user CLAUDE.md), Sonnet, Claude Code's
  default effort and the same permission mode.
- **Judge:** Opus, one request with no tools, reads both projects' changed files under neutral names, twice with the
  order swapped. A pair scores 1 for a win, 0.5 for a tie and 0 for a loss, averaged over the two orders.
- **Intervals:** 95%, bootstrapped and clustered by task, following Anthropic's
  [Adding error bars to evals](https://arxiv.org/abs/2411.00640).

| Measure | Result |
|---|---|
| Hidden tests | Worklings 4.7 points higher (95% -0.7 to 14.9), all of it one plain run whose game never served (0/42) |
| Blind judge, mean pair score | 0.46 (95% 0.29 to 0.64), where 0.5 is a tie |
| Pairs where Worklings was at least as good | 60% (95% 35% to 80%) |
| Cost | 1.01x plain (95% 0.92 to 1.08); median pair 0.94x |
| Wall time | 1.21x plain by the mean (95% 0.99 to 1.54); median pair 1.04x |
| Prompts to the person | 0 for Worklings, 0 for plain |

By task, the judge preferred the Worklings arm on the feature task in both pairs and the plain arm on the API and the
game in both pairs. The other six tasks were split or tied. The whole of v0.7, runs, judges and probes included, cost $36.25.

### Honest caveats

- **The bench's own decision rule failed.** It asked for the lower bound of "at least as good" to reach 45% and for wall
  time to stay under 1.15x. Neither held.
- **The preference bound was too strict for 20 pairs.** With this judge's 25% exact ties, two identical arms would be at
  least as good in about 63% of pairs, and with 10 task clusters the interval's lower bound sits well below that. The rule
  could fail for identical arms. We should have checked that before running it.
- **The time gap came from two hung runs, both in the Worklings arm.** In the API and link-checker tasks, the session's
  own `npm test` started a server and never exited, until Claude Code's 300-second Bash timeout. The test script was the
  model's, and nothing in the office touched it; a plain session that wrote the same test would hit the same timeout,
  though none did in this bench. It put those runs at about 440 s against 110 to 145 s.
- **The hidden-test gap is one run.** A plain game run wrote its package.json with a byte order mark, so its app never
  served. Apart from it, Worklings passed three fewer hidden tests than plain, out of 776 per arm.
- **No prompts on either side** partly because both arms ran in `bypassPermissions` mode: a headless plain session has
  nobody to answer. The bench shows the office adds no prompts of its own; it doesn't exercise the inbox.
- **Small numbers.** 20 pairs over 10 tasks, on Windows, with one model. "No difference 20 pairs can detect" is not
  "the same".
- **A separate check on the maintainer's own setup** (the maintainer's CLAUDE.md, skills and plugins, two tasks, one run each): ties on
  both, with the same hidden tests passed. The Worklings desk loaded the same setup as plain Claude Code.

## What it means if you build agent harnesses

- **Compare against a plain session first,** with the same model, effort and setup. Our first bench measured setup and
  effort as much as structure.
- **Pass the person's words through verbatim.** Every paraphrase drops something.
- **Don't give the agent a smaller finish line than the request.** Milestones and acceptance tests became the target.
- **Don't strip the agent's tools or setup to save tokens** until you've measured what it costs in quality.
- **Every prompt you append is a change to the work.** Keep it near zero, and keep it byte-for-byte stable so the prompt
  cache holds.
- **Ask when the agent's own rules would ask,** not more. Extra approvals cost the person's attention and bought nothing
  we could measure.
- **A strict independent review and a fix round** was the one addition that helped, once, at about twice the cost. It is
  an evaluator and optimizer loop, and it works when the criteria are clear.
- **Measure in pairs, repeat runs and cluster by task.** Absolute 1 to 10 scores moved by a point on the same outputs.
- **Check your decision rule against two identical arms** before you run the bench.
- **Watch the bench itself.** Model-written tests that never exit and a byte order mark moved our numbers more than the
  thing we were measuring.

## What it means if you use Worklings

- **Your Claude Code works as it always does,** with your CLAUDE.md, skills, plugins, permission rules, model and effort.
  Worklings adds no prompt of its own to a job and asks you exactly when Claude Code would ask.
- **What you get on top** is the part a terminal doesn't give you: every job in one lobby, its prompts and questions in
  one inbox (on your phone too), what it costs while it runs, its to-do list and helpers on screen, and budgets that
  stop it.
- **Anything that changes how Claude Code works is opt-in,** shows its cost first and, before Worklings recommends it, has
  to beat plain Claude Code in a benchmark like the one above. The team of roles is there as an experiment for that
  reason.

If you measure something different, we'd like to hear it.
