---
title: Astro sites
department: engineering
stacks: [astro]
paths:
  - "src/**/*.{astro,ts,tsx,js,jsx,svelte,vue,css}"
  - "src/content/**/*.{md,mdx,json,yaml,yml}"
  - "astro.config.{mjs,ts,js}"
  - "public/**"
---
- Check the installed Astro version and its docs; content collections, images, env and config APIs changed across majors.
- Ship no JavaScript by default: static UI is `.astro` components; add a framework island only where interaction needs one.
- Pick island directives on purpose: `client:visible` or `client:idle` before `client:load`; `client:only` only if SSR fails.
- Keep content in content collections with a schema, so a bad date or a missing field fails the build instead of the page.
- Images from `src/` go through `astro:assets` (`<Image>`, `<Picture>`) with `alt`; files in `public/` ship unoptimised.
- The LCP image loads eagerly with high fetch priority; every other image is lazy and has its dimensions set.
- Set `site` in the config so canonical URLs, the sitemap and Open Graph URLs are absolute.
- One layout owns `<head>`: `lang`, title, description, canonical, Open Graph and Twitter tags, favicon, theme colour.
- Generate a sitemap and `robots.txt`, keep a real 404 page, and put redirects in the config or the host's redirect file.
- Keep the trailing-slash policy in the config, the internal links and the host in agreement.
- Component styles are scoped; global styles live in one deliberate stylesheet, not in scattered `is:global` blocks.
- Component scripts are bundled and run once per page; use `is:inline` only when a script must not be processed.
- With view transitions, initialise scripts on `astro:page-load`, not `DOMContentLoaded`, and clean up on `astro:before-swap`.
- Know which pages are prerendered and which render on demand; on-demand pages need an adapter and `prerender` set per page.
- Only `PUBLIC_` env vars reach the browser; declare and validate env vars in the project's env schema if it has one.
- Load third-party scripts (analytics, embeds, chat) late, and only after consent where the law requires it.
- Self-host, subset and preload fonts; check whether the installed version has a built-in fonts API before adding a package.
- Run `astro check` and `astro build` before calling a change done; treat build warnings about images or content as errors.
