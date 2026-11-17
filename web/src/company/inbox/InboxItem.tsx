// One question or approval, as the inbox and the feed both draw it (docs/design-v3.md, "Inbox" and "Answering inline"):
// its words, its answers, "Answer in your own words", "Show the command", and after a press the one line with Undo. It
// presses through the company's answer store (answers.ts), so what one surface shows the other shows too. Each surface
// brings its own focus: the inbox moves on to the next item, the feed gives a pressed answer's Undo the focus.
import { type FormEvent, type RefObject, useId, useLayoutEffect, useRef } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { useMediaQuery } from '../../lib/hooks.ts';
import { possessive } from '../people/peopleModel.ts';
import { boxCount } from '../person/personModel.ts';
import { Clamp, CompanyLink, CopyButton } from '../people/shared.tsx';
import type { TabProps } from '../types.ts';
import { ChoiceButton } from '../ui/ChoiceButton.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';
import type { AnswersState, AnswerStore } from './answers.ts';
import { adviceLines, ifNoAnswer } from './asksModel.ts';
import {
  type Answer,
  approvalLines,
  askerCalled,
  type Item,
  itemId,
  itemPerson,
  type ItemView,
  messageLabel,
  OWN_WORDS_MAX,
  questionLines,
  youAnsweredLine,
} from './inboxModel.ts';

/** Where focus goes after the next render: an item's first line, its first answer, its own-words box, or the count line. */
export type FocusTarget = { kind: 'line' | 'first' | 'box' | 'why'; id: string } | { kind: 'count' };

/** Moves focus to `goal` inside `root` once the page shows it. Returns the setter. */
export function useFocusGoal(root: RefObject<HTMLElement | null>): (goal: FocusTarget | null) => void {
  const goalRef = useRef<FocusTarget | null>(null);
  useLayoutEffect(() => {
    const goal = goalRef.current;
    const el = root.current;
    if (!goal || !el) return;
    const selector =
      goal.kind === 'count' ? '[data-needs-count]'
        : goal.kind === 'line' ? `[data-item-line="${CSS.escape(goal.id)}"]`
          : goal.kind === 'first' ? `[data-first-answer="${CSS.escape(goal.id)}"]`
            : goal.kind === 'why' ? `[data-why-box="${CSS.escape(goal.id)}"]`
              : `[data-own-box="${CSS.escape(goal.id)}"]`;
    const found = el.querySelector<HTMLElement>(selector);
    if (!found) return;
    goalRef.current = null;
    found.focus({ preventScroll: true });
    found.scrollIntoView({ block: 'nearest' });
  });
  return (goal) => {
    goalRef.current = goal;
  };
}

/** What a surface does about focus at each step of an answer. */
export interface ItemFocus {
  pressed(itemKey: string, answer: Answer): void;
  refused(itemKey: string): void;
  undone(itemKey: string): void;
  box(itemKey: string): void;
}

export type ShownView = Exclude<ItemView, { kind: 'answered' } | { kind: 'hidden' }>;

interface Props {
  item: Item;
  view: ShownView;
  company: CompanyView;
  companyId: string;
  now: number;
  online: boolean;
  navigate: TabProps['navigate'];
  announce: TabProps['announce'];
  store: AnswerStore;
  state: AnswersState;
  focus: ItemFocus;
  /** The inbox is the side panel's list; the feed's item sits under a line that says who asks. */
  surface: 'inbox' | 'feed';
  /** Phones in the side panel: the sheet takes the full height while someone types. */
  onTyping?: (typing: boolean) => void;
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function InboxItem({ item, view, company, companyId, now, online, navigate, announce, store, state, focus, surface, onTyping }: Props) {
  const id = useId();
  const phone = useMediaQuery('(max-width: 720px)');
  const itemKey = itemId(item);
  const inbox = surface === 'inbox';
  const typingProps = onTyping ? { onFocus: () => phone && onTyping(true), onBlur: () => phone && onTyping(false) } : {};

  const submit = (answer: Answer) => {
    if (!online || store.isPending(itemKey)) return;
    focus.pressed(itemKey, answer);
    store.submit(item, answer, { refused: () => focus.refused(itemKey) });
  };
  const undo = () => void store.undo(item, { undone: () => focus.undone(itemKey) });

  const messageLink = () => {
    const person = itemPerson(company, item);
    const label = messageLabel(company, item);
    return (
      person !== null &&
      label !== null && (
        <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(person)}/message`} navigate={navigate} className="link inbox-item__message" focusKey={`inbox:message:${itemKey}`}>
          {label}
        </CompanyLink>
      )
    );
  };

  const taskLink = (task: { id: string; title: string } | null) =>
    task && (
      <p className="inbox-item__for">
        For:{' '}
        <CompanyLink companyId={companyId} to={`tasks/${encodeURIComponent(task.id)}`} navigate={navigate} className="link" focusKey={`inbox:task:${task.id}`}>
          {task.title}
        </CompanyLink>
      </p>
    );

  const whyBox = () => {
    const why = state.whys[itemKey];
    const who = askerCalled(company, item);
    if (why?.state === 'sent') return <p className="inbox-item__after-note">{why.via === 'decision' ? `${cap(who)} gets your reason with the no.` : `${cap(who)} gets your reason as a message.`}</p>;
    const boxId = `${id}-why`;
    const onSubmit = (e: FormEvent) => {
      e.preventDefault();
      void store.sendWhy(item);
    };
    return (
      <form className="inbox-why" onSubmit={onSubmit}>
        <label className="inbox-why__label" htmlFor={boxId}>
          Tell {who} why (optional)
        </label>
        <textarea
          id={boxId}
          className="inbox-box"
          rows={2}
          data-why-box={itemKey}
          value={why?.text ?? ''}
          aria-describedby={why?.error ? `${boxId}-error` : undefined}
          onChange={(e) => store.setWhy(itemKey, { text: e.target.value, state: why?.state === 'failed' ? 'editing' : (why?.state ?? 'editing') })}
          {...typingProps}
        />
        {why?.error && (
          <p id={`${boxId}-error`} className="inbox-item__refusal">
            Couldn't send your reason. {why.error}
          </p>
        )}
        <button type="submit" className="button" aria-disabled={!online || !(why?.text ?? '').trim() || why?.state === 'sending' || undefined}>
          {why?.state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </form>
    );
  };

  if (view.kind !== 'open') {
    const press = Object.hasOwn(state.presses, itemKey) ? state.presses[itemKey] : undefined;
    const answer = item.kind === 'question' ? item.question.answer : item.approval.answer;
    // The feed says it as a line of its own: "You answered 15-minute windows at 14:07."
    const text = !inbox && view.kind === 'done' && press && answer ? youAnsweredLine(item, press.answer, answer.at) : view.text;
    return (
      <div className={`inbox-item inbox-item--${view.kind}${inbox ? '' : ' inbox-item--feed'}`}>
        {/* In the inbox the line itself takes focus when it opens on this item. */}
        <div className="inbox-item__line" data-item-line={inbox ? itemKey : undefined} tabIndex={inbox ? -1 : undefined}>
          {view.kind === 'pending' ? (
            <UndoLine
              text={view.text}
              until={view.until}
              onUndo={undo}
              unavailable={!online || press?.state === 'undoing'}
              ref={(el) => {
                // The feed: a pressed answer's Undo has the focus, so the keyboard can take it back at once.
                if (el && store.takeUndoFocus(itemKey)) el.focus({ preventScroll: true });
              }}
            />
          ) : (
            <p className="inbox-item__after">
              <span className="inbox-item__mark" aria-hidden="true" />
              {text}
            </p>
          )}
        </div>
        {(view.kind === 'pending' || view.kind === 'done') && view.denial && whyBox()}
        {(view.kind === 'elsewhere' || view.kind === 'gone') && messageLink()}
      </div>
    );
  }

  if (item.kind === 'question') {
    const lines = questionLines(company, item.question, now);
    const boxId = `${id}-own`;
    const text = state.own[itemKey] ?? '';
    const count = boxCount(text, OWN_WORDS_MAX);
    const typing = state.ownOpen.has(itemKey);
    const sendOwn = (e: FormEvent) => {
      e.preventDefault();
      if (!text.trim() || count.over) return;
      if (!online || store.isPending(itemKey)) return;
      focus.pressed(itemKey, { kind: 'question', option: null, text: text.trim() });
      store.sendOwn(item, { refused: () => focus.refused(itemKey) });
    };
    return (
      <div className={`inbox-item inbox-item--open${inbox ? '' : ' inbox-item--feed'}`}>
        {inbox ? (
          <p className="inbox-item__who" data-item-line={itemKey} tabIndex={-1}>
            {lines.who}
          </p>
        ) : null}
        <p className="inbox-item__when">{lines.asked}</p>
        <Clamp text={lines.text} lines={4} className="inbox-item__question" />
        {taskLink(lines.task)}
        {view.refusal && <p className="inbox-item__refusal">{view.refusal}</p>}
        <div className="choices" role="group" aria-label={`Answers to ${possessive(askerCalled(company, item))} question`}>
          {lines.options.map((o, i) => (
            <ChoiceButton key={`${i}:${o.label}`} pick={o.pick} unavailable={!online} data-first-answer={i === 0 ? itemKey : undefined} onClick={() => submit({ kind: 'question', option: i, text: '' })}>
              {o.label}
            </ChoiceButton>
          ))}
        </div>
        {lines.why && <p className="question__why">{lines.why}</p>}
        {(() => {
          const ifNo = ifNoAnswer(company, item.question);
          return ifNo && <p className="inbox-item__note">{ifNo}</p>;
        })()}
        <div className="inbox-item__links">
          <button
            type="button"
            className="link"
            aria-expanded={typing}
            aria-controls={typing ? boxId : undefined}
            onClick={() => {
              if (store.toggleOwn(itemKey)) focus.box(itemKey);
            }}
          >
            {lines.asks ? 'Answer in your own words' : 'Reply in your own words'}
          </button>
          {messageLink()}
        </div>
        {typing && (
          <form className="inbox-own" onSubmit={sendOwn}>
            <label className="inbox-why__label" htmlFor={boxId}>
              {lines.asks ? 'Your answer' : 'Your reply'}
            </label>
            <textarea
              id={boxId}
              data-own-box={itemKey}
              className={`inbox-box${count.over ? ' is-over' : ''}`}
              rows={3}
              value={text}
              aria-invalid={count.over || undefined}
              aria-describedby={count.text ? `${boxId}-count` : undefined}
              onChange={(e) => store.setOwn(itemKey, e.target.value)}
              {...typingProps}
            />
            <div className="inbox-own__foot">
              {count.text && (
                <span id={`${boxId}-count`} className={`inbox-own__count${count.over ? ' is-over' : ''}`}>
                  {count.text}
                </span>
              )}
              <button type="submit" className="button button--primary" aria-disabled={!online || !text.trim() || count.over || undefined}>
                {lines.asks ? 'Send answer' : 'Send reply'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const lines = approvalLines(company, item.approval, now);
  const advice = adviceLines(company, item.approval);
  const decide = (decision: 'allow' | 'deny', always: boolean) => submit({ kind: 'approval', decision, always });
  const asks = `${id}-asks`;
  return (
    <div className={`inbox-item inbox-item--open${inbox ? '' : ' inbox-item--feed'}`}>
      {inbox ? (
        <p className="inbox-item__who" data-item-line={itemKey} tabIndex={-1}>
          {lines.who}
        </p>
      ) : (
        <p className="inbox-item__when">{lines.waiting}</p>
      )}
      <p id={asks} className="inbox-item__summary">
        {lines.summary}
      </p>
      {taskLink(lines.task)}
      {advice && (
        <p className="inbox-item__advice">
          <strong>{advice.recommend}</strong> {advice.why}
        </p>
      )}
      <details className="inbox-item__detail">
        <summary>{lines.detailLabel}</summary>
        <pre className="inbox-item__code">
          <code>{lines.detail}</code>
        </pre>
        <CopyButton text={lines.detail} what={lines.detailLabel === 'Show the path' ? 'the path' : 'the command'} announce={announce} />
      </details>
      {view.refusal && <p className="inbox-item__refusal">{view.refusal}</p>}
      <div className="inbox-item__decide">
        {/* Several items have these buttons: each is described by what it answers. */}
        <button type="button" className="button button--primary" data-first-answer={itemKey} aria-describedby={asks} aria-disabled={!online || undefined} onClick={() => online && decide('allow', false)}>
          Allow once
        </button>
        {lines.always && (
          <button type="button" className="button" aria-describedby={asks} aria-disabled={!online || undefined} onClick={() => online && decide('allow', true)}>
            Always allow
          </button>
        )}
        <button type="button" className="button" aria-describedby={asks} aria-disabled={!online || undefined} onClick={() => online && decide('deny', false)}>
          Deny
        </button>
      </div>
      {lines.always && <p className="inbox-item__note">{lines.always}</p>}
      <p className="inbox-item__note">{advice ? advice.ifNoAnswer : lines.expires}</p>
    </div>
  );
}
