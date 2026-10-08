import type { GameState, Position, Snake } from '../types/game';
import { withLegacySnakeAccessors } from './snakeArray';

/**
 * RTDB does not round-trip arrays faithfully:
 *  - an empty array is stored as nothing (the key disappears),
 *  - a sparse array can come back as an object with numeric-string keys.
 *
 * Game states arrive from the wire (RTDB snapshot or WebRTC channel), so
 * every array field must be coerced back into a real array before the
 * state reaches the engine or the renderer. The canonical failure this
 * prevents: tokens legitimately reach [] in Phase 2, the key vanishes,
 * and the board render dies on `for (const token of undefined)`,
 * unmounting the whole app on the receiving client.
 */
function asPositionArray(value: unknown): Position[] {
  if (Array.isArray(value)) return value as Position[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, Position>;
    return Object.keys(record)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map(k => record[k]);
  }
  return [];
}

function asSnakeArray(value: unknown): Snake[] {
  if (Array.isArray(value)) return value as Snake[];
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, Partial<Snake>>;
  const keys = Object.keys(record);
  const indexedKeys = keys.filter(key => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
  const orderedKeys = indexedKeys.length > 0 ? indexedKeys : keys;
  return orderedKeys.map((key, index) => {
    const snake = record[key];
    return {
      ...snake,
      id: snake.id || (indexedKeys.length > 0 ? `p${index + 1}` : key),
    } as Snake;
  });
}

/**
 * Return a copy of a wire-received game state with its array fields
 * guaranteed iterable. Safe to call on locally-built states too (arrays
 * pass through untouched).
 */
export function normalizeGameState(state: GameState): GameState {
  if (!state || typeof state !== 'object') return state;
  const snakes = asSnakeArray((state as GameState).snakes);
  return {
    ...state,
    tokens: asPositionArray((state as GameState).tokens),
    ...(state.walls === undefined ? {} : { walls: asPositionArray(state.walls) }),
    snakes: withLegacySnakeAccessors(snakes.map((snake, index) => ({
      ...snake,
      id: snake.id || `p${index + 1}`,
      body: asPositionArray(snake.body),
    }))),
  };
}
