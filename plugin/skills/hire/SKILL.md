---
name: hire
description: >-
  Hires a role from the Worklings library into this project's studio and fits it to the project. Use when the studio
  needs a specialist it doesn't have, such as a security reviewer before handling payments.
argument-hint: "[role or what you need help with]"
allowed-tools: Bash(worklings *), Read
---
# Hire a role

1. Work out which role is meant. If the person described a need rather than a role id, run `worklings domains --json`
   and read `.claude/studio.yaml` to see who is already on staff, then pick the library role that fits. The roster
   is in the library README; ids look like `security-reviewer` or `performance-engineer`.
2. Hire it: `worklings hire <role>` (add `--room <id>` to seat it somewhere other than its usual room).
3. Fit it to the project: `worklings tailor <role> --note "..."` with up to five concrete notes about what this role
   needs to know here. The command changes only the role's `## This project` section.
4. Say what the role is for and when the lead should delegate to it. It is available from the next session.
