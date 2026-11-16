// A company in the lobby (SPEC-v0.2.md, "Simple, visible, proven", 1; docs/design-v3.md, "Lobby"): its TL;DR before you
// go in, written by code from the board, the ledger and the log. The name and the stage in a word, the goal in your
// words, how far along it is, what needs you, what it finished, who works on what, the money against the budget and
// when it last moved. One button, a rich row in the panel's sheet, that lands on the company's progress. A company the
// hub can't summarise (one that can't run) keeps the row it had.
import type { CSSProperties } from 'react';
import type { LobbyCompany } from '../../../../src/core/company.ts';
import type { LobbyRow } from '../model.ts';
import { Count } from '../ui/Count.tsx';
import { StatePill } from '../ui/StatePill.tsx';
import { THEME_SWATCH, ThemeStill } from '../ui/ThemeStill.tsx';
import { cardLines, moreWords, needsWords, shortenPaths } from './lobbyModel.ts';

interface LobbyCardProps {
  entry: LobbyCompany;
  row: LobbyRow;
  /** Its name told apart from others of the same name ("Plant Pal in plant-phone"). */
  unique: string;
  phone: boolean;
  now: number;
  /** Every company's folder, so a path in a sentence is cut in the middle. */
  roots: readonly string[];
  onOpen: () => void;
}

export function LobbyCard({ entry, row, unique, phone, now, roots, onOpen }: LobbyCardProps) {
  const hue = { '--hue': THEME_SWATCH[entry.theme]?.mark ?? '#6b7a73' } as CSSProperties;
  const mark = phone ? <ThemeStill theme={entry.theme} /> : <span className="row__marker lobby-row__marker" aria-hidden="true" />;
  // The name, and what a screen reader needs to tell it apart and to know what waits, lead the button's words.
  const name = (
    <span className="row__title lobby-row__name">
      {row.name}
      <span className="visually-hidden">
        {unique.slice(row.name.length)}
        {needsWords(row.needsYou)}.{' '}
      </span>
    </span>
  );

  if (!entry.summary) {
    return (
      <button type="button" className="row lobby-row__button" data-focus={`company-${row.id}`} onClick={onOpen} style={hue}>
        {mark}
        <span className="row__main">
          {name}
          <span className="lobby-row__folder" title={entry.root} aria-hidden="true">
            {row.folder}
          </span>
          <span className={`lobby-row__state lobby-row__state--${row.state.tone}`}>{shortenPaths(row.state.sentence, roots)} </span>
          {row.latest && <span className="lobby-row__latest">{row.latest} </span>}
        </span>
        <span className="lobby-row__side">
          <Count n={row.needsYou} label="" />
          <span className="lobby-row__spent">{row.spent}</span>
        </span>
      </button>
    );
  }

  const card = cardLines(entry.summary, now);
  const share = card.progress.share;
  return (
    <button type="button" className="row lobby-row__button lobby-card" data-focus={`company-${row.id}`} onClick={onOpen} style={hue}>
      {mark}
      <span className="row__main lobby-card__main">
        <span className="lobby-card__top">
          {name}
          <StatePill label={card.stage.word} tone={card.stage.tone} />
        </span>
        {card.goal && <span className="lobby-card__goal">“{card.goal}”</span>}
        <span className="lobby-card__progress">
          <span className="lobby-card__figures">{card.progress.line}. </span>
          {share !== null && (
            <span className="lobby-card__bar" aria-hidden="true">
              <span style={{ '--share': `${(share * 100).toFixed(1)}%` } as CSSProperties} />
            </span>
          )}
        </span>
        {card.needs.first && (
          <span className="lobby-card__needs">
            <Count n={card.needs.count} label="" />
            <span className="lobby-card__needs-text">{card.needs.first} </span>
          </span>
        )}
        {card.finished.length > 0 && (
          <span className="lobby-card__line">
            <span className="lobby-card__key">Finished: </span>
            {card.finished.map((f, i) => (
              <span key={`${i}:${f}`} className="lobby-card__item">
                {f}
                {i < card.finished.length - 1 ? '; ' : '. '}
              </span>
            ))}
          </span>
        )}
        {card.now.length > 0 && (
          <span className="lobby-card__line">
            <span className="lobby-card__key">Now: </span>
            {card.now.join(', ')}
            {card.nowMore > 0 ? ` ${moreWords(card.nowMore)}` : ''}.{' '}
          </span>
        )}
        {card.checklist && (
          <span className="lobby-card__line">
            <span className="lobby-card__key">Checklist: </span>
            {card.checklist}.{' '}
          </span>
        )}
        <span className="lobby-card__foot">
          <span className="lobby-card__money">{card.spend}. </span>
          {card.moved && <span className="lobby-card__moved">{card.moved}.</span>}
        </span>
      </span>
    </button>
  );
}
