---
title: Scrapers and browser automation
department: engineering
stacks: [playwright, puppeteer, crawlee, apify, scrapy]
paths:
  - "src/**/*.{ts,js,mjs,py}"
  - "scrapers/**"
  - "spiders/**"
  - "crawlers/**"
  - "actors/**"
  - ".actor/**"
  - "jobs/**"
---
- Before scraping, read the site's robots.txt and terms and prefer an official API or feed; the person decides the grey areas.
- Be polite: low concurrency per domain, delays with jitter, back off on 429 and 503, and honour `Retry-After`.
- Never automate logins, CAPTCHAs, paywalls or anti-bot bypasses unless the person has explicitly decided to.
- Collect only the fields you need; personal data needs a legal basis and a retention limit.
- Use the lightest tool that works: HTTP and an HTML parser, then the page's own JSON endpoints, a headless browser last.
- Prefer stable selectors (ids, `data-*`, roles, labels, text) over deep CSS paths, and keep all selectors in one module.
- Wait for conditions (an element, a response, a URL), never for a fixed time.
- Validate every record against a schema; a run that yields zero or malformed items fails loudly instead of saving junk.
- Save real HTML or JSON responses as fixtures and test parsers offline against them; refresh them when the site changes.
- Make runs idempotent and resumable: dedupe on stable keys, checkpoint progress, safe to rerun after a crash.
- Retry transient errors with exponential backoff and a cap; handle blocks (403, CAPTCHA pages) differently from timeouts.
- Set timeouts on every request and navigation; close pages, contexts and browsers in `finally`.
- Reuse one browser with a fresh context per session; block images, fonts and media when the data doesn't need them.
- With Crawlee or the Apify SDK, use their request queue, dataset and key-value store, not home-made state; check the SDK version.
- Apify actors declare their input in an input schema, and the README documents inputs, outputs and limits.
- With Scrapy, validate items in pipelines and keep AutoThrottle and robots.txt obedience on unless the person decides otherwise.
- Parse dates, prices, currencies and locales explicitly; never trust a default format.
- Scheduled runs report their counts and alert on anomalies (zero items, a sudden drop, an error spike); no silent failures.
- Proxy credentials and tokens come from the environment or the secret store, never from code or logs.
