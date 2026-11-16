// The model itself. A company's office (v3) is built in its theme by office/CompanyOffice.tsx; a studio the office only
// watches keeps v2's model (office/studio.ts): base board, rooms with cut-away walls, the lobby, the lead's office and
// the gates.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo } from 'react';
import type { Theme } from '../../../src/core/looks.ts';
import { GateArch } from './Furniture.tsx';
import { useFixedAnchor } from './labels.tsx';
import type { Layout, Rect } from './layout.ts';
import { WALL_HEIGHT } from './layout.ts';
import { type Clock, CompanyOffice, type OfficeMoments } from './office/CompanyOffice.tsx';
import { buildStudio } from './office/studio.ts';
import { HIGHLIGHTER } from './palette.ts';
import { useStaticChange } from './Stage.tsx';

export type Selection =
  | { kind: 'role'; id: string }
  | { kind: 'agent'; key: string }
  | { kind: 'room'; id: string; rule?: string }
  | null;

interface BuildingProps {
  layout: Layout;
  /** Role ids whose person is working right now: their monitors and desk lamps are on. */
  litDesks: Set<string>;
  /** v3: role ids whose desk is open between steps: their monitors are dim. */
  dimDesks?: ReadonlySet<string>;
  /** v3: the office's theme (studio.yaml's office.theme); rooms with their own theme keep it. */
  theme?: Theme;
  /** v3: studio.yaml's office.decor, catalogue ids the office places; others are skipped. */
  decor?: readonly string[];
  /**
   * v3: the moments' rooms building in and going, desks dropping in and the org board's pins (useCast's `props`), on
   * the scene clock (useCast's `clock`). Without them the board shows the org from the floor plan and nothing moves.
   */
  moments?: OfficeMoments | null;
  clock?: Clock | null;
  runningGates: Set<string>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

const NONE: ReadonlySet<string> = new Set();
const NO_DECOR: readonly string[] = [];

export function Building(props: BuildingProps) {
  return props.layout.office ? <CompanyBuilding {...props} /> : <StudioBuilding {...props} />;
}

/** A company's office in its theme, and the gates in front of its rooms. */
function CompanyBuilding({ layout, litDesks, dimDesks = NONE, theme = 'office', decor = NO_DECOR, moments = null, clock = null, runningGates, selection, onSelect }: BuildingProps) {
  const selectedRoom = selection?.kind === 'room' ? selection.id : null;
  const onSelectRoom = useCallback((id: string | null) => onSelect(id ? { kind: 'room', id } : null), [onSelect]);
  return (
    <group>
      <CompanyOffice layout={layout} theme={theme} decor={decor} lit={litDesks} dim={dimDesks} selectedRoom={selectedRoom} onSelectRoom={onSelectRoom} moments={moments} clock={clock} />
      {layout.gates.map((g) => (
        <GateArch key={g.id} id={g.id} x={g.x} z={g.z} running={runningGates.has(g.id)} onClick={stop(() => onSelect({ kind: 'room', id: g.from }))} />
      ))}
    </group>
  );
}

/** Where a room's sign hangs: above the back-left corner. */
export const signPoint = (r: Rect): [number, number, number] => [r.x + 0.5, WALL_HEIGHT + 0.45, r.z + 0.3];

function SignAnchor({ id, r }: { id: string; r: Rect }) {
  const [x, y, z] = signPoint(r);
  useFixedAnchor(`room:${id}`, x, y, z);
  return null;
}

const stop = (fn: () => void) => (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  fn();
};

function PosterAnchor({ id, x, z }: { id: string; x: number; z: number }) {
  useFixedAnchor(`poster:${id}`, x, 0.45, z + 0.05);
  return null;
}

/**
 * v2's model of a studio the office only watches: base board, rooms with cut-away walls, desks and chairs in each
 * room's colour, rule posters, the lobby and the lead's office, merged into three meshes (office/studio.ts), and the
 * gates. A click selects the room it lands in (a poster: the room and its rule); the lobby, the lead's office and the
 * board around them clear the selection.
 */
function StudioBuilding({ layout, litDesks, runningGates, selection, onSelect }: BuildingProps) {
  const invalidate = useThree((s) => s.invalidate);
  const staticChange = useStaticChange();
  const build = useMemo(() => buildStudio(layout), [layout]);
  useEffect(() => {
    staticChange();
    invalidate();
    return () => build.dispose();
  }, [build, staticChange, invalidate]);
  useEffect(() => {
    if (build.setLit((desk) => litDesks.has(desk))) invalidate();
  }, [build, litDesks, invalidate]);
  const selectedRoom = selection?.kind === 'room' ? selection.id : null;
  useEffect(() => {
    if (build.select(selectedRoom)) invalidate();
  }, [build, selectedRoom, invalidate]);
  const room = selectedRoom ? layout.rooms.find((r) => r.id === selectedRoom) : undefined;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hit = build.pick(e.point);
    if (hit?.kind === 'poster') onSelect({ kind: 'room', id: hit.room, rule: hit.rule });
    else if (hit?.kind === 'room') onSelect({ kind: 'room', id: hit.room });
    else onSelect(null);
  };
  return (
    <group>
      <primitive object={build.group} onClick={click} />
      {room && (
        <mesh position={[room.x + room.w / 2, 0.07, room.z + room.d / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[room.w - 0.3, room.d - 0.3]} />
          <meshBasicMaterial color={HIGHLIGHTER} transparent opacity={0.18} />
        </mesh>
      )}
      {layout.rooms.map((r) => (
        <SignAnchor key={r.id} id={r.id} r={r} />
      ))}
      {layout.rooms.flatMap((r) => r.posters.map((p) => <PosterAnchor key={p.ruleId} id={p.ruleId} x={p.x} z={p.z + 0.12} />))}
      <SignAnchor id="lobby" r={layout.lobby} />
      {/* At the back corner away from the lobby, clear of the meetings at the lead's desk. */}
      <SignAnchor id="lead" r={{ ...layout.lead, x: layout.lead.x + layout.lead.w - 2.1 }} />
      {layout.gates.map((g) => (
        <GateArch key={g.id} id={g.id} x={g.x} z={g.z} running={runningGates.has(g.id)} onClick={stop(() => onSelect({ kind: 'room', id: g.from }))} />
      ))}
    </group>
  );
}
