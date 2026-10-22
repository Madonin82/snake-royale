// Working name "v3" — roster names are earned by playing against the
// brain (Jimmy's rule), so this id is plumbing until its batch gives
// it a real one. Forked from v2 per the Changes 10–12 offense spec:
// everything v2 survives by, plus the offensive half of the game —
// territory (price the opponent's liberties), exit-cutting (atari),
// and deliberate winning head-ons (forcing trades when up material).
// Selectable in editor/campaign only — not a default anywhere.
import { AIBrain, BrainProfile } from '../types';
import { buildAIPlan } from '../planner';
import { calculateAIAction } from '../greedy';
import { V2_PROFILE } from './v2';

export const V3_PROFILE: BrainProfile = {
  ...V2_PROFILE,
  // Change 10: territory — points per opponent flood cell removed at
  // route end, capped per route (first-guess constants; a full board
  // split is worth roughly a token line).
  territoryWeight: 5,
  territoryCap: 300,
  // Change 11: exit-cut — route-end bonus for leaving the opponent at
  // one exit (double at zero).
  exitCutBonus: 150,
  // Change 12: winning head-on bounty at HARD, replacing the flat 10
  // charge for a reachable step the bot wins on the tiebreak.
  headOnBounty: 150,
};

export const v3Brain: AIBrain = {
  id: 'v3',
  label: 'V3',
  profile: V3_PROFILE,
  plan: (args) => buildAIPlan(args, V3_PROFILE),
  action: (args) => calculateAIAction(args.gameState, args.gridSize, args.botRole, args.difficulty ?? 'MEDIUM', args.aiStyle, args.skillsAvailable, V3_PROFILE),
};
