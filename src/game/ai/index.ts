import { GameState, Direction } from '../../types/game';
import { AIActionResult, AIPlanResult, ChainIntent } from './types';
import { getBrain } from './registry';
import { planDiverged } from './planner';

export type { AIActionResult, AIPlanResult, ChainIntent };
export { planDiverged };

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
  const { calculateAIMoveCandidates: calcCandidates } = require('./greedy');
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
