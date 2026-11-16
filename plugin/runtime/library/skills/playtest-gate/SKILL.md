---
name: playtest-gate
description: >-
  Checks a gameplay change before it goes to wider testing or release: fresh playthroughs with recordings and
  numbers, the design intent, feel, difficulty and pacing, progression bugs, performance on the target device and
  basic game accessibility, with a pass or fail verdict. Use when a mechanic, level or balance change is done.
worklings:
  kind: gate
  department: design
  from: design
  to: quality
---
# Playtest gate

A gameplay change passes when someone played it fresh and the evidence shows it works and feels as intended.

1. Collect the change, the design intent (what the player should feel and do), the build or commit, and the
   playtest reports for it.
2. Require evidence: at least one fresh playthrough of the changed content on the target platform and screen sizes,
   with recordings or screenshots and numbers (completion, failures, time, frame rate), plus the balance
   simulation's results if the project has one. If they're missing, playtest first (the `playtest` skill, if the
   studio has it).
3. Check:
   - Intent: the change does what the design meant, and a new player understands it without being told, or the
     onboarding teaches it.
   - Feel: inputs respond at once, every action has feedback, and the screen stays readable.
   - Difficulty and pacing: no unfair spikes, soft locks or dominant strategies; failing feels fair; the curve
     matches the plan.
   - Stability: no crashes, progression blockers or lost saves; saving and loading work across the change.
   - Performance: a steady frame rate on the target device class and acceptable load times.
   - Accessibility basics: remappable or simple controls, readable text, cues that don't rely on colour alone,
     subtitles for speech, and options to reduce flashing and screen shake.
4. Bring in the studio's designers, QA and performance people where they're hired:

{{team}}

5. Verdict: **pass** or **fail**, blockers separate from suggestions, each with its evidence. Name what still needs a
   person's hands: touch feel on a real phone, audio, gamepad, fun over a long session.
