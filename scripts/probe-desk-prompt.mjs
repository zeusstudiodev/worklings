// Measures a desk's fixed prompt: the input tokens of its first request, for one named configuration of Claude Code's
// own switches. One probe per run, never looped: each costs a few cents (Haiku, one short prompt).
//
//   node scripts/probe-desk-prompt.mjs <config> [--role maker|ceo|checker] [--hook] [--out <file>] [--list]
//   node scripts/probe-desk-prompt.mjs harness [--role ...] [--skills] [--mcp <name>] [--deny-check] [--hook]   (v0.2: the real lean desk)
//
// It starts a desk as the switchboard does (deskArgs, deskEnvironment, findClaude, the org tools' real definitions
// served by orgToolsHandler from a fake company, the approvals hook answered by a local server), in a neutral temp
// project that has its own CLAUDE.md, a rule and the three role agents. It prints one JSON line: the usage of the first
// assistant message (input + cache_creation + cache_read), the init message's facts (tools, MCP servers, skills,
// agents, plugins), whether the hook fired and whether the project's CLAUDE.md and rule reached the model.
// --hook adds a second request that runs `echo hooked` so the PermissionRequest hook has something to answer.
// It never reads or passes credentials; Claude Code signs in on its own. Stops only the desk it started, by pid.
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { findClaude, killDesk, startDesk } = await import('../src/server/claude.ts');
const { deskArgs, deskEnvironment, deskMcpConfig, deskSettings, TOKEN_VARIABLE } = await import('../src/runtime/harness.ts');
const { resolveLoads } = await import('../src/core/loads.ts');
const { readCarry, serverConfigs } = await import('../src/server/claude-config.ts');
const { orgToolsHandler } = await import('../src/orgtools/index.ts');
const { houseRules } = await import('../src/company/house-rules.ts');
const { STEERING_TOOLS } = await import('../src/core/steering.ts');

const TOOLS6 = 'Read,Edit,Write,Bash,Glob,Grep';
const SOURCES = ['--setting-sources', 'project,local'];
/** name -> extra arguments and environment on top of the desk as the switchboard starts it today. */
const CONFIGS = {
  // The desk as the harness starts it today: lean by the person's loads, the user's guards carried into --settings.
  harness: { args: [], env: {} },
  base: { args: [] },
  sources: { args: SOURCES },
  strict: { args: ['--strict-mcp-config'] },
  tools6: { args: ['--tools', TOOLS6] },
  noslash: { args: ['--disable-slash-commands'] },
  simpleprompt: { args: [], env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' } },
  connectors: { args: [], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  bundled: { args: [], env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' } },
  safe: { args: ['--safe-mode'] },
  lean: { args: [...SOURCES, '--strict-mcp-config', '--tools', TOOLS6], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  'lean-noslash': { args: [...SOURCES, '--strict-mcp-config', '--tools', TOOLS6, '--disable-slash-commands'], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  'lean-simple': { args: [...SOURCES, '--strict-mcp-config', '--tools', TOOLS6], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' } },
  core: { args: [...SOURCES, '--strict-mcp-config', '--tools', TOOLS6] },
  'core-skill': { args: [...SOURCES, '--strict-mcp-config', '--tools', `${TOOLS6},Skill`] },
  lean2: { args: [...SOURCES, '--strict-mcp-config', '--tools', TOOLS6], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1' } },
  // What inheriting the person's MCP servers costs when ToolSearch is kept so their tools stay deferred.
  'lean-ts': { args: [...SOURCES, '--tools', `${TOOLS6},ToolSearch`], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  'lean-ceo': { args: [...SOURCES, '--strict-mcp-config', '--tools', 'Read,Glob,Grep'], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  // Whether the Skill tool sees the person's own skills when only the project's settings load, and when the user's do too.
  'skill-project': { args: [...SOURCES, '--strict-mcp-config', '--tools', `${TOOLS6},Skill`], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  'skill-user': { args: ['--setting-sources', 'user,project,local', '--strict-mcp-config', '--tools', `${TOOLS6},Skill`], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  // Every built-in tool a role may be assigned (src/core/loads.ts), to see which ones this Claude Code has.
  'tools-all': { args: [...SOURCES, '--strict-mcp-config', '--tools', 'Read,Edit,Write,Bash,PowerShell,Glob,Grep,NotebookEdit,WebFetch,WebSearch,TodoWrite,LSP'], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
  'lean-checker': { args: [...SOURCES, '--strict-mcp-config', '--tools', 'Read,Bash,Glob,Grep'], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } },
};

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  console.log(Object.keys(CONFIGS).join('\n'));
  process.exit(0);
}
const name = argv[0] ?? '';
const config = CONFIGS[name];
if (!config) {
  console.error(`Unknown config "${name}". Known: ${Object.keys(CONFIGS).join(', ')}`);
  process.exit(2);
}
const valueOf = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
const role = valueOf('--role', 'maker');
const out = valueOf('--out', null);
const withHook = argv.includes('--hook');
const denyCheck = argv.includes('--deny-check');
const assignedMcp = argv.includes('--mcp') ? [argv[argv.indexOf('--mcp') + 1]] : [];
const initOnly = argv.includes('--init-only');

const claude = findClaude(process.env);
if (!claude.found) {
  console.error(claude.reason);
  process.exit(1);
}

// The company: a CEO, a maker and a checker; steering served (no-op methods), so the tool lists match a real company's.
const person = (id, title, level, reportsTo) => ({ id, name: title, title, level, room: 'eng', reportsTo, look: {} });
const people = [person('ceo', 'CEO', 'ceo', null), person('maker', 'Frontend engineer', 'worker', 'ceo'), person('checker', 'QA engineer', 'worker', 'ceo')];
const me = people.find((p) => p.id === role) ?? people[1];
const steeringNames = Object.values(STEERING_TOOLS).flat();
const company = { id: 'probe', people: () => people };
for (const key of ['proposePlan', 'editPlan', 'approvePlan', 'commentPlan', 'send', 'ack', 'remind', 'escalate', 'steerTask', 'createTask', 'recordDecision', 'undoDecision', 'reconsider', 'changeSettings']) {
  company[key] = () => {
    throw new Error('probe');
  };
}
void steeringNames;

const token = randomUUID();
const project = mkdtempSync(join(tmpdir(), 'worklings-probe-project-'));
const harness = mkdtempSync(join(tmpdir(), 'worklings-probe-harness-'));
mkdirSync(join(project, '.claude', 'rules'), { recursive: true });
mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
writeFileSync(join(project, 'CLAUDE.md'), '# Probe project\n\nThe project codeword is KIWI-CLAUDE.\n');
writeFileSync(join(project, '.claude', 'rules', 'probe.md'), '# Probe rule\n\nThe rule codeword is PEAR-RULE.\n');
for (const [id, text] of [['ceo', 'You lead the company.'], ['maker', 'You build things.'], ['checker', 'You check work.']]) {
  writeFileSync(join(project, '.claude', 'agents', `${id}.md`), `---\nname: ${id}\ndescription: ${text}\n---\n${text}\n`);
}

const seen = { permission: [], hook: [], mcp: 0 };
const mcp = orgToolsHandler({ resolve: (t) => (t === token ? { company, person: me.id, root: project, cwd: project } : null), log: () => {} });
const server = createServer((req, res) => {
  const url = req.url ?? '';
  if (url.startsWith('/mcp')) {
    seen.mcp += 1;
    void mcp(req, res);
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      /* ignore */
    }
    const reply = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value ?? {}));
    };
    if (url.startsWith('/desk/permission')) {
      seen.permission.push(String(body.tool_name ?? ''));
      return reply({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    }
    seen.hook.push(String(body.hook_event_name ?? ''));
    return reply({});
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const hubUrl = `http://127.0.0.1:${server.address().port}`;

const plan = {
  person: me.id, cwd: project, sessionId: randomUUID(), resume: false, model: 'haiku', effort: null, agent: me.id,
  systemPrompt: houseRules({ person: me, people, company: 'probe', stakeholder: 'Probe', goal: 'Say OK', roomName: () => 'Engineering', steering: { planApproval: 'off' } }),
  hubUrl, allow: ['mcp__org__*'], ask: [], deny: [], issueToken: () => token,
};
const settingsFile = join(harness, 'settings.json');
const mcpFile = join(harness, 'mcp.json');
let carry = null;
let assigned = { servers: {}, missing: [] };
if (name === 'harness') {
  plan.loads = resolveLoads({ ...(argv.includes('--skills') ? { skills: true } : {}), mcp: assignedMcp }, me.level);
  carry = readCarry(process.env);
  assigned = serverConfigs(plan.loads.mcp, process.env);
  config.env = { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
}
writeFileSync(settingsFile, JSON.stringify(deskSettings(plan, carry)));
writeFileSync(mcpFile, JSON.stringify(deskMcpConfig(plan, assigned.servers)));
const args = [...deskArgs(plan, { settings: settingsFile, mcp: mcpFile }), ...config.args];
const env = { ...deskEnvironment(process.env, token, null), ...(config.env ?? {}) };
if (denyCheck) writeFileSync(join(project, '.env'), 'The secret word is DENIED-SENTINEL.\n');

const prompt = denyCheck
  ? 'Read the file .env in the current folder with the Read tool and reply in one line with the secret word in it, or with BLOCKED if you could not read it.'
  : withHook
  ? 'First run the shell command `node -e "console.log(42)"` with Bash. Then reply in one line: the project codeword from CLAUDE.md, the rule codeword, and OK.'
  : 'Reply in one line: the project codeword from CLAUDE.md, the rule codeword, and OK.';

const child = startDesk(claude, args, project, env);
const started = Date.now();
let stderr = '';
child.stderr.on('data', (c) => {
  stderr = (stderr + c).slice(-4000);
});
const result = { config: name, role: me.id, hook: withHook };
let first = null;
let init = null;
let final = null;
let buffer = '';
let answer = '';
let toolUses = 0;
const done = new Promise((resolve) => {
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.type === 'system' && m.subtype === 'init') {
        init = m;
        if (initOnly) resolve();
      }
      if (m.type === 'assistant' && m.message?.usage && first === null) first = m.message.usage;
      if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
        if (c.type === 'text') answer += c.text;
        if (c.type === 'tool_use') toolUses += 1;
      }
      if (m.type === 'result') {
        final = m;
        resolve();
      }
    }
  });
  child.on('exit', () => resolve());
});
child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: plan.sessionId, uuid: randomUUID() })}\n`);
const TIMEOUT = Symbol('timeout');
if ((await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 150_000))])) === TIMEOUT) result.timedOut = true;
child.stdin.end();
await killDesk(child);
server.close();

const sum = (u) => (u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null);
const tools = init?.tools ?? [];
Object.assign(result, {
  seconds: Math.round((Date.now() - started) / 100) / 10,
  firstRequestTokens: sum(first),
  firstUsage: first && { input: first.input_tokens, cacheWrite: first.cache_creation_input_tokens, cacheRead: first.cache_read_input_tokens },
  costUsd: final?.total_cost_usd ?? null,
  answer: answer.slice(0, 200),
  toolUses,
  claudeMdLoaded: answer.includes('KIWI-CLAUDE'),
  denyCheck: denyCheck ? { leaked: answer.includes('DENIED-SENTINEL'), answer: answer.slice(0, 160) } : undefined,
  carried: carry ? { deny: carry.deny.length, preToolUse: carry.preToolUse.length, notes: carry.notes.length } : undefined,
  assignedMcp: assigned.missing.length ? { missing: assigned.missing } : Object.keys(assigned.servers),
  ruleLoaded: answer.includes('PEAR-RULE'),
  builtinTools: tools.filter((t) => !t.startsWith('mcp__')),
  mcpTools: tools.filter((t) => t.startsWith('mcp__')).length,
  orgTools: tools.filter((t) => t.startsWith('mcp__org__')).length,
  mcpServers: (init?.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`),
  skills: init?.skills?.length ?? null,
  skillNames: (init?.skills ?? []).slice(0, 60),
  slashCommands: init?.slash_commands?.length ?? null,
  agents: init?.agents ?? null,
  plugins: (init?.plugins ?? []).map((p) => p.name ?? p),
  permissionHook: seen.permission,
  otherHooks: [...new Set(seen.hook)],
  orgServerRequests: seen.mcp,
  isError: final?.is_error ?? null,
  stderr: stderr.slice(-300),
});
const line = JSON.stringify(result);
console.log(line);
if (out) appendFileSync(out, `${line}\n`);
// Literal paths made by this run, removed by the script itself.
rmSync(project, { recursive: true, force: true });
rmSync(harness, { recursive: true, force: true });
void TOKEN_VARIABLE;
process.exit(0);
