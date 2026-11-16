// The desktop extras (SPEC-v3.md, "Light"): a little bloom on what glows (screens, lamps). Loaded only on desktops,
// after the scene, and the first thing the governor drops when frames run long (people/governor.ts, level 1). The
// composer turns the renderer's own tone mapping off, so it runs Neutral at the end, as the scene does without it.
//
// Its 4x multisampling is for pixel ratios under 1.5: above, the pixels are small enough without it, and four samples
// a pixel at a ratio of 2 cost an integrated GPU about 40 ms a frame (H26's measurements).
//
// No screen-space ambient occlusion: N8AO 2.0.1, the one SPEC-v3 names, crashes on three r187 (its multiple render
// target returns an array from `texture`, which r187's setupRenderTarget reads as one texture). What it would have
// done for furniture is baked instead: the art build (scripts/art/occlusion.ts) writes ambient occlusion into the
// scenery pieces' vertex colours, free at run time, and the contact shadows ground people and the made pieces.
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/** Pixel ratios from here up draw the extras without multisampling. */
const MSAA_BELOW_DPR = 1.5;

export default function Effects() {
  const dpr = useThree((s) => s.viewport.dpr);
  return (
    <EffectComposer multisampling={dpr < MSAA_BELOW_DPR ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur luminanceThreshold={0.86} luminanceSmoothing={0.12} intensity={0.22} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
