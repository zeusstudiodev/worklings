// Running a command (SPEC-v3.md "Steering", "Also"; docs/design-v3.md, "Commands"): the palette and the talk bar make
// a command's office call the same way, and find the decision it made so the result's Undo takes back that change and
// nothing else. Opening an address stays with the caller, which closes what it runs in first.
import type { CompanyView } from '../../../../src/core/company.ts';
import type { Decision } from '../../../../src/core/steering.ts';
import { openFeedThrough } from '../talk/link.ts';
import { ActionError, type CompanyActions, type SteeringActions, type TalkControl } from '../types.ts';
import { madeByCall, type PaletteCall } from './paletteModel.ts';

/** What a call reaches: the company's actions, steering's once bound, and the talk bar for the feed. */
export interface CallTarget {
  actions: CompanyActions;
  steer?: SteeringActions;
  talk?: TalkControl;
}

/** Makes a command's office call. A `navigate` call does nothing here: the caller opens the address. */
export async function perform(call: PaletteCall, { actions, steer, talk }: CallTarget): Promise<void> {
  if (call.on === 'navigate') return;
  if (call.on === 'talk') {
    if (!openFeedThrough(talk, { catchUp: call.args[0] })) throw new ActionError(0, "This office has no feed to open.", 'unsupported');
    return;
  }
  if (call.on === 'actions') {
    if (call.method === 'say') await actions.say(...call.args);
    else if (call.method === 'stop') await actions.stop(...call.args);
    else if (call.method === 'pause') await actions.pause();
    else if (call.method === 'reshape') {
      // Hire, fire, move, rehire: a refusal comes back as a sentence, not an error.
      const result = await actions.reshape(...call.args);
      if (!result.ok) throw new ActionError(409, result.message, 'refused');
    } else await actions.resume();
    return;
  }
  if (!steer) throw new ActionError(0, "This office can't do that yet.", 'unsupported');
  switch (call.method) {
    case 'send':
      await steer.send(...call.args);
      return;
    case 'pauseRoom':
      await steer.pauseRoom(...call.args);
      return;
    case 'resumeRoom':
      await steer.resumeRoom(...call.args);
      return;
    case 'pauseTask':
      await steer.pauseTask(...call.args);
      return;
    case 'resumeTask':
      await steer.resumeTask(...call.args);
      return;
    case 'undoDecision':
      await steer.undoDecision(...call.args);
      return;
    case 'approvePlan':
      await steer.approvePlan(...call.args);
      return;
    case 'cancelTask':
      await steer.cancelTask(...call.args);
      return;
    case 'reassignTask':
      await steer.reassignTask(...call.args);
      return;
    case 'createTask':
      await steer.createTask(...call.args);
      return;
    case 'changeSettings':
      await steer.changeSettings(...call.args);
      return;
  }
}

/** The decisions that existed before a call, so the one it made can be told from them. */
export const decisionsBefore = (company: Pick<CompanyView, 'steering'>): ReadonlySet<string> => new Set((company.steering?.decisions ?? []).map((d) => d.id));

/** What a command did, kept for its result line and its Undo. */
export interface CallResult {
  call: PaletteCall;
  before: ReadonlySet<string>;
  /** The opposite call, worked out before the call ran (a move needs the room it left); null where there is none. */
  inverse: PaletteCall | null;
}

/** What a result keeps of a call: the decisions before it, and its opposite while the company is still as it was. */
export const resultOf = (call: PaletteCall, company: Pick<CompanyView, 'steering' | 'people'>): CallResult => ({ call, before: decisionsBefore(company), inverse: inverseOf(call, company) });

/**
 * The call that takes a pause or a resume back when the office keeps no undoable decision for it, as the task board's
 * Undo does: resume what was paused, pause what was resumed. Null for anything else.
 */
export function inverseOf(call: PaletteCall, before?: Pick<CompanyView, 'people'>): PaletteCall | null {
  if (call.on === 'actions') {
    if (call.method === 'reshape') {
      const a = call.args[0];
      if (a.action === 'hire') return { on: 'actions', method: 'reshape', args: [{ action: 'fire', role: a.role }] };
      if (a.action === 'fire') return { on: 'actions', method: 'reshape', args: [{ action: 'rehire', role: a.role }] };
      if (a.action === 'rehire') return { on: 'actions', method: 'reshape', args: [{ action: 'fire', role: a.role }] };
      // Back to the room they were in, which only the company as it was before the move knows.
      if (a.action === 'move') {
        const room = before?.people.find((p) => p.id === a.role)?.room;
        return room ? { on: 'actions', method: 'reshape', args: [{ action: 'move', role: a.role, department: room }] } : null;
      }
      return null;
    }
    if (call.method === 'pause') return { on: 'actions', method: 'resume', args: [] };
    if (call.method === 'resume') return { on: 'actions', method: 'pause', args: [] };
    return null;
  }
  if (call.on !== 'steer') return null;
  switch (call.method) {
    case 'pauseTask':
      return { on: 'steer', method: 'resumeTask', args: [call.args[0]] };
    case 'resumeTask':
      return { on: 'steer', method: 'pauseTask', args: [call.args[0]] };
    case 'pauseRoom':
      return { on: 'steer', method: 'resumeRoom', args: [call.args[0]] };
    case 'resumeRoom':
      return { on: 'steer', method: 'pauseRoom', args: [call.args[0]] };
    default:
      return null;
  }
}

/** The change a call made, once the snapshot has it: the newest decision of yours about what the call named. */
export function decisionOf(company: Pick<CompanyView, 'steering'>, result: CallResult): Decision | undefined {
  return (company.steering?.decisions ?? []).filter((d) => madeByCall(result.call, result.before, d)).sort((a, b) => b.at - a.at)[0];
}
