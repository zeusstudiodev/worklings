// One person's place in the scene: the group the crowd moves and draws their body into (people/crowd.ts), with what
// React keeps for them: the anchor their labels follow, an invisible capsule to click (and, for someone holding a paper
// for you, a box around the paper in their hands), the yellow ring when selected and, in an office that only watches,
// v2's yellow mark over someone who needs you.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { CastMember } from './cast.ts';
import { useObjectAnchor } from './labels.tsx';
import { HIGHLIGHTER } from './palette.ts';
import type { Crowd } from './people/crowd.ts';
import { PEOPLE_LAYER } from './people/rig.ts';

/** Where the paper in their hands is, in front of the chest, and the box that takes its clicks. */
const PAPER_AT: [number, number, number] = [0, 1.15, 0.45];
const PAPER_BOX: [number, number, number] = [0.8, 0.9, 0.5];

// The hit shapes' handlers keep their identity from one render to the next: R3F counts a new function as a changed
// prop and draws a frame for it, so inline ones drew one every time the office re-rendered (its clock ticks every 5 s).
const hover = (e: ThreeEvent<PointerEvent>) => {
  e.stopPropagation();
  document.body.style.cursor = 'pointer';
};
const unhover = () => {
  document.body.style.cursor = '';
};

export interface PersonProps {
  member: CastMember;
  crowd: Crowd;
  selected: boolean;
  onSelect: () => void;
}

export function Person({ member: m, crowd, selected, onSelect }: PersonProps) {
  const group = useRef<Group>(null);
  // Mounted at home; from then on the crowd places them (a walk, a glide), so a re-render never puts them back.
  const [mount] = useState<[number, number, number]>(() => [m.x, 0, m.z]);
  const invalidate = useThree((s) => s.invalidate);
  useObjectAnchor(group, `person:${m.key}`, 2.2);
  useLayoutEffect(() => {
    if (group.current) crowd.set(m, group.current);
    invalidate();
  }, [crowd, m, invalidate]);
  useLayoutEffect(() => () => crowd.remove(m.key), [crowd, m.key]);

  const latest = useRef(onSelect);
  useLayoutEffect(() => {
    latest.current = onSelect;
  });
  const select = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    latest.current();
  }, []);
  // Needing you shows as a paper in hand at the front desk; where there's none (an office that only watches), the mark.
  const mark = m.status === 'waiting' && m.body.holding !== 'note-yours';
  const height = m.seated ? 1.7 : 2.1;

  return (
    <group ref={group} position={mount}>
      <mesh
        position={[0, height / 2, m.seated ? -0.1 : 0]}
        layers={PEOPLE_LAYER}
        onClick={select}
        onPointerOver={hover}
        onPointerOut={unhover}
      >
        <capsuleGeometry args={[0.42, height - 0.84, 2, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {m.item !== null && (
        <mesh
          position={PAPER_AT}
          layers={PEOPLE_LAYER}
          onClick={select}
          onPointerOver={hover}
          onPointerOut={unhover}
        >
          <boxGeometry args={PAPER_BOX} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {selected && (
        <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} layers={PEOPLE_LAYER}>
          <ringGeometry args={[0.6, 0.74, 32]} />
          <meshBasicMaterial color={HIGHLIGHTER} />
        </mesh>
      )}
      {mark && (
        <group position={[0, m.seated ? 2.05 : 2.4, 0]}>
          <mesh position={[0, 0.18, 0]} layers={PEOPLE_LAYER}>
            <boxGeometry args={[0.1, 0.32, 0.1]} />
            <meshStandardMaterial color={HIGHLIGHTER} emissive={HIGHLIGHTER} emissiveIntensity={0.8} />
          </mesh>
          <mesh position={[0, -0.06, 0]} layers={PEOPLE_LAYER}>
            <sphereGeometry args={[0.06, 8, 6]} />
            <meshStandardMaterial color={HIGHLIGHTER} emissive={HIGHLIGHTER} emissiveIntensity={0.8} />
          </mesh>
        </group>
      )}
    </group>
  );
}
