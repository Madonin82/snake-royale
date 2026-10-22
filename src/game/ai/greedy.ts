import { Direction, GameState, Position } from '../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../engine';
import { canActivateSkill } from '../skills';
import { AIActionResult, BrainProfile } from './types';
import { ALL_DIRECTIONS, getOpponentBodyThreat, getOpponentThreatCells, posKey, sameTeam } from './shared/sim';
import { fallbackClearInfo, floodFillArea, rateAIMoves } from './shared/rating';

export function calculateAIAction(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  skillsAvailable?: GameState['skillsAvailable'],
  profile?: BrainProfile,
): AIActionResult {
  const me = gameState.snakes.find(snake => snake.id === botRole);
  if (!me || !me.isAlive) return { direction: null, skill: null };

  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    return calculateAvalenaAction(gameState, gridSize, botRole, skillsAvailable ?? gameState.skillsAvailable);
  }

  return {
    direction: calculateAIMove(gameState, gridSize, botRole, difficulty, aiStyle, profile),
    skill: null,
  };
}

export function calculateAvalenaAction(
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

  const playerPoints = player?.skillPoints ?? 0;
  const inHuntPhase = Boolean(player && player.isAlive && (me.skillPoints ?? 0) >= playerPoints + 3);

  if (inHuntPhase && player) {
    const playerHead = player.body[0];
    const currentFacing = me.direction;
    const validDartDirs = ALL_DIRECTIONS.filter(d => !isOppositeDirection(currentFacing, d));

    if (canActivateSkill(me, gameState, skillsAvailable)) {
      let inRange = false;
      const dartCandidates: { dir: Direction; endDist: number; minDist: number; safe: boolean; snipeHits: number }[] = [];
      const { threat: threatCells, snipeTargets } = getOpponentThreatCells(gameState, botRole, gridSize, me);

      for (const dartDir of validDartDirs) {
        const step1Pos = getNextHeadPosition(me.body[0], dartDir);
        const step2Pos = getNextHeadPosition(step1Pos, dartDir);
        const step3Pos = getNextHeadPosition(step2Pos, dartDir);
        const d1 = Math.abs(step1Pos.x - playerHead.x) + Math.abs(step1Pos.y - playerHead.y);
        const d2 = Math.abs(step2Pos.x - playerHead.x) + Math.abs(step2Pos.y - playerHead.y);
        const d3 = Math.abs(step3Pos.x - playerHead.x) + Math.abs(step3Pos.y - playerHead.y);
        const minDist = Math.min(d1, d2, d3);
        const endDist = d3;

        if (minDist === 0 || (Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y) <= 3 && endDist < Math.abs(me.body[0].x - playerHead.x) + Math.abs(me.body[0].y - playerHead.y))) {
          inRange = true;
        }

        const safe =
          isDartCellSafe(step1Pos, me.body, gameState, gridSize, threatCells) &&
          isDartCellSafe(step2Pos, [step1Pos, ...me.body.slice(0, -1)], gameState, gridSize, threatCells) &&
          isDartCellSafe(step3Pos, [step2Pos, step1Pos, ...me.body.slice(0, -2)], gameState, gridSize, threatCells);

        const snipeHits = [step1Pos, step2Pos, step3Pos]
          .filter(p => snipeTargets.has(posKey(p))).length;

        dartCandidates.push({ dir: dartDir, endDist, minDist, safe, snipeHits });
      }

      if (inRange) {
        dartCandidates.sort((a, b) => {
          if (a.safe !== b.safe) return a.safe ? -1 : 1;
          if (a.snipeHits !== b.snipeHits) return b.snipeHits - a.snipeHits;
          if (a.endDist !== b.endDist) return a.endDist - b.endDist;
          if (a.minDist !== b.minDist) return a.minDist - b.minDist;
          return 0;
        });
        const bestDart = dartCandidates[0];
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

    const huntDir = calculateHuntMoveTowardTarget(gameState, gridSize, botRole, playerHead);
    return { direction: huntDir, skill: null };
  }

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
  if (threatCells.has(`${pos.x},${pos.y}`)) return false;
  return true;
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

export function calculateAIMoveCandidates(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  profile?: BrainProfile,
): { dir: Direction; score: number }[] {
  const normalizedStyle = (aiStyle || '').toLowerCase();
  if (normalizedStyle === 'avalena') {
    const action = calculateAvalenaAction(gameState, gridSize, botRole, gameState.skillsAvailable);
    return action.direction ? [{ dir: action.direction, score: 0 }] : [];
  }
  if (!profile) {
    profile = {
      planner: 'beam',
      enableIntent: true,
      chainSpWeight: 10,
      headOnWinBonus: 300,
      inSimHeadOnLoss: -10000,
      intentCashBonus: 30,
      intentStepBonus: 5,
      setupValueDiscount: 0.5,
      protectAreaPenalty: 400,
      protectContestPenalty: 150,
      maxSimDepth: 3,
      beamCandidates: 2,
      threatNudge: { EASY: 0, MEDIUM: 8, HARD: 25 },
      chainCap: { EASY: 1, MEDIUM: 2, HARD: 3 },
      easyRandomSecondPick: 0.25,
    };
  }
  const rated = rateAIMoves(gameState, gridSize, botRole, difficulty, profile);
  if (!rated) return [];
  return [...rated.ratedMoves].sort((a, b) => b.score - a.score);
}

export function calculateAIMove(
  gameState: GameState,
  gridSize: number,
  botRole: string = 'p2',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM',
  aiStyle?: string,
  profile?: BrainProfile,
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
  if (!profile) {
    profile = {
      planner: 'beam',
      enableIntent: true,
      chainSpWeight: 10,
      headOnWinBonus: 300,
      inSimHeadOnLoss: -10000,
      intentCashBonus: 30,
      intentStepBonus: 5,
      setupValueDiscount: 0.5,
      protectAreaPenalty: 400,
      protectContestPenalty: 150,
      maxSimDepth: 3,
      beamCandidates: 2,
      threatNudge: { EASY: 0, MEDIUM: 8, HARD: 25 },
      chainCap: { EASY: 1, MEDIUM: 2, HARD: 3 },
      easyRandomSecondPick: 0.25,
    };
  }
  const rated = rateAIMoves(gameState, gridSize, botRole, difficulty, profile);
  if (!rated) return null;
  const { ratedMoves, validDirs, me } = rated;
  const head = me.body[0];
  const currentDir = me.direction;

  if (ratedMoves.length === 0) {
    // Trapped fallback. The candidate legality here is the historical one
    // (NOT the Change 8 effective inset): a fallback step into the
    // telegraph band can still be the least-bad option — the horizon
    // model below prices the landing ring explicitly.
    const candidates: { dir: Direction; nextPos: Position }[] = [];
    for (const dir of validDirs) {
      const nextPos = getNextHeadPosition(head, dir);
      if (!isCellInArena(nextPos, gridSize, gameState.ringInset)) continue;
      if (gameState.walls?.some(wall => wall.x === nextPos.x && wall.y === nextPos.y)) continue;
      if (me.body.slice(0, -1).some((s: Position) => s.x === nextPos.x && s.y === nextPos.y)) continue;
      candidates.push({ dir, nextPos });
    }
    // Change 7 (Changes 6–9 spec): profiles with fallbackClearHorizon
    // rank the fallback steps by time-to-clear — how soon the space
    // around the step fits the body again as tails vacate (ties: larger
    // area at the clearing tick, then larger area now). Largest-area-now
    // cannot tell a sealed pocket from a door about to open.
    const horizon = profile.fallbackClearHorizon ?? 0;
    if (horizon > 0 && candidates.length > 0) {
      const ranked = candidates.map(c => ({
        dir: c.dir,
        info: fallbackClearInfo(c.nextPos, gameState, gridSize, me, horizon),
      }));
      ranked.sort((a, b) => {
        const ta = a.info.clearTick ?? Number.POSITIVE_INFINITY;
        const tb = b.info.clearTick ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        if (a.info.areaAtClear !== b.info.areaAtClear) return b.info.areaAtClear - a.info.areaAtClear;
        return b.info.areaNow - a.info.areaNow;
      });
      return ranked[0].dir;
    }
    let bestDir: Direction | null = null;
    let bestArea = -1;
    for (const c of candidates) {
      const area = floodFillArea(c.nextPos, gameState, gridSize, me);
      if (area > bestArea) {
        bestArea = area;
        bestDir = c.dir;
      }
    }
    return bestDir ?? validDirs[0] ?? currentDir;
  }

  ratedMoves.sort((a, b) => b.score - a.score);

  if (difficulty === 'EASY' && Math.random() < profile.easyRandomSecondPick && ratedMoves.length > 1) {
    return ratedMoves[1].dir;
  }

  return ratedMoves[0].dir;
}
