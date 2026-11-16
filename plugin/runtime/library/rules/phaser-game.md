---
title: Phaser and 2D web games
department: engineering
stacks: [phaser, pixi, kaplay]
paths:
  - "src/**/*.{ts,js}"
  - "game/**/*.{ts,js}"
  - "scenes/**/*.{ts,js}"
  - "assets/**"
  - "public/assets/**"
---
- Check the installed engine version; Phaser 4 changed the renderer and some APIs, and most examples online target Phaser 3.
- Scale every movement, timer and animation by delta time; never assume 60 fps on high-refresh screens or throttled tabs.
- Game rules live in plain, unit-tested modules with no rendering; scenes display state and route input.
- Seed randomness per run so bugs, replays and balance simulations reproduce.
- Load assets in a boot or preload scene with visible progress; pack sprites into atlases and keep the first download small.
- Pool objects that spawn often (bullets, particles, enemies, damage numbers) instead of creating and destroying them.
- On scene shutdown, remove timers, tweens, input handlers and event listeners; scene restarts are where leaks begin.
- Allocate nothing per frame in update loops: reuse vectors, arrays and objects.
- Scale from a fixed design resolution (Phaser's scale manager or equivalent); test portrait, landscape, odd ratios and resizes.
- Pointer events cover mouse and touch; make touch targets large, never rely on hover, and add keys where they fit.
- Browsers block audio until the first user gesture: unlock it then, keep a persistent mute setting, and pause on blur.
- Pause the game loop and audio when the tab is hidden or loses focus, and resume cleanly.
- Use the simplest physics that works (arcade before rigid bodies), with a fixed step where results must be deterministic.
- Text that changes every frame uses bitmap fonts or reused text objects, not a new text object per update.
- Keep draw calls low: batch by atlas, limit filters and post effects, and watch fill rate on phones.
- Version the save data in `localStorage`, migrate it on load, and cope with storage being unavailable (private mode, iframes).
- Wire portal SDK events (loading, gameplay start and stop, ad breaks) as the portal's docs say; mute and pause around ads.
- Check performance on a mid-range phone: steady frame time and flat memory over a long session.
