# Claude Code surfaces Worklings reads

Checked against the Claude Code docs (code.claude.com/docs: hooks, sub-agents, monitoring-usage, statusline, plugins)
and a real headless run of Claude Code **2.1.312** on Windows (fixtures in `test/fixtures/claude-2.1.312/`).
Claude Code changes quickly: re-capture when a new version breaks a test (see "Refreshing fixtures").

## Hooks (live events)

Worklings installs `http` hooks. Claude Code POSTs the same JSON a command hook gets on stdin, and a hook that cannot
connect, times out or answers non-2xx is a non-blocking error (`onFailure: "continue"` is the default), so a stopped
office never blocks a session. Hooks from user, project and local settings merge.

```json
{ "type": "http", "url": "http://127.0.0.1:7421/hooks", "timeout": 2 }
```

Common fields seen on every event: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`hook_event_name`, `effort` (`{ level }`). Calls made inside a subagent add `agent_id` and `agent_type`; calls made by
the main session have neither.

| Event | Fields Worklings uses (seen in 2.1.312 unless marked) |
|---|---|
| `UserPromptSubmit` | `prompt`. Background-task notifications arrive here too, as a prompt starting with `<task-notification>`. |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, plus `agent_id`/`agent_type` inside subagents. Spawning a subagent is `tool_name: "Agent"` with `tool_input.subagent_type`. |
| `PostToolUse` | as above plus `tool_response`, `duration_ms`. For `Agent`, `tool_response` has `agentId`, `isAsync`, `status`, `resolvedModel`. |
| `PostToolUseFailure` | tool fields plus the error (docs). |
| `PostToolBatch` | `tool_calls` (one batch of parallel calls). |
| `SubagentStart` | `agent_id`, `agent_type`. |
| `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`. |
| `Stop` | `last_assistant_message`, `background_tasks`. Subagents run in the background by default, so `Stop` can arrive before their `SubagentStop`. |
| `SessionEnd` | `reason`. |
| `PermissionRequest`, `PermissionDenied`, `Notification` | tool fields / message (docs; not triggered by the headless capture). |
| `TeammateIdle`, `TaskCreated`, `TaskCompleted` | agent teams, experimental behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (docs). |
| `PreCompact`, `PostCompact` | compaction (docs). |
| `SessionStart` | supports only `command` and `mcp_tool` handlers (docs), so an `http` hook never sees it; sessions are discovered from their first event instead. |

## Transcripts (tokens, models, replay)

- Main session: `~/.claude/projects/<cwd with every non-alphanumeric character as "-">/<session_id>.jsonl`.
- Subagents: `<session_id>/subagents/agent-<agent_id>.jsonl` plus `agent-<agent_id>.meta.json` with `agentType`,
  `description`, `toolUseId` (the `Agent` call that spawned it), `spawnDepth` and `finished`.
- Assistant entries carry `message.id`, `message.model` and `message.usage` (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, and `cache_creation.ephemeral_5m_input_tokens` /
  `ephemeral_1h_input_tokens`). **One entry is written per content block with the same usage**, so totals must
  dedupe by `message.id`. Entries also carry `attributionSkill` (the skill that was running), `agentId` and
  `isSidechain` in subagent files.
- The format is internal and undocumented. The parser ignores entry types it doesn't know and never throws on a
  malformed line.
- Oracle from the capture run: the deduped totals (input 16, output 1,372, cache read 189,502, cache write 54,110 of
  which 6,101 were 5-minute and 48,009 one-hour writes) match `claude -p --output-format json`'s `modelUsage`, which
  priced the run at $0.012947045 on `claude-haiku-5-5`.

## OpenTelemetry (exact cost, optional)

With `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an OTLP logs exporter pointed at the office, `claude_code.api_request` events
carry `cost_usd`, the token counts, `model`, `agent_id` (absent for the main session) and `parent_agent_id`
(2.1.310+). These variables are ignored in a project's `env` block, so they belong in the user's shell or user settings.

## Print mode (headless calls)

Ask aside and Catch me up call `claude -p` (see "Catch me up and Ask aside" in `architecture.md`). Checked against Claude
Code **2.1.312** with Haiku 5.5; the real-call evidence is in `.claude/runs/v2/checklist.json`.

The office runs, with the prompt on stdin and no shell:

```text
claude -p --output-format json --max-turns 1 --tools "" --disallowedTools "mcp__*" --strict-mcp-config
       --no-session-persistence --settings {"disableAllHooks":true} --model haiku
       [--resume <session> --fork-session | --system-prompt <text>]
```

The fixed part is `READ_ONLY_FLAGS` in `src/server/claude.ts`; that array is the source of truth if this page and
the code ever differ. The runner also refuses flags that would give a run tools or permissions
(`--allowedTools`, `--permission-mode`, `--dangerously-skip-permissions`, `--mcp-config` and the like) and any value
that starts with `-`, and it starts the child with a cleaned environment (below).

### What keeps a call read-only

1. **Flags.** No built-in tools, no MCP tools or servers, one turn, no session saved, no hooks.
2. **Environment** (`claudeEnv`). The child starts from the office's environment minus the wiring of the Claude Code
   session the office may be running in: `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `ENABLE_IDE_INTEGRATION` and every
   `CLAUDE_CODE_*` and `CLAUDE_AGENT_SDK_*` variable. The person's own settings stay: sign-in (`CLAUDE_CODE_OAUTH_TOKEN`,
   the Bedrock, Vertex and Foundry switches and their skip-auth flags), client certificates, telemetry and
   non-essential-traffic switches, `CLAUDE_CODE_GIT_BASH_PATH`, plus `ANTHROPIC_*`, `CLAUDE_CONFIG_DIR` and proxies.
   `DISABLE_PROMPT_CACHING=1` is set.
3. **What is passed.** The prompt goes on stdin, never the command line, and nothing runs through a shell. A fork
   (`--resume <id> --fork-session`) is made only when the session id is a UUID; any other id is answered from the
   transcript. A caller's value that starts with `-` is refused.
4. **What goes in.** Free text is masked as the office takes it in (`shownText`), and the excerpt and account are
   masked again before they go into a prompt. The transcript read is limited to regular files and runs under the
   call's 60 s deadline.
5. **If it tries anyway.** With no tools and one turn, a model that reaches for a tool ends with `error_max_turns` and
   no text; the office shows a plain sentence, not an error.
6. **Over `--lan`.** Questions and catch-ups are taken only from the machine the office runs on (403 `local-only`).

| Checked | Result |
|---|---|
| `--tools ""`, `--strict-mcp-config` | No built-in tools and no MCP servers. `--tools` takes a list, so another flag must follow its empty value. |
| `--disallowedTools "mcp__*"` | Accepted. The `init` message of a real run lists `tools: []` and `mcp_servers: []` (about $0.0004). |
| `--max-turns 1` | Works, though `--help` doesn't list it. |
| `--no-session-persistence` with `--resume <id> --fork-session` | Holds: the fork leaves no transcript. The original's transcript is byte-for-byte unchanged (same sha256 after five forks), including when the session is in the middle of a turn. |
| `--resume` from another folder | Finds the session wherever it was started, so calls can run in a neutral folder. |
| `--settings '{"disableAllHooks":true}'` | The fork fires no hooks. The original fires `UserPromptSubmit`, `Stop` and `SessionEnd` as usual. |
| `DISABLE_PROMPT_CACHING=1` | No cache writes, which halves the cost of a one-shot question (a cache write would never be read). |
| Prompt history | Nothing in `~/.claude` contains the question, so no prompt history is written. Re-checked with the runner's own flags and environment: the question is in no file, `~/.claude.json` included. |
| A write request | Asked to write a file, the fork wrote nothing. It ended `error_max_turns` with empty text, which the office turns into a plain sentence. |
| Fork cost | `total_cost_usd` of a fork **includes what the original session had cost** (recorded in its transcript). A fork asked about a $0.0114 session reported $0.0174, the difference being exactly its own `usage` at list price. So forks are priced from `usage`, not from `total_cost_usd`. |
| Not signed in | Exit code 1 and a normal result object with `is_error: true`, `subtype: "success"` (so `subtype` can't be trusted), `result: "Not logged in · Please run /login"`, zero usage. Saved as `test/fixtures/claude-2.1.312/print/not-signed-in.json`; a success is `fresh-success.json`. |
| `CLAUDECODE` | Set when Claude Code runs inside another Claude Code session, and then it refuses to start. The office removes it for the call. |

Subagents can't be resumed or forked from the command line, only main sessions, so a subagent is asked through its
own transcript.

### Messages typed while Claude works

A line the person types while a turn is running is not a `user` entry. It is written as an attachment:
`{ "type": "attachment", "attachment": { "type": "queued_command", "prompt": "...", "commandMode": "prompt" } }`. The
parser and the transcript excerpt read these as messages, so replays and questions include them.

### Checking it again

Run these when Claude Code updates. Both spend real money on Haiku and need Claude Code signed in (unset
`CLAUDECODE` if you start them from inside a Claude Code session):

```bash
node scripts/check-fork.mjs    # about $0.09: forks a throwaway session five ways and once mid-command
node scripts/check-aside.mjs   # about $0.06: a live office, one question to the lead, one to a subagent, one catch-up
```

`check-fork.mjs` runs the runner's own `READ_ONLY_FLAGS` and `claudeEnv` from a neutral folder, as the office does, and
checks the `init` message (no tools, no MCP servers), a write request and `~/.claude.json` as well. On 2.1.312 it
showed: the fork answers from context, the original transcript is unchanged, no transcript is left, no hooks fire,
`init` lists `tools: []` and `mcp_servers: []`, a request to write a file writes nothing, and the question is in no
file.

They write `test-results/fork-check.json` and `test-results/aside-check.json` (gitignored) and print the cost.
`npm run e2e` empties `test-results/`, so copy a report you want to keep before running it. If a
check fails after an update, fix the flags in `src/server/claude.ts` before anything else: the read-only guarantee
depends on them.

## Sign-in status (first run and doctor)

`worklings doctor` (`src/doctor.ts`) and the hub's `GET /api/setup` (`src/hub/setup-routes.ts`, kept five minutes,
`?fresh=1` checks again) ask Claude Code itself whether it is installed and signed in. Worklings never opens
`~/.claude/.credentials.json` or the keychain: the unmodified `claude` answers for itself, through two commands that
call no model and cost nothing, each run from an argument list with no shell and `claudeEnv`'s environment:

```text
claude --version              2.1.312 (Claude Code)
claude auth status --json     one JSON object; exit code 0 when signed in, 1 when not
```

Checked on 2.1.312 on Windows (5 Nov 2026, `CLAUDECODE` unset) in three cases: the maintainer's own sign-in, an empty
`CLAUDE_CONFIG_DIR` (signed out), and an empty `CLAUDE_CONFIG_DIR` with a made-up `ANTHROPIC_API_KEY` (which
`auth status` reports without checking it). The fixtures are in `test/fixtures/claude-2.1.312/auth/`, with the email,
organisation and folders replaced:

| Field | Signed in (claude.ai) | Signed out | API key |
|---|---|---|---|
| `loggedIn` | `true` | `false` | `true` |
| `authMethod` | `"claude.ai"` | `"none"` | `"api_key"` |
| `apiProvider` | `"firstParty"` | `"firstParty"` | `"firstParty"` |
| `subscriptionType` | `"max"` | absent | absent |
| `apiKeySource` | absent | absent | `"ANTHROPIC_API_KEY"` |
| `email`, `orgId`, `orgName` | present | absent | absent |
| `analyticsDisabled`, `projectsDirectory`, `configDirectory` | present | present | present |

- Worklings reads only `loggedIn`, `authMethod`, `apiProvider`, `subscriptionType` and `apiKeySource`. The email and
  the organisation are never looked at, kept, logged or shown, so doctor's output is safe to paste into an issue.
- An API key or a cloud provider (`apiProvider` other than `firstParty`, per the authentication docs) means companies
  bill per token, and the first-run line says so.
- It is slow: 11 to 12 s with a claude.ai sign-in and with an empty config folder, 3 s with an API key. Doctor allows
  45 s, and the hub checks only when the lobby asks.
- `--text` prints `Not logged in. Run claude auth login to authenticate.` when signed out. Worklings uses `--json` and
  tells people to run `claude` once, as the setup docs do (https://code.claude.com/docs/en/authentication).
- A Claude Code without the `auth` command prints `error: unknown command 'auth'` and exits with 1: Worklings then
  says it can't tell and suggests `claude update`.
- A missing `claude` links to https://code.claude.com/docs/en/setup, the install page (checked 5 Nov 2026).
- The fakes answer both commands like 2.1.312 (`test/fake-claude-cli.mjs`, used by `fake-claude.mjs` and
  `fake-desk.mjs`): `FAKE_CLAUDE_AUTH` is `signed-in`, `signed-out`, `api-key`, `no-auth`, `bad-json` or `hang`, and
  `FAKE_CLAUDE_VERSION` sets the version.

To check it again after an update, run the two commands above with `CLAUDECODE` unset (free), and compare the
fields with the table; a renamed or missing `loggedIn` turns every first-run check into "can't tell".

## Stream-json desks

v3's switchboard runs each working person as a long-lived `claude -p` that reads user turns as JSON lines on stdin and
writes JSON lines on stdout. This is the protocol the Agent SDK speaks, not a documented CLI contract, so it is pinned
per version. Checked against Claude Code **2.1.312** with Haiku on Windows by `scripts/check-desk.mjs`; every line in
and out, each hook call with its answer and their times are in `test/fixtures/claude-2.1.312/desk/`, one file per
scenario, with the session's transcript and the hook settings.

```text
claude -p --input-format stream-json --output-format stream-json --verbose
       --session-id <uuid> | --resume <uuid>   --model <model>   --permission-mode acceptEdits
       --append-system-prompt <house rules>    --settings <the office's hooks>   [--mcp-config <org tools>]
```

- **Environment.** `claudeEnv()` without its `DISABLE_PROMPT_CACHING=1`, which suits one-shot calls but not a desk:
  every request rereads the conversation (about 45k tokens here, $0.0005 on Haiku from the cache). A cold start writes
  24k to 42k tokens at the one-hour cache rate ($0.005 to $0.008 on Haiku, about $0.19 to $0.34 at Opus 5.5 prices),
  and a desk reopened within the hour reads them back. Add `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` and the desk's
  token as a variable the hooks' headers read, so no command line shows it:
  `"headers": {"X-Worklings-Desk": "$WORKLINGS_DESK_TOKEN"}, "allowedEnvVars": ["WORKLINGS_DESK_TOKEN"]` (all 65 hook
  calls carried it).
- **The person's setup runs.** Their hooks, plugins and skills load in every desk. The first `system/init` came 7 to
  22 s after the spawn, and the first Bash command of each process started 15 to 35 s after it was approved (Git
  Bash starting on this machine); later commands start within a few seconds.
- **No standalone `sleep`.** 2.1.312 blocks `sleep 32` ("Blocked: standalone sleep"), and Haiku then runs it in the
  background, so the check's slow commands are `node -e "setTimeout(...)"`.

**What the switchboard writes.** One line per user turn; `uuid` is the switchboard's and comes back in
`command_lifecycle`, the echo and the `result`. No `initialize` handshake is needed. UTF-8 passes both ways on Windows
(`Zürich-東京` came back unchanged).

```json
{"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null,"session_id":"<uuid>","uuid":"<uuid>"}
{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}
```

**What a desk writes.** `system/init` at the start of every turn, not only the first (`capabilities` include
`interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `interrupt_send_now_v1` and `msg_lifecycle_v1`);
`command_lifecycle` for each message (`queued` on arrival, `started` when a turn takes it, then `completed` or
`cancelled`); `system/session_state_changed` (`running`, `idle`); `assistant` and `user` lines, including the message
itself when it enters the conversation if `--replay-user-messages` is on; `system/task_started` once a Bash command
has run for about 2 s and `system/task_notification` when it ends; `tool_progress` with `heartbeat: true` every 30 s of
a running tool; `system/thinking_tokens`; `rate_limit_event`; `system/permission_denied`; the person's own
`system/hook_started` and `hook_response`; and one `result` per turn. On a `result`, `usage` covers that turn (summed
over its `num_turns` requests), `model_usage_since_last_result[model].costUSD` is what the turn cost, and `modelUsage`
and `total_cost_usd` are the session's running totals.

| Checked | Result |
|---|---|
| A message to a busy desk | `queued` within 5 ms, `started` within 0.15 s of the running tool call's result, and answered in the same turn: the extra file was written before the one `result`, whose `user_message_uuids` lists both messages. It never cuts into a running command. The transcript stores it as `queue-operation` entries and an `attachment/queued_command`, as v2 found for typed messages. |
| After a turn has ended | The next line starts a new turn at once (`started` 2 ms after `queued`). |
| `"priority": "now"` | With no `origin` it still waited for the running command (41 s), then ended that turn without a reply (`result` `success` with `terminal_reason: "aborted_tools"`, the first message `cancelled`) and answered in a turn of its own. With `"origin": {"kind": "human"}` the command moved to the background at once (`task_updated` with `is_backgrounded: true`; its tool result says it "was moved to the background ... it was not interrupted"), the reply came in the same turn 3 to 5 s after the message, and the command's end started one more turn. |
| Approval, allow | `PermissionRequest` came before the command with `tool_name`, `tool_input`, `permission_suggestions` and the common fields. The office answered after 2 s with `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}` and the command ran. The `behavior` goes inside `hookSpecificOutput.decision`. |
| Approval, deny | `"decision": {"behavior": "deny", "message": "..."}`: the command didn't run. `system/permission_denied` has `decision_reason_type: "hook"` and the message, which is also the tool result the model reads (`is_error`); the `result` lists the call in `permission_denials`. |
| Approval timeout | With `"timeout": 5`, Claude Code dropped the request after 5.0 s and denied the call (`decision_reason_type: "other"`, "This command requires approval"). No `can_use_tool` request came on stdout: a desk without `--permission-prompt-tool` has no other approver. The timeout is how long a person can wait for an answer, and a hub that restarts during the wait denies the call. |
| `--effort` | A desk-shaped call (`-p`, `--input-format stream-json --output-format stream-json --verbose`) took `--effort low` on Haiku (init `claude-haiku-5-5`, result `success`, $0.012) and on Sonnet (init `claude-sonnet-5-5`, result `success`, $0.23, most of it the first request's cache write), 2.1.312, nothing on stderr. The switchboard passes `DeskPlan.effort` as `--effort <level>` when it is one of `EFFORTS` (`src/core/steering.ts`), and leaves Claude Code's own default otherwise; a changed effort applies at the person's next desk. |
| Message taken mid-turn | A message written while a turn runs (`queued`) comes back as `command_lifecycle` `started` within that same turn, with no `result` or `init` between: Claude Code folds it in at the turn's next step (its transcript has a `queued_command` attachment and a queue `remove` with `reason: "absorbed_mid_turn"`). One that waits until the turn ends gets its `started` after the `result`, opening a turn of its own. The switchboard tells the two apart as `DeskEvents.delivered`'s `how`: `next-step` when a line written into a running turn starts in that turn, `new-turn` otherwise (`busy-message.jsonl` lines 33 to 40). |
| Ask rules outrank allow rules | An `ask` rule in the desk's `--settings` (`permissions.ask: ["Bash(git push:*)"]`) sent `git push` to the `PermissionRequest` hook even when an allow rule from another source (`--allowedTools "Bash(git:*)"`) matched it (checked once with Haiku, 2.1.312: the hook was called for `git push` and its deny stopped the command). So the switchboard puts ask rules for every ask-list command in the desk's settings, and a user's or project's own allow rule can't carry one past the office's hook. Precedence is deny > ask > allow, across sources. |
| Stop with `interrupt` | Answered with `{"type": "control_response", "response": {"subtype": "success", "request_id": "<id>", "response": {"still_queued": []}}}` in 0.3 to 2.1 s. The running command was killed (`task_notification` with `status: "stopped"`), the tool result says the tool use was rejected, a `user` line says `[Request interrupted by user for tool use]`, and the `result` has `subtype: "error_during_execution"` and `terminal_reason: "aborted_tools"`; the message ends `cancelled`. The desk stays open and the next line is a normal turn with the context intact. A command already in the background keeps running. |
| A signal | On Windows `child.kill('SIGINT')` is TerminateProcess: the desk exited at once with no `result`, and the command it was running (bash, node) lived on until `taskkill /T` (as `killTree` does). The graceful SIGINT in the headless docs is POSIX-only; `interrupt` stops a turn on every platform. The `total_cost_usd` restored by `--resume` leaves out a killed desk's last turns, which its transcript still has. |
| Closing stdin | Idle: exit 0 in 0.4 to 1.4 s. Mid-turn: the turn finishes, and the desk exits 0.3 to 0.6 s after its `result`. With a background command still running, it waits for the command (20 to 25 s here), takes one more turn for its notification (a `result` with no `user_message_uuids`, which costs a request) and then exits. `SessionEnd` comes with reason `other`. |
| `--resume` | Same session id and context (the codeword and city came back), nothing replayed before the first message, also after a kill (the cut call gets "[Tool call interrupted: the session ended before this call's result was recorded ...]"). Within the hour the first request reads about 45k tokens from the cache and writes under 1k. |
| Prompt cache on `--resume` | The cache is keyed by the request's prefix: tools, then the system prompt, then the messages, so one changed character in the system prompt rewrites every message after it. The transcript records the API's own verdict on each request (`message.diagnostics.cache_miss_reason`: `system_changed`, `messages_changed`, `previous_message_not_found`, with `cache_missed_input_tokens`) and the request's shape (`api-request-shape`, the system blocks in full). That is how a miss is traced to the text that changed. Across 95 desk transcripts of company runs, 205 requests missed with `system_changed` (10.3 M tokens rewritten) and 160 of them (8.0 M) differed in one thing: the desk's scratch folder, a fresh `worklings-desk-XXXXXX` name written into the appended prompt at every start. The folder is now named from the company and the person (`HarnessPlan.stable`), so a reopened desk sends the prompt it had: a resume reads about 51k tokens from the cache and writes 42 to 144 (`test/fixtures/claude-2.1.312/desk/cache-resume.json`, Haiku, two resumes). The rest of the misses were org changes (the project's description and teammates in an agent file, the goal in the house rules), which are meant to reach the person. The cache lasts an hour here (every write was `ephemeral_1h`): a desk left open 5.5 minutes read its whole prefix again, so an idle desk past 5 minutes loses nothing to expiry. Each new process also announces its MCP servers and deferred tools again, about 4.6k tokens written per resume in a session with tool calls. A one-turn session resumed 4 s later missed 20.9k (`messages_changed`) once, and a session with tool calls didn't; not explained. |
| `--append-system-prompt` | Read when a session starts. On `--resume` a new value didn't reach the model (two runs): the session reuses the system prompt it recorded on its first request (`--system-prompt-snapshot`, `on` by default). In a session started with `--system-prompt-snapshot off`, a new value on `--resume` did reach it. Turning the snapshot off only on the resume of a recorded session re-rendered the prompt (a 28k-token cache write), and the model saw the new value in one run of two. A re-rendered prompt costs a cache write whenever any part of it changed. |
| `PreToolUse` `defer` | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "defer"}}` parks the call: a `result` with `stop_reason` and `terminal_reason` `tool_deferred`, empty text and `deferred_tool_use` (`id`, `name`, `input`). Nothing runs and the desk can close. Reopened with `--resume` and sent nothing, the desk fired `PreToolUse` again for the same call at once; `allow` ran it, and the turn went on with "Continue from where you left off.". Sending a prompt instead drops the call, and `defer` only works when the call is the turn's only one (docs). Unlike an approval held open in `PermissionRequest`, it survives a hub restart. |
| Limits | Every turn had a `rate_limit_event`, here with `rate_limit_info` `{"status": "allowed_warning", "rateLimitType": "seven_day", "utilization": 0.4, "resetsAt": <epoch seconds>, ...}`. From the docs, not provoked: `status: "rejected"` when a plan runs out, a `result` with `is_error` and the text "You've hit your session limit · resets 3:45pm", and `system/api_retry` lines (`error: "rate_limit"` or `"overloaded"`, `retry_delay_ms`) while Claude Code retries, 10 times by default. |

```bash
node scripts/check-desk.mjs   # about $0.04 of Haiku and 9 minutes; --keep keeps the temp project and its transcripts
```

It writes `test-results/desk-check.json`, and the fixtures when every required step passes (the `defer` step and the
session started with the snapshot off are exploratory and don't hold them back). The fixtures leave out the person's
own hook output and their lists of skills, agents, plugins and commands in `init`; the report keeps the counts. If a
step fails after an update, read the new exchange before building on it; SPEC-v3.md's fallback is one
`claude -p --resume` turn per message.

## Org tools over MCP

The org tools are an MCP server the office serves itself on 127.0.0.1, reached from each desk's `claude -p` through
`--mcp-config` with a token of its own. Checked against Claude Code **2.1.312** by `scripts/check-orgtools.mjs`; what it
records is in `test/fixtures/claude-2.1.312/mcp/` (the HTTP exchanges of two desks, the handshake fallback and both
refusals, the stream of a desk, a refused desk and a denied call, and a `PermissionRequest` payload).

A desk's config names the token's variable and the desk's environment holds the token, so no command line shows it
(every desk runs as the same user and could read the others' command lines):

```json
{ "mcpServers": { "org": { "type": "http", "url": "http://127.0.0.1:<port>/mcp",
  "headers": { "Authorization": "Bearer ${WORKLINGS_DESK_TOKEN}" }, "alwaysLoad": true } } }
```

| Checked | Result |
|---|---|
| Protocol | Claude Code opens every HTTP server with `server/discover` on MCP **2026-07-28**, the stateless revision: each POST carries `MCP-Protocol-Version` and `Mcp-Method` (plus `Mcp-Name` on `tools/call`), and `_meta` holds the version, `clientInfo` (`claude-code` 2.1.312) and its capabilities. A server that answers stays stateless: `server/discover`, `tools/list`, `tools/call`, with no session, no GET stream and no `initialize`. A bare 400 makes it fall back at once to the 2025-11-25 handshake (`initialize`, `notifications/initialized`, a GET stream that may be refused with 405, `tools/list` on an `Mcp-Session-Id`); `MCP_PROTOCOL_NEGOTIATION=legacy` skips the probe. The office's server speaks both. |
| When it connects | At startup, before the first message: a stream-json session that is never sent anything connects and lists the tools, so the connection can be checked without a model. `alwaysLoad: true` puts the org tools in the first prompt with no ToolSearch step, and startup waits up to 5 s for them (docs). |
| `${VAR}` in `--mcp-config` | Expands in `headers`. The docs read credential variables such as `ANTHROPIC_API_KEY` as empty there; other names expand. |
| Names | `mcp__org__post_status` and `mcp__org__report`; `init` lists the server as `{"name": "org", "status": "connected", "source": "dynamic"}`. |
| A call | `tools/call` carries the arguments the model wrote, `_meta["claudecode/toolUseId"]` (the `tool_use` id that the transcript and the hooks use) and a `progressToken`. The tool's text reaches the model as its `tool_result`, and the server's `instructions` reach its system prompt. |
| Wrong token | A configured `Authorization` header answered 401: one try on `server/discover`, one on `initialize`, then nothing. `init` says `"status": "failed"` and lists none of the server's tools; the session goes on without them. |
| No token | 401, then OAuth discovery (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`) and client registration (`POST /register`), twice. The server answers every path but `/mcp` with 404, so this ends at once. |
| Approval | An MCP tool call needs approval in `-p`. With no allow rule it goes to the `PermissionRequest` hook (with `tool_name`, `tool_input`, `mcp_server` and a suggested allow rule); with no decision it is denied ("Claude requested permissions to use mcp__org__post_status, but you haven't granted it yet."), the stream has a `system/permission_denied` message and the result a `permission_denials` entry, and nothing reaches the server. |
| Allow rules | `--allowedTools "mcp__org__*"`, or `"permissions": {"allow": ["mcp__org"]}` in `--settings`, runs the org tools without calling the hook; the stream marks the result `"permission_decision": {"decision": "accept", "source": "config", "reason_type": "rule"}`. The person's own settings, plugins and MCP servers load as usual next to it (no `--strict-mcp-config`). `-p` ignores the allow rules in a project's `.claude/settings.json` until the folder is trusted (docs), so the switchboard passes its rules in `--settings`. |
| Two desks | Two desks at once on one server: every request was tied to its desk by its token alone. |
| An agent's `tools:` | A session started with `--agent <name>` has only the tools that agent's `tools:` line names, `--mcp-config` ones included: with `tools: Read, Grep` the org server still connected and listed its tools, but `init` listed only Read and Grep and the model said it had none (checked once with Haiku, 2.1.312, 12 Nov 2026, four sessions for $0.003). Adding `mcp__org`, `mcp__org__*` or each `mcp__org__<tool>` to the line kept them all. So every agent file a company writes adds `mcp__org` to a role's `tools:` line (`withOrgTools`, `src/org/agents.ts`). |

What the server does:

- The intake guards of the hooks: only from this machine, to a loopback `Host`, with no `Origin`. Only `/mcp` exists.
- A token per desk, made when the desk opens and dropped when it closes, compared with `sameToken`. A missing or wrong
  one gets 401 with `WWW-Authenticate: Bearer realm="worklings-org"` before the body is read.
- On 2026-07-28 every request authenticates by itself and nothing carries over between requests. On the handshake, a
  session belongs to the desk that opened it: its id with another desk's token is 404.
- `tools/list` may differ by token (the protocol allows it), so each person sees the tools their level allows. Every
  call is still checked against the person, whatever the list said.
- A tool call holds the desk's turn until it answers, and messages reach a desk at its next step, so a tool that waits
  for someone (`ask`) answers at once and the reply comes later as a message.

```bash
node scripts/check-orgtools.mjs --probe   # free: both revisions and both refusals, no model call
node scripts/check-orgtools.mjs           # about $0.03 more: four Haiku desks (two at once, a wrong token, no allow rule)
```

It writes `test-results/orgtools-check.json`, and the fixtures when every required check passes.

## Lean desks (v0.2)

A desk used to load the user's whole Claude Code setup: 52.9k tokens in its first request, 60% of it the user's own
CLAUDE.md, skills and connectors. Since 0.2 every desk is started lean, from its person's `loads` (`src/core/loads.ts`),
which the CEO assigns in the proposal and the stakeholder edits. Measured on Claude Code **2.1.312** with
`scripts/probe-desk-prompt.mjs` (Haiku, a neutral temp project, one request each):

```text
--setting-sources project,local   --strict-mcp-config   --tools Read,Edit,Write,Bash,Glob,Grep   [Skill] [ToolSearch]
env ENABLE_CLAUDEAI_MCP_SERVERS=false (belt and braces)
```

| Desk | First request |
|---|---|
| Everything the user has (before 0.2) | 52.9k |
| Maker, lean | 13.6k |
| CEO, lean (29 org tools) | 26.9k |
| Maker with one MCP server of 56 tools (deferred behind ToolSearch) | 15.4k |
| `--tools` without `--strict-mcp-config` | 215k: every MCP tool upfront |

- **`--tools` needs `--strict-mcp-config`.** Without it every tool of every MCP server of the user's loads upfront. The
  harness checks the `init` line (`tools`, `mcp_servers`): a desk with `mcp__` tools that nobody assigned is killed and
  its person gets a sentence saying so.
- **Skills.** `skills: true` adds the `Skill` tool, which then lists the project's skills and Claude Code's own 19 bundled
  ones (+3k). The user's own skills (`~/.claude/skills`, plugins') belong to the `user` settings source, which a lean desk
  doesn't read: loading them would load the user's CLAUDE.md and settings too (108 skills in the probe).
- **MCP servers** are passed in the desk's own `--mcp-config` file, from the user's `~/.claude.json` (`mcpServers`) and the
  enabled plugins' `.mcp.json` or manifest, never from a project's `.mcp.json` (Claude Code asks the user before it trusts
  one). The key in that file must be the server's catalogue name (`plugin:expo:expo`): Claude Code finds the user's
  sign-in to a server by that name, and a cleaned name (`plugin_expo_expo`) came up `needs-auth`.
- **What the user's settings did that a lean desk has to carry.** `--settings` is always read, so the harness puts the
  following from `~/.claude/settings.json` into the desk's settings file, each as written: `permissions.deny`, `ask`,
  `additionalDirectories` and `disableBypassPermissionsMode`; hooks on every event (the user's first, then the office's);
  `sandbox`, `env`, `deniedMcpServers`, `allowedMcpServers`; and the default `model` and `effortLevel` for a person who names
  none. The hooks of enabled plugins (`hooks/hooks.json` or the manifest) are carried with `${CLAUDE_PLUGIN_ROOT}` replaced by
  the plugin's folder, except `SessionStart` hooks, which inject context and are what a lean desk leaves out; a plugin hook
  that needs any other `CLAUDE_PLUGIN_*` variable can't be reproduced. A deny rule on `.env` files was checked live: it
  blocks a lean desk's Read before the approval hook is even asked. Not carried: the user's `allow` rules.
- **Complete or the standard way.** If anything can't be carried in full (a settings file that can't be read, is over 8 MB,
  isn't JSON or has a shape the office doesn't know; `disableAllHooks`; a plugin hook it can't reproduce) the desk starts
  with today's arguments, where Claude Code reads the user's settings itself, and the company's log says why, once.
- **Fallback.** A Claude Code that doesn't take the three flags exits with code 1 and `error: unknown option '--tools'` (or
  its siblings) as the first thing on standard error, before init: only then does the harness say so once, reopen that desk
  the old way (the switchboard's one automatic retry), and start every desk after it that way.
- **Checks on init.** `mcp__` tools or `mcp_servers` that nobody assigned kill the desk; an init without a tool list is
  said once and can't be checked. The desk's `mcp.json` (which may hold a server's secrets) is deleted once init is read.
- Only the settings JSON, the MCP servers file and the plugins' manifests are read; never `~/.claude/.credentials.json`.
  A server's command, address, headers and environment go into one desk's temp file and nowhere else.

## Plugins

`.claude-plugin/plugin.json` (only `name` is required); `skills/<name>/SKILL.md`, `agents/`, `hooks/hooks.json` and
`bin/` at the plugin root; `${CLAUDE_PLUGIN_ROOT}` is substituted inside skill text and in `allowed-tools` Bash rules;
`bin/` is on the Bash tool's PATH while the plugin is enabled, after the person's own entries, so it can't shadow a
system command. Plugins cannot ship path-scoped rules, and plugin agents ignore `hooks`, `mcpServers` and
`permissionMode`, which is why the generator writes into the project's `.claude/` folder instead. A repo becomes a
marketplace with `.claude-plugin/marketplace.json`. `claude --plugin-dir <dir or .zip>` loads a plugin for one session.

People install Worklings with `claude plugin marketplace add zeusstudiodev/worklings`, then
`claude plugin install worklings@worklings`, then `/worklings:hub`. Checked against Claude Code **2.1.312** (its
`--help` for `claude`, `claude plugin` and each subcommand) and the docs (plugin marketplaces, marketplace reference,
plugin loading, plugin commands) on 5 Nov 2026, and end to end by `scripts/check-plugin.mjs`.

| Checked | Result |
|---|---|
| Subcommands | `claude plugin` (alias `plugins`): `configure`, `details <name>`, `disable`, `enable`, `eval`, `init` (`new`), `install` (`i`), `list`, `marketplace`, `prune` (`autoremove`), `tag`, `test`, `uninstall` (`remove`), `update <plugin>`, `validate <path>`. `claude plugin marketplace`: `add <source>`, `list`, `remove` (`rm`), `update [name]`. |
| Flags that matter | `marketplace add`: `--scope user\|project\|local` (default user), `--sparse <paths...>`, `--json`. `install`: `-s, --scope`, `--marketplace <source>` (adds the marketplace first, so `claude plugin install worklings --marketplace zeusstudiodev/worklings` is one step), `--config key=value`, `--json`, `-y`. `validate`: `--strict`, `--json`, `--profile directory`. `uninstall`: `--keep-data`. `list`: `--json`, `--available`. |
| Marketplace sources | `owner/repo` (with `#ref` or `@ref`) clones from GitHub, trying SSH and falling back to HTTPS; an `http(s)` URL ending in `.git` or `user@host:path` clones over git; a local folder is read in place; any other URL is fetched as a `marketplace.json`. `file://` URLs are refused ("Invalid marketplace source format"), and a marketplace declared only in `extraKnownMarketplaces` is fetched by a session's background check, not by the CLI. |
| The clone | Shallow (measured on a marketplace added by git URL): `.git/shallow` and one commit, so an install downloads the tree of the default branch and never its history. It goes to `<config>/plugins/marketplaces/<name>/`, named by `marketplace.json`, not the repo; 120 s before it gives up (`CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`). |
| The install | The plugin folder alone is copied from the clone to `<config>/plugins/cache/<marketplace>/<plugin>/<version>/`, the version from `plugin.json`, and `installed_plugins.json` records it with `gitCommitSha`. Only committed files arrive, with their git modes: `plugin/bin/worklings` must be committed as 100755 for macOS and Linux. A marketplace added from a local path loads the plugin in place (`readFromFolder`), ignored files included, so it proves nothing about the commit. |
| Updates | A new copy arrives only when the `plugin.json` version changes: `claude plugin update worklings@worklings`, or auto-update, which is off for third-party marketplaces until the person turns it on in `/plugin`. |
| Dependencies | Claude Code runs `npm` at install time only for a plugin with a `package.json` and a lockfile at its root. Worklings ships neither there, and `src/paths.ts` would read a `package.json` at the plugin root before the runtime's own. |
| `validate` | The repository root validates the marketplace and the plugin's `plugin.json`; the plugin folder also gets the plugin directory's checks, which warn that there is no icon (`.claude-plugin/icon.png`, 512 to 2048 px) without failing. `claude plugin details worklings` lists the six skills at about 400 tokens added to every session. |
| Isolation | `CLAUDE_CONFIG_DIR` moves settings, marketplaces and the plugin cache; with `HOME` and `USERPROFILE` pointed at a temp folder as well, the check touches nothing of the person's own Claude Code. |
| Windows | `taskkill /T` on Git Bash doesn't reach the `node.exe` that `worklings hub` started (tried with and without `exec`, in the shim and in the command), so the check stops each hub by the pid in its lock file. Whether stopping `/worklings:hub`'s background task in Claude Code leaves the hub running is not checked yet. |

The runtime (the bundled CLI, the web app and the library, about 5.2 MB in 167 files and 2.2 MB compressed) is
committed into `plugin/runtime/` at each release rather than fetched on first run (5 Nov 2026), measured on the v3 tree:

- **Size for the person**: an install downloads 5.3 MB with the runtime against 3.8 MB without it, so it adds 1.4 MB
  (the models and the library are blobs the repo already holds). A fetch would download the same runtime later instead.
- **Size for the repo**: the history grows by 1.4 MB at the first release and by about 0.5 MB at each release after it
  (0.45 MB for a second build made after half an hour of web changes). Only full clones pay that, never an install.
- **Safety**: committed, it comes from the one repository the person chose to add, checked by git's hashes, works
  offline and needs only Node. A fetch adds a second source (npm or a release asset) with its own integrity pin and
  download and unpacking code, fails offline on first run, and the npm route also needs npm and a published package.
  Minifying the CLI would save about 6% and cost readable stack traces.

`node scripts/release-plugin.ts` builds exactly what the release commit holds and checks it; `--stage` stages it with
the bin's mode, and nothing commits, tags or pushes. `node scripts/check-plugin.mjs` (free, no model call) proves the
install: `claude plugin validate`, then the repository with the runtime committed, served over git's smart HTTP on
127.0.0.1, added and installed in a throwaway `CLAUDE_CONFIG_DIR`, the same from the local path, and the installed
copy's `worklings hub` started through Git Bash and cmd on a free port in 4380 to 4386 or 4390 to 4395, where the lobby
answers, with the token and refusing without it. It writes `test-results/plugin-check.json` and deletes its temp
folders.

## Agents folder

`.claude/agents/` is scanned recursively and identity comes from the `name` field, so firing a role moves its file
out of that folder (to `.claude/studio/fired/`), not into a subfolder of it.

## Refreshing fixtures

1. `node scripts/capture-hooks.mjs <capture-dir>` (listens on 127.0.0.1:7499).
2. In an empty folder, add `.claude/settings.json` with an `http` hook for each event above pointing at
   `http://127.0.0.1:7499/hooks`, and a small subagent in `.claude/agents/`.
3. Run `claude -p "<steps that write a file, spawn the subagent and run two bash commands>" --model haiku
   --permission-mode acceptEdits --allowedTools "Bash(echo:*)" --output-format json` there. When starting it from
   inside another Claude Code session, unset `CLAUDECODE` for that one command.
4. `node scripts/refresh-fixtures.mjs <capture-dir> <transcript_path from any hook> <claude version>`.
