---
paths:
  - src/**/*.{tsx,jsx}
---
# React on the web

- Check the installed React version, and whether the React Compiler is on, before using a newer API or adding memo hooks.
- Function components and hooks only; follow the rules of hooks and keep the project's hooks lint rules on.
- Derive values during render; don't copy props or other state into `useState` and sync them with effects.
- Effects sync with things outside React (subscriptions, timers, the DOM, widgets); they don't transform data or handle events.
- Effects that subscribe, listen or start timers return a cleanup; dev Strict Mode runs effects twice to expose missing ones.
- Load data through the framework's loaders, Server Components or the project's query library, not fetch-in-effect.
- Keys come from stable ids in the data, never the array index for lists that reorder, insert or delete.
- Keep state close to where it's used; context is for stable, app-wide values, not values that change on every keystroke.
- Don't add `useMemo`, `useCallback` or `memo` by reflex; profile first, and skip them where the React Compiler handles it.
- Buttons for actions, links for navigation; no click handlers on `div` or `span`.
- Move focus on purpose: after route changes, when dialogs open and close, after the focused item is removed.
- Put error boundaries around risky subtrees and `Suspense` with a real fallback around slow ones; design both states.
- Lazy-load routes and heavy, rarely used components; check the bundle size after adding a dependency.
- Never pass untrusted HTML to `dangerouslySetInnerHTML` unless a maintained sanitiser cleaned it first.
- In server-rendered apps, don't read `window`, `document` or storage during render; it breaks hydration.
- Forms use native elements with labels; choose controlled or uncontrolled per form and block double submits.
- Virtualise long lists, and give images dimensions so the layout doesn't shift.
- Split components that do several jobs; move reusable stateful logic into `use*` hooks.
