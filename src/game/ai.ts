import { BufferEntry, Direction, GameState, PendingSkill, Position, Snake } from '../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from './engine';
import { canActivateSkill, canAffordQueuedDart, isValidDartDirection } from './skills';

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


/**
 * The §1–§5 rating pass of calculateAIMove, extracted so the turn planner
 * can see the ranked candidate moves instead of only the single pick.
 * Hard-vetoed directions (certain death) never appear in ratedMoves;
 * heavily penalized ones (e.g. a losing head-on at −10000) do.
 */
interface RatedAIMoves {
  ratedMoves: { dir: Direction; score: number }[];
  validDirs: Direction[];
  me: Snake;
}

function rateAIMoves(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  difficulty: 'EASY' | 'MEDIUM' | 'HARD',
): RatedAIMoves | null {
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
  return { ratedMoves, validDirs, me };
}

/**
 * Ranked non-vetoed moves for a snake, best first. No EASY randomness and
 * no trapped fallback — callers planning ahead want the raw ratings.
 */
export function calculateAIMoveCandidates(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
): { dir: Direction; score: number }[] {
  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    const action = calculateAvalenaAction(gameState, gridSize, botRole, gameState.skillsAvailable);
    return action.direction ? [{ dir: action.direction, score: 0 }] : [];
  }
  const rated = rateAIMoves(gameState, gridSize, botRole, difficulty);
  if (!rated) return [];
  return [...rated.ratedMoves].sort((a, b) => b.score - a.score);
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
  const rated = rateAIMoves(gameState, gridSize, botRole, difficulty);
  if (!rated) return null;
  const { ratedMoves, validDirs, me } = rated;
  const head = me.body[0];
  const currentDir = me.direction;

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

// ============================================================
// Turn planner (bot-balance spec, Oct 20 2026 — Changes 1, 2, 4, 5)
// Base: origin/main @ 611c236.
//
// Change 1 — the planning simulation advances EVERY living snake per
//   ply. Opponents advance along their own scorer's choice on the
//   simulated state (an SP-seeking model: every player in this game is
//   playing to maximize SP, so the honest projection has them diving
//   for tokens, not walking in a straight line). Tokens eaten in-sim
//   are removed and the eater grows — including the bot, whose body
//   no longer pops unconditionally.
// Change 2 — the plan records the projected opponent bodies after
//   every entry; App.tsx compares the live board against the
//   projection for the plies already executed (planDiverged below)
//   and drops the remainder + replans when the world has diverged.
//   Divergence is the normal state of a real match, not an edge case.
// Change 4 — routes are scored as routes: the escalated SP of tokens
//   eaten along the route counts at full chain value, and on HARD a
//   chain setup is held across locks (chain intent): position now,
//   cash next lock. Chains are the high-end goal — in puzzle-fighter
//   terms the built chain is the attack; here SP is literally skill
//   ammunition. Vetoes still gate every ply: a chain that kills the
//   builder is not an attack.
// Change 5 — posture: Protect (ahead, late) demands an exit margin
//   and only contests tokens on a clear win; Chase (behind, late)
//   contests on even math. Posture gates never override the vetoes.
// ============================================================

const CHAIN_SP_WEIGHT = 10; // route value per point of escalated chain SP
const HEAD_ON_WIN_BONUS = 300; // an in-sim head-on the bot wins ends the game
const IN_SIM_HEAD_ON_LOSS = -10000; // an in-sim head-on the bot loses (or ties)
const INTENT_CASH_BONUS = 30; // cashing a token of the active chain setup
const INTENT_STEP_BONUS = 5; // per ply that closes on the setup anchor
const SETUP_VALUE_DISCOUNT = 0.5; // a setup is a promise, not SP in hand
const PROTECT_AREA_PENALTY = 400; // route ends boxed while protecting a lead
const PROTECT_CONTEST_PENALTY = 150; // contested token eaten without a clear win
const MAX_SIM_DEPTH = 3;

export interface ChainIntent {
  tokenKeys: string[]; // the cluster's token cells ("x,y")
  anchor: Position; // cluster centroid
  createdTick: number;
  locksWithoutProgress: number;
  lastDistance: number; // my head's Manhattan distance to the anchor
}

export interface AIPlanResult {
  plan: BufferEntry[];
  lockCount: number;
  /** Projected opponent bodies after each plan entry (index = entry). */
  projections: Record<string, Position[]>[];
  intent: ChainIntent | null;
  posture: 'PROTECT' | 'CHASE' | null;
}

interface SimSnake {
  id: string;
  body: Position[];
  direction: Direction;
  tokensSinceLock: number;
  skillPoints: number;
  isAlive: boolean;
  stunTicks: number;
}

interface SimState {
  snakes: SimSnake[];
  tokens: Position[];
}

/** A full GameState view of a simulated position, for the scorer. */
function simToGameState(base: GameState, sim: SimState): GameState {
  const byId = new Map(sim.snakes.map(s => [s.id, s]));
  return {
    ...base,
    tokens: sim.tokens.map(t => ({ ...t })),
    snakes: base.snakes.map(s => {
      const simSnake = byId.get(s.id);
      if (!simSnake) return s;
      return {
        ...s,
        body: simSnake.body.map(c => ({ ...c })),
        direction: simSnake.direction,
        tokensSinceLock: simSnake.tokensSinceLock,
        isAlive: simSnake.isAlive,
      };
    }),
  };
}

function initialSim(gameState: GameState): SimState {
  return {
    tokens: gameState.tokens.map(t => ({ ...t })),
    snakes: gameState.snakes.map(s => ({
      id: s.id,
      body: s.body.map(c => ({ ...c })),
      direction: s.direction,
      tokensSinceLock: s.tokensSinceLock ?? 0,
      skillPoints: s.skillPoints ?? 0,
      isAlive: s.isAlive,
      stunTicks: s.stunTicks ?? 0,
    })),
  };
}

interface AdvanceOutcome {
  sim: SimState;
  /** Escalated SP the bot earned this ply (null if it ate nothing). */
  botAteSP: number | null;
  /** The token cell the bot ate this ply, if any. */
  botAteCell: Position | null;
  /** Opponent bodies after this ply (Change 2 projections). */
  opponentBodies: Record<string, Position[]>;
  /**
   * The bot's head landed on an opponent's head this ply: 'WIN' if the
   * standard tiebreak (SP, then length) favors the bot, else 'LOSS'
   * (an exact tie kills both in the real engine). Nobody dies in-sim —
   * the projection stays a body forecast, and Change 2 catches the
   * difference — but route scoring prices the outcome.
   */
  botHeadOn: 'WIN' | 'LOSS' | null;
}

/**
 * Advance every living snake one ply from the same snapshot (the real
 * game moves simultaneously). Opponent moves come from their own
 * scorer on the pre-move state, modeled at HARD — the strongest
 * SP-seeking line we have, whoever the opponent really is. The
 * projection is an expectation, not knowledge; Change 2 is the net
 * for when it is wrong. A token landed on by exactly one head is
 * eaten (grow, no tail pop); a token two heads land on goes to the
 * head-on tiebreak winner, as the engine rules it.
 */
function advanceSim(
  base: GameState,
  sim: SimState,
  gridSize: number,
  botRole: string,
  botDir: Direction,
): AdvanceOutcome {
  const view = simToGameState(base, sim);
  const moves = new Map<string, Direction>();
  moves.set(botRole, botDir);
  for (const s of sim.snakes) {
    if (s.id === botRole || !s.isAlive || s.stunTicks > 0) continue;
    const dir = calculateAIMove(view, gridSize, s.id, 'HARD');
    if (dir) moves.set(s.id, dir);
  }

  const tokenAt = new Map<string, Position>();
  for (const t of sim.tokens) tokenAt.set(posKey(t), t);
  const eatRequests = new Map<string, string[]>(); // tokenKey -> snake ids
  const newHeads = new Map<string, Position>();
  for (const s of sim.snakes) {
    if (!s.isAlive) continue;
    const dir = moves.get(s.id);
    if (!dir || s.stunTicks > 0) {
      newHeads.set(s.id, s.body[0]);
      continue;
    }
    const nh = getNextHeadPosition(s.body[0], dir);
    newHeads.set(s.id, nh);
    const key = posKey(nh);
    if (tokenAt.has(key)) {
      const list = eatRequests.get(key) ?? [];
      list.push(s.id);
      eatRequests.set(key, list);
    }
  }
  // Head-on cells and token claims: when exactly two opponents land
  // on the same cell, the engine resolves it by tiebreak — the winner
  // takes any token there. (Three or more heads: nobody eats; chaos
  // is priced as a loss for the bot below, never modeled as a meal.)
  const tiebreakBetween = (a: SimSnake, b: SimSnake): SimSnake | null => {
    if (a.skillPoints !== b.skillPoints) return a.skillPoints > b.skillPoints ? a : b;
    if (a.body.length !== b.body.length) return a.body.length > b.body.length ? a : b;
    return null;
  };
  const simById = new Map(sim.snakes.map(s => [s.id, s]));
  const eaters = new Map<string, string>(); // snakeId -> tokenKey
  for (const [key, ids] of eatRequests) {
    if (ids.length === 1) {
      eaters.set(ids[0], key);
    } else if (ids.length === 2) {
      const a = simById.get(ids[0])!;
      const b = simById.get(ids[1])!;
      const winner = tiebreakBetween(a, b);
      if (winner) eaters.set(winner.id, key);
    }
  }

  // The bot's own head-on outcome this ply (for route pricing).
  let botHeadOn: 'WIN' | 'LOSS' | null = null;
  const botNewHead = newHeads.get(botRole);
  if (botNewHead) {
    const rivals = sim.snakes.filter(s =>
      s.id !== botRole && s.isAlive && newHeads.get(s.id) &&
      newHeads.get(s.id)!.x === botNewHead.x && newHeads.get(s.id)!.y === botNewHead.y);
    if (rivals.length === 1) {
      const botSim = simById.get(botRole)!;
      botHeadOn = tiebreakBetween(botSim, rivals[0])?.id === botRole ? 'WIN' : 'LOSS';
    } else if (rivals.length > 1) {
      botHeadOn = 'LOSS';
    }
  }

  let botAteSP: number | null = null;
  let botAteCell: Position | null = null;
  const eatenKeys = new Set<string>();
  const nextSnakes: SimSnake[] = sim.snakes.map(s => {
    if (!s.isAlive) return s;
    const dir = moves.get(s.id);
    if (!dir || s.stunTicks > 0) {
      return { ...s, stunTicks: Math.max(0, s.stunTicks - 1) };
    }
    const nh = newHeads.get(s.id)!;
    const body = [nh, ...s.body];
    const ateKey = eaters.get(s.id);
    let tsl = s.tokensSinceLock;
    let sp = s.skillPoints;
    if (ateKey) {
      eatenKeys.add(ateKey);
      tsl += 1;
      sp += 1; // wallet: +1 per token; the escalated chain bonus lands at lock
      if (s.id === botRole) {
        botAteSP = tsl; // escalated: the n-th chain token pays n SP
        botAteCell = tokenAt.get(ateKey) ?? null;
      }
    } else {
      body.pop();
    }
    return { ...s, body, direction: dir, tokensSinceLock: tsl, skillPoints: sp };
  });

  const opponentBodies: Record<string, Position[]> = {};
  for (const s of nextSnakes) {
    if (s.id !== botRole && s.isAlive) {
      opponentBodies[s.id] = s.body.map(c => ({ ...c }));
    }
  }
  return {
    sim: {
      snakes: nextSnakes,
      tokens: sim.tokens.filter(t => !eatenKeys.has(posKey(t))),
    },
    botAteSP,
    botAteCell,
    opponentBodies,
    botHeadOn,
  };
}

/**
 * Change 2 check: has the world diverged from what the plan projected?
 * Compares each projected snake's live body against the projection for
 * the plies already executed. A projected snake that has since died is
 * a divergence — the plan was built for a world that had them in it.
 */
export function planDiverged(
  projections: Record<string, Position[]>[],
  executedCount: number,
  actualSnakes: Snake[],
): boolean {
  if (executedCount <= 0) return false;
  const proj = projections[executedCount - 1];
  if (!proj) return false;
  for (const [id, body] of Object.entries(proj)) {
    const actual = actualSnakes.find(s => s.id === id);
    if (!actual || !actual.isAlive) return true;
    if (actual.body.length !== body.length) return true;
    for (let i = 0; i < body.length; i++) {
      if (actual.body[i].x !== body[i].x || actual.body[i].y !== body[i].y) return true;
    }
  }
  return false;
}

/** Token clusters: tokens linked within Manhattan 3 form one cluster. */
function findClusters(tokens: Position[]): Position[][] {
  const remaining = [...tokens];
  const clusters: Position[][] = [];
  while (remaining.length > 0) {
    const cluster = [remaining.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (cluster.some(c => Math.abs(c.x - remaining[i].x) + Math.abs(c.y - remaining[i].y) <= 3)) {
          cluster.push(remaining.splice(i, 1)[0]);
          grew = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** Escalated SP of eating `size` tokens in a row starting at chain depth startTsl. */
function clusterChainValue(size: number, startTsl: number): number {
  let total = 0;
  for (let i = 1; i <= size; i++) total += startTsl + i;
  return total;
}

interface PostureInfo {
  posture: 'PROTECT' | 'CHASE' | null;
  clearWin: boolean;
}

function computePosture(gameState: GameState, me: Snake, raceTurns: number): PostureInfo {
  const opponents = gameState.snakes.filter(s => s.id !== me.id && s.isAlive && !sameTeam(me, s));
  if (opponents.length === 0) return { posture: null, clearWin: false };
  const bestScore = Math.max(...opponents.map(o => o.score));
  const bestLength = Math.max(...opponents.map(o => o.body.length));
  const turnsGone = raceTurns - gameState.phaseTurnsRemaining;
  const late =
    gameState.phase === 'SHRINKING' ||
    gameState.ringInset > 0 ||
    (gameState.phase === 'RACING' && turnsGone >= (raceTurns * 2) / 3);
  if (!late) return { posture: null, clearWin: false };
  const clearWin =
    opponents.every(o => (me.skillPoints ?? 0) > (o.skillPoints ?? 0)) && me.body.length > bestLength;
  // Protect gate: points lead AND no length deficit — a points lead on
  // a shorter snake is fragile in shrink.
  if (me.score > bestScore && me.body.length >= bestLength) {
    return { posture: 'PROTECT', clearWin };
  }
  if (me.score < bestScore) return { posture: 'CHASE', clearWin };
  return { posture: null, clearWin };
}

/**
 * Dynamic lock rule, as the planner has always run it: lock only the
 * first entry when the position after it leaves ≤ 1 safe escape; a
 * dart first entry locks whole. Evaluated on the simulated position
 * after entry 0 (Change 1's projected board, opponents advanced —
 * strictly more informed than the old live-body count).
 */
function computeLockCount(
  base: GameState,
  simAfterFirst: SimState,
  gridSize: number,
  botRole: string,
  plan: BufferEntry[],
): number {
  if (plan.length === 0) return 0;
  if (plan[0].type === 'dart') return plan.length;
  const view = simToGameState(base, simAfterFirst);
  const me = view.snakes.find(s => s.id === botRole);
  if (!me) return plan.length;
  const headAfter = me.body[0];
  const afterDir = me.direction;
  const occupied = new Set<string>();
  for (const s of view.snakes) {
    for (const seg of s.body) occupied.add(posKey(seg));
  }
  const escapes = ALL_DIRECTIONS.filter(d => !isOppositeDirection(afterDir, d)).filter(d => {
    const cell = getNextHeadPosition(headAfter, d);
    return isCellInArena(cell, gridSize, view.ringInset) && !occupied.has(posKey(cell));
  }).length;
  return escapes <= 1 ? 1 : plan.length;
}

interface RouteState {
  entries: BufferEntry[];
  sim: SimState;
  simAfterFirst: SimState | null;
  score: number;
  projections: Record<string, Position[]>[];
  ateCells: Position[];
  firstDirForced: boolean;
}

/**
 * Build the bot's hidden plan (up to 3 entries), how much of it to
 * lock, the per-entry opponent projections (Change 2), and the
 * updated chain intent (Change 4, HARD only).
 */
export function buildAIPlan(args: {
  gameState: GameState;
  gridSize: number;
  botRole: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  aiStyle?: string;
  skillsAvailable?: GameState['skillsAvailable'];
  raceTurns: number;
  intent?: ChainIntent | null;
}): AIPlanResult {
  const { gameState, gridSize, botRole, difficulty, aiStyle } = args;
  const me = gameState.snakes.find(s => s.id === botRole);
  if (!me || !me.isAlive) {
    return { plan: [], lockCount: 0, projections: [], intent: null, posture: null };
  }
  const planLen = Math.min(MAX_SIM_DEPTH, me.body.length);
  const postureInfo = computePosture(gameState, me, args.raceTurns);
  const isAvalena = (aiStyle || '').toLowerCase() === 'avalena';

  // ---- Legacy greedy path: EASY and Avalena keep the old per-ply
  // loop in shape (calculateAIAction per ply, dart gates), but the
  // simulation underneath now advances every snake (Change 1).
  if (difficulty === 'EASY' || isAvalena) {
    let sim = initialSim(gameState);
    let simAfterFirst: SimState | null = null;
    const plan: BufferEntry[] = [];
    const projections: Record<string, Position[]>[] = [];
    let queuedDarts = 0;
    for (let i = 0; i < planLen; i++) {
      const simSnake = sim.snakes.find(s => s.id === botRole);
      if (!simSnake || !simSnake.isAlive) break;
      const view = simToGameState(gameState, sim);
      const action = calculateAIAction(
        view, gridSize, botRole, difficulty, aiStyle,
        args.skillsAvailable ?? gameState.skillsAvailable,
      );
      if (!action.direction && !action.skill) break;
      if (action.skill?.skillId === 'dart') {
        const dartDir = action.skill.direction;
        if (!isValidDartDirection(simSnake.direction, dartDir)) break;
        if (!canAffordQueuedDart(me.skillPoints ?? 0, queuedDarts)) break;
        queuedDarts++;
        plan.push({ type: 'dart', direction: dartDir });
        let outcome: AdvanceOutcome | null = null;
        for (let step = 0; step < 3; step++) {
          outcome = advanceSim(gameState, sim, gridSize, botRole, dartDir);
          sim = outcome.sim;
        }
        projections.push(outcome!.opponentBodies);
        if (!simAfterFirst) simAfterFirst = sim;
        continue;
      }
      if (!action.direction) break;
      const outcome = advanceSim(gameState, sim, gridSize, botRole, action.direction);
      sim = outcome.sim;
      plan.push({ type: 'move', direction: action.direction });
      projections.push(outcome.opponentBodies);
      if (!simAfterFirst) simAfterFirst = sim;
    }
    if (plan.length === 0) return finishPlan(gameState, gridSize, botRole, difficulty, aiStyle, null, postureInfo.posture);
    const lockCount = computeLockCount(gameState, simAfterFirst ?? sim, gridSize, botRole, plan);
    return { plan, lockCount, projections, intent: null, posture: postureInfo.posture };
  }

  // ---- Beam path: MEDIUM (within-plan chains) and HARD (+ intent).
  const intent = difficulty === 'HARD' ? args.intent ?? null : null;
  const startSim = initialSim(gameState);
  let beam: RouteState[] = [{
    entries: [], sim: startSim, simAfterFirst: null, score: 0,
    projections: [], ateCells: [], firstDirForced: false,
  }];
  for (let ply = 0; ply < planLen; ply++) {
    const next: RouteState[] = [];
    for (const route of beam) {
      const view = simToGameState(gameState, route.sim);
      const viewMe = view.snakes.find(s => s.id === botRole);
      if (!viewMe) continue;
      const candidates = calculateAIMoveCandidates(view, gridSize, botRole, difficulty, aiStyle).slice(0, 2);
      for (const cand of candidates) {
        const outcome = advanceSim(gameState, route.sim, gridSize, botRole, cand.dir);
        let score = route.score + cand.score;
        // Per-ply safety against the SIMULATED bodies (Change 1's
        // point): a head-on that only appears once the opponent has
        // advanced is priced here, at the veto's own rate when lost.
        if (outcome.botHeadOn === 'WIN') score += HEAD_ON_WIN_BONUS;
        else if (outcome.botHeadOn === 'LOSS') score += IN_SIM_HEAD_ON_LOSS;
        const ateCells = [...route.ateCells];
        if (outcome.botAteSP !== null && outcome.botAteCell) {
          const ateCell = outcome.botAteCell;
          ateCells.push(ateCell);
          score += outcome.botAteSP * CHAIN_SP_WEIGHT;
          // Contested? An opponent head at least as close to the token
          // on the pre-move board. Protect only pays for a clear win.
          const contested = view.snakes.some(o =>
            o.id !== botRole && o.isAlive && !sameTeam(viewMe, o) &&
            Math.abs(o.body[0].x - ateCell.x) + Math.abs(o.body[0].y - ateCell.y) <=
              Math.abs(viewMe.body[0].x - ateCell.x) + Math.abs(viewMe.body[0].y - ateCell.y));
          if (contested && postureInfo.posture === 'PROTECT' && !postureInfo.clearWin) {
            score -= outcome.botAteSP * CHAIN_SP_WEIGHT + PROTECT_CONTEST_PENALTY;
          }
          if (intent && intent.tokenKeys.includes(posKey(ateCell))) {
            score += INTENT_CASH_BONUS;
          }
        }
        if (intent) {
          const headBefore = route.sim.snakes.find(s => s.id === botRole)!.body[0];
          const headAfter = outcome.sim.snakes.find(s => s.id === botRole)!.body[0];
          const distBefore = Math.abs(headBefore.x - intent.anchor.x) + Math.abs(headBefore.y - intent.anchor.y);
          const distAfter = Math.abs(headAfter.x - intent.anchor.x) + Math.abs(headAfter.y - intent.anchor.y);
          if (distAfter < distBefore) score += INTENT_STEP_BONUS;
        }
        next.push({
          entries: [...route.entries, { type: 'move', direction: cand.dir }],
          sim: outcome.sim,
          simAfterFirst: route.simAfterFirst ?? outcome.sim,
          score,
          projections: [...route.projections, outcome.opponentBodies],
          ateCells,
          firstDirForced: route.entries.length === 0 ? candidates.length === 1 : route.firstDirForced,
        });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, 2);
  }

  const playable = beam.filter(r => r.entries.length > 0);
  if (playable.length === 0) {
    return finishPlan(gameState, gridSize, botRole, difficulty, aiStyle, intent, postureInfo.posture);
  }

  // Setup evaluation (Change 4): a route that eats nothing but ends
  // staged on a chainable cluster earns the cluster's discounted
  // chain value — that is what lets positioning beat a stray single.
  const setupOf = new Map<RouteState, Position[]>();
  for (const route of playable) {
    if (route.ateCells.length > 0) continue;
    const view = simToGameState(gameState, route.sim);
    const viewMe = view.snakes.find(s => s.id === botRole);
    if (!viewMe) continue;
    const area = floodFillArea(viewMe.body[0], view, gridSize, viewMe);
    if (area < viewMe.body.length) continue; // staged inside a coffin is not a setup
    for (const cluster of findClusters(route.sim.tokens)) {
      if (cluster.length < 2) continue;
      const nearest = Math.min(...cluster.map(t =>
        Math.abs(t.x - viewMe.body[0].x) + Math.abs(t.y - viewMe.body[0].y)));
      if (nearest > 3) continue;
      route.score += clusterChainValue(cluster.length, viewMe.tokensSinceLock ?? 0) * CHAIN_SP_WEIGHT * SETUP_VALUE_DISCOUNT;
      setupOf.set(route, cluster);
      break;
    }
  }
  playable.sort((a, b) => b.score - a.score);
  let chosen = playable[0];

  // Protect's exit margin (Change 5): if the best route ends boxed
  // below length + 2, prefer a route that keeps the margin; if none
  // does, keep the best anyway (least-bad beats frozen).
  if (postureInfo.posture === 'PROTECT') {
    const areaOf = (r: RouteState): number => {
      const view = simToGameState(gameState, r.sim);
      const viewMe = view.snakes.find(s => s.id === botRole);
      return viewMe ? floodFillArea(viewMe.body[0], view, gridSize, viewMe) : 0;
    };
    const chosenMe = chosen.sim.snakes.find(s => s.id === botRole)!;
    if (areaOf(chosen) < chosenMe.body.length + 2) {
      const roomy = playable.filter(r => {
        const m = r.sim.snakes.find(s => s.id === botRole)!;
        return areaOf(r) >= m.body.length + 2;
      });
      if (roomy.length > 0) {
        chosen = roomy.sort((a, b) => b.score - a.score)[0];
      } else {
        chosen = { ...chosen, score: chosen.score - PROTECT_AREA_PENALTY };
      }
    }
  }

  // Chain intent bookkeeping (HARD). Abandon on: a forced first move
  // (survival override), the cluster being eaten out from under the
  // setup, cashing it (served its purpose), or two locks in a row
  // without progress. A setup route (re)creates the intent.
  let nextIntent: ChainIntent | null = null;
  if (difficulty === 'HARD') {
    const setupCluster = setupOf.get(chosen);
    if (chosen.firstDirForced) {
      nextIntent = null;
    } else if (setupCluster && chosen.ateCells.length === 0) {
      const anchor = {
        x: Math.round(setupCluster.reduce((a, t) => a + t.x, 0) / setupCluster.length),
        y: Math.round(setupCluster.reduce((a, t) => a + t.y, 0) / setupCluster.length),
      };
      const endHead = chosen.sim.snakes.find(s => s.id === botRole)!.body[0];
      nextIntent = {
        tokenKeys: setupCluster.map(posKey),
        anchor,
        createdTick: gameState.tick,
        locksWithoutProgress: 0,
        lastDistance: Math.abs(endHead.x - anchor.x) + Math.abs(endHead.y - anchor.y),
      };
    } else if (intent) {
      const clusterAlive = gameState.tokens.some(t => intent.tokenKeys.includes(posKey(t)));
      const cashed = chosen.ateCells.some(c => intent.tokenKeys.includes(posKey(c)));
      if (clusterAlive && !cashed) {
        const headNow = me.body[0];
        const distNow = Math.abs(headNow.x - intent.anchor.x) + Math.abs(headNow.y - intent.anchor.y);
        const progressed = distNow < intent.lastDistance;
        const locks = progressed ? 0 : intent.locksWithoutProgress + 1;
        if (locks < 2) {
          nextIntent = {
            ...intent,
            locksWithoutProgress: locks,
            lastDistance: progressed ? distNow : intent.lastDistance,
          };
        }
      }
    }
  }

  const lockCount = computeLockCount(
    gameState, chosen.simAfterFirst ?? chosen.sim, gridSize, botRole, chosen.entries,
  );
  return {
    plan: chosen.entries,
    lockCount,
    projections: chosen.projections,
    intent: nextIntent,
    posture: postureInfo.posture,
  };
}

/**
 * Empty-plan fallback. When no route survives the vetoes the bot is
 * in the scorer's trapped case, so the fallback IS the scorer's own
 * pick (max flood-fill area, opponent body not excluded) — exactly
 * what the pre-spec planner executed — projected one ply so Change
 * 2 still has a body forecast for it.
 */
function finishPlan(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  difficulty: 'EASY' | 'MEDIUM' | 'HARD',
  aiStyle: string | undefined,
  intent: ChainIntent | null,
  posture: 'PROTECT' | 'CHASE' | null,
): AIPlanResult {
  const me = gameState.snakes.find(s => s.id === botRole);
  if (!me) return { plan: [], lockCount: 0, projections: [], intent, posture };
  const dir = calculateAIMove(gameState, gridSize, botRole, difficulty, aiStyle)
    ?? ALL_DIRECTIONS.find(d => !isOppositeDirection(me.direction, d));
  if (!dir) return { plan: [], lockCount: 0, projections: [], intent, posture };
  const outcome = advanceSim(gameState, initialSim(gameState), gridSize, botRole, dir);
  return {
    plan: [{ type: 'move', direction: dir }],
    lockCount: 1,
    projections: [outcome.opponentBodies],
    intent,
    posture,
  };
}
