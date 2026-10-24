import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  getBufferCapacity,
  processGameTick,
  queueSnakeDirection,
  queueSnakeSkill,
} from './engine';
import { canAffordQueuedRattle, canQueueRattleWithLength } from './skills';
import { undoPlan, clearPlan, lockPlan } from './primePlan';
import { normalizeBufferEntry, normalizeGameState } from './normalize';
import { createReplayDataObject, parseAndValidateReplayData, TurnDecision } from './replayFile';
import { computePreviewPlan } from '../App';
import { BufferEntry, GameSettings, GameState, Snake } from '../types/game';

function createMockRattleSnake(overrides: Partial<Snake> = {}): Snake {
  return {
    id: 'p1',
    name: 'PLAYER 1',
    body: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 5, y: 9 },
      { x: 5, y: 10 },
    ],
    direction: 'UP',
    queuedDirection: null,
    score: 0,
    skillPoints: 5,
    isAlive: true,
    color: '#0F380F',
    equippedSkill: 'rattle',
    pendingSkill: null,
    startLength: 3,
    startingScore: 0,
    ...overrides,
  };
}

function createRattleTestState(overrides: Partial<GameState> = {}): GameState {
  const state = createInitialState();
  state.tokens = [];
  state.walls = [];
  state.rattleWalls = [];
  state.skillsAvailable = 'immediate';
  return { ...state, ...overrides };
}

// -------------------------------------------------------------
// Acceptance Test 1: Prime 3 + direction step
// -------------------------------------------------------------
test('Acceptance 1: Prime 3 + direction step detaches 3 contiguous walls, net len -3, SP -3, head moved 1', () => {
  const state = createRattleTestState();
  const snake = createMockRattleSnake({
    body: [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 4, y: 9 },
    ], // length 6
    skillPoints: 5,
  });
  state.snakes = [snake];

  queueSnakeSkill(snake, { skillId: 'rattle', direction: 'UP', primes: 3 });

  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const nextSnake = result.nextState.snakes[0];

  // Head moved 1 cell UP from (4,4) to (4,3)
  assert.deepEqual(nextSnake.body[0], { x: 4, y: 3 });
  // Net length: 6 - 3 = 3
  assert.equal(nextSnake.body.length, 3);
  // SP: 5 - 3 = 2
  assert.equal(nextSnake.skillPoints, 2);

  // 3 contiguous permanent walls placed at old tail tip positions in order: (4,9), (4,8), (4,7)
  assert.equal(result.nextState.rattleWalls.length, 3);
  assert.deepEqual(result.nextState.rattleWalls, [
    { x: 4, y: 9 },
    { x: 4, y: 8 },
    { x: 4, y: 7 },
  ]);
  assert.deepEqual(result.nextState.walls, [
    { x: 4, y: 9 },
    { x: 4, y: 8 },
    { x: 4, y: 7 },
  ]);
});

test('Acceptance 1b: Prime 3 + direction step with token pickup net length -2 and SP net -2', () => {
  const state = createRattleTestState();
  const snake = createMockRattleSnake({
    body: [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 4, y: 9 },
    ],
    skillPoints: 5,
  });
  state.tokens = [{ x: 4, y: 3, type: 'regular', points: 1 }];
  state.snakes = [snake];

  queueSnakeSkill(snake, { skillId: 'rattle', direction: 'UP', primes: 3 });

  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const nextSnake = result.nextState.snakes[0];

  assert.deepEqual(nextSnake.body[0], { x: 4, y: 3 });
  // Net length: 6 - 3 + 1 = 4
  assert.equal(nextSnake.body.length, 4);
  // SP: 5 - 3 + 1 = 3
  assert.equal(nextSnake.skillPoints, 3);
  assert.equal(nextSnake.score, 1);
});

// -------------------------------------------------------------
// Acceptance Test 2: Multi-detach plan
// -------------------------------------------------------------
test('Acceptance 2: Multi-detach plan executes detaches at their respective ticks with exact SP & lengths', () => {
  let state = createRattleTestState();
  const snake = createMockRattleSnake({
    body: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 5, y: 9 },
      { x: 5, y: 10 },
      { x: 5, y: 11 },
    ], // length 7
    skillPoints: 5,
  });
  state.snakes = [snake];

  // Plan: prime 1, UP -> 2 plain moves UP -> prime 2, UP
  // Tick 1: Prime 1 UP
  queueSnakeSkill(state.snakes[0], { skillId: 'rattle', direction: 'UP', primes: 1 });
  let res = processGameTick(state, DEFAULT_SETTINGS, 0);
  state = res.nextState;
  assert.equal(state.snakes[0].body.length, 6);
  assert.equal(state.snakes[0].skillPoints, 4);
  assert.equal(state.rattleWalls.length, 1);
  assert.deepEqual(state.rattleWalls[0], { x: 5, y: 11 });

  // Tick 2: Plain move UP
  queueSnakeDirection(state.snakes[0], 'UP');
  res = processGameTick(state, DEFAULT_SETTINGS, 0);
  state = res.nextState;
  assert.equal(state.snakes[0].body.length, 6);
  assert.equal(state.snakes[0].skillPoints, 4);
  assert.equal(state.rattleWalls.length, 1);

  // Tick 3: Plain move UP
  queueSnakeDirection(state.snakes[0], 'UP');
  res = processGameTick(state, DEFAULT_SETTINGS, 0);
  state = res.nextState;
  assert.equal(state.snakes[0].body.length, 6);
  assert.equal(state.snakes[0].skillPoints, 4);
  assert.equal(state.rattleWalls.length, 1);

  // Tick 4: Prime 2 UP
  queueSnakeSkill(state.snakes[0], { skillId: 'rattle', direction: 'UP', primes: 2 });
  res = processGameTick(state, DEFAULT_SETTINGS, 0);
  state = res.nextState;
  // Length: 6 - 2 = 4
  assert.equal(state.snakes[0].body.length, 4);
  // SP: 4 - 2 = 2
  assert.equal(state.snakes[0].skillPoints, 2);
  // Total walls: 1 + 2 = 3
  assert.equal(state.rattleWalls.length, 3);
});

// -------------------------------------------------------------
// Acceptance Test 3: Length floor
// -------------------------------------------------------------
test('Acceptance 3: Length floor rules for priming', () => {
  // Length 5: queues 1 to 4 primes; 5th refused
  // Before prime 1: totalPrimes = 0 -> canQueueRattleWithLength(5, 0) is true
  assert.equal(canQueueRattleWithLength(5, 0), true);
  // Before prime 2: totalPrimes = 1 -> canQueueRattleWithLength(5, 1) is true
  assert.equal(canQueueRattleWithLength(5, 1), true);
  // Before prime 3: totalPrimes = 2 -> canQueueRattleWithLength(5, 2) is true
  assert.equal(canQueueRattleWithLength(5, 2), true);
  // Before prime 4: totalPrimes = 3 -> canQueueRattleWithLength(5, 3) is true
  assert.equal(canQueueRattleWithLength(5, 3), true);
  // Before prime 5: totalPrimes = 4 -> canQueueRattleWithLength(5, 4) is false
  assert.equal(canQueueRattleWithLength(5, 4), false);

  // Length 2: queues 1 prime (snake becomes bare head, length 1)
  assert.equal(canQueueRattleWithLength(2, 0), true);
  assert.equal(canQueueRattleWithLength(2, 1), false);

  // Length 1: refuses prime outright (cannot detach bare head)
  assert.equal(canQueueRattleWithLength(1, 0), false);
});

// -------------------------------------------------------------
// Acceptance Test 4: Undo & Clear
// -------------------------------------------------------------
test('Acceptance 4: Undo decrements pending primes one by one before popping buffer; clear refunds all', () => {
  // These helpers are the exact functions App.tsx handleBufferUndo /
  // handleBufferClear call — a regression in the handler wiring is
  // visible in the diff, and a regression in the transition itself
  // fails here. (The previous version of this test simulated the
  // logic with local variables and could not fail.)
  const buffer: BufferEntry[] = [{ type: 'move', direction: 'UP' }];

  let step = undoPlan(buffer, 2);
  assert.equal(step.pendingPrimes, 1);
  assert.equal(step.buffer.length, 1);

  step = undoPlan(step.buffer, step.pendingPrimes);
  assert.equal(step.pendingPrimes, 0);
  assert.equal(step.buffer.length, 1);

  step = undoPlan(step.buffer, step.pendingPrimes);
  assert.equal(step.pendingPrimes, 0);
  assert.equal(step.buffer.length, 0);

  // Undo of a primed step refunds all of its primes at once, because
  // the primes live on the popped step.
  const primed: BufferEntry[] = [{ type: 'rattle', direction: 'UP', primes: 2 }];
  step = undoPlan(primed, 0);
  assert.equal(step.buffer.length, 0);

  const cleared = clearPlan();
  assert.equal(cleared.pendingPrimes, 0);
  assert.equal(cleared.buffer.length, 0);

  // Proof the test catches the old bug: clearing all pending primes
  // at once on the first undo would give pending 0 here, not 1.
  const wrong = undoPlan(buffer, 2);
  assert.notEqual(wrong.pendingPrimes, 0);
});

// -------------------------------------------------------------
// Acceptance Test 5: Lock with primes pending
// -------------------------------------------------------------
test('Acceptance 5: Lock with primes pending drops the pending primes with 0 SP lost', () => {
  const state = createRattleTestState();
  const snake = createMockRattleSnake({
    body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }],
    skillPoints: 4,
  });
  state.snakes = [snake];

  // Client has buffered 1 move, and has 2 pending primes.
  // Lock drops the pending primes via the same helper App.tsx uses.
  const buf: BufferEntry[] = [{ type: 'move', direction: 'UP' }];
  const locked = lockPlan(buf, 2);
  assert.equal(locked.pendingPrimes, 0);
  assert.equal(locked.buffer.length, 1);

  // Step executes only the buffered move
  const entry = locked.buffer.shift()!;
  queueSnakeDirection(snake, entry.direction);
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);

  // Snake moved UP, no detaches occurred, SP unchanged
  assert.equal(result.nextState.snakes[0].skillPoints, 4);
  assert.equal(result.nextState.snakes[0].body.length, 3);
  assert.equal(result.nextState.rattleWalls.length, 0);
});

// -------------------------------------------------------------
// Acceptance Test 6: Preview darkening
// -------------------------------------------------------------
test('Acceptance 6: computePreviewPlan darkens primed segments, keeps walls dark, and darkens simulated tail', () => {
  const snake = createMockRattleSnake({
    body: [
      { x: 5, y: 5 }, // head
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 5, y: 9 }, // tail tip
    ],
  });

  // Test 6a: Primed segments darken on the board before direction is pressed
  const previewPending = computePreviewPlan(snake, [], 2);
  assert.equal(previewPending.darkCells.has('5,9'), true);
  assert.equal(previewPending.darkCells.has('5,8'), true);
  assert.equal(previewPending.darkCells.has('5,7'), false);

  // Test 6b: Detached walls stay dark for the whole preview
  const buffer: BufferEntry[] = [
    { type: 'rattle', direction: 'UP', primes: 1 }, // detaches (5,9), head moves to (5,4)
    { type: 'move', direction: 'UP' }, // moves to (5,3)
  ];
  const previewPlan = computePreviewPlan(snake, buffer, 0);
  assert.equal(previewPlan.darkCells.has('5,9'), true);

  // Test 6c: Second prime group darkens the SIMULATED tail, not initial tail
  const multiBuffer: BufferEntry[] = [
    { type: 'rattle', direction: 'UP', primes: 1 }, // detaches (5,9), tail is now at (5,7)
    { type: 'move', direction: 'UP' },              // tail is now at (5,6)
  ];
  const previewMulti = computePreviewPlan(snake, multiBuffer, 1);
  // After rattle (detaches 5,9) and move (tail at 5,6), 1 pending prime darkens (5,6)
  assert.equal(previewMulti.darkCells.has('5,6'), true);
});

// -------------------------------------------------------------
// Acceptance Test 7: Lethality
// -------------------------------------------------------------
test('Acceptance 7: Snake dies hitting its own detached wall, opponent dies hitting wall, opponent dart dies hitting wall', () => {
  const state = createRattleTestState();
  const p1 = createMockRattleSnake({
    id: 'p1',
    body: [{ x: 4, y: 4 }, { x: 4, y: 5 }],
    direction: 'UP',
  });
  const p2 = createMockRattleSnake({
    id: 'p2',
    body: [{ x: 6, y: 4 }, { x: 6, y: 5 }],
    direction: 'UP',
    color: '#306230',
  });
  state.walls = [{ x: 4, y: 3 }];
  state.rattleWalls = [{ x: 4, y: 3 }];
  state.snakes = [p1, p2];

  // 7a: Placer p1 runs into wall at (4,3)
  queueSnakeDirection(p1, 'UP');
  queueSnakeDirection(p2, 'DOWN');
  const res1 = processGameTick(state, DEFAULT_SETTINGS, 0);
  assert.equal(res1.nextState.snakes.find(s => s.id === 'p1')?.isAlive, false);
  assert.equal(res1.nextState.snakes.find(s => s.id === 'p1')?.deathReason, 'WALL');

  // 7b: Opponent p2 runs into detached wall
  const state2 = createRattleTestState();
  const p1_live = createMockRattleSnake({ id: 'p1', body: [{ x: 1, y: 1 }], direction: 'DOWN' });
  const p2_mover = createMockRattleSnake({ id: 'p2', body: [{ x: 4, y: 4 }], direction: 'UP' });
  state2.walls = [{ x: 4, y: 3 }];
  state2.rattleWalls = [{ x: 4, y: 3 }];
  state2.snakes = [p1_live, p2_mover];
  queueSnakeDirection(p2_mover, 'UP');
  const res2 = processGameTick(state2, DEFAULT_SETTINGS, 0);
  assert.equal(res2.nextState.snakes.find(s => s.id === 'p2')?.isAlive, false);
  assert.equal(res2.nextState.snakes.find(s => s.id === 'p2')?.deathReason, 'WALL');

  // 7c: Opponent darts through a detached wall -> dies (permanent walls block darts)
  const state3 = createRattleTestState();
  const darter = createMockRattleSnake({
    id: 'p2',
    body: [{ x: 4, y: 5 }, { x: 4, y: 6 }],
    direction: 'UP',
    equippedSkill: 'dart',
    skillPoints: 2,
  });
  state3.walls = [{ x: 4, y: 3 }];
  state3.rattleWalls = [{ x: 4, y: 3 }];
  state3.snakes = [p1_live, darter];
  queueSnakeSkill(darter, { skillId: 'dart', direction: 'UP' });
  const res3 = processGameTick(state3, DEFAULT_SETTINGS, 0);
  assert.equal(res3.nextState.snakes.find(s => s.id === 'p2')?.isAlive, false);
  assert.equal(res3.nextState.snakes.find(s => s.id === 'p2')?.deathReason, 'WALL');
});

// -------------------------------------------------------------
// Acceptance Test 8: Old replays (PR #128 compatibility)
// -------------------------------------------------------------
test('Acceptance 8: Old replays with PR #128 rattle step play as 1-prime detach; primes:0 becomes move', () => {
  // PR #128 step with no primes field:
  const pr128Step = { type: 'rattle', direction: 'UP' };
  const normalized1 = normalizeBufferEntry(pr128Step);
  assert.equal(normalized1.type, 'rattle');
  assert.equal(normalized1.primes, 1);

  // Step with primes: 0 becomes a plain move
  const zeroPrimeStep = { type: 'rattle', direction: 'DOWN', primes: 0 };
  const normalized0 = normalizeBufferEntry(zeroPrimeStep);
  assert.equal(normalized0.type, 'move');
  assert.equal(normalized0.direction, 'DOWN');

  // Full replay file load
  const state0 = createInitialState();
  const state1 = { ...createInitialState(), tick: 1 };
  const decisions: TurnDecision[] = [
    {
      tick: 1,
      seat: 'p1',
      queue: [{ type: 'rattle', direction: 'UP' } as BufferEntry],
      lockedAt: 1000,
      autoLock: false,
    },
  ];
  const replay = createReplayDataObject([state0, state1], DEFAULT_SETTINGS, decisions, { p1: false, p2: false });
  const parsed = parseAndValidateReplayData(JSON.stringify(replay));
  const parsedEntry = parsed.decisions[0].queue[0] as BufferEntry;
  assert.equal(parsedEntry.type, 'rattle');
  assert.equal(parsedEntry.primes, 1);
});

// -------------------------------------------------------------
// Acceptance Test 9: Buffer capacity
// -------------------------------------------------------------
test('Acceptance 9: Buffer capacity formula startLength + (score - startingScore); bare-head not capped at 1', () => {
  // Start 3, eat 7 (score 7), detach 5 -> length 5, capacity 10
  const snake = createMockRattleSnake({
    startLength: 3,
    startingScore: 0,
    score: 7,
    body: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }], // length 5
  });
  assert.equal(getBufferCapacity(snake), 10);

  // Bare-head snake (length 1) with score > 0 can queue more than 1 step (not capped at 1)
  const bareHeadSnake = createMockRattleSnake({
    startLength: 3,
    startingScore: 0,
    score: 4,
    body: [{ x: 1, y: 1 }], // length 1
  });
  assert.equal(getBufferCapacity(bareHeadSnake), 7);
  assert.ok(getBufferCapacity(bareHeadSnake) > 1);

  // Fallback for old states without startLength: capacity equals body.length
  const legacySnake = createMockRattleSnake({
    startLength: undefined,
    body: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }],
  });
  assert.equal(getBufferCapacity(legacySnake), 3);
});

// -------------------------------------------------------------
// Acceptance Test 10: Engine resolution fizzle at length 1
// -------------------------------------------------------------
test('Acceptance 10: At length 1, primed step fizzles: 0 SP charged, move happens', () => {
  const state = createRattleTestState();
  const bareSnake = createMockRattleSnake({
    body: [{ x: 4, y: 4 }], // length 1
    skillPoints: 3,
    direction: 'RIGHT',
  });
  state.snakes = [bareSnake];

  // Queue refuses at length 1 (the gate lives in queueSnakeSkill).
  assert.equal(queueSnakeSkill(bareSnake, { skillId: 'rattle', direction: 'UP', primes: 2 }), false);
  // A forced pending rattle fizzles at tick: the move still happens
  // in the step's direction, with no wall and no charge. This is
  // main's fizzle pattern (engine.test.ts), not a queue acceptance.
  bareSnake.pendingSkill = { skillId: 'rattle', direction: 'UP', primes: 2 };

  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const nextSnake = result.nextState.snakes[0];

  // Head moved 1 cell UP from (4,4) to (4,3)
  assert.deepEqual(nextSnake.body[0], { x: 4, y: 3 });
  assert.equal(nextSnake.body.length, 1);
  // 0 SP charged
  assert.equal(nextSnake.skillPoints, 3);
  // No walls placed
  assert.equal(result.nextState.rattleWalls.length, 0);
});

// -------------------------------------------------------------
// Acceptance Test 11: Dispatch integrity
// -------------------------------------------------------------
test('Acceptance 11: Primed step executes with full count through queueSnakeSkill and buffer shift', () => {
  const state = createRattleTestState();
  const snake = createMockRattleSnake({
    body: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 5, y: 9 },
    ],
    skillPoints: 4,
  });
  state.snakes = [snake];

  const buffer: BufferEntry[] = [
    { type: 'rattle', direction: 'RIGHT', primes: 3 },
  ];

  // Buffer shift
  const entry = buffer.shift()!;
  assert.equal(entry.primes, 3);
  queueSnakeSkill(snake, { skillId: 'rattle', direction: entry.direction, primes: entry.primes ?? 1 });

  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const nextSnake = result.nextState.snakes[0];

  assert.equal(nextSnake.body.length, 2);
  assert.equal(nextSnake.skillPoints, 1);
  assert.equal(result.nextState.rattleWalls.length, 3);
});
