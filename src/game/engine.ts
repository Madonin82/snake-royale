import { Direction, GamePhase, GameSettings, GameState, Position, Snake } from '../types/game';
import { soundEngine } from '../audio/soundEngine';

export const GAMEBOY_COLORS = {
  DARKEST: '#0F380F',   // P1 snake, closed ring, borders, deep text
  DARK: '#306230',      // P2 snake, secondary UI, telegraph warning
  LIGHT: '#8BAC0F',     // Grid lines, blinking token highlight, dimmed HUD
  LIGHTEST: '#9BBC0F',  // Background arena canvas, active retro screen
};

export const DEFAULT_SETTINGS: GameSettings = {
  gridSize: 16,
  tickRate: 5,
  turnBased: true,
  raceTurns: 90,
  shrinkEveryTurns: 8,
  raceDurationSeconds: 180, // 3 minutes
  shrinkIntervalSeconds: 10, // 10s per ring step
  shrinkWarningSeconds: 2,   // 2s telegraph
  soundEnabled: true,
  gameBoyFrameEnabled: true,
  crtFilterEnabled: false,
  botDifficulty: 'MEDIUM',
};

// Check if a turn is 180-degree reverse
export function isOppositeDirection(d1: Direction, d2: Direction): boolean {
  if (d1 === 'UP' && d2 === 'DOWN') return true;
  if (d1 === 'DOWN' && d2 === 'UP') return true;
  if (d1 === 'LEFT' && d2 === 'RIGHT') return true;
  if (d1 === 'RIGHT' && d2 === 'LEFT') return true;
  return false;
}

export function getNextHeadPosition(head: Position, dir: Direction): Position {
  switch (dir) {
    case 'UP': return { x: head.x, y: head.y - 1 };
    case 'DOWN': return { x: head.x, y: head.y + 1 };
    case 'LEFT': return { x: head.x - 1, y: head.y };
    case 'RIGHT': return { x: head.x + 1, y: head.y };
  }
}

export function createInitialState(settings: GameSettings = DEFAULT_SETTINGS): GameState {
  const size = settings.gridSize;
  const midY1 = Math.floor(size / 3);
  const midY2 = size - 1 - midY1;

  const p1: Snake = {
    id: 'p1',
    name: 'PLAYER 1',
    body: [
      { x: 2, y: midY1 },
      { x: 1, y: midY1 },
      { x: 0, y: midY1 },
    ],
    direction: 'RIGHT',
    queuedDirection: null,
    score: 0,
    isAlive: true,
    color: GAMEBOY_COLORS.DARKEST,
  };

  const p2: Snake = {
    id: 'p2',
    name: 'PLAYER 2',
    body: [
      { x: size - 3, y: midY2 },
      { x: size - 2, y: midY2 },
      { x: size - 1, y: midY2 },
    ],
    direction: 'LEFT',
    queuedDirection: null,
    score: 0,
    isAlive: true,
    color: GAMEBOY_COLORS.DARK,
  };

  // Spawn initial 1 token for round 1
  const initialTokens: Position[] = [];
  const initialRound = 1;
  const spawned = spawnTokens(initialRound, size, 0, [p1, p2], initialTokens);
  initialTokens.push(...spawned);

  const now = Date.now();
  const raceDurationMs = settings.raceDurationSeconds * 1000;

  return {
    tick: 0,
    turnBased: settings.turnBased,
    phaseTurnsRemaining: settings.turnBased ? settings.raceTurns : 0,
    phase: 'RACING',
    phaseTimeRemaining: raceDurationMs,
    phaseEndTime: now + raceDurationMs,
    round: initialRound,
    tokens: initialTokens,
    snakes: { p1, p2 },
    ringInset: 0,
    isTelegraphingShrink: false,
    telegraphRingInset: 0,
    winner: null,
    winReason: '',
    totalMatchTime: 0,
  };
}

export function spawnTokens(
  count: number,
  gridSize: number,
  ringInset: number,
  snakes: Snake[],
  existingTokens: Position[]
): Position[] {
  const occupied = new Set<string>();

  // Add snake bodies to occupied
  for (const snake of snakes) {
    for (const segment of snake.body) {
      occupied.add(`${segment.x},${segment.y}`);
    }
  }

  // Add existing tokens to occupied
  for (const token of existingTokens) {
    occupied.add(`${token.x},${token.y}`);
  }

  // Find all valid available cells within the current ringInset boundary
  const available: Position[] = [];
  const minBound = ringInset;
  const maxBound = gridSize - 1 - ringInset;

  for (let x = minBound; x <= maxBound; x++) {
    for (let y = minBound; y <= maxBound; y++) {
      if (!occupied.has(`${x},${y}`)) {
        available.push({ x, y });
      }
    }
  }

  const result: Position[] = [];
  const spawnAmount = Math.min(count, available.length);

  for (let i = 0; i < spawnAmount; i++) {
    if (available.length === 0) break;
    const randomIndex = Math.floor(Math.random() * available.length);
    const chosen = available.splice(randomIndex, 1)[0];
    result.push(chosen);
  }

  return result;
}

export function isCellInArena(pos: Position, gridSize: number, ringInset: number): boolean {
  const minBound = ringInset;
  const maxBound = gridSize - 1 - ringInset;
  return pos.x >= minBound && pos.x <= maxBound && pos.y >= minBound && pos.y <= maxBound;
}

export function queueSnakeDirection(snake: Snake, newDir: Direction): void {
  // Disallow 180 reverse against current active direction or already queued direction
  const effectiveCurrentDir = snake.queuedDirection || snake.direction;
  if (!isOppositeDirection(effectiveCurrentDir, newDir)) {
    snake.queuedDirection = newDir;
  }
}

export interface TickResult {
  nextState: GameState;
  events: {
    tokenEatenP1: boolean;
    tokenEatenP2: boolean;
    ringShrunk: boolean;
    shrinkTelegraphStarted: boolean;
    deathOccurred: boolean;
    matchEnded: boolean;
  };
}

export function processGameTick(
  currentState: GameState,
  settings: GameSettings,
  deltaMs: number
): TickResult {
  if (currentState.phase === 'OVER') {
    return {
      nextState: currentState,
      events: {
        tokenEatenP1: false,
        tokenEatenP2: false,
        ringShrunk: false,
        shrinkTelegraphStarted: false,
        deathOccurred: false,
        matchEnded: false,
      }
    };
  }

  const state: GameState = {
    ...currentState,
    tick: currentState.tick + 1,
    totalMatchTime: currentState.totalMatchTime + deltaMs,
    phaseTimeRemaining: Math.max(0, currentState.phaseTimeRemaining - deltaMs),
    snakes: {
      p1: { ...currentState.snakes.p1, body: [...currentState.snakes.p1.body] },
      p2: { ...currentState.snakes.p2, body: [...currentState.snakes.p2.body] },
    },
    tokens: [...currentState.tokens],
  };

  const events = {
    tokenEatenP1: false,
    tokenEatenP2: false,
    ringShrunk: false,
    shrinkTelegraphStarted: false,
    deathOccurred: false,
    matchEnded: false,
  };

  const maxRingInset = Math.floor(settings.gridSize / 2) - 1; // 8x8 -> max inset is 3 (2x2 remaining)

  // 1. PHASE PROGRESSION & SHRINK TIMING
  if (settings.turnBased) {
    // TURN-BASED: phases advance by turns taken, never by wall clock.
    // phaseTurnsRemaining = turns left in race / turns until next ring closes.
    if (state.phase === 'RACING') {
      state.phaseTurnsRemaining = Math.max(0, state.phaseTurnsRemaining - 1);
      if (state.phaseTurnsRemaining <= 0) {
        state.phase = 'SHRINKING';
        state.phaseTurnsRemaining = settings.shrinkEveryTurns;
        state.isTelegraphingShrink = false;
      }
    } else if (state.phase === 'SHRINKING') {
      state.phaseTurnsRemaining = Math.max(0, state.phaseTurnsRemaining - 1);

      // Telegraph the next ring closing during the final 2 turns of the countdown
      if (state.ringInset < maxRingInset && state.phaseTurnsRemaining <= 2 && state.phaseTurnsRemaining > 0) {
        if (!state.isTelegraphingShrink) {
          state.isTelegraphingShrink = true;
          state.telegraphRingInset = state.ringInset + 1;
          events.shrinkTelegraphStarted = true;
        }
      } else if (state.phaseTurnsRemaining > 2) {
        state.isTelegraphingShrink = false;
      }

      if (state.phaseTurnsRemaining <= 0) {
        if (state.ringInset < maxRingInset) {
          state.ringInset += 1;
          events.ringShrunk = true;
          state.isTelegraphingShrink = false;
          // Eject tokens now outside arena
          state.tokens = state.tokens.filter(t => isCellInArena(t, settings.gridSize, state.ringInset));
          state.phaseTurnsRemaining = settings.shrinkEveryTurns;
        } else {
          // Arena fully closed and the countdown is spent: decide on tiebreakers
          resolveMatchByTiebreakers(state, 'Arena fully closed');
          events.matchEnded = true;
          return { nextState: state, events };
        }
      }
    }
  } else if (state.phase === 'RACING') {
    if (state.phaseTimeRemaining <= 0) {
      state.phase = 'SHRINKING';
      state.phaseTimeRemaining = 120 * 1000; // 2 minutes for shrink phase
      state.phaseEndTime = Date.now() + 120 * 1000;
    }
  }

  if (!settings.turnBased && state.phase === 'SHRINKING') {
    const elapsedInShrink = (120 * 1000) - state.phaseTimeRemaining;
    const intervalMs = settings.shrinkIntervalSeconds * 1000;
    const warningMs = settings.shrinkWarningSeconds * 1000;

    // Calculate which ring step we are on (step 1 after 10s, step 2 after 20s, etc.)
    const targetRingStep = Math.min(maxRingInset, Math.floor(elapsedInShrink / intervalMs));
    const nextShrinkTimeInStep = (targetRingStep + 1) * intervalMs;
    const timeUntilNextStep = nextShrinkTimeInStep - elapsedInShrink;

    // Telegraph warning if within warning window and not already at maximum shrink
    if (targetRingStep < maxRingInset && timeUntilNextStep <= warningMs && timeUntilNextStep > 0) {
      if (!state.isTelegraphingShrink) {
        state.isTelegraphingShrink = true;
        state.telegraphRingInset = targetRingStep + 1;
        events.shrinkTelegraphStarted = true;
      }
    } else {
      state.isTelegraphingShrink = false;
    }

    if (targetRingStep > state.ringInset) {
      state.ringInset = targetRingStep;
      events.ringShrunk = true;
      state.isTelegraphingShrink = false;

      // Remove any tokens that got crushed outside the new ring
      state.tokens = state.tokens.filter(t => isCellInArena(t, settings.gridSize, state.ringInset));
    }

    // Shrink timer fully expired
    if (state.phaseTimeRemaining <= 0) {
      resolveMatchByTiebreakers(state, 'Time expired in Shrink Phase');
      events.matchEnded = true;
      return { nextState: state, events };
    }
  }

  // 2. APPLY QUEUED INPUTS
  const { p1, p2 } = state.snakes;
  if (p1.queuedDirection) {
    p1.direction = p1.queuedDirection;
    p1.queuedDirection = null;
  }
  if (p2.queuedDirection) {
    p2.direction = p2.queuedDirection;
    p2.queuedDirection = null;
  }

  // 3. CALCULATE NEXT HEAD POSITIONS
  const nextHeadP1 = getNextHeadPosition(p1.body[0], p1.direction);
  const nextHeadP2 = getNextHeadPosition(p2.body[0], p2.direction);

  // 4. CHECK COLLISIONS
  // Check Wall / Shrink Arena bounds
  const p1HitWall = !isCellInArena(nextHeadP1, settings.gridSize, state.ringInset);
  const p2HitWall = !isCellInArena(nextHeadP2, settings.gridSize, state.ringInset);

  // Check Self Collision (excluding tail if not eating a token this tick, but for head collision against existing body)
  const p1HitSelf = p1.body.slice(0, -1).some(seg => seg.x === nextHeadP1.x && seg.y === nextHeadP1.y);
  const p2HitSelf = p2.body.slice(0, -1).some(seg => seg.x === nextHeadP2.x && seg.y === nextHeadP2.y);

  // Check Opponent Body Collision
  const p1HitP2Body = p2.body.slice(0, -1).some(seg => seg.x === nextHeadP1.x && seg.y === nextHeadP1.y);
  const p2HitP1Body = p1.body.slice(0, -1).some(seg => seg.x === nextHeadP2.x && seg.y === nextHeadP2.y);

  // Check Head-on Collision
  const headOnSameCell = nextHeadP1.x === nextHeadP2.x && nextHeadP1.y === nextHeadP2.y;
  const headCrossedEachOther = nextHeadP1.x === p2.body[0].x && nextHeadP1.y === p2.body[0].y &&
                               nextHeadP2.x === p1.body[0].x && nextHeadP2.y === p1.body[0].y;
  const isHeadOn = headOnSameCell || headCrossedEachOther;

  let p1Died = p1HitWall || p1HitSelf || p1HitP2Body || isHeadOn;
  let p2Died = p2HitWall || p2HitSelf || p2HitP1Body || isHeadOn;

  if (p1Died) {
    p1.isAlive = false;
    p1.deathReason = isHeadOn ? 'HEAD_ON' : (p1HitWall ? 'WALL' : (p1HitSelf ? 'SELF' : 'OPPONENT'));
  }
  if (p2Died) {
    p2.isAlive = false;
    p2.deathReason = isHeadOn ? 'HEAD_ON' : (p2HitWall ? 'WALL' : (p2HitSelf ? 'SELF' : 'OPPONENT'));
  }

  // 5. RESOLVE GAME OVER IF DEATH OCCURRED
  if (p1Died || p2Died) {
    events.deathOccurred = true;
    events.matchEnded = true;
    state.phase = 'OVER';

    if (!p1Died && p2Died) {
      state.winner = 'p1';
      state.winReason = `Player 2 crashed into ${p2.deathReason?.toLowerCase() || 'obstacle'}!`;
    } else if (p1Died && !p2Died) {
      state.winner = 'p2';
      state.winReason = `Player 1 crashed into ${p1.deathReason?.toLowerCase() || 'obstacle'}!`;
    } else {
      // Both died on same tick (or head-on)
      resolveMatchByTiebreakers(state, isHeadOn ? 'Mutual Head-On Collision!' : 'Simultaneous Crash!');
    }

    return { nextState: state, events };
  }

  // 6. CHECK TOKEN CONSUMPTION
  const p1AteTokenIndex = state.tokens.findIndex(t => t.x === nextHeadP1.x && t.y === nextHeadP1.y);
  const p2AteTokenIndex = state.tokens.findIndex(t => t.x === nextHeadP2.x && t.y === nextHeadP2.y);

  // If both snakes target the exact same token on the same tick (rare if token count > 1, but handles head-on race)
  if (p1AteTokenIndex !== -1 && p2AteTokenIndex !== -1 && p1AteTokenIndex === p2AteTokenIndex) {
    // Both ate same token -> split point or award both
    p1.score += 1;
    p2.score += 1;
    events.tokenEatenP1 = true;
    events.tokenEatenP2 = true;
    state.tokens.splice(p1AteTokenIndex, 1);
  } else {
    // Handle P1 eating
    if (p1AteTokenIndex !== -1) {
      p1.score += 1;
      events.tokenEatenP1 = true;
      state.tokens.splice(p1AteTokenIndex, 1);
    }
    // Handle P2 eating (adjust index if needed)
    const p2Index = state.tokens.findIndex(t => t.x === nextHeadP2.x && t.y === nextHeadP2.y);
    if (p2Index !== -1) {
      p2.score += 1;
      events.tokenEatenP2 = true;
      state.tokens.splice(p2Index, 1);
    }
  }

  // 7. MOVE SNAKE BODIES
  // P1 move
  p1.body.unshift(nextHeadP1);
  if (!events.tokenEatenP1) {
    p1.body.pop(); // Remove tail unless grew
  }

  // P2 move
  p2.body.unshift(nextHeadP2);
  if (!events.tokenEatenP2) {
    p2.body.pop(); // Remove tail unless grew
  }

  // 8. ESCALATE TOKEN SPAWNS (Only during Phase 1 Racing)
  if (state.phase === 'RACING' && state.tokens.length === 0) {
    state.round += 1;
    const newTokens = spawnTokens(state.round, settings.gridSize, state.ringInset, [p1, p2], []);
    state.tokens.push(...newTokens);
  }

  return { nextState: state, events };
}

function resolveMatchByTiebreakers(state: GameState, contextReason: string) {
  state.phase = 'OVER';
  const p1Score = state.snakes.p1.score;
  const p2Score = state.snakes.p2.score;
  const p1Len = state.snakes.p1.body.length;
  const p2Len = state.snakes.p2.body.length;

  if (p1Score > p2Score) {
    state.winner = 'p1';
    state.winReason = `${contextReason} — P1 wins on tokens (${p1Score} vs ${p2Score})!`;
  } else if (p2Score > p1Score) {
    state.winner = 'p2';
    state.winReason = `${contextReason} — P2 wins on tokens (${p2Score} vs ${p1Score})!`;
  } else if (p1Len > p2Len) {
    state.winner = 'p1';
    state.winReason = `${contextReason} — Tied tokens (${p1Score}), P1 wins on snake length (${p1Len} vs ${p2Len})!`;
  } else if (p2Len > p1Len) {
    state.winner = 'p2';
    state.winReason = `${contextReason} — Tied tokens (${p2Score}), P2 wins on snake length (${p2Len} vs ${p1Len})!`;
  } else {
    state.winner = 'DRAW';
    state.winReason = `${contextReason} — Dead heat draw (${p1Score} tokens, ${p1Len} length)!`;
  }
}
