---
paths:
  - src/**/*.{ts,js,mjs}
---
# Node services

- Check the Node version the project targets and the framework's major; prefer built-ins (`fetch`, `node:test`) to new packages.
- Validate every body, query and path parameter with the project's schema library; reject unknown and oversized input.
- Read config from the environment once at startup, validate it, and fail fast when something required is missing.
- One error handler maps errors to status codes and safe messages; clients never see stack traces or internal details.
- Rejected promises in async route handlers must reach the error handler (Express 5 forwards them; Express 4 needs a wrapper).
- Authenticate and authorise every route that needs it, deny by default, and check the caller's right to the specific object.
- Never build SQL, shell commands or paths from raw input: use parameters, argument arrays and paths confined to a base folder.
- Every outbound call has a timeout (`AbortSignal.timeout`); retry with backoff and jitter only when the request is idempotent.
- Don't block the event loop: no sync file or crypto calls in request paths; send CPU-heavy work to worker threads or a queue.
- Paginate list endpoints and bound every query.
- Rate-limit authentication and expensive endpoints, and cap request body size.
- Set security headers and an explicit CORS allowlist; never `*` together with credentials.
- Log structured JSON with a request id; never log tokens, passwords, cookies or personal data in full.
- Accept idempotency keys on create and payment endpoints that clients may retry.
- Shut down gracefully on SIGTERM: stop accepting connections, finish in-flight requests, close pools.
- Keep health endpoints cheap, with liveness separate from readiness.
- Keep the API backward compatible for existing clients; deprecate before removing a field or route.
- Commit the lockfile; check new dependencies for maintenance and run the audit when dependencies change.
