import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS, processGameTick } from './engine';
import { getCampaignPlaytestSettings, getMultiplayerCustomLevelSettings } from '../editor/playtestSession';
import { CampaignLevel } from '../editor/levelSchema';
import { Direction, GameSettings, GameState } from '../types/game';

// Acceptance tests for the editor shrink-phase toggle (Annie's spec,
// Jimmy's rulings 2026-10-22): shrinkEnabled off -> after the token race
// the match enters TERRITORY, the ring never starts, no new tokens
// spawn, and the match runs until one snake remains (last survivor
// wins, regardless of score). Toggle on or absent -> today's behavior.

const P1_LOOP: Record<string, Direction> = {
  '1,1': 'RIGHT', '2,1': 'RIGHT', '3,1': 'DOWN', '3,2': 'DOWN',
  '3,3': 'LEFT', '2,3': 'LEFT', '1,3': 'UP', '1,2': 'UP',
};
const P2_LOOP: Record<string, Direction> = {
  '6,6': 'LEFT', '5,6': 'LEFT', '4,6': 'UP', '4,5': 'UP',
  '4,4': 'RIGHT', '5,4': 'RIGHT', '6,4': 'DOWN', '6,5': 'DOWN',
};

function patrolState(): GameState {
  const state = createInitialState();
  state.tokens = [];
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p1.body = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
  p1.direction = 'RIGHT';
  p2.body = [{ x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }];
  p2.direction = 'LEFT';
  return state;
}

function stepPatrol(state: GameState, settings: GameSettings): GameState {
  for (const [snake, loop] of [
    [state.snakes.find(s => s.id === 'p1')!, P1_LOOP],
    [state.snakes.find(s => s.id === 'p2')!, P2_LOOP],
  ] as const) {
    if (!snake.isAlive) continue;
    const head = snake.body[0];
    const dir = loop[`${head.x},${head.y}`];
    if (dir) {
      snake.direction = dir;
      snake.queuedDirection = null;
    }
  }
  return processGameTick(state, settings, 0).nextState;
}

function territorySettings(): GameSettings {
  return { ...DEFAULT_SETTINGS, shrinkEnabled: false, shrinkEveryTurns: 2 };
}

test('(a) shrink off: race end enters TERRITORY; ring never moves, no telegraph, many turns on', () => {
  const settings = territorySettings();
  let state = patrolState();
  state.phaseTurnsRemaining = 2;
  state = stepPatrol(state, settings);
  assert.equal(state.phase, 'RACING');
  state = stepPatrol(state, settings);
  assert.equal(state.phase, 'TERRITORY');
  for (let i = 0; i < 14; i++) {
    state = stepPatrol(state, settings);
    assert.equal(state.phase, 'TERRITORY');
    assert.equal(state.ringInset, 0);
    assert.equal(state.isTelegraphingShrink, false);
    assert.ok(state.snakes.every(s => s.isAlive));
  }
});

test('control: shrink flag absent -> race end enters SHRINKING and the ring closes as today', () => {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, shrinkEveryTurns: 2 };
  delete settings.shrinkEnabled;
  let state = patrolState();
  state.phaseTurnsRemaining = 2;
  state = stepPatrol(state, settings);
  state = stepPatrol(state, settings);
  assert.equal(state.phase, 'SHRINKING');
  state = stepPatrol(state, settings);
  state = stepPatrol(state, settings);
  assert.equal(state.ringInset, 1);
});

test('(b) shrink off: no token spawns in TERRITORY, but a leftover token stays edible', () => {
  const settings = territorySettings();
  let state = patrolState();
  state.phase = 'TERRITORY';
  state.tokens = [];
  for (let i = 0; i < 3; i++) state = stepPatrol(state, settings);
  assert.equal(state.tokens.length, 0);

  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const head = p1.body[0];
  const dir = P1_LOOP[`${head.x},${head.y}`]!;
  const delta = { RIGHT: { x: 1, y: 0 }, LEFT: { x: -1, y: 0 }, UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 } }[dir];
  state.tokens = [{ x: head.x + delta.x, y: head.y + delta.y }];
  const scoreBefore = p1.score;
  state = stepPatrol(state, settings);
  assert.equal(state.snakes.find(s => s.id === 'p1')!.score, scoreBefore + 1);
});

test('(c) shrink off, 3 snakes: first death does not end the match; the second death does', () => {
  const settings = territorySettings();
  let state = patrolState();
  state.phase = 'TERRITORY';
  const p2proto = state.snakes.find(s => s.id === 'p2')!;
  state.snakes.push({
    ...p2proto,
    id: 'p3',
    name: 'BOT 3',
    body: [{ x: 7, y: 0 }, { x: 6, y: 0 }],
    direction: 'RIGHT',
    queuedDirection: null,
    isAlive: true,
  });
  state = stepPatrol(state, settings);
  assert.equal(state.snakes.find(s => s.id === 'p3')!.isAlive, false);
  assert.equal(state.phase, 'TERRITORY');
  assert.ok(!state.winner);

  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p2.body = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  p2.direction = 'LEFT';
  state = processGameTick(state, settings, 0).nextState;
  assert.equal(state.snakes.find(s => s.id === 'p2')!.isAlive, false);
  assert.equal(state.phase, 'OVER');
  assert.equal(state.winner, 'p1');
});

test('(d) shrink off, 2 snakes: the lower-score survivor wins', () => {
  const settings = territorySettings();
  let state = patrolState();
  state.phase = 'TERRITORY';
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p1.score = 1;
  p2.score = 9;
  p2.body = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  p2.direction = 'LEFT';
  state = processGameTick(state, settings, 0).nextState;
  assert.equal(state.phase, 'OVER');
  assert.equal(state.winner, 'p1');
});

test('(e) shrink off: simultaneous death of the final two resolves by the points tiebreak', () => {
  const settings = territorySettings();
  const state = createInitialState();
  state.tokens = [];
  state.phase = 'TERRITORY';
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  // Both snakes crash out on the same tick (opposite walls), leaving
  // zero survivors — the existing tiebreak (SP, then length) decides.
  p1.body = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  p1.direction = 'LEFT';
  p1.skillPoints = 5;
  p2.body = [{ x: 7, y: 2 }, { x: 6, y: 2 }];
  p2.direction = 'RIGHT';
  p2.skillPoints = 3;
  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.phase, 'OVER');
  assert.equal(nextState.winner, 'p1');
  assert.match(nextState.winReason ?? '', /points/);
});

const createLevel = (shrinkEnabled?: boolean): CampaignLevel => ({
  id: 'playtest',
  name: 'PLAYTEST',
  description: 'TEST ARENA',
  gridSize: 8,
  walls: [],
  spawns: [
    { position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 3, startingScore: 0, aiStyle: 'GREEDY' },
    { position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 5, startingScore: 0, aiStyle: 'TURTLE' },
  ],
  tokens: { positions: [], count: 2, respawn: true, mode: 'ESCALATING' },
  phases: { raceTurns: 40, shrinkEveryTurns: 6, shrinkEnabled },
  objectives: { primary: 'TEST', required: [], bonus: [] },
});

test('playtest threading: shrinkEnabled reaches game settings from both builders; absent defaults to on', () => {
  assert.equal(getCampaignPlaytestSettings(createLevel(false)).shrinkEnabled, false);
  assert.equal(getMultiplayerCustomLevelSettings(createLevel(false)).shrinkEnabled, false);
  assert.equal(getCampaignPlaytestSettings(createLevel(undefined)).shrinkEnabled, true);
  assert.equal(getMultiplayerCustomLevelSettings(createLevel(undefined)).shrinkEnabled, true);
});
