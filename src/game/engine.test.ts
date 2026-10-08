import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS, processGameTick } from './engine';
import { GameState, GameSettings, Position } from '../types/game';

function runDeathTick(
  configure: (state: GameState, settings: GameSettings) => void,
): Position | undefined {
  const state = createInitialState();
  const settings = { ...DEFAULT_SETTINGS };
  state.tokens = [];
  configure(state, settings);

  const result = processGameTick(state, settings, 0);
  const deadSnake = [result.nextState.snakes.p1, result.nextState.snakes.p2]
    .find(snake => !snake.isAlive);
  return deadSnake?.deathPosition;
}

test('records the attempted cell for wall deaths', () => {
  assert.deepEqual(runDeathTick((state) => {
    state.snakes.p1.body = [{ x: 7, y: 2 }, { x: 6, y: 2 }];
    state.snakes.p1.direction = 'RIGHT';
  }), { x: 8, y: 2 });
});

test('records the attempted cell for opponent-body deaths', () => {
  assert.deepEqual(runDeathTick((state) => {
    state.snakes.p1.body = [{ x: 2, y: 3 }, { x: 1, y: 3 }];
    state.snakes.p1.direction = 'RIGHT';
    state.snakes.p2.body = [{ x: 6, y: 5 }, { x: 3, y: 3 }, { x: 7, y: 5 }];
    state.snakes.p2.direction = 'LEFT';
  }), { x: 3, y: 3 });
});

test('records the attempted cell when the shrink ring closes onto a snake', () => {
  assert.deepEqual(runDeathTick((state) => {
    state.phase = 'SHRINKING';
    state.phaseTurnsRemaining = 1;
    state.snakes.p1.body = [{ x: 1, y: 3 }, { x: 2, y: 3 }];
    state.snakes.p1.direction = 'LEFT';
  }), { x: 0, y: 3 });
});
