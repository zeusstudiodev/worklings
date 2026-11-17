// Answering questions and approvals, one store per company (docs/design-v3.md, "Answering inline"): the inbox and the
// feed both draw an item and both press through here, so a press made in one shows in the other at the same moment
// ("Answering: 15-minute windows. Undo"), and every press and result is announced once. The store holds what a tab
// presses (sending, sent, undoing, refused), the words typed in an item's own-words box and the reason typed for a no.
import { useEffect, useSyncExternalStore } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { nameOf } from '../people/peopleModel.ts';
import { refusalOf } from '../people/shared.tsx';
import type { CompanyActions } from '../types.ts';
import { type Answer, appliedAnnouncement, allItems, type Item, itemId, pressAnnouncement, type Press, refusalLine, undoUntil } from './inboxModel.ts';

/** "Tell Kai why": what was typed, and whether it went with the no or as a message. */
export interface Why {
  text: string;
  state: 'editing' | 'sending' | 'sent' | 'failed';
  via: 'decision' | 'message' | null;
  error: string | null;
}

export interface AnswersState {
  presses: Readonly<Record<string, Press>>;
  own: Readonly<Record<string, string>>;
  ownOpen: ReadonlySet<string>;
  whys: Readonly<Record<string, Why>>;
}

/** What the store needs from the tab that uses it, kept current by every `useAnswers`. */
export interface Binding {
  company: CompanyView;
  actions: Pick<CompanyActions, 'answer' | 'decide' | 'undo' | 'say'>;
  announce: (text: string) => void;
  online: boolean;
  /** How far the hub's clock runs ahead of this browser's. */
  skew: number;
}

/** What a surface wants done at the moment of a result, before the page redraws: where focus goes. */
export interface PressHooks {
  refused?: () => void;
  undone?: () => void;
}

const EMPTY: AnswersState = { presses: {}, own: {}, ownOpen: new Set(), whys: {} };

/** v0.8: the items whose own-words box is open with words in it (inboxModel's InboxContext.drafting). */
export const draftingOf = (state: Pick<AnswersState, 'own' | 'ownOpen'>): ReadonlySet<string> => new Set([...state.ownOpen].filter((key) => (state.own[key] ?? '').trim() !== ''));

const findItem = (company: CompanyView, id: string): Item | undefined => allItems(company).find((i) => itemId(i) === id);
const answerOfItem = (item: Item) => (item.kind === 'question' ? item.question.answer : item.approval.answer);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export class AnswerStore {
  private state: AnswersState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private binding: Binding | null = null;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly announced = new Set<string>();
  private readonly focusUndo = new Set<string>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = (): AnswersState => this.state;
  bind(binding: Binding): void {
    this.binding = binding;
  }

  private set(next: Partial<AnswersState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }
  private setPress(itemKey: string, change: (p: Press) => Press): void {
    const was = this.state.presses[itemKey];
    if (was) this.set({ presses: { ...this.state.presses, [itemKey]: change(was) } });
  }
  isPending(itemKey: string): boolean {
    return this.inFlight.has(itemKey);
  }


  /** Asks that the next Undo drawn for this item takes focus (the feed: a pressed answer's Undo has it). */
  wantUndoFocus(itemKey: string): void {
    this.focusUndo.add(itemKey);
  }
  takeUndoFocus(itemKey: string): boolean {
    return this.focusUndo.delete(itemKey);
  }

  setOwn(itemKey: string, text: string): void {
    this.set({ own: { ...this.state.own, [itemKey]: text } });
  }
  toggleOwn(itemKey: string): boolean {
    const next = new Set(this.state.ownOpen);
    const opening = !next.delete(itemKey);
    if (opening) next.add(itemKey);
    this.set({ ownOpen: next });
    return opening;
  }
  setWhy(itemKey: string, change: Partial<Why>): void {
    this.set({ whys: { ...this.state.whys, [itemKey]: { text: '', state: 'editing', via: null, error: null, ...this.state.whys[itemKey], ...change } } });
  }

  /** Says once, for each answer, that it reached them: "Allowed. Kai carries on." */
  announceApplied(itemKeys: readonly string[]): void {
    const b = this.binding;
    if (!b) return;
    for (const itemKey of itemKeys) {
      if (this.announced.has(itemKey)) continue;
      this.announced.add(itemKey);
      const press = Object.hasOwn(this.state.presses, itemKey) ? this.state.presses[itemKey] : undefined;
      const item = findItem(b.company, itemKey);
      if (press && item) b.announce(appliedAnnouncement(b.company, item, press.answer));
    }
  }

  submit(item: Item, answer: Answer, hooks: PressHooks = {}): void {
    const b = this.binding;
    const itemKey = itemId(item);
    if (!b || !b.online || this.inFlight.has(itemKey)) return;
    const at = Date.now();
    this.announced.delete(itemKey);
    this.set({ presses: { ...this.state.presses, [itemKey]: { answer, state: 'sending', at, error: null, undid: null } } });
    b.announce(pressAnnouncement(b.company, item, answer));
    const call = answer.kind === 'question' ? b.actions.answer(itemKey, answer.option, answer.text) : b.actions.decide(itemKey, answer.decision, answer.always, null);
    this.inFlight.set(itemKey, call);
    void call
      .then(
        () => this.setPress(itemKey, (p) => (p.state === 'sending' ? { ...p, state: 'sent' } : p)),
        (error: unknown) => {
          const why = refusalLine(refusalOf(error));
          hooks.refused?.();
          this.set({ presses: { ...this.state.presses, [itemKey]: { answer, state: 'refused', at, error: why, undid: null } } });
          b.announce(why);
        },
      )
      .finally(() => this.inFlight.delete(itemKey));
  }

  /** Sends the words typed in an item's box as its answer. */
  sendOwn(item: Item, hooks: PressHooks = {}): void {
    const itemKey = itemId(item);
    const text = (this.state.own[itemKey] ?? '').trim();
    if (!text) return;
    this.submit(item, { kind: 'question', option: null, text }, hooks);
    const { [itemKey]: _sent, ...rest } = this.state.own;
    this.set({ own: rest });
  }

  async undo(item: Item, hooks: PressHooks = {}): Promise<void> {
    const b = this.binding;
    const itemKey = itemId(item);
    const press = this.state.presses[itemKey];
    if (!b || !b.online || !press || press.state === 'undoing') return;
    this.setPress(itemKey, (p) => ({ ...p, state: 'undoing' }));
    // Undo before the answer reached the hub waits for it; an answer that failed has nothing to undo.
    const pending = this.inFlight.get(itemKey);
    if (pending) {
      const [outcome] = await Promise.allSettled([pending]);
      if (outcome?.status === 'rejected') return;
    }
    const shown = this.binding ? findItem(this.binding.company, itemKey) : undefined;
    const answerAt = shown ? (answerOfItem(shown)?.at ?? null) : null;
    try {
      await b.actions.undo(itemKey);
      hooks.undone?.();
      this.setPress(itemKey, (p) => ({ ...p, state: 'undone', undid: answerAt }));
      const { [itemKey]: _gone, ...rest } = this.state.whys;
      this.set({ whys: rest });
    } catch (error) {
      this.setPress(itemKey, (p) => ({ ...p, state: 'sent' }));
      b.announce(`Couldn't undo. ${refusalOf(error)}`);
    }
  }

  /** The why of a no: with the no while it can still change, else as a message. */
  async sendWhy(item: Item): Promise<void> {
    const b = this.binding;
    if (!b || item.kind !== 'approval') return;
    const itemKey = itemId(item);
    const text = (this.state.whys[itemKey]?.text ?? '').trim();
    if (!b.online || !text || this.state.whys[itemKey]?.state === 'sending') return;
    this.setWhy(itemKey, { state: 'sending', error: null });
    const shown = findItem(b.company, itemKey);
    const answer = shown?.kind === 'approval' ? shown.approval.answer : null;
    const press = this.state.presses[itemKey];
    const withTheNo = shown !== undefined && answer !== null && press !== undefined && Date.now() < undoUntil(shown, press, b.skew) - 300 && !this.inFlight.has(itemKey);
    try {
      if (withTheNo) {
        await b.actions.undo(itemKey);
        try {
          await b.actions.decide(itemKey, 'deny', false, text);
          this.setPress(itemKey, (p) => ({ ...p, at: Date.now(), state: 'sent' }));
        } catch (error) {
          this.setPress(itemKey, (p) => ({ ...p, state: 'refused', error: refusalLine(refusalOf(error)) }));
          throw error;
        }
      } else {
        await b.actions.say(item.approval.person, text);
      }
      this.setWhy(itemKey, { state: 'sent', via: withTheNo ? 'decision' : 'message' });
      b.announce(`${cap(nameOf(b.company, item.approval.person).called)} gets your reason.`);
    } catch (error) {
      this.setWhy(itemKey, { state: 'failed', error: refusalOf(error) });
      b.announce(`Couldn't send your reason. ${refusalOf(error)}`);
    }
  }
}

const stores = new Map<string, AnswerStore>();

/** The company's one store. */
export function answersFor(companyId: string): AnswerStore {
  let store = stores.get(companyId);
  if (!store) {
    store = new AnswerStore();
    stores.set(companyId, store);
  }
  return store;
}

/** The company's store and what it holds now, kept bound to this tab's company, actions and live region. */
export function useAnswers(companyId: string, binding: Binding): { store: AnswerStore; state: AnswersState } {
  const store = answersFor(companyId);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    store.bind(binding);
  });
  return { store, state };
}
