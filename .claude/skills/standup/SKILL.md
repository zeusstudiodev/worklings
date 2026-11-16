---
name: standup
description: "Writes a short status for the person from what the repo shows: what was done recently, what is in progress, what is blocked and on whom, and the next steps with who in the studio should take each. Use at the start of a session, after a break, or when asked where things stand."
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

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

6. Write it as four short sections, Done, In progress, Blocked and Next, with no filler. End with the decisions you
   need from the person, in one batch, with your recommendation for each.
