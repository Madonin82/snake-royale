// FROZEN SNAPSHOT — pre-3a8ed4a bots, lifted verbatim from 611c236. Do not edit. Tuning happens on forks (new brains), never here.
// The code below is that commit's src/game/ai.ts in full (only import paths
// adjusted for this file's location). The AIBrain adapter at the bottom is
// the sole post-lift code: it reproduces the App.tsx planning drive from
// the same commit. Golden-master fixtures live in ../legacy.test.ts.
import { BufferEntry, Direction, GameState, PendingSkill, Position, Snake } from '../../../types/game';
import { AIBrain, BrainProfile } from '../types';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../../engine';
import { canActivateSkill, canAffordQueuedDart, isValidDartDirection } from '../../skills';

const ALL_DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

const posKey = (p: Position): string => `${p.x},${p.y}`;

function sameTeam(a: Snake, b: Snake): boolean {
  return Boolean(a.teamId && b.teamId && a.teamId === b.teamId);
}

/** Standard tiebreak: skill points, then length. Returns the winner, or null on a draw. */
function tiebreakWinner(a: Snake, b: Snake): Snake | null {
  const aPts = a.skillPoints ?? 0;
  const bPts = b.skillPoints ?? 0;
  if (aPts !== bPts) return aPts > bPts ? a : b;
  if (a.body.length !== b.body.length) return a.body.length > b.body.length ? a : b;
  return null;
}

/** True if `me` would win a mutual-kill tiebreak against `opponent` outright. */
function winsTiebreak(me: Snake, opponent: Snake): boolean {
  return tiebreakWinner(me, opponent) === me;
}

/**
 * Snipe lethality: strictly ahead on BOTH skill points and length. Same bar
 * as a player-vs-player snipe — no boss exceptions. (Stricter than the
 * mutual-kill tiebreak, which is points-then-length.)
 */
function snipeIsLethal(me: Snake, opponent: Snake): boolean {
  const myPts = me.skillPoints ?? 0;
  const oppPts = opponent.skillPoints ?? 0;
  return myPts > oppPts && me.body.length > opponent.body.length;
}

/**
 * Conservative growth check: if any token sits on a cell the opponent's head
 * can reach next tick, assume they might eat — in which case their tail does
 * NOT vacate. (Their queue is hidden, so we can't know for sure.)
 */
function opponentMayGrow(opponent: Snake, tokens: Position[]): boolean {
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
function getOpponentBodyThreat(opponent: Snake, tokens: Position[]): Set<string> {
  const threat = new Set<string>();
  const body = opponent.isAlive && !opponentMayGrow(opponent, tokens)
    ? opponent.body.slice(0, -1)
    : opponent.body;
  for (const seg of body) threat.add(posKey(seg));
  return threat;
}

export interface AIActionResult {
  direction: Direction | null;
  skill?: PendingSkill | null;
}

export function calculateAIAction(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  skillsAvailable?: GameState['skillsAvailable'],
): AIActionResult {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return { direction: null, skill: null };

  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    return calculateAvalenaAction(gameState, gridSize, botRole, skillsAvailable ?? gameState.skillsAvailable);
  }

  return {
    direction: calculateAIMove(gameState, gridSize, botRole, difficulty, aiStyle),
    skill: null,
  };
}

function calculateAvalenaAction(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  skillsAvailable?: GameState['skillsAvailable'],
): AIActionResult {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return { direction: null, skill: null };

  const player = gameState.snakes.find(snake => snake.id === 'p1' && !sameTeam(me, snake)) ??
    gameState.snakes.find(snake => snake.id !== botRole && snake.isAlive && !sameTeam(me, snake)) ??
    gameState.snakes.find(snake => snake.id !== botRole && !sameTeam(me, snake));

  // Hunt trigger reads the skill wallet, not tokens: her design is farm → hunt →
  // farm, and the return trip only happens if darting drops her back under the
  // +3 threshold. (Tokens are immutable, so a token-based trigger would hunt
  // forever once ahead.)
  const playerPoints = player?.skillPoints ?? 0;
  const inHuntPhase = Boolean(player && player.isAlive && (me.skillPoints ?? 0) >= playerPoints + 3);

  if (inHuntPhase && player) {
    const playerHead = player.body[0];
    const currentFacing = me.direction;
    const validDartDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentFacing, d));

    // Check if in dart range and dart is unlocked & affordable
    if (canActivateSkill(me, gameState, skillsAvailable)) {
      let inRange = false;
      const dartCandidates: { dir: Direction; endDist: number; minDist: number; safe: boolean; snipeHits: number }[] = [];
      // Threat cells are computed once: the dart's later cells land after the
      // opponent's sub-step-0 move, so safety is evaluated against reachability.
      // Snipe-aware: when we win the tiebreak, the opponent's reachable cells
      // are kill opportunities (snipeTargets), not threats.
      const { threat: threatCells, snipeTargets } = getOpponentThreatCells(gameState, botRole, gridSize, me);

      for (const dartDir of validDartDirs) {
        // The engine moves all 3 dart cells in the dart direction (it sets the
        // heading to dartDir at step 0) — evaluate the actual path, not the
        // first cell in the current facing.
        const step1Pos = getNextHeadPosition(me.body[0], dartDir);
        const step2Pos = getNextHeadPosition(step1Pos, dartDir);
        const step3Pos = getNextHeadPosition(step2Pos, dartDir);
        const d1 = Math.abs(step1Pos.x - playerHead.x) + Math.abs(step1Pos.y - playerHead.y);
        const d2 = Math.abs(step2Pos.x - playerHead.x) + Math.abs(step2Pos.y - playerHead.y);
        const d3 = Math.abs(step3Pos.x - playerHead.x) + Math.abs(step3Pos.y - playerHead.y);
        const minDist = Math.min(d1, d2, d3);
        const endDist = d3;

        // "In range" means the player's head is reachable within the dart's total 3-cell movement
        // in one of the three directions (or within 3 cells along the dart trajectory).
        if (minDist === 0 || (Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y) <= 3 && endDist < Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y))) {
          inRange = true;
        }

        const safe =
          isDartCellSafe(step1Pos, me.body, gameState, gridSize, threatCells) &&
          isDartCellSafe(step2Pos, [step1Pos, ...me.body.slice(0, -1)], gameState, gridSize, threatCells) &&
          isDartCellSafe(step3Pos, [step2Pos, step1Pos, ...me.body.slice(0, -2)], gameState, gridSize, threatCells);

        // Snipe chances: path cells overlapping the opponent's reachable set.
        // When lethal, these are free lottery tickets — safe either way, and a
        // hit kills the opponent outright.
        const snipeHits = [step1Pos, step2Pos, step3Pos]
          .filter(p => snipeTargets.has(posKey(p))).length;

        dartCandidates.push({ dir: dartDir, endDist, minDist, safe, snipeHits });
      }

      if (inRange) {
        // Safety first: a dart that kills the darter is never the answer.
        // Then snipe chances (lethal when we hold the tiebreak), then closest
        // landing to the player's head.
        dartCandidates.sort((a, b) => {
          if (a.safe !== b.safe) return a.safe ? -1 : 1;
          if (a.snipeHits !== b.snipeHits) return b.snipeHits - a.snipeHits;
          if (a.endDist !== b.endDist) return a.endDist - b.endDist;
          if (a.minDist !== b.minDist) return a.minDist - b.minDist;
          return 0;
        });
        const bestDart = dartCandidates[0];
        // Safety gates the shot: no safe dart → no dart. Falls through to
        // the hunt move below instead of suiciding.
        if (bestDart && bestDart.safe) {
          return {
            direction: bestDart.dir,
            skill: {
              skillId: 'dart',
              direction: bestDart.dir,
            },
          };
        }
      }
    }

    // Not in dart range (or skill locked): path toward the player's head
    const huntDir = calculateHuntMoveTowardTarget(gameState, gridSize, botRole, playerHead);
    return { direction: huntDir, skill: null };
  }

  // Farm phase: greedy token seeking (use existing greedy logic)
  return {
    direction: calculateAIMove(gameState, gridSize, botRole, 'HARD', 'GREEDY'),
    skill: null,
  };
}

function isDartCellSafe(
  pos: Position,
  ownBody: Position[],
  state: GameState,
  gridSize: number,
  threatCells: Set<string>,
): boolean {
  if (!isCellInArena(pos, gridSize, state.ringInset)) return false;
  if (state.walls?.some(wall => wall.x === pos.x && wall.y === pos.y)) return false;
  if (ownBody.slice(0, -1).some(seg => seg.x === pos.x && seg.y === pos.y)) return false;
  // No head-cell exception: a dart landing on a stationary head is lethal for
  // the darter UNLESS the snipe rule applies (darter wins the tiebreak) — the
  // threat set passed in already accounts for that.
  if (threatCells.has(`${pos.x},${pos.y}`)) return false;
  return true;
}

// Cells the opponents threaten for a DART: their current bodies (growth-aware —
// the tail only vacates if they aren't about to eat) PLUS every cell their
// heads can reach on sub-step 0. The dart's cells 2-3 land after the opponent
// has moved, so the brain must evaluate the dart against where the opponent
// CAN be, not where they are. (The queue is hidden — reachability is the only
// honest model.)
//
// SNIPE: when we win the points-then-length tiebreak against an opponent, the
// snipe rule makes their reachable cells kill opportunities, not threats —
// they're returned separately as snipeTargets. Their current head cell stays a
// threat (it becomes neck on sub-step 0).
function getOpponentThreatCells(
  gameState: GameState,
  botRole: string,
  gridSize: number,
  me: Snake,
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

function calculateHuntMoveTowardTarget(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  targetPos: Position,
): Direction | null {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return null;
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole && !sameTeam(me, snake));
  const head = me.body[0];
  const currentDir = me.direction;
  const validDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentDir, d));

  const ratedMoves: { dir: Direction; score: number }[] = [];

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) continue;
    if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) continue;
    if (me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y)) continue;
    // Opponent bodies are checked pre-move by the engine, so the head cell
    // counts too — and the tail only vacates if they aren't about to grow.
    const hitsOpponentBody = opponents.some(opponent =>
      getOpponentBodyThreat(opponent, gameState.tokens).has(posKey(nextPos)),
    );
    if (hitsOpponentBody) continue;

    const area = floodFillArea(nextPos, gameState, gridSize, me);
    if (area < me.body.length) continue;

    const dist = Math.abs(nextPos.x - targetPos.x) + Math.abs(nextPos.y - targetPos.y);
    let score = (gridSize * 2 - dist) * 20;
    score += area * 1;
    if (dir === currentDir) score += 2;
    ratedMoves.push({ dir, score });
  }

  if (ratedMoves.length === 0) {
    return validDirs[0] || currentDir;
  }
  ratedMoves.sort((a, b) => b.score - a.score);
  return ratedMoves[0].dir;
}

export function calculateAIMove(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
): Direction | null {
  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    const action = calculateAvalenaAction(gameState, gridSize, botRole, gameState.skillsAvailable);
    if (action.skill) {
      const me = gameState.snakes.find(snake => snake.id === botRole);
      if (me) me.pendingSkill = action.skill;
    }
    return action.direction;
  }
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me) return null;
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole && !sameTeam(me, snake));
  const teammates = gameState.teamProtection ? gameState.snakes.filter(snake => snake.id !== botRole && sameTeam(me, snake)) : [];
  const livingOpponents = opponents.filter(snake => snake.isAlive);

  if (!me.isAlive) return null;

  const head = me.body[0];
  const currentDir = me.direction;

  // Filter out immediate suicide moves (180 degree turns)
  const validDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentDir, d));

  // Rate each direction
  const ratedMoves: { dir: Direction; score: number }[] = [];

  for (const dir of validDirs) {
    const nextPos = getNextHeadPosition(head, dir);
    let score = 0;

    // 1. HARD RULE: Avoid Walls / Shrink Ring
    if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) {
      continue; // Instant death
    }
    if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) {
      continue;
    }

    // 2. HARD RULE: Avoid Own Body (except the tail if we don't eat)
    const hitsSelf = me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y);
    if (hitsSelf) {
      continue;
    }

    // 3. HARD RULE: Avoid Opponent Body (pre-move bodies; tail only vacates
    // if they aren't about to grow)
    const hitsOpponentBody = opponents.some(opponent =>
      getOpponentBodyThreat(opponent, gameState.tokens).has(posKey(nextPos)),
    );
    if (hitsOpponentBody) {
      continue;
    }

    // 3b. HARD RULE: Avoid Teammate Body
    const hitsTeammateBody = teammates.some(teammate =>
      getOpponentBodyThreat(teammate, gameState.tokens).has(posKey(nextPos)),
    );
    if (hitsTeammateBody) {
      continue;
    }

    // 3c. HARD RULE / DEAD-END VETO: skip if reachable area < body length
    const area = floodFillArea(nextPos, gameState, gridSize, me);
    if (area < me.body.length) {
      continue;
    }

    // 4. Opponent Head Proximity / Head-on hazard
    // A head-on happens when both heads enter the same cell on the same
    // sub-step — i.e. my destination is in the opponent's reachable set
    // (their head's valid next cells; the queue is hidden). If I'd lose the
    // mutual-kill tiebreak, that move is vetoed, not nudged: no token is
    // worth a losing trade. (The -10000 keeps the doomed-anyway fallback
    // working: if every move is vetoed, the least-bad still gets picked.)
    let headOnPenalty = 0;
    let twoTickPenalty = 0;
    for (const opponent of livingOpponents) {
      const oppHead = opponent.body[0];
      const inReach = ALL_DIRECTIONS
        .filter(d => !isOppositeDirection(opponent.direction, d))
        .some(d => {
          const c = getNextHeadPosition(oppHead, d);
          return c.x === nextPos.x && c.y === nextPos.y;
        });
      const iWinTrade = winsTiebreak(me, opponent);
      if (inReach) {
        // Post-split, the trade is decided by the POINTS tiebreak (then length).
        if (difficulty === 'EASY') {
          headOnPenalty = Math.max(headOnPenalty, 5);
        } else if (difficulty === 'MEDIUM') {
          headOnPenalty = Math.max(headOnPenalty, 15);
        } else {
          headOnPenalty = Math.max(headOnPenalty, iWinTrade ? 10 : 10000);
        }
      } else {
        // 2-tick projection: Manhattan distance <= 2 from current head position
        const manDist = Math.abs(nextPos.x - oppHead.x) + Math.abs(nextPos.y - oppHead.y);
        if (manDist <= 2) {
          let baseNudge = 0;
          if (difficulty === 'MEDIUM') baseNudge = 8;
          else if (difficulty === 'HARD') baseNudge = 25;
          if (iWinTrade) baseNudge = Math.floor(baseNudge / 2);
          twoTickPenalty = Math.max(twoTickPenalty, baseNudge);
        }
      }
    }
    score -= (headOnPenalty + twoTickPenalty);

    // 4b. Multiplayer Head Proximity / Spacing Penalty (prevent clumping and mutual crashes in 3-4 player games)
    let proximityPenalty = 0;
    if (gameState.snakes.length > 2) {
      for (const opponent of livingOpponents) {
        const oppHead = opponent.body[0];
        const distToOppHead = Math.abs(nextPos.x - oppHead.x) + Math.abs(nextPos.y - oppHead.y);
        if (distToOppHead === 1) {
          proximityPenalty += 600;
        } else if (distToOppHead === 2) {
          proximityPenalty += 180;
        } else if (distToOppHead === 3) {
          proximityPenalty += 40;
        }
      }
    }
    score -= proximityPenalty;

    // 5. Token Seeking (Manhattan Distance to nearest token)
    if (gameState.tokens.length > 0) {
      // Chain bonus: the next token eaten this lock pays tsl+1 SP (engine.ts).
      // Multiply the token score so the bot WANTS the next token in a chain.
      // Caps are tuning knobs — the bot must not imitate the greediest human
      // 5-chains that end in a crash.
      const tsl = me.tokensSinceLock ?? 0;
      const chainMult = difficulty === 'EASY' ? 1
        : difficulty === 'MEDIUM' ? Math.min(tsl + 1, 2)
        : Math.min(tsl + 1, 3);
      let bestTokenScore = 0;
      for (const token of gameState.tokens) {
        const d = Math.abs(nextPos.x - token.x) + Math.abs(nextPos.y - token.y);
        // Don't race for lost tokens: if a living opponent's head is strictly
        // closer to this token than I am after this move, they'll get there
        // first — heavily discount it instead of dying for it.
        const contested = livingOpponents.some(opponent => {
          const oppDist = Math.abs(opponent.body[0].x - token.x) + Math.abs(opponent.body[0].y - token.y);
          return oppDist <= d;
        });
        const tokenScore = (gridSize * 2 - d) * 10 * (contested ? 0.15 : 1) * chainMult;
        if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
      }
      score += bestTokenScore;
    } else {
      // In shrink phase with no tokens, seek center of arena
      const center = (gridSize - 1) / 2;
      const distToCenter = Math.abs(nextPos.x - center) + Math.abs(nextPos.y - center);
      score += (gridSize - distToCenter) * 8;
    }

    // 6. Lookahead reachable area heuristic (for Medium and Hard)
    if (difficulty !== 'EASY') {
      score += area * 1;
    }

    // Small inertia preference (avoid erratic zigzagging if scores are tied)
    if (dir === currentDir) {
      score += 2;
    }

    ratedMoves.push({ dir, score });
  }

  if (ratedMoves.length === 0) {
    // Trapped: all moves vetoed. Don't return validDirs[0] blind — that's
    // 'UP' by list order, which can be an instant wall crash. Exclude
    // certain-death moves (wall, own body) and pick the largest surviving
    // flood area. Opponent-body cells are NOT excluded — they can be
    // winning trades, not certain death. If every dir is certain death,
    // keep the old behavior (truly doomed, just don't crash).
    let bestDir: Direction | null = null;
    let bestArea = -1;
    for (const dir of validDirs) {
      const nextPos = getNextHeadPosition(head, dir);
      if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) continue;
      if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) continue;
      if (me.body.slice(0, -1).some(s => s.x === nextPos.x && s.y === nextPos.y)) continue;
      const area = floodFillArea(nextPos, gameState, gridSize, me);
      if (area > bestArea) {
        bestArea = area;
        bestDir = dir;
      }
    }
    return bestDir ?? validDirs[0] ?? currentDir;
  }

  // Sort descending by score
  ratedMoves.sort((a, b) => b.score - a.score);

  // For Easy AI, introduce occasional randomness (sparring partner)
  if (difficulty === 'EASY' && Math.random() < 0.25 && ratedMoves.length > 1) {
    return ratedMoves[1].dir;
  }

  return ratedMoves[0].dir;
}

function floodFillArea(pos: Position, state: GameState, gridSize: number, me: Snake): number {
  const visited = new Set<string>();
  const queue: Position[] = [pos];
  visited.add(posKey(pos));

  const eatsToken = state.tokens.some(t => t.x === pos.x && t.y === pos.y);
  const ownBody = eatsToken ? me.body : me.body.slice(0, -1);

  const blocked = new Set<string>();
  for (const seg of ownBody) {
    blocked.add(posKey(seg));
  }

  for (const snake of state.snakes) {
    if (snake.id === me.id) continue;
    for (const key of getOpponentBodyThreat(snake, state.tokens)) {
      blocked.add(key);
    }
  }

  if (state.walls) {
    for (const wall of state.walls) {
      blocked.add(posKey(wall));
    }
  }

  let count = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    count++;

    for (const d of ALL_DIRECTIONS) {
      const next = getNextHeadPosition(curr, d);
      const key = posKey(next);
      if (!visited.has(key)) {
        if (isCellInArena(next, gridSize, state.ringInset) && !blocked.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
  }

  return count;
}

// ─── AIBrain adapter (the only post-lift code in this file) ────────────────
// The lifted functions above ARE the brain. plan() reproduces, step for step,
// the drive loop App.tsx used at 611c236: replan from the live board into a
// hidden plan of up to min(3, body length) entries, advancing a simulated
// body per ply, then apply that era's dynamic lock rule (lock the whole plan
// unless the cell after move 0 has ≤1 safe escape, in which case lock 1; a
// leading dart always locks as a single committed entry). action() is the
// lifted calculateAIAction with the generic (non-Avalena) style path.

export const LEGACY_PROFILE: BrainProfile = {
  // INERT — present only because the AIBrain contract requires a profile
  // object. Nothing in this file reads it: legacy behaviour is the lifted
  // code above, which predates the profile system entirely.
  planner: 'greedy',
  enableIntent: false,
  chainSpWeight: 0,
  headOnWinBonus: 0,
  inSimHeadOnLoss: 0,
  intentCashBonus: 0,
  intentStepBonus: 0,
  setupValueDiscount: 0,
  protectAreaPenalty: 0,
  protectContestPenalty: 0,
  maxSimDepth: 0,
  beamCandidates: 0,
  threatNudge: { EASY: 0, MEDIUM: 0, HARD: 0 },
  chainCap: { EASY: 0, MEDIUM: 0, HARD: 0 },
  easyRandomSecondPick: 0,
};

export const legacyBrain: AIBrain = {
  id: 'legacy',
  label: 'Legacy Bot',
  profile: LEGACY_PROFILE,
  plan: (args) => {
    const { gameState, gridSize, botRole, difficulty } = args;
    const me = gameState.snakes.find(snake => snake.id === botRole);
    if (!me || !me.isAlive) {
      return { plan: [], lockCount: 0, projections: [], intent: null, posture: null };
    }

    const hiddenPlan: BufferEntry[] = [];
    let curDir = me.direction;
    let simBody = [...me.body];
    const planLen = Math.min(3, me.body.length);
    for (let i = 0; i < planLen; i++) {
      const simState: GameState = {
        ...gameState,
        snakes: gameState.snakes.map(snake => snake.id === botRole
          ? { ...snake, body: simBody, direction: curDir }
          : snake),
      };
      const action = calculateAIAction(simState, gridSize, botRole, difficulty, undefined, args.skillsAvailable);
      // Skill path: the brain may decide to dart. Same legality rules as the
      // player (direction validated against the last entry, escrow
      // affordability) before a dart entry goes in the plan.
      const skillDir = action.skill?.skillId === 'dart' ? action.skill.direction : null;
      const queuedDarts = hiddenPlan.filter(entry => entry.type === 'dart').length;
      if (skillDir && isValidDartDirection(curDir, skillDir) &&
          canAffordQueuedDart(me.skillPoints, queuedDarts)) {
        hiddenPlan.push({ type: 'dart', direction: skillDir });
        curDir = skillDir;
        for (let k = 0; k < 3; k++) {
          simBody.unshift(getNextHeadPosition(simBody[0], skillDir));
          simBody.pop();
        }
        continue;
      }
      const aiDir = action.direction;
      if (aiDir && !isOppositeDirection(curDir, aiDir)) {
        hiddenPlan.push({ type: 'move', direction: aiDir });
        curDir = aiDir;
        const nextHead = getNextHeadPosition(simBody[0], aiDir);
        simBody.unshift(nextHead);
        simBody.pop();
      } else {
        break;
      }
    }
    if (hiddenPlan.length === 0) {
      const fallback = (['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[])
        .find(d => !isOppositeDirection(curDir, d)) ?? 'LEFT';
      hiddenPlan.push({ type: 'move', direction: fallback });
    }

    // Dynamic lock: how much of the hidden plan to commit visibly. If the
    // destination after move 0 is tight (<=1 safe escape), lock just 1 and
    // reassess next tick. In open space, lock the full plan. A dart always
    // locks as a single committed entry.
    let lockCount = hiddenPlan.length;
    const firstEntry = hiddenPlan[0];
    const firstIsDart = firstEntry.type === 'dart';
    if (!firstIsDart && hiddenPlan.length > 1) {
      // Simulate the board after move 0 to count escape routes.
      const afterMove0 = [...me.body];
      const firstDir = firstEntry.direction;
      const dest = getNextHeadPosition(afterMove0[0], firstDir);
      afterMove0.unshift(dest);
      afterMove0.pop();
      const allBodies = new Set<string>();
      for (const snake of gameState.snakes) {
        const body = snake.id === botRole ? afterMove0 : snake.body;
        for (const seg of body) allBodies.add(`${seg.x},${seg.y}`);
      }
      let safeEscapes = 0;
      for (const d of ['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[]) {
        if (isOppositeDirection(firstDir, d)) continue;
        const n = getNextHeadPosition(dest, d);
        if (isCellInArena(n, gridSize, gameState.ringInset) && !allBodies.has(`${n.x},${n.y}`)) {
          safeEscapes++;
        }
      }
      if (safeEscapes <= 1) lockCount = 1;
    }

    return { plan: hiddenPlan, lockCount, projections: [], intent: null, posture: null };
  },
  action: (args) => calculateAIAction(
    args.gameState,
    args.gridSize,
    args.botRole,
    args.difficulty ?? 'MEDIUM',
    undefined,
    args.skillsAvailable,
  ),
};
