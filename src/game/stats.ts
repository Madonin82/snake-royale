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
  p1Scores: number[];
  p2Scores: number[];
  p1Stats: PlayerMatchStats;
  p2Stats: PlayerMatchStats;
}

export interface TurnLedgerEntry {
  tick: number;
  seat: 'p1' | 'p2';
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

    for (const seat of ['p1', 'p2'] as const) {
      const decision = sortedDecisions.find(d => d.tick === tick && d.seat === seat);
      const snake = currentState.snakes?.[seat];
      const prevSnake = prevState?.snakes?.[seat];
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
    snakes: {
      p1: { score: 0, body: [], isAlive: true },
      p2: { score: 0, body: [], isAlive: true },
    },
    totalThinkTime: { p1: 0, p2: 0 },
    phase: 'OVER',
    winner: null,
  };

  const p1 = finalState.snakes.p1;
  const p2 = finalState.snakes.p2;

  const p1TurnTimes: number[] = [];
  const p2TurnTimes: number[] = [];
  for (const st of matchHistory) {
    if (st.lastTurnTimes) {
      if (st.lastTurnTimes.p1 > 0) p1TurnTimes.push(st.lastTurnTimes.p1);
      if (st.lastTurnTimes.p2 > 0) p2TurnTimes.push(st.lastTurnTimes.p2);
    }
  }

  const getLockStats = (seat: 'p1' | 'p2'): PlayerMatchStats => {
    const times = seat === 'p1' ? p1TurnTimes : p2TurnTimes;
    const seatDecisions = decisions.filter(d => d.seat === seat);
    const autoLocks = seatDecisions.filter(d => d.autoLock).length;
    const totalDecisions = seatDecisions.length;
    const autoLockPct = totalDecisions > 0 ? Math.round((autoLocks / totalDecisions) * 100) : 0;

    const avgLock = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + 's' : '—';
    const fastLock = times.length > 0 ? Math.min(...times).toFixed(1) + 's' : '—';
    const slowLock = times.length > 0 ? Math.max(...times).toFixed(1) + 's' : '—';

    const queueLens = seatDecisions.map(d => d.queue.length);
    const avgQueue = queueLens.length > 0 ? (queueLens.reduce((a, b) => a + b, 0) / queueLens.length).toFixed(1) : '—';

    const snake = seat === 'p1' ? p1 : p2;
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

  const p1Scores = matchHistory.map(s => s.snakes?.p1?.score ?? 0);
  const p2Scores = matchHistory.map(s => s.snakes?.p2?.score ?? 0);
  const totalTurns = finalState.tick ?? matchHistory.length;

  const totalThinkP1 = finalState.totalThinkTime?.p1 || 0;
  const totalThinkP2 = finalState.totalThinkTime?.p2 || 0;
  const maxThink = Math.max(totalThinkP1, totalThinkP2);
  const durationSecs = Math.ceil(maxThink);
  const mins = Math.floor(durationSecs / 60);
  const secs = durationSecs % 60;
  const durationFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return {
    totalTurns,
    durationFormatted,
    p1Scores,
    p2Scores,
    p1Stats: getLockStats('p1'),
    p2Stats: getLockStats('p2'),
  };
}
