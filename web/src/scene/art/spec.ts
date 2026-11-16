// The art's contract: what scripts/art/build.mjs writes into web/public/art and what the files hold. Pure data,
// shared by the build (which Node runs), the loader and the tests, so the three can't drift apart.
import { LOOK_BODIES, type LookBody } from '../../../../src/core/looks.ts';
import { ART_PACKS, type ArtPack } from '../../../../src/core/themes.ts';

/**
 * KayKit's medium rig without its weapon slots: the one skeleton every body and clip shares, parents before
 * children. Names are as three.js sees them: GLTFLoader drops the dots, so KayKit's `upperarm.l` is `upperarml`.
 */
export const JOINTS = [
  'root',
  'hips',
  'spine',
  'chest',
  'head',
  'upperarml',
  'lowerarml',
  'wristl',
  'handl',
  'upperarmr',
  'lowerarmr',
  'wristr',
  'handr',
  'upperlegl',
  'lowerlegl',
  'footl',
  'toesl',
  'upperlegr',
  'lowerlegr',
  'footr',
  'toesr',
] as const;
export type Joint = (typeof JOINTS)[number];

export const JOINT_PARENT: Readonly<Record<Joint, Joint | null>> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  head: 'chest',
  upperarml: 'chest',
  lowerarml: 'upperarml',
  wristl: 'lowerarml',
  handl: 'wristl',
  upperarmr: 'chest',
  lowerarmr: 'upperarmr',
  wristr: 'lowerarmr',
  handr: 'wristr',
  upperlegl: 'hips',
  lowerlegl: 'upperlegl',
  footl: 'lowerlegl',
  toesl: 'footl',
  upperlegr: 'hips',
  lowerlegr: 'upperlegr',
  footr: 'lowerlegr',
  toesr: 'footr',
};

/**
 * What each triangle of a body is, for the outfit shader: the build bakes it per vertex as the `_ROLE` attribute
 * (a role's value is its index here) and the loader hands it over as `role`. `keep` is drawn as the atlas has it:
 * eyes, the mannequin's smiley and its name sticker.
 */
export const ROLES = ['keep', 'skin', 'hair', 'top', 'topDark', 'trousers', 'shoes', 'accent'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_ATTRIBUTE = 'role';

/** KayKit's own clips the office plays (docs/game-feel.md), on the medium rig already. */
export const KAYKIT_CLIPS = [
  'Idle_A',
  'Walking_A',
  'Sit_Chair_Down',
  'Sit_Chair_Idle',
  'Sit_Chair_StandUp',
  'Interact',
  'Use_Item',
  'Holding_A',
  'Cheering',
  'Waving',
  'PickUp',
] as const;

/** Mesh2Motion's clips, retargeted onto the medium rig at build time: the name each takes, from its file. */
export const RETARGETED_CLIPS = {
  Idle_Talking: 'idle-talking',
  Idle_Listening: 'idle-listening',
  Head_Nod: 'head-nod',
  Walk_Carry: 'walk-carry',
  Sitting_Talking: 'sitting-talking',
  Clapping: 'clapping',
  Victory_Fist_Pump: 'victory-fist-pump',
  PickUp_Table: 'pickup-table',
} as const;

/**
 * Layers made at build time (scripts/art/made.ts), each played additively over the clip named and never alone: their
 * glTF extras say `additive: true`, and the loader gives them three.js's additive blend mode. Typing and Gesturing
 * loop, Nodding plays once (it only moves the head, so it goes over sitting or standing); the rest are still poses
 * (extras `still: true`), played paused. Think, Stuck, Sleep, Read and Look_Up are game-feel.md's seated poses,
 * Arms_Crossed and Lean_Back two of the three rest poses (sitting idle is the third), Slouch the long day's.
 */
export const ADDITIVE_CLIPS = {
  Typing: 'Sit_Chair_Idle',
  Gesturing: 'Idle_Talking',
  Think: 'Sit_Chair_Idle',
  Stuck: 'Sit_Chair_Idle',
  Sleep: 'Sit_Chair_Idle',
  Read: 'Sit_Chair_Idle',
  Look_Up: 'Sit_Chair_Idle',
  Arms_Crossed: 'Sit_Chair_Idle',
  Lean_Back: 'Sit_Chair_Idle',
  Slouch: 'Sit_Chair_Idle',
  Nodding: 'Sit_Chair_Idle',
} as const;

export type ClipName = (typeof KAYKIT_CLIPS)[number] | keyof typeof RETARGETED_CLIPS | keyof typeof ADDITIVE_CLIPS;
export const CLIP_NAMES: readonly ClipName[] = [
  ...KAYKIT_CLIPS,
  ...(Object.keys(RETARGETED_CLIPS) as (keyof typeof RETARGETED_CLIPS)[]),
  ...(Object.keys(ADDITIVE_CLIPS) as (keyof typeof ADDITIVE_CLIPS)[]),
];

/** A body for desktops, or the simplified one for phones. */
export type BodyDetail = 'full' | 'low';

/** Files under the web app's `art/` folder (`web/public/art`). */
export const bodyFile = (body: LookBody, detail: BodyDetail = 'full'): string => `people/${body}${detail === 'low' ? '-low' : ''}.glb`;
export const CLIPS_FILE = 'clips.glb';
export const sceneryFile = (pack: ArtPack): string => `scenery/${pack}.glb`;

export const ART_FILES: readonly string[] = [
  ...LOOK_BODIES.flatMap((body) => [bodyFile(body), bodyFile(body, 'low')]),
  CLIPS_FILE,
  ...ART_PACKS.map(sceneryFile),
];

/** What the built files are held to (test/art-assets.test.ts checks them). */
export const ART_BUDGET = {
  /** Every file together: the art proof downloaded 7 MB. */
  totalBytes: 1_500_000,
  /** One body file, full or low. */
  bodyBytes: 120_000,
  clipsBytes: 250_000,
  /** One pack's scenery file. */
  sceneryBytes: 200_000,
  /** Each atlas, a lossless PNG. */
  atlasBytes: 16_384,
  /** A full body: the Adventurers' merged parts run 4.9k to 8.6k triangles. */
  bodyTriangles: 9_000,
  /** The phones' body, simplified with meshoptimizer. */
  lowTriangles: 3_300,
} as const;
