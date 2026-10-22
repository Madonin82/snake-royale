import { Direction, GameState, Position } from '../../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../../engine';
import { BrainProfile } from '../types';
import { ALL_DIRECTIONS, getOpponentBodyThreat, posKey, sameTeam, winsTiebreak } from './sim';

export interface RatedAIMoves {
  ratedMoves: { dir: Direction; score: number }[];
  validDirs: Direction[];
  me: any;
}

export function floodFillArea(pos: Position, state: GameState, gridSize: number, me: any): number {
  const visited = new Set<string>();
  const queue: Position[] = [pos];
  visited.add(posKey(pos));

  const eatsToken = state.tokens?.some(t => t.x === pos.x && t.y === pos.y) ?? false;
  const ownBody = eatsToken ? me.body : me.body.slice(0, -1);

  const blocked = new Set<string>();
  for (const seg of ownBody) {
    blocked.add(posKey(seg));
  }

  for (const snake of (state.snakes ?? [])) {
    if (snake.id === me.id) continue;
    for (const key of getOpponentBodyThreat(snake, state.tokens ?? [])) {
      blocked.add(key);
    }
  }

  if (state.walls) {
    for (const wall of state.walls) {
      blocked.add(posKey(wall));
    }
  }

  let count = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    count++;

    for (const d of ALL_DIRECTIONS) {
      const next = getNextHeadPosition(curr, d);
      const key = posKey(next);
      if (!visited.has(key)) {
        if (isCellInArena(next, gridSize, state.ringInset) && !blocked.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
  }

  return count;
}

export function rateAIMoves(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  difficulty: 'EASY' | 'MEDIUM' | 'HARD',
  profile: BrainProfile,
): RatedAIMoves | null {
  const me = gameState.snakes?.find(snake => snake.id === botRole);
  if (!me) return null;
  const opponents = (gameState.snakes ?? []).filter(snake => snake.id !== botRole && !sameTeam(me, snake));
  const teammates = gameState.teamProtection ? (gameState.snakes ?? []).filter(snake => snake.id !== botRole && sameTeam(me, snake)) : [];
  const livingOpponents = opponents.filter(snake => snake.isAlive);

  if (!me.isAlive) return null;

  const head = me.body[0];
  const currentDir = me.direction;

  const validDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentDir, d));
  const ratedMoves: { dir: Direction; score: number }[] = [];

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    let score = 0;

    if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) {
      continue;
    }
    if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) {
      continue;
    }

    const hitsSelf = me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y);
    if (hitsSelf) {
      continue;
    }

    const hitsOpponentBody = opponents.some(opponent =>
      getOpponentBodyThreat(opponent, gameState.tokens ?? []).has(posKey(nextPos)),
    );
    if (hitsOpponentBody) {
      continue;
    }

    const hitsTeammateBody = teammates.some(teammate =>
      getOpponentBodyThreat(teammate, gameState.tokens ?? []).has(posKey(nextPos)),
    );
    if (hitsTeammateBody) {
      continue;
    }

    const area = floodFillArea(nextPos, gameState, gridSize, me);
    if (area < me.body.length) {
      continue;
    }

    let headOnPenalty = 0;
    let twoTickPenalty = 0;
    for (const opponent of livingOpponents) {
      const oppHead = opponent.body[0];
      const inReach = ALL_DIRECTIONS
        .filter(d => !isOppositeDirection(opponent.direction, d))
        .some(d => {
          const c = getNextHeadPosition(oppHead, d);
          return c.x === nextPos.x && c.y === nextPos.y;
        });
      const iWinTrade = winsTiebreak(me, opponent);
      if (inReach) {
        if (difficulty === 'EASY') {
          headOnPenalty = Math.max(headOnPenalty, 5);
        } else if (difficulty === 'MEDIUM') {
          headOnPenalty = Math.max(headOnPenalty, 15);
        } else {
          headOnPenalty = Math.max(headOnPenalty, iWinTrade ? 10 : Math.abs(profile.inSimHeadOnLoss));
        }
      } else {
        const manDist = Math.abs(nextPos.x - oppHead.x) + Math.abs(nextPos.y - oppHead.y);
        if (manDist <= 2) {
          let baseNudge = 0;
          if (difficulty === 'MEDIUM') baseNudge = profile.threatNudge.MEDIUM;
          else if (difficulty === 'HARD') baseNudge = profile.threatNudge.HARD;
          if (iWinTrade) baseNudge = Math.floor(baseNudge / 2);
          twoTickPenalty = Math.max(twoTickPenalty, baseNudge);
        }
      }
    }
    score -= (headOnPenalty + twoTickPenalty);

    let proximityPenalty = 0;
    if ((gameState.snakes ?? []).length > 2) {
      for (const opponent of livingOpponents) {
        const oppHead = opponent.body[0];
        const distToOppHead = Math.abs(nextPos.x - oppHead.x) + Math.abs(nextPos.y - oppHead.y);
        if (distToOppHead === 1) {
          proximityPenalty += 600;
        } else if (distToOppHead === 2) {
          proximityPenalty += 180;
        } else if (distToOppHead === 3) {
          proximityPenalty += 40;
        }
      }
    }
    score -= proximityPenalty;

    if (gameState.tokens && gameState.tokens.length > 0) {
      const tsl = me.tokensSinceLock ?? 0;
      const chainCapVal = profile.chainCap[difficulty];
      const chainMult = difficulty === 'EASY' ? 1
        : difficulty === 'MEDIUM' ? Math.min(tsl + 1, chainCapVal)
        : Math.min(tsl + 1, chainCapVal);
      let bestTokenScore = 0;
      for (const token of gameState.tokens) {
        const d = Math.abs(nextPos.x - token.x) + Math.abs(nextPos.y - token.y);
        const contested = livingOpponents.some(opponent => {
          const oppDist = Math.abs(opponent.body[0].x - token.x) + Math.abs(opponent.body[0].y - token.y);
          return oppDist <= d;
        });
        const tokenScore = (gridSize * 2 - d) * 10 * (contested ? 0.15 : 1) * chainMult;
        if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
      }
      score += bestTokenScore;
    } else {
      const center = (gridSize - 1) / 2;
      const distToCenter = Math.abs(nextPos.x - center) + Math.abs(nextPos.y - center);
      score += (gridSize - distToCenter) * 8;
    }

    if (difficulty !== 'EASY') {
      score += area * 1;
    }

    if (dir === currentDir) {
      score += 2;
    }

    ratedMoves.push({ dir, score });
  }
  return { ratedMoves, validDirs, me };
}
