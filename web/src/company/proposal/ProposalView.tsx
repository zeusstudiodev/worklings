// The proposal (docs/design-v3.md, "The proposal"): until the start the panel has no tabs, only this. First the CEO's
// scoping questions when it asks any, then its draft as it comes, the questions, the summary, direct edits with Undo,
// the conversation with the CEO and Start. The chart is the Org board over the map (org/OrgBoard.tsx), which reads what
// this panel publishes (chartBridge.ts).
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Question } from '../../../../src/core/company.ts';
import { aboutDollars, type CostEstimate, estimateCompanyCost } from '../../../../src/core/cost-estimate.ts';
import { inSentence } from '../../../../src/core/studio.ts';
import { demoCatalogue } from '../../../../src/core/demo-company.ts';
import type { OrgProposal, ProposedQuestion } from '../../../../src/core/org.ts';
import type { CatalogRole } from '../../../../src/core/snapshot.ts';
import { ApiError, companyApiBase, getCatalog } from '../../lib/api.ts';
import { duration, hourMinute } from '../../lib/format.ts';
import { useWallClock } from '../../lib/hooks.ts';
import { OFFLINE_SENTENCE } from '../api.ts';
import { useSkew } from '../people/clock.ts';
import type { TabProps } from '../types.ts';
import { ChoiceButton } from '../ui/ChoiceButton.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import { SpendingPlan } from '../spending/SpendingPlan.tsx';
import { sizeWords } from '../spending/spendingModel.ts';
import { useReached } from '../ui/useReached.ts';
import { tabToken } from '../useHub.ts';
import { proposalChart } from './chartBridge.ts';
import { AddPersonForm, AddRoomForm, PersonForm } from './Forms.tsx';
import {
  addPerson,
  addRoom,
  answerText,
  type Catalogue,
  ceoLabel,
  chartOf,
  draftState,
  editPerson,
  modelsSentence,
  named,
  newRolesSentence,
  notSavedLine,
  openQuestionsNote,
  peopleSentence,
  picksNote,
  proposalAnswer,
  proposedAt,
  questionRecord,
  reasonsOf,
  removePerson,
  scopingAnswers,
  scopingLine,
  scopingOf,
  type ScopingState,
  sizeNote,
  sizingSentence,
  themeSentence,
  whyLine,
} from './model.ts';
import { companyHref, navigate as go } from '../router.ts';

const UNDO_SHOWN_MS = 10_000;
/** When Undo goes, for a change made now (called from handlers, never while drawing). */
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;
/** A studio catalogue that carries the library's roles. */
const isLibrary = (c: unknown): c is { library: CatalogRole[] } => typeof c === 'object' && c !== null && 'library' in c && Array.isArray(c.library);
const ANSWER_MAX = 1_000;
type Editing = { kind: 'person'; id: string } | { kind: 'add'; room: string } | { kind: 'room' } | null;

/** How long a start the office took may go without the company running before the button comes back. */
const START_WAIT_MS = 60_000;

/** The proposal on show before this one, kept per company for the tab's life so a revision can say what changed. */
function useBaseline(companyId: string, proposal: OrgProposal | null): OrgProposal | null {
  const key = `worklings-proposal:${companyId}`;
  const json = proposal ? JSON.stringify(proposal) : null;
  const [seen, setSeen] = useState<{ current: string | null; previous: string | null }>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown;
      if (stored && typeof stored === 'object' && 'current' in stored && 'previous' in stored) {
        const { current, previous } = stored;
        return { current: typeof current === 'string' ? current : null, previous: typeof previous === 'string' ? previous : null };
      }
    } catch {
      // A damaged entry just means nothing to compare with.
    }
    return { current: json, previous: null };
  });
  // A new version moves the one on show into `previous`: React's pattern for state that follows a prop.
  if (json !== null && seen.current !== json) setSeen({ current: json, previous: seen.current });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(seen));
    } catch {
      // Site data blocked (a privacy setting, the static demo in some embeds): the comparison holds while the view is open.
    }
  }, [key, seen]);
  if (!seen.previous || seen.current !== json) return null;
  try {
    const before: unknown = JSON.parse(seen.previous);
    return isProposal(before) ? before : null;
  } catch {
    return null;
  }
}

/** Enough of a proposal's shape to compare with: what this tab kept is read back as data, not trusted. */
function isProposal(v: unknown): v is OrgProposal {
  if (typeof v !== 'object' || v === null) return false;
  const { people, rooms } = v as { people?: unknown; rooms?: unknown };
  return Array.isArray(people) && Array.isArray(rooms) && people.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string');
}

/** The line above Start: what the company costs while it works, as the hub's estimate says it; nothing while there is none. */
export const costLine = (e: CostEstimate): string =>
  e.billing === 'api-key' ? `About ${aboutDollars(e.perHour)} an hour while it works, billed per token to your API key.` : `About ${aboutDollars(e.perHour)} an hour at API prices; on Pro or Max it counts against your limits.`;

/** What the company costs while it works, as the hub's estimate says it (src/core/cost-estimate.ts). */
function StartButton({
  blocked,
  onStart,
  compact = false,
  busy = false,
  problem = null,
  estimate = null,
}: {
  blocked: string | null;
  onStart: () => void;
  compact?: boolean;
  busy?: boolean;
  problem?: string | null;
  estimate?: CostEstimate | null;
}) {
  const id = useId();
  return (
    <div className={`start-block${compact ? ' start-block--compact' : ''}`}>
      {!busy && !compact && estimate && (
        <section className="start-block__cost" aria-labelledby={`${id}-cost`}>
          <h3 id={`${id}-cost`} className="group-title">
            What it costs
          </h3>
          <p className="start-block__cost-line">{costLine(estimate)}</p>
          <details className="start-block__estimate">
            <summary>How it adds up</summary>
            {estimate.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </details>
        </section>
      )}
      <button
        type="button"
        className="button button--primary button--large"
        aria-disabled={blocked !== null || busy || undefined}
        aria-describedby={`${id}-why`}
        onClick={() => {
          if (!blocked && !busy) onStart();
        }}
      >
        {busy ? 'Starting…' : 'Start the company'}
      </button>
      <p id={`${id}-why`} className="start-block__note">
        {busy
          ? 'Hiring everyone and putting the project on its own branch.'
          : (blocked ?? (estimate ? 'Everyone is hired now and walks in.' : 'Everyone is hired now and walks in. Nobody costs anything until they have work.'))}
      </p>
      {problem && (
        <p className="start-block__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

export function ProposalView(props: TabProps & { phone: boolean; now: number }) {
  const { company, companyId, actions, online, announce, phone, snapshot } = props;
  const ceo = company.people.find((p) => p.level === 'ceo');
  const state = draftState(company);
  // The hub's estimate; the static demo has no hub, so it works the figure out from the org it shows.
  const estimate = company.estimate ?? (company.proposal ? estimateCompanyCost(company.proposal, { maxDesks: company.settings.maxDesks, billing: company.settings.billing }) : null);
  const offline = online ? null : 'The office is reconnecting, so this waits.';
  const planLabel = company.spending?.presets.find((p) => p.id === company.spending?.preset)?.label ?? null;
  const planLine = planLabel ? `${planLabel}, ${company.settings.maxDesks} at work at once.` : null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const accepted = company.proposal;
  const [draft, setDraft] = useState<{ proposal: OrgProposal; errors: string[] } | null>(null);
  const shown = draft?.proposal ?? accepted;
  const baseline = useBaseline(companyId, accepted);
  const [last, setLast] = useState<{ before: OrgProposal; text: string; until: number } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Pressed shows Starting… at once; the view says it from when the company takes the start (a reload mid-start too).
  const [pressed, setPressed] = useState(false);
  const viewStarting = company.starting === true;
  if (pressed && viewStarting) setPressed(false);
  const starting = pressed || viewStarting;
  const [startProblem, setStartProblem] = useState<string | null>(null);
  // The library for "Add someone": null until it is asked for, and again after it couldn't be read, so it is asked again.
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const formSpot = useRef<HTMLDivElement>(null);

  const chart = shown ? chartOf(shown, draft ? accepted : baseline) : null;
  // What the hub accepted starts as it is. A refused edit says why in the panel's words where it has them, else in the
  // hub's, each as a sentence naming the person.
  const errors = draft ? reasonsOf(draft.proposal, draft.errors) : [];
  const blocked = errors[0] ?? offline;

  // The library, for "Add someone": the demo carries its own.
  const wantCatalogue = editing?.kind === 'add' && catalogue === null;
  useEffect(() => {
    if (!wantCatalogue) return;
    let cancelled = false;
    if (snapshot.mode === 'demo') {
      Promise.resolve(demoCatalogue()).then((roles) => !cancelled && setCatalogue({ state: 'read', roles }), () => undefined);
    } else {
      getCatalog(tabToken(), companyApiBase(companyId)).then(
        (c) => !cancelled && setCatalogue(isLibrary(c) ? { state: 'read', roles: c.library } : { state: 'failed', problem: 'The office answered with something else.' }),
        // A refusal in the office's own sentence; no answer at all as the office says it everywhere.
        (error: unknown) => !cancelled && setCatalogue({ state: 'failed', problem: error instanceof ApiError ? error.message : OFFLINE_SENTENCE }),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [wantCatalogue, snapshot.mode, companyId]);

  // Focus goes to an edit form when one opens, so a keyboard lands on it from the chart.
  useEffect(() => {
    if (!editing) return;
    formSpot.current?.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: false });
  }, [editing]);

  const message = (error: unknown) => (error instanceof Error ? error.message : '');

  // A card or an Add button opens its form in the panel: the side panel shows the proposal (on a phone, its sheet comes up).
  const openForm = (next: Exclude<Editing, null>) => {
    if (phone || !location.search.includes('panel=proposal')) go(companyHref(companyId, { main: { kind: 'org' }, panel: { kind: 'proposal' } }));
    // A library that couldn't be read is read again for the next "Add someone".
    if (next.kind === 'add') setCatalogue((c) => (c?.state === 'failed' ? null : c));
    setEditing(next);
  };
  // Closing a form hands focus back to what opened it: its card or Add button while the chart shows, else See the chart.
  const closeForm = () => {
    const key = editing === null ? null : editing.kind === 'person' ? `chart-${editing.id}` : editing.kind === 'add' ? `chart-add-${editing.room}` : 'chart-add-room';
    flushSync(() => setEditing(null));
    const opener = key === null ? null : document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
    (opener ?? document.querySelector<HTMLElement>('[data-focus="see-chart"]'))?.focus();
  };

  /**
   * Sends an edit. The line that takes the form's place says what happened, "Saved Kai's changes." or, when the office
   * turns the edit down, "Not saved." with why; the live region says the same, and focus goes to its Undo.
   */
  const apply = async (next: OrgProposal, done: string) => {
    const before = shown;
    if (!before || busy) return;
    setBusy(true);
    setEditProblem(null);
    try {
      const result = await actions.editProposal(next);
      const text = result.ok ? done : notSavedLine(reasonsOf(next, result.errors));
      // Drawn at once, so the form is gone and Undo is there when focus moves to it.
      flushSync(() => {
        setDraft(result.ok ? null : { proposal: next, errors: result.errors });
        setLast({ before, text, until: undoUntil() });
        setEditing(null);
      });
      undoRef.current?.focus();
      announce(text);
    } catch (error) {
      setEditProblem(`Couldn't change the proposal. ${message(error)}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!last) return;
    const target = last.before;
    // Undo goes with its line: focus waits on the proposal's heading.
    flushSync(() => {
      setLast(null);
      setEditProblem(null);
    });
    headingRef.current?.focus({ preventScroll: true });
    if (accepted && JSON.stringify(target) === JSON.stringify(accepted)) {
      setDraft(null);
      announce('Undone.');
      return;
    }
    try {
      const result = await actions.editProposal(target);
      setDraft(result.ok ? null : { proposal: target, errors: result.errors });
      announce(result.ok ? 'Undone.' : notSavedLine(reasonsOf(target, result.errors)));
    } catch (error) {
      setEditProblem(`Couldn't undo it. ${message(error)}`.trim());
    }
  };

  const backToCeo = async () => {
    if (!shown) return;
    const before = shown;
    setEditProblem(null);
    try {
      await actions.restoreProposal();
      // The button goes once the office has the CEO's version back; focus waits on Undo.
      flushSync(() => {
        setDraft(null);
        setEditing(null);
        setLast({ before, text: "Back to the CEO's version.", until: undoUntil() });
      });
      undoRef.current?.focus();
      announce("Back to the CEO's version.");
    } catch (error) {
      setEditProblem(`Couldn't go back to the CEO's version. ${message(error)}`.trim());
    }
  };

  // The hub takes the start at once and runs the company once git has put the project on its branch, which can take
  // seconds; the shell goes to Now when the company runs. Until then the button stays busy, so it can't be pressed twice.
  const start = async () => {
    setPressed(true);
    setStartProblem(null);
    try {
      await actions.start();
      announce('Starting the company: hiring everyone and putting the project on its own branch.');
    } catch (error) {
      setPressed(false);
      setStartProblem(`Couldn't start the company. ${message(error)}`.trim());
    }
  };
  // A start the office took but never ran (the office closed meanwhile, say) gives the button back.
  useEffect(() => {
    if (!pressed) return;
    const wait = window.setTimeout(() => {
      setPressed(false);
      setStartProblem("The company hasn't started yet. Press Start again; if it still doesn't, look at the terminal that runs the office.");
    }, START_WAIT_MS);
    return () => window.clearTimeout(wait);
  }, [pressed]);

  // The chart is the Org board: it opens over the map, keeping the proposal in the side panel.
  const openChart = () => {
    if (!shown) return;
    go(companyHref(companyId, { main: { kind: 'org' }, panel: phone ? null : { kind: 'proposal' } }));
  };

  // The board's chart follows the panel.
  useEffect(() => {
    if (!shown || !chart) {
      proposalChart.set(null);
      return;
    }
    proposalChart.set({
      proposal: shown,
      chart,
      selected: editing?.kind === 'person' ? editing.id : null,
      canEdit: online,
      onOpen: (id) => openForm({ kind: 'person', id }),
      onAdd: (room) => openForm({ kind: 'add', room }),
      onAddRoom: () => openForm({ kind: 'room' }),
      onStart: () => void start(),
      startBlocked: blocked,
      starting,
      cost: estimate ? costLine(estimate) : null,
      plan: planLine,
    });
  });
  useEffect(() => () => proposalChart.set(null), []);

  if (state === 'scoping') return <Scoping {...props} />;
  if (state !== 'ready' || !shown) return <Drafting {...props} state={state} />;

  const since = proposedAt(company);
  const questions = shown.questions.map((q) => {
    const record = questionRecord(q, company.questions, ceo?.id);
    return { q, record, answer: proposalAnswer(q, record, company.messages, ceo?.id, since) };
  });
  const openCount = questions.filter((x) => x.answer === null).length;
  const editingPerson = editing?.kind === 'person' ? shown.people.find((x) => x.id === editing.id) : undefined;
  const newRoles = newRolesSentence(shown);
  const size = sizeNote(shown);
  const sizing = sizingSentence(shown);
  const answered = scopingAnswers(scopingOf(company));

  return (
    <div className="proposal">
      <h2 ref={headingRef} className="panel-title" tabIndex={-1} data-panel-heading>
        The CEO's proposal
      </h2>
      <p className="proposal__state">
        {starting
          ? 'Starting: everyone is being hired and the project gets its own branch. Now opens when the company runs.'
          : "The CEO's proposal is ready for you. Start it as it is, answer the CEO, or change it."}
      </p>

      <div ref={formSpot}>
        {editingPerson && (
          <PersonForm
            key={editingPerson.id}
            proposal={shown}
            person={editingPerson}
            unavailable={offline ?? (busy ? 'Saving…' : null)}
            catalogue={company.spending?.catalogue ?? null}
            onSave={(edit) => void apply(editPerson(shown, editingPerson.id, edit), `Saved ${edit.name || editingPerson.name}'s changes.`)}
            onRemove={() => void apply(removePerson(shown, editingPerson.id), `Took ${editingPerson.name.trim() || named(editingPerson)} out of the proposal.`)}
            onClose={closeForm}
          />
        )}
        {editing?.kind === 'add' && (
          <AddPersonForm
            key={editing.room}
            proposal={shown}
            room={editing.room}
            catalogue={catalogue ?? { state: 'reading' }}
            onRetry={() => setCatalogue(null)}
            unavailable={offline ?? (busy ? 'Adding…' : null)}
            onAdd={(input) => {
              const { proposal } = addPerson(shown, { ...input, room: editing.room });
              void apply(proposal, `Added ${input.name.trim()}, ${inSentence(input.title)}.`);
            }}
            onDescribe={(description) => {
              const room = shown.rooms.find((r) => r.id === editing.room)?.title ?? editing.room;
              if (!ceo) return;
              actions.say(ceo.id, `Add someone to ${room}: ${description}`).then(
                () => {
                  closeForm();
                  props.announce('Sent to the CEO.');
                },
                (error: unknown) => setEditProblem(`Couldn't send it to the CEO. ${message(error)}`.trim()),
              );
            }}
            onClose={closeForm}
          />
        )}
        {editing?.kind === 'room' && (
          <AddRoomForm
            unavailable={offline ?? (busy ? 'Adding…' : null)}
            onAdd={(input) => {
              const { proposal } = addRoom(shown, input);
              void apply(proposal, `Added the room ${input.title.trim()}.`);
            }}
            onClose={closeForm}
          />
        )}
      </div>
      {last && <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={() => void undo()} unavailable={!online} />}
      {editProblem && <p className="proposal__problem" role="alert">{editProblem}</p>}

      {errors.length > 0 && (
        <section className="callout callout--warn proposal__errors" aria-labelledby="proposal-errors">
          <h3 id="proposal-errors" className="callout__title">
            {errors.length === 1 ? 'One thing stops the start' : `${errors.length} things stop the start`}
          </h3>
          <ul className="plain-list">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {ceo && (
            <button
              type="button"
              className="button"
              aria-disabled={!online || undefined}
              onClick={() => {
                if (!online) return;
                actions.say(ceo.id, `I changed the proposal and the office turned it down: ${errors.join(' ')} Please fix the org.`).then(
                  () => props.announce('Sent to the CEO.'),
                  (error: unknown) => setEditProblem(`Couldn't send it to the CEO. ${message(error)}`.trim()),
                );
              }}
            >
              Ask the CEO to fix it
            </button>
          )}
        </section>
      )}

      {questions.length > 0 && (
        <section className="proposal__section" aria-labelledby="proposal-questions">
          <h3 id="proposal-questions" className="group-title">
            The CEO's questions
          </h3>
          {openQuestionsNote(openCount) && <p className="group-note">{openQuestionsNote(openCount)}</p>}
          <ul className="questions">
            {questions.map(({ q, record, answer }) => (
              <ProposalQuestion key={q.text} {...props} question={q} record={record} answer={answer} ceo={ceo?.id ?? null} />
            ))}
          </ul>
        </section>
      )}

      <section className="proposal__section" aria-labelledby="proposal-summary">
        <h3 id="proposal-summary" className="group-title">
          Summary
        </h3>
        <p className="proposal__name">{shown.company}</p>
        <p className="proposal__goal">{shown.goal}</p>
        <ul className="summary-list">
          <li>{peopleSentence(shown)}</li>
          {sizeWords(shown.size) && <li>{sizeWords(shown.size)}</li>}
          {sizing && <li>{sizing}</li>}
          <li>{modelsSentence(shown)}</li>
          <li>{themeSentence(shown)}</li>
          {newRoles && <li>{newRoles}</li>}
        </ul>
        {size && <p className="note">{size}</p>}
        {answered.length > 0 && (
          <details className="proposal__answers">
            <summary>What you told the CEO first</summary>
            <AnswerList answers={answered} />
          </details>
        )}
        <div className="proposal__chart-actions">
          <button type="button" className="button" onClick={openChart} data-focus="see-chart">
            See the chart
          </button>
          {(company.proposalEdited || draft) && (
            <button type="button" className="link" aria-disabled={!online || undefined} onClick={() => online && void backToCeo()}>
              Back to the CEO's version
            </button>
          )}
        </div>
        <p className="proposal__hint">Open someone on the chart to change them, or add people and rooms there.</p>
      </section>

      <SpendingPlan company={company} actions={actions} online={online} announce={announce} mode="proposal" />

      {ceo && <TalkToCeo {...props} ceo={ceo.id} ceoName={ceoLabel(ceo)} />}

      <StartButton blocked={blocked} onStart={() => void start()} busy={starting} problem={startProblem} estimate={estimate} />
      {!starting && <p className="proposal__foot">Leaving keeps the proposal: it waits in the lobby as Proposal ready.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** "Who is it for? Just me." for each answer you gave the CEO's scoping questions. */
function AnswerList({ answers }: { answers: { question: string; answer: string }[] }) {
  return (
    <dl className="scoping-answers">
      {answers.map((a) => (
        <div key={a.question} className="scoping-answers__row">
          <dt>{a.question}</dt>
          <dd>{a.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The CEO's scoping questions, the proposal's first state when it asks any: each answered as the inbox answers it,
 * "Use the CEO's picks" for every open one at once, or your own words to the CEO in the talk bar.
 */
function Scoping(props: TabProps & { phone: boolean; now: number }) {
  const { company, actions, online, announce } = props;
  const ceo = company.people.find((p) => p.level === 'ceo');
  // A CEO the studio gave no first name is "the CEO" in a sentence, not "CEO".
  const ceoName = ceo && ceo.name !== ceo.title ? ceo.name : 'The CEO';
  const scoping = scopingOf(company) as ScopingState;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answerWithPicks = async () => {
    if (!online || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await actions.answerWithPicks();
      announce("Answered with the CEO's picks. Undo stays a few seconds on each.");
    } catch (error) {
      setProblem(`Couldn't answer with the CEO's picks. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="proposal">
      <h2 className="panel-title" tabIndex={-1} data-panel-heading>
        A few questions first
      </h2>
      <p className="proposal__state">{scopingLine(scoping, ceoName)}</p>
      <blockquote className="proposal__prompt">{company.prompt}</blockquote>
      {/* The office's own question comes first: it sizes everything the CEO's questions are about. */}
      <SpendingPlan company={company} actions={actions} online={online} announce={announce} mode="scoping" scopingOpen />
      {/* Up top, where the line above names it: below four questions it sat a screen or more away. */}
      {scoping.open > 0 && (
        <div className="scoping-picks">
          <button type="button" className="button button--primary button--large" aria-disabled={!online || busy || undefined} aria-describedby="scoping-picks-note" onClick={() => void answerWithPicks()}>
            {scoping.open === 1 ? "Use the CEO's pick" : "Use the CEO's picks"}
          </button>
          <p id="scoping-picks-note" className="start-block__note">
            {online ? picksNote(scoping.open) : 'The office is reconnecting, so this waits.'}
          </p>
        </div>
      )}
      <section className="proposal__section" aria-labelledby="scoping-questions">
        <h3 id="scoping-questions" className="group-title">
          The CEO's questions
        </h3>
        <p className="group-note">Your answers decide how big the company is and what it builds first.</p>
        <ul className="questions">
          {scoping.items.map(({ question: q, answer }) => (
            <ProposalQuestion
              key={q.id}
              {...props}
              question={{ text: q.text, options: q.options, ...(q.recommended === null ? {} : { recommended: q.recommended }) }}
              record={q}
              answer={answer ? { text: answer.text, appliesAt: answer.appliesAt } : null}
              ceo={ceo?.id ?? null}
              scoping
            />
          ))}
        </ul>
      </section>
      {problem && (
        <p className="proposal__problem" role="alert">
          {problem}
        </p>
      )}
      {ceo && (
        <TalkToCeo
          {...props}
          ceo={ceo.id}
          ceoName={ceoName}
          title="In your own words"
          note={`Rather say it your way? Tell ${ceoName === 'The CEO' ? 'the CEO' : ceoName} in the box at the foot of the screen. The CEO drafts from your words, with its picks for anything you leave out.`}
          label="Tell the CEO in your own words"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Drafting(props: TabProps & { phone: boolean; now: number; state: ReturnType<typeof draftState> }) {
  const { company, actions, online, state } = props;
  const wall = useWallClock(1000);
  const ceo = company.people.find((p) => p.level === 'ceo');
  const founded = company.log.find((e) => e.kind === 'founded')?.at ?? ceo?.desk.since ?? wall;
  const lines = company.statuses.filter((s) => s.person === ceo?.id && s.at >= founded - 60_000);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const press = (run: () => Promise<unknown>, what: string) => () => {
    if (!online) return;
    setProblem(null);
    run().then(
      () => setSent(true),
      (error: unknown) => setProblem(`Couldn't ${what}. ${error instanceof Error ? error.message : ''}`.trim()),
    );
  };
  const again = ceo ? press(() => actions.say(ceo.id, 'Please draft the org again from my first message.'), 'ask the CEO') : undefined;
  const answered = scopingAnswers(scopingOf(company));
  const words = company.drafting?.stopped?.words.trim() ?? '';
  return (
    <div className="proposal">
      <h2 className="panel-title" tabIndex={-1} data-panel-heading>
        {state === 'drafting' || state === 'fixing'
          ? 'Drafting your company'
          : state === 'stopped'
            ? 'The draft is stopped'
            : state === 'ended'
              ? 'The CEO is waiting for you'
              : "The draft didn't work"}
      </h2>
      {state === 'drafting' && (
        <p className="proposal__state">{answered.length > 0 ? 'The CEO is drafting your company from your answers. About a minute.' : 'The CEO is drafting your company. About a minute.'}</p>
      )}
      {state === 'fixing' && <p className="proposal__state">The CEO's draft didn't check out, so it's fixing it.</p>}
      {state === 'gave-up' && <p className="proposal__state">The CEO couldn't draft a valid org.</p>}
      {state === 'failed' && (
        <>
          <p className="proposal__state">Couldn't draft your company.</p>
          {ceo?.desk.problem && <p className="proposal__problem">{ceo.desk.problem}</p>}
        </>
      )}
      {state === 'stopped' && <p className="proposal__state">You stopped the CEO.</p>}
      {state === 'ended' && <p className="proposal__state">The CEO's turn ended without a proposal, so there is no company to start yet.</p>}
      <blockquote className="proposal__prompt">{company.prompt}</blockquote>
      {state === 'ended' && (
        <section className="proposal__section" aria-labelledby="draft-ceo-words">
          <h3 id="draft-ceo-words" className="group-title">
            What the CEO said
          </h3>
          {words ? <blockquote className="proposal__words">{words}</blockquote> : <p className="group-note">It ended without saying anything.</p>}
        </section>
      )}
      {state === 'drafting' && <SpendingPlan company={company} actions={actions} online={online} announce={props.announce} mode="drafting" />}
      {answered.length > 0 && (
        <section className="proposal__section" aria-labelledby="draft-answers">
          <h3 id="draft-answers" className="group-title">
            Your answers
          </h3>
          <AnswerList answers={answered} />
        </section>
      )}
      {lines.length > 0 && (
        <ol className="draft-lines" aria-label="What the CEO is doing">
          {lines.map((l) => (
            <li key={`${l.at}-${l.text}`}>
              <span className="draft-lines__time">{hourMinute(l.at)}</span> {l.text}
            </li>
          ))}
        </ol>
      )}
      {(state === 'drafting' || state === 'fixing') && (
        <>
          <p className="running-line">
            <span className="running-mark" aria-hidden="true" />
            Drafting for <span className="tabular">{duration(Math.max(0, wall - founded))}</span>
          </p>
          {ceo && (
            <button type="button" className="button" aria-disabled={!online || undefined} onClick={press(() => actions.stop(ceo.id, 'Stop here and wait for my next message.'), 'stop the CEO')}>
              Stop the CEO
            </button>
          )}
        </>
      )}
      {state === 'ended' && ceo && (
        <TalkToCeo
          {...props}
          ceo={ceo.id}
          ceoName={ceoLabel(ceo)}
          title="Answer the CEO"
          note="Write back in the box at the foot of the screen. The CEO drafts your company from your words, or press Draft again to have it start over from your first message."
          label="Answer the CEO"
        />
      )}
      {(state === 'stopped' || state === 'ended') && again && (
        <button type="button" className="button button--primary" aria-disabled={!online || undefined} onClick={again}>
          Draft again
        </button>
      )}
      {(state === 'failed' || state === 'gave-up') && again && (
        <button type="button" className="button button--primary" aria-disabled={!online || undefined} onClick={again}>
          Try again
        </button>
      )}
      {sent && state !== 'drafting' && <p className="muted">Sent. The CEO picks it up at their next step.</p>}
      {problem && <p className="proposal__problem" role="alert">{problem}</p>}
      {!online && <p className="muted">The office is reconnecting, so these wait.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

interface QuestionProps extends TabProps {
  question: ProposedQuestion;
  /** The inbox's question it is, which an answer goes through; null where the hub asked none (an answer is then a message). */
  record: Question | null;
  answer: { text: string; appliesAt: number | null } | null;
  ceo: string | null;
  /** One of the CEO's scoping questions: its answer goes to the CEO with the others, and the CEO's why shows. */
  scoping?: boolean;
}

/** One of the CEO's questions, answered as the inbox answers: each press answers, with Undo until it reaches the CEO. */
function ProposalQuestion(props: QuestionProps) {
  const { question: q, record, answer, ceo, actions, online, scoping = false } = props;
  const why = record ? whyLine(record) : null;
  const [own, setOwn] = useState(false);
  const [words, setWords] = useState('');
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxId = useId();
  // A press or an Undo moves focus to what replaces it, when that appears: a snapshot later, live.
  const focusNext = useRef<'undo' | 'choices' | null>(null);
  const takeFocus = (wanted: 'undo' | 'choices') => (el: HTMLButtonElement | null) => {
    if (!el || focusNext.current !== wanted) return;
    focusNext.current = null;
    el.focus();
  };
  // The hub's appliesAt on this browser's clock, which Undo is timed on.
  const skew = useSkew();
  const until = answer && answer.appliesAt !== null ? answer.appliesAt - skew : null;
  const applied = useReached(until);
  const failed = (error: unknown) => setProblem(`Couldn't send your answer. ${error instanceof Error ? error.message : ''}`.trim());
  const done = () => {
    setOwn(false);
    setWords('');
    setChanging(false);
  };
  const send = (option: number | null, text: string) => {
    if (!online) return;
    setProblem(null);
    if (record) {
      focusNext.current = 'undo';
      actions.answer(record.id, option, option === null ? text : '').then(done, (error: unknown) => {
        focusNext.current = null;
        failed(error);
      });
    } else if (ceo) {
      actions.say(ceo, answerText(q, text)).then(done, failed);
    }
  };
  const undo = () => {
    if (!record || !online) return;
    focusNext.current = 'choices';
    actions.undo(record.id).catch((error: unknown) => {
      focusNext.current = null;
      setProblem(`Couldn't take it back. ${error instanceof Error ? error.message : ''}`.trim());
    });
  };
  const showChoices = answer === null || changing;
  return (
    <li className={`question${answer === null ? ' question--open' : ''}`}>
      <p className="question__who">The CEO asks you.</p>
      <p className="question__text">{q.text}</p>
      {!showChoices && answer ? (
        until !== null && !applied ? (
          <UndoLine ref={takeFocus('undo')} text={`Answering: ${answer.text}.`} until={until} onUndo={undo} unavailable={!online} />
        ) : (
          <p className="question__answered" tabIndex={-1} data-undo-focus>
            You answered: {answer.text.replace(/[.?!…]+$/, '')}. {scoping ? 'It goes to the CEO with your other answers.' : 'The CEO revises the proposal with it.'}{' '}
            {!record && (
              <button type="button" className="link" onClick={() => setChanging(true)}>
                Change your answer
              </button>
            )}
          </p>
        )
      ) : (
        <>
          <div className="choices">
            {q.options.map((option, i) => (
              <ChoiceButton key={option} ref={i === 0 ? takeFocus('choices') : undefined} pick={q.recommended === i} unavailable={!online} onClick={() => send(i, option)}>
                {option}
              </ChoiceButton>
            ))}
          </div>
          {why && <p className="question__why">{why}</p>}
          {!own ? (
            <button type="button" className="link question__own" onClick={() => setOwn(true)}>
              Answer in your own words
            </button>
          ) : (
            <form
              className="question__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (words.trim()) send(null, words.trim());
              }}
            >
              <label className="visually-hidden" htmlFor={boxId}>
                Your answer
              </label>
              <textarea id={boxId} className="prose-input" rows={2} maxLength={ANSWER_MAX} value={words} autoFocus onChange={(e) => setWords(e.target.value)} />
              <button type="submit" className="button" aria-disabled={!online || !words.trim() || undefined}>
                Send answer
              </button>
            </form>
          )}
        </>
      )}
      {problem && (
        <p className="proposal__problem" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** The talk bar is the one box for talking: this only points at it, and puts the cursor there when asked. */
function TalkToCeo({
  talk,
  online,
  ceo,
  ceoName,
  title = 'Talk to the CEO',
  note,
  label = 'Tell the CEO what to change',
}: TabProps & { ceo: string; ceoName: string; title?: string; note?: string; label?: string }) {
  const id = useId();
  return (
    <section className="proposal__section" aria-labelledby={`${id}-talk`}>
      <h3 id={`${id}-talk`} className="group-title">
        {title}
      </h3>
      <p className="group-note">
        {online
          ? (note ?? `Tell ${ceoName} what to change in the box at the foot of the screen. They read it at their next step and revise the proposal.`)
          : 'The office is reconnecting, so sending waits. Your words stay in the box.'}
      </p>
      <button type="button" className="button" onClick={() => talk.to({ kind: 'person', id: ceo }, { focus: true })}>
        {label}
      </button>
    </section>
  );
}
