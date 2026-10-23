import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS, processGameTick } from './engine';
import { normalizeGameState } from './normalize';
import { GameState } from '../types/game';

test('legacy stun-era state loads clean: fuse and stun fields stripped, snake plays normally', () => {
  const state = createInitialState();
  state.tokens = [];
  const p1 = state.snakes.find(s => s.id === 'p1')!;
  p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
  p1.direction = 'RIGHT';
  const p2 = state.snakes.find(s => s.id === 'p2')!;
  p2.body = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  p2.direction = 'LEFT';

  // Stun-era baggage, as an old replay or wire state would carry it.
  const legacy = state as GameState & Record<string, unknown>;
  legacy.rattleWalls = [{ x: 4, y: 4, fuseTicks: 1 } as never];
  legacy.stunZones = [{ x: 4, y: 4 }];
  legacy.detonationAt = 12345;
  (p2 as unknown as Record<string, unknown>).stunTicks = 1;

  const clean = normalizeGameState(state);
  assert.deepEqual(clean.rattleWalls, [{ x: 4, y: 4 }]);
  assert.equal((clean as Record<string, unknown>).stunZones, undefined);
  assert.equal((clean as Record<string, unknown>).detonationAt, undefined);
  const cleanP2 = clean.snakes.find(s => s.id === 'p2')!;
  assert.equal('stunTicks' in cleanP2, false);

  // The snake the old data called stunned simply takes its turn.
  const { nextState } = processGameTick(clean, { ...DEFAULT_SETTINGS }, 0);
  const afterP2 = nextState.snakes.find(s => s.id === 'p2')!;
  assert.equal(afterP2.isAlive, true);
  assert.deepEqual(afterP2.body[0], { x: 4, y: 5 });
});
