import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from './engine';
import { cloneGameState, toCompactGameState } from './aiBridge';

test('compact state includes decision data, locks, and excludes presentation fields', () => {
  const state = createInitialState();
  state.tick = 7;
  state.snakes.p1.score = 3;
  state.tokens = [{ x: 2, y: 4 }];

  const compact = toCompactGameState(state, { p1: true, p2: false });

  assert.equal(compact.tick, 7);
  assert.equal(compact.snakes.p1.score, 3);
  assert.deepEqual(compact.tokens, [{ x: 2, y: 4 }]);
  assert.deepEqual(compact.locks, { p1: true, p2: false });
  assert.equal('name' in compact.snakes.p1, false);
  assert.equal('color' in compact.snakes.p1, false);
});

test('full state snapshots cannot mutate the live game state', () => {
  const state = createInitialState();
  const snapshot = cloneGameState(state);
  snapshot.snakes.p1.body[0].x += 1;
  snapshot.tokens.push({ x: 1, y: 1 });

  assert.notEqual(snapshot.snakes.p1.body[0].x, state.snakes.p1.body[0].x);
  assert.notEqual(snapshot.tokens.length, state.tokens.length);
});
