// The proposal's chart (docs/design-v3.md, "The org chart", Before the start): the Org board before the company starts,
// on the same layout as the running company's (org/orgLayout.ts). Each node is the proposal's: name, title, model,
// "New role" when the CEO wrote it, and after a revision "Added" or "Changed: moved from Design"; a node opens its form
// in the side panel. Each head's column ends with "Add someone to Design" and the heads' row with "Add a room"; people
// the last revision took out are listed under the chart. Phones get the outline, with the Add buttons after it.
import { type RefObject, useMemo, useRef, useState } from 'react';
import type { BaseDepartment } from '../../../../src/core/departments.ts';
import type { OrgProposal, ProposedPerson } from '../../../../src/core/org.ts';
import { DEPARTMENT_HUE } from '../../scene/palette.ts';
import { Chart, type ChartApi, type ChartItem } from '../org/Chart.tsx';
import type { NodeForm } from '../org/orgLayout.ts';
import { chipLabels } from '../org/orgModel.ts';
import { Outline, type OutlineApi, type OutlineItem } from '../org/Outline.tsx';
import { Face } from '../ui/Face.tsx';
import type { ProposalChartValue } from './chartBridge.ts';
import { listed, MODEL_NAMES, named } from './model.ts';

/** The CEO wears v2's lead gold; everyone else their room's hue. */
export const CEO_HUE = '#C9B458';

export function roomHue(p: Pick<OrgProposal, 'rooms'>, room: string): string {
  const style = p.rooms.find((r) => r.id === room)?.style;
  return style ? DEPARTMENT_HUE[style as BaseDepartment] : '#8C948F';
}

interface Props {
  value: ProposalChartValue;
  phone: boolean;
  apiRef: RefObject<ChartApi | null>;
  onZoom: (zoom: number) => void;
  storageKey: string;
}

const NONE: ReadonlySet<string> = new Set();

export function ProposalChart({ value, phone, apiRef, onZoom, storageKey }: Props) {
  const { proposal, chart, selected, canEdit, onOpen, onAdd, onAddRoom } = value;
  const outlineRef = useRef<OutlineApi | null>(null);
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const folded = useMemo(() => new Set([...folds].filter(([, f]) => f).map(([id]) => id)), [folds]);
  const members = useMemo(() => proposal.people.map((p) => ({ id: p.id, reportsTo: p.reportsTo, level: p.level, room: p.room })), [proposal.people]);
  const labels = useMemo(() => chipLabels(proposal.people.map((p) => ({ id: p.id, name: p.name || p.title, title: p.title }))), [proposal.people]);
  const roomTitle = (room: string) => proposal.rooms.find((r) => r.id === room)?.title ?? room;
  const tags = new Map(chart.top.concat(chart.columns.flatMap((c) => c.cards)).map((c) => [c.person.id, c.tag]));

  const items = new Map<string, ChartItem>();
  const rows = new Map<string, OutlineItem>();
  for (const x of proposal.people) {
    const name = x.name || x.title;
    const style = proposal.rooms.find((r) => r.id === x.room)?.style ?? null;
    const tag = tags.get(x.id) ?? null;
    const model = MODEL_NAMES[x.model] ?? x.model;
    const label = [`${name}${x.name && x.name !== x.title ? `, ${x.title}` : ''}, ${roomTitle(x.room)}.`, `${model}.`, tag ? `${tag}.` : ''].filter(Boolean).join(' ');
    const shared = { id: x.id, name, hue: style, label, open: selected === x.id };
    items.set(x.id, { ...shared, render: (form) => <ProposedNode x={x} name={name} model={model} tag={tag} form={form} chip={labels.get(x.id) ?? name} hue={style} /> });
    rows.set(x.id, { ...shared, closedLine: name, render: () => <ProposedNode x={x} name={name} model={model} tag={tag} form="whole" chip={name} hue={style} /> });
  }
  const open = (id: string) => {
    if (canEdit) onOpen(id);
  };
  const onFold = (id: string, f: boolean) => setFolds((was) => new Map(was).set(id, f));
  const removed = chart.removed.length > 0 ? <p className="org-removed">Taken out: {listed(chart.removed.map(named))}.</p> : null;

  if (phone) {
    return (
      <Outline
        label="The proposal"
        members={members}
        items={rows}
        folded={folded}
        onFold={onFold}
        onOpen={open}
        foldNeeds={() => 0}
        apiRef={outlineRef}
        after={
          <>
            {canEdit && (
              <div className="org-outline__adds">
                {chart.columns.map((c) => (
                  <button key={c.room.id} type="button" className="org-add org-add--row" data-focus={`chart-add-${c.room.id}`} onClick={() => onAdd(c.room.id)}>
                    Add someone to {c.room.title}
                  </button>
                ))}
                <button type="button" className="org-add org-add--row" data-focus="chart-add-room" onClick={onAddRoom}>
                  Add a room
                </button>
              </div>
            )}
            {removed}
          </>
        }
      />
    );
  }
  return (
    <Chart
      label="The proposal"
      members={members}
      items={items}
      folded={folded.size > 0 ? folded : NONE}
      onFold={onFold}
      onOpen={open}
      onMenu={null}
      chipLabels={labels}
      storageKey={storageKey}
      apiRef={apiRef}
      onZoom={onZoom}
      roomTitle={roomTitle}
      foldOf={(id) => {
        const n = proposal.people.filter((p) => p.reportsTo === id).length;
        return { pill: `+${n}`, line: `${n} more under ${proposal.people.find((p) => p.id === id)?.name ?? 'them'}.`, needs: 0 };
      }}
      lostName={(id) => id}
      adds={canEdit ? { onAdd, onAddRoom } : null}
      after={removed}
    />
  );
}

/** The compact node's second line: the role (and "New role" or "Added" when there is one), the model only if neither. */
export function compactLine(x: Pick<ProposedPerson, 'title'>, name: string, tag: string | null, model: string): string {
  const title = x.title !== name ? x.title : null;
  return [title, tag].filter(Boolean).join('. ') || model;
}

function ProposedNode({ x, name, model, tag, form, chip, hue }: { x: ProposedPerson; name: string; model: string; tag: string | null; form: NodeForm; chip: string; hue: string | null }) {
  const face = (size: 20 | 28 | 32) => <Face of={{ kind: 'person', person: { id: x.id, name, look: {} }, hue }} size={size} />;
  if (form === 'chip') {
    return (
      <>
        <span className="org-node__face">{face(20)}</span>
        <span className="org-node__name">{chip}</span>
      </>
    );
  }
  if (form === 'compact') {
    return (
      <>
        {face(28)}
        <span className="org-node__id">
          <span className="org-node__name">{name}</span>
          <span className="org-node__title">{compactLine(x, name, tag, model)}</span>
        </span>
      </>
    );
  }
  return (
    <>
      {face(32)}
      <span className="org-node__id">
        <span className="org-node__name">{name}</span>
        {x.title !== name && <span className="org-node__title">{x.title}</span>}
      </span>
      <span className="org-node__nums">
        <span className="org-node__model">{model}</span>
      </span>
      <span className="org-node__now">{tag && <span className="org-tag">{tag}</span>}</span>
    </>
  );
}
