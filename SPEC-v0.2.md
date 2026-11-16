# Worklings v0.2: leaner companies, built for big one-shot tasks

Branch `run/v0.2` from the 0.1.0 release candidate (f9ee0e3), in the worktree `headcount-v02` next to the repository.
Checklist and log: `.claude/runs/v0.2/`.

## Goal

The maintainer, 13 Nov 2026: "reduce token spending, make things leaner, and ensure the project is worth using, especially for
bigger one-shot tasks; we can position ourselves in that space."

A company given one prompt for a big job (hours of work, many parts) finishes with a better result than one Claude Code
session using plan mode and subagents, at a token cost that is defensible. On a small job it doesn't waste tokens.

## How we know

- **Quality first, then cost.** No cut ships unless the benchmark's quality holds: hidden tests, and a blind two-round
  expert review against one session with plan mode and subagents. The launch thread runs the before and after
  comparisons. The run format is agreed with it: the same tasks, models and caps, a big one-shot task among them.
- **Cost, measured.** `scripts/accounting.ts` breaks a company run's tokens down:
  - by person;
  - by the kind of turn, both what began it (a brief, a relay, a nudge, an answer) and what it did (planning,
    briefing, relaying, making, checking, status, idle);
  - into uncached input, cache writes, cache reads and output.

  It also gives each desk's fixed overhead. Every cut is chosen by measured size and checked by the same tool after.

## Measure, then cut

Each cut is ranked by its measured size (`.claude/runs/v0.2/` has the numbers), the biggest first. Candidates:

1. **Right-size.** A solo or pair mode with no CEO layer for small jobs; the CEO sizes teams to work that really
   splits.
2. **Models by role.** Small models for relays, status and summaries; Sonnet for makers; the strongest model only for
   the plan and the final review. The proposal shows the cost.
3. **Routing without CEO turns.** A message addressed to a person is delivered by the office; the CEO takes turns
   only on decisions.
4. **A fresh session per task**, with a short handoff note instead of long-lived contexts, if prompt caching doesn't
   make it cost more.
5. **Leaner desks.** Tools and MCP servers per role, shorter house rules, briefs that point to files instead of
   pasting them.
6. **Office work done by code**, not model turns: status lines, commits, routine reports.
7. **QA and reviews scaled to risk.**
8. **Budgets.** A cap per company and per person with a hard pause, and a live cost per hour.

Changes to what users see or what a company does by default (a new mode, default models, budgets) go to the maintainer through
the coordinating session before they ship.

## What makes big one-shot tasks work (protect and strengthen)

- A plan that splits into parallel streams with their interfaces and contracts agreed first.
- Integration checkpoints.
- Independent QA against the stakeholder's own words (`stakeholder_words`, since 1d7260f).
- People who keep their area's context across tasks.
- Recovery after a crash or a usage limit.
- Unattended running, with only real decisions sent to the inbox.

A real 2 to 4 hour run on a small model finds what breaks or stalls, and each finding is fixed with a test.

## Constraints

- At most 4 or 5 roles at once; Sonnet for routine work; real runs on small models unless quality is what's tested.
- The coordinating session hears once when the weekly window passes 60%, once when the accounting has its first
  numbers, and once at the end.
- Nothing is published from this branch; 0.1.0 ships from `run/v3`.
- AGENTS.md applies unchanged.

## The maintainer's decisions, 13 Nov 2026

Measured first (`scripts/accounting.ts`, 13 real runs): 28% of cost is context rewritten after a desk closed and
reopened, 30% is the fixed prompt each desk carries (about 60% of it the user's own Claude Code setup), and the CEO and
heads take 38%, 14 points of it paperwork turns. A fresh session per task saves nothing and is dropped.

- **The three quality-neutral cuts go ahead:** warm desks, leaner desks, office work by code.
- **Models:** the CEO on Opus, everyone else on Sonnet, by default. No small-model CEO. The CEO gets cheap in other
  ways:
  - its cache stays warm;
  - its paperwork turns go to the office;
  - a routine relay that still needs a model is a separate cheap call, if the numbers justify it.
- **A spending plan at the start.** On the proposal the user sets how many people, how many work at once, the model
  per person or per level, and a budget.
  - Presets: Lean, Balanced (the default) and Thorough, each with its estimated cost per hour and for the whole job.
  - The CEO sizes its plan to the preset. This settles "lean or thorough": it is the user's choice.
- **Verbosity:** fewer output tokens.
  - Short reports and briefs. Quoted requirements stay word for word.
  - No restating of context.
  - Status lines come from code.
  - Output tokens are measured before and after.
- **Lean desks, assigned by the CEO.** In the proposal the CEO gives each role the skills, plugins and MCP servers it
  needs from what the user has installed, and the user can edit that before the start. A role gets nothing it wasn't
  assigned. The proposal shows what each assignment adds to the fixed prompt, where that can be measured.

## Better by design (the maintainer, 13 Nov 2026, afternoon)

"Try to have v2 actually better than v1; don't go over long tests to understand this, use expertise on LLMs and
agentic harnesses to see which way is best." Goals in order: useful, cool, better for organization and visibility, for
not-too-technical users. The first benchmark pair showed the plan's shape decides cost far more than prompt size.

1. **Size the company to the job.** The CEO's first output is a size (small, medium, large) with a one-line reason.
   - Small: the CEO plus one maker, no heads, no QA seat, one final check.
   - Medium: flat, the CEO plus 2 to 4 makers.
   - Large: heads only when there are more makers than one person can brief (about 6).
   - Flat is the default: every management layer is a lossy relay and a paid turn.
2. **A plan linter in code**, run on `propose_plan` before the stakeholder sees the plan. It refuses, with a specific
   message:
   - a task that is only tests for another task;
   - a task with no done-when a single command can check;
   - two parallel tasks touching the same files;
   - more tasks or people than the size allows;
   - a task too big for one context.
3. **Bound every desk's context.** Cost is roughly turns times context size.
   - Tasks are sized to finish well under about 80k tokens.
   - Past a threshold, the office has the desk write a short handover file and continues in a fresh desk.
   - Long tool output goes to a file, and only its tail comes back.
4. **Files over messages.**
   - The stakeholder's words, the agreed interfaces and the decisions live in one small brief file every desk reads.
     Messages point at it.
   - A report is a fixed small form (done or not, files, the check run and its result, what is open) that code can
     read without waking anyone.
5. **Verify by code first, by a model once.**
   - The office runs each task's check command itself as the gate. Makers build no second harness.
   - One independent review at the end, in a fresh context, on the diff against the stakeholder's words.
   - Balanced means exactly that, not a QA seat working in parallel.
6. **The CEO sleeps between milestones.** It wakes for the plan, an exception, a milestone and the final handover.
   Routing stays in code; what only needs wording can run on a small model.
7. **Step-ins near zero after the plan is approved.**
   - One batch of plain questions up front, each with a recommended answer.
   - Safe-by-default permissions inside the project folder.
   - Colleagues' questions go to their manager.
   - Only product choices, money and irreversible steps reach the stakeholder, batched, each with a recommendation
     and a default that applies if they don't answer.
8. **End with something a non-technical person can use:** the preview running, and a short plain handover (what was
   built, how to open it, what is not done, what it cost against the estimate). The proposal shows the estimate and
   the size in everyday words.
9. **What a company has that a session with subagents doesn't**, visible in the office:
   - coordination state on the board and in files, so no single context fills up;
   - resuming days later;
   - steering one person mid-run;
   - spending capped per plan;
   - an independent final check.

Validation, cheap on purpose: plan-only runs (the CEO plans 5 or 6 varied prompts, nothing built; checked by the
linter and by eye), and one real small-task run to confirm cost and step-ins are at or below 0.1.0's ($2.35, 4 asks,
14 minutes on the api task).

## Simple, visible, proven (the maintainer, 13 Nov 2026, evening)

"Simplify the UI and improve the UX, to improve usability and favor usage. At the same time ensure the method works:
things actually get done, one-shot prompts for complex tasks succeed more often, changes and progress are tracked, and
there is more visibility, also across companies: before entering an office I want a TL;DR of that company, what it is
doing and what it achieved." Decisions: simple by default (nothing removed), a checklist from the stakeholder's words,
security fixes ship with 0.2 (no 0.1.1), one real complex run as the proof.

1. **The lobby is the overview of every company.** Each company card is a TL;DR, written by code from the board, the
   ledger and the event log (no model call):
   - the goal in one line, in the stakeholder's words;
   - where it stands: a progress bar of milestones (and tasks) done out of planned, and the stage in a word
     (scoping, waiting for your OK, working, checking, done, paused, stuck);
   - what it achieved: the last few finished tasks, as sentences;
   - what is happening now: who works on what;
   - what needs you: a count, with the first item;
   - spend against the plan's budget; the preview's link once one runs; when it last moved.

   Above the cards, one "Needs you" strip lists what waits on the stakeholder across all companies, each item opening
   the right office at the right place.
2. **The office opens on progress.** The default view for a non-technical user is one plain progress view: the goal,
   the checklist (3), milestones with their tasks and status, what changed since you last looked, and what needs you.
   The 3D office stays as the stage behind it. The org tree, dashboards, decision log, spending detail, trace and
   settings move behind one "More" menu; nothing is removed, and every existing route and command keeps working.
3. **A checklist from the stakeholder's words.** When the CEO proposes the plan it also proposes the checklist: each
   thing the stakeholder asked for, as a short checkable sentence, quoting their words where it can. The plan linter
   refuses a plan where a checklist item has no task that covers it, or a task covers none. The stakeholder sees and
   can edit the checklist with the plan. The final review marks each item met, partly met or not met, with evidence
   (the check that ran and its result, the files, the preview's page). The handover leads with it.
4. **Since you last looked.** The office remembers when the stakeholder last opened each company and shows what
   happened since: tasks finished, decisions made, files changed (by task), money spent, questions waiting. Written by
   code from the event log.
5. **Plain words everywhere a non-technical user looks.** No ids, paths or tool names in the default views; times as
   "12 minutes ago"; money with the budget beside it.

Proof: one real multi-part task (a small full-stack app) at effort medium, from one sentence, with the stakeholder
role played by a script that accepts the recommendations. It must end with the checklist mostly met, the preview
running, and every screen above looked at, at 1440 and 375 px.
