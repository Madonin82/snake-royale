export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface Position {
  x: number;
  y: number;
}

export interface Snake {
  id: 'p1' | 'p2';
  name: string;
  body: Position[]; // index 0 is head
  direction: Direction;
  queuedDirection: Direction | null;
  score: number;
  isAlive: boolean;
  color: string; // Game Boy shade
  deathReason?: 'WALL' | 'SELF' | 'OPPONENT' | 'SHRINK' | 'HEAD_ON';
}

export type GamePhase = 'LOBBY' | 'RACING' | 'SHRINKING' | 'OVER';

export interface GameSettings {
  gridSize: number; // 8 (default), 12, 16
  tickRate: number; // 5 ticks/sec default (real-time mode only)
  turnBased: boolean; // true = simultaneous turns: snakes step only when both players lock a move
  raceTurns: number; // turn-based: turns in Phase 1 before shrink starts
  shrinkEveryTurns: number; // turn-based: ring closes every N turns in Phase 2
  raceDurationSeconds: number; // 180s (3m)
  shrinkIntervalSeconds: number; // 10s
  shrinkWarningSeconds: number; // 2s telegraph
  soundEnabled: boolean;
  gameBoyFrameEnabled: boolean;
  crtFilterEnabled: boolean;
  botDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface GameState {
  tick: number;
  turnBased: boolean; // copied from settings at match start (host is authoritative in online play)
  phaseTurnsRemaining: number; // turn-based only: turns left in race phase / turns until next ring closes
  lastTurnTimes: { p1: number; p2: number } | null; // turn-based only: seconds each player took to lock last turn (set by App, travels with synced state)
  totalThinkTime: { p1: number; p2: number }; // turn-based only: cumulative seconds spent thinking this match
  phase: GamePhase;
  phaseTimeRemaining: number; // in milliseconds
  phaseEndTime: number; // timestamp
  round: number; // Escalates token count: round 1 = 1 token, round 2 = 2 tokens...
  tokens: Position[];
  snakes: {
    p1: Snake;
    p2: Snake;
  };
  ringInset: number; // 0 for full 8x8, 1 for 6x6, 2 for 4x4, 3 for 2x2
  isTelegraphingShrink: boolean;
  telegraphRingInset: number;
  winner: 'p1' | 'p2' | 'DRAW' | null;
  winReason: string;
  totalMatchTime: number;
}

export type PlayMode = 'SOLO_AI' | 'LOCAL_2P' | 'ONLINE_HOST' | 'ONLINE_JOIN' | 'ONLINE_SERVER' | 'ONLINE_SPECTATOR' | 'VIRTUAL_BOT';

export interface LatencySample {
  pingId: string;
  rttMs: number;
  timestamp: number;
  peerMissing?: boolean;
}

export interface LatencyReport {
  samples: LatencySample[];
  medianRtt: number;
  p95Rtt: number;
  minRtt: number;
  maxRtt: number;
  avgRtt: number;
  jitterMs: number;
  packetLossPercent: number;
  inputTickLagAvg: number;
  lastTestedAt: number;
}

export interface NetworkInputPayload {
  role: 'p1' | 'p2';
  dir: Direction;
  tick: number;
  clientTime: number;
}
