import { Direction, GameState, PendingSkill, Position } from '../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from './engine';
import { canActivateSkill } from './skills';

const ALL_DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export interface AIActionResult {
  direction: Direction | null;
  skill?: PendingSkill | null;
}

export function calculateAIAction(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  skillsAvailable?: GameState['skillsAvailable'],
): AIActionResult {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return { direction: null, skill: null };

  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    return calculateAvalenaAction(gameState, gridSize, botRole, skillsAvailable ?? gameState.skillsAvailable);
  }

  return {
    direction: calculateAIMove(gameState, gridSize, botRole, difficulty, aiStyle),
    skill: null,
  };
}

function calculateAvalenaAction(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  skillsAvailable?: GameState['skillsAvailable'],
): AIActionResult {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return { direction: null, skill: null };

  const player = gameState.snakes.find(snake => snake.id === 'p1') ??
    gameState.snakes.find(snake => snake.id !== botRole && snake.isAlive) ??
    gameState.snakes.find(snake => snake.id !== botRole);

  // Hunt trigger reads the skill wallet, not tokens: her design is farm → hunt →
  // farm, and the return trip only happens if darting drops her back under the
  // +3 threshold. (Tokens are immutable, so a token-based trigger would hunt
  // forever once ahead.)
  const playerPoints = player?.skillPoints ?? 0;
  const inHuntPhase = Boolean(player && player.isAlive && (me.skillPoints ?? 0) >= playerPoints + 3);

  if (inHuntPhase && player) {
    const playerHead = player.body[0];
    const currentFacing = me.direction;
    const step1Pos = getNextHeadPosition(me.body[0], currentFacing);
    const validDartDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentFacing, d));

    // Check if in dart range and dart is unlocked & affordable
    if (canActivateSkill(me, gameState, skillsAvailable)) {
      let inRange = false;
      const dartCandidates: { dir: Direction; endDist: number; minDist: number; safe: boolean }[] = [];

      for (const dartDir of validDartDirs) {
        const step2Pos = getNextHeadPosition(step1Pos, dartDir);
        const step3Pos = getNextHeadPosition(step2Pos, dartDir);
        const d1 = Math.abs(step1Pos.x - playerHead.x) + Math.abs(step1Pos.y - playerHead.y);
        const d2 = Math.abs(step2Pos.x - playerHead.x) + Math.abs(step2Pos.y - playerHead.y);
        const d3 = Math.abs(step3Pos.x - playerHead.x) + Math.abs(step3Pos.y - playerHead.y);
        const minDist = Math.min(d1, d2, d3);
        const endDist = d3;

        // "In range" means the player's head is reachable within the dart's total 3-cell movement
        // in one of the three directions (or within 3 cells along the dart trajectory).
        if (minDist === 0 || (Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y) <= 3 && endDist < Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y))) {
          inRange = true;
        }

        const safe =
          isCellSafeForAvalena(step1Pos, me.body, gameState, gridSize, playerHead) &&
          isCellSafeForAvalena(step2Pos, [step1Pos, ...me.body.slice(0, -1)], gameState, gridSize, playerHead) &&
          isCellSafeForAvalena(step3Pos, [step2Pos, step1Pos, ...me.body.slice(0, -2)], gameState, gridSize, playerHead);

        dartCandidates.push({ dir: dartDir, endDist, minDist, safe });
      }

      if (inRange) {
        // Choose the direction (forward/left/right) that lands her head closest to the player's head position
        dartCandidates.sort((a, b) => {
          if (a.endDist !== b.endDist) return a.endDist - b.endDist;
          if (a.minDist !== b.minDist) return a.minDist - b.minDist;
          if (a.safe !== b.safe) return a.safe ? -1 : 1;
          return 0;
        });
        const bestDart = dartCandidates[0];
        if (bestDart) {
          return {
            direction: currentFacing,
            skill: {
              skillId: 'dart',
              direction: bestDart.dir,
            },
          };
        }
      }
    }

    // Not in dart range (or skill locked): path toward the player's head
    const huntDir = calculateHuntMoveTowardTarget(gameState, gridSize, botRole, playerHead);
    return { direction: huntDir, skill: null };
  }

  // Farm phase: greedy token seeking (use existing greedy logic)
  return {
    direction: calculateAIMove(gameState, gridSize, botRole, 'HARD', 'GREEDY'),
    skill: null,
  };
}

function isCellSafeForAvalena(
  pos: Position,
  ownBody: Position[],
  state: GameState,
  gridSize: number,
  targetHead: Position,
): boolean {
  if (!isCellInArena(pos, gridSize, state.ringInset)) return false;
  if (state.walls?.some(wall => wall.x === pos.x && wall.y === pos.y)) return false;
  if (ownBody.slice(0, -1).some(seg => seg.x === pos.x && seg.y === pos.y)) return false;
  // Allow targeting the player's head cell itself when hunting
  if (pos.x === targetHead.x && pos.y === targetHead.y) return true;
  for (const snake of state.snakes) {
    const bodyToCheck = snake.isAlive ? snake.body.slice(0, -1) : snake.body;
    if (bodyToCheck.some(seg => seg.x === pos.x && seg.y === pos.y)) return false;
  }
  return true;
}

function calculateHuntMoveTowardTarget(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  targetPos: Position,
): Direction | null {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return null;
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole);
  const head = me.body[0];
  const currentDir = me.direction;
  const validDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentDir, d));

  const ratedMoves: { dir: Direction; score: number }[] = [];

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) continue;
    if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) continue;
    if (me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y)) continue;
    const hitsOpponentBody = opponents.some(opponent =>
      (opponent.isAlive ? opponent.body.slice(1, -1) : opponent.body)
        .some(s => s.x === nextPos.x && s.y === nextPos.y),
    );
    if (hitsOpponentBody) continue;

    const dist = Math.abs(nextPos.x - targetPos.x) + Math.abs(nextPos.y - targetPos.y);
    let score = (gridSize * 2 - dist) * 20;
    const openNeighbors = countOpenNeighbors(nextPos, gameState, gridSize);
    score += openNeighbors * 3;
    if (dir === currentDir) score += 2;
    ratedMoves.push({ dir, score });
  }

  if (ratedMoves.length === 0) {
    return validDirs[0] || currentDir;
  }
  ratedMoves.sort((a, b) => b.score - a.score);
  return ratedMoves[0].dir;
}

export function calculateAIMove(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
): Direction | null {
  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    const action = calculateAvalenaAction(gameState, gridSize, botRole, gameState.skillsAvailable);
    if (action.skill) {
      const me = gameState.snakes.find(snake => snake.id === botRole);
      if (me) me.pendingSkill = action.skill;
    }
    return action.direction;
  }
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
