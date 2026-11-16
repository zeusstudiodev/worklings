---
name: perf-gate
description: >-
  Checks a change against the project's performance budget with before-and-after measurements: Core Web Vitals and
  bundle size for the web, latency and query counts for APIs, frame time and memory for games and 3D, startup time
  and memory for apps. Use before shipping anything that could make the product slower.
worklings:
  kind: gate
  department: quality
  from: quality
  to: ops
---
# Performance gate

Numbers, not impressions. Measure the same way before and after, on the slowest setup the product supports.

1. Find the budget in the project's docs. If there is none, propose one and confirm it with the person. Typical
   starting points:
   - Web: at the 75th percentile on mobile, LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less, and a JavaScript
     budget per route.
   - APIs: p95 latency per endpoint, error rate, queries per request.
   - Games and 3D: a steady frame time (16.7 ms for 60 fps) on a mid-range phone, flat memory over a long session,
     load time.
   - Mobile and desktop apps: cold start time, memory, smooth scrolling in long lists.
2. Measure the base and the change on the same setup: a production build, a throttled mobile profile or a real
   device, cold and warm, several runs each.
   - Web: a Lighthouse run or a performance trace, field data if the project collects it, and the build's bundle
     report; name the LCP element and any long tasks.
   - APIs: a load test of the changed endpoints with the project's tool; p50, p95 and p99, errors, query counts and
     query plans.
   - Games and 3D: frame time over several minutes, draw calls, memory growth, load time.
3. For any regression, find the cause: a new dependency, large images or fonts, render-blocking resources, layout
   shifts, main-thread work, N+1 queries, a missing index, unbounded lists or allocations in a hot loop.
4. Bring in the studio's performance and QA people where they're hired:

{{team}}

5. Verdict: **pass** or **fail** against the budget. Each blocker shows the before and after numbers, the setup and
   the likely cause; suggestions go in a separate list. Save the numbers and the setup so the next run can compare.
