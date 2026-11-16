# Worklings v0.7: Claude Code, with an office around it

The maintainer, 15 Nov 2026, after four benches:

> "the right comparison is a blank Claude Code and a blank Claude Code with Worklings. […] the main point is the UI for
> control and organization and granularity, besides fun, but also ensure it's not worse than normal Claude Code (at
> minimum the same, not worse)"

> "research and understand and plan smartly, without just going trial and error, as it needs to be valid for many use
> cases"

So v0.7 stops trying to beat Claude Code with org charts. The work runs in Claude Code as Claude Code would run it.
Worklings is the office around it: control, organization, a fine-grained view of what is happening, and fun. "Not worse"
is a property we build in and then confirm, not something we search for by trial and error.

## Decisions (the maintainer, 15 Nov 2026)

- **Setup:** the main session loads what his normal Claude Code loads. Lean desks stay as an option.
- **Approvals:** the office asks exactly when Claude Code would. Only machine-wide kills are refused outright.
- **Plan step:** optional and off by default, using Claude Code's own plan mode, approved in the inbox.
- **Parity bench:** two runs per arm and task, about USD 60.

## What four benches taught us (v0.3 to v0.6)

- **Splitting a job among roles never beat one session** on tasks of 5 to 25 minutes. It scored 1 to 1.5 points lower,
  at 1.4 to 7 times the cost, with 3 to 24 step-ins per run against none.
- **Every loss traced to something Worklings changed in the work itself:**
  - a paraphrased brief;
  - milestone tests the Builder treated as the finish line;
  - stripped tools and setup (no skills, no TodoWrite, no web);
  - lower effort;
  - a 27 kB appended prompt;
  - a stricter approval policy than Claude Code's own.
- **The one thing that helped was a strict independent review followed by a fix round** (an evaluator–optimizer
  loop). It brought the company level with one session or slightly ahead, at about twice the cost. Anyone could add the
  same step to plain Claude Code, so it is an optional extra, not the reason Worklings exists.
- **Measurement noise is about 1 point.** The same outputs scored 9, 9 and 8 in different reviews. With one run per arm
  and absolute 1–10 scores, no gap under about 1 point means anything. Our task suite was also nearly all new projects
  (only `feature` starts from existing code), while most real Claude Code work happens in existing code.

## What outside work says

- **Anthropic's multi-agent research system** (anthropic.com/engineering/multi-agent-research-system):
  - parallel subagents win on breadth-first research;
  - they use about 15 times the tokens of a chat;
  - token spend explains most of the quality difference;
  - work with tight dependencies, which includes most coding, is a poor fit.
- **Cognition, "Don't build multi-agents"** (cognition.ai/blog/dont-build-multi-agents): agents that don't share the
  full context make conflicting implicit decisions. That matches our milestone and paraphrase losses.
- **Anthropic, "Building effective agents"** (anthropic.com/engineering/building-effective-agents): start with the
  simplest setup that works. The evaluator–optimizer loop pays off when the evaluation criteria are clear, which
  matches v0.6.
- **Anthropic, "Adding error bars to evals"** (arXiv 2411.00640): compare paired runs, cluster by task, and repeat runs.
  That is how the parity bench below is designed.

## Principle: parity by construction

By default a job runs one unmodified Claude Code session. Worklings watches and controls it, and never rewrites how it
works. Compared with running `claude` in the same folder, the person gets:

| | Plain Claude Code | Worklings default |
|---|---|---|
| Prompt | The person's words | The same words verbatim. Nothing appended about how to work. |
| Setup | User, project and local settings: CLAUDE.md, skills, MCP servers, permissions | The same setting sources. Lean desks become an option for saving money. |
| Tools | The full default set, including Agent, TodoWrite and web tools | The same set |
| Model and effort | The person's defaults | The same, and changeable per job in the office |
| Permissions | The person's permission mode and rules. Claude Code asks when its rules say so. | The same mode and rules. The office shows exactly the prompts Claude Code would show, in the inbox. |

**Allowed differences**, none of which change the work:
- flags for observing the session (stream-json, verbose);
- session persistence, so a job can be resumed;
- a budget cap that stops a job but never steers it;
- a short list of refusals for actions that would harm the computer, such as machine-wide kills.

**The parity contract.** A unit test builds the default Builder's launch and checks it against plain `claude` with the
same inputs. It passes only if the differences are exactly the allowed list above. Any change that adds a flag, appends
prompt text or removes a tool fails it. This makes "not worse" a reviewed property of the code, and the bench below
confirms it.

## What Worklings adds

- **Control:**
  - start, pause, resume and stop;
  - budgets per job and per portfolio;
  - approvals and questions in one inbox;
  - steering by message mid-run;
  - model and effort per job;
  - a handover at the end.
- **Organization:**
  - one company per project;
  - portfolios with a shared brief and budget;
  - the studio chat across companies;
  - timeline and history.
- **Granularity**, from Claude Code's own structure, read from the stream without changing it:

  | Claude Code | In the office |
  |---|---|
  | The session | The person at the desk |
  | Subagents (Agent tool) | Helpers beside the desk, each with its own cost |
  | TodoWrite list | The task board, live |
  | Tool calls | Desk activity and the timeline |
  | Plan mode | The plan, waiting for approval in the inbox |
  | Permission prompts and end-of-turn questions | The inbox |

- **Fun:** the office, the people and the talk.
- **Optional extras.** These are off by default and turned on per job, with the cost shown first. Each says which kinds
  of task it is for, and each needs its own measured benefit before it is ever suggested:
  - **Strict review and fix round.** Evidence: v0.6, large tasks, about a tie at twice the cost.
  - **Parallel Builders for jobs that divide along a contract.** Untested.
  - **Best of two.** Untested.
  - **Plan first:** Claude Code's own plan mode, approved in the inbox.

The company look survives without changing the work. With plan first on, the "Lead" who presents the plan is the same
session that then builds it. Helpers appear whenever Claude Code itself fans out. A Reviewer appears when the review
extra is on. Several projects run as several companies on the floor.

## Proving "not worse"

All of this is designed before anything runs. Since parity is built in, the bench confirms it rather than searching. If
it fails, the parity contract shows where the difference came from.

**1. Parity bench: blank Claude Code against blank Claude Code inside Worklings.**
- **The two arms.** Both use a clean config directory with no user settings, the same model (Sonnet) and the default
  effort. One arm runs `claude -p`; the other runs Worklings with its defaults.
- **Task suite.** It covers the kinds of work Claude Code is used for, with existing code first. Each task has hidden
  tests.
  - Existing code: fix a bug, add a feature (`feature`), a refactor guarded by tests, a change across several files.
  - New projects: a web app (`household`, `bookshop`), a CLI (`link-checker`), an API (`api`), a game (`game`), a data
    script.
  - That is ten tasks. Four of them are to be written: the bug fix, the refactor, the multi-file change and the data
    script.
- **Runs.** Two runs per arm and task: 20 pairs.
- **Metrics:**
  - hidden tests, the main and objective measure;
  - a blind pairwise preference from Opus, judged in both orders, scored as win, tie or loss (paired comparisons are far
    less noisy than absolute scores);
  - cost and wall time;
  - prompts to the person, compared with what Claude Code itself would have asked in the same mode.
- **Decision rule**, with intervals clustered by task:
  - hidden-test pass rate within 2 points of plain;
  - Worklings judged at least as good (win or tie) in at least 45% of pairs, at the lower confidence bound;
  - cost at most 1.1× and wall time at most 1.15×;
  - no more prompts than plain.

**2. Own-setup check.** The maintainer's own setup, plain against inside Worklings, on two tasks, one run each. This
confirms the pass-through: his CLAUDE.md and skills load, and his kickoff questions land in the inbox.

**3. Extras, measured one at a time against the parity baseline, and only after parity holds.** Each extra runs on the
task kinds it claims to help, with the same paired method. If an extra doesn't help on a kind of task, the office
doesn't suggest it there.

## What carries over from v0.4 to v0.6

- **Keep:**
  - helpers beside the desk (v0.4);
  - the fix in how review findings reach the Builder's task (v0.6);
  - the strict review, as an extra;
  - the bench's neutral arm and kill deny rules;
  - the `bookshop` task;
  - prompts of any length through the brief file.
- **Park**, still selectable for experiments:
  - role seats (Lead, Builder, Tester, Reviewer) and the classic company;
  - acceptance tests first;
  - the appended quality bar;
  - lean desks as the default.
- **Drop:** the auto-allow for read-only one-liners. Five security reviews each found a critical way around it.

## Order of work

1. The parity contract and its test, and the default Builder's launch changed to pass the test.
2. Pass-through: setting sources, tools, permission prompts and questions to the inbox, and plan mode as plan approval.
   Check each against the installed Claude Code's `--help` and the docs first.
3. Granularity: the TodoWrite list on the task board, subagents as helpers with their own cost, tool calls on the
   timeline.
4. The four new existing-code tasks with hidden tests, then the parity bench and the own-setup check.
5. Only then the extras, one at a time.

Done for v0.7:
- the parity contract test;
- the parity bench passing its decision rule;
- the own-setup check;
- typecheck, lint, `lint:library`, unit tests, the e2e projects with only the known failures, and the privacy scan;
- screenshots at 1440 and 375 px of the office during a run that shows the task board and helpers.
