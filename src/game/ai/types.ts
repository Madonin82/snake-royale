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
  // Changes 6–9 (spec §3): all optional — absent means neutral, so the
  // frozen brain literals (opportunist/legacy/avalena) typecheck and
  // behave exactly as before without naming any of these fields.
  coffinPenaltyMax?: number; // Change 6: margin penalty at margin 0
  coffinMarginBand?: number; // Change 6: penalty reaches 0 at this margin
  fallbackClearHorizon?: number; // Change 7: ticks ahead the trapped fallback looks
  ringTelegraphAsWalls?: boolean; // Change 8: price the telegraphed ring as landed
  executionGuardLoss?: number; // Change 9: replaces inSimHeadOnLoss for guard profiles
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
