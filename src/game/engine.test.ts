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
  p1.skillPoints = 5;
  // Move p2 out of the way
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.deepEqual(after.body[0], { x: 5, y: 5 });
  assert.equal(after.skillPoints, 3);
  assert.equal(after.score, 0); // token count untouched by dart cost
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
  p1.skillPoints = 2;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  // +1 pickup (now 3 points), -2 dart cost = 1 point; +1 token
  assert.equal(after.skillPoints, 1);
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
  p1.skillPoints = 5;
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.equal(after.isAlive, false);
});

test('dart triggers 150ms DART hitstop with trail cells', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.skillPoints = 5;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }];
  p2.direction = 'LEFT';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState;
  assert.ok(after.dartTrail && after.dartTrail.length > 0);
  assert.equal(after.dartTrail[0].snakeId, 'p1');
  assert.equal(after.dartTrail[0].cells.length, 2);
  const hitstop = getHitstopForTransition(state, after, false);
  assert.equal(hitstop?.kind, 'DART');
  assert.equal(hitstop?.durationMs, 150);
});

test('token pickup grants +1 score and +1 skillPoint', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [{ x: 3, y: 5 }];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.equal(after.score, 1);
  assert.equal(after.skillPoints, 1);
  assert.equal(after.body.length, 4); // grew by one
});

test('dart cannot fire on tokens alone — wallet must afford it', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.score = 10; // rich in tokens...
  p1.skillPoints = 1; // ...but broke in the wallet
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }];
  p2.direction = 'UP';
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const result = processGameTick(state, settings, 0);
  const after = result.nextState.snakes.find(snake => snake.id === 'p1')!;
  // Dart fizzled: moved a single cell, no deduction, tokens untouched
  assert.deepEqual(after.body[0], { x: 3, y: 5 });
  assert.equal(after.skillPoints, 1);
  assert.equal(after.score, 10);
});

test('tiebreak on mutual destruction: higher skillPoints wins', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }];
  p1.direction = 'RIGHT';
  p1.score = 6; // fewer tokens...
  p1.skillPoints = 4; // ...but more points left (spent less)
  p2.body = [{ x: 4, y: 3 }];
  p2.direction = 'LEFT';
  p2.score = 10;
  p2.skillPoints = 2;
  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.snakes.find(snake => snake.id === 'p1')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.snakes.find(snake => snake.id === 'p2')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.winner, 'p1');
  assert.ok(nextState.winReason.includes('points'));
});

test('tiebreak on mutual destruction: tied points fall back to length', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // Annie's clarifying case: 10 tokens/3 darts (4 pts) vs 6 tokens/1 dart (4 pts)
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  p1.score = 10;
  p1.skillPoints = 4;
  p2.body = [{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }];
  p2.direction = 'LEFT';
  p2.score = 6;
  p2.skillPoints = 4;
  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.snakes.find(snake => snake.id === 'p1')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.snakes.find(snake => snake.id === 'p2')?.deathReason, 'HEAD_ON');
  assert.equal(nextState.winner, 'p1'); // tied on points → longer body wins
});

test('snipe: darting head meets stationary head, darter wins tiebreak → opponent sniped', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.skillsAvailable = 'immediate';
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // p1 darts RIGHT from (2,4): (3,4), (4,4), (5,4).
  // p2 moves DOWN (4,3)→(4,4) on step 0; on step 1 p1 lands on p2's head.
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.skillPoints = 5;
  p2.body = [{ x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }];
  p2.direction = 'DOWN';
  p2.skillPoints = 0;
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;
  const afterP2 = nextState.snakes.find(snake => snake.id === 'p2')!;
  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'OPPONENT'); // sniped by the darter
  assert.equal(afterP1.isAlive, true);
  assert.deepEqual(afterP1.body[0], { x: 5, y: 4 }); // dart completed
});

test('snipe fails: darter loses tiebreak → darter dies on the head', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.skillsAvailable = 'immediate';
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.skillPoints = 2; // affords the dart, but loses the tiebreak 2 < 5
  p2.body = [{ x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }];
  p2.direction = 'DOWN';
  p2.skillPoints = 5;
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;
  const afterP2 = nextState.snakes.find(snake => snake.id === 'p2')!;
  assert.equal(afterP1.isAlive, false); // darter dies, snipe not lethal
  assert.equal(afterP2.isAlive, true);
});

test('snipe on step 0: simultaneous head meeting, darter wins tiebreak → opponent sniped', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.skillsAvailable = 'immediate';
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // p1 darts RIGHT from (2,4), p2 moves LEFT from (4,4): both enter (3,4) on step 0.
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.skillPoints = 5;
  p2.body = [{ x: 4, y: 4 }, { x: 5, y: 4 }];
  p2.direction = 'LEFT';
  p2.skillPoints = 0;
  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;
  const afterP2 = nextState.snakes.find(snake => snake.id === 'p2')!;
  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'OPPONENT');
  assert.equal(afterP1.isAlive, true);
});
