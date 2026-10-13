import { BufferEntry, Direction, GameState, Position, Snake } from '../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from './engine';

const CARDINAL_DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

/**
 * Computes the virtual head position and facing direction after applying
 * all currently queued buffer entries.
 * - 'move': advances 1 cell in entry.direction
 * - 'dart': advances 3 cells in entry.direction
 * - 'rattle': 0 cells advanced, sets facing direction
 */
export function computeVirtualHead(
  snake: Snake,
  buffer: (Direction | BufferEntry)[],
): { pos: Position; dir: Direction } {
  let vPos = { ...snake.body[0] };
  let vDir = snake.direction;

  for (const entry of buffer) {
    if (typeof entry === 'string') {
      vPos = getNextHeadPosition(vPos, entry as Direction);
      vDir = entry as Direction;
    } else if (entry.type === 'move') {
      vPos = getNextHeadPosition(vPos, entry.direction);
      vDir = entry.direction;
    } else if (entry.type === 'dart') {
      for (let s = 0; s < 3; s++) {
        vPos = getNextHeadPosition(vPos, entry.direction);
      }
      vDir = entry.direction;
    } else if (entry.type === 'rattle') {
      vDir = entry.direction;
    }
  }

  return { pos: vPos, dir: vDir };
}

/**
 * Builds a static snapshot set of all obstacle coordinates (walls, rattle walls, and snake bodies).
 * An optional ignoredCell (such as the active snake's starting head when moves are already queued)
 * will be excluded from the obstacle set.
 */
export function getObstacleSet(
  gameState: GameState,
  ignoredCell?: Position | null,
): Set<string> {
  const obstacles = new Set<string>();

  for (const w of gameState.walls ?? []) {
    obstacles.add(`${w.x},${w.y}`);
  }
  for (const rw of gameState.rattleWalls ?? []) {
    obstacles.add(`${rw.x},${rw.y}`);
  }
  for (const s of gameState.snakes) {
    for (const b of s.body) {
      if (ignoredCell && b.x === ignoredCell.x && b.y === ignoredCell.y) {
        continue;
      }
      obstacles.add(`${b.x},${b.y}`);
    }
  }

  return obstacles;
}

/**
 * BFS shortest path from virtual head to target cell.
 * Returns Direction[] on success, or null if unreachable or invalid.
 * If ignoreObstacles is true, walls and bodies are passable (fallback death path).
 */
export function findBfsPath(
  virtualHead: { pos: Position; dir: Direction },
  target: Position,
  gameState: GameState,
  gridSize: number,
  ignoredCell?: Position | null,
  ignoreObstacles: boolean = false,
): Direction[] | null {
  const ringInset = gameState.ringInset ?? 0;

  // 1. Target must be inside arena bounds
  if (!isCellInArena(target, gridSize, ringInset)) {
    return null;
  }

  // 2. Target cannot be already at virtual head
  if (virtualHead.pos.x === target.x && virtualHead.pos.y === target.y) {
    return null;
  }

  // 3. Target cannot be an obstacle (skipped if ignoreObstacles is true)
  const obstacles = ignoreObstacles ? null : getObstacleSet(gameState, ignoredCell);
  if (obstacles && obstacles.has(`${target.x},${target.y}`)) {
    return null;
  }

  // 4. Standard BFS
  // Queue stores: current position, facing direction at this cell, and path taken so far
  const queue: { pos: Position; dir: Direction; path: Direction[] }[] = [
    { pos: virtualHead.pos, dir: virtualHead.dir, path: [] },
  ];
  const visited = new Set<string>();
  visited.add(`${virtualHead.pos.x},${virtualHead.pos.y}`);

  while (queue.length > 0) {
    const curr = queue.shift()!;

    for (const d of CARDINAL_DIRECTIONS) {
      // Cannot 180-reverse against current facing direction
      if (isOppositeDirection(curr.dir, d)) continue;

      const nextPos = getNextHeadPosition(curr.pos, d);

      // Arena bounds check
      if (!isCellInArena(nextPos, gridSize, ringInset)) continue;

      // Obstacle check (skipped if ignoreObstacles is true)
      if (obstacles && obstacles.has(`${nextPos.x},${nextPos.y}`)) continue;

      // Target reached!
      if (nextPos.x === target.x && nextPos.y === target.y) {
        return [...curr.path, d];
      }

      const key = `${nextPos.x},${nextPos.y}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ pos: nextPos, dir: d, path: [...curr.path, d] });
      }
    }
  }

  return null;
}

/**
 * Fallback "death path" BFS with an empty obstacle set (walls and bodies passable).
 * Retains arena-bounds check, no-180 rule, and target-not-on-virtual-head check.
 * Skips target-is-obstacle rejection.
 */
export function findFallbackBfsPath(
  virtualHead: { pos: Position; dir: Direction },
  target: Position,
  gameState: GameState,
  gridSize: number,
): Direction[] | null {
  return findBfsPath(virtualHead, target, gameState, gridSize, null, true);
}

/**
 * Resolves a target cell to a single cardinal direction relative to the virtual head
 * using dominant axis (|dx| vs |dy|).
 */
export function resolveDominantDirection(from: Position, to: Position): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy)
    ? (dx < 0 ? 'LEFT' : 'RIGHT')
    : (dy < 0 ? 'UP' : 'DOWN');
}
