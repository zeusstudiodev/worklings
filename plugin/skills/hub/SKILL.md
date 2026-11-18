---
name: hub
description: >-
  Opens the Worklings hub: the lobby on this computer where your Claude Code jobs run, each in its own 3D office. Use
  when someone wants to start a job from a sentence in the office, see how their jobs and companies are doing, approve
  what Claude Code asks, or open the lobby.
argument-hint: "[--port <n>] [--tailnet]"
allowed-tools: Bash(worklings *)
---
# Open the hub

1. Start the hub in the background, since it keeps running: `worklings hub`, adding `--port <n>` or `--tailnet` when
   the person asked for them (`--tailnet` reaches the hub from their phone and needs Tailscale). It opens the person's
   browser at the lobby with an access link that carries a token, so don't repeat the link in your reply: say the lobby
   is open in their browser. If no browser opened (a remote machine, say), tell them to run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/worklings.mjs" hub` in their own terminal, where the link stays out of the
   conversation (`worklings` is on the path only inside Claude Code).
2. If it says another hub is running or the port is in use, a hub is probably running already: one hub serves every
   company on this computer. The person can use the browser tab it opened, or stop that hub and run this again.
3. If it says Worklings needs Node.js, pass that sentence on as it is: the hub runs on Node 22 or later.
4. Say what comes next: start a company in the lobby by choosing a folder and writing one sentence about what to build,
   and the CEO drafts its org for them to approve. Closing the hub closes every company's desks; they pick up where
   they stopped when it opens again.
