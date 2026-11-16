---
title: CLIs and packages
department: engineering
stacks: [cli, library]
paths:
  - "src/**/*.{ts,js,mjs,cjs,py,rs,go}"
  - "bin/**"
  - "lib/**"
  - "cli/**"
  - "cmd/**"
  - "package.json"
  - "pyproject.toml"
  - "Cargo.toml"
---
- The public API is a contract: semver, breaking changes only in a major, deprecation first with a warning and migration note.
- Keep the public surface small and explicit (an `exports` map, `__all__`, `pub` items); everything else stays internal.
- Ship only built files through an allowlist, and check the contents with `npm pack --dry-run` or a test install.
- Ship types that match the runtime, and test the built package, not just the source.
- Declare the supported runtimes (`engines`, `requires-python`, minimum Rust version) and test the oldest and newest in CI.
- Keep dependencies few; frameworks the host app already provides are peer dependencies.
- Importing the package has no side effects: no network, no file writes, no global patching.
- Every CLI has `--help` with examples and `--version`, exits 0 on success and non-zero on failure.
- Results go to stdout, messages and errors to stderr, so output can be piped.
- Offer machine-readable output (`--json`) for anything scripts may parse, and keep its shape stable.
- No colour, spinners or prompts when stdout isn't a TTY or `NO_COLOR` is set; every prompt has a flag equivalent.
- Destructive actions ask for confirmation or require `--force` or `--yes`; offer `--dry-run` where it's cheap.
- Error messages say what failed, why, and what to do next; stack traces only with `--verbose` or a debug variable.
- Config precedence is flags, then environment, then config file, then defaults, and the docs say so.
- Behave the same on Windows, macOS and Linux: platform path APIs, paths with spaces, no bash-only package scripts.
- Start fast: load heavy modules lazily and do no work at import.
- Every user-visible change gets a changelog entry in the same change.
- Publishing (`npm publish`, `twine upload`, `cargo publish`) happens only with the person's explicit OK.
