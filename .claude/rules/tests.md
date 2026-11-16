---
paths:
  - "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}"
  - test/**
  - "**/test_*.py"
  - "**/*_test.{py,go}"
---
# Tests

- Test behaviour through the public interface: inputs in, outputs and visible effects out. Don't assert on internals.
- One behaviour per test, named for it ("rejects an expired token"), so a failure explains itself.
- Every bug fix adds a test that fails without the fix, for the reason the bug happened.
- Never weaken, skip, delete or special-case a test to get green. If a test is wrong, fix it and say why.
- Keep tests deterministic: seed randomness, fake the clock and time zone, no real network or third-party services.
- Mock the boundaries you don't own (network, clock, file system, paid APIs), not the module under test.
- No fixed sleeps: wait for a condition, an event or a response.
- A flaky test is a bug. Find the race or the shared state; don't hide it with retries.
- Tests are independent: no order dependence, no shared mutable state, safe in parallel, and they clean up after themselves.
- Fixtures are small, realistic and built by factories that match production shapes.
- Cover the edges: empty, one, many, boundaries, invalid input, unicode, time zones, permission denied, failures.
- End-to-end tests cover the main user flows; find elements by role, label or test id, never by CSS structure.
- Snapshot tests only for stable output; read every snapshot diff before accepting it.
- Coverage points at untested code; it isn't a goal. A test without a meaningful assertion is noise.
- Keep the unit suite fast; slow tests against real services go behind a separate command.
- Run the tests you touched while working, and the full suite before calling a change done.
