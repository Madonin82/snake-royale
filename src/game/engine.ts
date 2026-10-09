import { Direction, GamePhase, GameSettings, GameState, PendingSkill, Position, Snake } from '../types/game';
import { soundEngine } from '../audio/soundEngine';
import { createInitialThinkTimeValues } from './thinkTime';
import { recordFirstToResults, recordSurviveResults } from './objectives';
import { canActivateSkill, isValidDartDirection, SKILLS } from './skills';

export const GAMEBOY_COLORS = {
  DARKEST: '#0F380F',   // P1 snake, closed ring, borders, deep text
  DARK: '#306230',      // P2 snake, secondary UI, telegraph warning
  LIGHT: '#8BAC0F',     // Grid lines, blinking token highlight, dimmed HUD
  LIGHTEST: '#9BBC0F',  // Background arena canvas, active retro screen
};

export const DEFAULT_SETTINGS: GameSettings = {
  gridSize: 8,
  tickRate: 8,
  turnBased: true,
  thinkTimeSeconds: null,
  raceTurns: 60,
  shrinkEveryTurns: 8,
  raceDurationSeconds: 180, // 3 minutes
  shrinkIntervalSeconds: 10, // 10s per ring step
  shrinkWarningSeconds: 2,   // 2s telegraph
  soundEnabled: true,
  gameBoyFrameEnabled: true,
  crtFilterEnabled: false,
  botDifficulty: 'MEDIUM',
  skillsAvailable: 'after_race',
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

export function createInitialState(
  settings: GameSettings = DEFAULT_SETTINGS,
  playerNames?: { p1?: string; p2?: string }
): GameState {
  const size = settings.gridSize;
  const midY1 = Math.floor(size / 3);
  const midY2 = size - 1 - midY1;

  const p1: Snake = {
    id: 'p1',
    name: (playerNames?.p1 || 'PLAYER 1').toUpperCase().slice(0, 14),
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
    equippedSkill: null,
    pendingSkill: null,
  };

  const p2: Snake = {
    id: 'p2',
    name: (playerNames?.p2 || 'PLAYER 2').toUpperCase().slice(0, 14),
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
    equippedSkill: null,
    pendingSkill: null,
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
    gridSize: size,
    turnBased: settings.turnBased,
    phaseTurnsRemaining: settings.turnBased ? settings.raceTurns : 0,
    ...createInitialThinkTimeValues(),
    phase: 'RACING',
    phaseTimeRemaining: raceDurationMs,
    phaseEndTime: now + raceDurationMs,
    round: initialRound,
    tokens: initialTokens,
    snakes: [p1, p2],
    ringInset: 0,
    isTelegraphingShrink: false,
    telegraphRingInset: 0,
    winner: null,
    winReason: '',
    totalMatchTime: 0,
    skillsAvailable: settings.skillsAvailable ?? 'after_race',
  };
}

export function spawnTokens(
  count: number,
  gridSize: number,
  ringInset: number,
  snakes: Snake[],
  existingTokens: Position[],
  walls: Position[] = [],
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

  for (const wall of walls) {
    occupied.add(`${wall.x},${wall.y}`);
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

export function queueSnakeDirection(snake: Snake, newDir: Direction): boolean {
  // Disallow 180 reverse against current active direction or already queued direction
  const effectiveCurrentDir = snake.queuedDirection || snake.direction;
  if (!isOppositeDirection(effectiveCurrentDir, newDir)) {
    snake.queuedDirection = newDir;
    return true;
  }
  return false;
}

export function queueSnakeSkill(snake: Snake, skill: PendingSkill | null): boolean {
  if (!skill) {
    snake.pendingSkill = null;
    return true;
  }
  const effectiveFacing = snake.queuedDirection || snake.direction;
  if (!isValidDartDirection(effectiveFacing, skill.direction)) {
    return false;
  }
  snake.pendingSkill = { ...skill };
  return true;
}

export interface HitstopInfo {
  durationMs: number;
  kind: 'TOKEN' | 'DEATH' | 'BOSS_DEATH';
  flashCells: Position[];
}

export function getHitstopForTransition(
  prevState: GameState | null | undefined,
  nextState: GameState,
  isCampaign: boolean = Boolean(nextState.campaignObjectives || nextState.campaignTokenRules),
): HitstopInfo | null {
  if (!prevState || nextState.tick <= prevState.tick) return null;

  const newlyDead = nextState.snakes.filter(snake => {
    const prevSnake = prevState.snakes.find(candidate => candidate.id === snake.id);
    return prevSnake?.isAlive && !snake.isAlive;
  });

  if (newlyDead.length > 0) {
    const flashCells = newlyDead
      .map(snake => {
        const pos = snake.deathPosition;
        if (pos && pos.x >= 0 && pos.y >= 0) return pos;
        return snake.body[0] ?? pos;
      })
      .filter((pos): pos is Position => Boolean(pos));
    const bossDead = isCampaign && newlyDead.some(snake => snake.id !== 'p1');
    if (bossDead) {
      return {
        durationMs: 500,
        kind: 'BOSS_DEATH',
        flashCells,
      };
    }
    return {
      durationMs: 300,
      kind: 'DEATH',
      flashCells,
    };
  }

  const tokenEaten = nextState.snakes.some(snake => {
    const prevSnake = prevState.snakes.find(candidate => candidate.id === snake.id);
    return prevSnake && snake.score > prevSnake.score;
  });

  if (tokenEaten) {
    return {
      durationMs: 100,
      kind: 'TOKEN',
      flashCells: [],
    };
  }

  return null;
}

export interface TickResult {
  nextState: GameState;
  events: {
    tokenEaten: Record<string, boolean>;
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
        tokenEaten: {},
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
    snakes: currentState.snakes.map(snake => ({ ...snake, body: [...snake.body] })),
    tokens: [...currentState.tokens],
    ...(currentState.campaignTokenRules
      ? { campaignTokenRules: { ...currentState.campaignTokenRules } }
      : {}),
    ...(currentState.campaignObjectives
      ? {
          campaignObjectives: {
            ...currentState.campaignObjectives,
            bonus: [...currentState.campaignObjectives.bonus],
            firstToResults: [...currentState.campaignObjectives.firstToResults],
            surviveResults: [...currentState.campaignObjectives.surviveResults],
          },
        }
      : {}),
  };

  const events: TickResult['events'] = {
    tokenEaten: {},
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

  // 2. APPLY QUEUED INPUTS & RESOLVE MOVEMENT / SKILLS
  const snakes = state.snakes;
  const effectiveSkillsAvailable = state.skillsAvailable ?? settings.skillsAvailable ?? 'after_race';

  // Determine which snakes are executing Dart this tick (evaluated before phase transition or after? Wait: if after_race unlocks when shrink phase starts, state.phase is already updated in step 1 or already SHRINKING at start of turn)
  // Check both currentState (at planning time) and state (at resolution time) so if unlocked at planning time or resolution time it works cleanly.
  const activeDarts = new Map<string, Direction>();
  for (const snake of snakes) {
    if (snake.queuedDirection) {
      snake.direction = snake.queuedDirection;
      snake.queuedDirection = null;
    }
    if (snake.pendingSkill && snake.pendingSkill.skillId === 'dart') {
      const dartDir = snake.pendingSkill.direction;
      snake.pendingSkill = null;
      const unlockedNow = canActivateSkill(snake, currentState, effectiveSkillsAvailable) ||
        canActivateSkill(snake, state, effectiveSkillsAvailable);
      if (unlockedNow && isValidDartDirection(snake.direction, dartDir)) {
        activeDarts.set(snake.id, dartDir);
      }
    }
  }

  const isPermanentWall = (position: Position) =>
    state.walls?.some(wall => wall.x === position.x && wall.y === position.y) ?? false;

  const totalSteps = activeDarts.size > 0 ? 3 : 1;
  let totalTokensConsumedCount = 0;

  for (let step = 0; step < totalSteps; step++) {
    const movingIndices: number[] = [];
    for (let i = 0; i < snakes.length; i++) {
      if (!snakes[i].isAlive) continue;
      if (step === 0 || activeDarts.has(snakes[i].id)) {
        movingIndices.push(i);
      }
    }
    if (movingIndices.length === 0) break;

    if (step === 1) {
      for (const idx of movingIndices) {
        const dartDir = activeDarts.get(snakes[idx].id);
        if (dartDir) {
          snakes[idx].direction = dartDir;
        }
      }
    }

    const nextHeads = snakes.map((snake, idx) =>
      movingIndices.includes(idx) ? getNextHeadPosition(snake.body[0], snake.direction) : snake.body[0],
    );
    const willGrow = nextHeads.map((head, idx) =>
      movingIndices.includes(idx) && state.tokens.some(token => token.x === head.x && token.y === head.y),
    );
    const deaths = snakes.map(() => ({ wall: false, self: false, body: false, headOn: false }));

    for (const i of movingIndices) {
      const snake = snakes[i];
      const head = nextHeads[i];
      deaths[i].wall = !isCellInArena(head, settings.gridSize, state.ringInset) || isPermanentWall(head);
      const selfBody = willGrow[i] ? snake.body : snake.body.slice(0, -1);
      deaths[i].self = selfBody.some(segment => segment.x === head.x && segment.y === head.y);
      for (let j = 0; j < snakes.length; j++) {
        if (i === j) continue;
        const jMoving = movingIndices.includes(j);
        const otherBody = !snakes[j].isAlive || !jMoving || willGrow[j]
          ? snakes[j].body
          : snakes[j].body.slice(0, -1);
        if (otherBody.some(segment => segment.x === head.x && segment.y === head.y)) {
          deaths[i].body = true;
        }
      }
    }

    for (let a = 0; a < movingIndices.length; a++) {
      for (let b = a + 1; b < movingIndices.length; b++) {
        const i = movingIndices[a];
        const j = movingIndices[b];
        const sameCell = nextHeads[i].x === nextHeads[j].x && nextHeads[i].y === nextHeads[j].y;
        const crossed = nextHeads[i].x === snakes[j].body[0].x && nextHeads[i].y === snakes[j].body[0].y &&
          nextHeads[j].x === snakes[i].body[0].x && nextHeads[j].y === snakes[i].body[0].y;
        if (sameCell || crossed) {
          deaths[i].headOn = true;
          deaths[j].headOn = true;
        }
      }
    }

    // Also check if a darting snake in step > 0 lands on a non-moving living snake's head
    if (step > 0) {
      for (const i of movingIndices) {
        for (let j = 0; j < snakes.length; j++) {
          if (i === j || !snakes[j].isAlive || movingIndices.includes(j)) continue;
          if (nextHeads[i].x === snakes[j].body[0].x && nextHeads[i].y === snakes[j].body[0].y) {
            deaths[i].body = true;
          }
        }
      }
    }

    const died = snakes.map((snake, i) => {
      if (!movingIndices.includes(i) || !snake.isAlive) return false;
      const death = deaths[i];
      if (!death.wall && !death.self && !death.body && !death.headOn) return false;
      snake.isAlive = false;
      snake.deathPosition = nextHeads[i];
      snake.deathReason = death.headOn ? 'HEAD_ON' : death.wall ? 'WALL' : death.self ? 'SELF' : 'OPPONENT';
      return true;
    });

    if (died.some(Boolean)) {
      events.deathOccurred = true;
    }

    const stepConsumedTokenIndices = new Set<number>();
    for (const i of movingIndices) {
      if (!snakes[i].isAlive) continue;
      const tokenIndex = state.tokens.findIndex(token => token.x === nextHeads[i].x && token.y === nextHeads[i].y);
      let ateThisStep = false;
      if (tokenIndex !== -1) {
        snakes[i].score += 1;
        ateThisStep = true;
        events.tokenEaten[snakes[i].id] = true;
        if (snakes[i].id === 'p1' && state.campaignObjectives) {
          state.campaignObjectives.p1TokensCollected += 1;
        }
        stepConsumedTokenIndices.add(tokenIndex);
      }
      snakes[i].body.unshift(nextHeads[i]);
      if (!ateThisStep) {
        snakes[i].body.pop();
      }
    }

    if (stepConsumedTokenIndices.size > 0) {
      totalTokensConsumedCount += stepConsumedTokenIndices.size;
      state.tokens = state.tokens.filter((_, index) => !stepConsumedTokenIndices.has(index));
    }
  }

  // Deduct skill costs at turn resolution time AFTER token pickups have been applied
  for (const snake of snakes) {
    if (activeDarts.has(snake.id)) {
      snake.score = Math.max(0, snake.score - SKILLS.dart.cost);
    }
  }

  recordSurviveResults(state);
  recordFirstToResults(state);

  if (events.deathOccurred) {
    const survivors = snakes.filter(snake => snake.isAlive);
    if (survivors.length <= 1) {
      events.matchEnded = true;
      state.phase = 'OVER';
      if (survivors.length === 1) {
        state.winner = survivors[0].id;
        const dead = snakes.find(snake => !snake.isAlive);
        if (snakes.length === 2 && dead) {
          const loserLabel = dead.id === 'p2' ? 'Player 2' : 'Player 1';
          state.winReason = `${loserLabel} crashed into ${dead.deathReason?.toLowerCase() || 'obstacle'}!`;
        } else {
          state.winReason = `${survivors[0].name} wins${dead?.deathReason ? ` — ${dead.deathReason.toLowerCase()}!` : '!'}`;
        }
      } else {
        const anyHeadOn = snakes.some(s => !s.isAlive && s.deathReason === 'HEAD_ON');
        resolveMatchByTiebreakers(state, anyHeadOn ? 'Mutual Head-On Collision!' : 'Simultaneous Crash!');
      }
      return { nextState: state, events };
    }
  }

  if (state.phase === 'RACING' && state.campaignTokenRules && totalTokensConsumedCount > 0) {
    const rules = state.campaignTokenRules;
    if (rules.respawn && rules.mode !== 'FIXED_SET') {
      const getRoundTokenCount = () =>
        rules.mode === 'ESCALATING' ? rules.count + state.round - 1 : rules.count;
      rules.tokensEatenInRound += totalTokensConsumedCount;
      while (rules.tokensEatenInRound >= getRoundTokenCount()) {
        rules.tokensEatenInRound -= getRoundTokenCount();
        state.round += 1;
      }
      const desiredCount = getRoundTokenCount();
      const replacementCount = Math.max(0, desiredCount - state.tokens.length);
      state.tokens.push(...spawnTokens(
        replacementCount,
        settings.gridSize,
        state.ringInset,
        snakes,
        state.tokens,
        state.walls,
      ));
    }
  }

  // 8. TOKEN SPAWNS (Only during Phase 1 Racing)
  if (state.phase === 'RACING' && state.tokens.length === 0) {
    if (state.campaignTokenRules) {
      const rules = state.campaignTokenRules;
      if (rules.mode === 'ESCALATING' && !rules.respawn) {
        state.round += 1;
        const desiredCount = rules.count + state.round - 1;
        const newTokens = spawnTokens(desiredCount, settings.gridSize, state.ringInset, snakes, [], state.walls);
        state.tokens.push(...newTokens);
      } else {
        state.phase = 'SHRINKING';
        if (settings.turnBased) {
          state.phaseTurnsRemaining = settings.shrinkEveryTurns;
          state.isTelegraphingShrink = false;
        } else {
          state.phaseTimeRemaining = 120 * 1000;
          state.phaseEndTime = Date.now() + 120 * 1000;
        }
      }
    } else {
      state.round += 1;
      const newTokens = spawnTokens(state.round, settings.gridSize, state.ringInset, snakes, [], state.walls);
      state.tokens.push(...newTokens);
    }
  }

  return { nextState: state, events };
}

function resolveMatchByTiebreakers(state: GameState, contextReason: string) {
  state.phase = 'OVER';
  const ranked = [...state.snakes].sort((a, b) => b.score - a.score || b.body.length - a.body.length);
  const winner = ranked[0];
  const tied = ranked.length > 1 && winner.score === ranked[1].score && winner.body.length === ranked[1].body.length;
  if (tied) {
    state.winner = 'DRAW';
    state.winReason = `${contextReason} — Dead heat draw (${winner.score} tokens, ${winner.body.length} length)!`;
  } else if (winner) {
    state.winner = winner.id;
    state.winReason = `${contextReason} — ${winner.name} wins on score (${winner.score} tokens, ${winner.body.length} length)!`;
  }
}
