// FROZEN SNAPSHOT — pre-3a8ed4a bots, lifted verbatim from 611c236. Do not edit. Tuning happens on forks (new brains), never here.
import { AIBrain, BrainProfile } from '../types';
import { calculateAIMove } from '../greedy';

export const LEGACY_PROFILE: BrainProfile = {
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
  maxSimDepth: 1,
  beamCandidates: 1,
  threatNudge: { EASY: 0, MEDIUM: 8, HARD: 25 },
  chainCap: { EASY: 1, MEDIUM: 2, HARD: 3 },
  easyRandomSecondPick: 0.25,
};

export const legacyBrain: AIBrain = {
  id: 'legacy',
  label: 'Legacy Bot',
  profile: LEGACY_PROFILE,
  plan: (args) => {
    const dir = calculateAIMove(args.gameState, args.gridSize, args.botRole, args.difficulty, 'legacy', LEGACY_PROFILE);
    if (!dir) return { plan: [], lockCount: 0, projections: [], intent: null, posture: null };
    return {
      plan: [{ type: 'move', direction: dir }],
      lockCount: 1,
      projections: [],
      intent: null,
      posture: null,
    };
  },
  action: (args) => {
    const dir = calculateAIMove(args.gameState, args.gridSize, args.botRole, args.difficulty ?? 'MEDIUM', 'legacy', LEGACY_PROFILE);
    return { direction: dir, skill: null };
  },
};
