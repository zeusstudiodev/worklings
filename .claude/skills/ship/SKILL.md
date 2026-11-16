---
name: ship
description: "Takes finished work to a release: runs the studio's gates and the project's checks, bumps the version, writes the changelog and prepares the project's own deploy or release steps, then waits for the person's explicit OK before anything is deployed, published or pushed. Use when work is done and should go live."
---
# Ship

Shipping is visible to other people and often can't be undone. Prepare everything, then stop for the person's OK.

1. Say what ships: the changes since the last release (`git log` from the last tag, or the project's equivalent), the
   target (production, a store, a package registry, a client's host) and who will notice.
2. Run the gates the studio uses at its rigor, listed in the Studio section of CLAUDE.md, ending with the release gate
   if there is one. A failed gate stops the release until it's fixed or the person explicitly accepts the risk.
3. Run the full checks on the exact commit that will ship: typecheck, lint, tests, end-to-end tests if the project
   has them, and a clean production build. Record each command and its result.
4. Bump the version where the project keeps it: semver for packages, version and build number for apps. Update every
   file that repeats it.
5. Write the changelog or release notes for users: what's new, what changed, what's fixed, and migration steps for
   anything breaking.
6. Pre-flight the target: environment variables and secrets set, database migrations ready and backward compatible,
   feature flags set, and a rollback plan (the previous version and the exact way back).
7. Split the work with the studio where it saves time (version and notes, the deploy, a final check). The team:

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

8. Show the person a release summary: the version, what ships, gate and check results, risks, the rollback plan and
   the exact commands you'll run. Wait for an explicit yes. Never deploy, publish, push, tag or submit without it.
9. With the OK, run the project's own release steps (its scripts, docs or CI). Don't invent commands; if the project
   has none for this target, ask.
10. Verify the release where users meet it: open the live URL, install the published package, call the deployed
    endpoint, check the build in the store's console. Watch errors and logs for a few minutes.
11. Report the version, what shipped and where, the evidence that it works, and any follow-ups. If something is wrong,
    stop and propose the rollback; don't push on.
