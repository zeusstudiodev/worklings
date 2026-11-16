// The org chart on a phone (docs/design-v3.md, "The org chart", Phones; design-hud, Phones): People's outline as the
// tree, the same pattern as the chart (a flat list of `treeitem`s with their level, set size, position and
// `aria-expanded`, one tab stop, the tree's keys). Rows of badge paper, a level in per manager on elbows; a manager opens
// and closes, a closed one reading "Theo, head of engineering, and 7 more" with the count of who needs you under them; a
// row opens the person's sheet. No pan or zoom; a paper marks the row it reaches.
import { type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { orgLayout, type OrgMember } from './orgLayout.ts';
import type { Relay } from './orgModel.ts';

export interface OutlineItem {
  id: string;
  name: string;
  hue: string | null;
  label: string;
  description?: string;
  /** The row's content, with "From Ada" for a moment after a paper reached them. */
  render: (mark: string | null) => ReactNode;
  open?: boolean;
  dim?: boolean;
  /** "Theo, head of engineering, and 7 more", for a closed manager. */
  closedLine?: string;
}

export interface OutlineApi {
  relay(relays: readonly Relay[]): void;
  reveal(id: string, focus?: boolean): void;
}

interface OutlineProps {
  label: string;
  members: readonly OrgMember[];
  items: ReadonlyMap<string, OutlineItem>;
  folded: ReadonlySet<string>;
  onFold: (id: string, folded: boolean) => void;
  onOpen: (id: string) => void;
  foldNeeds: (id: string) => number;
  apiRef: RefObject<OutlineApi | null>;
  after?: ReactNode;
}

const MARK_MS = 4000;

export function Outline({ label, members, items, folded, onFold, onOpen, foldNeeds, apiRef, after }: OutlineProps) {
  const tree = useMemo(() => orgLayout(members, { zoom: 1, folded }), [members, folded]);
  const rows = tree.nodes;
  const [active, setActive] = useState<string | null>(null);
  const current = active !== null && rows.some((r) => r.id === active) ? active : (rows[0]?.id ?? null);
  const [marks, setMarks] = useState<ReadonlyMap<string, string>>(() => new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ rows, items, members });
  useLayoutEffect(() => {
    latest.current = { rows, items, members };
  });

  const focusRow = (id: string) => {
    setActive(id);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(id)}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  };

  useLayoutEffect(() => {
    apiRef.current = {
      reveal: (id, focus) => {
        if (focus) focusRow(id);
        else listRef.current?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
      },
      relay: (relays) => {
        const { rows: shown, items: all, members: ms } = latest.current;
        const marked = new Map<string, string>();
        for (const r of relays) {
          // The row it reaches: theirs, or their manager's while they are folded away.
          let at: string | null = r.to;
          const guard = new Set<string>();
          while (at !== null && !shown.some((x) => x.id === at) && !guard.has(at)) {
            guard.add(at);
            at = ms.find((m) => m.id === at)?.reportsTo ?? null;
          }
          if (at === null) continue;
          marked.set(at, r.from === '@you' ? 'From you' : `From ${all.get(r.from)?.name ?? 'a colleague'}`);
        }
        if (marked.size === 0) return;
        setMarks((was) => new Map([...was, ...marked]));
        window.setTimeout(() => setMarks((was) => new Map([...was].filter(([id]) => !marked.has(id)))), MARK_MS);
      },
    };
  });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (current === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = rows.findIndex((r) => r.id === current);
    const r = rows[i];
    if (!r) return;
    const go = (id: string | undefined) => {
      if (id === undefined) return;
      e.preventDefault();
      focusRow(id);
    };
    switch (e.key) {
      case 'ArrowDown':
        go(rows[i + 1]?.id);
        return;
      case 'ArrowUp':
        go(rows[i - 1]?.id);
        return;
      case 'Home':
        go(rows[0]?.id);
        return;
      case 'End':
        go(rows.at(-1)?.id);
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (r.manages && r.folded) onFold(r.id, false);
        else if (r.manages) go(rows.find((x) => x.parent === r.id)?.id);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (r.manages && !r.folded) onFold(r.id, true);
        else if (r.parent !== null) go(r.parent);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpen(r.id);
    }
  };

  return (
    <div className="org-outline" data-tb-vscroll>
      <div ref={listRef} className="org-outline__tree" role="tree" aria-label={label} onKeyDown={onKey}>
        {rows.map((r) => {
          const item = items.get(r.id);
          if (!item) return null;
          const closed = r.manages && r.folded;
          const needs = closed ? foldNeeds(r.id) : 0;
          return (
            <div
              key={r.id}
              role="treeitem"
              data-org-node={r.id}
              data-hue={item.hue ?? undefined}
              className={`org-row${item.open ? ' is-open' : ''}${item.dim ? ' is-dim' : ''}${closed ? ' org-row--closed' : ''}`}
              style={{ '--depth': r.level - 1 } as CSSProperties}
              tabIndex={r.id === current ? 0 : -1}
              aria-level={r.level}
              aria-setsize={r.setsize}
              aria-posinset={r.posinset}
              aria-expanded={r.manages ? !r.folded : undefined}
              aria-selected={item.open ? true : undefined}
              aria-label={closed && item.closedLine ? `${item.closedLine}${needs > 0 ? `, ${needs} ${needs === 1 ? 'needs' : 'need'} you` : ''}.` : item.label}
              aria-describedby={item.description ? `org-row-desc-${r.id}` : undefined}
              onFocus={() => setActive(r.id)}
              onClick={() => {
                setActive(r.id);
                if (closed) onFold(r.id, false);
                else onOpen(r.id);
              }}
            >
              {r.manages && (
                <button
                  type="button"
                  className="org-row__toggle"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFold(r.id, !r.folded);
                  }}
                >
                  <svg viewBox="0 0 20 20">
                    <path d={r.folded ? 'M8 5l5 5-5 5' : 'M5 8l5 5 5-5'} />
                  </svg>
                </button>
              )}
              {closed ? (
                <span className="org-row__closed">
                  <span className="org-row__closed-line">{item.closedLine}</span>
                  {needs > 0 && <span className="org-row__needs">{needs}</span>}
                </span>
              ) : (
                item.render(marks.get(r.id) ?? null)
              )}
              {item.description && (
                <span id={`org-row-desc-${r.id}`} hidden>
                  {item.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {after}
    </div>
  );
}
