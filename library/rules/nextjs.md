---
title: Next.js
department: engineering
stacks: [nextjs]
paths:
  - "app/**/*.{ts,tsx,js,jsx}"
  - "src/app/**/*.{ts,tsx,js,jsx}"
  - "pages/**/*.{ts,tsx,js,jsx}"
  - "src/pages/**/*.{ts,tsx,js,jsx}"
  - "{middleware,proxy}.{ts,js}"
  - "src/{middleware,proxy}.{ts,js}"
  - "next.config.{js,mjs,ts}"
---
- Check the installed Next.js version and its docs; caching defaults, request APIs and file conventions change between majors.
- Follow the router the project uses (App Router or Pages Router) and don't mix their patterns in one feature.
- `'use client'` goes only on leaf components that need state, effects or browser APIs; the rest stay Server Components.
- Keep server-only code (database, secrets, keyed SDKs) out of client components; guard those modules with `import 'server-only'`.
- Only `NEXT_PUBLIC_` variables reach the browser, inlined at build time; never put a secret in one.
- Props passed to client components must be serialisable: plain data, not class instances or functions (Server Actions excepted).
- Fetch on the server, in parallel with `Promise.all`, and stream slow parts behind `Suspense` instead of blocking the page.
- Server Actions are public endpoints: each one validates input and checks the session and the user's right to the object.
- Know whether each route is static or dynamic and how it's cached; check the build output and revalidate after mutations.
- `params`, `searchParams`, `cookies()` and `headers()` are async in current versions; await them.
- Give route segments their states with `loading`, `error` (a client component) and `not-found` files.
- `redirect()` and `notFound()` work by throwing; don't call them inside a `try` that swallows the throw.
- Titles, descriptions, canonical URLs and Open Graph come from the Metadata API, not hand-written head tags.
- Images use `next/image` with dimensions or `fill` plus `sizes`; mark the LCP image as priority in the installed version's way.
- Load fonts with `next/font` so they're self-hosted and don't shift the layout.
- Middleware (`proxy` in Next.js 16+) runs on every matched request: keep it fast and narrowly matched, never the only auth check.
- Route handlers validate input, return correct status codes and set caching headers explicitly.
- Load heavy client-only libraries with dynamic imports.
- Run `next build` before calling a change done; it catches type, prerender and server/client boundary errors that dev misses.
