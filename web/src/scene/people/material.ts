// The outfit shader: KayKit's atlas for what stays as drawn (eyes, the mannequin's smiley and name sticker), the
// person's colours for every other role, keeping the pack's top-to-bottom gradient shading. One material per person
// for their colours, one shader program for everyone.
import { Color, MeshStandardMaterial, type Texture } from 'three';
import { ROLE_ATTRIBUTE } from '../art/spec.ts';
import type { Outfit } from './dress.ts';

interface OutfitUniforms {
  uRows: { value: number };
  uSkin: { value: Color };
  uHair: { value: Color };
  uTop: { value: Color };
  uTopDark: { value: Color };
  uTrousers: { value: Color };
  uShoes: { value: Color };
  uAccent: { value: Color };
  /** A warm rim, so people lift off the floor at small sizes. */
  uRim: { value: Color };
  /** 0 to 1: v2's off-duty people go grey. */
  uDim: { value: number };
}

export type OutfitMaterial = MeshStandardMaterial & { userData: { outfit: OutfitUniforms } };

const RIM_DAY = new Color('#FFE2B8').multiplyScalar(0.22);
/** One colour every person's material shares, so night dims all the rims at once. */
const RIM = RIM_DAY.clone();

/** The rim follows the light: `light` 1 by day, about 0.3 at night (Stage.tsx's night). */
export function rimLight(light: number): void {
  RIM.copy(RIM_DAY).multiplyScalar(light);
}

/** `rows`: the atlas's grid of gradient blocks, down (4 for the Adventurers, 2 for the mannequin). */
export function outfitMaterial(map: Texture | null, rows: number, outfit: Outfit, dim = 0): OutfitMaterial {
  const uniforms: OutfitUniforms = {
    uRows: { value: rows },
    uSkin: { value: new Color() },
    uHair: { value: new Color() },
    uTop: { value: new Color() },
    uTopDark: { value: new Color() },
    uTrousers: { value: new Color() },
    uShoes: { value: new Color() },
    uAccent: { value: new Color() },
    uRim: { value: RIM },
    uDim: { value: dim },
  };
  const material = new MeshStandardMaterial({ map, roughness: 0.8, metalness: 0 }) as OutfitMaterial;
  material.userData.outfit = uniforms;
  setOutfit(material, outfit, dim);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${ROLE_ATTRIBUTE};\nvarying float vRole;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRole = ${ROLE_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vRole;
uniform float uRows, uDim;
uniform vec3 uSkin, uHair, uTop, uTopDark, uTrousers, uShoes, uAccent, uRim;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  // Roles, as spec.ts lists them: 0 keep, 1 skin, 2 hair, 3 top, 4 darker top, 5 trousers, 6 shoes, 7 accent.
  int role = int(vRole + 0.5);
  if (role > 0) {
    // KayKit's blocks run light at the top to dark at the bottom: keep that shading, in the outfit's colour.
    float g = fract(vMapUv.y * uRows);
    vec3 c = role == 1 ? uSkin : role == 2 ? uHair : role == 3 ? uTop : role == 4 ? uTopDark
      : role == 5 ? uTrousers : role == 6 ? uShoes : uAccent;
    float lift = role == 1 ? mix(1.06, 0.9, g) : mix(1.12, 0.72, g);
    diffuseColor.rgb = c * lift;
  }
  float grey = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey * 0.85 + 0.1), uDim);
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  outgoingLight += uRim * pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 2.4);
}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'worklings-person-1';
  return material;
}

/** Colours are sRGB like the palette; three's Color converts them to the linear values the shader works in. */
export function setOutfit(material: OutfitMaterial, outfit: Outfit, dim: number): void {
  const u = material.userData.outfit;
  u.uSkin.value.set(outfit.skin);
  u.uHair.value.set(outfit.hair);
  u.uTop.value.set(outfit.top);
  u.uTopDark.value.set(outfit.topDark);
  u.uTrousers.value.set(outfit.trousers);
  u.uShoes.value.set(outfit.shoes);
  u.uAccent.value.set(outfit.accent);
  u.uDim.value = dim;
}
