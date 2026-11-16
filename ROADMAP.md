# Roadmap

What comes after v3, what is still open, and what Worklings will not do. There are no dates: the order is the order of
work, and nothing here is a promise. The sources are `SPEC-v3.md` (its "Out of scope" and "Launch prep" sections) and
the build's checklist in `.claude/runs/v3/checklist.json`. Ideas are welcome in
[Discussions](https://github.com/zeusstudiodev/worklings/discussions) and [issues](https://github.com/zeusstudiodev/worklings/issues).

## Before the first release

v3 and the launch pieces below are built and checked on this computer only. Nothing is published yet: publishing waits
for the maintainer (`docs/launch/release-steps.md`).

- **Steering** is built. It has run end to end against a scripted Claude Code and twice against a real one: approving
  the CEO's plan, messaging a room or everyone, seeing a message land, ordering the task board, the decision log, a
  leash for each person, a command palette (Ctrl+K) and doing all of it by talking to the CEO.
- **A one-command start**, `npx worklings`, opens the lobby with the demo company and a way to start your first
  company, backed by a first-run check (`worklings doctor`). It works from `npm pack` in a clean folder and needs the
  package to be published.
- **The plugin from GitHub**, `claude plugin marketplace add zeusstudiodev/worklings`, works from a local marketplace. The
  GitHub route needs the repository and the release commit that holds the plugin's runtime.
- **A live demo in the browser**, with no install and no Claude Code, is built for GitHub Pages and checked as Pages
  would serve it. It is not deployed.
- **A hero video, feature clips and screenshots** of the v3 look are in `docs/launch/`.
- **Still to do:** the last fixes from the design and accessibility gates, and a full run of every check on the
  finished state.

## Known limits

These are written down, not hidden.

- **Phone access has not been tried on real hardware.** Tailnet mode (`worklings hub --tailnet`) was tested against a
  fake `tailscale`. A run on a real tailnet with a real phone is still to do.
- **Windows is the system it was built and tested on.** The package check runs on Windows, macOS and Linux in CI, but
  the full test suite and the end-to-end tests have only been run on Windows.
- **Desks are not sandboxed.** A person's code runs as you. Isolating desks per operating-system user or container would
  go further and is not in v3. See [SECURITY.md](SECURITY.md).
- **Approvals nobody answers** for about 10 minutes, or that are open when the hub restarts, count as a no.
- **The tailnet link carries the long-lived token.**
- **Project allow rules** in a repository's Claude Code settings do not apply to a desk until the folder is trusted.
- **The preview starts the project's `dev` or `start` script through `npm`**, even when the project uses pnpm, yarn or
  bun. A project with no such script has no preview.
- **Claude Code's inner workings can change.** The stream-json and MCP protocols and the transcript format are pinned
  by recorded fixtures for Claude Code 2.1.312, and each new version needs a re-check.

## Later, not promised

- **Other tools than Claude Code**, Codex first. The code that starts, feeds, interrupts and closes a person's session
  sits behind a small interface (`src/runtime/harness.ts`), so a second tool can be added without rewriting the company.
- **Safer desks.** Running each desk as its own operating-system user, or in a container, so code a person runs cannot
  reach the office's token.
- **More kinds of project and roles** in the library. This needs no code: see the
  [good first issues](docs/launch/good-first-issues.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
- **Package managers in the preview** other than npm.

## Not planned

- **A hosted service**, or running companies for other people. Worklings runs on your computer, with your own Claude
  Code and your own plan or key.
- **Handling sign-in.** Worklings never touches credentials.
- **People rewriting Worklings' own code from inside a company**, except when Worklings' own repository is the
  company's project.
- **Voice.**
- **Bought art.** The art is CC0 packs only; see [CREDITS.md](CREDITS.md).
