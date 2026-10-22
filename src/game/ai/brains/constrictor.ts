// CONSTRICTOR — the main-game HARD brain (Jimmy's ruling, 2026-10-22).
// Built as the Changes 10–12 offense fork from v2 (working id "v3");
// batch 4 earned it the name: 8–8 against Jimmy with its signature in
// HIS death column — five body-crashes into the territory it built.
// Its wins are seals, its signature kill is covering both exits, and
// even its losses are mostly it getting constricted back. Promoted to
// the default HARD seat the same day; the Opportunist stays a kept,
// selectable brain. Style strings "v3"/"V3" remain as aliases for
// saved levels and replays.
//
// Everything v2 survives by, plus the offensive half of the game —
// territory (price the opponent's liberties), exit-cutting (atari),
// and deliberate winning head-ons (forcing trades when up material).
import { AIBrain, BrainProfile } from '../types';
import { buildAIPlan } from '../planner';
import { calculateAIAction } from '../greedy';
import { V2_PROFILE } from './v2';

export const CONSTRICTOR_PROFILE: BrainProfile = {
  ...V2_PROFILE,
  // Change 10: territory — the beam prices the most trapped opponent's
  // flood area per ply (5/cell off its low-water mark, capped per plan).
  territoryWeight: 5,
  territoryCap: 300,
  // Change 11: exit-cut — route-end bonus for leaving the opponent at
  // one exit (double at zero).
  exitCutBonus: 150,
  // Change 12: winning head-on bounty at HARD, replacing the flat 10
  // charge for a reachable step the bot wins on the tiebreak.
  headOnBounty: 150,
};

export const constrictorBrain: AIBrain = {
  id: 'constrictor',
  label: 'Constrictor',
  profile: CONSTRICTOR_PROFILE,
  plan: (args) => buildAIPlan(args, CONSTRICTOR_PROFILE),
  action: (args) => calculateAIAction(args.gameState, args.gridSize, args.botRole, args.difficulty ?? 'MEDIUM', args.aiStyle, args.skillsAvailable, CONSTRICTOR_PROFILE),
};
