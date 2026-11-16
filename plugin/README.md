# Worklings for Claude Code

Claude Code with an office around it: watch, approve and steer your own Claude Code from a 3D office, or staff a project
with an AI studio.

## Install

In a terminal:

```bash
claude plugin marketplace add zeusstudiodev/worklings
claude plugin install worklings@worklings
```

Or inside Claude Code: `/plugin marketplace add zeusstudiodev/worklings`, then `/plugin install worklings@worklings`.

Then, in Claude Code, `/worklings:hub` opens the lobby in your browser.

There is nothing to clone, install with npm or build: the plugin carries the Worklings CLI ready to run (in
`runtime/`), and nothing is downloaded when it first starts. It needs [Node.js](https://nodejs.org/) 22 or later on
your PATH, and git, which Claude Code uses to fetch the marketplace.

## Commands

- `/worklings:hub` opens the hub: the lobby where your companies run. Start one by choosing a folder and writing one
  sentence about what to build.
- `/worklings:office` opens the 3D office for the project you are in, live from your Claude Code sessions.
- `/worklings:new` staffs the project with a studio: subagents, path rules, workflows and review gates for its kind
  and stack.
- `/worklings:hire` and `/worklings:fire` change the team; `/worklings:adopt` brings in agents you already have.

The hub and the office answer on 127.0.0.1 unless you ask for more (the hub's `--tailnet` reaches your phone), and
every link they open carries an access token.

## Update and remove

Installed copies update when a new version is released: run `claude plugin update worklings@worklings`, or turn on
auto-update for the marketplace under **Marketplaces** in `/plugin`.

To remove it: `claude plugin uninstall worklings@worklings`, then `claude plugin marketplace remove worklings`.
