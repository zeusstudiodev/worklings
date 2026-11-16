---
name: playtest
description: >-
  Plays the current build like a player and reports feel, difficulty, bugs and performance with evidence: recordings,
  screenshots, frame times and numbers per session. Use after a gameplay change, before the playtest gate, or whenever
  the question is "is it fun, and does it work".
worklings:
  kind: workflow
  department: design
---
# Playtest

1. Set the question: what this session tests (a new mechanic, a level, the first five minutes, difficulty, a
   performance fix), for which player and on which platform. Note the build (commit) and the settings.
2. Run the game the way players get it, using the project's own run or verify instructions and a production build
   where possible. Web games: phone and desktop sizes, touch and mouse. Engine games: the exported build, or play mode
   on the target platform.
3. Play a first run as a newcomer, ignoring what you know from the code. Then play focused runs on the thing under
   test. Then try to break it: mash inputs, pause and resume, resize, switch tabs, lose on purpose, quit mid-run,
   reload a save.
4. Record each session: time to understand the goal, where you got stuck or confused, failures and their causes,
   score or progress, frame rate or frame time, memory over time, load time and console errors. Keep a screenshot or
   short recording for every finding.
5. If the project has a balance simulation or an analytics script, run it and put its numbers next to your sessions.
6. Bring in the studio where it helps (design intent, level flow, art and sound feedback, performance):

{{team}}

7. Report in five parts, with evidence for each point:
   - Feel: responsiveness, feedback on every action, readability, camera, pacing.
   - Difficulty: the curve, spikes, unfair moments, dominant strategies, parts that are too easy.
   - Bugs: steps to reproduce, severity, evidence.
   - Performance: frame rate on which device and screen size, hitches, load time, memory growth.
   - The three changes that would improve the game most, ranked.
8. Say what automation can't judge: how touch feels in the hand, audio on a real device, gamepad feel, fun over a
   long session. Those need a person's playtest.
