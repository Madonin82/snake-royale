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

test('registry: v2 brain resolves in both cases and carries the Changes 6-9 terms; opportunist stays neutral', () => {
  assert.equal(getBrain('v2').brain.id, 'v2');
  assert.equal(getBrain('V2').brain.id, 'v2');
  const v2 = getBrain('v2').brain.profile;
  assert.equal(v2.coffinPenaltyMax, 400);
  assert.equal(v2.coffinMarginBand, 6);
  assert.equal(v2.fallbackClearHorizon, 8);
  assert.equal(v2.ringTelegraphAsWalls, true);
  assert.equal(v2.executionGuardLoss, -10000);
  const opp = getBrain('opportunist').brain.profile;
  assert.equal(opp.coffinPenaltyMax, undefined);
  assert.equal(opp.coffinMarginBand, undefined);
  assert.equal(opp.fallbackClearHorizon, undefined);
  assert.equal(opp.ringTelegraphAsWalls, undefined);
  assert.equal(opp.executionGuardLoss, undefined);
});

test('promotion (Jimmy, 2026-10-22): the unnamed HARD seat is the Constrictor; every other seat is unchanged', () => {
  // Quickplay carries no aiStyle — HARD there is the main-game seat.
  assert.equal(getBrain(undefined, 'HARD').brain.id, 'constrictor');
  assert.equal(getBrain('', 'HARD').brain.id, 'constrictor');
  assert.equal(getBrain(undefined, 'HARD').effectiveDifficulty, 'HARD');
  // EASY / MEDIUM / unspecified seats stay on the Opportunist.
  assert.equal(getBrain(undefined, 'MEDIUM').brain.id, 'opportunist');
  assert.equal(getBrain(undefined, 'EASY').brain.id, 'opportunist');
  assert.equal(getBrain(undefined).brain.id, 'opportunist');
  // Named styles resolve by name at any difficulty — including the
  // editor's difficulty presets and the Opportunist itself at HARD.
  assert.equal(getBrain('GREEDY', 'HARD').brain.id, 'opportunist');
  assert.equal(getBrain('HEADHUNTER', 'HARD').brain.id, 'opportunist');
  assert.equal(getBrain('opportunist', 'HARD').brain.id, 'opportunist');
  // Unknown styles keep the old fallback even at HARD (named != unnamed).
  assert.equal(getBrain('nonexistent_style_xyz', 'HARD').brain.id, 'opportunist');
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
