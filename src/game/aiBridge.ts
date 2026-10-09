import { CompactGameState, GameState } from '../types/game';

export function cloneGameState(state: GameState, gridSize?: number): GameState {
  return {
    ...state,
    gridSize: state.gridSize ?? gridSize ?? 8,
    lastTurnTimes: state.lastTurnTimes ? { ...state.lastTurnTimes } : null,
    totalThinkTime: { ...state.totalThinkTime },
    tokens: state.tokens.map(token => ({ ...token })),
    walls: (state.walls ?? []).map(wall => ({ ...wall })),
    snakes: state.snakes.map(snake => ({
      ...snake,
      body: snake.body.map(position => ({ ...position })),
    })),
    readyConfirmed: state.readyConfirmed ? { ...state.readyConfirmed } : undefined,
  };
}

export function toCompactGameState(
  state: GameState,
  locks: Record<string, boolean>,
  gridSize?: number,
): CompactGameState {
  return {
    tick: state.tick,
    gridSize: state.gridSize ?? gridSize ?? 8,
    phase: state.phase,
    turnBased: state.turnBased,
    phaseTurnsRemaining: state.phaseTurnsRemaining,
    phaseTimeRemaining: state.phaseTimeRemaining,
    round: state.round,
    ringInset: state.ringInset,
    isTelegraphingShrink: state.isTelegraphingShrink,
    telegraphRingInset: state.telegraphRingInset,
    tokens: state.tokens.map(token => ({ ...token })),
    walls: (state.walls ?? []).map(wall => ({ ...wall })),
    snakes: Object.fromEntries(state.snakes.map(snake => [snake.id, {
      body: snake.body.map(position => ({ ...position })),
      direction: snake.direction,
      score: snake.score,
      isAlive: snake.isAlive,
    }])),
    locks: { ...locks },
    winner: state.winner,
  };
}
