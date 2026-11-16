// Wires an Office to the HTTP server with the studio API, for the CLI and for tests.
import { BASE_DEPARTMENT_INFO } from '../core/departments.ts';
import type { Library } from '../composer/library.ts';
import { Aside, type AsideOptions, AsideRefusal, type AsideReply } from './aside.ts';
import { type ApiHandlers, HttpError, type RunningServer, startServer } from './http.ts';
import { Office, type OfficeMode } from './office.ts';
import { readAgents, readRules, readSkills } from './project.ts';
import { reshape, ReshapeError } from './reshape.ts';

export interface RunOptions {
  root: string;
  name: string;
  port: number;
  lan: boolean;
  token: string;
  webDir: string | null;
  library: Library;
  mode: OfficeMode;
  /** Extra API handlers (reshape, replay) added by the caller. */
  api?: Omit<ApiHandlers, 'studio'>;
  tickMs?: number;
  office?: Office;
  /** For Ask aside and Catch me up: tests pass a fake Claude Code's environment, a clock or a runner. */
  aside?: AsideOptions;
}

export interface RunningOffice extends RunningServer {
  office: Office;
  aside: Aside;
}

/** Turns the office's refusals (busy, too many calls, bad input) into HTTP errors the browser can act on. */
function asideRoute(handle: () => AsideReply): AsideReply {
  try {
    return handle();
  } catch (error) {
    if (error instanceof AsideRefusal) throw new HttpError(error.status, error.message, { code: error.code, retryAfter: error.retryAfter });
    throw error;
  }
}

/** Everything the office's room and person panels show that isn't live state: files, rules, the hiring catalogue. */
export function studioCatalog(office: Office, library: Library) {
  const hired = new Set(office.studio?.roles.map((r) => r.id) ?? []);
  // Agent files are named by what Claude Code reads; the office looks roles up by id.
  const roleOf = new Map(office.studio?.roles.map((r) => [r.agent ?? r.id, r.id]) ?? []);
  // The demo studio exists only in memory, so its files come straight from the library.
  const demo = office.mode === 'demo';
  const studio = office.studio;
  return {
    studio,
    source: office.studioSource,
    errors: office.studioErrors,
    agents: demo
      ? (studio?.roles ?? []).flatMap((r) => {
          const role = library.roles.get(r.archetype ?? r.id);
          return role ? [{ id: r.id, description: role.description, model: role.model, tools: role.tools ?? [], file: `library/roles/${role.id}.md` }] : [];
        })
      : readAgents(office.root).map((a) => ({ ...a, id: roleOf.get(a.id) ?? a.id })),
    rules: demo
      ? (studio?.rules ?? []).flatMap((r) => {
          const rule = library.rules.get(r.id);
          return rule ? [{ id: r.id, description: rule.title, paths: rule.paths, body: rule.body }] : [];
        })
      : readRules(office.root),
    skills: demo ? (studio?.skills ?? []).map((s) => ({ id: s.id, description: library.skills.get(s.id)?.description ?? '' })) : readSkills(office.root),
    library: [...library.roles.values()]
      .filter((r) => !hired.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, department: r.department, description: r.description, model: r.model })),
    departments: BASE_DEPARTMENT_INFO,
  };
}

/**
 * v2's API for one office: its studio, its changes (in a live office only), Ask aside and Catch me up. `worklings
 * office` serves it at /api/, and the hub at /api/c/<id>/ for each company's office.
 */
export function officeApi(office: Office, aside: Aside, o: { root: string; library: Library; mode: OfficeMode }): Omit<ApiHandlers, 'sessions' | 'replay'> {
  return {
    studio: () => studioCatalog(office, o.library),
    // Changes write files, so they exist only for the live office of a real project.
    ...(o.mode === 'live'
      ? {
          reshape: (body: unknown) => {
            try {
              const result = reshape({ root: o.root, library: o.library }, body);
              office.loadStudio();
              return result;
            } catch (error) {
              if (error instanceof ReshapeError) throw new HttpError(400, error.message);
              throw error;
            }
          },
        }
      : {}),
    ask: (body: unknown) => asideRoute(() => aside.ask(body)),
    catchUp: (body: unknown) => asideRoute(() => aside.catchUp(body)),
    cancelAside: (body: unknown) => asideRoute(() => aside.cancel(body)),
  };
}

export async function runOffice(o: RunOptions): Promise<RunningOffice> {
  const office = o.office ?? new Office(o.root, o.name, o.mode);
  if (o.mode !== 'demo') office.loadStudio();
  const aside = new Aside(office, o.aside);
  office.aside = aside;
  const server = await startServer({
    office,
    host: o.lan ? '0.0.0.0' : '127.0.0.1',
    port: o.port,
    token: o.token,
    lan: o.lan,
    webDir: o.webDir,
    api: { ...officeApi(office, aside, o), ...o.api },
    ...(o.tickMs ? { tickMs: o.tickMs } : {}),
  });
  return {
    ...server,
    office,
    aside,
    // Stopping the office (Ctrl+C) stops a running question or catch-up and its Claude Code.
    close: async () => {
      await aside.close();
      await server.close();
    },
  };
}
