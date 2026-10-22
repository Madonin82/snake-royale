import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAIPlan } from './index';
import { buildAIPlan as buildPlanWithProfile } from './planner';
import { calculateAIMove } from './greedy';
import { OPPORTUNIST_PROFILE } from './brains/opportunist';
import { V2_PROFILE } from './brains/v2';
import { imminentStepLosingReachable } from './shared/rating';
import { imminentStepLosingReachable as guardByStyle } from './index';
import { GameState, Position, Snake } from '../../types/game';

// Fixture tests for the Changes 6–9 spec (new brain forked from the
// Opportunist, working id 'v2'). Each fixture is a hand-built board in
// the shape of a batch-2 death class: the Opportunist (frozen) must
// reproduce the fatal choice, the new brain must not, and zeroing the
// one relevant profile term must restore the fatal choice (revert
// proof — the term, not the fixture, is what saves the bot).

function snake(id: string, body: Position[], direction: Snake['direction'], extra: Partial<Snake> = {}): Snake {
  return {
    id, name: id, body, direction, queuedDirection: null,
    score: 0, skillPoints: 0, isAlive: true, color: '#000',
    equippedSkill: null, pendingSkill: null, tokensSinceLock: 0,
    ...extra,
  } as Snake;
}

function state(partial: Partial<GameState>): GameState {
  return {
    phase: 'TOKEN_RACE', tick: 40, turn: 40, phaseTurnsRemaining: 20,
    ringInset: 0, tokens: [], snakes: [], ...partial,
  } as GameState;
}

function firstStep(st: GameState, style: string): string {
  const r = buildAIPlan({ gameState: st, gridSize: 8, botRole: 'p2', difficulty: 'HARD', aiStyle: style, raceTurns: 20 });
  return r.plan[0]?.direction ?? '(none)';
}

function firstStepWithProfile(st: GameState, profile: typeof V2_PROFILE): string {
  const r = buildPlanWithProfile(
    { gameState: st, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 20 },
    profile,
  );
  return r.plan[0]?.direction ?? '(none)';
}

// --- Change 6: coffin margin (batch-2 coffins, e.g. replay 1416) ------
// A walled pocket (flood 9 against length 7 — margin 2) holds both
// tokens. The rest of the bot's chamber is just as thin at the first
// step but opens through a door into the empty bottom half; only the
// pocket stays thin on every ply.
const coffinWalls: Position[] = [
  { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 7, y: 0 },
  { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 },
  { x: 0, y: 1 }, { x: 2, y: 2 },
  { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 },
];
const coffin = state({
  walls: coffinWalls,
  tokens: [{ x: 6, y: 1 }, { x: 6, y: 2 }],
  snakes: [
    snake('p1', [{ x: 0, y: 6 }, { x: 0, y: 7 }, { x: 1, y: 7 }], 'UP'),
    snake('p2', [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 'RIGHT', { score: 10 }),
  ],
});

test('change 6 (coffin): opportunist enters the thin pocket, v2 does not', () => {
  assert.equal(firstStep(coffin, 'opportunist'), 'RIGHT');
  assert.notEqual(firstStep(coffin, 'v2'), 'RIGHT');
});

test('change 6 revert proof: coffinPenaltyMax 0 restores the pocket entry', () => {
  assert.equal(firstStepWithProfile(coffin, { ...V2_PROFILE, coffinPenaltyMax: 0 }), 'RIGHT');
});

// --- Change 7: trapped fallback by time-to-clear (replay 1431) --------
// Every rated move is vetoed (all floods < length 6). DOWN is the
// largest space now (5) but wall-sealed forever; RIGHT is a sealed
// 2-cell pocket; UP floods 4 now but the opponent body sealing its west
// side vacates tail-first, so the space fits the body at t=2.
const fallbackWalls: Position[] = [
  { x: 6, y: 3 }, { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 4, y: 2 }, { x: 4, y: 4 },
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 4, y: 0 }, { x: 4, y: 1 },
  { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 }, { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 },
];
const fallback = state({
  walls: fallbackWalls,
  snakes: [
    snake('p1', [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }], 'UP'),
    snake('p2', [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }, { x: 1, y: 6 }], 'RIGHT'),
  ],
});

test('change 7 (fallback): opportunist takes largest-area-now, v2 takes the step that clears', () => {
  assert.equal(calculateAIMove(fallback, 8, 'p2', 'HARD', undefined, OPPORTUNIST_PROFILE), 'DOWN');
  assert.equal(calculateAIMove(fallback, 8, 'p2', 'HARD', undefined, V2_PROFILE), 'UP');
});

test('change 7 revert proof: horizon 0 (or too short to see the clear) restores largest-area-now', () => {
  assert.equal(calculateAIMove(fallback, 8, 'p2', 'HARD', undefined, { ...V2_PROFILE, fallbackClearHorizon: 0 }), 'DOWN');
  assert.equal(calculateAIMove(fallback, 8, 'p2', 'HARD', undefined, { ...V2_PROFILE, fallbackClearHorizon: 1 }), 'DOWN');
});

// --- Change 8: ring telegraph as walls (replays 1413/1428) ------------
// Ring at inset 2, landing next tick (telegraph inset 3). The bot's
// upward route eats both tokens inside the condemned band; the inside
// step (RIGHT) is worth less to a scorer that prices the band as alive.
const telegraph = state({
  phase: 'SHRINKING', phaseTurnsRemaining: 1, ringInset: 2,
  isTelegraphingShrink: true, telegraphRingInset: 3,
  tokens: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
  snakes: [
    snake('p1', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 4, y: 5 }], 'UP', { score: 5 }),
    snake('p2', [{ x: 2, y: 4 }, { x: 2, y: 5 }, { x: 3, y: 5 }], 'UP'),
  ],
});

test('change 8 (telegraph): opportunist steps into the condemned band, v2 steps inside', () => {
  assert.equal(firstStep(telegraph, 'opportunist'), 'UP');
  assert.equal(firstStep(telegraph, 'v2'), 'RIGHT');
});

test('change 8 revert proof: ringTelegraphAsWalls off restores the band step', () => {
  assert.equal(firstStepWithProfile(telegraph, { ...V2_PROFILE, ringTelegraphAsWalls: false }), 'UP');
});

// --- Change 9: execution guard (replay 1433 deviation form) ----------
// Execution-tick board: the bot's locked plan steps RIGHT onto (5,4).
// The opponent — on its projected body, so planDiverged stays silent —
// can also reach (5,4) this tick, and the tiebreak (equal SP, shorter
// body) says the bot loses.
const deviation = state({
  tokens: [{ x: 5, y: 4 }],
  snakes: [
    snake('p1', [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 7 }], 'UP', { skillPoints: 3 }),
    snake('p2', [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }], 'RIGHT', { skillPoints: 3 }),
  ],
});

test('change 9 (deviation): guard fires for the guard profile and the replan changes the step', () => {
  assert.equal(imminentStepLosingReachable(deviation, 8, 'p2', 'RIGHT', V2_PROFILE), true);
  assert.equal(guardByStyle(deviation, 8, 'p2', 'RIGHT', 'v2'), true);
  assert.notEqual(firstStep(deviation, 'v2'), 'RIGHT');
});

test('change 9 revert proof: no executionGuardLoss (frozen profile, or zeroed) leaves the guard inert', () => {
  assert.equal(imminentStepLosingReachable(deviation, 8, 'p2', 'RIGHT', OPPORTUNIST_PROFILE), false);
  assert.equal(imminentStepLosingReachable(deviation, 8, 'p2', 'RIGHT', { ...V2_PROFILE, executionGuardLoss: 0 }), false);
  assert.equal(guardByStyle(deviation, 8, 'p2', 'RIGHT', 'opportunist'), false);
});

test('change 9: guard stays silent when the bot wins the tiebreak or the cell is out of reach', () => {
  const winning = state({
    tokens: [{ x: 5, y: 4 }],
    snakes: [
      snake('p1', [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 7 }], 'UP', { skillPoints: 2 }),
      snake('p2', [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }], 'RIGHT', { skillPoints: 3 }),
    ],
  });
  assert.equal(imminentStepLosingReachable(winning, 8, 'p2', 'RIGHT', V2_PROFILE), false);
  assert.equal(imminentStepLosingReachable(deviation, 8, 'p2', 'UP', V2_PROFILE), false);
});
