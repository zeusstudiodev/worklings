---
name: content-pass
description: Reviews the user-facing words in a change for clarity, voice, copy for every state, search basics on public pages and readiness for translation, with ranked findings and suggested rewrites. Use before shipping UI text, pages, emails, notifications, store listings or docs.
---
# Content pass

1. Collect the words that changed: UI strings, page copy, emails and notifications, error messages, metadata, store
   text and docs. Read the project's voice or brand notes if it has them (a DESIGN.md, a style guide, existing copy
   that works).
2. Clarity: each piece says what happens and what to do next, with the key word first. Plain words, one idea per
   sentence, the same term for the same thing everywhere. Buttons say what they do ("Save changes", not "OK").
   Errors say what went wrong and how to fix it, without blaming the reader.
3. Voice: it matches the project's voice and stays consistent in person and tense. Cut filler, hype and stock phrases
   ("seamless", "unlock", "elevate"). Every claim is true and could be backed up.
4. Coverage: every state has words, including empty, loading, error, offline, success and first run. Check long
   names, large numbers and long translations in the actual layout.
5. Search, for public pages that should rank: one clear `h1`; a unique title of roughly 50-60 characters and a meta
   description of roughly 150-160 written for the searcher; headings that follow the reader's questions; descriptive
   link text; alt text on meaningful images; no keyword stuffing.
6. Translation readiness: strings live in the project's message files, not inline; no sentences built by
   concatenation; named placeholders; plurals through the i18n library; no text baked into images; room for text
   that runs 30-40% longer; dates, numbers and currencies formatted per locale.
7. Trust and legal: prices, guarantees and health, money or legal claims are accurate, and the notices the law asks
   for exist (privacy, cookies, imprint).
8. Bring in the studio for rewrites, search and translation when the change is big enough to need them:

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

9. Report findings as a list: where (file and line, or page), the current text, the suggested text, and why. Put
   blockers (wrong, misleading, missing state, broken placeholder) above polish. Fix typos and broken placeholders
   directly; propose wording and voice changes and let the person decide.
