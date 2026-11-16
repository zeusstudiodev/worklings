---
name: plan-feature
description: >-
  Turns a feature request into a short plan the studio can build: the goal, the flows and states, the open questions,
  who does what and how it will be checked. Use before building anything that touches more than a couple of files.
worklings:
  kind: workflow
  department: direction
---
# Plan a feature

1. Restate the goal in one or two sentences and who it is for. If the request is ambiguous in a way that changes
   what gets built, ask now, in one batch, with your recommended answer for each question.
2. Read what exists: the code and docs the feature touches, similar features, the rules in `.claude/rules/`.
3. Write the plan, briefly:
   - The flows and every state (loading, empty, error, long content, small screens, permissions, offline).
   - The changes, file by file or module by module.
   - What is out of scope.
   - How it will be checked: the tests, the commands, what to look at in the running product.
4. Assign the work to the studio. Delegate only what is substantial or benefits from a fresh context; do small
   steps yourself, because every delegation costs tokens. The team:

{{team}}

5. List the gates the work must pass before it ships, if the studio has any (see the Studio section of CLAUDE.md).
6. Show the plan and wait for a go-ahead before building, unless you were told to proceed.
