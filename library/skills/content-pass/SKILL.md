---
name: content-pass
description: >-
  Reviews the user-facing words in a change for clarity, voice, copy for every state, search basics on public pages
  and readiness for translation, with ranked findings and suggested rewrites. Use before shipping UI text, pages,
  emails, notifications, store listings or docs.
worklings:
  kind: workflow
  department: content
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

{{team}}

9. Report findings as a list: where (file and line, or page), the current text, the suggested text, and why. Put
   blockers (wrong, misleading, missing state, broken placeholder) above polish. Fix typos and broken placeholders
   directly; propose wording and voice changes and let the person decide.
