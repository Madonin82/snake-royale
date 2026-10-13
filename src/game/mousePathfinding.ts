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
 */
export function getObstacleSet(gameState: GameState): Set<string> {
  const obstacles = new Set<string>();

  for (const w of gameState.walls ?? []) {
    obstacles.add(`${w.x},${w.y}`);
  }
  for (const rw of gameState.rattleWalls ?? []) {
    obstacles.add(`${rw.x},${rw.y}`);
  }
  for (const s of gameState.snakes) {
    for (const b of s.body) {
      obstacles.add(`${b.x},${b.y}`);
    }
  }

  return obstacles;
}

/**
 * BFS shortest path from virtual head to target cell.
 * Returns Direction[] on success, or null if unreachable or invalid.
 */
export function findBfsPath(
  virtualHead: { pos: Position; dir: Direction },
  target: Position,
  gameState: GameState,
  gridSize: number,
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

  // 3. Target cannot be an obstacle
  const obstacles = getObstacleSet(gameState);
  if (obstacles.has(`${target.x},${target.y}`)) {
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

      // Obstacle check
      if (obstacles.has(`${nextPos.x},${nextPos.y}`)) continue;

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
