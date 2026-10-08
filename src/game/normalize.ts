import type { GameState, Position } from '../types/game';

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

/**
 * Return a copy of a wire-received game state with its array fields
 * guaranteed iterable. Safe to call on locally-built states too (arrays
 * pass through untouched).
 */
export function normalizeGameState(state: GameState): GameState {
  if (!state || typeof state !== 'object') return state;
  const snakes = (state as GameState).snakes;
  return {
    ...state,
    tokens: asPositionArray((state as GameState).tokens),
    walls: asPositionArray((state as GameState).walls),
    snakes: {
      p1: { ...snakes?.p1, body: asPositionArray(snakes?.p1?.body) },
      p2: { ...snakes?.p2, body: asPositionArray(snakes?.p2?.body) },
    },
  };
}
