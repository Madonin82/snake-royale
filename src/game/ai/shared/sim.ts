import { Direction, GameState, Position, Snake } from '../../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../../engine';

export const ALL_DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export const posKey = (p: Position): string => `${p.x},${p.y}`;

export function sameTeam(a: Snake | SimSnake, b: Snake | SimSnake): boolean {
  return Boolean(a.teamId && b.teamId && a.teamId === b.teamId);
}

/** Standard tiebreak: skill points, then length. Returns the winner, or null on a draw. */
export function tiebreakWinner(a: Snake | SimSnake, b: Snake | SimSnake): (Snake | SimSnake) | null {
  const aPts = a.skillPoints ?? 0;
  const bPts = b.skillPoints ?? 0;
  if (aPts !== bPts) return aPts > bPts ? a : b;
  if (a.body.length !== b.body.length) return a.body.length > b.body.length ? a : b;
  return null;
}

/** True if `me` would win a mutual-kill tiebreak against `opponent` outright. */
export function winsTiebreak(me: Snake | SimSnake, opponent: Snake | SimSnake): boolean {
  return tiebreakWinner(me, opponent) === me;
}

/**
 * Snipe lethality: strictly ahead on BOTH skill points and length. Same bar
 * as a player-vs-player snipe — no boss exceptions.
 */
export function snipeIsLethal(me: Snake | SimSnake, opponent: Snake | SimSnake): boolean {
  const myPts = me.skillPoints ?? 0;
  const oppPts = opponent.skillPoints ?? 0;
  return myPts > oppPts && me.body.length > opponent.body.length;
}

/**
 * Conservative growth check: if any token sits on a cell the opponent's head
 * can reach next tick, assume they might eat — in which case their tail does
 * NOT vacate.
 */
export function opponentMayGrow(opponent: Snake | SimSnake, tokens: Position[]): boolean {
  const head = opponent.body[0];
  return ALL_DIRECTIONS.some(dir => {
    if (isOppositeDirection(opponent.direction, dir)) return false;
    const c = getNextHeadPosition(head, dir);
    return tokens.some(t => t.x === c.x && t.y === c.y);
  });
}

/**
 * Cells of an opponent's body that are lethal to enter for an ORDINARY move.
 * The tail is only safe if it vacates — i.e. the opponent isn't about to grow.
 */
export function getOpponentBodyThreat(opponent: Snake | SimSnake, tokens: Position[]): Set<string> {
  const threat = new Set<string>();
  const body = opponent.isAlive && !opponentMayGrow(opponent, tokens)
    ? opponent.body.slice(0, -1)
    : opponent.body;
  for (const seg of body) threat.add(posKey(seg));
  return threat;
}

export function getOpponentThreatCells(
  gameState: GameState,
  botRole: string,
  gridSize: number,
  me: Snake | SimSnake,
): { threat: Set<string>; snipeTargets: Set<string> } {
  const threat = new Set<string>();
  const snipeTargets = new Set<string>();
  for (const snake of gameState.snakes) {
    if (snake.id === botRole || sameTeam(me, snake)) continue;
    for (const key of getOpponentBodyThreat(snake, gameState.tokens)) {
      threat.add(key);
    }
    if (snake.isAlive) {
      const head = snake.body[0];
      const lethal = snipeIsLethal(me, snake);
      for (const d of ALL_DIRECTIONS) {
        if (isOppositeDirection(snake.direction, d)) continue;
        const next = getNextHeadPosition(head, d);
        if (!isCellInArena(next, gridSize, gameState.ringInset)) continue;
        if (lethal) {
          snipeTargets.add(posKey(next));
        } else {
          threat.add(posKey(next));
        }
      }
    }
  }
  return { threat, snipeTargets };
}

export interface SimSnake {
  id: string;
  body: Position[];
  direction: Direction;
  tokensSinceLock: number;
  skillPoints: number;
  isAlive: boolean;
  teamId?: string;
}

export interface SimState {
  snakes: SimSnake[];
  tokens: Position[];
}

export interface AdvanceOutcome {
  sim: SimState;
  botAteSP: number | null;
  botAteCell: Position | null;
  opponentBodies: Record<string, Position[]>;
  botHeadOn: 'WIN' | 'LOSS' | null;
}

export function simToGameState(base: GameState, sim: SimState): GameState {
  const byId = new Map(sim.snakes.map(s => [s.id, s]));
  return {
    ...base,
    tokens: sim.tokens.map(t => ({ ...t })),
    snakes: base.snakes.map(s => {
      const simSnake = byId.get(s.id);
      if (!simSnake) return s;
      return {
        ...s,
        body: simSnake.body.map(c => ({ ...c })),
        direction: simSnake.direction,
        tokensSinceLock: simSnake.tokensSinceLock,
        isAlive: simSnake.isAlive,
      };
    }),
  };
}

export function initialSim(gameState: GameState): SimState {
  return {
    tokens: gameState.tokens.map(t => ({ ...t })),
    snakes: gameState.snakes.map(s => ({
      id: s.id,
      body: s.body.map(c => ({ ...c })),
      direction: s.direction,
      tokensSinceLock: s.tokensSinceLock ?? 0,
      skillPoints: s.skillPoints ?? 0,
      isAlive: s.isAlive,
      teamId: s.teamId,
    })),
  };
}
