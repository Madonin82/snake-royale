import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  processGameTick,
  queueSnakeDirection,
  queueSnakeSkill,
} from './engine';
import { normalizeGameState } from './normalize';
import { computePreviewPlan } from '../App';
import { GameState, Snake } from '../types/game';

function makeSnake(overrides: Partial<Snake> = {}): Snake {
  return {
    id: 'p1',
    name: 'PLAYER 1',
    body: [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
    ],
    direction: 'UP',
    queuedDirection: null,
    score: 0,
    skillPoints: 3,
    tokensSinceLock: 0,
    spEarned: 0,
    isAlive: true,
    color: '#0F380F',
    equippedSkill: 'rattle',
    pendingSkill: null,
    startLength: 3,
    startingScore: 0,
    ...overrides,
  };
}

function makeState(): GameState {
  const state = createInitialState();
  state.tokens = [];
  state.walls = [];
  state.rattleWalls = [];
  state.skillsAvailable = 'immediate';
  return state;
}

test('detach stamps the owner on every wall', () => {
  const state = makeState();
  const snake = makeSnake({
    body: [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 4, y: 7 },
    ],
    skillPoints: 5,
  });
  state.snakes = [snake];
  queueSnakeSkill(snake, { skillId: 'rattle', direction: 'UP', primes: 2 });
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  // Detached tail-inward: tail tip (4,7) first, then (4,6).
  assert.deepEqual(result.nextState.rattleWalls, [
    { x: 4, y: 7, ownerId: 'p1' },
    { x: 4, y: 6, ownerId: 'p1' },
  ]);
  // The walls mirror stays bare positions (no owner field there).
  assert.deepEqual(result.nextState.walls, [
    { x: 4, y: 7 },
    { x: 4, y: 6 },
  ]);
});

test('owner re-eats its own wall: +1 length, +1 SP, no score, wall clears for everyone', () => {
  const state = makeState();
  const snake = makeSnake({ skillPoints: 2 });
  state.snakes = [snake];
  state.rattleWalls = [{ x: 4, y: 3, ownerId: 'p1' }];
  state.walls = [{ x: 4, y: 3 }];
  queueSnakeDirection(snake, 'UP');
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const next = result.nextState.snakes[0];
  assert.equal(next.isAlive, true);
  assert.deepEqual(next.body[0], { x: 4, y: 3 });
  assert.equal(next.body.length, 4); // 3 + 1, no tail pop on an eat step
  assert.equal(next.skillPoints, 3); // 2 + 1 flat refund
  assert.equal(next.score, 0); // a re-eat is not a token: no score
  assert.equal(next.tokensSinceLock, 0); // and no token-lock SP step
  assert.equal(result.nextState.rattleWalls.length, 0);
  assert.equal(result.nextState.walls.length, 0);
});

test('opponent dies on your wall, and the wall survives', () => {
  const state = makeState();
  const p2 = makeSnake({
    id: 'p2',
    name: 'PLAYER 2',
    body: [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
    ],
    direction: 'LEFT',
    color: '#306230',
    equippedSkill: null,
  });
  state.snakes = [p2];
  state.rattleWalls = [{ x: 5, y: 4, ownerId: 'p1' }];
  state.walls = [{ x: 5, y: 4 }];
  queueSnakeDirection(p2, 'LEFT');
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const next = result.nextState.snakes[0];
  assert.equal(next.isAlive, false);
  assert.equal(next.deathReason, 'WALL');
  assert.equal(result.nextState.rattleWalls.length, 1);
});

test('ownerless wall (old replay) is lethal to everyone, never edible', () => {
  const state = makeState();
  const snake = makeSnake({ skillPoints: 3 });
  state.snakes = [snake];
  state.rattleWalls = [{ x: 4, y: 3 }];
  state.walls = [{ x: 4, y: 3 }];
  queueSnakeDirection(snake, 'UP');
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const next = result.nextState.snakes[0];
  assert.equal(next.isAlive, false);
  assert.equal(next.deathReason, 'WALL');
  assert.equal(next.skillPoints, 3); // no refund on a death
  assert.equal(result.nextState.rattleWalls.length, 1);
});

test('detach-and-eat on the same tick: head enters its own just-detached wall', () => {
  const state = makeState();
  // Looped body: head (5,5), tail tip (5,6). Moving DOWN enters the
  // tail tip cell — normally a legal chase-your-tail move.
  const snake = makeSnake({
    body: [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ],
    direction: 'RIGHT',
    skillPoints: 3,
  });
  state.snakes = [snake];
  queueSnakeSkill(snake, { skillId: 'rattle', direction: 'DOWN', primes: 1 });
  const result = processGameTick(state, DEFAULT_SETTINGS, 0);
  const next = result.nextState.snakes[0];
  assert.equal(next.isAlive, true);
  assert.deepEqual(next.body[0], { x: 5, y: 6 });
  assert.equal(next.body.length, 4); // 4 - 1 detach + 1 eat
  assert.equal(next.skillPoints, 3); // 3 - 1 detach + 1 eat
  assert.equal(result.nextState.rattleWalls.length, 0);
  assert.equal(result.nextState.walls.length, 0);
});

test('normalize keeps ownerId on new walls and keeps old walls ownerless', () => {
  const state = makeState();
  state.rattleWalls = [
    { x: 1, y: 1, ownerId: 'p2' },
    { x: 2, y: 2 },
  ];
  const normalized = normalizeGameState(state);
  assert.deepEqual(normalized.rattleWalls, [
    { x: 1, y: 1, ownerId: 'p2' },
    { x: 2, y: 2 },
  ]);
});

test('preview walls carry the planning snake as owner', () => {
  const snake = makeSnake({
    body: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
    ],
  });
  const preview = computePreviewPlan(snake, [{ type: 'rattle', direction: 'UP', primes: 1 }], 0);
  assert.equal(preview.rattleWalls.length, 1);
  assert.equal(preview.rattleWalls[0].ownerId, 'p1');
});
