---
name: release-gate
description: >-
  The final go or no-go before a release: checks that every gate passed with evidence, that the release build is the
  one tested, and that version, notes, configuration, migrations, rollback and monitoring are ready, then brings a
  one-screen recommendation to the person, who decides. Use as the last step before anything is deployed, published
  or submitted.
worklings:
  kind: gate
  department: ops
  from: ops
  to: direction
---
# Release gate

The lead runs this gate and brings the result to the person. A "go" here is a recommendation; only the person's
explicit OK releases anything.

1. Collect what ships: the changes since the last release, the version, the target (site, store, registry, client),
   and the plan or acceptance criteria it was built against.
2. Check the evidence:
   - Every gate the studio uses passed for this change, with its evidence recorded; a gate without evidence counts
     as not run.
   - Typecheck, lint, tests and the production build are green on the exact commit that will ship.
   - The artifact being released is the one that was tested.
3. Check readiness:
   - The version is bumped everywhere it lives, and the changelog or release notes are written for users.
   - Configuration and secrets are set in the target, migrations are ready and backward compatible, feature flags
     are set.
   - Rollback: the previous version, the exact way back, how long it takes, and what happens to data written in
     between.
   - Monitoring: where to watch errors and logs after the release, and what would trigger a rollback.
   - Target-specific items: store listing and reviewer notes, signing, client approval, legal pages, announcement.
   - Known issues are written down, and no blocker is open.
4. Bring in the people who own each part:

{{team}}

5. Bring the person one screen: **go** or **no-go** with your reasons, what ships, the evidence per gate, the risks,
   the rollback plan and the exact commands that will run. Then wait for their decision.
