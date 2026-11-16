---
name: design-gate
description: "Checks a design before engineering builds it: the goal, every flow and state, interactions, consistency with the design system, accessibility, real content and feasibility, with a pass or fail verdict. Use when a screen, flow or page design is ready to hand to the people who build it."
---
# Design gate

Building from a half-finished design costs more than finishing it. A design passes when someone could build it
without guessing.

1. Collect the design: the flows, the screens, mockups or written spec, the design system or tokens it uses, the
   copy, and the task or plan it serves.
2. Check:
   - Goal: it solves the stated problem for the stated person, and the main task takes the fewest steps that work.
   - States: empty, loading, error, success, offline, first run, permission denied, long content and missing images
     are designed, not left to the builder.
   - Sizes: small phones (320-375 px), tablets and wide screens; large text; dark mode if the product has it.
   - Interaction: what every control does; hover, focus and pressed states; focus order; keyboard and touch
     behaviour; an alternative to every gesture; feedback for every action; what each motion does and how long it
     takes.
   - Consistency: it uses the existing components and tokens for colour, type, spacing, radius and motion; any new
     component is justified.
   - Accessibility: contrast meets WCAG 2.2 AA, targets are big enough, nothing relies on colour alone, and a
     reduced-motion version exists.
   - Content: real copy at real lengths in the product's voice, no lorem ipsum.
   - Feasibility: it can be built with the stack and within scope, the data it shows exists, and heavy media or
     motion is flagged for a performance check.
3. Ask the people who will build it to confirm feasibility, and bring in the studio's designers and reviewers:

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

4. Verdict: **pass** or **fail**. List blockers (missing states, unbuildable or inaccessible parts) separately from
   suggestions, each with the screen or flow, why it matters and the smallest change that fixes it.
