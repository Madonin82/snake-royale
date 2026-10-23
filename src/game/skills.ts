import { Direction, GameState, Snake, SkillId } from '../types/game';
import { isOppositeDirection } from './engine';

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
    // A drop needs a body segment to give up: length >= 2 (the snake
    // drops to a bare head at length 1 and can drop no further).
    minLength: 2,
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
    return state.phase === 'SHRINKING' || state.phase === 'TERRITORY';
  }
  if (mode.startsWith('after_turns:')) {
    const turns = Number(mode.slice('after_turns:'.length));
    if (Number.isFinite(turns) && turns >= 0) {
      return state.tick >= turns;
    }
  }
  return state.phase === 'SHRINKING' || state.phase === 'TERRITORY';
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
 * Generic queue-time escrow: can this snake afford one more use of the
 * given skill, given how many are already queued? Reads cost from SKILLS —
 * data-driven, no per-skill branches. Adding a skill with a different cost
 * just works: add it to SKILLS with its cost, no UI changes needed.
 */
export function canAffordQueuedSkill(
  skillPoints: number | undefined,
  skillId: SkillId,
  queuedCount: number,
): boolean {
  const points = skillPoints ?? 0;
  const cost = SKILLS[skillId].cost;
  return points - cost * queuedCount >= cost;
}

/**
 * Queue-time escrow: can this snake afford one more dart given the darts
 * already queued? Reserves 2 points per queued dart. Derive the reserved count
 * from the buffer — never a separate counter (it would drift from undo/clear).
 */
export function canAffordQueuedDart(skillPoints: number | undefined, queuedDarts: number): boolean {
  return canAffordQueuedSkill(skillPoints, 'dart', queuedDarts);
}

export function canAffordQueuedRattle(skillPoints: number | undefined, queuedSkills: number): boolean {
  return canAffordQueuedSkill(skillPoints, 'rattle', queuedSkills);
}

export function canQueueRattleWithLength(bodyLength: number | undefined, queuedRattles: number = 0): boolean {
  const len = bodyLength ?? 0;
  // Queue-time floor (Jimmy, 2026-10-23): each queued drop spends one
  // segment, and a drop is only legal while a segment remains to give —
  // the snake may queue down toward a bare head (length 1), never past it.
  return len - queuedRattles >= 2;
}

export function isValidDartDirection(facing: Direction, chosenDir: Direction): boolean {
  return !isOppositeDirection(facing, chosenDir);
}

export function isValidRattleDirection(facing: Direction, chosenDir: Direction): boolean {
  return !isOppositeDirection(facing, chosenDir);
}
