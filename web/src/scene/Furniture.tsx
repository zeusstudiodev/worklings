// The gate arches in front of rooms. The rest of v2's model is merged in office/studio.ts, a company's office in
// office/build.ts; a gate is its own few meshes because its lamp glows while the gate's skill runs.
import type { ThreeEvent } from '@react-three/fiber';
import { useFixedAnchor } from './labels.tsx';
import { HIGHLIGHTER, WALL_TOP, WOOD, WOOD_DARK } from './palette.ts';

const flat = { flatShading: true, roughness: 0.85, metalness: 0 } as const;

function Box({ size, position, color }: { size: [number, number, number]; position: [number, number, number]; color: string }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} {...flat} />
    </mesh>
  );
}

/** A gate between rooms: a wooden arch whose lamp glows while the gate's skill runs. */
export function GateArch({ id, x, z, running, onClick }: { id: string; x: number; z: number; running: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  useFixedAnchor(`gate:${id}`, x, 2.35, z);
  return (
    <group position={[x, 0, z]} onClick={onClick}>
      <Box size={[0.12, 1.7, 0.12]} position={[-0.55, 0.85, 0]} color={WOOD_DARK} />
      <Box size={[0.12, 1.7, 0.12]} position={[0.55, 0.85, 0]} color={WOOD_DARK} />
      <Box size={[1.36, 0.16, 0.16]} position={[0, 1.75, 0]} color={WOOD} />
      <mesh position={[0, 1.98, 0]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color={running ? HIGHLIGHTER : WALL_TOP} emissive={running ? HIGHLIGHTER : '#000000'} emissiveIntensity={running ? 2.2 : 0} />
      </mesh>
    </group>
  );
}
