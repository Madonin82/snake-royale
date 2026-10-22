import { BufferEntry, Direction, GameState, PendingSkill, Position, Snake } from '../../types/game';

export interface AIActionResult {
  direction: Direction | null;
  skill?: PendingSkill | null;
}

export interface ChainIntent {
  tokenKeys: string[];
  anchor: Position;
  createdTick: number;
  locksWithoutProgress: number;
  lastDistance: number;
}

export interface AIPlanResult {
  plan: BufferEntry[];
  lockCount: number;
  projections: Record<string, Position[]>[];
  intent: ChainIntent | null;
  posture: 'PROTECT' | 'CHASE' | null;
}

export interface BrainProfile {
  planner: 'beam' | 'greedy';
  enableIntent: boolean;
  chainSpWeight: number;
  headOnWinBonus: number;
  inSimHeadOnLoss: number;
  intentCashBonus: number;
  intentStepBonus: number;
  setupValueDiscount: number;
  protectAreaPenalty: number;
  protectContestPenalty: number;
  maxSimDepth: number;
  beamCandidates: number;
  threatNudge: { EASY: number; MEDIUM: number; HARD: number };
  chainCap: { EASY: number; MEDIUM: number; HARD: number };
  easyRandomSecondPick: number;
}

export interface AIBrain {
  id: string;
  label: string;
  profile: BrainProfile;
  plan(args: {
    gameState: GameState;
    gridSize: number;
    botRole: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    aiStyle?: string;
    skillsAvailable?: GameState['skillsAvailable'];
    raceTurns: number;
    intent?: ChainIntent | null;
  }): AIPlanResult;
  action?(args: {
    gameState: GameState;
    gridSize: number;
    botRole: string;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    aiStyle?: string;
    skillsAvailable?: GameState['skillsAvailable'];
  }): AIActionResult;
}
