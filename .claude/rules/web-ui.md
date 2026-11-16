---
paths:
  - src/**/*.{html,css,scss,tsx,jsx,vue,svelte,astro}
---
# Web UI and accessibility

- Semantic HTML first: landmarks, one `h1`, headings in order, lists for lists, `button` for actions, `a` for navigation.
- Prefer native elements (`dialog`, `details`, form controls, `popover`) to custom widgets; check Baseline support for newer ones.
- Add ARIA only where native semantics can't express the meaning; never put `aria-hidden` on something focusable.
- Every control has an accessible name and every input a visible label; images have `alt`, empty for decorative ones.
- Everything works by keyboard in a logical order with a visible `:focus-visible` style; no positive `tabindex`.
- Text contrast is at least 4.5:1 (3:1 for large text, icons and control borders); colour is never the only signal.
- Targets are at least 24x24 CSS px, ideally 44, with space between them on touch screens.
- Build mobile first and check 320, 375, 768 and a wide desktop; no horizontal scroll at 320 px or at 200% zoom.
- Set type in `rem` so user font settings apply; scale it fluidly with `clamp()`; keep lines around 45-75 characters.
- Full-height sections use `svh` or `dvh`, not `vh`, which mobile browser toolbars break; check on a real phone.
- Respect `prefers-reduced-motion`: drop parallax, autoplay and large movement, and keep essential transitions short.
- Animate only `transform` and `opacity`; never animate layout properties on scroll or in loops.
- Reserve space for images, embeds, fonts and late content with dimensions or `aspect-ratio`, so nothing shifts.
- Images: AVIF or WebP with `srcset` and `sizes`, lazy below the fold; the LCP image loads eagerly with `fetchpriority="high"`.
- Fonts: few files, subset, the critical one preloaded, `font-display` chosen on purpose, a metric-matched fallback.
- Colour, spacing, type, radius and shadows come from the design tokens; no one-off values.
- Design every state: hover, focus, active, disabled, loading, empty, error, success, long text, missing images.
- User content can't break the layout: `overflow-wrap`, `min-width: 0` on flex and grid children, deliberate truncation.
- Use logical properties (`margin-inline`, `padding-block`) where the UI may be translated or run right to left.
- Inputs get the right `type`, `autocomplete` and `inputmode`; errors show as text by the field, tied with `aria-describedby`.
- Dark mode, where supported, comes from tokens and `prefers-color-scheme`, with contrast checked in both themes.
