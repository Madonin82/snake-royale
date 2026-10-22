// Working name "v2" — roster names are earned by playing against the
// brain (Jimmy's rule), so this id is plumbing until batch 3 gives it a
// real one. Forked from the Opportunist per the Changes 6–9 spec: the
// frozen Opportunist profile plus the four new survival terms, all of
// which are neutral on every other brain (the fields are optional and
// absent there). Selectable in editor/campaign only — not a default
// anywhere.
import { AIBrain, BrainProfile } from '../types';
import { buildAIPlan } from '../planner';
import { calculateAIAction } from '../greedy';
import { OPPORTUNIST_PROFILE } from './opportunist';

export const V2_PROFILE: BrainProfile = {
  ...OPPORTUNIST_PROFILE,
  // Change 6: coffin margin (first-guess constants, spec §12).
  coffinPenaltyMax: 400,
  coffinMarginBand: 6,
  // Change 7: trapped fallback ranked by time-to-clear.
  fallbackClearHorizon: 8,
  // Change 8: telegraphed ring priced as already landed.
  ringTelegraphAsWalls: true,
  // Change 9: execution-time reachability guard magnitude.
  executionGuardLoss: -10000,
};

export const v2Brain: AIBrain = {
  id: 'v2',
  label: 'V2',
  profile: V2_PROFILE,
  plan: (args) => buildAIPlan(args, V2_PROFILE),
  action: (args) => calculateAIAction(args.gameState, args.gridSize, args.botRole, args.difficulty ?? 'MEDIUM', args.aiStyle, args.skillsAvailable, V2_PROFILE),
};
