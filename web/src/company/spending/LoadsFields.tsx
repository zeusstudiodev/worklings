// What a person's desk loads, edited in their card before the start (v0.2, "lean desks"): the built-in tools, whether the
// Skill tool is there and which MCP servers. A desk gets nothing it wasn't given; every part shows its default as the
// default, and the fixed prompt it adds up to is said as the form changes ("about 13.6k tokens before any work").
import { useId, useState } from 'react';
import { BUILTIN_TOOLS, defaultLoads, estimateLoads, MCP_NAME, type ResolvedLoads } from '../../../../src/core/loads.ts';
import type { InstalledCatalogue } from '../../../../src/core/spending.ts';
import type { Level } from '../../../../src/core/studio.ts';
import { fixedPromptLine, sameResolved, tokensShort } from './spendingModel.ts';
import './spending.css';

interface Props {
  level: Level;
  value: ResolvedLoads;
  onChange: (next: ResolvedLoads) => void;
  /** Servers to offer: the ones the proposal already names, plus any added here. */
  servers: readonly string[];
  /** The kind of person for "Default for workers". */
  kind: string;
  /** What the user has installed, from the hub (before the start); null where the hub doesn't say. */
  catalogue?: InstalledCatalogue | null;
}

const MCP_HELP = "Use the server's name as it appears in your Claude Code setup, such as github or plugin:context7:context7.";

export function LoadsFields({ level, value, onChange, servers, kind, catalogue = null }: Props) {
  const id = useId();
  const base = defaultLoads(level);
  const cost = estimateLoads(value, level);
  const [added, setAdded] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const toolsDefault = value.tools.join() === base.tools.join();
  const installed = catalogue?.mcp ?? [];
  // With the catalogue the choices are what is installed (name and what it is); a name the proposal already holds that is
  // not installed stays listed so it can be taken off. Without one, the servers the proposal names and any added by name.
  const everything = (catalogue ? [...new Set([...installed.map((m) => m.name), ...value.mcp])] : [...new Set([...servers, ...added, ...value.mcp])]).sort((a, b) => a.localeCompare(b));
  const detail = new Map(installed.map((m) => [m.name, m]));
  const byName = catalogue === null || installed.length === 0;
  const atDefaults = sameResolved(value, base);

  const toggleTool = (tool: string, on: boolean) => {
    const next = BUILTIN_TOOLS.filter((t) => (t === tool ? on : value.tools.includes(t)));
    onChange({ ...value, tools: [...next] });
  };
  const toggleServer = (server: string, on: boolean) => onChange({ ...value, mcp: on ? [...new Set([...value.mcp, server])] : value.mcp.filter((m) => m !== server) });
  const addServer = () => {
    const wanted = name.trim();
    if (!MCP_NAME.test(wanted)) {
      setProblem(wanted ? `That isn't a server name. ${MCP_HELP}` : `Type a server name first. ${MCP_HELP}`);
      return;
    }
    setProblem(null);
    setName('');
    setAdded((a) => (a.includes(wanted) ? a : [...a, wanted]));
    onChange({ ...value, mcp: [...new Set([...value.mcp, wanted])] });
  };

  return (
    <fieldset className="loads">
      <legend className="loads__legend">What this desk loads</legend>
      <p className="loads__hint">A desk starts every conversation with what it loads, so each tool, skill and server costs tokens every time. They get only what you give them.</p>

      <div className="loads__group" role="group" aria-labelledby={`${id}-tools`}>
        <p id={`${id}-tools`} className="loads__title">
          Tools
          {toolsDefault && <span className="loads__tag">Default</span>}
        </p>
        <div className="loads__checks">
          {BUILTIN_TOOLS.map((tool) => (
            <label key={tool} className="check">
              <input type="checkbox" checked={value.tools.includes(tool)} onChange={(e) => toggleTool(tool, e.target.checked)} />
              <span>{tool}</span>
            </label>
          ))}
        </div>
        <p className="loads__hint">
          Default for {kind}: {base.tools.join(', ')}.
          {!toolsDefault && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => onChange({ ...value, tools: [...base.tools] })}>
                Use the default tools
              </button>
            </>
          )}
        </p>
      </div>

      <div className="loads__group">
        <p className="loads__title">
          Skills
          {value.skills === base.skills && <span className="loads__tag">Default</span>}
        </p>
        <label className="check">
          <input type="checkbox" checked={value.skills} onChange={(e) => onChange({ ...value, skills: e.target.checked })} />
          <span>Load skills</span>
        </label>
        <p className="loads__hint">
          Adds the Skill tool, with the project's own skills and the ones Claude Code ships with. {base.skills ? 'On' : 'Off'} by default.
          {catalogue && catalogue.skills > 0 ? ` You have ${catalogue.skills} ${catalogue.skills === 1 ? 'skill' : 'skills'} of your own: desks never load ${catalogue.skills === 1 ? 'it' : 'them'}.` : ' Skills you wrote yourself are never loaded by a desk.'}
        </p>
      </div>

      <div className="loads__group" role="group" aria-labelledby={`${id}-mcp`}>
        <p id={`${id}-mcp`} className="loads__title">
          MCP servers
          {value.mcp.length === 0 && <span className="loads__tag">Default</span>}
        </p>
        {everything.length > 0 ? (
          <div className="loads__checks loads__checks--one">
            {everything.map((server) => (
              <label key={server} className="check">
                <input type="checkbox" checked={value.mcp.includes(server)} onChange={(e) => toggleServer(server, e.target.checked)} />
                <span className="loads__server">
                  {server}
                  {detail.get(server) ? (
                    <span className="loads__summary">
                      {detail.get(server)?.summary ? ` ${detail.get(server)?.summary}` : ''} ({detail.get(server)?.kind === 'remote' ? 'remote' : 'local'})
                    </span>
                  ) : catalogue ? (
                    <span className="loads__summary"> Not installed: the office will refuse it.</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="loads__hint">{catalogue ? 'No MCP servers are installed in your Claude Code, so there is nothing to give.' : 'No server is given to anyone yet. That is the default.'}</p>
        )}
        {byName && <div className="loads__add">
          <label className="visually-hidden" htmlFor={`${id}-add`}>
            Add an MCP server by name
          </label>
          <input
            id={`${id}-add`}
            className="text-input"
            value={name}
            placeholder="Add a server by name"
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-bad` : `${id}-help`}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              // Enter here adds the server; it never saves the whole form.
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addServer();
            }}
          />
          <button type="button" className="button" onClick={addServer}>
            Add
          </button>
        </div>}
        <p id={`${id}-help`} className="loads__hint">
          {byName ? `${catalogue ? '' : 'The list is the servers the proposal names. '}${MCP_HELP} Saving is refused for a server you haven't installed.` : 'These are the servers installed in your Claude Code. A server costs tokens on every start.'}
        </p>
        {byName && problem && (
          <p id={`${id}-bad`} className="loads__problem">
            {problem}
          </p>
        )}
      </div>

      <div className="loads__cost">
        <p className="loads__total" role="status">
          <strong>{fixedPromptLine(cost)}</strong>.
        </p>
        <details className="loads__parts">
          <summary>What adds up</summary>
          <ul className="loads__list">
            {cost.parts.map((part) => (
              <li key={part.what}>
                {part.what}: {tokensShort(part.tokens)} tokens{part.measured ? '' : ', estimated'}
              </li>
            ))}
          </ul>
          <p className="loads__hint">Measured parts come from a real desk. An MCP server's cost depends on how many tools it has, so those are estimates.</p>
        </details>
        {!atDefaults && (
          <button type="button" className="link" onClick={() => onChange(base)}>
            Back to the defaults
          </button>
        )}
      </div>
    </fieldset>
  );
}
