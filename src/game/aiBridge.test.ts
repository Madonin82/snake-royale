import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from './engine';
import { cloneGameState, toCompactGameState } from './aiBridge';
import { shouldApplyRtdbBridgeCommand } from './aiBridgeRtdb';

test('compact state includes decision data, locks, and excludes presentation fields', () => {
  const state = createInitialState();
  state.tick = 7;
  state.snakes.find(snake => snake.id === 'p1')!.score = 3;
  state.tokens = [{ x: 2, y: 4 }];

  const compact = toCompactGameState(state, { p1: true, p2: false });

  assert.equal(compact.tick, 7);
  assert.equal(compact.gridSize, 8);
  assert.deepEqual(compact.walls, []);
  assert.equal(compact.snakes.p1.score, 3);
  assert.deepEqual(compact.tokens, [{ x: 2, y: 4 }]);
  assert.deepEqual(compact.locks, { p1: true, p2: false });
  assert.equal('name' in compact.snakes.p1, false);
  assert.equal('color' in compact.snakes.p1, false);
});

test('bridge state exposes custom level walls and gridSize in both full and compact modes', () => {
  const state = createInitialState({
    ...createInitialState(),
    gridSize: 12,
  } as any);
  state.gridSize = 12;
  state.walls = [{ x: 3, y: 3 }, { x: 4, y: 4 }];

  const full = cloneGameState(state);
  const compact = toCompactGameState(state, { p1: false, p2: false });

  assert.equal(full.gridSize, 12);
  assert.deepEqual(full.walls, [{ x: 3, y: 3 }, { x: 4, y: 4 }]);
  assert.equal(compact.gridSize, 12);
  assert.deepEqual(compact.walls, [{ x: 3, y: 3 }, { x: 4, y: 4 }]);

  // Mutating returned walls does not mutate live state
  full.walls![0].x = 99;
  compact.walls[0].y = 99;
  assert.deepEqual(state.walls, [{ x: 3, y: 3 }, { x: 4, y: 4 }]);
});

test('full state snapshots cannot mutate the live game state', () => {
  const state = createInitialState();
  const snapshot = cloneGameState(state);
  snapshot.snakes.find(snake => snake.id === 'p1')!.body[0].x += 1;
  snapshot.tokens.push({ x: 1, y: 1 });

  assert.notEqual(
    snapshot.snakes.find(snake => snake.id === 'p1')!.body[0].x,
    state.snakes.find(snake => snake.id === 'p1')!.body[0].x,
  );
  assert.notEqual(snapshot.tokens.length, state.tokens.length);
});

test('RTDB bridge commands apply only for the active match and a newer sequence', () => {
  const activeMatchId = 'match-current';
  const command = { seq: 2, moves: ['UP'], matchId: activeMatchId };

  assert.equal(shouldApplyRtdbBridgeCommand(command, activeMatchId, 1), true);
  assert.equal(shouldApplyRtdbBridgeCommand(command, activeMatchId, 2), false);
  assert.equal(shouldApplyRtdbBridgeCommand({ ...command, seq: 1 }, activeMatchId, 2), false);
  assert.equal(shouldApplyRtdbBridgeCommand(command, 'match-previous', 0), false);
});

test('RTDB bridge command validation rejects malformed commands', () => {
  const activeMatchId = 'match-current';

  assert.equal(shouldApplyRtdbBridgeCommand(null, activeMatchId, 0), false);
  assert.equal(shouldApplyRtdbBridgeCommand({ seq: 1.5, matchId: activeMatchId }, activeMatchId, 0), false);
  assert.equal(
    shouldApplyRtdbBridgeCommand({ seq: 1, moves: ['UP', 'INVALID'], matchId: activeMatchId }, activeMatchId, 0),
    false,
  );
  assert.equal(
    shouldApplyRtdbBridgeCommand({ seq: 1, lock: 'true', matchId: activeMatchId }, activeMatchId, 0),
    false,
  );
});
