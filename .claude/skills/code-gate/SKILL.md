---
name: code-gate
description: "Reviews a finished change before it moves on: correctness, tests, the project's rules, security basics and maintainability, with a pass or fail verdict. Use when a feature or fix is done and before it is merged or shipped."
---
# Code gate

A change passes this gate only with evidence. Review the diff against what was asked, not against your own taste.

1. Collect the change: the diff (`git diff` against the base), the task it implements and the plan if there is one.
2. Run the project's checks: typecheck, lint, tests, and the build when configuration or dependencies changed.
   Record each command and its result.
3. Read the diff for:
   - Bugs: wrong logic, unhandled errors and edge cases, race conditions, broken states.
   - Tests: new behaviour is tested at the right level; no test was weakened, skipped or special-cased.
   - The rules in `.claude/rules/` for the paths that changed.
   - Security basics: no secrets in code, input validated at boundaries, no injection, safe auth checks.
   - Scope: no unrelated refactors, renames or dependency bumps mixed in.
4. If the studio has a code reviewer, hand them the diff and the check results for a second, independent read:

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

5. Verdict: **pass** or **fail**. For a fail, list each blocking problem with file and line, why it matters and the
   smallest fix. Separate blockers from suggestions.
