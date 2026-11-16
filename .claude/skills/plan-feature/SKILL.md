---
name: plan-feature
description: "Turns a feature request into a short plan the studio can build: the goal, the flows and states, the open questions, who does what and how it will be checked. Use before building anything that touches more than a couple of files."
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

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

5. List the gates the work must pass before it ships, if the studio has any (see the Studio section of CLAUDE.md).
6. Show the plan and wait for a go-ahead before building, unless you were told to proceed.
