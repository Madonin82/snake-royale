# Snake Royale — AI Brains Plugin System (Phase 1 refactor; Phase 2 specified, do not build yet)

**Repository:** Madonin82/snake-royale
**Base commit:** `origin/main` @ `3a8ed4a`. Before starting, run `git fetch origin main` and verify HEAD. If main has moved past `3a8ed4a`, re-check every line reference below against the current tree before writing code.
**Scope:** Implement **Phase 1 only**, as a single PR. Phase 2 is specified at the end of this document for a later PR — do not implement any of it in the Phase 1 PR.
**Hard constraints:** No Firebase changes of any kind (no rules, no functions, no services). Do not touch `src/game/engine.ts`. Do not change App.tsx logic (it should need no changes at all — the `'./game/ai'` import path is preserved by the new folder's index). No balance changes: any tuning number that looks wrong gets moved as-is.

---

## Goal

All bot AI currently lives in one 1,245-line file, `src/game/ai.ts`. There is no named, stored "brain" anywhere — a bot's behaviour is whatever the planner code and its inline constants happen to be, so any future tuning edit silently replaces the current behaviour.

Phase 1 turns brains into plugins: one file per brain under `src/game/ai/brains/`, a registry that resolves brains by name, the current live behaviour frozen as a named brain (the **Opportunist**) and kept as the default dispatch, and the pre-`3a8ed4a` bot line (which survives only in git history at commit `611c236`) restored verbatim as a second named brain (**legacy**), selectable by name only, never the default.

**Live behaviour must not change.** Default/quickplay bots play exactly as they do at `3a8ed4a` at every difficulty. The only new behaviour is that the legacy brain becomes selectable in the level editor / campaign.

## Current state (verified at `3a8ed4a`)

- `src/game/ai.ts` (1,245 lines) holds all AI. Exports used elsewhere: `calculateAIAction`, `calculateAIMove`, `calculateAIMoveCandidates`, `buildAIPlan`, `planDiverged`, and types `AIActionResult`, `AIPlanResult`, `ChainIntent`. App.tsx imports all of them from `'./game/ai'` (App.tsx:19) and calls `buildAIPlan` at App.tsx:1298 with `{ gameState, gridSize, botRole, difficulty, aiStyle, skillsAvailable, raceTurns, intent }`, where `aiStyle = campaignAiStyles[snakeId] ?? settings.aiStyle` and difficulty is likewise per-snake.
- Difficulty EASY/MEDIUM/HARD is a parameter, not a module. Differences are inline: opponent-threat nudge 0/8/25 in `rateAIMoves` (ai.ts:410-411); chain multiplier caps 1 / min(tsl+1, 2) / min(tsl+1, 3) (ai.ts:443-445); EASY's 25% random second pick (ai.ts:552).
- Styles GREEDY/TURTLE/CUTOFF/HEADHUNTER/PATROL/AVALENA are declared (`src/types/game.ts:71`, `src/editor/levelSchema.ts:6`) but the scorer never reads them — `rateAIMoves` does not take a style. In campaign playtest they act only as difficulty presets (`src/editor/playtestSession.ts`: GREEDY→HARD, TURTLE→EASY, CUTOFF→MEDIUM, HEADHUNTER→HARD, PATROL→MEDIUM, AVALENA→HARD).
- Avalena is the only truly separate brain today: `calculateAvalenaAction` (ai.ts:92) plus helpers `isDartCellSafe`, `getOpponentThreatCells`, `calculateHuntMoveTowardTarget`, special-cased by name in `calculateAIAction` (ai.ts:81-84), `calculateAIMove`, `calculateAIMoveCandidates`, and `buildAIPlan` (ai.ts:1001).
- Four behaviours actually run today: EASY (greedy per-ply loop), MEDIUM (beam planner, no cross-lock intent), HARD (beam planner + chain intent + posture), AVALENA (custom).
- The current planner (`buildAIPlan`, ai.ts:984) dispatches: EASY or Avalena → greedy per-ply loop; otherwise → beam path (top-2 candidates per ply, `MAX_SIM_DEPTH` 3). HARD additionally carries `ChainIntent` across locks. Tuning constants at ai.ts:633-641: `CHAIN_SP_WEIGHT 10`, `HEAD_ON_WIN_BONUS 300`, `IN_SIM_HEAD_ON_LOSS -10000`, `INTENT_CASH_BONUS 30`, `INTENT_STEP_BONUS 5`, `SETUP_VALUE_DISCOUNT 0.5`, `PROTECT_AREA_PENALTY 400`, `PROTECT_CONTEST_PENALTY 150`, `MAX_SIM_DEPTH 3`. Posture gates (`computePosture`, ai.ts:915): late-game only; PROTECT = score lead AND no length deficit; CHASE = score deficit.
- The pre-`3a8ed4a` code at commit `611c236`: `src/game/ai.ts` is 555 lines, there is no `buildAIPlan`, and App.tsx drove the old planner through `calculateAIAction` / `calculateAIMove` (the per-ply `calculateAIAction` drive is at App.tsx:1281 in that commit's tree). Note: in that commit, `calculateAIAction` takes an object argument — a different signature from today's.

## Design

### Directory layout

```
src/game/ai.ts            → deleted (becomes the folder below)
src/game/ai/
  index.ts                public API — same exported names & signatures as today's ai.ts
  types.ts                BrainProfile, AIBrain, shared AI types
  registry.ts             BRAINS map, getBrain(), listBrains()
  planner.ts              beam planner (buildAIPlan core), parameterized by profile; planDiverged, finishPlan
  greedy.ts               greedy per-ply planning loop (today's EASY/Avalena path inside buildAIPlan)
  shared/
    sim.ts                SimState/SimSnake, initialSim, advanceSim, simToGameState, tiebreak & threat helpers
    rating.ts             rateAIMoves (profile-parameterized), floodFillArea
    posture.ts            computePosture, computeLockCount, findClusters, clusterChainValue
  brains/
    legacy.ts             whole-code frozen snapshot lifted from 611c236 (see roster)
    opportunist.ts        FROZEN profile — the current planner, values verbatim (below)
    avalena.ts            calculateAvalenaAction + its helpers, moved verbatim
```

Layout rules:

- **Shared substrate, per-brain profile.** Simulation, rating, and posture code exist exactly once, in `shared/` + `planner.ts`. Profile-based brains differ only by their `BrainProfile` values and planner path — never by copied code. Do not fork `ai.ts` per brain. **One deliberate exception:** `brains/legacy.ts` is a whole-code historical snapshot and does NOT use the shared substrate.
- A brain gets its own planning *code* only when its behaviour truly diverges (Avalena is the existing example). That code lives in its brain file.
- Nothing in this PR changes any behaviour, number, or dispatch outcome for existing play. It is a move + parameterize + register refactor, plus one addition: the legacy brain, reachable only by name.

### The brain contract (`types.ts`)

```ts
export interface BrainProfile {
  planner: 'beam' | 'greedy';
  enableIntent: boolean;            // carry ChainIntent across locks (beam, HARD today)
  chainSpWeight: number;
  headOnWinBonus: number;
  inSimHeadOnLoss: number;
  intentCashBonus: number;
  intentStepBonus: number;
  setupValueDiscount: number;
  protectAreaPenalty: number;
  protectContestPenalty: number;
  maxSimDepth: number;
  beamCandidates: number;           // top-N rated candidates expanded per ply (today: 2)
  threatNudge: { EASY: number; MEDIUM: number; HARD: number };
  chainCap:    { EASY: number; MEDIUM: number; HARD: number };  // chainMult = min(tsl + 1, cap); EASY cap 1 reproduces today's flat 1
  easyRandomSecondPick: number;     // probability EASY takes the 2nd-rated move (today: 0.25)
}

export interface AIBrain {
  id: string;                       // lowercase; matched case-insensitively against aiStyle
  label: string;
  profile: BrainProfile;
  plan(args: BuildAIPlanArgs): AIPlanResult;
  action?(args: AIActionArgs): AIActionResult;   // custom brains only (Avalena)
}
```

`rateAIMoves` and the beam planner take a `BrainProfile` and read every constant from it. After this PR, no tuning number remains hard-coded inside planner/rating code.

### The v1 roster

1. **`opportunist`** — the current live brain, and the default. A profile brain on the shared substrate. Beam planner, `enableIntent: true`, profile frozen at exactly the current values:
   `chainSpWeight 10, headOnWinBonus 300, inSimHeadOnLoss -10000, intentCashBonus 30, intentStepBonus 5, setupValueDiscount 0.5, protectAreaPenalty 400, protectContestPenalty 150, maxSimDepth 3, beamCandidates 2, threatNudge {0, 8, 25}, chainCap {1, 2, 3}, easyRandomSecondPick 0.25`.
   Its `plan` keeps the current code shape: beam path for MEDIUM/HARD; the greedy per-ply loop for EASY routes through `greedy.ts`, exactly as today.
   File header comment, exactly: `FROZEN — current planner as merged in 3a8ed4a. Do not tune this file. To change this behaviour, create a new brain.`
2. **`legacy`** — the pre-`3a8ed4a` bot line, preserved as a whole-code freeze. Lift verbatim from commit `611c236`: that commit's `src/game/ai.ts` (555 lines — its `calculateAIAction` / `calculateAIMove` and everything under them) **plus** the pre-`3a8ed4a` planning loop that lived in App.tsx (the per-ply `calculateAIAction` drive at App.tsx:1281 @ `611c236`). One brain with three difficulty faces (EASY/MEDIUM/HARD), shaped exactly as the code was then. Only the outer surface is adapted to the `AIBrain` contract; internal code and signatures stay as lifted (the `611c236` `calculateAIAction` takes an object argument — it keeps doing so, inside `legacy.ts`). It does not import from `shared/`. Selectable only by name (the `LEGACY_EASY` / `LEGACY_MEDIUM` / `LEGACY_HARD` styles, below); never the default.
   File header comment, exactly: `FROZEN SNAPSHOT — pre-3a8ed4a bots, lifted verbatim from 611c236. Do not edit. Tuning happens on forks (new brains), never here.`
3. **`avalena`** — custom brain. Its functions move verbatim from the current ai.ts; its `plan` is today's greedy loop driven by its `action` (including the dart gates), exactly as `buildAIPlan` runs it now.

### What "frozen" means (design constraints, not commentary)

- For profile brains (Opportunist and future brains like it), the freeze pins **tuning values only**, enforced by a frozen-profile test (see Build steps). Behaviour is *not* hermetically pinned: the shared substrate (flood-fill veto, lock counts, dart gates, the sim) is shared on purpose, so a future substrate fix moves every profile brain at once. That is intended — do not "fix" it by copying substrate code into brain files.
- The legacy brain is the exception: frozen as whole code; substrate edits must not affect it (it imports nothing from `shared/`).
- The frozen-profile test catches accidental edits; it cannot stop a deliberate edit that also updates the test table. Therefore: treat `brains/legacy.ts`, `brains/opportunist.ts`, and the frozen test tables as **do-not-modify files** in any future work. Both brain files carry a header line stating this.

### Registry & dispatch

`registry.ts` holds `BRAINS: Record<string, AIBrain>` and:

- `getBrain(aiStyle?)` — case-insensitive lookup; unknown or undefined style returns the **Opportunist** (the live default). It never throws.
- `listBrains()` — all registered brains (for editor/tests).

Public API functions in `index.ts` dispatch through the registry, **preserving today's live dispatch exactly**:

| Call | Resolution |
|---|---|
| style is `avalena` (any case) | Avalena brain — action & plan — at any difficulty |
| style is `legacy_easy` / `legacy_medium` / `legacy_hard` (any case) | Legacy brain at that difficulty face |
| style is `opportunist` (any case) | Opportunist brain, at the given difficulty (beam; intent only on HARD, as today) |
| difficulty EASY, any other style or no style | Opportunist brain's greedy face (greedy loop incl. the 0.25 random pick) — exactly as today |
| difficulty MEDIUM/HARD, any other style (incl. GREEDY/TURTLE/etc.) or no style | Opportunist brain (beam; intent only on HARD) — exactly as today |

Single-move APIs (`calculateAIAction`, `calculateAIMove`, `calculateAIMoveCandidates`) keep their current signatures; internally they resolve the brain the same way. Behaviour preservation is judged **per brain against its own source**: the Opportunist/Avalena against the current code (existing test fixtures), the legacy brain against `611c236` (golden-master, see Build steps).

### Making brains selectable

- Add `'OPPORTUNIST' | 'opportunist'` to the `aiStyle` union in `src/types/game.ts` and to `CampaignAiStyle` in `src/editor/levelSchema.ts`.
- Add `OPPORTUNIST: 'HARD'` (and lowercase `opportunist: 'HARD'`) to the playtest difficulty map in `src/editor/playtestSession.ts`.
- Add an `OPPORTUNIST` option to the spawn style dropdown in `src/editor/LevelEditor.tsx` (next to the existing `AVALENA` option, ~line 902).
- Add `'LEGACY_EASY' | 'LEGACY_MEDIUM' | 'LEGACY_HARD'` (and lowercase forms) to the same style unions; add `LEGACY_EASY: 'EASY'` / `LEGACY_MEDIUM: 'MEDIUM'` / `LEGACY_HARD: 'HARD'` (and lowercase forms) to the playtest difficulty map; add the three matching options to the editor dropdown. Legacy selection is editor/campaign-only in v1 — do not add a legacy picker to quickplay.
- Default settings are unchanged: a bot with no explicit brain plays exactly as it does today.

### How a future brain is added (document this in `registry.ts` as a comment)

1. Copy **the parent brain's file** → `brains/<new-id>.ts`. Change `id`, `label`, and the profile values (or give it custom plan/action code if it truly diverges). Never copy `legacy.ts` as a tuning starting point in code form — a fork of the legacy line is expressed as a profile brain whose values are chosen deliberately, with parentage noted in its header comment.
2. Register it in `registry.ts` (one entry).
3. Add its name to the style unions + editor dropdown + playtest difficulty map (as done for OPPORTUNIST above).
4. Add its id to the registry test.

No edits to App.tsx, the planner, or any other brain. If adding a brain appears to require one, stop — that indicates a design problem; report it instead of working around it.

## Phase 1 build steps (in order, one PR)

1. **Baseline first:** on clean `origin/main`, run `npm test` and `npm run lint` (tsc); record the test count in the PR description. All later comparisons are against this baseline.
2. **Lift the legacy brain:** create a scratch worktree at `611c236`, copy its `src/game/ai.ts` content into `brains/legacy.ts`, and reconstruct its `plan` from the pre-`3a8ed4a` App.tsx planning loop (App.tsx @ `611c236`, the `calculateAIAction` drive ~line 1281). Adapt only the outer `AIBrain` surface. Then **golden-master it before going further:** a scratch harness runs a fixed set of boards × all three difficulties through (a) the original `611c236` code in its worktree and (b) the new legacy brain — chosen moves/plans must match exactly. Keep the harness result summary in the PR description; add fixture tests capturing a representative board per difficulty face.
3. Move the current code verbatim into the layout above; `index.ts` re-exports the public API. `src/game/ai.test.ts` stays where it is and keeps importing `'./ai'` (directory index). Run tests — if `'./ai'` does not resolve to the folder under the test runner, move the test file into `src/game/ai/` and fix its import; note which happened in the PR description.
4. Parameterize: replace the planner/rating constants with profile reads; create `brains/opportunist.ts` with the frozen values and header. Diff-check: no numeric literal changes anywhere.
5. Extract `avalena`; wire the registry dispatch per the truth table above. (There is no separate "classic" brain; the greedy loop remains as shared machinery in `greedy.ts`, used by the Opportunist's EASY face and Avalena's plan.)
6. Add the OPPORTUNIST and LEGACY_* style plumbing (unions, playtest map, editor options).
7. New tests (`src/game/ai/registry.test.ts` or alongside): (a) every registered brain id resolves via `getBrain`, case-insensitively; (b) unknown style falls back to the Opportunist without throwing; (c) **frozen-profile test** — `opportunist.profile` deep-equals the constant table in this spec; (d) each brain returns a legal plan on one existing fixture board from `ai.test.ts`.
8. Full suite + tsc; live smoke test (below); detailed PR description (baseline vs final counts, what moved where, confirmation that no current tuning constant changed, golden-master summary for the legacy lift). Existing `ai.test.ts` cases describe the current planner's behaviour: where a case relied on default dispatch, add the explicit OPPORTUNIST selection so it binds to the right brain — **test call-site changes for brain selection are allowed; assertion changes are not.**

## Phase 1 out of scope (explicitly)

- Any new bot behaviour or tuning work (e.g. exit preservation, fallback time-to-clear, ring-telegraph handling). Those land in later PRs as new brain files per the plugin contract above. Not here.
- Re-tuning the legacy line or "improving" the lifted code while restoring it. The lift is verbatim; if a lifted number looks wrong, it ships as-is.
- Any balance change, however small.
- Renaming existing styles, changing difficulty presets, or touching `engine.ts`, networking, or App.tsx logic.
- Phase 2 (below) — do not implement it in this PR.

## Phase 1 acceptance criteria

- `npm test`: all tests pass — the baseline count from step 1, plus the new registry/frozen-profile tests and the legacy golden-master fixture tests. Existing `ai.test.ts` **assertions** pass unmodified (the existing fixtures are the Opportunist's behaviour contract; call sites may gain explicit brain selection per Build step 8).
- `npm run lint` (tsc) clean.
- Diff touches only: `src/game/ai.ts` (deleted), `src/game/ai/**`, `src/game/ai.test.ts` (only if step 3's fallback fired), `src/types/game.ts`, `src/editor/levelSchema.ts`, `src/editor/playtestSession.ts`, `src/editor/LevelEditor.tsx`.
- Live smoke test: (1) quickplay vs HARD CPU plays indistinguishably from today; (2) EASY still plays the greedy path with occasional random picks; (3) a campaign spawn with style AVALENA still hunts and darts; (4) a campaign spawn with style OPPORTUNIST plays the beam brain; (5) a campaign spawn with style LEGACY_HARD plays the pre-`3a8ed4a` Hard (its golden-master fixtures are the contract); (6) swapping a spawn's style in the editor and re-entering playtest swaps its brain with no other changes.
- The frozen-profile test passes, and fails if a value in `brains/opportunist.ts` is edited (this is demonstrated by the test existing and passing, not by deliberately breaking it). The legacy brain's freeze is guarded by its golden-master fixtures plus its header rule.

---

# Phase 2 — Brain Tuner (level-editor sliders for brain profiles)

**Separate PR. Build only after Phase 1 has merged. Do not implement any of this in the Phase 1 PR.** Nothing in this section changes Phase 1's scope or acceptance criteria.

## Purpose

Phase 1 makes a brain a page of named numbers (`BrainProfile`). The Tuner is a level-editor UI over that page: set a bot spawn's brain, adjust its profile with sliders, playtest immediately, and keep the result either inside the level JSON or exported as a new named brain file. Every control maps to exactly one `BrainProfile` field.

## Where it lives

- New component `src/editor/BrainTuner.tsx`, rendered inside each bot spawn card (spawns with `index > 0` — the same spawns that get the AI STYLE select in `LevelEditor.tsx`), directly under that select. Collapsed by default behind a "BRAIN TUNER" toggle.
- Header line shows the resolved state, exactly one of:
  - `Using OPPORTUNIST (unedited)` — spawn has no custom profile.
  - `Custom — based on OPPORTUNIST, 3 values changed` — spawn carries a forked profile; the count and names come from diffing the fork against its parent brain's profile.
- Editor state flows through the existing `updateSpawn(index, { … })` helper, like every other spawn field.

## The controls (every `BrainProfile` field gets one)

Each control is a slider **plus** a numeric input showing the exact value; both clamp to the stated range. Triples (`threatNudge`, `chainCap`) render as three mini-controls labelled E / M / H.

| Group | Field | Control | Range / step |
|---|---|---|---|
| CHAIN GREED | `chainSpWeight` | slider | 0–30, step 1 |
| CHAIN GREED | `chainCap` (E/M/H) | 3 steppers | 1–5, step 1 |
| AGGRESSION | `headOnWinBonus` | slider | 0–600, step 10 |
| AGGRESSION | `inSimHeadOnLoss` | slider, labelled "VETO STRENGTH (more negative = harder veto)" | −10000–0, step 500 |
| PATIENCE | `setupValueDiscount` | slider | 0–1, step 0.05 |
| PATIENCE | `intentCashBonus` | slider | 0–100, step 5 |
| PATIENCE | `intentStepBonus` | slider | 0–20, step 1 |
| PATIENCE | `enableIntent` | checkbox "HOLD CHAIN SETUPS" | on/off |
| SELF-PRESERVATION | `protectAreaPenalty` | slider | 0–800, step 25 |
| SELF-PRESERVATION | `protectContestPenalty` | slider | 0–400, step 25 |
| SELF-PRESERVATION | `threatNudge` (E/M/H) | 3 sliders | 0–50, step 1 |
| VISION | `maxSimDepth` | stepper | 1–4, step 1 |
| VISION | `beamCandidates` | stepper | 1–4, step 1 |
| LUCK | `easyRandomSecondPick` | slider | 0–0.5, step 0.05 |

Panel rules:

- VISION carries a warning when `maxSimDepth > 3` or `beamCandidates > 2`: "Slower planning — watch think time."
- PATIENCE controls are greyed out with the note "Intent applies to beam brains on HARD" when the spawn's brain doesn't use intent or the spawn's preset difficulty is EASY.
- `planner` ('beam' | 'greedy') is shown read-only. Switching planner is a different kind of brain, not a tuning change — not a Tuner control.
- **Avalena is not tunable:** if the spawn's style is AVALENA, the panel shows "AVALENA uses a custom brain — profile knobs don't apply" and no controls. Its behaviour is code, not profile values.
- **Legacy spawns are not tunable either:** if the spawn resolves to the legacy brain, the panel shows "LEGACY is a frozen snapshot — tuning happens on a fork" and no controls. The legacy line's numbers live inside lifted whole code, not a profile; tuning work starts from the live line (the Opportunist and its descendants), not from the legacy line.

## Copy-on-write (required behaviour)

- `SpawnConfig` (`src/editor/levelSchema.ts`) gains one optional field: `brainProfile?: BrainProfile`. Absent = the spawn uses its registered brain untouched.
- The **first** control change on an unedited spawn deep-clones the resolved brain's profile (from the Phase 1 registry) into `spawn.brainProfile`; subsequent changes edit only that clone, via immutable updates.
- A registered brain's profile object is **never mutated** by the Tuner or by playtest resolution. This is what keeps the Phase 1 frozen-profile test meaningful while tuning exists.
- A "RESET TO \<BRAIN LABEL\>" button appears whenever `brainProfile` is present; it clears the field back to `undefined`.
- The changed-values diff compares top-level fields and names them in a small list under the header. For the two triples (`threatNudge`, `chainCap`), the header count only counts the triple as changed when the component matching the **spawn's effective difficulty** differs. The non-effective faces stay editable but live in a collapsed "other difficulties" subgroup, and differences there are listed separately from the header count.

## Playtest wiring

- `GameSettings` (`src/types/game.ts`, beside the existing `campaignAiStyles` at line 73) gains `campaignBrainProfiles?: Record<string, BrainProfile>`.
- `getCampaignPlaytestSettings` (`src/editor/playtestSession.ts`) fills it exactly the way it already fills `campaignAiStyles`: from enabled bot spawns, keyed `p${index + 2}`, including only spawns that carry a `brainProfile`.
- Phase 2 extends the Phase 1 API: `BuildAIPlanArgs` gains optional `profileOverride?: BrainProfile`. Effective profile = `profileOverride ?? brain.profile`. The override is a *complete* profile (the editor stores full clones), so there is no partial-merge semantics to define.
- **Threading requirement (critical):** the override must thread through **every** API the planner calls, not just the top-level ones. `buildAIPlan`'s greedy loop calls `calculateAIAction` per ply, and `finishPlan` falls back to `calculateAIMove`. If only `buildAIPlan` and `calculateAIMove` accept the override, a tuned greedy-path spawn silently re-resolves the registered profile mid-plan and ignores its tuning. Therefore:
  - `calculateAIAction` gains the same optional trailing profile parameter.
  - `buildAIPlan` passes its effective profile down into **every** `calculateAIAction` / `calculateAIMove` call it makes (greedy loop, beam candidate rating, `finishPlan`).
  - App.tsx passes `s.campaignBrainProfiles?.[snakeId]` at both of its AI call sites (the `buildAIPlan` call ~App.tsx:1298 and the `calculateAIMove` call ~App.tsx:3204).
  - **One deliberate exception:** the simulation's opponent modelling (`advanceSim` calls `calculateAIMove(view, …, 'HARD')` for the *other* snakes) never receives the override. Opponents are projections and are modelled with default registered behaviour; the override governs only the tuned snake's own decisions.
- Per-snake chain-intent refs in App.tsx are unaffected.

## Saving and graduating a tuned brain

- **In the level:** `brainProfile` rides inside the level JSON's spawn object when the level is saved — a level can ship with its own custom boss brain, no code involved. Older levels (no field) load unchanged.
- **Export brain:** a button in the panel, visible when `brainProfile` is present, downloads `brains/<slug>.ts` — a complete brain file in the same shape as `brains/opportunist.ts` (id = slugified spawn name, fallback `custom-brain`; label = spawn name) with the forked profile as its literal. Dropping it into `src/game/ai/brains/` plus the registry/style steps from Phase 1's plugin contract turns the draft into a permanent named brain. The exported file's header comment says exactly that.
- Importing brain files through the editor is out of scope.

## Phase 2 build steps

1. `brainProfile` on `SpawnConfig`; pure helpers `forkProfile` / `diffProfileFields` (in `BrainTuner.tsx` or a small `brainTunerUtils.ts`) with unit tests — DOM-free.
2. `BrainTuner` component + mount in the spawn card; copy-on-write and reset wired through `updateSpawn`.
3. Playtest wiring: `campaignBrainProfiles` through settings; `profileOverride` threading per the requirements above; App.tsx call sites.
4. Export-brain download.
5. Tests (below), full suite + tsc, live smoke test; detailed PR description.

## Phase 2 tests & acceptance

- Unit: `forkProfile` returns a deep copy (mutating the fork leaves the registry profile untouched); `diffProfileFields` names exactly the changed top-level fields.
- Unit: `getCampaignPlaytestSettings` maps a spawn's `brainProfile` to the correct snake id in `campaignBrainProfiles`, and omits spawns without one.
- Unit: `buildAIPlan` with a `profileOverride` (e.g. `headOnWinBonus: 0`) reflects the override, and `BRAINS.opportunist.profile` still deep-equals the frozen Phase 1 table afterwards.
- Unit (threading regression): a greedy-path plan (EASY difficulty) built with a `profileOverride` reflects the override in its per-ply `calculateAIAction` decisions — on a board where the registered profile and the override choose different moves, the plan follows the override for the whole plan, not just the first ply.
- Round-trip: a level JSON containing a spawn `brainProfile` serializes and reloads with values intact.
- Full suite + `npm run lint` clean. Phase 1's frozen-profile test still passes.
- Live smoke test: (1) open a bot spawn, move one slider → header flips to "Custom — based on OPPORTUNIST, 1 value changed"; (2) playtest — the bot visibly plays the tuned profile (e.g. `chainSpWeight` 0 + `headOnWinBonus` 0 stops token-chasing and duel-seeking); (3) RESET restores the unedited state; (4) save the level, reload the editor, the custom profile is still there; (5) export, drop the file into `brains/`, add the registry line — the game compiles and the new brain is selectable.

## Phase 2 out of scope

- A tuner in the quickplay/settings menus (editor only).
- Tuning Avalena, the legacy brain, or any future custom-code brain.
- Switching a brain's `planner` from the Tuner.
- Automated tuning sweeps / bot-vs-bot optimisation.
