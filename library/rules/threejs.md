---
title: Three.js and WebGL
department: engineering
stacks: [threejs]
paths:
  - "src/**/*.{ts,tsx,js,jsx}"
  - "src/**/*.{glsl,vert,frag,wgsl}"
  - "shaders/**"
  - "public/models/**"
  - "assets/**"
---
- Check the installed three, R3F and drei versions; APIs are renamed and removed between releases, so read the migration notes.
- Know which renderer the project uses (WebGL or WebGPU); node materials and TSL belong to the WebGPU and node pipeline.
- Dispose of the geometries, materials, textures and render targets you create when objects leave the scene or the view unmounts.
- Watch `renderer.info` (geometries, textures, draw calls) while moving through the app; counts that only grow are a leak.
- Render on demand while nothing moves (R3F: `frameloop="demand"` plus `invalidate()`), so idle scenes don't drain the battery.
- Cap the pixel ratio at about 2, lower on weak GPUs; fill rate is the first thing phones run out of.
- Keep draw calls low: `InstancedMesh` for repeated objects, merged static geometry, shared materials, texture atlases.
- Ship glTF or GLB with Draco or Meshopt compression and KTX2 textures, and configure the decoders the loaders need.
- Colour textures use `SRGBColorSpace`; set the output colour space and tone mapping once, on purpose.
- Size textures for how big they appear on screen; a 4K texture on a small object wastes memory and upload time.
- Allocate nothing in the render loop: reuse `Vector3`, `Matrix4` and `Quaternion` instances.
- Animate with the frame delta so speed doesn't depend on frame rate.
- Resize with the canvas's container (ResizeObserver), updating the camera aspect and the renderer size together.
- Lights and shadows are expensive: few shadow casters, small shadow maps, baked lighting for static scenes.
- Handle WebGL context loss and missing WebGL with a fallback (a still image and a message), never a blank canvas.
- In R3F, mutate refs inside `useFrame`; never set React state every frame.
- Respect `prefers-reduced-motion`: stop autoplaying camera moves and large motion.
- The canvas is invisible to assistive technology; essential text and controls live in the DOM.
- Measure on a real mid-range phone; iOS Safari has tighter GPU memory limits and reloads tabs that exceed them.
