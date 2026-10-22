import { AIBrain, BrainProfile } from '../types';
import { buildAIPlan } from '../planner';
import { calculateAvalenaAction } from '../greedy';

export const AVALENA_PROFILE: BrainProfile = {
  planner: 'greedy',
  enableIntent: false,
  chainSpWeight: 10,
  headOnWinBonus: 300,
  inSimHeadOnLoss: -10000,
  intentCashBonus: 30,
  intentStepBonus: 5,
  setupValueDiscount: 0.5,
  protectAreaPenalty: 400,
  protectContestPenalty: 150,
  maxSimDepth: 3,
  beamCandidates: 2,
  threatNudge: { EASY: 0, MEDIUM: 8, HARD: 25 },
  chainCap: { EASY: 1, MEDIUM: 2, HARD: 3 },
  easyRandomSecondPick: 0.25,
};

export const avalenaBrain: AIBrain = {
  id: 'avalena',
  label: 'Avalena',
  profile: AVALENA_PROFILE,
  plan: (args) => buildAIPlan({ ...args, aiStyle: 'avalena' }, AVALENA_PROFILE),
  action: (args) => calculateAvalenaAction(args.gameState, args.gridSize, args.botRole, args.skillsAvailable ?? args.gameState.skillsAvailable),
};
