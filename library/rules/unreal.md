---
title: Unreal Engine
department: engineering
stacks: [unreal]
paths:
  - "Source/**/*.{h,cpp,cs}"
  - "Plugins/**/*.{h,cpp,cs,uplugin}"
  - "Config/**/*.ini"
  - "*.uproject"
---
- Check the engine version in the `.uproject` (`EngineAssociation`) before using an API; UE5 releases deprecate and rename often.
- Every `UObject` pointer member is a `UPROPERTY()` (a `TObjectPtr` in UE5), or the garbage collector may free its target.
- Hold non-owning references in `TWeakObjectPtr` and check `IsValid()` before use.
- Expose to Blueprints deliberately: read-only by default, `EditDefaultsOnly` before `EditAnywhere`, only the calls designers need.
- Turn off ticking for actors and components that don't need it; use timers and events instead.
- Core and performance-sensitive systems in C++; Blueprints for content, tuning and glue, with no heavy loops.
- Follow Unreal's naming prefixes (`A`, `U`, `F`, `E`, `I`, `T`, `b` for booleans) and the module's Public and Private layout.
- Add module dependencies explicitly in `Build.cs` and keep them minimal.
- Multiplayer: the server is authoritative; validate every server RPC's input and replicate state with RepNotify, not RPC streams.
- Use soft references (`TSoftObjectPtr`) and async loading for heavy assets, so one hard reference doesn't load half the game.
- `.uasset` and `.umap` are binary: never hand-edit them; use Git LFS or Perforce with locking; fix up redirectors after moves.
- User-facing strings are `FText` so they can be localised; `FName` for identifiers, `FString` for manipulation.
- Log with your own categories and `UE_LOG`; `check` invariants that must halt, `ensure` the ones that should only report.
- Live Coding suits `.cpp` body changes; after changing reflected headers (`UCLASS`, `UPROPERTY`), close the editor and rebuild.
- Cover core logic with automation tests and run them from the command line in CI.
- Profile with Unreal Insights and `stat` commands on target hardware, not only in the editor.
- Never commit `Binaries/`, `Intermediate/`, `Saved/` or `DerivedDataCache/`.
