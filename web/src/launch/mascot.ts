// The Workling mascot, drawn by the office's own art code (scripts/launch/mascot.mjs opens this page in a headless
// browser): one of the office's people, in its outfit shader and light, waving from a little desk with an open laptop.
// Not part of the app; nothing imports it. It renders on a transparent background and composes the sticker outline
// and the soft shadow on 2D canvases, so the PNGs carry nothing but pixels.
import {
  type BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { LookBody } from '../../../src/core/looks.ts';
import { loadBody, loadClips, loadScenery } from '../scene/art/loader.ts';
import { CELL } from '../scene/office/atlas.ts';
import { desk, DESK_TOP, officeChair } from '../scene/office/desk.ts';
import { smallPlant } from '../scene/office/props.ts';
import { Glow, Shape, TILE } from '../scene/office/shape.ts';
import { officeTextures } from '../scene/office/textures.ts';
import type { Outfit } from '../scene/people/dress.ts';
import { PropKit } from '../scene/people/props.ts';
import { PEOPLE_LAYER, PersonRig } from '../scene/people/rig.ts';

export interface MascotOptions {
  body: LookBody;
  outfit: Outfit;
  /** The desk pedestal's and the chair's hue. */
  hue: string;
  /** Where in the Waving clip, 0 to 1. */
  at: number;
  /** How far the person turns toward the camera, in radians about y. */
  turn: number;
  /** Square canvas size the scene is drawn at. */
  px: number;
  camera: { at: [number, number, number]; look: [number, number, number]; fov: number };
  /** Sticker outline width as a fraction of `px`, and its colour; 0 draws none. */
  outline: number;
  outlineColour: string;
  /** Opacity of the shadow the key light throws on the floor. */
  shadow: number;
  chair: boolean;
}

/**
 * The office's day light (Stage.tsx): a warm key on the front left, a cool fill, the sky's hemisphere. The key stands
 * higher than the office's, so the shadow pools under the desk instead of running out of the picture.
 */
const KEY = { colour: '#FFE3BE', intensity: 3.0, from: new Vector3(-9, 28, 12) };
const FILL = { colour: '#CFE0F4', intensity: 0.32, from: new Vector3(24, 16, -20) };
const SKY = { sky: '#FFF0DA', ground: '#4E6A5C', intensity: 0.82 };

/** An open laptop in KayKit's style: its user is on the -z side, the lid hinged at the back and leaning away. */
function laptop(): { solid: BufferGeometry; glow: BufferGeometry | null } {
  const s = new Shape(0.4, 0);
  const tilt = -0.32;
  s.box(0.56, 0.035, 0.38, 0, 0.0175, 0, CELL.steel, { r: 0.012, span: 0.3 });
  s.box(0.48, 0.006, 0.2, 0, 0.037, -0.03, CELL.ink, { r: 0.003, span: 0.1 });
  s.box(0.56, 0.36, 0.025, 0, 0.2, 0.2, CELL.steel, { r: 0.012, span: 0.3, rot: [tilt, 0, 0] });
  // A round sticker on the lid, in the highlighter's yellow.
  s.cyl(0.055, 0.055, 0.01, 0.1, 0.24, 0.222, CELL.sun, { sides: 16, span: 0.1, rot: [tilt + Math.PI / 2, 0, 0] });
  const glow = new Glow().quad(0.5, 0.3, 0, 0.2, 0.183, { tile: TILE.code, rot: [tilt, Math.PI, 0] }).build();
  return { solid: s.build(), glow };
}

async function build(o: MascotOptions) {
  const [body, clips, furniture] = await Promise.all([loadBody(o.body, 'full'), loadClips(), loadScenery('furniture-bits')]);
  const tex = officeTextures({ 'furniture-bits': furniture.atlas });
  const scene = new Scene();
  const atlas = new MeshStandardMaterial({ map: furniture.atlas, vertexColors: true, roughness: 0.78, metalness: 0 });
  const glow = new MeshBasicMaterial({ map: tex.screens, vertexColors: true, toneMapped: false });
  const add = (geometry: BufferGeometry | null | undefined, material: Material, x: number, y: number, z: number, ry = 0) => {
    if (!geometry) return;
    const m = new Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };

  add(desk(1.5, 0.82, o.hue, 0), atlas, 0, 0, 0);
  const lap = laptop();
  add(lap.solid, atlas, 0.18, DESK_TOP, -0.02, 0.22);
  add(lap.glow, glow, 0.18, DESK_TOP, -0.02, 0.22);
  add(smallPlant('#E9E2D3', 0.6).solid, atlas, -0.56, DESK_TOP, 0.18);
  if (o.chair) add(officeChair(o.hue), atlas, -1.0, 0, -0.95, 0.8);

  const props = new PropKit();
  const rig = new PersonRig(body, clips, { body: o.body, outfit: o.outfit, prop: 'none', phase: 0, pace: 1 }, 0, props);
  rig.play({ base: { clip: 'Waving', mode: 'still', at: o.at, elapsed: 0, timeScale: 1, weight: 1 }, layers: [], seated: false, holding: 'none', live: false }, 0);
  rig.root.position.set(0.12, 0, -0.62);
  rig.root.rotation.y = o.turn;
  rig.tick(0);
  rig.root.traverse((x) => {
    x.castShadow = true;
  });
  scene.add(rig.root);

  scene.add(new HemisphereLight(SKY.sky, SKY.ground, SKY.intensity));
  const key = new DirectionalLight(KEY.colour, KEY.intensity);
  key.position.copy(KEY.from).normalize().multiplyScalar(8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
  const fill = new DirectionalLight(FILL.colour, FILL.intensity);
  fill.position.copy(FILL.from).normalize().multiplyScalar(8);
  scene.add(key, fill, key.target, fill.target);

  const floor = new Mesh(new PlaneGeometry(12, 12), new ShadowMaterial({ opacity: o.shadow }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  return {
    scene,
    floor,
    dispose() {
      atlas.dispose();
      glow.dispose();
      props.dispose();
      rig.dispose();
    },
  };
}

function canvas(px: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  return [c, ctx];
}

/** One render of the scene, with or without the floor that catches the shadow. */
function draw(o: MascotOptions, s: Awaited<ReturnType<typeof build>>, floor: boolean): HTMLCanvasElement {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(o.px, o.px, false);
  renderer.toneMapping = NeutralToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const camera = new PerspectiveCamera(o.camera.fov, 1, 0.1, 50);
  camera.layers.enable(PEOPLE_LAYER);
  camera.position.set(...o.camera.at);
  camera.lookAt(...o.camera.look);
  s.floor.visible = floor;
  renderer.render(s.scene, camera);
  const [out, ctx] = canvas(o.px);
  ctx.drawImage(renderer.domElement, 0, 0);
  renderer.dispose();
  return out;
}

/** The objects' silhouette grown by `r` pixels, in one colour. */
function sticker(objects: HTMLCanvasElement, r: number, colour: string): HTMLCanvasElement {
  const px = objects.width;
  const [mask, m] = canvas(px);
  m.drawImage(objects, 0, 0);
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = colour;
  m.fillRect(0, 0, px, px);
  const [out, c] = canvas(px);
  const steps = 48;
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (r * ring) / 3;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      c.drawImage(mask, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  return out;
}

/** The finished picture as a PNG data URL: the floor's shadow, the sticker outline with a soft lift, then the objects. */
export async function renderMascot(o: MascotOptions): Promise<string> {
  const s = await build(o);
  const objects = draw(o, s, false);
  const all = draw(o, s, true);
  s.dispose();
  // The floor's shadow is what the full render has where the objects are not.
  const [shadow, sh] = canvas(o.px);
  sh.drawImage(all, 0, 0);
  sh.globalCompositeOperation = 'destination-out';
  sh.drawImage(objects, 0, 0);

  const [out, c] = canvas(o.px);
  c.drawImage(shadow, 0, 0);
  if (o.outline > 0) {
    const ring = sticker(objects, o.outline * o.px, o.outlineColour);
    c.save();
    c.filter = `drop-shadow(0 ${o.px * 0.008}px ${o.px * 0.014}px rgba(16, 32, 26, 0.3))`;
    c.drawImage(ring, 0, 0);
    c.restore();
  }
  c.drawImage(objects, 0, 0);
  return out.toDataURL('image/png');
}

declare global {
  interface Window {
    renderMascot: typeof renderMascot;
  }
}
window.renderMascot = renderMascot;
