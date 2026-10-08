import { Direction, GameState, Position } from '../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from './engine';

const ALL_DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export function calculateAIMove(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM'
): Direction | null {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me) return null;
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole);
  const livingOpponents = opponents.filter(snake => snake.isAlive);

  if (!me.isAlive) return null;

  const head = me.body[0];
  const currentDir = me.direction;

  // Filter out immediate suicide moves (180 degree turns)
  const validDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentDir, d));

  // Rate each direction
  const ratedMoves: { dir: Direction; score: number }[] = [];

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    let score = 0;

    // 1. HARD RULE: Avoid Walls / Shrink Ring
    if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) {
      continue; // Instant death
    }
    if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) {
      continue;
    }

    // 2. HARD RULE: Avoid Own Body (except the tail if we don't eat)
    const hitsSelf = me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y);
    if (hitsSelf) {
      continue;
    }

    // 3. HARD RULE: Avoid Opponent Body
    const hitsOpponentBody = opponents.some(opponent =>
      (opponent.isAlive ? opponent.body.slice(0, -1) : opponent.body)
        .some(s => s.x === nextPos.x && s.y === nextPos.y),
    );
    if (hitsOpponentBody) {
      continue;
    }

    // 4. Opponent Head Proximity / Head-on hazard
    const nearestOpponent = livingOpponents.reduce((nearest, opponent) => {
      const distance = Math.abs(nextPos.x - opponent.body[0].x) + Math.abs(nextPos.y - opponent.body[0].y);
      return distance < nearest.distance ? { snake: opponent, distance } : nearest;
    }, { snake: null as (typeof opponents)[number] | null, distance: Infinity });
    if (nearestOpponent.distance <= 1 && nearestOpponent.snake) {
      // Possible head collision next tick
      if (difficulty === 'EASY') {
        score -= 5;
      } else if (difficulty === 'MEDIUM') {
        score -= 15;
      } else {
        score -= (me.score > nearestOpponent.snake.score ? 50 : 10);
      }
    }

    // 5. Token Seeking (Manhattan Distance to nearest token)
    if (gameState.tokens.length > 0) {
      let minTokenDist = Infinity;
      for (const token of gameState.tokens) {
        const d = Math.abs(nextPos.x - token.x) + Math.abs(nextPos.y - token.y);
        if (d < minTokenDist) {
          minTokenDist = d;
        }
      }
      // Closer is better
      score += (gridSize * 2 - minTokenDist) * 10;
    } else {
      // In shrink phase with no tokens, seek center of arena
      const center = (gridSize - 1) / 2;
      const distToCenter = Math.abs(nextPos.x - center) + Math.abs(nextPos.y - center);
      score += (gridSize - distToCenter) * 8;
    }

    // 6. Lookahead flood-fill / open space heuristic (for Medium and Hard)
    if (difficulty !== 'EASY') {
      const openNeighbors = countOpenNeighbors(nextPos, gameState, gridSize);
      score += openNeighbors * 5;
    }

    // Small inertia preference (avoid erratic zigzagging if scores are tied)
    if (dir === currentDir) {
      score += 2;
    }

    ratedMoves.push({ dir, score });
  }

  if (ratedMoves.length === 0) {
    // Trapped: fallback to any valid non-180 direction even if fatal
    return validDirs[0] || currentDir;
  }

  // Sort descending by score
  ratedMoves.sort((a, b) => b.score - a.score);

  // For Easy AI, introduce occasional randomness (sparring partner)
  if (difficulty === 'EASY' && Math.random() < 0.25 && ratedMoves.length > 1) {
    return ratedMoves[1].dir;
  }

  return ratedMoves[0].dir;
}

function countOpenNeighbors(pos: Position, state: GameState, gridSize: number): number {
  let count = 0;
  for (const d of ALL_DIRECTIONS) {
    const p = getNextHeadPosition(pos, d);
    if (!isCellInArena(p, gridSize, state.ringInset)) continue;
    if (state.walls?.some(wall => wall.x === p.x && wall.y === p.y)) continue;
    if (state.snakes.some(snake => snake.body.some(segment => segment.x === p.x && segment.y === p.y))) continue;
    count++;
  }
  return count;
}
