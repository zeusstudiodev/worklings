# Simple, visible, proven: implementation plan

Spec: `SPEC-v0.2.md`, last section "Simple, visible, proven" (the maintainer, 13 Nov 2026, evening). Branch `run/v0.2`.
Read first: `AGENTS.md`, `docs/architecture.md` ("v3", "Who owns what", "Steering", "Files over messages"),
`docs/design-v3.md` ("Lobby", "Stage and dock"), `docs/design.md` (Type, Layout, Principles).
Out of scope: the approval policy (`src/runtime/approvals.ts`, `shell.ts`), fixed separately.

Decisions taken (coordinator, 13 Nov): progress lives at `/c/<id>/progress` and every entry point lands there
(lobby cards, the lobby's worlds, the needs-you strip, Start, the CLI link); the bare `/c/<id>` stays the 3D office so
every existing address and spec keeps working. The checklist is required on the CEO's plans (`checklist: true`);
test plans get it through a `withChecklist` helper.

## Ground rules

- `src/core/` stays free of Node APIs (the web imports it). Everything computed here is a pure function in `src/core/`
  fed from state that exists today (tasks, reports, `state.spend`, `state.log`, `steering.decisions`, questions,
  approvals). No model call.
- Erasable TypeScript only, `.ts` import extensions.
- Untrusted text (task titles, a reviewer's evidence, quotes) is capped and masked (`redactClip` / `cleanLine`), shown
  as text.
- UI copy: sentence case, plain verbs, no "A · B", titles in sentences through `inSentence`, times through `coarseAge`
  (`src/core/now.ts`), money with the budget beside it. Default views (lobby cards, progress, handover) show no ids,
  paths or tool names.
- Nothing is removed: every address parses as today; every `/` command and palette entry keeps working.
- Contract files that change: only `src/core/company.ts` and `src/core/steering.ts`.

## 1. Data contract

### 1a. `src/core/steering.ts`

```ts
export const CHECKLIST_LIMITS = { items: 20, text: 200, quote: 400, covers: 12, evidence: 600, files: 8, page: 200 } as const;

/** One thing the stakeholder asked for, as a short checkable sentence. */
export interface ChecklistItem {
  /** Stable across versions: "k-1" from the CEO, "k-s1" for the stakeholder's own. */
  id: string;
  text: string;
  /** Their words, exactly as written in the request or a typed message; null when no words fit. */
  quote: string | null;
  /** Plan task ids that build it. Never the final review (kind "verification"). */
  covers: string[];
}
// Plan gains: checklist?: ChecklistItem[]   (absent on plans saved before it)

export const VERDICTS = ['met', 'partly', 'not-met'] as const;
export type Verdict = (typeof VERDICTS)[number];
export type ChecklistState = Verdict | 'unchecked';

export interface ChecklistEvidence {
  note: string;                                     // what was seen, <= CHECKLIST_LIMITS.evidence
  check: { ran: string; passed: boolean } | null;   // the command run and its result
  files: string[];                                  // <= CHECKLIST_LIMITS.files, project paths
  page: string | null;                              // a path on the preview ("/menu"), /^\/[\w\-./?=&%#]*$/
}
export interface ChecklistVerdict { item: string; version: number; verdict: Verdict; evidence: ChecklistEvidence; by: string; task: string; at: number }
export type VerdictInput = { item: string; verdict: Verdict; evidence: string; files: string[]; check: { ran: string; passed: boolean } | null; page: string | null };

export interface ChecklistRow extends ChecklistItem {
  state: ChecklistState;
  verdict: ChecklistVerdict | null;
  tasks: { planTask: string; task: string | null; title: string; status: TaskStatus | 'planned' }[];
}
export interface ChecklistView { version: number; rows: ChecklistRow[]; counts: Record<ChecklistState, number>; reviewedAt: number | null }

// PlanDiff gains: checklist?: { added: ChecklistItem[]; removed: ChecklistItem[]; changed: { before: ChecklistItem; after: ChecklistItem }[] }
// STEERING_TOOLS gains: checkers: ['mark_checklist']   (the CEO and checker seats; see 2c)
// SteeringApi gains: markChecklist(by: string, input: { task: string; items: VerdictInput[] }): ChecklistVerdict[];
```

### 1b. `src/core/company.ts`

```ts
export const STAGES = ['scoping', 'waiting', 'working', 'checking', 'done', 'paused', 'stuck'] as const;
export type CompanyStage = (typeof STAGES)[number];

/** Where a needs-you item opens; the web turns it into an address with companyHref. */
export type NeedsTarget = { panel: 'proposal' } | { panel: 'inbox'; item: string } | { main: 'plan' } | { main: 'progress' };
export interface NeedsYouItem {
  company: string;
  kind: 'proposal' | 'scoping' | 'plan' | 'milestone' | 'question' | 'approval' | 'budget' | 'stuck';
  text: string;            // one plain line
  from: string | null;     // a person's name; null for the office
  at: number;
  target: NeedsTarget;
}

export interface CompanySummary {
  goal: string;                                     // stakeholder's words, one line (goalLine)
  stage: CompanyStage;
  milestones: { done: number; planned: number };
  tasks: { done: number; planned: number };         // plan tasks; follow-ups not counted
  achieved: { title: string; by: string; at: number }[];  // <= 3, newest first
  working: { name: string; task: string | null }[];       // <= 4
  needs: { count: number; items: NeedsYouItem[] };        // count = inbox count; items <= 5, oldest first
  spend: { spent: number; budget: number | null };
  preview: string | null;                           // proxy URL while up; filled by the hub
  movedAt: number | null;
  checklist: Record<ChecklistState, number> | null;
}
// LobbyCompany gains: summary?: CompanySummary

export interface CompanyLooks { last: number | null; previous: number | null }
export const LOOK_GAP_MS = 30 * 60_000;            // a pause longer than this starts a new visit

export interface SinceDigest {
  since: number;
  finished: { title: string; by: string; at: number; files: string[] }[];   // <= 12, newest first; files <= 8
  finishedCount: number;
  decisions: { what: string; by: string; at: number }[];                    // <= 8
  decisionCount: number;
  spent: number;
  waiting: number;                                  // questions and approvals open now
}
// CompanyView gains: looked?: CompanyLooks; since?: SinceDigest | null; checklist?: ChecklistView | null
// CompanyApi gains: markLooked(): void
```

### 1c. Where each value is computed

`src/core/overview.ts` (new, pure):
- `goalLine(prompt)`: first sentence of the prompt (`plainText`, then `clip` 140).
- `stageOf(i)`: `founding` -> scoping; `proposed` or `planWaitingFor(...)` non-null -> waiting; `problem` or `stalled`
  -> stuck; `pause` -> paused; `done !== null` -> done; an open task whose plan kind is `verification` or whose
  `followUp.kind` is `end-check` / `recheck` -> checking; else working.
- `needsYouOf(i, company, now)`: open questions and approvals (`isOpenItem`) with targets `inbox/<id>`; proposal
  waiting -> `proposal`; plan version or milestone waiting -> `{ main: 'plan' }`; stalled -> `{ main: 'progress' }`;
  the budget question has kind `budget`.
- `summaryOf(i: SummaryInput, now)`. `SummaryInput` is a narrow structural type both callers fill:
  `{ id, phase, prompt, goal, tasks, questions, approvals, reports, statuses, log, pause, problem, done, stalled,
  plan: { versions, approved, waiting } | null, planApproval, people: { id, name }[], working: { name, task }[], spent,
  budget, checklist }`.
- `nextLooks(looks, at)`: when `at - last > LOOK_GAP_MS`, `previous = last`; `last = at`.
- `sinceStart(looks, now)`: null when `last` is null; `last` if `now - last > LOOK_GAP_MS`, else `previous` (the
  window stays the same before and after the visit's first post lands).
- `sinceOf(i: SinceInput, since, now)`: finished = tasks `done` with `updatedAt > since`, files from their last done
  `Report.files` else `Task.files`; decisions from `steering.decisions` (by name); spent = sum of `spend` samples with
  `at > since`; waiting = open items.
- `needsAcross(companies: LobbyCompany[])`: every company's `summary.needs.items`, oldest first, at most 8.

`src/core/checklist.ts` (new, pure): `readChecklist(raw, ctx)` (ids kept from the latest version by text, as `Ids`
does in `plan.ts`; covers read by id or title like `after` / `taskByWord`; cut and masked);
`checklistProblems(items, tasks, nameAt, add)` (lint rules in 2a); `carryChecklist(rawPlan, earlier)` (mirrors
`withContracts` in `src/company/plan.ts`, pruning covers of cut tasks); `checklistView(version, verdicts, tasks,
planTasks)`; `checklistLines(view)` (plain lines for the brief and the CEO's notice); `verdictOpenLines(view,
reviewTaskId, open)` (2d).

`src/company/view.ts`: `buildView` adds `looked`, `since` (`sinceStart` + `sinceOf`) and `checklist` (approved, else
latest version, with `steering.verdicts`); `lobbyEntryOf` adds `summary: summaryOf(...)` (`working` from desks in
`AT_WORK` and `currentTask`; check `viewInput()` carries `stalled`).

`src/hub/index.ts`: `lobbyEntryOf(s)` fills `summary.preview` from `previews.view(s.id)` (the URL only while `up`). SSE
(`/events/lobby`, `/events/c/<id>`) carries it unchanged.

`src/core/demo-company.ts`: the demo's `lobbyEntryOf(view, root)` builds `SummaryInput` from the `CompanyView` and calls
the same `summaryOf`.

Last visit: `CompanyState.looked: CompanyLooks`, folded from a new event `{ type: 'looked'; at: number }` in
`src/core/company-state.ts` (add to `EVENT_TYPES`; the reducer applies `nextLooks`; default
`{ last: null, previous: null }` so older `company.json` load). `Company.markLooked()` ignores a call within 60 s of
`last`. New route `POST /api/c/<id>/looked` body `{}` -> 204 (`src/hub/routes.ts`, beside `seen`). The web posts it
when a company's shell opens, then every 5 minutes while visible.

## 2. The checklist in the plan flow

### 2a. Proposing and linting (`src/core/plan.ts`, `src/core/checklist.ts`, `src/core/plan-lint.ts`)

- `CheckPlanOptions` gains `checklist?: boolean`. Only `src/company/plan.ts` `checked(ctx, raw, true)` passes it (the
  CEO's `propose_plan`). `test/plan-only-runs.test.ts` replays keep passing `structure` without it.
- `checkPlan` always reads `raw.checklist` when present: text required, limits, `covers` names this plan's tasks, no
  task twice in one item.
- With `checklist: true`, refused with a sentence, beside `lintProblems` so all problems come back in one answer:
  - no checklist: "The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence,
    quoting their words, with the tasks that cover it."
  - an uncovered item: "The checklist item "…" (k-2) has no task that covers it; name the task that builds it in
    covers, or add one."
  - a task covering none: ""Cart page" (p-3) covers no checklist item; add it to the covers of the item it builds, or
    remove the task." Kinds `integration` and `verification` and the office's `FINAL_REVIEW` are exempt.
- The stakeholder's edit (`editPlan`) carries the checklist when none is sent (`carryChecklist`). An uncovered item is
  not refused there: the UI marks it "No task covers this yet", and `toldCeo` says so.
- `planDiff` (`src/core/planDiff.ts`) and `planChanges` (`plan.ts`) include checklist changes.
- `planSummaryOf` (`src/core/plan-summary.ts`) adds "It checks 7 things you asked for."

### 2b. `propose_plan` (`src/orgtools/steering.ts`)

`CHECKLIST_SCHEMA` (`id`, `text`, `quote`, `covers`) and a `checklist` field (`type: 'data', json: 'list'`,
`minItems: 1`, `maxItems: CHECKLIST_LIMITS.items`), passed through `run` to `proposePlan`. The rule goes in the tool
description, one sentence: "A checklist: each thing the stakeholder asked for, as a short sentence that can be checked,
quoting their words in quote where it can, with the tasks that cover it; every task covers at least one."
`library/roles/ceo.md` body is at 99 of 100 lines: reword step 6's first bullet within its lines ("…its `check`, and
the `checklist` (the stakeholder's asks, quoted, each with the tasks that cover it)"), no new line; run
`npm run lint:library`.

### 2c. Verdicts through an org tool

New `mark_checklist` in `STEERING_TOOL_DEFS` (`task`, `items: { item, verdict, evidence, files?, check?, page? }[]`).
Description: "Mark each checklist item met, partly or not-met with the evidence: the check you ran and its result, the
files, the preview page. Only the final review's owner, on that task." Listed for the CEO and checker seats only
(`steeringToolsFor` takes `Pick<Person, 'id' | 'title' | 'level'>`, adds `STEERING_TOOLS.checkers` when
`level === 'ceo' || isCheckerSeat(p)` from `src/core/size.ts`; mirror in `toolsOf` in `src/company/house-rules.ts`).
`KNOWN_ORG_TOOLS` in `src/runtime/approvals.ts` picks it up by itself (do not edit that file). `src/core/accounting.ts`:
add `mark_checklist` to the checking set.

`Company.markChecklist` (`src/company/company.ts`) refuses with a sentence when the caller doesn't own `task`, `task`
is not open, `reviewKind(task, planKindOf(task))` is null, or an item id isn't in the reviewed version's checklist.
Otherwise it commits steering event `{ type: 'checklist-verdicts'; verdicts }` (`src/core/steering-state.ts`:
`SteeringState.verdicts: ChecklistVerdict[]`, newest per item and version, cap 200, default `[]`) and a `Decision` of
kind `decide`.

### 2d. The final review

- `reviewLines` in `company.ts` (~line 952): with a checklist, step 3 becomes "Judge every item of the checklist in the
  company brief with mark_checklist: met, partly or not met, with its evidence." Step 4 unchanged. Plans without a
  checklist keep today's lines.
- `report()` for a review task (`kind !== null`), before `fixTasks`: for each `not-met` / `partly` verdict from this
  task whose covering tasks aren't named in any `open` line, the office appends
  `"<first covering plan task id> <item text>: <evidence note>"` (`verdictOpenLines`), so verdicts drive the existing
  fix and re-check path. An unmarked item stays `unchecked`, never counted as passed.
- `brief.ts` `briefOf` gains `## Checklist` (id, text, quote, covering task titles).
- `settleFinish`'s message to the CEO adds the counts ("The checklist: 6 met, 1 partly met, 0 not met."). The handover's
  fixed shape in `house-rules.ts` (~line 164) stays.

### 2e. The handover

`web/src/company/inbox/handoverModel.ts` `handoverOf` also returns the checklist rows; `HandoverCard.tsx` leads with
them: each row's sentence and state word ("Met", "Partly met", "Not met", "Not checked"), evidence one press away (the
check and its result, files, the preview link when `preview.url` is up and `page` is set), then the CEO's paragraphs and
the cost.

### 2f. Editing in the plan approval UI

`web/src/company/plan/planEdit.ts`: `PlanOp` gains `add-item` (item, before), `edit-item` (id, name, set: text/covers),
`cut-item` (id, name); `cut-task` also drops the task from every item's covers; `newItemId(plans)` gives `k-s<n>`;
`describeOp`, `isPlanOp`, `checkDraft` know the new ops. The quote is read-only. New
`web/src/company/plan/Checklist.tsx` above the milestones in `PlanBody.tsx` (edit, add, remove, "Covered by"
multi-select of task titles; uncovered shows "No task covers this yet"). `PlanSummaryCard.tsx` shows the item count.

## 3. UI (package B)

### 3a. The lobby (`web/src/company/lobby/`)

- `LobbyCard.tsx` (new) replaces the body of each `.lobby-row` in `Lobby.tsx`, keeping `data-focus`, Remove and Open
  the inbox. Rich rows in the panel's one sheet (`docs/design.md`), not floating cards: name; the goal line in quotation
  marks; the stage word and a progress bar ("3 of 5 milestones, 11 of 16 tasks"); "Finished: …" (<= 3); "Now: Lea on
  the menu page" (<= 3); needs-you count and first item; "$4.20 of $20 budget" or "$4.20, no budget"; "Open the
  preview" when up (new tab, rel noopener); "Moved 12 min ago". Pressing it goes to `companyPath(id, 'progress')`.
- `NeedsStrip.tsx` (new) above the cards: heading "Needs you", `needsAcross(lobby.companies)` items as "Company name:
  text", linking to `companyHref(id, routeOf(target))`; hidden when empty.
- `lobbyModel.ts`: `stageWord(stage)` ("Scoping", "Waiting for your OK", "Working", "Checking", "Done", "Paused",
  "Stuck"), `cardLines(summary, now)`, `routeOf(target): CompanyRoute`, pure and tested. A company without `summary`
  (`brokenEntry`) renders today's row.
- `enterCompany` (the worlds' `onEnter`) goes to progress too.

### 3b. The office's progress view

- `address.ts`: `MainView` gains `{ kind: 'progress' }` at path `progress` (`mainOf`, `mainPath`). `/c/<id>` stays the
  office.
- `panelView.ts`: `isBoard` false for progress; `stageModeOf`: progress -> `'office'` on desktops, `'covered'` on
  phones; `peeksAt` office-only; `mainViewTitle` -> "Progress".
- `insets.ts`: `StageFrame` gains `progress?: number | null` (the column's right edge); on desktops `fit.left` and
  `labels.left` become that edge plus 12 px.
- `web/src/company/progress/` (new): `Progress.tsx`, a column left of the stage (`min(560px, 42vw)`, scrolls inside):
  1. the goal in the stakeholder's words; 2. "Needs you" (`needsYouOf` on the view, linking to inbox items or the plan);
  3. "Checklist" (`ChecklistRows.tsx`, shared with the handover); 4. "Milestones" with tasks as status words ("Done",
  "Working", "Checking", "Waiting", "Stuck", "Not started"), owner names, no ids, a task opens `?panel=tasks/<id>`;
  5. "Since you last looked" ("4 tasks finished" with files changed folded under each, "2 decisions", "$1.80 spent",
  "1 question waits"; first visit: "This is your first look."). Model in `progressModel.ts` (pure). Lazy-loaded via
  `mounts.tsx`. Phones: the column fills the main area between the bar and the talk bar.
- `Shell.tsx`: render `Progress` when `main.kind === 'progress'`, measure its right edge into `stageInsets`, keep the
  talk bar and dock. When the phase becomes `running` after Start, navigate to progress (replace, like the
  proposal-to-home redirect ~line 237). Add the looked heartbeat (`actions.looked()`, a no-op in the demo).

### 3c. One More menu (`CompanyBar.tsx`)

`VIEWS` becomes Progress, Office, Tasks (Tasks current on `plan`). The `CompanyMenu` disclosure is renamed **More**: a
"Views" group first (links with `href`: Org chart, Dashboards, Decision log, Spending `dashboards/spend`, Timeline
`dashboards/timeline`, Your messages), then today's items (Customize, Settings, Pause/Resume, Raise the budget, Try now,
Still office, the live strip, phone map keys). More gets `aria-current` while Org, Dashboards or Decisions is the main
view. Phone views row: three keys; the short window's `ViewsMenu` lists all. Re-measure `barFold.ts`. Palette
(`palette/paletteModel.ts`): add `view('progress', 'Open progress', 'progress', 'checklist milestones since overview',
true)`; every `open:*` stays.

### 3d. Demo data (`src/core/demo-company.ts`, `web/src/company/demo.ts`)

Café: `cafePlan` gets a checklist of 5-6 items quoting the café prompt, with covers; verdicts empty;
`looked: { last: now - 3 h, previous: now - 26 h }`, `since` from `sinceOf`. A new finished company
(`demoFinishedView`): stage done, a CEO handover report, verdicts 5 met and 1 partly with evidence, preview null; add to
`demoCompanies` and `DEMO_ROOTS`. Demo lobby entries get `summary` via `summaryOf`. `DemoHub` gains a no-op `looked()`.
Check the static site router (`web/src/site/router.ts`) handles the new path.

## 4. Work packages

| Package | Owns (no overlap) | Starts |
|---|---|---|
| A, core and server | `src/core/{company,steering,overview,checklist,plan,plan-lint,planDiff,plan-summary,company-state,steering-state,accounting}.ts`, `src/company/**`, `src/orgtools/**`, `src/hub/**`, `src/cli.ts` (the link to progress, ~line 381), `library/roles/ceo.md`, unit tests and kits under `test/` (not `test/e2e/`, not `test/fake-desk.mjs`) | first |
| B, web | `web/src/**`, `src/core/demo-company.ts`, `docs/design-v3.md` | after A1 |
| C, e2e | `test/e2e/**`, `test/fake-desk.mjs` scenarios, `playwright.config.ts` if needed | baseline at once; specs after A2 and B |

1. **A1, the contract (hand-off point):** the types in 1a/1b, `overview.ts`, `checklist.ts` and their unit tests,
   committed alone. New fields optional, no behaviour change.
2. In parallel: **A2** (checklist rules in `checkPlan` / `propose_plan`, verdicts, `looked`, `buildView`, the lobby
   summary, brief, review lines, route, CLI link; `withChecklist(plan)` in `test/steering-plan-kit.ts` used at the ~37
   `proposePlan` call sites: `grep -rln "proposePlan(\|propose_plan" test`), **B** (against A1's types and demo data),
   **C step 0** (baseline and fixtures, section 6).
3. **C finishes** specs once A2 and B are merged; then a full `npm run e2e`. A2 breaks the fake CEO's `propose_plan`
   in e2e until C adds checklists to `PLAN`, `PLAN_V2`, `PLAN_CONTRACTS` in `test/e2e/v3-world.ts`: merge them together.

## 5. Tests

A (unit): `test/overview.test.ts` (`stageOf` for the 7 stages, paused/stuck beat working; `summaryOf` counts without
follow-ups; achieved order and cap; `needsYouOf` targets; `nextLooks` / `sinceStart` around `LOOK_GAP_MS`; `sinceOf`;
no ids or paths in text fields). `test/checklist.test.ts` (stable ids, covers by title, uncovered item refused, task
covering none refused, integration/verification/FINAL_REVIEW exempt, missing checklist refused only with
`checklist: true`, the stakeholder's edit carries and prunes, `checklistView` states and counts, `verdictOpenLines`).
`test/plan-lint.test.ts` cases; one `test/plan-only-runs.test.ts` replay with a checklist added.
`test/company-checklist.test.ts` (propose with a checklist, each `markChecklist` refusal, not-met becomes a fix task
through `fixTasks`, re-check, `settleFinish` counts, verdicts survive a restart). `test/company-looked.test.ts` (60 s
throttle, visit gap, restart, old `company.json`). `test/company-brief.test.ts` (checklist section).
`test/orgtools-steering.test.ts` (`mark_checklist` for the CEO and checker seats only; `propose_plan` has `checklist`),
`test/orgtools-steering-house-rules.test.ts`. The hub's lobby test (grep `api/lobby` in `test/hub-*.test.ts`):
`summary` present, `preview` filled while up; `POST /looked` 204, extra fields refused. `test/hub-integration.test.ts`
still passes.

B (unit): `panels-shell-address.test.ts` (progress parses and round-trips, old addresses unchanged),
`stage-insets.test.ts`, `panels-shell-views.test.ts`, `panels-shell-model.test.ts`, `panels-shell-lobby.test.ts`
(cards, strip, `routeOf`), `steering-plan-edit.test.ts` (checklist ops, cut-task prunes covers), new
`progress-model.test.ts`, the `handoverModel` test (checklist leads), `panels-shell-demo.test.ts` / `demo-*.test.ts`,
`panels-steering-palette.test.ts` (`open:progress`).

C (e2e): `v3-kit.ts` (`ViewName` adds `'Progress'`; `switchTo` / `viewLinks` open More for Org and Dashboards;
`openProgress(page, id)`); update `v3-shell`, `v3-boards`, `v3-history`, `v3-company`, `v3-every-state`,
`v3-fullscreen`, `v3-site-storage`, `v3-spending`, `v3-web-fixes-2` ("Company" menu is now "More"); `v3-lobby`
(cards, the strip opens the right office and panel, stage words); new `v3-progress.spec.ts` (lobby lands on progress
with the stage drawn behind; needs-you links; since-you-last-looked after a second visit; More reaches every former
view; old addresses open); `v3-steering-plan` (edit, add, remove a checklist item before approval); a final-review spec
(fake-desk scenario `review` calls `mark_checklist` then `report`; the handover leads with the checklist). Screens at
1440 and 375 px (`v3`, `v3-phone`; `test-results/evidence/`), lobby, progress and handover also in `STAGE_SPECS` for
`v3-1024`.

Done means typecheck, lint, `lint:library`, `npm test` and the full `npm run e2e` are green.

## 6. Open items that interact

1. `v3-spending.spec.ts` plan-with-contracts (17 of 18, cause unknown) proposes `PLAN_CONTRACTS` through the fake CEO.
   C step 0: add `test/e2e-fixture-plans.test.ts` running `PLAN`, `PLAN_V2`, `PLAN_CONTRACTS` through `checkPlan` with
   the company's own options; a refusal is the likely cause (also in the e2e company's `.worklings/refusals.jsonl`).
   Fix, then add the checklists.
2. Run the full `npm run e2e` once before A2 and B merge, to record failures that predate this work.
3. The real runs (cost) are the coordinator's call after the e2e is green.
4. Docs: `docs/architecture.md` (the `looked` route, `mark_checklist`, new core modules, `progress` in the address
   table); `docs/design-v3.md` "Progress" and "Lobby" (B); an AGENTS.md gotcha: "CEO plans need a checklist
   (`checklist: true`); test plans use `withChecklist`."
5. The phase-split linter rule shares `plan-lint.ts` / `checkPlan`: coordinate so refusals come back in one answer.
6. `.claude/runs/v0.2/checklist.json`: add items for this section.
