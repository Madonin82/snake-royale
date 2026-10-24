import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVirtualHead, findBfsPath, findFallbackBfsPath, getObstacleSet, resolveDominantDirection } from './mousePathfinding';
import { GameState, Snake } from '../types/game';

function createMockSnake(overrides: Partial<Snake> = {}): Snake {
  return {
    id: 'p1',
    body: [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
    direction: 'RIGHT',
    queuedDirection: null,
    score: 0,
    isAlive: true,
    skillPoints: 2,
    equippedSkill: 'dart',
    pendingSkill: null,
    ...overrides,
  };
}

function createMockGameState(overrides: Partial<GameState> = {}): GameState {
  const p1 = createMockSnake({ id: 'p1', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'RIGHT' });
  const p2 = createMockSnake({ id: 'p2', body: [{ x: 7, y: 7 }, { x: 7, y: 6 }], direction: 'DOWN' });
  return {
    tick: 1,
    phase: 'PLANNING',
    snakes: [p1, p2],
    tokens: [{ x: 5, y: 5, type: 'regular', points: 1 }],
    walls: [],
    rattleWalls: [],
    gridSize: 8,
    ringInset: 0,
    isTelegraphingShrink: false,
    telegraphRingInset: 0,
    activeMatchId: 'test-match',
    matchNumber: 1,
    readyConfirmed: { p1: true, p2: true },
    ...overrides,
  };
}

test('computeVirtualHead: advances through moves, darts, and rattles correctly', () => {
  const snake = createMockSnake();

  // Empty buffer
  const v1 = computeVirtualHead(snake, []);
  assert.deepEqual(v1, { pos: { x: 2, y: 2 }, dir: 'RIGHT' });

  // 1 move RIGHT
  const v2 = computeVirtualHead(snake, [{ type: 'move', direction: 'RIGHT' }]);
  assert.deepEqual(v2, { pos: { x: 3, y: 2 }, dir: 'RIGHT' });

  // Move RIGHT then move DOWN
  const v3 = computeVirtualHead(snake, [
    { type: 'move', direction: 'RIGHT' },
    { type: 'move', direction: 'DOWN' },
  ]);
  assert.deepEqual(v3, { pos: { x: 3, y: 3 }, dir: 'DOWN' });

  // Dart UP (advances 3 cells)
  const v4 = computeVirtualHead(snake, [
    { type: 'dart', direction: 'UP' },
  ]);
  assert.deepEqual(v4, { pos: { x: 2, y: -1 }, dir: 'UP' });

  // Rattle advances 1 cell in direction and updates dir
  const v5 = computeVirtualHead(snake, [
    { type: 'rattle', direction: 'DOWN' },
  ]);
  assert.deepEqual(v5, { pos: { x: 2, y: 3 }, dir: 'DOWN' });

  // Combination: move RIGHT (3,2) -> rattle UP (3,1, dir UP) -> move UP (3,0)
  const v6 = computeVirtualHead(snake, [
    { type: 'move', direction: 'RIGHT' },
    { type: 'rattle', direction: 'UP' },
    { type: 'move', direction: 'UP' },
  ]);
  assert.deepEqual(v6, { pos: { x: 3, y: 0 }, dir: 'UP' });
});

test('getObstacleSet: indexes walls, rattle walls, and all snakes bodies', () => {
  const state = createMockGameState({
    walls: [{ x: 3, y: 3 }],
    rattleWalls: [{ x: 4, y: 4 }],
  });

  const obstacles = getObstacleSet(state);
  assert.equal(obstacles.has('3,3'), true);
  assert.equal(obstacles.has('4,4'), true);
  // P1 body
  assert.equal(obstacles.has('2,2'), true);
  assert.equal(obstacles.has('1,2'), true);
  assert.equal(obstacles.has('0,2'), true);
  // P2 body
  assert.equal(obstacles.has('7,7'), true);
  assert.equal(obstacles.has('7,6'), true);
  // Empty cell
  assert.equal(obstacles.has('5,5'), false);
});

test('findBfsPath: finds shortest path to target and respects 180 reverse restrictions', () => {
  const state = createMockGameState();
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Target 3 cells right: (5, 2)
  const pathRight = findBfsPath(vHead, { x: 5, y: 2 }, state, 8);
  assert.deepEqual(pathRight, ['RIGHT', 'RIGHT', 'RIGHT']);

  // Target 3 right and 3 down from (2, 2): (5, 5)
  // Virtual head at (5, 2) facing RIGHT, clicked (5, 5)
  const vHeadAfterRight = { pos: { x: 5, y: 2 }, dir: 'RIGHT' as const };
  const pathDown = findBfsPath(vHeadAfterRight, { x: 5, y: 5 }, state, 8);
  assert.deepEqual(pathDown, ['DOWN', 'DOWN', 'DOWN']);

  // Total chained moves = 3 + 3 = 6 moves
  assert.equal((pathRight?.length ?? 0) + (pathDown?.length ?? 0), 6);
});

test('findBfsPath: cannot 180-reverse on initial step from virtual head', () => {
  const state = createMockGameState({
    snakes: [createMockSnake({ body: [{ x: 2, y: 2 }], direction: 'RIGHT' })],
  });
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Target (1, 2) is directly behind the virtual head
  const path = findBfsPath(vHead, { x: 1, y: 2 }, state, 8);
  assert.ok(path !== null);
  // First step cannot be LEFT!
  assert.notEqual(path[0], 'LEFT');
});

test('findBfsPath: returns null when target is blocked by obstacles or out of bounds', () => {
  const state = createMockGameState({
    walls: [{ x: 3, y: 2 }],
  });
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Target is a wall directly in front
  const pathWall = findBfsPath(vHead, { x: 3, y: 2 }, state, 8);
  assert.equal(pathWall, null);

  // Target is out of bounds
  const pathOob = findBfsPath(vHead, { x: -1, y: 2 }, state, 8);
  assert.equal(pathOob, null);

  // Target is already virtual head
  const pathSame = findBfsPath(vHead, { x: 2, y: 2 }, state, 8);
  assert.equal(pathSame, null);

  // Boxed in target
  const boxedState = createMockGameState({
    walls: [
      { x: 4, y: 4 }, // target at (5, 4)
      { x: 6, y: 4 },
      { x: 5, y: 3 },
      { x: 5, y: 5 },
    ],
  });
  const pathBoxed = findBfsPath(vHead, { x: 5, y: 4 }, boxedState, 8);
  assert.equal(pathBoxed, null);
});

test('getObstacleSet: excludes ignoredCell if specified', () => {
  const state = createMockGameState();
  const withoutIgnored = getObstacleSet(state);
  assert.equal(withoutIgnored.has('2,2'), true);

  const withIgnored = getObstacleSet(state, { x: 2, y: 2 });
  assert.equal(withIgnored.has('2,2'), false);
  // Other segments remain
  assert.equal(withIgnored.has('1,2'), true);
});

test('findBfsPath: loops back to vacated starting head when ignoredCell is passed', () => {
  const state = createMockGameState();
  // Virtual head has moved around to (2, 3) facing LEFT
  const vHead = { pos: { x: 2, y: 3 }, dir: 'LEFT' as const };
  const targetActualHead = { x: 2, y: 2 };

  // Without ignoring starting head, (2,2) is an obstacle -> null
  const blockedPath = findBfsPath(vHead, targetActualHead, state, 8);
  assert.equal(blockedPath, null);

  // With starting head ignored (vacated), BFS paths loop back
  const loopBackPath = findBfsPath(vHead, targetActualHead, state, 8, targetActualHead);
  assert.ok(loopBackPath !== null);
  assert.deepEqual(loopBackPath, ['UP']);
});

test('findFallbackBfsPath: finds path straight into obstacle when legal BFS fails', () => {
  const state = createMockGameState({
    walls: [{ x: 3, y: 2 }],
  });
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Legal BFS returns null because (3, 2) is a wall
  const legalPath = findBfsPath(vHead, { x: 3, y: 2 }, state, 8);
  assert.equal(legalPath, null);

  // Fallback BFS passes through obstacles and returns single step into wall
  const fallbackPath = findFallbackBfsPath(vHead, { x: 3, y: 2 }, state, 8);
  assert.ok(fallbackPath !== null);
  assert.deepEqual(fallbackPath, ['RIGHT']);
});

test('findFallbackBfsPath: allows trapped snake to queue death path into surrounding obstacle', () => {
  const boxedState = createMockGameState({
    walls: [
      { x: 3, y: 2 }, // right
      { x: 2, y: 1 }, // up
      { x: 2, y: 3 }, // down
      { x: 1, y: 2 }, // left
    ],
  });
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Legal BFS fails for every neighbor
  assert.equal(findBfsPath(vHead, { x: 3, y: 2 }, boxedState, 8), null);
  assert.equal(findBfsPath(vHead, { x: 2, y: 1 }, boxedState, 8), null);
  assert.equal(findBfsPath(vHead, { x: 2, y: 3 }, boxedState, 8), null);

  // Fallback BFS succeeds for neighbors
  assert.deepEqual(findFallbackBfsPath(vHead, { x: 3, y: 2 }, boxedState, 8), ['RIGHT']);
  assert.deepEqual(findFallbackBfsPath(vHead, { x: 2, y: 1 }, boxedState, 8), ['UP']);
  assert.deepEqual(findFallbackBfsPath(vHead, { x: 2, y: 3 }, boxedState, 8), ['DOWN']);

  // Target directly behind virtual head (180 reverse) respects no-180 rule
  const behindPath = findFallbackBfsPath(vHead, { x: 1, y: 2 }, boxedState, 8);
  assert.ok(behindPath !== null);
  assert.notEqual(behindPath[0], 'LEFT');
});

test('findFallbackBfsPath: enforces arena bounds and rejects out of bounds or virtual head', () => {
  const state = createMockGameState();
  const vHead = { pos: { x: 2, y: 2 }, dir: 'RIGHT' as const };

  // Out of bounds returns null
  assert.equal(findFallbackBfsPath(vHead, { x: -1, y: 2 }, state, 8), null);
  assert.equal(findFallbackBfsPath(vHead, { x: 8, y: 2 }, state, 8), null);

  // Target is virtual head returns null
  assert.equal(findFallbackBfsPath(vHead, { x: 2, y: 2 }, state, 8), null);
});

test('resolveDominantDirection: resolves clicked cell to single cardinal direction via dominant axis', () => {
  const from = { x: 3, y: 3 };

  // Pure cardinal directions (far and near)
  assert.equal(resolveDominantDirection(from, { x: 7, y: 3 }), 'RIGHT');
  assert.equal(resolveDominantDirection(from, { x: 4, y: 3 }), 'RIGHT');
  assert.equal(resolveDominantDirection(from, { x: 0, y: 3 }), 'LEFT');
  assert.equal(resolveDominantDirection(from, { x: 2, y: 3 }), 'LEFT');
  assert.equal(resolveDominantDirection(from, { x: 3, y: 0 }), 'UP');
  assert.equal(resolveDominantDirection(from, { x: 3, y: 2 }), 'UP');
  assert.equal(resolveDominantDirection(from, { x: 3, y: 7 }), 'DOWN');
  assert.equal(resolveDominantDirection(from, { x: 3, y: 4 }), 'DOWN');

  // Dominant X axis (|dx| > |dy|)
  assert.equal(resolveDominantDirection(from, { x: 6, y: 4 }), 'RIGHT'); // dx=3, dy=1
  assert.equal(resolveDominantDirection(from, { x: 6, y: 2 }), 'RIGHT'); // dx=3, dy=-1
  assert.equal(resolveDominantDirection(from, { x: 0, y: 4 }), 'LEFT');  // dx=-3, dy=1
  assert.equal(resolveDominantDirection(from, { x: 0, y: 2 }), 'LEFT');  // dx=-3, dy=-1

  // Dominant Y axis (|dy| > |dx|)
  assert.equal(resolveDominantDirection(from, { x: 4, y: 7 }), 'DOWN');  // dx=1, dy=4
  assert.equal(resolveDominantDirection(from, { x: 2, y: 7 }), 'DOWN');  // dx=-1, dy=4
  assert.equal(resolveDominantDirection(from, { x: 4, y: 0 }), 'UP');    // dx=1, dy=-3
  assert.equal(resolveDominantDirection(from, { x: 2, y: 0 }), 'UP');    // dx=-1, dy=-3
});
