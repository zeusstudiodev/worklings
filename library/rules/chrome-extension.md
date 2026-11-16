---
title: Browser extensions (Manifest V3)
department: engineering
stacks: [chrome-extension]
paths:
  - "src/**"
  - "entrypoints/**"
  - "extension/**"
  - "public/**"
  - "manifest.json"
---
- Manifest V3 only; check each target browser's MV3 support (Firefox still uses event pages and the `browser.*` namespace).
- Request the fewest permissions: `activeTab` and optional permissions asked for at the moment of use; justify each one.
- Host permissions name the sites a feature needs; never `<all_urls>` for a feature that works on one site.
- No remote code: every script ships in the package; no `eval`, no `new Function`, no scripts fetched from a server.
- The service worker can stop at any time: state lives in `chrome.storage`, and listeners register synchronously at top level.
- Use `chrome.alarms` for delayed or periodic work, not long `setTimeout` or `setInterval` calls in the worker.
- Content scripts run on pages you don't control: treat page data as untrusted and never write it with `innerHTML`.
- Validate every message's sender, shape and right to ask for that action; content scripts are the least trusted part.
- Injected UI lives in a Shadow DOM with its own styles, so the page can't break it and it can't break the page.
- Calls that need extension permissions go through the service worker; content scripts are bound by the page's CORS.
- `storage.local` for data, `storage.session` for short-lived sensitive values; `storage.sync` has small quotas.
- Keep selectors for third-party pages in one module, fail gracefully, and report when the page structure changes.
- Single-page sites change URL without reloading: watch for navigation instead of assuming one load per page.
- Collect the minimum data; the privacy policy and the store's data-use answers must match what the code does.
- The popup closes when it loses focus: send long work to the service worker and restore state when it reopens.
- Popup and options pages need keyboard access, labels and focus styles like any web page.
- Test the built extension loaded unpacked, and run end-to-end tests in a browser context that loads it.
- Bump the manifest version for every store upload and keep a changelog.
