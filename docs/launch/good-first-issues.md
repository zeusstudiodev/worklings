# Good first issues

Five small, self-contained issues, each found in the code on 11 November 2026 and checked against it. To open them on
GitHub, copy each into a new issue with the label `good first issue`. The "Seen" line says what was run or read; run it
again before opening, because the code moves. Setup and checks are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 1. Phone lobby rows cut folder paths at the end

**Title:** On phones, a lobby row cuts its folder at the end, after the middle cut already shortened it

**Seen.** `lobbyRow` (`web/src/company/model.ts`, `folder: cutMiddle(c.root)`) shortens a company's folder in the middle to
34 characters, so `C:\Users\you\Projects\plant-pal` reads `C:\Users\…\plant-pal` and the folder's own name stays. At 375 px
the row is narrower than 34 characters, and `.lobby-row__folder` in `web/src/styles.css` cuts the text again at the
end with an ellipsis, so the part that tells two companies apart is the part that disappears (`docs/design-v3.md`,
"Lobby", asks for the middle cut).

**Files.** `web/src/company/model.ts` (`lobbyRow`, `cutMiddle`), `web/src/company/lobby/Lobby.tsx` (it knows `phone`),
`web/src/styles.css` (`.lobby-row__folder`).

**Change.** Give the phone layout a shorter maximum for the middle cut (or measure the space the row has), so the CSS
ellipsis never has to cut. Keep the full path in the `title`.

**Test.** A unit test in `test/panels-shell-model.test.ts` for the phone length; then `npm run e2e -- --project=v3-phone
test/e2e/v3-lobby.spec.ts` and look at `test-results/evidence/v3-lobby-two-v3-phone.png`: the folder ends in its own
name. Then `npm run typecheck`, `npm run lint` and `npm test`.

---

## 2. Add a Go rule to the library

**Title:** A Go project gets no Go rule

**Seen.** `src/composer/detect.ts` (line 323) adds the stack `go` when there is a `go.mod`, and the `api-service` domain
says it covers backends "in Node, Python or Go". No file in `library/rules/` lists `go` under `stacks:`, and
`api-service` lists no Go rule. Running
`node src/cli.ts new <a folder with a go.mod> --domain api-service --dry-run` writes 11 files and none of them is a rule.

**Files.** New `library/rules/go.md`; `library/domains/api-service.yaml` and `library/domains/cli-library.yaml` (add
`go` to `rules:`); the roster snapshot in `test/__snapshots__/compose-matrix.test.ts.snap` if it changes.

**Change.** `library/rules/go.md` follows the format and the writing bar in [`library/README.md`](../../library/README.md):
`stacks: [go]`, paths such as `**/*.go` and `go.mod`, and 8 to 25 short, checkable bullets. Tell the agent to read the
`go` directive in `go.mod` and the installed Go version instead of naming APIs from memory. Do not invent commands.

**Test.**
- `npm run lint:library` and `npm test` pass; run `npx vitest run -u` only after reading the snapshot diff.
- The dry run above now lists a Go rule.

---

## 3. Add a Rust rule to the library

**Title:** A Rust project gets no Rust rule

**Seen.** The same gap as the Go rule: `src/composer/detect.ts` (line 322) adds the stack `rust` for a `Cargo.toml`
outside a Tauri project, and no rule in `library/rules/` has `rust` in `stacks:`. The `cli-library` domain says it covers
packages published to "crates.io".

**Files.** New `library/rules/rust.md`; `library/domains/cli-library.yaml` (and `api-service.yaml` if you think it
fits); the roster snapshot if it changes.

**Change.** As for the Go rule: the library's format and writing bar, `stacks: [rust]`, paths such as `**/*.rs` and
`Cargo.toml`, specific and checkable bullets. Tell the agent to read the edition and `rust-version` from `Cargo.toml`.

**Test.** `npm run lint:library` and `npm test` pass, and
`node src/cli.ts new <a folder with a Cargo.toml> --domain cli-library --dry-run` lists the rule.

---

## 4. Detect the test and build commands of Go and Rust projects

**Title:** The studio's CLAUDE.md lists no commands for a Go or Rust project

**Seen.** `projectCommands` in `src/composer/detect.ts` (line 368) only reads `package.json` scripts, plus `pytest` and
`ruff` for Python. For a folder with a `go.mod` and a `Cargo.toml`, `node src/cli.ts detect <folder> --json` prints
`"commands": {}`, so the generated `CLAUDE.md` tells the studio nothing about how to build or test.

**Files.** `src/composer/detect.ts` (`projectCommands`, which already receives the set of stacks); `test/projects.ts`
(add small `go` and `rust` projects next to `godot`); `test/detect.test.ts`.

**Change.** For the stack `go`, set `build` to `go build ./...`, `test` to `go test ./...` and `lint` to `go vet ./...`.
For `rust`, set `build` to `cargo build`, `test` to `cargo test` and `lint` to `cargo clippy`. A `package.json` script of
the same name still wins, and a project with neither stack is unchanged.

**Test.** New cases in `test/detect.test.ts` for both stacks and for a project with a `package.json` and a `go.mod`;
the existing detect tests keep passing (`npx vitest run test/detect.test.ts`, then `npm test`).

---

## 5. Run the checks on every pull request

**Title:** CI runs only the package check, not typecheck, lint and tests

**Seen.** `.github/workflows/` holds one workflow, `package.yml`, which packs the package and runs it with `npx` on
Linux, macOS and Windows. Nothing runs `npm run typecheck`, `npm run lint`, `npm run lint:library` or `npm test` on a
pull request, so contributors find out only by running them by hand.

**Files.** New `.github/workflows/checks.yml`; `CONTRIBUTING.md` ("Checks") if you want to mention it.

**Change.** On `pull_request` and on pushes to `main`: check out, set up Node 22 with the npm cache, `npm ci`, then run
the four commands above on `ubuntu-latest`. Take `package.yml` as the model for permissions, `concurrency` and
`persist-credentials`. Leave `npm run e2e` out: it builds the app, installs a browser and takes about two minutes, and
can be a later, separate job. Tests never reach Claude Code (they use `test/fake-claude.mjs`), so the job needs no
secrets.

**Test.** Open the pull request from a branch and read the run. Say in the pull request which commands passed on the
runner. If a test fails there only, that is a finding worth its own issue: do not skip the test.
