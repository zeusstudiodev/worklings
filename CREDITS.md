# Credits

The office's 3D art in `web/public/art` is built from the packs below by `scripts/art/build.mjs`. Every pack is
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so the built files are CC0 too. They
are not covered by the MIT licence in `LICENSE`, which is for Worklings' code. CC0 asks for no credit; it is given
here anyway, with thanks.

The raw packs are not in the repository. To rebuild, unpack them into one folder, keep each pack's licence file
beside it (the build reads every licence before it takes anything, and stops if one doesn't say CC0), and run
`node scripts/art/build.mjs` with `WORKLINGS_ART_RAW` naming that folder.

## KayKit Character Animations 1.1

- **By** Kay Lousberg, [kaylousberg.com](https://www.kaylousberg.com)
- **From** https://kaylousberg.itch.io/kaykit-character-animations
- **Licence** CC0 1.0 (the pack's `License.txt`)
- **Taken:** the medium mannequin (`Mannequin_Medium.glb`) and its texture, which became the visitors' body
  (`people/mannequin.glb`, `people/mannequin-low.glb`); the medium rig, which every body and clip shares; eleven
  clips from the `Rig_Medium` files (`General`, `MovementBasic`, `Simulation`, `Tools`): Idle_A, Walking_A,
  Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp, Interact, Use_Item, Holding_A, Cheering, Waving and PickUp, in
  `clips.glb`.
- **Changed:** the mannequin's six parts merged into one skinned mesh, each vertex tagged with an outfit role (the
  `_ROLE` attribute), its texture halved to 256 px, and a copy simplified to about 3,000 triangles for phones. The rig's
  bone names lost their dots (`upperarm.l` is `upperarml`) and its weapon-slot bones were removed. From the clip files
  only those eleven clips were kept, without the copy of the mannequin each file carries; tracks that never leave the
  rest pose were dropped and the rest resampled. The Typing layer was made from Sit_Chair_Idle: the arms aimed at a
  keyboard frame by frame, stored as an additive clip.

## KayKit Adventurers 2.0 FREE

- **By** Kay Lousberg, [kaylousberg.com](https://www.kaylousberg.com)
- **From** https://kaylousberg.itch.io/kaykit-adventurers
- **Licence** CC0 1.0 (the pack's `License.txt`)
- **Taken:** the Knight, Barbarian, Mage, Rogue and Ranger bodies (`Characters/gltf`), which became
  `people/knight.glb`, `barbarian`, `mage`, `rogue` and `ranger`, each with a `-low` copy.
- **Changed:** helmets, visors, hats, capes and quivers left off, and no weapons taken; the six remaining parts merged
  into one skinned mesh on the medium rig, each vertex tagged with an outfit role; each 1024 px gradient atlas reduced
  to a 32 by 128 px palette, with the UVs moved to the middle of their colour blocks; a copy simplified to about
  3,000 triangles for phones.

## KayKit Furniture Bits 1.0 FREE

- **By** Kay Lousberg, [kaylousberg.com](https://www.kaylousberg.com)
- **From** https://kaylousberg.itch.io/furniture-bits
- **Licence** CC0 1.0 (the pack's `License.txt`)
- **Taken:** 25 pieces, in `scenery/furniture-bits.glb`: armchair_pillows, book_set, cabinet_medium,
  cabinet_medium_decorated, cabinet_small_decorated, cactus_medium_A, cactus_small_A, chair_A, chair_B, chair_stool,
  couch_pillows, lamp_standing, pictureframe_large_A, pictureframe_large_B, pictureframe_small_B,
  pictureframe_standing_A, rug_oval_A, rug_rectangle_A, rug_rectangle_stripes_A, shelf_B_large_decorated,
  shelf_B_small_decorated, table_low, table_medium, table_medium_long and table_small.
- **Changed:** each piece's parts baked into one mesh in the pack's own scale, and the shared atlas halved to 512 px.
  The office recolours pieces by atlas block for its themes as it draws them; the file keeps the pack's colours.
  Ambient occlusion is baked into each piece (one extra byte per vertex, `scripts/art/occlusion.ts`): the pack's
  models are not otherwise altered.

## KayKit Restaurant Bits 1.0 FREE

- **By** Kay Lousberg, [kaylousberg.com](https://www.kaylousberg.com)
- **From** https://kaylousberg.itch.io/restaurant-bits
- **Licence** CC0 1.0 (the pack's `License.txt`)
- **Taken:** 6 pieces, in `scenery/restaurant-bits.glb`: chair_A, crate, fridge_A, kitchencounter_sink,
  kitchencounter_straight_A and table_round_A_small.
- **Changed:** as Furniture Bits: one mesh per piece, the atlas halved to 512 px, ambient occlusion baked per vertex, recoloured by the office as it draws.

## Mesh2Motion human animations

- **By** the Mesh2Motion project, https://mesh2motion.org
- **From** https://github.com/Mesh2Motion/mesh2motion-app (`static/assets/human`)
- **Licence** CC0 1.0 for the art: "The art assets (3d models, rigs, animations) are all licensed under CC0" (the
  project's README; its code is MIT, and none of it is used here)
- **Taken:** eight clips, in `clips.glb`: idle-talking, idle-listening, head-nod, walk-carry, sitting-talking,
  clapping, victory-fist-pump and pickup-table, named Idle_Talking, Idle_Listening, Head_Nod, Walk_Carry,
  Sitting_Talking, Clapping, Victory_Fist_Pump and PickUp_Table. The rest-pose clip is read to line the two rigs up and
  is not shipped.
- **Changed:** retargeted from Mesh2Motion's 66-bone human onto KayKit's medium rig at build time (a bone map, a
  rotation offset per bone measured with both rigs in a T-pose, the hips scaled to KayKit's height); the fingers and
  other bones KayKit lacks dropped; tracks that never leave the rest pose dropped and the rest resampled.

## Fonts

The office is set in Barlow and Barlow Semi Condensed, which the web app bundles from the [Fontsource](https://fontsource.org)
packages `@fontsource/barlow` and `@fontsource/barlow-semi-condensed`.

- **By** The Barlow Project Authors (designed by Jeremy Tribby), [github.com/jpt/barlow](https://github.com/jpt/barlow)
- **Licence** SIL Open Font License 1.1 (the font files are not covered by the MIT licence in `LICENSE`; the full
  text is in `THIRD-PARTY-NOTICES.md`)
- **Changed:** nothing; the files are used as Fontsource ships them. The wordmark in `docs/launch/brand`
  (`wordmark-*.svg` and the logos made from it) is "Worklings" set in Barlow Semi Condensed Bold and outlined to paths.

## The mascot

The Workling, the green creature in a hard hat, is original artwork made for Worklings, not taken from a pack. Its
source is `docs/launch/brand/workling.svg`; `scripts/launch/brand.mjs` renders the PNGs, the avatars and the logos from
it, and the favicon in `web/index.html` and `web/site/index.html` is a simplified drawing of it.

## Bundled code

The web app, the static demo, the plugin runtime and the command line bundle open-source code: three.js, React, the
pmndrs libraries (react-three-fiber, drei, postprocessing), `yaml`, `smol-toml` and the small packages they need, all
under permissive licences (MIT, ISC, BSD-3-Clause, Zlib). Each one, with its version, licence and notice, is in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which `scripts/third-party-notices.ts` writes and every build
checks and carries.
