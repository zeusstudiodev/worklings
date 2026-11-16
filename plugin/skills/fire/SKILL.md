---
name: fire
description: >-
  Fires a role from this project's Worklings studio, archiving its agent file so it can be rehired later. Use when a
  role is never used, keeps costing more than it adds, or no longer fits the project.
argument-hint: "[role]"
allowed-tools: Bash(worklings *), Read
---
# Fire a role

1. Confirm which role is meant and that the person wants it gone. If the office has been running, mention what the
   payroll showed for it: idle desks and roles with a large share of the spend are the usual candidates.
2. Fire it: `worklings fire <role>`. The agent file moves to `.claude/studio/fired/`, so Claude Code stops
   delegating to it and the role no longer adds its description to every request.
3. Say how to undo it: `worklings rehire <role>`.
