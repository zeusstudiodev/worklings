---
name: new
description: >-
  Staffs this project with a Worklings studio: Claude Code subagents, path rules, workflow skills and review gates
  chosen for the kind of project and its stack, then tailored to what is being built. Use when someone wants a studio,
  a team of agents or a .claude setup for a project, new or existing.
argument-hint: "[what you are building]"
allowed-tools: Bash(worklings *), Read, Glob, Grep
---
# Create a Worklings studio

The `worklings` command ships with this plugin and writes the studio. Your job is to choose its inputs well and then
fit the result to this project. The person's description of the project is the argument to this command.

1. Look at the project. Run `worklings detect --json` in the project root and note `isEmpty`, the matched `domains`
   (best first), `frameworks` and `commands`. Run `worklings domains --json` to see every kind of project and its
   lean team.
2. Decide:
   - **Kind of project** (`--domain`): the best detected domain when there is code, otherwise the one that matches the
     description. Use `generic` only when nothing fits.
   - **Rigor** (`--rigor`): `lean` unless the person asks for more. Every role and gate adds tokens to every session,
     and a bigger team is not a better one.
   - **Intended stack** for a project with no code yet (`--stack`, comma-separated ids such as `expo,typescript`),
     when the description names one.
   If a choice is genuinely open and you can ask, ask once, with your recommendation. Otherwise use these defaults
   and say which ones you picked.
3. Write the studio: `worklings new --domain <id> --rigor <tier> --idea "<one sentence: what it is and who it's for>"`,
   adding `--stack` or `--name` when they apply. The output lists every file written and any file kept because
   someone had edited it; never pass `--force` without the person's OK.
4. Tailor each role with `worklings tailor <role> --note "..." --note "..."`: up to five notes that someone in that
   role needs to know about *this* project, such as the core user flows, the key data, constraints (platforms,
   budgets, privacy, deadlines) and the riskiest areas. Be concrete and brief: these lines are read on every
   delegation. Use the command rather than editing the agent files: it changes only the role's `## This project`
   section, and running it again replaces the notes it wrote before.
5. Report the team room by room, the gates and when to run them, and the next step: `/worklings:office` opens the
   office and offers the hooks that let new sessions report to it.
