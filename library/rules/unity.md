---
title: Unity
department: engineering
stacks: [unity]
paths:
  - "Assets/**/*.cs"
  - "Assets/**/*.{unity,prefab,asset,asmdef}"
  - "Packages/manifest.json"
  - "ProjectSettings/**"
---
- Check the editor version in `ProjectVersion.txt` and package versions in `Packages/manifest.json` before using an API.
- Move, rename and delete assets in the editor so `.meta` files follow; commit every `.meta`, since references use its GUID.
- Keep asset serialisation on Force Text and scene diffs small; use prefabs so two people rarely edit the same scene.
- Use `[SerializeField] private` fields for inspector tuning instead of public fields.
- Cache component references in `Awake` or `Start`; never call `GetComponent` or the `Find` methods in `Update`.
- Input and visuals in `Update`, physics in `FixedUpdate`, scaled by `Time.deltaTime` and `Time.fixedDeltaTime`.
- No per-frame garbage: no LINQ, string building, boxing or new collections in hot paths; watch the Profiler's GC Alloc column.
- Pool objects that spawn often instead of calling `Instantiate` and `Destroy` each time.
- A destroyed Unity object equals `null` only through `==`; don't use `?.` or `??` on `UnityEngine.Object`.
- Unsubscribe events and stop coroutines in `OnDisable` or `OnDestroy`; cancel async work with `destroyCancellationToken`.
- Follow the project's async style (coroutines, `Awaitable`, UniTask) and input system (new or legacy); don't mix them.
- ScriptableObjects hold shared config; Play Mode edits to them persist in the editor, so don't keep runtime state in them.
- Split code into assembly definitions to keep compile times short and dependencies explicit.
- Load large content through Addressables or the project's loading system, not the `Resources` folder.
- Test with the Unity Test Framework (Edit Mode for logic, Play Mode for behaviour) and run it in batch mode in CI.
- Test player builds on target devices; IL2CPP stripping can remove code that is only reached through reflection (`link.xml`).
- Never commit `Library/`, `Temp/`, `Obj/`, `Logs/` or `UserSettings/`.
