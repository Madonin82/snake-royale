import { GameState } from '../types/game';
import { TurnDecision } from './replayFile';

export interface PlayerMatchStats {
  score: number;
  tokensCollected: number;
  length: number;
  avgLockTime: string;
  fastestLock: string;
  slowestLock: string;
  autoLockCount: number;
  autoLockPct: string;
  avgQueueLen: string;
  causeOfDeath: string;
}

export interface MatchSummaryStats {
  totalTurns: number;
  durationFormatted: string;
  scores: Record<string, number[]>;
  playerStats: Record<string, PlayerMatchStats>;
  p1Scores: number[];
  p2Scores: number[];
  p1Stats: PlayerMatchStats;
  p2Stats: PlayerMatchStats;
}

export interface TurnLedgerEntry {
  tick: number;
  seat: string;
  playerName: string;
  arrows: string[];
  lockTimeMs: number;
  isAutoLock: boolean;
  tokensCollected: number;
  scoreDelta: number;
  terminalResult?: string;
}

export function computeTurnLedger(
  matchHistory: GameState[],
  decisions: TurnDecision[] = [],
): TurnLedgerEntry[] {
  const ledger: TurnLedgerEntry[] = [];
  const sortedDecisions = [...decisions].sort((a, b) => a.tick - b.tick);

  for (let i = 0; i < matchHistory.length; i++) {
    const currentState = matchHistory[i];
    const prevState = i > 0 ? matchHistory[i - 1] : null;
    const tick = currentState.tick;

    for (const snake of currentState.snakes ?? []) {
      const seat = snake.id;
      const decision = sortedDecisions.find(d => d.tick === tick && d.seat === seat);
      const prevSnake = prevState?.snakes?.find(candidate => candidate.id === seat);
      if (!snake) continue;

      const scoreDelta = prevSnake ? snake.score - prevSnake.score : snake.score;
      const tokensCollected = scoreDelta > 0 ? scoreDelta : 0;

      let terminalResult: string | undefined = undefined;
      if (!snake.isAlive && prevSnake && prevSnake.isAlive) {
        if (snake.deathReason === 'WALL') terminalResult = 'Wall crash';
        else if (snake.deathReason === 'SELF') terminalResult = 'Self crash';
        else if (snake.deathReason === 'OPPONENT' || snake.deathReason === 'HEAD_ON') terminalResult = 'Opponent collision';
        else if (snake.deathReason === 'SHRINK') terminalResult = 'Ring shrink';
        else terminalResult = 'Crash';
      } else if (currentState.phase === 'OVER' && currentState.winner === seat) {
        terminalResult = '★ Win';
      } else if (currentState.phase === 'OVER' && currentState.winner && currentState.winner !== 'DRAW' && currentState.winner !== seat) {
        terminalResult = 'Defeated';
      }

      let lockTimeMs = 0;
      if (decision && decision.lockedAt > 0 && decision.lockedAt < 600000) {
        lockTimeMs = Math.round(decision.lockedAt);
      } else if (currentState.lastTurnTimes && currentState.lastTurnTimes[seat] > 0) {
        lockTimeMs = Math.round(currentState.lastTurnTimes[seat] * 1000);
      }

      const arrows = decision ? decision.queue.map(d => d === 'UP' ? '↑' : d === 'DOWN' ? '↓' : d === 'LEFT' ? '←' : '→') : [];

      if (decision || arrows.length > 0 || scoreDelta !== 0 || terminalResult) {
        ledger.push({
          tick,
          seat,
          playerName: snake.name || (seat === 'p1' ? 'PLAYER 1' : 'PLAYER 2'),
          arrows,
          lockTimeMs,
          isAutoLock: decision ? decision.autoLock : false,
          tokensCollected,
          scoreDelta,
          terminalResult,
        });
      }
    }
  }

  return ledger.sort((a, b) => a.tick - b.tick);
}

export function computeMatchStats(
  matchHistory: GameState[],
  decisions: TurnDecision[] = [],
): MatchSummaryStats {
  const finalState = matchHistory[matchHistory.length - 1] || matchHistory[0] || {
    tick: 0,
    snakes: [],
    totalThinkTime: {},
    phase: 'OVER',
    winner: null,
  };

  const turnTimes: Record<string, number[]> = {};
  for (const st of matchHistory) {
    if (st.lastTurnTimes) {
      for (const [id, seconds] of Object.entries(st.lastTurnTimes)) {
        if (seconds > 0) (turnTimes[id] ??= []).push(seconds);
      }
    }
  }

  const getLockStats = (seat: string): PlayerMatchStats => {
    const times = turnTimes[seat] ?? [];
    const seatDecisions = decisions.filter(d => d.seat === seat);
    const autoLocks = seatDecisions.filter(d => d.autoLock).length;
    const totalDecisions = seatDecisions.length;
    const autoLockPct = totalDecisions > 0 ? Math.round((autoLocks / totalDecisions) * 100) : 0;

    const avgLock = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + 's' : '—';
    const fastLock = times.length > 0 ? Math.min(...times).toFixed(1) + 's' : '—';
    const slowLock = times.length > 0 ? Math.max(...times).toFixed(1) + 's' : '—';

    const queueLens = seatDecisions.map(d => d.queue.length);
    const avgQueue = queueLens.length > 0 ? (queueLens.reduce((a, b) => a + b, 0) / queueLens.length).toFixed(1) : '—';

    const snake = finalState.snakes.find(candidate => candidate.id === seat);
    let cause = 'Survived';
    if (snake && !snake.isAlive) {
      if (snake.deathReason === 'WALL') cause = 'Wall collision';
      else if (snake.deathReason === 'SELF') cause = 'Self collision';
      else if (snake.deathReason === 'OPPONENT' || snake.deathReason === 'HEAD_ON') cause = 'Opponent collision';
      else if (snake.deathReason === 'SHRINK') cause = 'Ring shrink';
      else cause = 'Crash';
    } else if (finalState.phase === 'OVER' && finalState.winner && finalState.winner !== seat && finalState.winner !== 'DRAW') {
      cause = 'Timeout / Defeat';
    }

    return {
      score: snake?.score ?? 0,
      tokensCollected: snake?.score ?? 0,
      length: snake?.body?.length ?? 0,
      avgLockTime: avgLock,
      fastestLock: fastLock,
      slowestLock: slowLock,
      autoLockCount: autoLocks,
      autoLockPct: `${autoLockPct}% (${autoLocks}/${totalDecisions})`,
      avgQueueLen: avgQueue,
      causeOfDeath: cause,
    };
  };

  const playerIds = finalState.snakes.map(snake => snake.id);
  const p1Id = playerIds[0] ?? 'p1';
  const p2Id = playerIds[1] ?? 'p2';
  const scores = Object.fromEntries(playerIds.map(id => [
    id,
    matchHistory.map(state => state.snakes?.find(snake => snake.id === id)?.score ?? 0),
  ]));
  const playerStats = Object.fromEntries(playerIds.map(id => [id, getLockStats(id)]));
  const p1Scores = scores[p1Id] ?? [];
  const p2Scores = scores[p2Id] ?? [];
  const totalTurns = finalState.tick ?? matchHistory.length;

  const maxThink = Math.max(0, ...Object.values(finalState.totalThinkTime ?? {}));
  const durationSecs = Math.ceil(maxThink);
  const mins = Math.floor(durationSecs / 60);
  const secs = durationSecs % 60;
  const durationFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return {
    totalTurns,
    durationFormatted,
    scores,
    playerStats,
    p1Scores,
    p2Scores,
    p1Stats: getLockStats(p1Id),
    p2Stats: getLockStats(p2Id),
  };
}
