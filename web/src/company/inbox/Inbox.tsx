// The inbox (docs/design-v3.md, "Inbox"): the one place questions and approvals are answered, oldest first, then the
// conversations and what was answered today. A press answers at once, leaves one line with Undo for the hub's five
// seconds, and moves focus on to the next item.
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { type CompanyView, UNDO_MS } from '../../../../src/core/company.ts';
import { coarseAge } from '../../../../src/core/now.ts';
import { roomHue } from '../../hud/model.ts';
import { hourMinute } from '../../lib/format.ts';
import { companyState, showsStateCallout, stateOfCompany } from '../model.ts';
import { useCompanyClock, useSkew } from '../people/clock.ts';
import { CompanyLink } from '../people/shared.tsx';
import { navigate as goTo } from '../router.ts';
import { planWait } from '../plan/planModel.ts';
import type { TabProps } from '../types.ts';
import { draftingOf, useAnswers } from './answers.ts';
import { batchCards } from './asksModel.ts';
import { BatchCard } from './BatchCard.tsx';
import { HandoverCard } from './HandoverCard.tsx';
import { InboxItem, type ItemFocus, useFocusGoal } from './InboxItem.tsx';
import { allItems, answeredLine, conversationsOf, conversationsTitle, inboxView, type Item, itemFromHash, itemId, needsYouLine, type Press, restingLine, undoUntil } from './inboxModel.ts';
import './inbox.css';

/** v0.3: the portfolio the company is in, which the hub sends beside its view. */
interface PortfolioRef {
  id: string;
  name: string;
  held: boolean;
}

const findItem = (company: CompanyView, id: string) => allItems(company).find((i) => itemId(i) === id);

/** The callout's action by how the company stopped: resting waits for the limit or tries now, a pause or a stop is resumed. */
function stoppedAction(company: CompanyView, portfolio: PortfolioRef | null): string | null {
  if (company.problem) return null;
  // v0.3: a portfolio's spent budget is raised on the portfolio, in the lobby.
  if (company.pause?.reason === 'budget' && portfolio?.held) return 'Open the portfolio';
  if (company.pause?.reason === 'budget') return 'Raise the budget';
  if (company.pause && company.pause.reason !== 'stakeholder') return 'Try now';
  return company.pause || company.phase === 'stopped' ? 'Resume work' : null;
}

export function Inbox({ snapshot, company, companyId, actions, navigate, announce, online, expandSheet, focusItem }: TabProps & { focusItem?: string }) {
  const [openedAt] = useState(() => snapshot.serverTime);
  // Opened on an item: from the shell, or from the address an Answer button gave.
  const [target] = useState(() => focusItem ?? itemFromHash(window.location.hash));
  const id = useId();
  const skew = useSkew();
  const { store, state } = useAnswers(companyId, { company, actions, announce, online, skew });

  const root = useRef<HTMLDivElement>(null);
  const setGoal = useFocusGoal(root);

  // Answers pressed before this inbox opened and long since through belong to the Answered fold, as before.
  const presses: Record<string, Press> = {};
  for (const [key, p] of Object.entries(state.presses)) {
    const item = findItem(company, key);
    const answer = item ? (item.kind === 'question' ? item.question.answer : item.approval.answer) : null;
    const old = answer !== null && answer.appliesAt <= openedAt && p.state !== 'sending' && p.state !== 'undoing';
    if (!old) presses[key] = p;
  }
  // The moments a pressed item changes by itself, by this browser's clock: when its undo window closes.
  const wake = Object.entries(presses).flatMap(([itemKey, p]) => {
    if (p.state !== 'sending' && p.state !== 'sent' && p.state !== 'undoing') return [];
    const item = findItem(company, itemKey);
    return [item ? undoUntil(item, p, skew) : p.at + UNDO_MS];
  });
  const now = useCompanyClock(snapshot.serverTime, online, wake);
  const view = inboxView(company, presses, { now, openedAt, skew, drafting: draftingOf(state) });
  const conversations = conversationsOf(company);
  const proposal = company.phase === 'proposed' && company.proposal !== null;
  const planWaiting = planWait(company);
  const resting = restingLine(company);

  // Opened on an item (the front desk, an Answer button): it comes into view with focus on its first line.
  useEffect(() => {
    const wanted = focusItem ?? target;
    if (!wanted) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-item-line="${CSS.escape(wanted)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
    // The hash did its job; Back and reloads shouldn't jump again.
    if (window.location.hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }, [focusItem, target]);

  // Once an answer of yours reaches them, the live region says so: "Allowed. Kai carries on." The store says each once.
  const doneKey = view.needs.filter((n) => n.view.kind === 'done').map((n) => itemId(n.item)).join(',');
  useEffect(() => {
    if (doneKey) store.announceApplied(doneKey.split(','));
  }, [doneKey, store]);

  /** After a press: the next item waiting, or the one before, or the line that says nothing needs you. */
  const nextAfter = (itemKey: string) => {
    const open = view.needs.filter((n) => n.view.kind === 'open').map((n) => itemId(n.item));
    const at = open.indexOf(itemKey);
    const next = open[at + 1] ?? open[at - 1];
    return next && next !== itemKey ? ({ kind: 'line', id: next } as const) : ({ kind: 'count' } as const);
  };
  const focus: ItemFocus = {
    // A no offers "Tell Sam why" in its place: focus goes to that box, since saying why is what comes next.
    pressed: (itemKey, answer) => setGoal(answer.kind === 'approval' && answer.decision === 'deny' ? { kind: 'why', id: itemKey } : nextAfter(itemKey)),
    // Focus went on to the next item with the press; the item is back with why, so it comes back there.
    refused: (itemKey) => setGoal({ kind: 'line', id: itemKey }),
    undone: (itemKey) => setGoal({ kind: 'first', id: itemKey }),
    box: (itemKey) => setGoal({ kind: 'box', id: itemKey }),
  };

  const item = (it: Item, shown: Parameters<typeof InboxItem>[0]['view']) => (
    <li key={itemId(it)}>
      <InboxItem
        item={it}
        view={shown}
        company={company}
        companyId={companyId}
        now={now}
        online={online}
        navigate={navigate}
        announce={announce}
        store={store}
        state={state}
        focus={focus}
        surface="inbox"
        onTyping={expandSheet}
      />
    </li>
  );

  const answered = view.answered;
  // Resting, paused, stopped or can't run: the state's sentence tops the inbox, with its action.
  const stopped = showsStateCallout(company);
  const stoppedLine = stopped ? companyState(stateOfCompany(company, now), now).sentence : null;
  const portfolio = (snapshot as { portfolio?: PortfolioRef | null }).portfolio ?? null;
  const stoppedKey = stopped ? stoppedAction(company, portfolio) : null;
  return (
    <div className="inbox" ref={root}>
      {stoppedLine && (
        <div className="note inbox__callout" role="group" aria-label="State of the company">
          <p>{stoppedLine}</p>
          {stoppedKey && (
            <button
              type="button"
              className="button"
              aria-disabled={!online || undefined}
              onClick={() => {
                if (!online) return;
                // A spent budget is raised where it is set; nothing resumes until then.
                if (stoppedKey === 'Open the portfolio' && portfolio) {
                  goTo(`/p/${encodeURIComponent(portfolio.id)}`);
                  return;
                }
                if (stoppedKey === 'Raise the budget') {
                  navigate('settings');
                  return;
                }
                actions.resume().then(
                  () => announce(stoppedKey === 'Try now' ? 'Trying once. A new limit sets a new time.' : 'Resumed.'),
                  (error: unknown) => announce(`Couldn't ${stoppedKey.toLowerCase()}. ${error instanceof Error ? error.message : ''}`.trim()),
                );
              }}
            >
              {stoppedKey}
            </button>
          )}
        </div>
      )}
      <HandoverCard company={company} companyId={companyId} now={now} />
      <section aria-labelledby={`${id}-needs`}>
        {/* The side panel's head says how many need you; the heading takes focus when an answered item leaves. */}
        <h3 id={`${id}-needs`} className="group-title" data-needs-count tabIndex={-1}>
          Needs you
        </h3>
        {view.open + (proposal ? 1 : 0) + (planWaiting ? 1 : 0) === 0 && <p className="inbox__count">{needsYouLine(0)}</p>}
        {batchCards(company).map((card) => (
          <BatchCard key={card.id} card={card} actions={actions} online={online} announce={announce} />
        ))}
        {resting && view.open > 0 && <p className="note inbox__resting">{resting}</p>}
        {(view.needs.length > 0 || proposal || planWaiting) && (
          <ul className="inbox__items">
            {proposal && (
              <li className="inbox-item inbox-item--open inbox-item--proposal">
                <p className="inbox-item__who" data-item-line="proposal" tabIndex={-1}>
                  The CEO's proposal is ready for you.
                </p>
                <CompanyLink companyId={companyId} to="proposal" navigate={navigate} className="button button--primary" focusKey="inbox:proposal">
                  Open the proposal
                </CompanyLink>
              </li>
            )}
            {planWaiting && (
              <li className="inbox-item inbox-item--open inbox-item--proposal">
                <p className="inbox-item__who" data-item-line="plan" tabIndex={-1}>
                  {planWaiting.sentence}
                </p>
                <CompanyLink companyId={companyId} to="plan" navigate={navigate} className="button button--primary" focusKey="inbox:plan">
                  Open the plan
                </CompanyLink>
              </li>
            )}
            {view.needs.map(({ item: it, view: shown }) => item(it, shown))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-talk`} className="inbox__section">
        <h3 id={`${id}-talk`} className="group-title">
          {conversationsTitle(conversations)}
        </h3>
        {conversations.length === 0 ? (
          <div className="inbox__empty">
            <p>No conversations yet. Talk to anyone from the talk bar.</p>
            {ceoLink(company, companyId, navigate)}
          </div>
        ) : (
          <ul className="talks">
            {conversations.map((c) => (
              <li key={c.person.id} className="talks__row" style={{ '--hue': roomHue(snapshot, c.person.room) } as CSSProperties}>
                <span className="talks__marker" aria-hidden="true" />
                <div className="talks__main">
                  <p className="talks__head">
                    <CompanyLink
                      companyId={companyId}
                      to={`people/${encodeURIComponent(c.person.id)}`}
                      navigate={navigate}
                      className="talks__name"
                      focusKey={`inbox:talk:${c.person.id}`}
                      label={c.unread ? `${c.person.name}, new` : undefined}
                    >
                      {c.person.name}
                    </CompanyLink>
                    {c.person.name !== c.person.title && <span className="talks__title">{c.person.title}</span>}
                    <span className="talks__age">{coarseAge(now - c.at)}</span>
                  </p>
                  <p className="talks__last">{c.last}</p>
                </div>
                {c.unread && <span className="talks__dot" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <details className="fold inbox__answered">
          <summary>{answeredLine(answered.length)}</summary>
          <ul className="answered">
            {answered.map((a) => (
              <li key={a.id} className="answered__row">
                <p className="answered__what">{a.what}</p>
                <p className="answered__answer">
                  <span className="answered__yours">{a.answer}</span>{' '}
                  <time dateTime={new Date(a.at).toISOString()}>{hourMinute(a.at)}</time>
                </p>
              </li>
            ))}
          </ul>
          <p className="answered__older">Older ones are on the Timeline.</p>
        </details>
      )}
    </div>
  );
}

function ceoLink(company: CompanyView, companyId: string, navigate: TabProps['navigate']) {
  const ceo = company.people.find((p) => p.level === 'ceo');
  if (!ceo) return null;
  return (
    <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(ceo.id)}/message`} navigate={navigate} className="button" focusKey="inbox:message-ceo">
      Message the CEO
    </CompanyLink>
  );
}
