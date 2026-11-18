# Roadmap

What is built, what comes next, what is still open, and what Worklings will not do. There are no dates: the order is the
order of work, and nothing here is a promise. The sources are [SPEC-v0.7.md](SPEC-v0.7.md) (Claude Code with an office
around it), [SPEC-v0.8.md](SPEC-v0.8.md) (office first) and [docs/benchmark.md](docs/benchmark.md). Ideas are welcome in
[Discussions](https://github.com/zeusstudiodev/worklings/discussions) and [issues](https://github.com/zeusstudiodev/worklings/issues).

## Where it stands

- **A job is one unmodified Claude Code session** on your words, with your own setup, tools, model, effort and permission
  mode. A [contract test](test/parity-contract.test.ts) holds its launch to plain `claude -p` plus the short list of
  allowed differences in [src/core/plain.ts](src/core/plain.ts), and the parity bench found no difference 20 pairs can
  detect ([docs/benchmark.md](docs/benchmark.md)).
- **Packs** (0.4.0): Kickoff, as a plain file in the project's `.claude/`, off by default and added in the start form or
  with `worklings new --pack kickoff`. Not recommended yet: it missed its bench rule on cost.
- **The office around it:** one inbox card for Claude Code's own permission prompts and end-of-turn words, its todo list
  as a task board, its subagents as helpers with their own cost, budgets as Claude Code's own `--max-budget-usd`, plan
  first as an extra, a lobby of projects, portfolios, the studio chat, the timeline, dashboards and the preview.
- **The team of roles** (a Lead, a Builder and a strict Reviewer with a fix round) is an experimental choice. In our
  benches it cost about twice as much as one session and was not better.
- **Install:** the Claude Code plugin from GitHub (`claude plugin marketplace add zeusstudiodev/worklings`), a clone, or
  `npx worklings` once the npm package is published. The [live demo](https://zeusstudiodev.github.io/worklings/)
  needs nothing installed and replays one real recorded run.

## Next

- **More measured packs.** v0.9 built packs ([SPEC-v0.9.md](SPEC-v0.9.md)): opt-in Claude Code setup in the project's
  `.claude/`, recommended only where a paired bench shows it helped. None met its rule in the first bench
  ([docs/benchmark.md](docs/benchmark.md#packs)): kickoff won every pair on short requests but cost 3x plain because it
  built what the person wanted, and ships opt-in in 0.4.0; check before done and the review round were level or behind,
  and were not shipped. Next: kickoff with a person who only says "go with your recommendations",
  the review round on the biggest tasks, and two packs still untested:
  - **Parallel builders** for a job that divides along a contract.
  - **Best of two.**
- **A better parity bench:** more pairs, a decision rule checked against two identical arms before it runs, and a
  bench that a model-written test which never exits can't stall.
- **Real-world checks still to do:** a real tailnet with a real phone, and the full test suite and a real job on macOS
  and Linux.
- **Each new Claude Code version** gets its stream-json, hook and MCP fixtures re-recorded and read before anything is
  built on it ([docs/claude-code-surfaces.md](docs/claude-code-surfaces.md)).

## Known limits

These are written down, not hidden.

- **Phone access has not been tried on real hardware.** Tailnet mode (`worklings hub --tailnet`) was tested against a
  fake `tailscale`; the phone layout was checked in a phone-sized browser.
- **Windows is the system it was built and tested on.** The package check runs on Windows, macOS and Linux in CI, but
  the full test suite and the end-to-end tests have only been run on Windows.
- **Sessions are not sandboxed.** Code a session runs, runs as you. See [SECURITY.md](SECURITY.md).
- **The task board shows a todo list only when the model keeps one.** Sonnet 5.5 and Haiku 5.5 keep none unless your
  Claude Code turns the todo tools on.
- **In a team, a question nobody answers in time counts as a no,** unless its asker said every option can be undone.
- **The tailnet link carries the long-lived token.**
- **Project allow rules** in a repository's Claude Code settings do not apply to a desk until the folder is trusted.
- **The preview starts the project's `dev` or `start` script through `npm`**, even when the project uses pnpm, yarn or
  bun. A project with no such script has no preview.
- **Claude Code's inner workings can change.** The stream-json and MCP protocols and the transcript format are pinned
  by recorded fixtures for Claude Code 2.1.312.

## Later, not promised

- **Other tools than Claude Code**, Codex first. The code that starts, feeds, interrupts and closes a session sits
  behind a small interface (`src/runtime/harness.ts`), so a second tool can be added without rewriting the office.
- **Safer sessions.** Running each one as its own operating-system user, or in a container, so code it runs cannot
  reach the office's token.
- **More kinds of project and roles** in the studio library. This needs no code: see the
  [good first issues](docs/launch/good-first-issues.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
- **Package managers in the preview** other than npm.

## Not planned

- **Changing how Claude Code works in a default job:** no prompt appended, no tools taken away, no approvals stricter
  than Claude Code's own. The contract test fails any change that does.
- **A team of roles as the default,** unless a bench shows it beats one session.
- **A hosted service**, or running jobs for other people. Worklings runs on your computer, with your own Claude Code
  and your own plan or key.
- **Handling sign-in.** Worklings never touches credentials.
- **Voice.**
- **Bought art.** The art is CC0 packs only; see [CREDITS.md](CREDITS.md).
