import assert from 'node:assert/strict';
import test from 'node:test';
import { isSkillUnlocked, canActivateSkill, isValidDartDirection } from './skills';
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

test('canActivateSkill: false with fewer than 2 tokens', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ score: 1 }), state, 'immediate'), false);
  assert.equal(canActivateSkill(makeSnake({ score: 0 }), state, 'immediate'), false);
});

test('canActivateSkill: true with 2+ tokens and unlocked', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ score: 2 }), state, 'immediate'), true);
  assert.equal(canActivateSkill(makeSnake({ score: 10 }), state, 'after_race'), true);
});

test('canActivateSkill: false when locked, dead, or no skill', () => {
  const state = makeState({ phase: 'SHRINKING' });
  assert.equal(canActivateSkill(makeSnake({ score: 5 }), makeState({ phase: 'TOKEN_RACE' }), 'after_race'), false);
  assert.equal(canActivateSkill(makeSnake({ score: 5, isAlive: false }), state, 'immediate'), false);
  assert.equal(canActivateSkill(makeSnake({ score: 5, equippedSkill: null }), state, 'immediate'), false);
  assert.equal(canActivateSkill(undefined, state, 'immediate'), false);
});

test('isValidDartDirection: rejects backward, allows forward/left/right', () => {
  assert.equal(isValidDartDirection('RIGHT', 'LEFT'), false);
  assert.equal(isValidDartDirection('RIGHT', 'RIGHT'), true);
  assert.equal(isValidDartDirection('RIGHT', 'UP'), true);
  assert.equal(isValidDartDirection('RIGHT', 'DOWN'), true);
  assert.equal(isValidDartDirection('UP', 'DOWN'), false);
});
