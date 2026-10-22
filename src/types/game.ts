export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type SkillId = 'dart' | 'rattle';

export type SkillsAvailableConfig = 'immediate' | 'after_race' | `after_turns:${number}`;

export interface PendingSkill {
  skillId: SkillId;
  direction: Direction;
}

export interface BufferEntry {
  type: 'move' | 'dart' | 'rattle';
  direction: Direction;
}

export interface Position {
  x: number;
  y: number;
}

// RattleWall: a wall (x, y, blocks movement, renders as wall) + a fuse.
// Dropped by Rattle, counts down 3 → 2 → 1, detonates a 3x3 stun on 0.
// Wall stays permanent after detonation.
export interface RattleWall {
  x: number;
  y: number;
  fuseTicks: number; // turns until detonation (3 on drop, decrement each turn)
}

export interface Snake {
  id: string;
  name: string;
  body: Position[]; // index 0 is head
  direction: Direction;
  queuedDirection: Direction | null;
  score: number; // tokens collected — immutable race score, never decreases
  skillPoints: number; // skill wallet — +1 per token, -2 per dart, hidden from opponent
  isAlive: boolean;
  color: string; // Game Boy shade
  equippedSkill: SkillId | null;
  pendingSkill?: PendingSkill | null;
  teamId?: string;
  deathReason?: 'WALL' | 'SELF' | 'OPPONENT' | 'SHRINK' | 'HEAD_ON';
  deathPosition?: Position;
  kills?: number;
  killedBy?: string;
  tokensSinceLock?: number;
  spEarned?: number; // gross SP income this match — never decreases
  stunTicks?: number; // ticks remaining stunned — skips move while > 0
}

export type GamePhase = 'LOBBY' | 'RACING' | 'SHRINKING' | 'TERRITORY' | 'OVER';

export interface GameSettings {
  gridSize: number; // 8 (default), 12, 16
  tickRate: number; // 5 ticks/sec default (real-time mode only)
  turnBased: boolean; // true = simultaneous turns: snakes step only when both players lock a move
  thinkTimeSeconds: number | null; // turn-based planning limit; null = infinite
  raceTurns: number; // turn-based: turns in Phase 1 before shrink starts
  shrinkEveryTurns: number; // turn-based: ring closes every N turns in Phase 2
  shrinkEnabled?: boolean; // editor levels only: false = no shrink phase; after the race the match runs in TERRITORY until one snake remains (absent = true)
  raceDurationSeconds: number; // 180s (3m)
  shrinkIntervalSeconds: number; // 10s
  shrinkWarningSeconds: number; // 2s telegraph
  soundEnabled: boolean;
  gameBoyFrameEnabled: boolean;
  crtFilterEnabled: boolean;
  botDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
  levelId?: string;
  levelName?: string;
  aiStyle?: 'GREEDY' | 'TURTLE' | 'CUTOFF' | 'HEADHUNTER' | 'PATROL' | 'AVALENA' | 'avalena' | 'OPPORTUNIST' | 'opportunist' | 'LEGACY_EASY' | 'legacy_easy' | 'LEGACY_MEDIUM' | 'legacy_medium' | 'LEGACY_HARD' | 'legacy_hard' | 'V2' | 'v2' | 'V3' | 'v3';
  campaignAiDifficulties?: Record<string, 'EASY' | 'MEDIUM' | 'HARD'>;
  campaignAiStyles?: Record<string, 'GREEDY' | 'TURTLE' | 'CUTOFF' | 'HEADHUNTER' | 'PATROL' | 'AVALENA' | 'avalena' | 'OPPORTUNIST' | 'opportunist' | 'LEGACY_EASY' | 'legacy_easy' | 'LEGACY_MEDIUM' | 'legacy_medium' | 'LEGACY_HARD' | 'legacy_hard' | 'V2' | 'v2' | 'V3' | 'v3'>;
  skillsAvailable?: SkillsAvailableConfig;
  gestureSwipeEnabled?: boolean;
  gestureTapPathEnabled?: boolean;
  gestureTapHeadLockEnabled?: boolean;
  gestureDragEnabled?: boolean;
  gestureLongPressEnabled?: boolean;
  gestureCardSwipeEnabled?: boolean;
}

export type CampaignObjectiveKind = 'survival' | 'collect' | 'first_to' | 'first_to_sp' | 'survive' | 'win_under' | 'shutout' | 'outscore';

export interface CampaignObjective {
  text: string;
  kind: CampaignObjectiveKind;
  target: number;
}

export interface GameState {
  tick: number;
  gridSize?: number;
  turnBased: boolean; // copied from settings at match start (host is authoritative in online play)
  phaseTurnsRemaining: number; // turn-based only: turns left in race phase / turns until next ring closes
  lastTurnTimes: Record<string, number> | null; // Turn-based seconds spent planning before the most recent lock.
  totalThinkTime: Record<string, number>; // Turn-based cumulative planning seconds, synchronized in game state.
  phase: GamePhase;
  phaseTimeRemaining: number; // in milliseconds
  phaseEndTime: number; // timestamp
  round: number; // Escalates token count: round 1 = 1 token, round 2 = 2 tokens...
  tokens: Position[];
  campaignTokenRules?: {
    count: number;
    respawn: boolean;
    mode: 'ESCALATING' | 'FIXED' | 'FIXED_SET';
    tokensEatenInRound: number;
  };
  campaignObjectives?: {
    primary: CampaignObjective | null;
    required: (CampaignObjective | null)[];
    bonus: (CampaignObjective | null)[];
    p1TokensCollected: number;
    firstToResults: Array<'p1' | 'opponent' | 'tie' | null>;
    surviveResults: boolean[];
  };
  walls?: Position[];
  rattleWalls?: RattleWall[];
  snakes: Snake[];
  ringInset: number; // 0 for full 8x8, 1 for 6x6, 2 for 4x4, 3 for 2x2
  isTelegraphingShrink: boolean;
  telegraphRingInset: number;
  winner: string | 'DRAW' | null;
  winReason: string;
  totalMatchTime: number;
  readyConfirmed?: Record<string, boolean>;
  skillsAvailable?: SkillsAvailableConfig;
  dartTrail?: Array<{ snakeId: string; cells: Position[] }>;
  stunZones?: Position[]; // 3x3 cells flashing amber on rattle stun — fades over stun duration
  detonationAt?: number; // timestamp (ms) when a rattle wall detonated — drives the 3-phase blast visual
  teamProtection?: boolean;
}

export interface CompactSnakeState {
  body: Position[];
  direction: Direction;
  score: number;
  skillPoints: number;
  isAlive: boolean;
  equippedSkill: SkillId | null;
  pendingSkill?: PendingSkill | null;
}

export interface CompactGameState {
  tick: number;
  gridSize: number;
  phase: GamePhase;
  turnBased: boolean;
  phaseTurnsRemaining: number;
  phaseTimeRemaining: number;
  round: number;
  ringInset: number;
  isTelegraphingShrink: boolean;
  telegraphRingInset: number;
  tokens: Position[];
  walls: Position[];
  snakes: Record<string, CompactSnakeState>;
  locks: Record<string, boolean>;
  winner: GameState['winner'];
  skillsAvailable?: SkillsAvailableConfig;
}

export interface SnakeAiBridge {
  getSeat: () => 'p1' | 'p2' | null;
  getState: (opts?: { compact?: boolean }) => GameState | CompactGameState;
  queueMoves: (moves: (Direction | BufferEntry)[]) => (Direction | BufferEntry)[];
  activateSkill?: (direction?: Direction) => boolean;
  lock: () => void;
  selectSeat: (seat: 'p1' | 'p2') => void;
  onState: (
    cb: (state: GameState | CompactGameState) => void,
    opts?: { compact?: boolean },
  ) => () => void;
}

export type PlayMode = 'SOLO_AI' | 'LOCAL_2P' | 'LOCAL_HOTSEAT' | 'ONLINE_HOST' | 'ONLINE_JOIN' | 'ONLINE_SERVER' | 'ONLINE_SPECTATOR' | 'VIRTUAL_BOT';

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
  matchId: string;
  matchNumber: number;
  inputSequence: number;
  dir: Direction;
  entryType?: 'move' | 'dart' | 'rattle';
  entry?: BufferEntry;
  skill?: PendingSkill | null;
  tick: number;
  clientTime: number;
}

declare global {
  interface Window {
    __SNAKE_AI__?: SnakeAiBridge;
  }
}