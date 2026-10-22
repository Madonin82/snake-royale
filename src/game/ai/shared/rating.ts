import { Direction, GameState, Position } from '../../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../../engine';
import { BrainProfile } from '../types';
import { ALL_DIRECTIONS, getOpponentBodyThreat, posKey, sameTeam, winsTiebreak } from './sim';

export interface RatedAIMoves {
  ratedMoves: { dir: Direction; score: number }[];
  validDirs: Direction[];
  me: any;
}

export function floodFillArea(pos: Position, state: GameState, gridSize: number, me: any, insetOverride?: number): number {
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
        if (isCellInArena(next, gridSize, insetOverride ?? state.ringInset) && !blocked.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
  }

  return count;
}

/**
 * Change 8 (Changes 6–9 spec): for profiles with ringTelegraphAsWalls, the
 * incoming band is already dead ground — spatial queries use the
 * telegraphed inset. Every other profile gets the physical inset, so
 * their math is unchanged.
 */
export function effectiveRingInset(state: GameState, profile?: BrainProfile): number {
  if (profile?.ringTelegraphAsWalls && state.isTelegraphingShrink) {
    return Math.max(state.ringInset, state.telegraphRingInset ?? state.ringInset);
  }
  return state.ringInset;
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
  // Change 8: candidate legality and flood math use the effective inset
  // (the telegraphed band counts as outside for guard-ring profiles).
  const effInset = effectiveRingInset(gameState, profile);

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    let score = 0;

    if (!isCellInArena(nextPos, gridSize, effInset)) {
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

    const area = floodFillArea(nextPos, gameState, gridSize, me, effInset);
    if (area < me.body.length) {
      continue;
    }

    // Change 6 (Changes 6–9 spec): coffin margin. The veto above is a
    // cliff — a candidate passing at exactly length+0 is charged nothing.
    // Profiles carrying coffinPenaltyMax pay a soft charge that grows
    // quadratically as the margin (area − length) shrinks toward zero
    // inside coffinMarginBand. The beam accumulates this per ply, so a
    // route that dips into a thin pocket and one that ends there are both
    // charged; there is no separate route-end term (the final ply already
    // pays as a candidate step, so an end term would double-charge it).
    const coffinMax = profile.coffinPenaltyMax ?? 0;
    if (coffinMax > 0) {
      const band = profile.coffinMarginBand ?? 0;
      const margin = area - me.body.length;
      if (band > 0 && margin < band) {
        const frac = (band - margin) / band;
        score -= coffinMax * frac * frac;
      }
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
          // Change 9 §7.2 (Changes 6–9 spec): guard profiles REPLACE the
          // losing-reach magnitude with executionGuardLoss — the two are
          // never stacked. Absent field → today's value, unchanged.
          headOnPenalty = Math.max(headOnPenalty, iWinTrade ? 10 : Math.abs(profile.executionGuardLoss ?? profile.inSimHeadOnLoss));
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

export interface FallbackClearInfo {
  /** First tick (0 = now) at which the reachable area fits the body, or null if it never clears within the horizon. */
  clearTick: number | null;
  /** Reachable area at the clearing tick (or at the horizon if it never clears). */
  areaAtClear: number;
  /** Reachable area right now. */
  areaNow: number;
}

function horizonView(state: GameState, gridSize: number, t: number): GameState {
  const snakes = (state.snakes ?? []).map(s => ({
    ...s,
    body: t === 0 ? s.body : s.body.slice(0, Math.max(1, s.body.length - t)),
  }));
  let ringInset = state.ringInset;
  const maxInset = Math.floor(gridSize / 2) - 1;
  if (
    state.phase === 'SHRINKING' &&
    state.ringInset < maxInset &&
    t >= Math.max(1, state.phaseTurnsRemaining ?? Number.POSITIVE_INFINITY)
  ) {
    ringInset = state.ringInset + 1;
  }
  return { ...state, snakes, ringInset };
}

/**
 * Change 7 (Changes 6–9 spec): horizon model behind the trapped fallback.
 * Bodies advance by the tail-vacation rule only — each tick every snake's
 * tail cell vacates; eats are not predicted, so no body grows and no tail
 * is retained for growth, and heads stay where they are. The ring uses
 * the landed inset for ticks on/after a pending shrink's landing tick.
 * Returns the first tick at which the flood from `startPos` reaches the
 * snake's current body length.
 */
export function fallbackClearInfo(
  startPos: Position,
  state: GameState,
  gridSize: number,
  me: any,
  horizon: number,
): FallbackClearInfo {
  const need = me.body.length;
  let areaNow = 0;
  let lastArea = 0;
  for (let t = 0; t <= horizon; t++) {
    const view = horizonView(state, gridSize, t);
    const viewMe = view.snakes.find(s => s.id === me.id) ?? me;
    const area = floodFillArea(startPos, view, gridSize, viewMe, view.ringInset);
    if (t === 0) areaNow = area;
    lastArea = area;
    if (area >= need) {
      return { clearTick: t, areaAtClear: area, areaNow };
    }
  }
  return { clearTick: null, areaAtClear: lastArea, areaNow };
}

/**
 * Change 9 §7.3 (Changes 6–9 spec): execution-time reachability guard.
 * True when the bot's imminent step lands on a cell an opponent can also
 * reach in one step and the head-on would not go the bot's way (a second
 * reacher also counts — a multi-way head-on is never clean). A one-ply
 * fact about the CURRENT board: no simulation, no projections. Inert
 * (always false) unless the profile carries executionGuardLoss.
 */
export function imminentStepLosingReachable(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  nextDir: Direction,
  profile?: BrainProfile,
): boolean {
  if (!profile?.executionGuardLoss) return false;
  const me = gameState.snakes?.find(s => s.id === botRole);
  if (!me || !me.isAlive) return false;
  const dest = getNextHeadPosition(me.body[0], nextDir);
  if (!isCellInArena(dest, gridSize, gameState.ringInset)) return false;
  let reachers = 0;
  let losesToReacher = false;
  for (const opponent of gameState.snakes ?? []) {
    if (opponent.id === botRole || !opponent.isAlive || sameTeam(me, opponent)) continue;
    const oppHead = opponent.body[0];
    const canReach = ALL_DIRECTIONS
      .filter(d => !isOppositeDirection(opponent.direction, d))
      .some(d => {
        const c = getNextHeadPosition(oppHead, d);
        return c.x === dest.x && c.y === dest.y;
      });
    if (canReach) {
      reachers++;
      if (!winsTiebreak(me, opponent)) losesToReacher = true;
    }
  }
  return reachers > 1 || (reachers === 1 && losesToReacher);
}
