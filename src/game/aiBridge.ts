import { CompactGameState, GameState } from '../types/game';

export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    lastTurnTimes: state.lastTurnTimes ? { ...state.lastTurnTimes } : null,
    totalThinkTime: { ...state.totalThinkTime },
    tokens: state.tokens.map(token => ({ ...token })),
    walls: state.walls?.map(wall => ({ ...wall })),
    snakes: {
      p1: { ...state.snakes.p1, body: state.snakes.p1.body.map(position => ({ ...position })) },
      p2: { ...state.snakes.p2, body: state.snakes.p2.body.map(position => ({ ...position })) },
    },
    readyConfirmed: state.readyConfirmed ? { ...state.readyConfirmed } : undefined,
  };
}

export function toCompactGameState(
  state: GameState,
  locks: { p1: boolean; p2: boolean },
): CompactGameState {
  return {
    tick: state.tick,
    phase: state.phase,
    turnBased: state.turnBased,
    phaseTurnsRemaining: state.phaseTurnsRemaining,
    phaseTimeRemaining: state.phaseTimeRemaining,
    round: state.round,
    ringInset: state.ringInset,
    isTelegraphingShrink: state.isTelegraphingShrink,
    telegraphRingInset: state.telegraphRingInset,
    tokens: state.tokens.map(token => ({ ...token })),
    snakes: {
      p1: {
        body: state.snakes.p1.body.map(position => ({ ...position })),
        direction: state.snakes.p1.direction,
        score: state.snakes.p1.score,
        isAlive: state.snakes.p1.isAlive,
      },
      p2: {
        body: state.snakes.p2.body.map(position => ({ ...position })),
        direction: state.snakes.p2.direction,
        score: state.snakes.p2.score,
        isAlive: state.snakes.p2.isAlive,
      },
    },
    locks: { ...locks },
    winner: state.winner,
  };
}
