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

test('getHitstopForTransition returns null for token pickup (linger loop instead), 300ms for regular death, and 500ms + flash cell for boss death', () => {
  const settings = { ...DEFAULT_SETTINGS };

  // Token pickup -> null (no hitstop; token feedback is via the linger + fly loop)
  const tokenState = createInitialState(settings);
  tokenState.tokens = [{ x: 3, y: 2 }];
  const p1 = tokenState.snakes.find(s => s.id === 'p1')!;
  p1.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1.direction = 'RIGHT';
  const afterToken = processGameTick(tokenState, settings, 0).nextState;
  const tokenHitstop = getHitstopForTransition(tokenState, afterToken, false);
  assert.equal(tokenHitstop, null);

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

test('getHitstopForTransition: tokens contribute 0ms (linger loop), dart 150ms, death 300ms, quiet null', () => {
  const settings = { ...DEFAULT_SETTINGS };

  // 2 tokens same turn -> null (no hitstop; token feedback is via linger loop)
  const twoTokenState = createInitialState(settings);
  twoTokenState.tokens = [{ x: 3, y: 2 }, { x: 4, y: 5 }];
  const p1Two = twoTokenState.snakes.find(s => s.id === 'p1')!;
  p1Two.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1Two.direction = 'RIGHT';
  const p2Two = twoTokenState.snakes.find(s => s.id === 'p2')!;
  p2Two.body = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
  p2Two.direction = 'LEFT';
  const afterTwoTokens = processGameTick(twoTokenState, settings, 0).nextState;
  assert.equal(getHitstopForTransition(twoTokenState, afterTwoTokens, false), null);

  // Token + death same turn -> 300ms DEATH (death only, token contributes 0)
  const mixedState = createInitialState(settings);
  mixedState.tokens = [{ x: 3, y: 2 }];
  const p1Mixed = mixedState.snakes.find(s => s.id === 'p1')!;
  p1Mixed.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1Mixed.direction = 'RIGHT';
  const p2Mixed = mixedState.snakes.find(s => s.id === 'p2')!;
  p2Mixed.body = [{ x: 7, y: 2 }, { x: 6, y: 2 }];
  p2Mixed.direction = 'RIGHT';
  const afterMixed = processGameTick(mixedState, settings, 0).nextState;
  assert.deepEqual(getHitstopForTransition(mixedState, afterMixed, false), {
    durationMs: 300,
    kind: 'DEATH',
    flashCells: [{ x: 8, y: 2 }],
  });

  // Dart + token same turn -> 150ms DART (dart only, token contributes 0)
  const dartState = createInitialState(settings);
  dartState.skillsAvailable = 'immediate';
  dartState.tokens = [{ x: 3, y: 2 }];
  const p1Dart = dartState.snakes.find(s => s.id === 'p1')!;
  p1Dart.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1Dart.direction = 'RIGHT';
  p1Dart.equippedSkill = 'dart';
  p1Dart.skillPoints = 5;
  const p2Dart = dartState.snakes.find(s => s.id === 'p2')!;
  p2Dart.body = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
  p2Dart.direction = 'LEFT';
  p2Dart.equippedSkill = 'dart';
  p2Dart.skillPoints = 5;
  // p2 darts away from the token; p1 grabs it. Dart trail + token pickup.
  queueSnakeSkill(p2Dart, { skillId: 'dart', direction: 'LEFT' });
  const afterDart = processGameTick(dartState, { ...settings, skillsAvailable: 'immediate' as const }, 0).nextState;
  assert.deepEqual(getHitstopForTransition(dartState, afterDart, false), {
    durationMs: 150,
    kind: 'DART',
    flashCells: [],
  });

  // Quiet turn (no events) -> null
  const quietState = createInitialState(settings);
  quietState.tokens = [];
  const p1Quiet = quietState.snakes.find(s => s.id === 'p1')!;
  p1Quiet.body = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
  p1Quiet.direction = 'RIGHT';
  const afterQuiet = processGameTick(quietState, settings, 0).nextState;
  assert.equal(getHitstopForTransition(quietState, afterQuiet, false), null);
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

test('head-on same-cell: higher skillPoints wins, loser dies in place with lunged body minus head', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
  p1.direction = 'RIGHT';
  p1.skillPoints = 4; // higher SP

  p2.body = [{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }];
  p2.direction = 'LEFT';
  p2.skillPoints = 2; // lower SP

  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(s => s.id === 'p1')!;
  const afterP2 = nextState.snakes.find(s => s.id === 'p2')!;

  assert.equal(afterP1.isAlive, true);
  assert.deepEqual(afterP1.body[0], { x: 3, y: 3 });
  assert.equal(afterP1.kills, 1);

  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'HEAD_ON');
  assert.equal(afterP2.killedBy, 'p1');
  assert.deepEqual(afterP2.deathPosition, { x: 3, y: 3 });
  assert.deepEqual(afterP2.body, [{ x: 4, y: 3 }, { x: 5, y: 3 }]);
});

test('head-on exact tie on SP and length -> mutual kill, both bodies frozen whole', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }];
  p1.direction = 'RIGHT';
  p1.skillPoints = 3;
  p2.body = [{ x: 4, y: 3 }, { x: 5, y: 3 }];
  p2.direction = 'LEFT';
  p2.skillPoints = 3;

  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(s => s.id === 'p1')!;
  const afterP2 = nextState.snakes.find(s => s.id === 'p2')!;

  assert.equal(afterP1.isAlive, false);
  assert.equal(afterP1.deathReason, 'HEAD_ON');
  assert.deepEqual(afterP1.body, [{ x: 2, y: 3 }, { x: 1, y: 3 }]);

  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'HEAD_ON');
  assert.deepEqual(afterP2.body, [{ x: 4, y: 3 }, { x: 5, y: 3 }]);
});

test('head-on crossed head-swap with SP advantage -> winner advances, loser body frozen neck-to-tail without lunge', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 3, y: 3 }, { x: 2, y: 3 }];
  p1.direction = 'RIGHT';
  p1.skillPoints = 5;

  p2.body = [{ x: 4, y: 3 }, { x: 5, y: 3 }];
  p2.direction = 'LEFT';
  p2.skillPoints = 2;

  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(s => s.id === 'p1')!;
  const afterP2 = nextState.snakes.find(s => s.id === 'p2')!;

  assert.equal(afterP1.isAlive, true);
  assert.deepEqual(afterP1.body[0], { x: 4, y: 3 });

  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'HEAD_ON');
  assert.equal(afterP2.killedBy, 'p1');
  assert.deepEqual(afterP2.deathPosition, { x: 4, y: 3 });
  assert.deepEqual(afterP2.body, [{ x: 5, y: 3 }]);
});

test('3-player head-on: A beats B, B/C pair skipped once B is dead', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }];
  p1.direction = 'RIGHT';
  p1.skillPoints = 5;

  p2.body = [{ x: 4, y: 3 }];
  p2.direction = 'LEFT';
  p2.skillPoints = 2;

  state.snakes.push({
    id: 'p3',
    name: 'BOT 3',
    body: [{ x: 6, y: 3 }],
    direction: 'LEFT',
    score: 0,
    skillPoints: 1,
    isAlive: true,
    color: '#306230',
    equippedSkill: null,
    pendingSkill: null,
    queuedDirection: null,
  });

  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.snakes.find(s => s.id === 'p1')?.isAlive, true);
  assert.equal(nextState.snakes.find(s => s.id === 'p2')?.isAlive, false);
  assert.equal(nextState.snakes.find(s => s.id === 'p3')?.isAlive, true);
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
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 5 }];
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
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 1, y: 5 }];
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

test('rattle detaches tail tip into permanent wall, moves 1 cell in chosen direction, reduces length by 1, and costs 1 SP', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 4;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
  p2.direction = 'UP';

  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' }), true);
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;

  // Moved UP to (2,3), length reduced from 3 to 2, tail (0,4) became wall with fuse 3
  // (fuse decrements at START of tick, so drop tick shows 3)
  assert.deepEqual(afterP1.body, [{ x: 2, y: 3 }, { x: 2, y: 4 }]);
  assert.equal(afterP1.body.length, 2);
  assert.equal(afterP1.skillPoints, 3);
  assert.deepEqual(nextState.rattleWalls, [{ x: 0, y: 4, fuseTicks: 3 }]);
  assert.ok(nextState.walls?.some(w => w.x === 0 && w.y === 4));

  // Wall persists on subsequent ticks, fuse decrements
  const { nextState: tick2 } = processGameTick(nextState, settings, 0);
  assert.deepEqual(tick2.rattleWalls, [{ x: 0, y: 4, fuseTicks: 2 }]);
  assert.ok(tick2.walls?.some(w => w.x === 0 && w.y === 4));
});

test('rattle detonates after 3-turn fuse, stuns ALL snakes in 3x3 including rattler', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 4;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // p2 head at (1,5) — inside 3x3 centered on wall cell (0,4)
  p2.body = [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 1, y: 7 }];
  p2.direction = 'UP';

  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' }), true);
  const { nextState: tick1 } = processGameTick(state, settings, 0);
  // No stun on drop — fuse is 3 on drop turn
  assert.equal(tick1.snakes.find(s => s.id === 'p2')!.stunTicks ?? 0, 0);
  assert.equal(tick1.snakes.find(s => s.id === 'p1')!.stunTicks ?? 0, 0);
  assert.equal(tick1.rattleWalls?.[0].fuseTicks, 3);

  // Tick 2: fuse 2, no stun
  const { nextState: tick2 } = processGameTick(tick1, settings, 0);
  assert.equal(tick2.rattleWalls?.[0].fuseTicks, 2);
  assert.equal(tick2.snakes.find(s => s.id === 'p2')!.stunTicks ?? 0, 0);

  // Tick 3: fuse 1, no stun
  const { nextState: tick3 } = processGameTick(tick2, settings, 0);
  assert.equal(tick3.rattleWalls?.[0].fuseTicks, 1);
  assert.equal(tick3.snakes.find(s => s.id === 'p2')!.stunTicks ?? 0, 0);

  // Tick 4: fuse 0 → detonation! p2 stunned (in 3x3), p1 not (outside 3x3)
  // Wall is consumed: leaves rattleWalls, stays in walls as a plain blocker.
  const { nextState: tick4 } = processGameTick(tick3, settings, 0);
  assert.deepEqual(tick4.rattleWalls, []);
  assert.ok(tick4.walls?.some(w => w.x === 0 && w.y === 4));
  assert.equal(tick4.snakes.find(s => s.id === 'p2')!.stunTicks, 1);
  assert.equal(tick4.snakes.find(s => s.id === 'p1')!.stunTicks ?? 0, 0);
  assert.equal(tick4.stunZones?.length, 9);
  assert.ok(tick4.detonationAt);

  // Tick 5: p2 stays in place (stun consumed), wall persists
  const p2HeadBefore = { ...tick4.snakes.find(s => s.id === 'p2')!.body[0] };
  const { nextState: tick5 } = processGameTick(tick4, settings, 0);
  const tick5P2 = tick5.snakes.find(s => s.id === 'p2')!;
  assert.deepEqual(tick5P2.body[0], p2HeadBefore);
  assert.equal(tick5P2.stunTicks, 0);
  assert.equal(tick5.stunZones, undefined);
  assert.deepEqual(tick5.rattleWalls, []);
  assert.ok(tick5.walls?.some(w => w.x === 0 && w.y === 4));
});

test('rattle detonation happens exactly once — no re-detonation on later ticks', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 4;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 1, y: 7 }];
  p2.direction = 'UP';

  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' }), true);
  const { nextState: tick1 } = processGameTick(state, settings, 0);
  // Steer p1 RIGHT so it survives past tick 5 (otherwise p1 runs off the
  // top edge on tick 5, the death early-return masks any re-detonation).
  tick1.snakes.find(s => s.id === 'p1')!.direction = 'RIGHT';
  const { nextState: tick2 } = processGameTick(tick1, settings, 0);
  const { nextState: tick3 } = processGameTick(tick2, settings, 0);
  const { nextState: tick4 } = processGameTick(tick3, settings, 0);
  assert.equal(tick4.snakes.find(s => s.id === 'p2')!.stunTicks, 1);
  assert.equal(tick4.stunZones?.length, 9);
  const detonationAt = tick4.detonationAt;

  // Tick 5: stun consumed, zone clears, both snakes alive (no early-return mask).
  const { nextState: tick5 } = processGameTick(tick4, settings, 0);
  assert.equal(tick5.snakes.find(s => s.id === 'p1')!.isAlive, true);
  assert.equal(tick5.snakes.find(s => s.id === 'p2')!.stunTicks, 0);
  assert.equal(tick5.stunZones, undefined);

  // Tick 6: no re-detonation — stun stays 0, zone stays clear, detonationAt unchanged.
  const { nextState: tick6 } = processGameTick(tick5, settings, 0);
  assert.equal(tick6.snakes.find(s => s.id === 'p2')!.stunTicks, 0);
  assert.equal(tick6.stunZones, undefined);
  assert.equal(tick6.detonationAt, detonationAt);
  assert.deepEqual(tick6.rattleWalls, []);
  assert.ok(tick6.walls?.some(w => w.x === 0 && w.y === 4));
});

test('rattle detonation with no snake in 3x3 clears the blast zone next tick', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 4;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // p2 far from the 3x3 (x -1..1, y 3..5), moving LEFT along the bottom row.
  p2.body = [{ x: 7, y: 7 }, { x: 7, y: 6 }, { x: 7, y: 5 }];
  p2.direction = 'LEFT';

  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' }), true);
  const { nextState: tick1 } = processGameTick(state, settings, 0);
  tick1.snakes.find(s => s.id === 'p1')!.direction = 'RIGHT';
  const { nextState: tick2 } = processGameTick(tick1, settings, 0);
  const { nextState: tick3 } = processGameTick(tick2, settings, 0);

  // Tick 4: detonation, but nobody in the zone — no snake stunned.
  const { nextState: tick4 } = processGameTick(tick3, settings, 0);
  assert.equal(tick4.snakes.find(s => s.id === 'p1')!.stunTicks ?? 0, 0);
  assert.equal(tick4.snakes.find(s => s.id === 'p2')!.stunTicks ?? 0, 0);
  assert.equal(tick4.stunZones?.length, 9);
  assert.ok(tick4.detonationAt);
  assert.deepEqual(tick4.rattleWalls, []);

  // Tick 5: blast zone clears even though nobody was stunned.
  const { nextState: tick5 } = processGameTick(tick4, settings, 0);
  assert.equal(tick5.stunZones, undefined);
  assert.ok(tick5.walls?.some(w => w.x === 0 && w.y === 4));
});

test('detonated rattle wall still blocks as a plain wall', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  // Wall one tick from detonation, already in both arrays (as a live drop would be).
  state.rattleWalls = [{ x: 4, y: 4, fuseTicks: 1 }];
  state.walls = [{ x: 4, y: 4 }];
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }];
  p1.direction = 'RIGHT';
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  // p2 approaches from the right, will be stunned by detonation, then turns into the wall.
  p2.body = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  p2.direction = 'LEFT';

  // Tick 1: p2 moves to (4,5), detonation stuns it (body in 3x3), wall consumed.
  const { nextState: tick1 } = processGameTick(state, settings, 0);
  assert.equal(tick1.snakes.find(s => s.id === 'p2')!.stunTicks, 1);
  assert.deepEqual(tick1.rattleWalls, []);
  assert.ok(tick1.walls?.some(w => w.x === 4 && w.y === 4));

  // Tick 2: p2 stunned, stays at (4,5).
  const { nextState: tick2 } = processGameTick(tick1, settings, 0);
  assert.equal(tick2.snakes.find(s => s.id === 'p2')!.stunTicks, 0);
  tick2.snakes.find(s => s.id === 'p2')!.direction = 'UP';

  // Tick 3: p2 moves UP into (4,4) — the detonated wall — and dies to WALL.
  const { nextState: tick3 } = processGameTick(tick2, settings, 0);
  const tick3P2 = tick3.snakes.find(s => s.id === 'p2')!;
  assert.equal(tick3P2.isAlive, false);
  assert.equal(tick3P2.deathReason, 'WALL');
  assert.deepEqual(tick3P2.deathPosition, { x: 4, y: 4 });
});

test('hitting a rattle wall kills both opponents and the placer', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;

  // P1 places rattle wall at (2,4) while moving UP from (4,4)
  p1.body = [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 2;

  // P2 moves RIGHT into (2,4) on the same turn
  p2.body = [{ x: 1, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 5 }];
  p2.direction = 'RIGHT';

  queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP2 = nextState.snakes.find(snake => snake.id === 'p2')!;
  assert.equal(afterP2.isAlive, false);
  assert.equal(afterP2.deathReason, 'WALL');
  assert.deepEqual(afterP2.deathPosition, { x: 2, y: 4 });
});

test('placer hitting their own rattle wall dies with WALL reason', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 7 }, { x: 7, y: 6 }, { x: 7, y: 5 }];
  p2.direction = 'UP';

  // P1 in a 2x2 loop where tail tip is at (1,2) and head is at (2,2) facing UP
  p1.body = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }];
  p1.direction = 'UP';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 2;

  // Rattle LEFT moves head into (1,2), where tail tip just detached into a wall
  queueSnakeSkill(p1, { skillId: 'rattle', direction: 'LEFT' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.equal(afterP1.isAlive, false);
  assert.equal(afterP1.deathReason, 'WALL');
  assert.deepEqual(afterP1.deathPosition, { x: 1, y: 2 });
});

test('darting through a rattle wall cell kills the darter', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  state.walls = [{ x: 3, y: 4 }];
  state.rattleWalls = [{ x: 3, y: 4, fuseTicks: 3 }];

  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 1, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 5 }];
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'dart';
  p1.skillPoints = 4;

  queueSnakeSkill(p1, { skillId: 'dart', direction: 'RIGHT' });
  const { nextState } = processGameTick(state, settings, 0);
  const afterP1 = nextState.snakes.find(snake => snake.id === 'p1')!;
  assert.equal(afterP1.isAlive, false);
  assert.equal(afterP1.deathReason, 'WALL');
  assert.deepEqual(afterP1.deathPosition, { x: 3, y: 4 });
});

test('rattle cannot activate below length 3 or with fewer than 1 SP, and fizzles without direction', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS, skillsAvailable: 'immediate' as const };
  state.tokens = [];
  state.skillsAvailable = 'immediate';
  const p1 = state.snakes.find(snake => snake.id === 'p1')!;
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }]; // length 2 (< 3)
  p1.direction = 'RIGHT';
  p1.equippedSkill = 'rattle';
  p1.skillPoints = 4;
  const p2 = state.snakes.find(snake => snake.id === 'p2')!;
  p2.body = [{ x: 7, y: 7 }, { x: 7, y: 6 }, { x: 7, y: 5 }];
  p2.direction = 'UP';

  // Rejected at queue time when length < 3
  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' }), false);
  // Even if forced onto pendingSkill, fizzles on tick
  p1.pendingSkill = { skillId: 'rattle', direction: 'UP' };
  const resLen2 = processGameTick(state, settings, 0).nextState;
  const afterLen2 = resLen2.snakes.find(s => s.id === 'p1')!;
  assert.equal(afterLen2.body.length, 2);
  assert.equal(afterLen2.skillPoints, 4);
  assert.equal(resLen2.rattleWalls ?? undefined, undefined);

  // Rattle without direction fizzles cleanly (no SP spent, no wall placed)
  p1.body = [{ x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
  assert.equal(queueSnakeSkill(p1, { skillId: 'rattle' } as any), false);
  p1.pendingSkill = { skillId: 'rattle' } as any;
  const resNoDir = processGameTick(state, settings, 0).nextState;
  const afterNoDir = resNoDir.snakes.find(s => s.id === 'p1')!;
  assert.equal(afterNoDir.body.length, 3);
  assert.equal(afterNoDir.skillPoints, 4);
  assert.equal(resNoDir.rattleWalls ?? undefined, undefined);

  // Rattle with < 1 SP fizzles cleanly
  p1.skillPoints = 0;
  queueSnakeSkill(p1, { skillId: 'rattle', direction: 'UP' });
  const resLowSp = processGameTick(state, settings, 0).nextState;
  const afterLowSp = resLowSp.snakes.find(s => s.id === 'p1')!;
  assert.equal(afterLowSp.body.length, 3);
  assert.equal(afterLowSp.skillPoints, 0);
  assert.equal(resLowSp.rattleWalls ?? undefined, undefined);
});

test('frozen snake stays in place, still blocks, and keeps its stunTicks', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
  p1.direction = 'RIGHT';
  p2.body = [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 }];
  p2.direction = 'LEFT';
  p2.stunTicks = 2;

  const result = processGameTick(state, settings, 0, { frozenSnakeIds: new Set(['p2']) });
  const afterP1 = result.nextState.snakes.find(s => s.id === 'p1')!;
  const afterP2 = result.nextState.snakes.find(s => s.id === 'p2')!;
  // Active snake moves; frozen snake does not move.
  assert.deepEqual(afterP1.body[0], { x: 3, y: 3 });
  assert.deepEqual(afterP2.body, [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 }]);
  // Frozen stun is preserved (not decremented) for the frozen snake's own turn.
  assert.equal(afterP2.stunTicks, 2);
  assert.equal(afterP1.isAlive, true);
  assert.equal(afterP2.isAlive, true);
});

test('frozen snake body still kills a mover that runs into it', () => {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
  p1.direction = 'RIGHT';
  p2.body = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }];
  p2.direction = 'LEFT';

  const result = processGameTick(state, settings, 0, { frozenSnakeIds: new Set(['p2']) });
  const afterP1 = result.nextState.snakes.find(s => s.id === 'p1')!;
  const afterP2 = result.nextState.snakes.find(s => s.id === 'p2')!;
  assert.equal(afterP1.isAlive, false);
  assert.equal(afterP1.deathReason, 'OPPONENT');
  assert.equal(afterP2.isAlive, true);
});

