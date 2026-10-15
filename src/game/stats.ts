import { GameState } from '../types/game';
import { TurnDecision } from './replayFile';
import { getPlayerColorPalette } from './playerColors';

export interface PlayerMatchStats {
  score: number;
  points: number;
  tokensCollected: number;
  kills: number;
  standing: number;
  standingLabel: string;
  length: number;
  avgLockTime: string;
  fastestLock: string;
  slowestLock: string;
  autoLockCount: number;
  autoLockPct: string;
  avgQueueLen: string;
  causeOfDeath: string;
}

export interface StandingEntry {
  id: string;
  seat: string;
  name: string;
  color: string;
  standing: number;
  standingLabel: string;
  points: number;
  tokens: number;
  tokensCollected: number;
  kills: number;
  length: number;
  isAlive: boolean;
  causeOfDeath: string;
}

export interface MatchSummaryStats {
  totalTurns: number;
  durationFormatted: string;
  scores: Record<string, number[]>;
  scoresBySeat: Record<string, number[]>;
  playerStats: Record<string, PlayerMatchStats>;
  statsBySeat: Record<string, PlayerMatchStats>;
  standings: StandingEntry[];
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
  spGained: number;
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
      const spGained = prevSnake ? (snake.spEarned ?? 0) - (prevSnake.spEarned ?? 0) : (snake.spEarned ?? 0);

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

      const arrows = decision
        ? decision.queue.map(entry => {
            const d = typeof entry === 'string' ? entry : entry.direction;
            const arrow = d === 'UP' ? '↑' : d === 'DOWN' ? '↓' : d === 'LEFT' ? '←' : '→';
            return typeof entry !== 'string' && (entry.type === 'dart' || entry.type === 'rattle')
              ? `⚡${arrow}`
              : arrow;
          })
        : [];

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
          spGained,
          terminalResult,
        });
      }
    }
  }

  // Aggregate tokens/SP per lock: for each entry with a decision (arrows),
  // sum tokensCollected and spGained from that tick up to (not including)
  // the next decision tick for the same seat.
  const aggregated: TurnLedgerEntry[] = [];
  const bySeat = new Map<string, TurnLedgerEntry[]>();
  for (const e of ledger) {
    if (!bySeat.has(e.seat)) bySeat.set(e.seat, []);
    bySeat.get(e.seat)!.push(e);
  }
  for (const [, entries] of bySeat) {
    entries.sort((a, b) => a.tick - b.tick);
    let i = 0;
    while (i < entries.length) {
      const e = entries[i];
      if (e.arrows.length > 0) {
        let tokens = e.tokensCollected;
        let sp = e.spGained;
        let j = i + 1;
        const keep: TurnLedgerEntry[] = [];
        while (j < entries.length && entries[j].arrows.length === 0) {
          tokens += entries[j].tokensCollected;
          sp += entries[j].spGained;
          if (entries[j].terminalResult) {
            keep.push({ ...entries[j], tokensCollected: 0, spGained: 0 });
          }
          j++;
        }
        aggregated.push({ ...e, tokensCollected: tokens, spGained: sp });
        aggregated.push(...keep);
        i = j;
      } else {
        aggregated.push(e);
        i++;
      }
    }
  }

  return aggregated.sort((a, b) => a.tick - b.tick);
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
  const computedKills: Record<string, number> = {};
  const deathTicks: Record<string, number> = {};

  for (let i = 0; i < matchHistory.length; i++) {
    const st = matchHistory[i];
    const prevSt = i > 0 ? matchHistory[i - 1] : null;
    if (st.lastTurnTimes) {
      for (const [id, seconds] of Object.entries(st.lastTurnTimes)) {
        if (seconds > 0) (turnTimes[id] ??= []).push(seconds);
      }
    }

    for (const snake of st.snakes ?? []) {
      const prevSnake = prevSt?.snakes?.find(candidate => candidate.id === snake.id);
      const justDied = prevSnake ? (prevSnake.isAlive && !snake.isAlive) : !snake.isAlive;
      if (justDied && deathTicks[snake.id] === undefined) {
        deathTicks[snake.id] = st.tick ?? i;
      }
      if (justDied) {
        if (snake.killedBy) {
          computedKills[snake.killedBy] = (computedKills[snake.killedBy] ?? 0) + 1;
        } else if (snake.deathReason === 'OPPONENT' && snake.deathPosition) {
          const killer = (st.snakes ?? []).find(
            other =>
              other.id !== snake.id &&
              other.body.some(seg => seg.x === snake.deathPosition!.x && seg.y === snake.deathPosition!.y),
          ) ?? (prevSt?.snakes ?? []).find(
            other =>
              other.id !== snake.id &&
              other.body.some(seg => seg.x === snake.deathPosition!.x && seg.y === snake.deathPosition!.y),
          );
          if (killer) {
            computedKills[killer.id] = (computedKills[killer.id] ?? 0) + 1;
          }
        }
      }
    }
  }

  const getKillsForSeat = (seat: string): number => {
    const snake = finalState.snakes.find(candidate => candidate.id === seat);
    return Math.max(snake?.kills ?? 0, computedKills[seat] ?? 0);
  };

  const getDeathCause = (seat: string): string => {
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
    return cause;
  };

  const ORDINALS = ['1ST', '2ND', '3RD', '4TH'];
  const sortedSnakes = [...(finalState.snakes ?? [])].sort((a, b) => {
    if (finalState.winner && finalState.winner !== 'DRAW') {
      if (a.id === finalState.winner && b.id !== finalState.winner) return -1;
      if (b.id === finalState.winner && a.id !== finalState.winner) return 1;
    }
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    if (!a.isAlive && !b.isAlive) {
      const aDeath = deathTicks[a.id] ?? 0;
      const bDeath = deathTicks[b.id] ?? 0;
      if (bDeath !== aDeath) return bDeath - aDeath;
    }
    const aPts = a.score ?? 0;
    const bPts = b.score ?? 0;
    if (bPts !== aPts) return bPts - aPts;
    const aKills = getKillsForSeat(a.id);
    const bKills = getKillsForSeat(b.id);
    if (bKills !== aKills) return bKills - aKills;
    return (b.body?.length ?? 0) - (a.body?.length ?? 0);
  });

  const standingMap = new Map<string, { standing: number; standingLabel: string }>();
  sortedSnakes.forEach((snake, idx) => {
    standingMap.set(snake.id, {
      standing: idx + 1,
      standingLabel: ORDINALS[idx] ?? `${idx + 1}TH`,
    });
  });

  const initialState = matchHistory[0] ?? finalState;

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
    const initialSnake = initialState.snakes?.find(candidate => candidate.id === seat);
    const finalScore = snake?.score ?? 0;
    const startScore = initialSnake?.score ?? 0;
    const tokensCollected = matchHistory.length > 1
      ? Math.max(0, finalScore - startScore)
      : finalScore;
    const cause = getDeathCause(seat);
    const rank = standingMap.get(seat) ?? { standing: 1, standingLabel: '1ST' };

    return {
      score: finalScore,
      points: finalScore,
      tokensCollected,
      kills: getKillsForSeat(seat),
      standing: rank.standing,
      standingLabel: rank.standingLabel,
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
  const standings: StandingEntry[] = sortedSnakes.map((snake, idx) => {
    const st = playerStats[snake.id] ?? getLockStats(snake.id);
    const palette = getPlayerColorPalette(snake, idx);
    return {
      id: snake.id,
      seat: snake.id,
      name: snake.name || snake.id.toUpperCase(),
      color: palette.hex,
      standing: st.standing,
      standingLabel: st.standingLabel,
      points: st.points,
      tokens: st.tokensCollected,
      tokensCollected: st.tokensCollected,
      kills: st.kills,
      length: st.length,
      isAlive: snake.isAlive,
      causeOfDeath: st.causeOfDeath,
    };
  });
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
    scoresBySeat: scores,
    playerStats,
    statsBySeat: playerStats,
    standings,
    p1Scores,
    p2Scores,
    p1Stats: playerStats[p1Id] ?? getLockStats(p1Id),
    p2Stats: playerStats[p2Id] ?? getLockStats(p2Id),
  };
}
