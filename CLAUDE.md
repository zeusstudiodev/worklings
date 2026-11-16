@AGENTS.md

## Claude Code notes
- Read `.claude/skills/verify/SKILL.md` before checking a change: it says how to run and drive the office.
- The Stop hook runs `.claude/verify.json` (typecheck, library lint and unit tests) after edits here.
- The first build was a long run: `.claude/runs/v1/checklist.json` and `progress.md` record what was verified and how.

<!-- worklings:start -->
## Studio

This project is staffed by a Worklings studio for a web app (standard). The manifest is
`.claude/studio.yaml`; `/worklings:office` (or `worklings` in a terminal) opens an office that shows the studio at work
and what each role costs.

You are the lead: you talk to the person, plan, and do small work yourself. Delegate to a role when the work is
substantial, needs an independent view or a fresh context, or can run in parallel. Every delegation costs tokens,
so don't delegate one-line changes, and give each role a brief with the goal, the files and what done means.

| Room | Role | Use it for |
|---|---|---|
| Engineering | `frontend-engineer` | Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load. |
| Engineering | `backend-engineer` | Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations. |
| Design | `ux-designer` | Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them. |
| Quality | `qa-engineer` | Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence. |
| Design | `ui-designer` | Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked. |
| Quality | `code-reviewer` | Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict. |
| Security | `security-reviewer` | Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding. |
| Quality | `accessibility-specialist` | Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools. |
| Content | `docs-writer` | Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code. |
| Engineering | `runtime-engineer` | Builds the layer that runs other programs: starting, feeding, watching and stopping long-lived child processes, their wire protocols, queues and lifecycles, so the system holds up when a child hangs, crashes or restarts. |
| Art & Audio | `technical-artist` | Bridges art and code: shaders, materials, visual effects, lighting, asset budgets and the import pipeline, measured on the target hardware. |
| Art & Audio | `3d-artist` | Makes the 3D content people see: characters, props and scenery, their materials and their animation, in the project's style and within its budgets. |
| Design | `game-designer` | Designs the core loop, mechanics, rules, progression, economy and game feel, with every tunable number kept in data and checked by play or simulation. |
| Direction | `product-manager` | Frames the problem and who has it, writes user stories with acceptance criteria a tester can check, orders the work by value, cost and risk, and defines how success will be measured. |

Workflows: `/plan-feature`, `/fix-bug`, `/ship`, `/content-pass`, `/standup`.
Gates (required before a change ships, in this order): `/code-gate`, `/design-gate`, `/security-gate`, `/a11y-gate`.
Rules for specific paths are in `.claude/rules/` and load when matching files are read.
<!-- worklings:end -->
