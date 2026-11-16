# The Worklings library

The curated content the generator composes studios from. Everything here is plain Markdown and YAML, so adding a role
or a domain needs no code. `npm run lint:library` checks every file against the rules below.

```
library/
  roles/<id>.md              one subagent archetype per file
  rules/<id>.md              path-scoped rules for a stack
  skills/<id>/SKILL.md       workflow skills and review gates
  domains/<id>.yaml          which roles, rules, skills and gates a kind of project gets, per rigor tier
```

Rooms come from the nine base departments in `src/core/departments.ts`: `direction`, `design`, `engineering`,
`quality`, `security`, `content`, `data`, `ops`, `art`.

## Writing for this library

These files become prompts that run on every delegation, so every line costs tokens in every project that uses it.

- Write instructions a capable engineer would want, not a job ad. No "You are a world-class...", no capital-letter
  warnings, no filler. Say what to do and why when the reason isn't obvious.
- Be specific to the role and stack. If a line would fit every role, it belongs in the CLAUDE.md block, not here.
- Plain, direct English; second person; short sentences. Lists for steps and checks.
- Stay stack-neutral inside a role unless the role is stack-specific: the composer adds the project's stack, commands
  and paths in a `## This project` section, and rules carry the stack detail.
- Never invent tools, commands or APIs. Tell the agent to check the installed version instead of naming one.

## Roles: `roles/<id>.md`

```markdown
---
name: mobile-engineer            # same as the file name; lowercase, digits, hyphens
title: Mobile engineer           # how the office labels the desk
department: engineering          # one of the nine base departments
description: >-                  # 60-400 characters; Claude Code reads this to decide when to delegate,
  Builds and fixes ...           # so say what it does and when to use it ("Use for ...")
model: inherit                   # inherit | sonnet | opus | haiku
tools: [Read, Grep, Glob, Edit, Write, Bash]   # optional allowlist; omit to inherit all tools
tags: [mobile, expo]             # optional, for search and hire suggestions
handoffs:                        # optional; only roles that exist in the generated studio are written out
  qa-engineer: a feature is ready to be tested on a device
---
One or two sentences on who this role is in the studio.

## Mission
## You own
## How you work
## Done means
```

Required body sections, in this order: `## Mission`, `## You own`, `## How you work`, `## Done means`. Optional:
`## Watch for`. Do not write `## Hand off` or `## This project`: the composer appends both (hand-offs filtered to the
roles actually hired, and the project's name, idea, stack, commands, paths and rules). Aim for 35-80 lines.

Model guidance: `inherit` for roles that need the strongest reasoning (architecture, building, debugging); `sonnet`
for review, checklist and most writing roles; `haiku` only for mechanical work. The office shows what each choice
costs and lets people promote or demote a role.

### Roster

| Department | Roles |
|---|---|
| direction | `producer`, `architect`, `product-manager` |
| design | `ux-designer`, `ui-designer`, `game-designer`, `level-designer` |
| art | `art-director`, `technical-artist`, `sound-designer` |
| engineering | `frontend-engineer`, `backend-engineer`, `mobile-engineer`, `game-programmer`, `engine-specialist`, `extension-engineer`, `desktop-engineer`, `automation-engineer`, `library-engineer` |
| data | `data-engineer`, `ml-engineer`, `ai-engineer`, `analytics-engineer` |
| quality | `qa-engineer`, `code-reviewer`, `accessibility-specialist`, `performance-engineer` |
| security | `security-reviewer`, `privacy-officer` |
| content | `copywriter`, `seo-specialist`, `docs-writer`, `localization-specialist`, `narrative-writer` |
| ops | `devops-engineer`, `release-manager` |

## Rules: `rules/<id>.md`

```markdown
---
title: React Native and Expo
department: engineering
stacks: [expo, react-native]     # detection facts this rule applies to (see src/composer/detect.ts)
paths:                           # candidate globs; the composer keeps those whose folder exists in the project
  - "app/**/*.{ts,tsx}"
  - "src/**/*.{ts,tsx}"
---
- Short, checkable rules for code under these paths. 8-25 bullets.
```

The written file keeps only `paths` in its frontmatter, which is the one field Claude Code reads from a rule.

## Skills and gates: `skills/<id>/SKILL.md`

```markdown
---
name: plan-feature
description: >-                  # what it does and when to use it
  Turns a feature request into ...
worklings:                       # removed when the skill is written into a project
  kind: workflow                 # workflow | gate
  department: direction          # the room the skill belongs to
  # gates only: the door it guards, from the room whose work it checks to the room that receives it
  from: design
  to: engineering
---
Steps in the second person. Use {{team}} where the skill should list the studio's roles; the composer replaces it
with the hired roster.
```

Libraries from when Worklings was called Headcount keep working: their `headcount:` block loads the same way and is
removed too, and `worklings:` wins when a skill has both.

Gates are skills that check work before it moves on (code-gate, design-gate, ...). Their names end in `-gate` so they
never collide with Claude Code's built-in commands. The office lights the gate's door while it runs.

A skill carries only `name`, `description` and `argument-hint` into a project. Keys such as `hooks` or
`allowed-tools` would run commands or skip permission prompts in every project the skill is written into, so the
linter rejects them and the composer drops them. Markdown files next to `SKILL.md` (a template, a checklist) are
copied with it; anything else, scripts included, is not.

## Domains: `domains/<id>.yaml`

```yaml
id: mobile-app
title: Mobile app
summary: iOS and Android apps built with Expo or React Native.
detect:                          # signals that point at this domain; omit for generic
  priority: 2                             # 0 general (API, CLI), 1 web, 2 specific (mobile, game, AI...): higher wins
  dependencies: [expo, react-native]      # package.json dependencies or devDependencies
  files: [app.json, eas.json]             # files or folders at the project root
  python: []                              # names mentioned in pyproject.toml or requirements*.txt
  json: { manifest.json: manifest_version } # a root JSON file that has this top-level key
roles:                           # cumulative: standard adds to lean, full adds to standard
  lean: [mobile-engineer, ux-designer, qa-engineer]
  standard: [ui-designer, release-manager]
  full: [performance-engineer, security-reviewer]
rules: [typescript, react-native-expo, tests]   # kept only when the project's stack matches the rule's stacks
skills: [plan-feature, fix-bug, ship]
gates:
  lean: [code-gate]
  standard: [design-gate]
  full: [security-gate]
```

Lean teams have 3 to 5 roles. Every id must exist in this library; the linter checks that too.

Pick detection signals that only this kind of project has. A signal that also shows up elsewhere (Playwright in any
app's tests, Three.js on 3D marketing sites, pandas in plenty of APIs) will mislabel those projects, because a
higher-priority domain wins as soon as one of its signals matches.
