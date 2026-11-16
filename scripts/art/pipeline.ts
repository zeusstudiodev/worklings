// The art build: CC0 packs in, the office's GLBs out (see web/src/scene/art/spec.ts for what each file holds).
// Every step is deterministic, so a rerun on the same packs gives the same bytes.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { resample } from '@gltf-transform/functions';
import { LOOK_BODIES } from '../../src/core/looks.ts';
import { ART_PACKS } from '../../src/core/themes.ts';
import { ART_FILES, bodyFile, CLIP_NAMES, CLIPS_FILE, RETARGETED_CLIPS, ROLES, sceneryFile } from '../../web/src/scene/art/spec.ts';
import { type ClipReport, kaykitClips, retargetedClips } from './clips.ts';
import { compressedGlb, gltfIO, newDocument } from './gltf.ts';
import { madeClips } from './made.ts';
import { BODIES, buildBody } from './people.ts';
import { addSkeleton, type Clip, readRest, restDifferences, writeClip } from './rig.ts';
import { buildScenery, PACK_FILES } from './scenery.ts';

const ANIMATIONS = 'kaykit-character-animations/extracted/KayKit_Character_Animations_1.1';
const CLIP_FILES = ['General', 'MovementBasic', 'Simulation', 'Tools'].map((set) => `${ANIMATIONS}/Animations/gltf/Rig_Medium/Rig_Medium_${set}.glb`);
const MESH2MOTION = 'mesh2motion/human/animations';

/** Each pack's licence, read before anything is taken from it: everything shipped must be CC0. */
const LICENCES: readonly { pack: string; file: string }[] = [
  { pack: 'KayKit Character Animations 1.1', file: `${ANIMATIONS}/License.txt` },
  { pack: 'KayKit Adventurers 2.0', file: 'kaykit-adventurers/extracted/KayKit_Adventurers_2.0_FREE/License.txt' },
  { pack: 'KayKit Furniture Bits 1.0', file: PACK_FILES['furniture-bits'].licence },
  { pack: 'KayKit Restaurant Bits 1.0', file: PACK_FILES['restaurant-bits'].licence },
  { pack: 'Mesh2Motion human', file: 'mesh2motion/LICENSE-NOTE.txt' },
];

export interface FileRow {
  file: string;
  bytes: number;
  triangles: number | null;
  contents: string;
}

export interface BuildReport {
  files: FileRow[];
  clips: ClipReport[];
  notes: string[];
}

export async function buildArt(raw: string, out: string): Promise<BuildReport> {
  for (const { pack, file } of LICENCES) {
    const path = join(raw, file);
    if (!existsSync(path)) throw new Error(`${pack}: no licence file at ${path}`);
    if (!/\bCC0\b/.test(readFileSync(path, 'utf8'))) throw new Error(`${pack}: ${path} doesn't say CC0, so nothing is taken from it`);
  }
  const io = await gltfIO();
  const files: FileRow[] = [];
  const notes: string[] = [];
  const write = (file: string, bytes: Uint8Array, triangles: number | null, contents: string) => {
    const path = join(out, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    files.push({ file, bytes: bytes.byteLength, triangles, contents });
  };
  const restProblems = (problems: string[]) => {
    if (problems.length) throw new Error(problems.join('\n'));
  };

  // The one skeleton: the mannequin's, which every Adventurer and clip file must share.
  const mannequin = await io.read(join(raw, BODIES.mannequin.file));
  const rest = readRest(mannequin, 'mannequin');

  for (const id of LOOK_BODIES) {
    const source = id === 'mannequin' ? mannequin : await io.read(join(raw, BODIES[id].file));
    restProblems(restDifferences(rest, readRest(source, id), id));
    const body = buildBody(id, source, rest);
    write(bodyFile(id), await compressedGlb(body.full), body.triangles.full, `${body.parts.kept.length} parts merged into one skinned mesh`);
    write(bodyFile(id, 'low'), await compressedGlb(body.low), body.triangles.low, 'simplified for phones');
    const roles = body.roles.flatMap((n, i) => (n ? [`${ROLES[i]} ${n}`] : []));
    notes.push(`${id}: left off ${body.parts.dropped.join(', ') || 'nothing'}; atlas ${body.atlas.from} to ${body.atlas.to} (${body.atlas.bytes} B); triangles by role: ${roles.join(', ')}`);
  }

  const clipSources = await Promise.all(CLIP_FILES.map(async (file) => ({ label: file.split('/').at(-1) ?? file, doc: await io.read(join(raw, file)) })));
  for (const { label, doc } of clipSources) restProblems(restDifferences(rest, readRest(doc, label), label));
  const clipReport: ClipReport[] = [];
  const kaykit = kaykitClips(clipSources, rest, clipReport);
  const restPose = await io.read(join(raw, MESH2MOTION, 'rest-pose.glb'));
  const mesh2motion = new Map<string, Document>();
  for (const file of Object.values(RETARGETED_CLIPS)) mesh2motion.set(file, await io.read(join(raw, MESH2MOTION, `${file}.glb`)));
  const retargeted = retargetedClips(restPose, mesh2motion, rest, clipReport);
  const built = new Map<string, Clip>([...kaykit, ...retargeted]);
  const all = new Map<string, Clip>([...built, ...madeClips(built, rest, clipReport)]);

  const clips = newDocument();
  const buffer = clips.createBuffer();
  const nodes = addSkeleton(clips, rest);
  clips.getRoot().setDefaultScene(clips.createScene('clips').addChild(nodes.get('root') ?? clips.createNode('root')));
  for (const name of CLIP_NAMES) {
    const clip = all.get(name);
    if (!clip) throw new Error(`clip ${name} was not built`);
    writeClip(clips, buffer, nodes, clip);
  }
  await clips.transform(resample());
  const keys = clips.getRoot().listAnimations().reduce((n, a) => n + a.listSamplers().reduce((m, s) => m + (s.getInput()?.getCount() ?? 0), 0), 0);
  write(CLIPS_FILE, await compressedGlb(clips), null, `${CLIP_NAMES.length} clips, ${keys} keys after resampling`);

  for (const pack of ART_PACKS) {
    const scenery = await buildScenery(pack, raw, io);
    const triangles = scenery.pieces.reduce((n, p) => n + p.triangles, 0);
    write(sceneryFile(pack), await compressedGlb(scenery.doc), triangles, `${scenery.pieces.length} pieces`);
    notes.push(`${pack}: atlas ${scenery.atlas.from} to ${scenery.atlas.to} (${scenery.atlas.bytes} B); baked occlusion darkest ${Math.min(...scenery.pieces.map((p) => p.shade.min)).toFixed(2)}, mean ${(scenery.pieces.reduce((n, p) => n + p.shade.mean, 0) / scenery.pieces.length).toFixed(2)}; ${scenery.pieces.map((p) => `${p.name} ${p.triangles}`).join(', ')}`);
  }

  // Nothing else stays in the folder: a GLB the build no longer writes would ship unnoticed.
  const expected = new Set(ART_FILES.map((file) => join(out, file)));
  const stale = listFiles(out).filter((path) => path.endsWith('.glb') && !expected.has(path));
  for (const path of stale) rmSync(path);
  if (stale.length) notes.push(`removed ${stale.map((path) => relative(out, path).split(sep).join('/')).join(', ')}`);
  return { files, clips: clipReport, notes };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
