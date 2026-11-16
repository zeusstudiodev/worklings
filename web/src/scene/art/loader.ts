// Loads the built art (web/public/art, see spec.ts) once per file and hands out what the scene draws: bodies to
// clone, the shared clips, and scenery geometry. Meshopt decoding is three's own decoder, bundled by Vite: nothing
// comes from a CDN.
import {
  AdditiveAnimationBlendMode,
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
  TextureLoader,
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { LookBody } from '../../../../src/core/looks.ts';
import type { ArtPack } from '../../../../src/core/themes.ts';
import { bakedGeometry } from './geometry.ts';
import { type BodyDetail, bodyFile, type ClipName, CLIPS_FILE, ROLE_ATTRIBUTE, sceneryFile } from './spec.ts';

/**
 * Embedded images through an `<img>` (TextureLoader) instead of GLTFLoader's default, ImageBitmapLoader, which
 * `fetch`es the image's blob: URL. The office's policy allows blob: images (img-src) but connects only to 'self'
 * (connect-src), so that fetch is refused and GLTFLoader would quietly drop the texture.
 */
function imageTextures(parser: GLTFParser): GLTFLoaderPlugin {
  const images = new TextureLoader(parser.options.manager);
  return {
    name: 'worklings_image_textures',
    loadTexture(textureIndex: number) {
      const source: unknown = parser.json.textures?.[textureIndex]?.source;
      return typeof source === 'number' ? parser.loadTextureImage(textureIndex, source, images) : null;
    },
  };
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(imageTextures);
const files = new Map<string, Promise<GLTF>>();

/** One art file, loaded once. A failed load is forgotten, so asking again retries it. */
export function loadArt(file: string): Promise<GLTF> {
  let gltf = files.get(file);
  if (!gltf) {
    gltf = loader.loadAsync(`${import.meta.env.BASE_URL}art/${file}`);
    files.set(file, gltf);
    gltf.catch(() => files.delete(file));
  }
  return gltf;
}

export interface Body {
  id: LookBody;
  detail: BodyDetail;
  /** The file's scene, to clone for each person (`makePerson`), never to add to the scene itself. */
  template: Object3D;
  mesh: SkinnedMesh;
  triangles: number;
}

const bodies = new Map<string, Promise<Body>>();

/** A body: the skeleton and one skinned mesh, whose `role` attribute gives each vertex its outfit role. */
export function loadBody(id: LookBody, detail: BodyDetail = 'full'): Promise<Body> {
  const file = bodyFile(id, detail);
  let body = bodies.get(file);
  if (!body) {
    body = loadArt(file).then((gltf) => {
      let mesh: SkinnedMesh | null = null;
      gltf.scene.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
      });
      if (!mesh) throw new Error(`${file} has no skinned mesh`);
      const found: SkinnedMesh = mesh;
      // GLTFLoader names custom attributes in lower case (`_ROLE` arrives as `_role`); the shader reads `role`.
      const role = found.geometry.getAttribute('_role');
      if (!role) throw new Error(`${file} has no role attribute`);
      found.geometry.setAttribute(ROLE_ATTRIBUTE, role);
      found.geometry.deleteAttribute('_role');
      const index = found.geometry.getIndex();
      return { id, detail, template: gltf.scene, mesh: found, triangles: (index?.count ?? 0) / 3 };
    });
    bodies.set(file, body);
    body.catch(() => bodies.delete(file));
  }
  return body;
}

let clips: Promise<ReadonlyMap<string, AnimationClip>> | null = null;

/** Every clip, shared by all people. Additive ones (Typing) come ready to play over their base clip. */
export function loadClips(): Promise<ReadonlyMap<string, AnimationClip>> {
  if (!clips) {
    const loading = loadArt(CLIPS_FILE).then((gltf) => {
      for (const clip of gltf.animations) if (clip.userData.additive === true) clip.blendMode = AdditiveAnimationBlendMode;
      return new Map(gltf.animations.map((clip) => [clip.name, clip]));
    });
    loading.catch(() => {
      clips = null;
    });
    clips = loading;
  }
  return clips;
}

export interface Person {
  /** Add this to the scene: a clone of the body sharing its geometry and material. */
  root: Object3D;
  mesh: SkinnedMesh;
  mixer: AnimationMixer;
  /** The person's action for a clip, made on first use. */
  action(name: ClipName): AnimationAction;
}

/** A person: a SkeletonUtils clone of a body with its own mixer, sharing the clips with everyone else. */
export function makePerson(body: Body, shared: ReadonlyMap<string, AnimationClip>): Person {
  const root = clone(body.template);
  let mesh: SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error(`${body.id}: the clone has no skinned mesh`);
  const mixer = new AnimationMixer(root);
  return {
    root,
    mesh,
    mixer,
    action(name) {
      const clip = shared.get(name);
      if (!clip) throw new Error(`no clip called ${name}`);
      return mixer.clipAction(clip);
    },
  };
}

export interface Scenery {
  pack: ArtPack;
  /** Each piece by its name in the pack, as plain geometry in the pack's own scale, ready to place and merge. */
  pieces: ReadonlyMap<string, BufferGeometry>;
  /** The pack's gradient atlas: sRGB, no mipmaps, so blocks never bleed into each other at a distance. */
  atlas: Texture;
}

const scenery = new Map<ArtPack, Promise<Scenery>>();

/** A pack's pieces, loaded when a theme first needs them. */
export function loadScenery(pack: ArtPack): Promise<Scenery> {
  let loaded = scenery.get(pack);
  if (!loaded) {
    loaded = loadArt(sceneryFile(pack)).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const pieces = new Map<string, BufferGeometry>();
      let atlas: Texture | null = null;
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        pieces.set(mesh.name, bakedGeometry(mesh));
        atlas ??= (mesh.material as Material & { map?: Texture | null }).map ?? null;
      });
      if (!atlas) throw new Error(`${pack} has no atlas`);
      return { pack, pieces, atlas };
    });
    scenery.set(pack, loaded);
    loaded.catch(() => scenery.delete(pack));
  }
  return loaded;
}

/** Frees a pack's GPU memory once no theme on screen uses it; loading it again fetches it again. */
export async function releaseScenery(pack: ArtPack): Promise<void> {
  const loaded = scenery.get(pack);
  if (!loaded) return;
  scenery.delete(pack);
  files.delete(sceneryFile(pack));
  const freed = await loaded.catch(() => null);
  if (!freed) return;
  for (const geometry of freed.pieces.values()) geometry.dispose();
  freed.atlas.dispose();
}
