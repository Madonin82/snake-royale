import { Direction, GameState, PendingSkill, Position, Snake } from '../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from './engine';
import { canActivateSkill } from './skills';

const ALL_DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

const posKey = (p: Position): string => `${p.x},${p.y}`;

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

  const player = gameState.snakes.find(snake => snake.id === 'p1') ??
    gameState.snakes.find(snake => snake.id !== botRole && snake.isAlive) ??
    gameState.snakes.find(snake => snake.id !== botRole);

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
    if (snake.id === botRole) continue;
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
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole);
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

    const dist = Math.abs(nextPos.x - targetPos.x) + Math.abs(nextPos.y - targetPos.y);
    let score = (gridSize * 2 - dist) * 20;
    const openNeighbors = countOpenNeighbors(nextPos, gameState, gridSize);
    score += openNeighbors * 3;
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
  const opponents = gameState.snakes.filter(snake => snake.id !== botRole);
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

    // 4. Opponent Head Proximity / Head-on hazard
    // A head-on happens when both heads enter the same cell on the same
    // sub-step — i.e. my destination is in the opponent's reachable set
    // (their head's valid next cells; the queue is hidden). If I'd lose the
    // mutual-kill tiebreak, that move is vetoed, not nudged: no token is
    // worth a losing trade. (The -10000 keeps the doomed-anyway fallback
    // working: if every move is vetoed, the least-bad still gets picked.)
    let headOnPenalty = 0;
    for (const opponent of livingOpponents) {
      const oppHead = opponent.body[0];
      const inReach = ALL_DIRECTIONS
        .filter(d => !isOppositeDirection(opponent.direction, d))
        .some(d => {
          const c = getNextHeadPosition(oppHead, d);
          return c.x === nextPos.x && c.y === nextPos.y;
        });
      if (!inReach) continue;
      // Post-split, the trade is decided by the POINTS tiebreak (then length).
      const iWinTrade = winsTiebreak(me, opponent);
      if (difficulty === 'EASY') {
        headOnPenalty = Math.max(headOnPenalty, 5);
      } else if (difficulty === 'MEDIUM') {
        headOnPenalty = Math.max(headOnPenalty, 15);
      } else {
        headOnPenalty = Math.max(headOnPenalty, iWinTrade ? 10 : 10000);
      }
    }
    score -= headOnPenalty;

    // 5. Token Seeking (Manhattan Distance to nearest token)
    if (gameState.tokens.length > 0) {
      let bestTokenScore = 0;
      for (const token of gameState.tokens) {
        const d = Math.abs(nextPos.x - token.x) + Math.abs(nextPos.y - token.y);
        // Don't race for lost tokens: if a living opponent's head is strictly
        // closer to this token than I am after this move, they'll get there
        // first — heavily discount it instead of dying for it.
        const contested = livingOpponents.some(opponent => {
          const oppDist = Math.abs(opponent.body[0].x - token.x) + Math.abs(opponent.body[0].y - token.y);
          return oppDist < d;
        });
        const tokenScore = (gridSize * 2 - d) * 10 * (contested ? 0.15 : 1);
        if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
      }
      score += bestTokenScore;
    } else {
      // In shrink phase with no tokens, seek center of arena
      const center = (gridSize - 1) / 2;
      const distToCenter = Math.abs(nextPos.x - center) + Math.abs(nextPos.y - center);
      score += (gridSize - distToCenter) * 8;
    }

    // 6. Lookahead flood-fill / open space heuristic (for Medium and Hard)
    if (difficulty !== 'EASY') {
      const openNeighbors = countOpenNeighbors(nextPos, gameState, gridSize);
      score += openNeighbors * 5;
    }

    // Small inertia preference (avoid erratic zigzagging if scores are tied)
    if (dir === currentDir) {
      score += 2;
    }

    ratedMoves.push({ dir, score });
  }

  if (ratedMoves.length === 0) {
    // Trapped: fallback to any valid non-180 direction even if fatal
    return validDirs[0] || currentDir;
  }

  // Sort descending by score
  ratedMoves.sort((a, b) => b.score - a.score);

  // For Easy AI, introduce occasional randomness (sparring partner)
  if (difficulty === 'EASY' && Math.random() < 0.25 && ratedMoves.length > 1) {
    return ratedMoves[1].dir;
  }

  return ratedMoves[0].dir;
}

function countOpenNeighbors(pos: Position, state: GameState, gridSize: number): number {
  let count = 0;
  for (const d of ALL_DIRECTIONS) {
    const p = getNextHeadPosition(pos, d);
    if (!isCellInArena(p, gridSize, state.ringInset)) continue;
    if (state.walls?.some(wall => wall.x === p.x && wall.y === p.y)) continue;
    if (state.snakes.some(snake => snake.body.some(segment => segment.x === p.x && segment.y === p.y))) continue;
    count++;
  }
  return count;
}
