---
name: design-gate
description: >-
  Checks a design before engineering builds it: the goal, every flow and state, interactions, consistency with the
  design system, accessibility, real content and feasibility, with a pass or fail verdict. Use when a screen, flow or
  page design is ready to hand to the people who build it.
worklings:
  kind: gate
  department: design
  from: design
  to: engineering
---
# Design gate

Building from a half-finished design costs more than finishing it. A design passes when someone could build it
without guessing.

1. Collect the design: the flows, the screens, mockups or written spec, the design system or tokens it uses, the
   copy, and the task or plan it serves.
2. Check:
   - Goal: it solves the stated problem for the stated person, and the main task takes the fewest steps that work.
   - States: empty, loading, error, success, offline, first run, permission denied, long content and missing images
     are designed, not left to the builder.
   - Sizes: small phones (320-375 px), tablets and wide screens; large text; dark mode if the product has it.
   - Interaction: what every control does; hover, focus and pressed states; focus order; keyboard and touch
     behaviour; an alternative to every gesture; feedback for every action; what each motion does and how long it
     takes.
   - Consistency: it uses the existing components and tokens for colour, type, spacing, radius and motion; any new
     component is justified.
   - Accessibility: contrast meets WCAG 2.2 AA, targets are big enough, nothing relies on colour alone, and a
     reduced-motion version exists.
   - Content: real copy at real lengths in the product's voice, no lorem ipsum.
   - Feasibility: it can be built with the stack and within scope, the data it shows exists, and heavy media or
     motion is flagged for a performance check.
3. Ask the people who will build it to confirm feasibility, and bring in the studio's designers and reviewers:

{{team}}

4. Verdict: **pass** or **fail**. List blockers (missing states, unbuildable or inaccessible parts) separately from
   suggestions, each with the screen or flow, why it matters and the smallest change that fixes it.
