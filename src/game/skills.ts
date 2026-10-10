import { Direction, GameState, Snake, SkillId } from '../types/game';
import { isOppositeDirection } from './engine';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  cost: number;
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  dart: {
    id: 'dart',
    name: 'DART',
    cost: 2,
  },
};

export type SkillsAvailableConfig = 'immediate' | 'after_race' | `after_turns:${number}`;

export function isSkillUnlocked(
  state: GameState,
  skillsAvailable: SkillsAvailableConfig | undefined = 'after_race',
): boolean {
  const mode = skillsAvailable ?? 'after_race';
  if (mode === 'immediate') {
    return true;
  }
  if (mode === 'after_race') {
    return state.phase === 'SHRINKING';
  }
  if (mode.startsWith('after_turns:')) {
    const turns = Number(mode.slice('after_turns:'.length));
    if (Number.isFinite(turns) && turns >= 0) {
      return state.tick >= turns;
    }
  }
  return state.phase === 'SHRINKING';
}

export function canActivateSkill(
  snake: Snake | undefined,
  state: GameState,
  skillsAvailable?: SkillsAvailableConfig,
): boolean {
  if (!snake || !snake.isAlive || !snake.equippedSkill) return false;
  if (!isSkillUnlocked(state, skillsAvailable)) return false;
  const def = SKILLS[snake.equippedSkill];
  if (!def) return false;
  // Affordability reads the skill wallet, not the token count.
  return (snake.skillPoints ?? 0) >= def.cost;
}

/**
 * Queue-time escrow: can this snake afford one more dart given the darts
 * already queued? Reserves 2 points per queued dart. Derive the reserved count
 * from the buffer — never a separate counter (it would drift from undo/clear).
 */
export function canAffordQueuedDart(skillPoints: number | undefined, queuedDarts: number): boolean {
  const points = skillPoints ?? 0;
  return points - SKILLS.dart.cost * queuedDarts >= SKILLS.dart.cost;
}

export function isValidDartDirection(facing: Direction, chosenDir: Direction): boolean {
  return !isOppositeDirection(facing, chosenDir);
}
