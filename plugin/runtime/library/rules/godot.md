---
title: Godot
department: engineering
stacks: [godot]
paths:
  - "**/*.{gd,tscn,tres,gdshader}"
  - "scenes/**"
  - "scripts/**"
  - "src/**"
  - "addons/**"
  - "project.godot"
---
- Check the Godot version in `project.godot`; Godot 4 renamed many Godot 3 APIs, so check which version an example targets.
- Use static typing in GDScript (`var speed: float`, `-> void`) and keep the typed-code warnings on.
- Call down, signal up: parents call methods on children, children emit signals, siblings talk through a parent or an event bus.
- Reach nodes through `@onready` variables with unique names (`%Name`) or exported references, not long `get_node` paths.
- Expose tuning values with `@export` so they can be changed in the inspector; no magic numbers in scripts.
- Movement and physics go in `_physics_process`, visuals in `_process`, both scaled by `delta`.
- Use autoloads only for truly global services (saving, audio, settings), not for state a scene should own.
- Resources are shared by default: `duplicate()` a resource before changing it for one instance.
- Free nodes with `queue_free()`, disconnect signals you connected by hand, and check `is_instance_valid()` on stored references.
- Read input through Input Map actions, never raw keycodes; support gamepads and rebinding where they fit.
- Let the editor own scene and resource files: keep `.tscn` and `.tres` diffs small and never hand-edit UIDs.
- Commit `project.godot` and the `.import` files; never commit the `.godot/` cache folder.
- Save to `user://` with a version number; `res://` is read-only in exported builds.
- Build UI from Control nodes, containers and anchors; test several resolutions with the project's stretch settings.
- Test game logic with the project's test framework (GUT or gdUnit4) and run it headless in CI.
- Test the exported build on each target platform, not just the editor; resources load and behave differently there.
- Profile with the built-in profiler and monitors; pool short-lived nodes and avoid allocations in hot loops.
