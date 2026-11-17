# Release steps

What publishing Worklings 0.2.0 takes, in order. Every step is the maintainer's: nothing here has been done, and nothing is
public until you run it. 0.1.0 was prepared on 13 Nov 2026 (the local branch `release`) and never published; 0.2.0 is the
first public release, made from the candidate branch `run/v0.7` into the branch `release-0.2`. Names, as decided: the repository `zeusstudiodev/worklings`, the npm package `worklings`, the demo at
https://zeusstudiodev.github.io/worklings/, all from `scripts/home.json` (edit it, then `node scripts/set-home.mjs` rewrites every
link and `npm run check:public` confirms). Commands are for PowerShell or bash in the repository's folder.

## 0. Create the GitHub organization (makes nothing public)

On github.com, signed in as the account that will own it: your profile picture, Your organizations, New organization,
the Free plan, the name `zeusstudiodev`, contact email support@zeusstudio.dev. Add no repository yet; step 3 makes it.

## 1. Check the release candidate (makes nothing public)

```bash
git switch run/v0.7
git status
```

The tree must be clean. Then run every check; each must pass:

```bash
npm run typecheck
npm run lint
npm run lint:library
npm test
npm run build
npm run build:plugin
npm run e2e
npm run build:site
npx playwright test -c test/site
npm run check:package
npm run check:public
```

`check:package` packs the package as npm would, installs it in a clean folder and starts it. `check:public` scans every
tracked text file the release ships for the private terms, secret shapes and links to another owner's copy, and must
say "Clean". The private terms (local paths, the maintainer's names and email, other private projects) are kept out of
the repository in `~/.config/worklings/public-blocklist.json` (or `WORKLINGS_PUBLIC_BLOCKLIST`); without that file the
scan and the release script refuse to run. Check that the names are still free: `npm view worklings` should say the package is not found, and
`gh repo view zeusstudiodev/worklings` that the repository is not found.

`npm run e2e` has known failures that are not about this release: `v3-company:10` and `v3-dashboards:77` at both v3
sizes, and `v3-progress:215` at 768 px (the demo's budget meter); anything else failing stops the release.

## 2. Make the one public commit (makes nothing public yet)

Publish a single commit, not the build history. `check:public` covers the files as they are now, but the commits of
`run/v1` to `run/v3` still carry what was removed since (this machine's user folder in 18 of them, your surname in 5,
the names of your other private projects in about 5, plus the run logs). So the public repository gets one parentless
commit holding the published files, and the `run/*` branches stay on this machine and are never pushed.

`scripts/release-squash.ts` builds that commit. What it holds is listed in `scripts/release-manifest.json`: include
patterns and exclusions, in a committed file. Everything under `.claude/runs/` (progress logs, checklists), local settings
(`.claude/settings.local.json`), scratch, `dist/` and `test-results/` stay out; the source, web app, library, plugin, docs,
tests, scripts, configs, the community files and the studio's own `.claude/` agents, rules, skills and settings go in. A
new top-level file is left out until you add it to the manifest; the dry run lists what is left out, by folder.

**a. Prepare the version, on `run/v0.7`.** Done for 0.2.0 on 16 Nov 2026: `CHANGELOG.md` carries the heading
"0.2.0, 16 November 2026", `package.json` says 0.2.0 and has no `"private": true`. The plugin's version follows from
`package.json` in step b. The squash reads the committed files, so anything left uncommitted is refused (`git status` must be clean
apart from files the manifest leaves out).

**b. Stage the plugin runtime.**

```bash
node scripts/release-plugin.ts --stage
```

It builds `plugin/runtime/`, checks it and stages it with `--force` (`.gitignore` lists it on working branches). It never
commits. The squash takes its files from the index, so this comes first; the staged runtime is the only difference from
`HEAD` it accepts.

**c. Rehearse.**

```bash
npm run release:squash -- --dry-run --branch release-0.2
```

It shows the file list and size, the identity it would use, whether the clock allows the commit (and when it would), and the
privacy scan's result on the files it would commit. It creates nothing: no commit, no branch, nothing staged.

**d. Make the commit.** Worklings is published by Zeus Studio, so the commit's author and committer are Zeus Studio,
from `scripts/home.json`, whatever `git config` says:

```bash
npm run release:squash -- --branch release-0.2 --message "Worklings 0.2.0" --author "Zeus Studio <support@zeusstudio.dev>" --yes
```

Leaving out `--author` gives the same identity. `--yes` makes it without questions, printing the identity it used; it
takes only Zeus Studio's address or a GitHub noreply one. Without `--yes` it asks before making the commit. An identity
with the maintainer's own name, handle or personal email is always refused (`personalIdentity` in
`scripts/check-public.mjs`).

It refuses when:

- it is Monday to Friday between 08:00 and 18:00 in this machine's time zone (it says when it can run; the commit is made
  outside office hours on purpose, and `--allow-office-hours` overrides it);
- tracked files differ from `HEAD` (other than the staged plugin runtime), the runtime isn't staged, or the branch it is
  told to make exists already (`release` holds the unpublished 0.1.0, so 0.2.0 goes to `--branch release-0.2`);
- the privacy scan finds anything in the tree it is about to commit: the same patterns as `check:public`, run on that tree.

It then prints the name and email it will use and asks `[y/N]`. An email that is neither Zeus Studio's nor a noreply
address needs to be typed back in full first. The commit is made with `git commit-tree`, message `Worklings 0.2.0` (from `--message`), no
trailers, author and committer from that identity, and the time it is made: no date is set or accepted, and a
`GIT_AUTHOR_DATE` in your environment is ignored. The result is the local branch `release-0.2`, one commit with no parent.
The working tree, the index and `run/v0.7` are not touched.

Look at it before going on:

```bash
git log --stat release-0.2
git ls-tree -r --name-only release-0.2 | head -50
node scripts/check-public.mjs --tree release-0.2
```

`--tree <commit>` and `--dir <exported folder>` run the scan on a release without trusting the script's own run of it.

**e. Tidy `run/v0.7`.** The staged plugin runtime is in the release now; take it out of `run/v0.7`'s index, so no later
commit there picks it up (the files stay on disk, ignored):

```bash
git restore --staged -- plugin .claude-plugin
git status --short
```

`git status` should list nothing but untracked files the manifest leaves out.
Test-only: `WORKLINGS_RELEASE_NOW` replaces the clock for the office-hours check in tests; never set it for a real run.

## 3. Create the repository and push (makes the code public)

```bash
gh repo create zeusstudiodev/worklings --public --description "Claude Code, with an office around it." --source . --remote origin
git push origin release-0.2:main
```

`gh repo create` with `--source` adds the remote and pushes nothing. `git push origin release-0.2:main` publishes the
branch `release-0.2` (the one commit from step 2) as `main` on GitHub, and nothing else: name every push by its refspec,
and never `git push --all`, `--mirror`, `git push origin release` or `git push origin run/v0.7`. Your local `main`, if it exists, and the `run/*` branches
stay on this machine. Afterwards `git remote -v` shows only `origin`, and `git ls-remote origin` lists `refs/heads/main` and,
after step 5, the tag. The package workflow (`.github/workflows/package.yml`) then runs on GitHub's machines for Linux, macOS and
Windows; it signs in to nothing.

## 4. The repository's settings (makes the page and its contact routes public)

```bash
gh repo edit zeusstudiodev/worklings --enable-discussions --homepage https://zeusstudiodev.github.io/worklings/ --add-topic claude-code --add-topic claude-code-plugin --add-topic ai-agents --add-topic multi-agent --add-topic agent-orchestration --add-topic subagents --add-topic mcp --add-topic ai-coding --add-topic react-three-fiber --add-topic threejs --add-topic typescript --add-topic developer-tools
```

```bash
gh api -X PUT repos/zeusstudiodev/worklings/private-vulnerability-reporting
```

The first turns on Discussions (the README and `ROADMAP.md` link to them) and sets the About box's website and
topics (the topics and why each: `docs/launch/topics.md`); the description came with `gh repo create`. The second turns
on private vulnerability reporting, which `SECURITY.md` points people to. One setting has no command: Settings,
General, Social preview, upload `docs/launch/social-preview.png` (1280 by 640), which is what links to the repository
show on other sites.

## 5. The plugin and the release (makes the plugin installable from GitHub)

Nothing to build: the plugin runtime was staged in step 2b, so it is already inside the one commit, and step 3 pushed
it. `release-plugin.ts --stage` bundled the CLI, the web app and the library into `plugin/runtime/` and set
`plugin/.claude-plugin/plugin.json` to the package's version. Tag the release commit, push the tag by name, and make the
GitHub release:

```bash
git tag v0.2.0 release-0.2
git push origin v0.2.0
gh release create v0.2.0 --repo zeusstudiodev/worklings --verify-tag --title "Worklings 0.2.0" --notes "The first public release. Claude Code, with an office around it: say what to build and your words go, as you wrote them, to your own claude with your own setup, while a 3D office shows what it is doing and lets you steer it. One inbox for Claude Code's own permission prompts and questions, pause and stop, budgets, model and effort per job, Claude Code's own todo list as the task board, and its subagents as helpers with their own cost. Portfolios and a studio chat across your companies. A team of a Lead, a Builder and a Reviewer is there as an experiment: in our tests it cost about twice as much and was not better than one session. Runs your own claude on your own machine and plan. Install it as a Claude Code plugin (claude plugin marketplace add zeusstudiodev/worklings, then claude plugin install worklings@worklings) or from a clone (README, Try it in 30 seconds); the npm package follows. Everything in this release: CHANGELOG.md. Live demo: https://zeusstudiodev.github.io/worklings/"
```

After the push anyone can run `claude plugin marketplace add zeusstudiodev/worklings` and
`claude plugin install worklings@worklings`.

## 6. The npm package (makes `npx worklings` work for everyone)

`"private": true` is already gone (step 2a). The registry shows the publisher's npm username and email on the package
(`maintainers`, `_npmUser`) for good, so publish from Zeus Studio's own npm account, registered with
support@zeusstudio.dev, never from a personal one. Sign it in on this computer (`npm whoami` must print that account;
`npm logout`, then `npm login`, if it doesn't), and turn on two-factor authentication for it.
From a checkout of the commit you published, so the package matches the repository:

```bash
git worktree add ../worklings-release release-0.2
cd ../worklings-release
npm ci
npm run check:package
npm publish
```

`prepack` cleans and builds first. Then, in an empty folder, `npx worklings doctor` should run. The README needs no
edit: it already says `npx worklings` works once the package is out. Remove the worktree afterwards
(`git worktree remove ../worklings-release` from the main checkout). Later releases are ordinary commits on top of
`release-0.2`'s history: fetch it into a clone of the public repository and work from there, since this machine's `run/*`
history is never pushed.

## 7. The web demo (makes https://zeusstudiodev.github.io/worklings/ public)

```bash
gh api -X POST repos/zeusstudiodev/worklings/pages -f build_type=workflow
gh workflow run pages.yml --repo zeusstudiodev/worklings
gh run list --repo zeusstudiodev/worklings --workflow pages.yml --limit 1
```

The first command turns Pages on with GitHub Actions as its source; the second starts the demo's workflow
(`.github/workflows/pages.yml`, which runs only when started by hand); the third shows the run, and
`gh run watch <run id> --repo zeusstudiodev/worklings` follows it to the end. It builds `dist/site` (`npm run build:site`,
base `/worklings/`) and deploys it. Open the address and look at the demo company at 1440 px and at 375 px.

## 8. After

- From a computer that has never seen the project, try both install routes: `npx worklings`, and the two plugin
  commands followed by `/worklings:hub` in Claude Code.
- Open the good first issues in `docs/launch/good-first-issues.md` if you want them in the tracker (label
  `good first issue`).

## Releases after 0.2.0

The public repository already has history: `main` on `zeus` (`zeusstudiodev/worklings`) is 0.2.0's one commit. A later
release adds one commit on top of it, never a second parentless root, and this machine's `run/*` history is still never
pushed. Shown for 0.3.0 from `run/v0.8`; for another version, change the numbers. Every step is the maintainer's.

**1. Check and prepare, on the candidate branch** (makes nothing public). Run every check in step 1 above on `run/v0.8`.
`package.json` says 0.3.0 already; on the day, turn the changelog's heading "0.3.0 (unreleased)" into "0.3.0, <date>" and
commit it. The plugin's version follows from `package.json` when the runtime is staged.

**2. The squashed tree, on a temporary branch** (makes nothing public). The squash script makes the tree exactly as for
0.2.0: the manifest's files, the staged plugin runtime, the privacy scan. It writes to a branch that doesn't exist yet,
so `release-0.3` is fine (it refuses a name that exists, such as `release` or `release-0.2`):

```bash
node scripts/release-plugin.ts --stage
npm run release:squash -- --dry-run --branch release-0.3
npm run release:squash -- --branch release-0.3 --message "Worklings 0.3.0" --yes
```

`release-0.3` is a parentless commit: only its tree is used. It refuses inside office hours, as for 0.2.0.

**3. The public commit on top of the public `main`** (makes nothing public yet). In the same sitting, outside office
hours, as Zeus Studio. In bash:

```bash
git fetch zeus main
tree=$(git rev-parse 'release-0.3^{tree}')
git diff --stat zeus/main "$tree"
commit=$(GIT_AUTHOR_NAME="Zeus Studio" GIT_AUTHOR_EMAIL=support@zeusstudio.dev \
  GIT_COMMITTER_NAME="Zeus Studio" GIT_COMMITTER_EMAIL=support@zeusstudio.dev \
  git commit-tree "$tree" -p zeus/main -m "Worklings 0.3.0")
git branch release-0.3-public "$commit"
git log --format='%an <%ae> %ad%n%cn <%ce> %cd' -1 release-0.3-public
node scripts/check-public.mjs --tree release-0.3-public
```

In PowerShell, set the four variables with `$env:GIT_AUTHOR_NAME = "Zeus Studio"` and so on, run
`$tree = git rev-parse 'release-0.3^{tree}'` and `$commit = git commit-tree $tree -p zeus/main -m "Worklings 0.3.0"`, then
remove the four variables (`Remove-Item Env:GIT_AUTHOR_NAME`, and so on). `git commit-tree` doesn't check the clock as
the squash script does: the `git log` line shows the time it stamped, which must be outside office hours. The diff is
what the release changes on GitHub; the scan must say "Clean". Then take the staged runtime out of `run/v0.8`'s index,
as in step 2e (`git restore --staged -- plugin .claude-plugin`).

**4. Push, tag and release** (makes it public).

```bash
git push zeus release-0.3-public:main
git tag v0.3.0 release-0.3-public
git push zeus v0.3.0
gh release create v0.3.0 --repo zeusstudiodev/worklings --verify-tag --title "Worklings 0.3.0" --notes-file <the 0.3.0 section of CHANGELOG.md, saved to a file>
```

The push is a fast-forward of `main` (one commit on top), so it needs no force; if it is refused, `main` moved since the
fetch: fetch again and make the commit again in step 3. Then step 6 for npm (from a worktree of `release-0.3-public`)
and step 7 for the web demo, as for 0.2.0. `release-0.3` and `release-0.3-public` stay local.
