// The inbox as one card (SPEC-v0.8.md, decision 2): the oldest open item, docked over the talk bar, with "1 of N", Next,
// Skip and See all. It draws each item with the inbox's own InboxItem and presses through the same answer store, so the
// card, the full list and the feed always agree. After a press the next item slides in and takes focus; the press's one
// line with Undo stays above it until the answer goes through. Nothing waiting, no card.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { UNDO_MS } from '../../../../src/core/company.ts';
import { useCompanyClock, useSkew } from '../people/clock.ts';
import { CompanyLink } from '../people/shared.tsx';
import { planWait } from '../plan/planModel.ts';
import type { TabProps } from '../types.ts';
import { draftingOf, useAnswers } from './answers.ts';
import { InboxItem, type ItemFocus, useFocusGoal } from './InboxItem.tsx';
import { cardCountLine, cardOrder } from './cardModel.ts';
import { inboxView, itemId, type Item, undoUntil } from './inboxModel.ts';
import './inbox.css';

export interface InboxCardProps extends TabProps {
  /** Opens the whole list (the side panel's inbox, or a phone's sheet). */
  onSeeAll: () => void;
  /** Where focus goes when the last item is answered. */
  onEmpty: () => void;
  phone: boolean;
}

export function InboxCard({ snapshot, company, companyId, actions, navigate, announce, online, onSeeAll, onEmpty, phone }: InboxCardProps) {
  const id = useId();
  const [openedAt] = useState(() => snapshot.serverTime);
  const skew = useSkew();
  const { store, state } = useAnswers(companyId, { company, actions, announce, online, skew });
  const root = useRef<HTMLElement>(null);
  const setGoal = useFocusGoal(root);
  // This visit's order: skipped items go to the end. The cursor is the item shown and its place: when that item leaves (it
  // was answered), the same place shows what came next; an item arriving earlier in the order never moves the card.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [cursor, setCursor] = useState<{ key: string | null; at: number }>({ key: null, at: 0 });

  const wake = Object.entries(state.presses).flatMap(([key, p]) => {
    if (p.state !== 'sending' && p.state !== 'sent' && p.state !== 'undoing') return [];
    const item = findItem(company.questions, company.approvals, key);
    return [item ? undoUntil(item, p, skew) : p.at + UNDO_MS];
  });
  const now = useCompanyClock(snapshot.serverTime, online, wake);
  const view = inboxView(company, state.presses, { now, openedAt, skew, drafting: draftingOf(state) });
  const proposal = company.phase === 'proposed' && company.proposal !== null;
  const plan = planWait(company);
  const entries = cardOrder({ proposal, plan: plan?.sentence ?? null, open: view.needs.filter((n) => n.view.kind === 'open').map((n) => n.item) }, skipped);
  const found = cursor.key === null ? -1 : entries.findIndex((e) => e.key === cursor.key);
  const index = entries.length === 0 ? 0 : found >= 0 ? found : Math.min(cursor.at, entries.length - 1);
  const current = entries[index] ?? null;
  // The latest press while its line with Undo shows, or while a denial's "Tell them why" holds words not yet sent.
  const latest = Object.entries(state.presses).sort(([, a], [, b]) => b.at - a.at)[0];
  const pressed = latest ? view.needs.find((n) => itemId(n.item) === latest[0]) : undefined;
  const why = pressed ? state.whys[itemId(pressed.item)] : undefined;
  const writing = why !== undefined && why.state !== 'sent' && why.text.trim() !== '';
  const slot = pressed && (pressed.view.kind === 'pending' || (pressed.view.kind === 'done' && pressed.view.denial && writing)) ? pressed : null;
  const empty = !current && !slot;

  // The count, said politely when it changes (not on Next: the card itself says where you are).
  const total = entries.length;
  const said = useRef(total);
  useEffect(() => {
    if (said.current === total) return;
    said.current = total;
    announce(total === 0 ? 'Nothing needs you.' : cardCountLine(total));
  }, [total, announce]);

  // Focus inside the card when it goes (the last Undo window closed) lands on the office's heading, never on nothing.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!empty || !hadFocus.current) return;
    hadFocus.current = false;
    if (document.activeElement === document.body) document.getElementById('company-office-heading')?.focus({ preventScroll: true });
  }, [empty]);

  // The card's height on the shell (`--card-now`), so the labels and the camera follow it as it changes.
  useLayoutEffect(() => {
    const el = root.current;
    const shell = el?.closest<HTMLElement>('[data-company-shell]');
    if (!el || !shell) return;
    const write = () => shell.style.setProperty('--card-now', `${Math.round(el.getBoundingClientRect().height)}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      shell.style.removeProperty('--card-now');
    };
  }, [empty]);

  const focus: ItemFocus = {
    pressed: (key, answer) => {
      // The answered item leaves; the same place shows the next.
      setCursor({ key: null, at: index });
      if (answer.kind === 'approval' && answer.decision === 'deny') {
        setGoal({ kind: 'why', id: key });
        return;
      }
      const rest = entries.filter((e) => e.key !== key);
      const next = rest[Math.min(index, rest.length - 1)];
      if (next) setGoal({ kind: 'line', id: next.key });
      // Phones keep focus on the card (its title, while the press's line with Undo shows): the talk bar's box would bring
      // the keyboard up unasked.
      else if (phone) window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-card-title]')?.focus({ preventScroll: true }));
      else window.requestAnimationFrame(onEmpty);
    },
    refused: (key) => {
      setCursor({ key, at: index });
      setGoal({ kind: 'line', id: key });
    },
    // Undone, the item is back: the card shows it again with focus on its first answer.
    undone: (key) => {
      setCursor({ key, at: index });
      setGoal({ kind: 'first', id: key });
    },
    box: (key) => setGoal({ kind: 'box', id: key }),
  };

  if (empty) return null;
  const go = (step: 'next' | 'skip') => {
    if (!current || total < 2) return;
    if (step === 'next') {
      const next = entries[(index + 1) % total];
      setCursor({ key: next?.key ?? null, at: (index + 1) % total });
      if (next) setGoal({ kind: 'line', id: next.key });
      return;
    }
    // Skipped, it goes to the end, and the same place shows the one after it (or the first, from the end).
    const next = index >= total - 1 ? entries[0] : entries[index + 1];
    setSkipped((s) => [...s.filter((k) => k !== current.key), current.key]);
    setCursor({ key: next?.key ?? null, at: index >= total - 1 ? 0 : index });
    if (next) setGoal({ kind: 'line', id: next.key });
  };

  return (
    <section
      ref={root}
      className={`inbox-card${phone ? ' inbox-card--sheet' : ''}`}
      aria-labelledby={`${id}-title`}
      data-inbox-card
      onFocus={() => {
        hadFocus.current = true;
      }}
    >
      <header className="inbox-card__head">
        <h2 id={`${id}-title`} className="inbox-card__title" tabIndex={-1} data-card-title>
          Needs you
        </h2>
        {current && (
          <p className="inbox-card__count">
            {index + 1} of {total}
          </p>
        )}
      </header>
      {slot && (
        <div className="inbox-card__pressed">
          <InboxItem item={slot.item} view={slot.view as Exclude<typeof slot.view, { kind: 'open' }>} company={company} companyId={companyId} now={now} online={online} navigate={navigate} announce={announce} store={store} state={state} focus={focus} surface="inbox" />
        </div>
      )}
      {current && (
        <div key={current.key} className="inbox-card__body">
          {current.kind === 'item' ? (
            <InboxItem item={current.item} view={{ kind: 'open', refusal: openRefusal(view.needs, current.item) }} company={company} companyId={companyId} now={now} online={online} navigate={navigate} announce={announce} store={store} state={state} focus={focus} surface="inbox" />
          ) : (
            <div className="inbox-item inbox-item--open inbox-card__waits">
              <p className="inbox-item__who" data-item-line={current.key} tabIndex={-1}>
                {current.text}
              </p>
              <CompanyLink companyId={companyId} to={current.kind} navigate={navigate} className="button button--primary" focusKey={`card:${current.kind}`}>
                {current.kind === 'proposal' ? 'Open the proposal' : 'Open the plan'}
              </CompanyLink>
            </div>
          )}
        </div>
      )}
      {/* After the item in the Tab order: its words and answers come first, then where to go from it. */}
      <nav className="inbox-card__foot" aria-label="More that needs you">
        {total > 1 && (
          <>
            <button type="button" className="inbox-card__key" onClick={() => go('next')} aria-label={`Next, ${((index + 1) % total) + 1} of ${total}`}>
              Next
            </button>
            <button type="button" className="inbox-card__key" onClick={() => go('skip')} aria-label="Skip, ask me later">
              Skip
            </button>
          </>
        )}
        <span className="inbox-card__gap" aria-hidden="true" />
        <button type="button" className="inbox-card__key inbox-card__key--all" onClick={onSeeAll}>
          See all
        </button>
      </nav>
    </section>
  );
}

const findItem = (questions: TabProps['company']['questions'], approvals: TabProps['company']['approvals'], key: string): Item | undefined =>
  [...questions.map((question) => ({ kind: 'question' as const, question })), ...approvals.map((approval) => ({ kind: 'approval' as const, approval }))].find((i) => itemId(i) === key);

function openRefusal(needs: ReturnType<typeof inboxView>['needs'], item: Item): string | null {
  const found = needs.find((n) => itemId(n.item) === itemId(item));
  return found?.view.kind === 'open' ? found.view.refusal : null;
}
