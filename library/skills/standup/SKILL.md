---
name: standup
description: >-
  Writes a short status for the person from what the repo shows: what was done recently, what is in progress, what is
  blocked and on whom, and the next steps with who in the studio should take each. Use at the start of a session,
  after a break, or when asked where things stand.
worklings:
  kind: workflow
  department: direction
---
# Standup

A status the person can read in a minute, built from what the repo shows, not from memory.

1. Recent work: read `git log` since the last standup or the last working day, and `git status` for uncommitted
   changes. Group commits by feature or fix instead of listing each one.
2. Open work: the project's plan, checklist or progress files if it has them, open branches, and, if the project
   uses GitHub, open pull requests and issues (`gh pr list`, `gh issue list`; read only).
3. Health: run the fast checks (typecheck, lint, unit tests) if they finish in a minute or two, and note anything
   failing. Don't start fixing; this is a report.
4. Blockers: what waits on the person (a decision, an account, a key, a review, a payment), what is broken, and what
   waits on someone outside.
5. Next steps: three to five, ordered by value and by what they unblock, each with who in the studio would take it:

{{team}}

6. Write it as four short sections, Done, In progress, Blocked and Next, with no filler. End with the decisions you
   need from the person, in one batch, with your recommendation for each.
