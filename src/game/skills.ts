import { Direction, GameState, Snake, SkillId } from '../types/game';
import { isOppositeDirection } from './engine';

export const MIN_RATTLE_LENGTH = 3;

export interface SkillDefinition {
  id: SkillId;
  name: string;
  cost: number;
  minLength?: number;
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  dart: {
    id: 'dart',
    name: 'DART',
    cost: 2,
  },
  rattle: {
    id: 'rattle',
    name: 'RATTLE',
    cost: 1,
    minLength: MIN_RATTLE_LENGTH,
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
  if (def.minLength !== undefined) {
    const length = Array.isArray(snake.body) ? snake.body.length : 0;
    if (length < def.minLength) return false;
  }
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

export function canAffordQueuedRattle(skillPoints: number | undefined, queuedSkills: number): boolean {
  const points = skillPoints ?? 0;
  return points - SKILLS.rattle.cost * queuedSkills >= SKILLS.rattle.cost;
}

export function canQueueRattleWithLength(bodyLength: number | undefined, queuedRattles: number = 0): boolean {
  const len = bodyLength ?? 0;
  return len - queuedRattles >= MIN_RATTLE_LENGTH;
}

export function isValidDartDirection(facing: Direction, chosenDir: Direction): boolean {
  return !isOppositeDirection(facing, chosenDir);
}

export function isValidRattleDirection(facing: Direction, chosenDir: Direction): boolean {
  return !isOppositeDirection(facing, chosenDir);
}
