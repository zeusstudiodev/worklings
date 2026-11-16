---
name: office
description: >-
  Opens the Worklings office for this project: a local 3D view of the studio where you watch Claude Code sessions
  work and see what each role costs. Use when someone wants to see the studio, the team at work, or what the agents
  are spending.
allowed-tools: Bash(worklings *)
---
# Open the office

1. Check the live hooks with `worklings hooks status`. If they are not installed, offer to install them: they are http
   hooks in `.claude/settings.local.json` (kept out of git) so new sessions report to the office, and they fail quietly
   whenever the office is closed. Only with the person's OK, run `worklings hooks install --yes`: the command asks
   before it writes, and `--yes` passes on the answer they gave you.
2. Start the office in the background, since it keeps running: `worklings office`. It opens the person's browser
   with an access link that carries a token, so don't repeat the link in your reply: say the office is open in their
   browser. If no browser opened (a remote machine, say), tell them to run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/worklings.mjs" office` in their own terminal, where the link stays out of the
   conversation (`worklings` is on the path only inside Claude Code).
3. If the port is already in use, an office is probably running already: the person can use the browser tab it
   opened, or stop it and start it again.
4. Without live sessions to watch, `worklings demo` shows a made-up team at work and `worklings replay` replays the
   project's last recorded session.
