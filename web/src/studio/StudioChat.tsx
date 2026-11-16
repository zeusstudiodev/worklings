// The studio chat (SPEC-v0.3.md, S2 and S3): the lobby's own conversation, over every company. It asks and relays and
// never decides; the stakeholder's lines, its answers with what each cost, what it asked the CEOs and each CEO's answer
// in that company's words, and a box to write in. The top of the granularity: studio chat, portfolio, company, person.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { STUDIO_MODELS, studioBudgetSentence, type StudioModel, type StudioView } from '../../../src/studio/model.ts';
import { coarseAge } from '../../../src/core/now.ts';
import { companyPath, navigate } from '../company/router.ts';
import { dollars } from '../lib/format.ts';
import type { StudioActions } from './studioApi.ts';
import { costWords, entryLead, entryNews, MODEL_WORDS, readBudget, STARTERS, studioBudgetSpent, studioSpendWords, waitingWords } from './studioModel.ts';
import './studio.css';

interface StudioChatProps {
  studio: StudioView;
  actions: StudioActions;
  online: boolean;
  now: number;
  announce: (text: string) => void;
  onBack: () => void;
}

const MAX = 4_000;

export function StudioChat({ studio, actions, online, now, announce, onBack }: StudioChatProps) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLLIElement>(null);
  const busy = studio.state === 'thinking' || studio.state === 'starting';
  const seen = useRef(new Set(studio.entries.map((e) => e.id)));

  // New lines are read out once, and the log follows them.
  useEffect(() => {
    let fresh = false;
    for (const e of studio.entries) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      fresh = true;
      const news = entryNews(e);
      if (news) announce(news);
    }
    if (fresh) end.current?.scrollIntoView({ block: 'nearest' });
  }, [studio.entries, announce]);

  const spent = studioBudgetSpent(studio);
  const blocked = !online ? 'Sending waits until the office is back. Your words stay.' : busy ? 'The studio chat is still answering.' : spent ? studioBudgetSentence(studio.budget) : null;
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || blocked || sending) return;
    if (text.length > MAX) {
      setProblem(`${text.length.toLocaleString('en-US')} of ${MAX.toLocaleString('en-US')}. Shorten it by ${(text.length - MAX).toLocaleString('en-US')} to send.`);
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      await actions.say(text);
      setDraft('');
    } catch (error) {
      setProblem(`Couldn't send: ${error instanceof Error ? error.message : 'the office said no'}`);
    } finally {
      setSending(false);
      box.current?.focus();
    }
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };
  const act = (what: () => Promise<void>, done: string, failed: string) => {
    if (!online) return;
    what().then(
      () => announce(done),
      (error: unknown) => setProblem(`${failed} ${error instanceof Error ? error.message : ''}`.trim()),
    );
  };
  const waiting = waitingWords(studio.waiting);
  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    if (budgetDraft === null) return;
    const read = readBudget(budgetDraft);
    if (!read.ok || read.value === null) {
      setProblem(read.ok ? 'Give the studio chat a budget, in dollars.' : read.why.replace(', or empty for none', ''));
      return;
    }
    const value = read.value;
    act(
      async () => {
        await actions.setBudget(value);
        setBudgetDraft(null);
        setProblem(null);
      },
      `The studio chat's budget is ${dollars(value)} now.`,
      "Couldn't change the budget.",
    );
  };

  return (
    <section className="studio" aria-labelledby={`${id}-title`}>
      <button type="button" className="panel-back" onClick={onBack}>
        Back to the lobby
      </button>
      <h2 id={`${id}-title`} className="panel-title" tabIndex={-1} data-panel-heading>
        Studio chat
      </h2>
      <p className="studio__intro">Ask across every company. It reads them and asks their CEOs; it never approves or changes anything, and tells you where to click instead.</p>
      <div className="studio__meta">
        <label className="studio__model">
          <span>Runs on</span>
          <select
            className="text-input studio__select"
            value={studio.model}
            disabled={!online || busy}
            onChange={(e) => {
              const model = e.target.value as StudioModel;
              act(() => actions.setModel(model), `The studio chat runs on ${MODEL_WORDS[model]} now.`, "Couldn't change the model.");
            }}
          >
            {STUDIO_MODELS.map((m) => (
              <option key={m} value={m}>
                {MODEL_WORDS[m]}
              </option>
            ))}
          </select>
        </label>
        <span className="studio__spent" title="What the studio chat has spent, API-equivalent. The CEOs' answers count in their own companies.">
          {studioSpendWords(studio)}
        </span>
        <form className="studio__budget" onSubmit={saveBudget}>
          <label>
            <span>Budget, in dollars</span>
            <input
              className="text-input studio__budget-input"
              inputMode="decimal"
              value={budgetDraft ?? studio.budget.toFixed(2)}
              disabled={!online}
              onChange={(e) => setBudgetDraft(e.target.value)}
            />
          </label>
          {budgetDraft !== null && (
            <button type="submit" className="link" aria-disabled={!online || undefined}>
              Set budget
            </button>
          )}
        </form>
        {studio.entries.length > 0 && (
          <button type="button" className="link" aria-disabled={!online || busy || undefined} onClick={() => !busy && act(() => actions.clear(), 'A new conversation.', "Couldn't start over.")}>
            New conversation
          </button>
        )}
      </div>

      {studio.entries.length === 0 ? (
        <div className="studio__empty">
          <p>Nothing said yet. Try:</p>
          <ul className="studio__starters">
            {STARTERS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="button studio__starter"
                  onClick={() => {
                    setDraft(s);
                    box.current?.focus();
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="studio__log" aria-label="Conversation">
          {studio.entries.map((e) => (
            <li key={e.id} className={`studio-line studio-line--${e.kind}`}>
              <p className="studio-line__lead">
                {entryLead(e)}
                {e.kind === 'relay' ? ':' : ''}
                <span className="studio-line__age"> {coarseAge(Math.max(0, now - e.at))}</span>
              </p>
              <p className="studio-line__text">{e.kind === 'relay' ? `“${e.text}”` : e.text}</p>
              {e.kind === 'studio' && <p className="studio-line__cost">{costWords(e.cost)}</p>}
              {e.kind === 'reply' && e.companies?.[0] && (
                <a
                  className="link studio-line__open"
                  href={companyPath(e.companies[0].id, 'progress')}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    navigate(companyPath(e.companies?.[0]?.id ?? '', 'progress'));
                  }}
                >
                  Open {e.companies[0].name}
                </a>
              )}
            </li>
          ))}
          <li ref={end} className="studio__end" aria-hidden="true" />
        </ol>
      )}

      {busy && (
        <div className="studio__thinking" role="status">
          <span>Thinking…</span>
          <button type="button" className="button" aria-disabled={!online || undefined} onClick={() => act(() => actions.stop(), 'Stopped.', "Couldn't stop it.")}>
            Stop
          </button>
        </div>
      )}
      {waiting && <p className="studio__waiting">{waiting}</p>}
      {studio.problem && studio.state === 'failed' && <p className="settings__problem">{studio.problem}</p>}

      <form className="studio__compose" onSubmit={(e) => void send(e)}>
        <label className="visually-hidden" htmlFor={`${id}-box`}>
          Message the studio chat
        </label>
        <textarea
          id={`${id}-box`}
          ref={box}
          className="text-input studio__box"
          rows={2}
          value={draft}
          placeholder="Ask across your companies"
          aria-describedby={`${id}-hint`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="button button--primary studio__send" aria-disabled={blocked !== null || draft.trim() === '' || sending || undefined}>
          Send
        </button>
        <p id={`${id}-hint`} className="studio__hint">
          {problem ?? blocked ?? 'Enter sends, Shift+Enter starts a new line. Each answer shows what it cost.'}
        </p>
      </form>
    </section>
  );
}
