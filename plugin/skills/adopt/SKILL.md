---
name: adopt
description: >-
  Sorts an existing set of Claude Code subagents (hand-written, Claude Code Game Studios, agency-agents or any other
  collection) into rooms and saves them as a Worklings studio, so the office can show them. Use when a project
  already has .claude/agents and someone wants it in the office or wants to manage it as a studio.
allowed-tools: Bash(worklings *), Read, Edit
---
# Adopt an existing studio

1. Run `worklings adopt` and show the person the rooms it inferred from the agents' names and descriptions.
2. If a role landed in the wrong room, or in the open space because nothing matched, say which room you would move
   it to and why.
3. With the person's OK, save it with `worklings adopt --write`, then fix the rooms you discussed with
   `worklings move <role> <room>`.
4. Mention `/worklings:office` to see the result.
