import { GameState, Direction } from '../../types/game';
import { AIActionResult, AIPlanResult, ChainIntent } from './types';
import { getBrain } from './registry';
import { planDiverged } from './planner';
import { calculateAIMoveCandidates as calcCandidates } from './greedy';
import { imminentStepLosingReachable as guardCheck } from './shared/rating';

export type { AIActionResult, AIPlanResult, ChainIntent };
export { planDiverged };

/**
 * Change 9 §7.3 (Changes 6–9 spec): execution-time reachability guard,
 * resolved against the brain the given style selects. Inert (false) for
 * every brain whose profile does not carry executionGuardLoss.
 */
export function imminentStepLosingReachable(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  nextDir: Direction,
  aiStyle?: string,
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD',
): boolean {
  // Resolve the brain the same way the seat itself resolves (style +
  // difficulty), so the guard checks against the profile actually
  // playing — e.g. the unnamed HARD seat, which is the Constrictor.
  const { brain } = getBrain(aiStyle, difficulty);
  return guardCheck(gameState, gridSize, botRole, nextDir, brain.profile);
}

export function calculateAIAction(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  skillsAvailable?: GameState['skillsAvailable'],
): AIActionResult {
  const { brain, effectiveDifficulty } = getBrain(aiStyle, difficulty);
  if (brain.action) {
    return brain.action({ gameState, gridSize, botRole, difficulty: effectiveDifficulty, skillsAvailable });
  }
  const dir = brain.plan({
    gameState,
    gridSize,
    botRole,
    difficulty: effectiveDifficulty,
    aiStyle,
    skillsAvailable,
    raceTurns: gameState.phaseTurnsRemaining ?? 20,
  }).plan[0]?.direction ?? null;

  return { direction: dir, skill: null };
}

export function calculateAIMoveCandidates(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
): { dir: Direction; score: number }[] {
  const { brain, effectiveDifficulty } = getBrain(aiStyle, difficulty);
  return calcCandidates(gameState, gridSize, botRole, effectiveDifficulty, aiStyle, brain.profile);
}

export function calculateAIMove(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
): Direction | null {
  const { brain, effectiveDifficulty } = getBrain(aiStyle, difficulty);
  const planResult = brain.plan({
    gameState,
    gridSize,
    botRole,
    difficulty: effectiveDifficulty,
    aiStyle,
    raceTurns: gameState.phaseTurnsRemaining ?? 20,
  });
  return planResult.plan[0]?.direction ?? null;
}

export function buildAIPlan(args: {
  gameState: GameState;
  gridSize: number;
  botRole: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  aiStyle?: string;
  skillsAvailable?: GameState['skillsAvailable'];
  raceTurns: number;
  intent?: ChainIntent | null;
}): AIPlanResult {
  const { brain, effectiveDifficulty } = getBrain(args.aiStyle, args.difficulty);
  return brain.plan({
    ...args,
    difficulty: effectiveDifficulty,
  });
}
