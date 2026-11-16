---
name: a11y-gate
description: "Checks a UI change against WCAG 2.2 AA before it ships: automated scans plus keyboard, screen reader, contrast, zoom, motion and touch checks on every changed screen and state, with a pass or fail verdict. Use when a screen, page, component or flow is ready to release."
---
# Accessibility gate

Automated scanners catch only part of the problems; keyboard and screen reader checks find the rest. Test the running
product, not just the code.

1. List the screens, flows and states the change touches, and run the product.
2. Scan each screen and state with the project's tool (axe in the end-to-end suite, Lighthouse or the browser's
   accessibility tools) and record the results.
3. Check by hand:
   - Keyboard: everything is reachable in a logical order and works with the expected keys; focus is always visible;
     there are no traps; focus moves into dialogs and back when they close; pages with navigation have a skip link.
   - Screen reader: every control announces a name, role and state; headings and landmarks describe the page; async
     updates are announced; images have useful alt text. Use VoiceOver, NVDA or TalkBack, or at least the
     accessibility tree.
   - Visual: text contrast is 4.5:1 (3:1 for large text and for controls and icons); nothing relies on colour alone;
     the page works at 200% zoom and reflows at 320 CSS px without horizontal scrolling.
   - Motion: reduced-motion settings are respected, nothing flashes more than three times a second, and moving
     content can be paused.
   - Forms: visible labels, errors described in text and tied to their fields, required fields marked, autocomplete
     where it applies.
   - Touch and native: targets of at least 24x24 CSS px (44 points on phones), both orientations work, and text
     scales with the system setting.
   - Media: captions for video with speech, transcripts for audio.
4. Bring in the studio's accessibility and QA people where they're hired:

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

5. Verdict: **pass** or **fail**. Blockers are WCAG A or AA failures in the changed flows, each with the success
   criterion, where it happens and the fix. Suggestions go in a separate list. Note what still needs a person using
   assistive technology to confirm.
