import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAIAction } from './ai';
import { GameState, Snake } from '../types/game';

function makeSnake(overrides: Partial<Snake>): Snake {
  return {
    id: 'p2',
    name: 'AVALENA',
    body: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
    direction: 'LEFT',
    queuedDirection: null,
    score: 0,
    skillPoints: 0,
    isAlive: true,
    color: '#000',
    equippedSkill: 'dart',
    pendingSkill: null,
    ...overrides,
  } as Snake;
}

function makeState(p1: Partial<Snake>, p2: Partial<Snake>): GameState {
  return {
    phase: 'TOKEN_RACE',
    tick: 0,
    turn: 0,
    snakes: [
      makeSnake({ id: 'p1', name: 'PLAYER 1', body: [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], direction: 'RIGHT', ...p1 }),
      makeSnake({ ...p2 }),
    ],
    tokens: [{ x: 7, y: 7 }],
    ringInset: 0,
    skillsAvailable: 'immediate',
  } as GameState;
}

test('avalena hunts on wallet lead: darts at the player head when 3+ points ahead', () => {
  // Wallet lead of 4 → hunt phase. Player head is within dart range.
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
  assert.equal(action.direction, 'LEFT'); // toward the player head
});

test('avalena farms on token lead alone: wallet tied means no hunt', () => {
  // 10 tokens ahead but wallets tied → farm phase (token lead doesn't trigger the hunt)
  // Body trails downward so RIGHT (toward the token) is clearly best.
  const state = makeState(
    { skillPoints: 3, score: 0 },
    { skillPoints: 3, score: 10, body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT'); // toward the token at (7,7), not the player
});

test('avalena returns to farming after spending: wallet lead lost', () => {
  // Was hunting (5 vs 1), spent two darts (now 1 vs 1) → back to farming
  const state = makeState(
    { skillPoints: 1, score: 4 },
    { skillPoints: 1, score: 8, body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT'); // farming again despite token lead
});
