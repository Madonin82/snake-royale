import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrain, listBrains } from './registry';
import { OPPORTUNIST_PROFILE } from './brains/opportunist';
import { buildAIPlan } from './index';
import { GameState } from '../../types/game';

test('registry: every registered brain id resolves via getBrain case-insensitively', () => {
  const brains = listBrains();
  for (const b of brains) {
    const resolved = getBrain(b.id.toUpperCase());
    assert.equal(resolved.brain.id, b.id);
  }
});

test('registry: unknown style falls back to Opportunist without throwing', () => {
  const resolved = getBrain('nonexistent_style_xyz');
  assert.equal(resolved.brain.id, 'opportunist');
});

test('frozen-profile test: opportunist profile matches the frozen specification', () => {
  const resolved = getBrain('opportunist');
  assert.deepEqual(resolved.brain.profile, OPPORTUNIST_PROFILE);
});

test('each registered brain returns a plan on a sample board', () => {
  const sampleState: GameState = {
    phase: 'TOKEN_RACE',
    tick: 0,
    turn: 0,
    phaseTurnsRemaining: 20,
    ringInset: 0,
    tokens: [{ x: 5, y: 5 }],
    snakes: [
      {
        id: 'p1',
        name: 'Player 1',
        body: [{ x: 2, y: 2 }, { x: 1, y: 2 }],
        direction: 'RIGHT',
        queuedDirection: null,
        score: 0,
        skillPoints: 0,
        isAlive: true,
        color: '#000',
        equippedSkill: null,
        pendingSkill: null,
      },
      {
        id: 'p2',
        name: 'Bot',
        body: [{ x: 5, y: 2 }, { x: 4, y: 2 }],
        direction: 'RIGHT',
        queuedDirection: null,
        score: 0,
        skillPoints: 0,
        isAlive: true,
        color: '#fff',
        equippedSkill: null,
        pendingSkill: null,
      },
    ],
  };

  const brains = listBrains();
  for (const b of brains) {
    const planResult = buildAIPlan({
      gameState: sampleState,
      gridSize: 8,
      botRole: 'p2',
      difficulty: 'MEDIUM',
      aiStyle: b.id,
      raceTurns: 20,
    });
    assert.ok(Array.isArray(planResult.plan));
  }
});
