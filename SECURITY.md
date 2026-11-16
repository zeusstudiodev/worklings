# Security policy

## Report a problem

Please do not open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**
(or go to https://github.com/zeusstudiodev/worklings/security/advisories/new). Only the maintainer sees the report. If
GitHub isn't an option, write to Zeus Studio at support@zeusstudio.dev.

Say what you found, the steps to reproduce it, the Worklings version (`worklings --version`), your operating system and
what an attacker could do with it. A proof of concept helps. Do not include real tokens, keys or private project
content.

## What happens next

Worklings is MIT-licensed, free software maintained by one person, so these are intentions, not guarantees. There is no
bug bounty.

1. The maintainer reads the report and answers in the advisory, normally within a few days, to say whether it is in
   scope and whether it reproduces.
2. If it is accepted, the fix is made in private, and checked against the report.
3. The fix ships in a release, and the advisory is published with the fixed version, what was affected and, if you wish,
   your name. Please keep the details private until then.
4. If it is not accepted, the answer says why. You are free to publish it after that.

## Supported versions

The latest release. Fixes are not backported to older ones. Until the first release, the `main` branch.

## What is in scope

Worklings is a local tool that starts your own Claude Code and serves a web page on your computer. These parts take
input from outside and are in scope:

| Part | Where | What matters |
|---|---|---|
| The hub and the office server | `src/hub/`, `src/server/` | Access token on every read and write; loopback-only listening; the `Host` and origin checks; the folder picker; request size limits |
| The org tools | `src/orgtools/` | The MCP server on `127.0.0.1`, with one token per person: a call must act only as the person it belongs to |
| The approvals policy | `src/runtime/approvals.ts` | Anything that should ask (push, deploy, publish, deleting outside the project, changes under `.claude/`, `CLAUDE.md` and files it imports, hooks, `.mcp.json`, git config) but is allowed; commands that slip past the rules; Windows path tricks |
| Messages to people | `src/company/`, `src/runtime/` | A message body that can pass for a turn of its own, or for the stakeholder's words |
| The company's log and state | `src/company/`, `.worklings/` | Forging a line in the signed event log; reading or writing outside the project |
| The preview proxy | `src/server/preview.ts` | The app being previewed reaching the office's API or token; reaching other hosts |
| Tailnet mode | `src/server/tailnet.ts` | Anything that makes the hub reachable beyond your tailnet, or without the token. `--tailnet` must never use Tailscale Funnel |
| Hooks and telemetry intake | `src/hub/intake.ts`, `src/server/http.ts` | Accepting events from another computer, another project or an unauthenticated page |
| Everything people write | `src/core/redact.ts`, `web/` | Text from agents shown as anything but text; credentials that are not masked; dashboards that run code |
| Library and studio writes | `src/composer/`, `src/safe-fs.ts` | Writing outside `.claude/` or `CLAUDE.md`, writing through a symlink, a `--library` folder that carries hooks or tool grants |

## What is not in scope

- **Code a person writes and then runs.** A desk is your own Claude Code with your authority. A script or test it runs
  runs as you, and can reach whatever you can, including the office's token. Worklings is not a sandbox. This is
  documented in the README under "How much to trust a company" and in `docs/architecture.md` under "Trust". Run
  companies on projects whose content you trust. Ways to reduce it that need isolating desks per operating-system user
  or container are on the [roadmap](ROADMAP.md).
- **Claude Code, Tailscale and the other programs Worklings starts.** Report those to their makers. Claude
  Code reports go to Anthropic.
- **Anyone who already has your access token.** The link the office prints carries it; treat it like a password.
- **A computer you do not control**, or another user on your computer who can read your home folder.
- **Findings that need `--lan` on an untrusted network.** `--lan` serves plain HTTP and says so. It is for networks
  you trust.
- Denial of service by someone who can already send requests as you.

If you are not sure whether something is in scope, report it anyway.
