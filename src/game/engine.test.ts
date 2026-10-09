import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS, getHitstopForTransition, processGameTick, queueSnakeSkill } from './engine';
import { GameState, GameSettings, Position } from '../types/game';

function runDeathTick(
  configure: (state: GameState, settings: GameSettings) => void,
): Position | undefined {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  configure(state, settings);

  const result = processGameTick(state, settings, 0);
  const deadSnake = result.nextState.snakes.find(snake => !snake.isAlive);
  return deadSnake?.deathPosition;
}

test('records the attempted cell for wall deaths', () => {
  assert.deepEqual(runDeathTick((state) => {
    const p1 = state.snakes.find(snake => snake.id === 'p1')!;
    p1.body = [{ x: 7, y: 2 }, { x: 6, y: 2 }];
    p1.direction = 'RIGHT';
  }), { x: 8, y: 2 });
});

test('records the attempted cell for opponent-body deaths', () => {
  assert.deepEqual(runDeathTick((state) => {
    const p1 = state.snakes.find(snake => snake.id === 'p1')!;
    const p2 = state.snakes.find(snake => snake.id === 'p2')!;
    p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }];
    p1.direction = 'RIGHT';
    p2.body = [{ x: 6, y: 5 }, { x: 3, y: 3 }, { x: 7, y: 5 }];
    p2.direction = 'LEFT';
  }), { x: 3, y: 3 });
});

test('records the attempted cell when the shrink ring closes onto a snake', () => {
  assert.deepEqual(runDeathTick((state) => {
    state.phase = 'SHRINKING';
    state.phaseTurnsRemaining = 1;
    const p1 = state.snakes.find(snake => snake.id === 'p1')!;
    p1.body = [{ x: 1, y: 3 }, { x: 2, y: 3 }];
    p1.direction = 'LEFT';
  }), { x: 0, y: 3 });
});

test('resolves a P1/P3 head-on collision while P2 survives', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }];
  p1.direction = 'RIGHT';
  p2.body = [{ x: 6, y: 6 }];
  p2.direction = 'LEFT';
  state.snakes.push({
    ...p2,
    id: 'p3',
    name: 'BOT 3',
    body: [{ x: 4, y: 3 }],
    direction: 'LEFT',
    isAlive: true,
  });

  const { nextState } = processGameTick(state, settings, 0);

  assert.equal(nextState.snakes.find(snake => snake.id === 'p1')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.snakes.find(snake => snake.id === 'p3')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.snakes.find(snake => snake.id === 'p2')?.isAlive, true);
  assert.equal(nextState.winner, 'p2');
});

test('resolves a three-way simultaneous head-on collision as a draw', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }];
  p1.direction = 'RIGHT';
  p2.body = [{ x: 4, y: 3 }];
  p2.direction = 'LEFT';
  state.snakes.push({
    ...p2,
    id: 'p3',
    name: 'BOT 3',
    body: [{ x: 3, y: 2 }],
    direction: 'DOWN',
    isAlive: true,
  });

  const { nextState } = processGameTick(state, settings, 0);

  assert.ok(nextState.snakes.every(snake => !snake.isAlive && snake.deathReason === 'HEAD_ON'));
  assert.equal(nextState.phase, 'OVER');
  assert.equal(nextState.winner, 'DRAW');
});

test('getHitstopForTransition returns 100ms for token pickup, 300ms for regular death, and 500ms + flash cell for boss death', () => {
  const settings = { ...DEFAULT_SETTINGS };

  // Token pickup -> 100ms
  const tokenState = createInitialState(settings);
  tokenState.tokens = [{ x: 3, y: 2 }];
  const p1 = tokenState.snakes.find(s => s.id === 'p1')!;
  p1.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1.direction = 'RIGHT';
  const afterToken = processGameTick(tokenState, settings, 0).nextState;
  const tokenHitstop = getHitstopForTransition(tokenState, afterToken, false);
  assert.deepEqual(tokenHitstop, {
    durationMs: 100,
    kind: 'TOKEN',
    flashCells: [],
  });

  // Regular death -> 300ms
  const deathState = createInitialState(settings);
  deathState.tokens = [];
  const p1Death = deathState.snakes.find(s => s.id === 'p1')!;
  p1Death.body = [{ x: 7, y: 2 }, { x: 6, y: 2 }];
  p1Death.direction = 'RIGHT';
  const afterDeath = processGameTick(deathState, settings, 0).nextState;
  const regularDeathHitstop = getHitstopForTransition(deathState, afterDeath, false);
  assert.deepEqual(regularDeathHitstop, {
    durationMs: 300,
    kind: 'DEATH',
    flashCells: [{ x: 8, y: 2 }],
  });

  // Boss death in campaign -> 500ms + white flash on death cell
  const bossState = createInitialState(settings);
  bossState.tokens = [];
  const p2Boss = bossState.snakes.find(s => s.id === 'p2')!;
  p2Boss.body = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  p2Boss.direction = 'LEFT';
  const afterBossDeath = processGameTick(bossState, settings, 0).nextState;
  const bossDeathHitstop = getHitstopForTransition(bossState, afterBossDeath, true);
  assert.deepEqual(bossDeathHitstop, {
    durationMs: 500,
    kind: 'BOSS_DEATH',
    flashCells: [{ x: 0, y: 5 }],
  });
});


test('dart moves 3 total cells (1 normal + 2 dart)', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.score = 5;
  // Move p2 out of the way
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.deepEqual(after.body[0], { x: 5, y: 5 });
  assert.equal(after.score, 3);
});

test('dart applies token pickup before deducting cost', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.skillsAvailable = 'immediate';
  state.tokens = [{ x: 4, y: 5 }];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.score = 2;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  // +1 pickup (now 3), -2 dart cost = 1
  assert.equal(after.score, 1);
  assert.equal(after.isAlive, true);
});

test('dart into wall kills the snake', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.score = 5;
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.equal(after.isAlive, false);
});
