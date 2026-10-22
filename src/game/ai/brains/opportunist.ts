// FROZEN — current planner as merged in 3a8ed4a. Do not tune this file. To change this behaviour, create a new brain.
import { AIBrain, BrainProfile } from '../types';
import { buildAIPlan } from '../planner';
import { calculateAIAction } from '../greedy';

export const OPPORTUNIST_PROFILE: BrainProfile = {
  planner: 'beam',
  enableIntent: true,
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

export const opportunistBrain: AIBrain = {
  id: 'opportunist',
  label: 'Opportunist',
  profile: OPPORTUNIST_PROFILE,
  plan: (args) => buildAIPlan(args, OPPORTUNIST_PROFILE),
  action: (args) => calculateAIAction(args.gameState, args.gridSize, args.botRole, args.difficulty ?? 'MEDIUM', args.aiStyle, args.skillsAvailable, OPPORTUNIST_PROFILE),
};
