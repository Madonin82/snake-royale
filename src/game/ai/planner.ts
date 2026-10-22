import { BufferEntry, Direction, GameState, Position, Snake } from '../../types/game';
import { getNextHeadPosition, isCellInArena, isOppositeDirection } from '../engine';
import { canAffordQueuedDart, isValidDartDirection } from '../skills';
import { AIPlanResult, BrainProfile, ChainIntent } from './types';
import { initialSim, simToGameState, posKey, sameTeam, AdvanceOutcome, SimState, SimSnake, ALL_DIRECTIONS, getOpponentBodyThreat, tiebreakWinner } from './shared/sim';
import { computePosture, computeLockCount, findClusters, clusterChainValue } from './shared/posture';
import { floodFillArea } from './shared/rating';
import { calculateAIAction, calculateAIMoveCandidates, calculateAIMove } from './greedy';

export function advanceSim(
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
  const eatRequests = new Map<string, string[]>();
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
  const tiebreakBetween = (a: SimSnake, b: SimSnake): SimSnake | null => {
    return tiebreakWinner(a, b) as SimSnake | null;
  };
  const simById = new Map(sim.snakes.map(s => [s.id, s]));
  const eaters = new Map<string, string>();
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
      sp += 1;
      if (s.id === botRole) {
        botAteSP = tsl;
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

interface RouteState {
  entries: BufferEntry[];
  sim: SimState;
  simAfterFirst: SimState | null;
  score: number;
  projections: Record<string, Position[]>[];
  ateCells: Position[];
  firstDirForced: boolean;
  // Change 10 (v3 offense spec): the most trapped opponent's flood
  // area (liberties) at the route's low-water mark, and how much
  // territory bonus the route has already collected toward the cap.
  oppArea: number;
  territoryPaid: number;
}

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

/**
 * Change 8 (Changes 6–9 spec), within-plan half: for ringTelegraphAsWalls
 * profiles, a ply that executes on or after a pending shrink's landing
 * tick is priced against the LANDED ring, not the ring as it stands at
 * formation — a plan must not route its later steps through ground the
 * ring has already claimed by the time those steps execute. Mutates the
 * fresh sim view only; the base state is untouched. When the game is
 * already telegraphing, rateAIMoves' effective inset covers every ply
 * and this agrees with it (landed inset == telegraphRingInset).
 */
function applyLandedRingInset(view: GameState, base: GameState, gridSize: number, ply: number, profile: BrainProfile): void {
  if (!profile.ringTelegraphAsWalls) return;
  if (base.phase !== 'SHRINKING') return;
  const maxInset = Math.floor(gridSize / 2) - 1;
  if (base.ringInset >= maxInset) return;
  const remaining = base.phaseTurnsRemaining ?? Number.POSITIVE_INFINITY;
  if (ply + 1 >= remaining) {
    view.ringInset = base.ringInset + 1;
    view.isTelegraphingShrink = false;
    view.telegraphRingInset = view.ringInset;
  }
}

/**
 * Changes 10–11 (v3 offense spec): an opponent's exits in a given
 * state — non-reverse steps to a cell that is in-arena, non-wall, not
 * in any snake's body-threat set, AND with room to live after the step
 * (flood from the cell at least the opponent's length). A step into a
 * dead-end nook is not an exit. One exit is atari; zero is a sealed
 * group.
 */
function opponentExitCount(view: GameState, opp: Snake, gridSize: number): number {
  const head = opp.body[0];
  const blocked = new Set<string>();
  for (const s of view.snakes) {
    for (const key of getOpponentBodyThreat(s, view.tokens ?? [])) blocked.add(key);
  }
  if (view.walls) for (const w of view.walls) blocked.add(posKey(w));
  let exits = 0;
  for (const d of ALL_DIRECTIONS) {
    if (isOppositeDirection(opp.direction, d)) continue;
    const cell = getNextHeadPosition(head, d);
    if (!isCellInArena(cell, gridSize, view.ringInset)) continue;
    if (blocked.has(posKey(cell))) continue;
    if (floodFillArea(cell, view, gridSize, opp, view.ringInset) < opp.body.length) continue;
    exits++;
  }
  return exits;
}

/**
 * Change 10 (v3 offense spec): the smallest flood area among the
 * living opponents in a view — the most trapped opponent's liberties.
 * A dead or absent opponent contributes 0.
 */
function minOpponentArea(view: GameState, me: Snake, botRole: string, gridSize: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const s of view.snakes) {
    if (s.id === botRole || !s.isAlive || sameTeam(me, s)) continue;
    min = Math.min(min, floodFillArea(s.body[0], view, gridSize, s, view.ringInset));
  }
  return min;
}

export function buildAIPlan(
  args: {
    gameState: GameState;
    gridSize: number;
    botRole: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    aiStyle?: string;
    skillsAvailable?: GameState['skillsAvailable'];
    raceTurns: number;
    intent?: ChainIntent | null;
  },
  profile: BrainProfile,
): AIPlanResult {
  const { gameState, gridSize, botRole, difficulty, aiStyle } = args;
  const me = gameState.snakes.find(s => s.id === botRole);
  if (!me || !me.isAlive) {
    return { plan: [], lockCount: 0, projections: [], intent: null, posture: null };
  }
  const planLen = Math.min(profile.maxSimDepth, me.body.length);
  const postureInfo = computePosture(gameState, me, args.raceTurns);
  const isAvalena = (aiStyle || '').toLowerCase() === 'avalena';

  if (profile.planner === 'greedy' || difficulty === 'EASY' || isAvalena) {
    let sim = initialSim(gameState);
    let simAfterFirst: SimState | null = null;
    const plan: BufferEntry[] = [];
    const projections: Record<string, Position[]>[] = [];
    let queuedDarts = 0;
    for (let i = 0; i < planLen; i++) {
      const simSnake = sim.snakes.find(s => s.id === botRole);
      if (!simSnake || !simSnake.isAlive) break;
      const view = simToGameState(gameState, sim);
      applyLandedRingInset(view, gameState, gridSize, i, profile);
      const action = calculateAIAction(
        view, gridSize, botRole, difficulty, aiStyle,
        args.skillsAvailable ?? gameState.skillsAvailable,
        profile,
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
    if (plan.length === 0) return finishPlan(gameState, gridSize, botRole, difficulty, aiStyle, null, postureInfo.posture, profile);
    const lockCount = computeLockCount(gameState, simAfterFirst ?? sim, gridSize, botRole, plan);
    return { plan, lockCount, projections, intent: null, posture: postureInfo.posture };
  }

  const intent = (profile.enableIntent && difficulty === 'HARD') ? args.intent ?? null : null;
  const startSim = initialSim(gameState);
  const territoryWeight = profile.territoryWeight ?? 0;
  let beam: RouteState[] = [{
    entries: [], sim: startSim, simAfterFirst: null, score: 0,
    projections: [], ateCells: [], firstDirForced: false,
    oppArea: territoryWeight > 0 ? minOpponentArea(gameState, me, botRole, gridSize) : Number.POSITIVE_INFINITY,
    territoryPaid: 0,
  }];
  for (let ply = 0; ply < planLen; ply++) {
    const next: RouteState[] = [];
    for (const route of beam) {
      const view = simToGameState(gameState, route.sim);
      applyLandedRingInset(view, gameState, gridSize, ply, profile);
      const viewMe = view.snakes.find(s => s.id === botRole);
      if (!viewMe) continue;
      const candidates = calculateAIMoveCandidates(view, gridSize, botRole, difficulty, aiStyle, profile).slice(0, profile.beamCandidates);
      for (const cand of candidates) {
        const outcome = advanceSim(gameState, route.sim, gridSize, botRole, cand.dir);
        let score = route.score + cand.score;
        if (outcome.botHeadOn === 'WIN') score += profile.headOnWinBonus;
        else if (outcome.botHeadOn === 'LOSS') score += profile.inSimHeadOnLoss;
        const ateCells = [...route.ateCells];
        if (outcome.botAteSP !== null && outcome.botAteCell) {
          const ateCell = outcome.botAteCell;
          ateCells.push(ateCell);
          score += outcome.botAteSP * profile.chainSpWeight;
          const contested = view.snakes.some(o =>
            o.id !== botRole && o.isAlive && !sameTeam(viewMe, o) &&
            Math.abs(o.body[0].x - ateCell.x) + Math.abs(o.body[0].y - ateCell.y) <=
              Math.abs(viewMe.body[0].x - ateCell.x) + Math.abs(viewMe.body[0].y - ateCell.y));
          if (contested && postureInfo.posture === 'PROTECT' && !postureInfo.clearWin) {
            score -= outcome.botAteSP * profile.chainSpWeight + profile.protectContestPenalty;
          }
          if (intent && intent.tokenKeys.includes(posKey(ateCell))) {
            score += profile.intentCashBonus;
          }
        }
        if (intent) {
          const headBefore = route.sim.snakes.find(s => s.id === botRole)!.body[0];
          const headAfter = outcome.sim.snakes.find(s => s.id === botRole)!.body[0];
          const distBefore = Math.abs(headBefore.x - intent.anchor.x) + Math.abs(headBefore.y - intent.anchor.y);
          const distAfter = Math.abs(headAfter.x - intent.anchor.x) + Math.abs(headAfter.y - intent.anchor.y);
          if (distAfter < distBefore) score += profile.intentStepBonus;
        }
        // Change 10 (v3 offense spec): territory, priced per ply as
        // liberties actually come off the most trapped opponent (a new
        // low-water mark for his flood area), accumulated up to the
        // profile cap. Priced incrementally so the beam can climb the
        // gradient instead of only discovering the seal at route end.
        let oppArea = route.oppArea;
        let territoryPaid = route.territoryPaid;
        if (territoryWeight > 0 && Number.isFinite(route.oppArea)) {
          const endView = simToGameState(gameState, outcome.sim);
          applyLandedRingInset(endView, gameState, gridSize, ply + 1, profile);
          const newOppArea = minOpponentArea(endView, viewMe, botRole, gridSize);
          if (Number.isFinite(newOppArea) && newOppArea < oppArea) {
            const bonus = Math.min(
              (profile.territoryCap ?? Number.POSITIVE_INFINITY) - territoryPaid,
              territoryWeight * (oppArea - newOppArea),
            );
            if (bonus > 0) {
              score += bonus;
              territoryPaid += bonus;
            }
            oppArea = newOppArea;
          }
        }
        next.push({
          entries: [...route.entries, { type: 'move', direction: cand.dir }],
          sim: outcome.sim,
          simAfterFirst: route.simAfterFirst ?? outcome.sim,
          score,
          projections: [...route.projections, outcome.opponentBodies],
          ateCells,
          firstDirForced: route.entries.length === 0 ? candidates.length === 1 : route.firstDirForced,
          oppArea,
          territoryPaid,
        });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, profile.beamCandidates);
  }

  const playable = beam.filter(r => r.entries.length > 0);
  if (playable.length === 0) {
    return finishPlan(gameState, gridSize, botRole, difficulty, aiStyle, intent, postureInfo.posture, profile);
  }

  const setupOf = new Map<RouteState, Position[]>();
  for (const route of playable) {
    if (route.ateCells.length > 0) continue;
    const view = simToGameState(gameState, route.sim);
    applyLandedRingInset(view, gameState, gridSize, route.entries.length - 1, profile);
    const viewMe = view.snakes.find(s => s.id === botRole);
    if (!viewMe) continue;
    const area = floodFillArea(viewMe.body[0], view, gridSize, viewMe, view.ringInset);
    if (area < viewMe.body.length) continue;
    for (const cluster of findClusters(route.sim.tokens)) {
      if (cluster.length < 2) continue;
      const nearest = Math.min(...cluster.map(t =>
        Math.abs(t.x - viewMe.body[0].x) + Math.abs(t.y - viewMe.body[0].y)));
      if (nearest > 3) continue;
      route.score += clusterChainValue(cluster.length, viewMe.tokensSinceLock ?? 0) * profile.chainSpWeight * profile.setupValueDiscount;
      setupOf.set(route, cluster);
      break;
    }
  }
  playable.sort((a, b) => b.score - a.score);

  // Change 11 (v3 offense spec): exit-cut (atari), priced at route
  // end. Territory (Change 10) is priced per ply inside the beam
  // above; what remains for route end is the tactical fact of the
  // opponent's exits in the position the route buys — one exit pays
  // the bonus, zero pays double. Measured in the same place the
  // PROTECT end-check below reads end areas.
  const exitCutBonus = profile.exitCutBonus ?? 0;
  if (exitCutBonus > 0) {
    const opponents = gameState.snakes.filter(s => s.id !== botRole && s.isAlive && !sameTeam(me, s));
    if (opponents.length > 0) {
      for (const route of playable) {
        const view = simToGameState(gameState, route.sim);
        applyLandedRingInset(view, gameState, gridSize, route.entries.length - 1, profile);
        let fewestExits = Number.POSITIVE_INFINITY;
        for (const opp of opponents) {
          const viewOpp = view.snakes.find(s => s.id === opp.id);
          if (!viewOpp || !viewOpp.isAlive) {
            fewestExits = 0;
            continue;
          }
          fewestExits = Math.min(fewestExits, opponentExitCount(view, viewOpp, gridSize));
        }
        if (fewestExits <= 1) {
          route.score += fewestExits === 0 ? exitCutBonus * 2 : exitCutBonus;
        }
      }
      playable.sort((a, b) => b.score - a.score);
    }
  }

  let chosen = playable[0];

  if (postureInfo.posture === 'PROTECT') {
    const areaOf = (r: RouteState): number => {
      const view = simToGameState(gameState, r.sim);
      applyLandedRingInset(view, gameState, gridSize, r.entries.length - 1, profile);
      const viewMe = view.snakes.find(s => s.id === botRole);
      return viewMe ? floodFillArea(viewMe.body[0], view, gridSize, viewMe, view.ringInset) : 0;
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
        chosen = { ...chosen, score: chosen.score - profile.protectAreaPenalty };
      }
    }
  }

  let nextIntent: ChainIntent | null = null;
  if (profile.enableIntent && difficulty === 'HARD') {
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

function finishPlan(
  gameState: GameState,
  gridSize: number,
  botRole: string,
  difficulty: 'EASY' | 'MEDIUM' | 'HARD',
  aiStyle: string | undefined,
  intent: ChainIntent | null,
  posture: 'PROTECT' | 'CHASE' | null,
  profile: BrainProfile,
): AIPlanResult {
  const me = gameState.snakes.find(s => s.id === botRole);
  if (!me) return { plan: [], lockCount: 0, projections: [], intent, posture };
  const dir = calculateAIMove(gameState, gridSize, botRole, difficulty, aiStyle, profile)
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
