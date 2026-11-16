// How an org tool is declared: once, as both what tools/list shows and the call it checks. A tool may take more once the
// company serves steering (src/core/steering.ts): the fields it adds then, and the description that names them.
import { type CompanyApi, type OrgTool, OrgRefusal, type Person } from '../core/company.ts';
import { STEERING_TOOLS, type SteeringApi, type SteeringTool } from '../core/steering.ts';
import { type ArgsOf, checkArgs, type Fields, inputSchema } from './schema.ts';

/** An org tool of v3 or of steering. */
export type AnyTool = OrgTool | SteeringTool;

const STEERING_NAMES: readonly string[] = Object.values(STEERING_TOOLS).flat();
export const isSteeringTool = (name: string): name is SteeringTool => STEERING_NAMES.includes(name);

/** Whose desk a request comes from, as the hub's token table says. */
export interface OrgDesk {
  company: CompanyApi;
  person: string;
  /** The company's project folder. */
  root: string;
  /** The desk's checkout or worktree. */
  cwd: string;
}

/** What a tool's run gets: the desk, and the caller as the org has them right now. */
export interface DeskCall {
  company: CompanyApi;
  /** The company's steering, once it serves it (steeringOf); null until then. */
  steering: SteeringApi | null;
  me: Person;
  people: Person[];
  root: string;
  cwd: string;
}

/** A tool as tools/list shows it. */
export interface ToolListing {
  name: AnyTool;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

export interface ToolDef {
  /** As tools/list shows it: with steering's fields and words when the company serves steering. */
  listing(steering: boolean): ToolListing;
  /** Checks the arguments and runs the tool: the answer, or an OrgRefusal with the sentence to show. */
  call(desk: DeskCall, raw: Record<string, unknown>): Promise<string>;
}

interface ToolSpec<S extends Fields, X extends Fields> {
  name: AnyTool;
  title: string;
  description: string;
  fields: S;
  /** What the tool takes once the company serves steering: more fields, all optional, and the description naming them. */
  steering?: { description: string; fields: X };
  hints?: { readOnly?: true; destructive?: true; idempotent?: true };
  run: (call: DeskCall, args: ArgsOf<S> & Partial<ArgsOf<X>>) => string | Promise<string>;
}

export function defineTool<const S extends Fields, const X extends Fields = Record<never, never>>(spec: ToolSpec<S, X>): ToolDef {
  const hints = spec.hints ?? {};
  const listed = (description: string, fields: Fields): ToolListing => ({
    name: spec.name,
    title: spec.title,
    description,
    inputSchema: inputSchema(fields),
    annotations: { readOnlyHint: hints.readOnly === true, destructiveHint: hints.destructive === true, idempotentHint: hints.idempotent === true, openWorldHint: false },
  });
  const all: Fields = spec.steering ? { ...spec.fields, ...spec.steering.fields } : spec.fields;
  const plain = listed(spec.description, spec.fields);
  const steered = spec.steering ? listed(spec.steering.description, all) : plain;
  return {
    listing: (steering) => (steering ? steered : plain),
    // checkArgs has just checked every field against the fields listed, which is what the args' type describes; the
    // steering fields are optional, and absent when the company doesn't serve steering.
    call: async (desk, raw) => spec.run(desk, checkArgs(spec.name, desk.steering ? all : spec.fields, raw) as ArgsOf<S> & Partial<ArgsOf<X>>),
  };
}

export const refuse = (code: string, sentence: string): OrgRefusal => new OrgRefusal(code, sentence);

/** Every SteeringApi method, as a record so the compiler names any the interface gains. */
const STEERING_METHODS: Readonly<Record<keyof SteeringApi, true>> = {
  proposePlan: true, editPlan: true, approvePlan: true, commentPlan: true, send: true, ack: true, remind: true, escalate: true, steerTask: true,
  createTask: true, recordDecision: true, undoDecision: true, reconsider: true, changeSettings: true, markChecklist: true,
};

/**
 * The company's steering, when it implements every SteeringApi method; null until then. The org tools and the hub's
 * steering routes serve steering only through this, so nothing of it shows before the company can answer.
 */
export function steeringOf<T extends object>(company: T): (T & SteeringApi) | null {
  const serves = (c: T): c is T & SteeringApi => Object.keys(STEERING_METHODS).every((method) => typeof Reflect.get(c, method) === 'function');
  return serves(company) ? company : null;
}
