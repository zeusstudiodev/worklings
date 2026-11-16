---
title: TypeScript
department: engineering
stacks: [typescript]
paths:
  - "src/**/*.{ts,tsx}"
  - "app/**/*.{ts,tsx}"
  - "lib/**/*.{ts,tsx}"
  - "packages/**/*.{ts,tsx}"
  - "server/**/*.ts"
  - "scripts/**/*.ts"
---
- Keep `strict` on. Fix type errors at their cause; never silence them with `any`, `@ts-ignore` or `as unknown as`.
- Validate data at the boundary (user input, network responses, files, environment) and keep it typed inside.
- Prefer discriminated unions over optional-field soup for values that come in several shapes.
- Narrow with type guards instead of casting; a cast is a claim the compiler can't check.
- Export types from the module that owns the data; don't redeclare a library's types.
- Use `unknown` for values you haven't checked yet, never `any`.
- Prefer `const` and pure functions; keep side effects at the edges.
- Handle every promise: await it, return it or attach an error handler. No floating promises.
- Errors: throw `Error` objects with messages that say what failed and with which input; don't catch to ignore.
- Don't add a dependency for something the platform or the standard library already does.
- Match the project's module style, import paths and naming; run its typecheck and lint before calling a change done.
