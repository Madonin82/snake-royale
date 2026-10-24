import type { BufferEntry, Direction, GameState, Position, RattleWall, Snake } from '../types/game';

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

function asRattleWallArray(value: unknown): RattleWall[] {
  // Older states carried a fuseTicks on each rattle wall (pre tail-drop
  // rework) — strip everything but the cell so legacy data loads clean.
  const toCell = (w: RattleWall): RattleWall => ({ x: w.x, y: w.y });
  if (Array.isArray(value)) return (value as RattleWall[]).map(toCell);
  if (value && typeof value === 'object') {
    const record = value as Record<string, RattleWall>;
    return Object.keys(record)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map(k => toCell(record[k]));
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
 * Replay normalization: a recorded PR #128 rattle step with no primes field
 * becomes { type: 'rattle', primes: 1 }. A recorded step with primes: 0 is
 * a plain move. Never default a missing field to 0 for a type: 'rattle' step.
 */
export function normalizeBufferEntry(entry: unknown): BufferEntry {
  if (typeof entry === 'string') {
    return { type: 'move', direction: entry as Direction };
  }
  if (!entry || typeof entry !== 'object') {
    return { type: 'move', direction: 'UP' };
  }
  const e = entry as { type?: unknown; direction?: unknown; primes?: unknown };
  const dir = (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(e.direction as string) ? e.direction : 'UP') as Direction;
  if (e.type === 'rattle') {
    if (e.primes === 0) {
      return { type: 'move', direction: dir };
    }
    return {
      type: 'rattle',
      direction: dir,
      primes: typeof e.primes === 'number' && Number.isSafeInteger(e.primes) ? e.primes : 1,
    };
  }
  if (e.type === 'dart') {
    return { type: 'dart', direction: dir };
  }
  return {
    type: 'move',
    direction: dir,
    ...(typeof e.primes === 'number' && e.primes > 0 ? { primes: e.primes } : {}),
  };
}

/**
 * Return a copy of a wire-received game state with its array fields
 * guaranteed iterable. Safe to call on locally-built states too (arrays
 * pass through untouched).
 */
export function normalizeGameState(state: GameState): GameState {
  if (!state || typeof state !== 'object') return state;
  const snakes = asSnakeArray((state as GameState).snakes);
  // Legacy stun-era fields (removed in the tail-drop rework) may ride in
  // on old saves/replays — drop them so nothing downstream sees them.
  const { stunZones: _stunZones, detonationAt: _detonationAt, ...rest } =
    state as GameState & { stunZones?: unknown; detonationAt?: unknown };
  return {
    ...rest,
    tokens: asPositionArray((state as GameState).tokens),
    ...(state.walls === undefined ? {} : { walls: asPositionArray(state.walls) }),
    ...(state.rattleWalls === undefined ? {} : { rattleWalls: asRattleWallArray(state.rattleWalls) }),
    snakes: snakes.map((snake, index) => {
      const { stunTicks: _stunTicks, ...cleanSnake } =
        snake as Snake & { stunTicks?: unknown };
      let pendingSkill = cleanSnake.pendingSkill;
      if (pendingSkill && pendingSkill.skillId === 'rattle') {
        if (pendingSkill.primes === 0) {
          pendingSkill = null;
        } else if (pendingSkill.primes === undefined) {
          pendingSkill = { ...pendingSkill, primes: 1 };
        }
      }
      return {
        ...cleanSnake,
        id: snake.id || `p${index + 1}`,
        body: asPositionArray(snake.body),
        pendingSkill,
      };
    }),
  };
}
