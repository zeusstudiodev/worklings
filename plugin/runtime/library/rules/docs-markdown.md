---
title: Docs in Markdown
department: content
stacks: [docs-site, library, cli]
paths:
  - "docs/**/*.{md,mdx}"
  - "*.md"
  - "content/**/*.{md,mdx}"
  - "guides/**/*.{md,mdx}"
  - "website/docs/**/*.{md,mdx}"
---
- Open with what it is and the fastest path to a working result: install, a minimal example, the expected output.
- Write for a task: each page answers one question or walks through one job; reference pages list everything.
- Every code sample runs as written against the current version, can be pasted as is, and shows its expected output.
- Update the docs in the same change as the behaviour they describe.
- Reference entries give each option, flag or function its type, default, an example and the version that added it.
- Breaking changes come with migration steps, before and after.
- One H1 per page, headings in order, and link text that says where it goes (never "click here").
- Short sentences, second person, present tense; one name per concept, used everywhere.
- Fenced code blocks carry a language tag; commands have no `$` prompt, so they paste cleanly.
- Show where commands differ by operating system or shell (PowerShell, macOS, Linux).
- Numbered lists for steps, tables for options, callouts only for real warnings.
- Link to the single source of truth instead of repeating it; use relative links inside the repo and check they resolve.
- Images have alt text, are compressed, and are updated when the UI changes.
- No secrets, internal URLs or personal paths in examples; use clear placeholders such as `<your-api-key>`.
- Docs-site pages set a title and description in front matter for navigation and search.
- Follow the project's Markdown lint and formatting settings; don't rewrap text you didn't change.
