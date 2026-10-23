import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSkillUnlocked,
  canActivateSkill,
  canAffordQueuedDart,
  canAffordQueuedRattle,
  canQueueRattleWithLength,
  isValidDartDirection,
  isValidRattleDirection,
  SKILLS,
} from './skills';
import { GameState } from '../types/game';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'TOKEN_RACE',
    tick: 0,
    turn: 0,
    snakes: [],
    tokens: [],
    ...overrides,
  } as GameState;
}

function makeSnake(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    isAlive: true,
    equippedSkill: 'dart' as const,
    score: 5,
    ...overrides,
  };
}

test('isSkillUnlocked: immediate is always unlocked', () => {
  assert.equal(isSkillUnlocked(makeState(), 'immediate'), true);
  assert.equal(isSkillUnlocked(makeState({ phase: 'SHRINKING' }), 'immediate'), true);
});

test('isSkillUnlocked: after_race unlocks in SHRINKING phase only', () => {
  assert.equal(isSkillUnlocked(makeState({ phase: 'TOKEN_RACE' }), 'after_race'), false);
  assert.equal(isSkillUnlocked(makeState({ phase: 'SHRINKING' }), 'after_race'), true);
});

test('isSkillUnlocked: after_turns:N unlocks at tick >= N', () => {
  assert.equal(isSkillUnlocked(makeState({ tick: 29 }), 'after_turns:30'), false);
  assert.equal(isSkillUnlocked(makeState({ tick: 30 }), 'after_turns:30'), true);
  assert.equal(isSkillUnlocked(makeState({ tick: 100 }), 'after_turns:30'), true);
});

test('isSkillUnlocked: defaults to after_race when undefined', () => {
  assert.equal(isSkillUnlocked(makeState({ phase: 'TOKEN_RACE' })), false);
  assert.equal(isSkillUnlocked(makeState({ phase: 'SHRINKING' })), true);
});

test('canActivateSkill: false with fewer than 2 skill points', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 1 }), state, 'immediate'), false);
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 0 }), state, 'immediate'), false);
  // Tokens alone don't pay for darts anymore — the wallet does.
  assert.equal(canActivateSkill(makeSnake({ score: 10, skillPoints: 1 }), state, 'immediate'), false);
});

test('canActivateSkill: true with 2+ skill points and unlocked', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 2 }), state, 'immediate'), true);
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 10 }), state, 'after_race'), true);
});

test('canActivateSkill: false when locked, dead, or no skill', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 5 }), makeState({ phase: 'TOKEN_RACE' }), 'after_race'), false);
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 5, isAlive: false }), state, 'immediate'), false);
  assert.equal(canActivateSkill(makeSnake({ skillPoints: 5, equippedSkill: null }), state, 'immediate'), false);
  assert.equal(canActivateSkill(undefined, state, 'immediate'), false);
});

test('canAffordQueuedDart: escrow accounting', () => {
  // Dart costs 2. Each queued dart reserves 2 points.
  assert.equal(canAffordQueuedDart(3, 0), true);   // 3 pts → 1st dart ok
  assert.equal(canAffordQueuedDart(3, 1), false);  // 3 - 2 = 1 < 2 → 2nd dart no
  assert.equal(canAffordQueuedDart(4, 1), true);   // 4 - 2 = 2 → 2nd dart ok
  assert.equal(canAffordQueuedDart(4, 2), false);  // 4 - 4 = 0 → 3rd dart no
  assert.equal(canAffordQueuedDart(2, 0), true);   // exactly enough
  assert.equal(canAffordQueuedDart(1, 0), false);
  assert.equal(canAffordQueuedDart(0, 0), false);
  assert.equal(canAffordQueuedDart(undefined, 0), false); // missing wallet = broke
});

test('isValidDartDirection: rejects backward, allows forward/left/right', () => {
  assert.equal(isValidDartDirection('RIGHT', 'LEFT'), false);
  assert.equal(isValidDartDirection('RIGHT', 'RIGHT'), true);
  assert.equal(isValidDartDirection('RIGHT', 'UP'), true);
  assert.equal(isValidDartDirection('RIGHT', 'DOWN'), true);
  assert.equal(isValidDartDirection('UP', 'DOWN'), false);
});

test('rattle skill definition: costs 1 SP and requires length >= 3', () => {
  assert.equal(SKILLS.rattle.id, 'rattle');
  assert.equal(SKILLS.rattle.cost, 1);
  assert.equal(SKILLS.rattle.minLength, 2);
});

test('canActivateSkill for rattle: requires 1+ SP and body length >= 2', () => {
  const state = makeState({ phase: 'SHRINKING' });
  const len3Body = [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  const len2Body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  const len1Body = [{ x: 2, y: 2 }];

  assert.equal(
    canActivateSkill(makeSnake({ equippedSkill: 'rattle', skillPoints: 1, body: len3Body }) as any, state, 'immediate'),
    true,
  );
  assert.equal(
    canActivateSkill(makeSnake({ equippedSkill: 'rattle', skillPoints: 0, body: len3Body }) as any, state, 'immediate'),
    false,
  );
  // Length 2 can drop (down to a bare head); length 1 has nothing to give.
  assert.equal(
    canActivateSkill(makeSnake({ equippedSkill: 'rattle', skillPoints: 5, body: len2Body }) as any, state, 'immediate'),
    true,
  );
  assert.equal(
    canActivateSkill(makeSnake({ equippedSkill: 'rattle', skillPoints: 5, body: len1Body }) as any, state, 'immediate'),
    false,
  );
  assert.equal(canAffordQueuedRattle(2, 0), true);
  assert.equal(canAffordQueuedRattle(2, 1), true);
  assert.equal(canAffordQueuedRattle(1, 1), false);
  // Queue-time floor: len - queued >= 2 — drops may be chained down
  // toward a bare head, never past it.
  assert.equal(canQueueRattleWithLength(3, 0), true);
  assert.equal(canQueueRattleWithLength(3, 1), true);
  assert.equal(canQueueRattleWithLength(3, 2), false);
  assert.equal(canQueueRattleWithLength(2, 0), true);
  assert.equal(canQueueRattleWithLength(2, 1), false);
  assert.equal(canQueueRattleWithLength(1, 0), false);
  assert.equal(canQueueRattleWithLength(5, 3), true);
  assert.equal(canQueueRattleWithLength(5, 4), false);
  assert.equal(isValidRattleDirection('RIGHT', 'UP'), true);
  assert.equal(isValidRattleDirection('RIGHT', 'LEFT'), false);
});

