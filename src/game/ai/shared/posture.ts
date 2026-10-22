import { GameState, Position, Snake, BufferEntry } from '../../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../../engine';
import { posKey, sameTeam, SimState, simToGameState } from './sim';
import { ALL_DIRECTIONS } from './sim';
import { floodFillArea } from './rating';

export interface PostureInfo {
  posture: 'PROTECT' | 'CHASE' | null;
  clearWin: boolean;
}

export function computePosture(gameState: GameState, me: Snake, raceTurns: number): PostureInfo {
  const opponents = gameState.snakes.filter(s => s.id !== me.id && s.isAlive && !sameTeam(me, s));
  if (opponents.length === 0) return { posture: null, clearWin: false };
  const bestScore = Math.max(...opponents.map(o => o.score));
  const bestLength = Math.max(...opponents.map(o => o.body.length));
  const turnsGone = raceTurns - gameState.phaseTurnsRemaining;
  const late =
    gameState.phase === 'SHRINKING' ||
    gameState.ringInset > 0 ||
    (gameState.phase === 'RACING' && turnsGone >= (raceTurns * 2) / 3);
  if (!late) return { posture: null, clearWin: false };
  const clearWin =
    opponents.every(o => (me.skillPoints ?? 0) > (o.skillPoints ?? 0)) && me.body.length > bestLength;
  if (me.score > bestScore && me.body.length >= bestLength) {
    return { posture: 'PROTECT', clearWin };
  }
  if (me.score < bestScore) return { posture: 'CHASE', clearWin };
  return { posture: null, clearWin };
}

export function computeLockCount(
  base: GameState,
  simAfterFirst: SimState,
  gridSize: number,
  botRole: string,
  plan: BufferEntry[],
): number {
  if (plan.length === 0) return 0;
  if (plan[0].type === 'dart') return plan.length;
  const view = simToGameState(base, simAfterFirst);
  const me = view.snakes.find(s => s.id === botRole);
  if (!me) return plan.length;
  const headAfter = me.body[0];
  const afterDir = me.direction;
  const occupied = new Set<string>();
  for (const s of view.snakes) {
    for (const seg of s.body) occupied.add(posKey(seg));
  }
  const escapes = ALL_DIRECTIONS.filter(d => !isOppositeDirection(afterDir, d)).filter(d => {
    const cell = getNextHeadPosition(headAfter, d);
    return isCellInArena(cell, gridSize, view.ringInset) && !occupied.has(posKey(cell));
  }).length;
  return escapes <= 1 ? 1 : plan.length;
}

export function findClusters(tokens: Position[]): Position[][] {
  const remaining = [...tokens];
  const clusters: Position[][] = [];
  while (remaining.length > 0) {
    const cluster = [remaining.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (cluster.some(c => Math.abs(c.x - remaining[i].x) + Math.abs(c.y - remaining[i].y) <= 3)) {
          cluster.push(remaining.splice(i, 1)[0]);
          grew = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export function clusterChainValue(size: number, startTsl: number): number {
  let total = 0;
  for (let i = 1; i <= size; i++) total += startTsl + i;
  return total;
}
