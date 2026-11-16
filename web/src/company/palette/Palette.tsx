// The command palette (SPEC-v3.md "Steering", "Also"): Ctrl+K (Cmd+K on a Mac) or the Actions button opens it over the
// office; typing finds any action, its arguments are asked one at a time, and Enter runs it. A modal dialog holding an
// ARIA combobox: focus stays inside, Escape closes, and what typing found is said once it settles.
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { reconnectingLine } from '../model.ts';
import { refusalOf } from '../people/shared.tsx';
import { boxCount } from '../person/personModel.ts';
import type { TabProps } from '../types.ts';
import {
  browse,
  callOf,
  doneLine,
  findCommands,
  findOptions,
  isMacLike,
  isPaletteKey,
  keepRecent,
  type PaletteCall,
  type PaletteCommand,
  paletteCommands,
  readRecents,
  RESULTS_SHOWN,
  resultsLine,
  runWord,
  shortcutKeys,
  shortcutLabel,
  stepValue,
} from './paletteModel.ts';
import { decisionOf, perform, resultOf } from './run.ts';
import { useLibrary } from './useLibrary.ts';
import './palette.css';

let results = 0;
/** Each result is its own toast, so a second action restarts the ten seconds. */
const nextResult = (): number => (results += 1);

const MAC = typeof navigator !== 'undefined' && isMacLike(navigator.userAgent);

/** The palette's shortcut on this machine, as a key says it ("Ctrl+K") and as aria-keyshortcuts takes it. */
export const paletteShortcut = { label: shortcutLabel(MAC), keys: shortcutKeys(MAC) } as const;

/** localStorage, or a stand-in where it is switched off. */
function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/** A command to start the palette on (a talk bar chip): run at once when it needs nothing, else at its first step. */
export interface PaletteStart {
  id: string;
  /** Words for its first step, ready to send. */
  draft: string | null;
}

export interface PaletteControl {
  open: boolean;
  /** The command it was opened on; null when opened to browse and search. */
  start: PaletteStart | null;
  show: () => void;
  /** Runs a command as the palette does: at once when it needs nothing, else in the palette at its first step. */
  run: (start: PaletteStart) => void;
  /** Closes it; focus goes back to what opened it unless the command moved somewhere else. */
  hide: (restore?: boolean) => void;
}

/** The palette's open state and its shortcut, for the shell. */
export function usePalette(enabled = true): PaletteControl {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<PaletteStart | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setStart(null);
    setOpen(true);
  }, []);
  const run = useCallback((next: PaletteStart) => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setStart(next);
    setOpen(true);
  }, []);
  const hide = useCallback((restore = true) => {
    setOpen(false);
    setStart(null);
    const back = opener.current;
    opener.current = null;
    if (restore && back?.isConnected) window.requestAnimationFrame(() => back.focus({ preventScroll: true }));
  }, []);
  const onKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (!enabled || e.defaultPrevented || !isPaletteKey(e, MAC)) return;
    e.preventDefault();
    if (open) hide();
    else show();
  });
  useEffect(() => {
    const listen = (e: globalThis.KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
  return { open, start, show, run, hide };
}

type PaletteProps = TabProps & { open: boolean; start?: PaletteStart | null; onClose: (restore?: boolean) => void };

export function Palette(props: PaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { open, onClose, start = null } = props;
  // Started on a command that needs nothing, it runs without showing; it shows for a step, or to say what went wrong.
  const [revealed, setRevealed] = useState(false);
  if (!open && revealed) setRevealed(false);
  const visible = open && (start === null || revealed);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (visible && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-palette-focus]')?.focus();
    } else if (!visible && d.open) d.close();
  }, [visible]);
  const reveal = useCallback(() => setRevealed(true), []);
  const [result, setResult] = useState<PaletteResult | null>(null);
  return (
    <>
      <dialog
        ref={dialog}
        className="palette"
        // A name that stays put while the heading inside says which command is being given.
        aria-label="Actions"
        // Escape closes the dialog itself; this keeps the shell's state with it.
        onClose={() => {
          if (open) onClose();
        }}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog itself: the panel fills the rest.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {open && <PaletteBody {...props} start={start} onReveal={reveal} titleId={titleId} onResult={setResult} />}
      </dialog>
      {result && <PaletteToast key={result.id} result={result} company={props.company} actions={props.actions} steer={props.steer} online={props.online} announce={props.announce} onDone={() => setResult(null)} />}
    </>
  );
}

/** What a palette action did: its sentence, the call it made and the decisions that existed before it, to find its own. */
interface PaletteResult {
  id: number;
  text: string;
  call: PaletteCall;
  before: ReadonlySet<string>;
  inverse: PaletteCall | null;
}

/** The toast stays this long, and keeps going while it is hovered or holds focus. */
const TOAST_MS = 10_000;

function PaletteToast({ result, company, actions, steer, online, announce, onDone }: { result: PaletteResult; company: TabProps['company']; actions: TabProps['actions']; steer: TabProps['steer']; online: boolean; announce: (text: string) => void; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const toast = useRef<HTMLDivElement>(null);
  // The change it made, once the snapshot has it: the newest decision of yours about what the command named.
  const decision = decisionOf(company, result);
  // Every snapshot renders the shell again with a new onDone: the timer must not start over for each one.
  const finish = useEffectEvent(() => onDone());
  useEffect(() => {
    if (held || undoing) return;
    const timer = window.setTimeout(() => finish(), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [held, undoing]);
  const canUndo = Boolean((decision && steer) || result.inverse);
  const undo = async () => {
    if (!canUndo || !online || undoing) return;
    // Read before the call: by the time the office answers, focus may already have dropped from the toast to the page.
    const heldFocus = toast.current?.contains(document.activeElement) ?? false;
    setUndoing(true);
    try {
      // The change's own Undo where the office keeps one; a reshape makes no decision, so its opposite call undoes it.
      if (decision && steer) await steer.undoDecision(decision.id);
      else if (result.inverse) await perform(result.inverse, { actions, ...(steer ? { steer } : {}) });
      announce('Undone.');
      // The button goes with the toast: focus moves to the view's heading first, so it doesn't fall to the page.
      const fell = !document.activeElement || document.activeElement === document.body;
      if (toast.current?.contains(document.activeElement) || (heldFocus && fell)) {
        // A phone's sheet that only peeks has no heading to take it: its peek key does.
        for (const target of ['#company-panel [data-panel-heading]', '#company-panel .side-panel__peek-key', '#company-panel']) {
          const el = document.querySelector<HTMLElement>(target);
          el?.focus({ preventScroll: true });
          if (el && document.activeElement === el) break;
        }
      }
      onDone();
    } catch (error) {
      announce(`Couldn't undo. ${refusalOf(error)}`);
      setUndoing(false);
    }
  };
  return (
    // The live region already said it; this is for everyone who can see it.
    <div ref={toast} className="palette-toast" data-testid="palette-toast" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <p className="palette-toast__text">{result.text}</p>
      {canUndo && (
        <button type="button" className="palette-toast__button" aria-disabled={!online || undoing || undefined} onClick={() => void undo()}>
          Undo
        </button>
      )}
    </div>
  );
}

interface Item {
  key: string;
  label: string;
  hint: string | null;
  disabled: boolean;
  group: string | null;
  /** What a press picks: a command, or one of a step's choices. */
  target: { kind: 'command'; command: PaletteCommand } | { kind: 'option'; value: string };
}

function PaletteBody({ snapshot, company, companyId, actions, steer, talk, catchUp, navigate, announce, online, onClose, onResult, titleId, start, onReveal }: PaletteProps & { titleId: string; onResult: (r: PaletteResult) => void; onReveal: () => void }) {
  const id = useId();
  const feed = talk !== undefined;
  const live = catchUp !== null;
  // The library for `/hire`: asked when the palette opens (this body mounts then).
  const library = useLibrary(companyId, snapshot.mode === 'demo', true);
  const commands = useMemo(() => paletteCommands(snapshot, company, { steering: steer !== undefined, feed, catchUp: live, library }), [snapshot, company, steer, feed, live, library]);
  const [recents, setRecents] = useState(() => readRecents(storage(), companyId));
  const [query, setQuery] = useState('');
  // Opened on a command (a talk bar chip): one that needs nothing runs at once, as a press on it would; one with steps
  // opens at its first, its words filled in.
  const [opening] = useState(() => {
    const c = start ? (commands.find((x) => x.id === start.id) ?? null) : null;
    return { command: c, now: c !== null && c.steps.length === 0 && !(c.sends && !online) };
  });
  const [command, setCommand] = useState<PaletteCommand | null>(() => (opening.command && !opening.now ? opening.command : null));
  const [args, setArgs] = useState<Record<string, string>>({});
  const [stepAt, setStepAt] = useState(0);
  const [draft, setDraft] = useState(() => (opening.command && !opening.now ? (start?.draft ?? '') : ''));
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const running = useRef(false);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const step = command ? (command.steps[stepAt] ?? null) : null;
  const last = command !== null && stepAt === command.steps.length - 1;
  const offline = reconnectingLine(snapshot.serverTime);

  // The list: before typing, recent and suggested actions; while typing, the best matches; in a choice, its options.
  const items: Item[] = [];
  let found = 0;
  if (step?.kind === 'choice') {
    const options = findOptions(step.options, query);
    found = options.length;
    for (const o of options) items.push({ key: o.value, label: o.label, hint: o.hint, disabled: false, group: null, target: { kind: 'option', value: o.value } });
  } else if (!step) {
    const asItem = (c: PaletteCommand, group: string | null): Item => ({
      key: `${group ?? ''}:${c.id}`,
      label: c.label,
      hint: c.sends && !online ? 'Waits until the office is back' : c.hint,
      disabled: c.sends && !online,
      group,
      target: { kind: 'command', command: c },
    });
    if (query.trim() === '') {
      for (const g of browse(commands, recents)) for (const c of g.commands) items.push(asItem(c, g.title));
      found = items.length;
    } else {
      const matches = findCommands(commands, query, recents);
      found = matches.length;
      for (const c of matches.slice(0, RESULTS_SHOWN)) items.push(asItem(c, null));
    }
  }
  const shown = items.length;
  const current = Math.min(active, Math.max(0, items.length - 1));
  const optionId = (i: number) => `${id}-option-${i}`;

  // What was found is said once typing settles, not on every key.
  const choosing = step?.kind === 'choice';
  const searching = step === null || choosing;
  useEffect(() => {
    if (!searching) return;
    const timer = window.setTimeout(() => setSaid(resultsLine(found, shown, choosing)), 450);
    return () => window.clearTimeout(timer);
  }, [found, shown, choosing, searching, query]);

  // Each step's field takes focus as it comes.
  useEffect(() => {
    if (command) field.current?.focus();
  }, [command, stepAt]);

  useLayoutEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  });

  const run = async (c: PaletteCommand, values: Record<string, string>) => {
    if (running.current) return;
    if (c.sends && !online) {
      setProblem(offline);
      return;
    }
    const call = callOf(c.action, values);
    const { before, inverse } = resultOf(call, company);
    running.current = true;
    setBusy(true);
    setProblem(null);
    try {
      // The feed takes focus as it opens, so the palette closes first and leaves focus to it.
      if (call.on === 'talk') onClose(false);
      await perform(call, { actions, steer, talk });
      setRecents(keepRecent(storage(), companyId, c.id));
      const line = doneLine(snapshot, company, c, values);
      if (call.on === 'navigate') {
        onClose(false);
        navigate(call.path);
        // The view it opened takes focus.
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#company-panel [data-panel-heading]')?.focus({ preventScroll: true }));
      } else if (call.on !== 'talk') onClose();
      if (line) {
        announce(line);
        if (call.on !== 'navigate') onResult({ id: nextResult(), text: line, call, before, inverse });
      }
    } catch (error) {
      setProblem(`Couldn't do that: ${refusalOf(error)}`);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const pick = (item: Item) => {
    if (item.disabled) {
      setProblem(offline);
      return;
    }
    if (item.target.kind === 'option') answer(item.target.value);
    else choose(item.target.command);
  };

  const choose = (c: PaletteCommand) => {
    if (busy) return;
    if (c.sends && !online) {
      setProblem(offline);
      return;
    }
    setProblem(null);
    if (c.steps.length === 0) {
      void run(c, {});
      return;
    }
    setCommand(c);
    setArgs({});
    setStepAt(0);
    setDraft('');
    setQuery('');
    setActive(0);
  };

  const answer = (value: string) => {
    if (!command || !step || busy) return;
    const checked = stepValue(step, value);
    if (!checked.ok) {
      setProblem(checked.why);
      return;
    }
    const values = { ...args, [step.key]: checked.value };
    setProblem(null);
    if (last) {
      void run(command, values);
      return;
    }
    setArgs(values);
    setStepAt(stepAt + 1);
    setDraft(values[command.steps[stepAt + 1]?.key ?? ''] ?? '');
    setQuery('');
    setActive(0);
  };

  const back = () => {
    if (busy) return;
    setProblem(null);
    if (!command || stepAt === 0) {
      flushSync(() => {
        setCommand(null);
        setQuery('');
        setActive(0);
      });
      field.current?.focus();
      return;
    }
    const before = command.steps[stepAt - 1];
    setStepAt(stepAt - 1);
    setDraft(before?.kind === 'text' ? (args[before.key] ?? '') : '');
    setQuery('');
    setActive(0);
  };

  const started = useRef(false);
  const runNow = useEffectEvent((c: PaletteCommand) => run(c, {}));
  useEffect(() => {
    if (!start) return;
    const now = opening.now ? opening.command : null;
    if (!now) {
      onReveal();
      return;
    }
    // Deferred a task, so its first state changes come from the run, not from this effect; once, however often it runs.
    const timer = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void runNow(now);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [start, opening, onReveal]);
  // What went wrong shows, even for a command that ran without the palette.
  useEffect(() => {
    if (problem) onReveal();
  }, [problem, onReveal]);

  const onListKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      e.preventDefault();
      if (items.length > 0) setActive(((to % items.length) + items.length) % items.length);
    };
    if (e.key === 'ArrowDown') move(current + 1);
    else if (e.key === 'ArrowUp') move(current - 1);
    else if (e.key === 'PageDown') move(Math.min(items.length - 1, current + 8));
    else if (e.key === 'PageUp') move(Math.max(0, current - 8));
    else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      const item = items[current];
      if (item) pick(item);
    } else if (e.key === 'Backspace' && query === '' && command) {
      e.preventDefault();
      back();
    }
  };

  const onTextKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (step?.kind === 'text' && step.long && e.shiftKey) return;
    e.preventDefault();
    answer(draft);
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    answer(draft);
  };

  const count = step?.kind === 'text' ? boxCount(draft, step.max) : null;
  const title = command ? command.label : 'Actions';

  return (
    <div className="palette__panel" aria-busy={busy || undefined}>
      <div className="palette__head">
        <h2 id={titleId} className="palette__title">
          {title}
        </h2>
        <div className="palette__head-buttons">
          {command && (
            <button type="button" className="palette__head-button" onClick={back}>
              Back
            </button>
          )}
          <button type="button" className="palette__head-button" onClick={() => onClose()}>
            Close
          </button>
        </div>
      </div>

      {step?.kind === 'text' ? (
        <form className="palette__form" onSubmit={submitText}>
          <label className="palette__label" htmlFor={`${id}-field`}>
            {step.label}
          </label>
          {step.long ? (
            <textarea
              id={`${id}-field`}
              ref={(el) => {
                field.current = el;
              }}
              className={`prose-input palette__text${count?.over ? ' is-over' : ''}`}
              rows={3}
              value={draft}
              data-palette-focus
              aria-describedby={`${id}-hint`}
              aria-invalid={count?.over || undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onTextKey}
            />
          ) : (
            <input
              id={`${id}-field`}
              ref={(el) => {
                field.current = el;
              }}
              className={`text-input palette__text${count?.over ? ' is-over' : ''}`}
              type="text"
              autoComplete="off"
              value={draft}
              data-palette-focus
              aria-describedby={`${id}-hint`}
              aria-invalid={count?.over || undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onTextKey}
            />
          )}
          <div className="palette__form-foot">
            <p id={`${id}-hint`} className="palette__hint">
              {step.hint}
              {count?.text && <span className={count.over ? ' is-over' : ''}> {count.text}</span>}
            </p>
            <button type="submit" className="button button--primary" aria-disabled={busy || (!step.optional && draft.trim() === '') || count?.over || undefined}>
              {busy ? 'Working…' : last && command ? runWord(command.action) : 'Next'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {step?.kind === 'choice' && (
            <p id={`${id}-step`} className="palette__step">
              {step.label}
            </p>
          )}
          <label className="visually-hidden" htmlFor={`${id}-field`}>
            {step?.kind === 'choice' ? `${step.label}: type to narrow the choices` : 'Find an action'}
          </label>
          <input
            id={`${id}-field`}
            ref={(el) => {
              field.current = el;
            }}
            className="palette__input"
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={step?.kind === 'choice' ? 'Type to narrow the choices' : 'Type a name, a room, a task or what to do'}
            value={query}
            data-palette-focus
            aria-expanded={items.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
            aria-autocomplete="list"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setProblem(null);
            }}
            onKeyDown={onListKey}
          />
          <div id={`${id}-list`} role="listbox" aria-label={step?.kind === 'choice' ? step.label : 'Actions'} className="palette__list">
            <Options items={items} active={current} optionId={optionId} onActive={setActive} onPick={pick} />
          </div>
          {items.length === 0 && (
            <p className="palette__empty">{step?.kind === 'choice' ? 'No choice matches. Try another word.' : 'No action matches. Try a name, a room, a task, or a verb like pause or message.'}</p>
          )}
          {searching && shown < found && <p className="palette__more">{resultsLine(found, shown, choosing)}</p>}
        </>
      )}

      {problem && (
        <p className="palette__problem" role="alert">
          {problem}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {said}
      </p>
      <p className="palette__keys">Arrow keys move, Enter picks, Escape closes.</p>
    </div>
  );
}

/** The options, under their group's title while browsing. */
function Options({ items, active, optionId, onActive, onPick }: { items: readonly Item[]; active: number; optionId: (i: number) => string; onActive: (i: number) => void; onPick: (item: Item) => void }) {
  const groups: { title: string | null; at: number; items: Item[] }[] = [];
  items.forEach((item, i) => {
    const last = groups.at(-1);
    if (last && last.title === item.group) last.items.push(item);
    else groups.push({ title: item.group, at: i, items: [item] });
  });
  const option = (item: Item, i: number) => (
    <div
      key={item.key}
      id={optionId(i)}
      role="option"
      aria-selected={i === active}
      aria-disabled={item.disabled || undefined}
      className={`palette__option${i === active ? ' is-active' : ''}`}
      // The input keeps focus; a press picks.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => {
        if (i !== active) onActive(i);
      }}
      onClick={() => onPick(item)}
    >
      <span className="palette__option-label">{item.label}</span>
      {item.hint && <span className="palette__option-hint">{item.hint}</span>}
    </div>
  );
  return groups.map((g) =>
    g.title ? (
      <div key={`group:${g.title}`} role="group" aria-labelledby={`${optionId(g.at)}-group`}>
        <div id={`${optionId(g.at)}-group`} role="presentation" className="palette__group">
          {g.title}
        </div>
        {g.items.map((item, j) => option(item, g.at + j))}
      </div>
    ) : (
      g.items.map((item, j) => option(item, g.at + j))
    ),
  );
}
