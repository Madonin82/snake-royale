import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAIPlan } from './index';
import { buildAIPlan as buildPlanWithProfile, advanceSim } from './planner';
import { calculateAIMoveCandidates } from './greedy';
import { initialSim, simToGameState } from './shared/sim';
import { floodFillArea } from './shared/rating';
import { getBrain, listBrains } from './registry';
import { OPPORTUNIST_PROFILE } from './brains/opportunist';
import { V2_PROFILE } from './brains/v2';
import { V3_PROFILE } from './brains/v3';
import { GameState, Position, Snake } from '../../types/game';

// Fixture tests for the Changes 10–12 offense spec (new brain forked
// from v2, working id 'v3'). Jimmy's direction after batch 3: the bot
// must learn the offensive half of the game — territory (use its body
// to take the opponent's liberties and seal him off from tokens and
// token re-spawns), exit-cutting (atari), and deliberate winning
// head-ons (forcing trades when up material). Each fixture isolates
// one mechanism (the other offense terms zeroed where they overlap):
// the Opportunist and v2 must reproduce the passive choice, v3 must
// take the offensive one, and zeroing the one relevant profile field
// must restore the passive choice (revert proof).

function snake(id: string, body: Position[], direction: Snake['direction'], extra: Partial<Snake> = {}): Snake {
  return {
    id, name: id, body, direction, queuedDirection: null,
    score: 0, skillPoints: 0, isAlive: true, color: '#000',
    equippedSkill: null, pendingSkill: null, tokensSinceLock: 0,
    ...extra,
  } as Snake;
}

function state(partial: Partial<GameState>): GameState {
  return {
    phase: 'TOKEN_RACE', tick: 40, turn: 40, phaseTurnsRemaining: 20,
    ringInset: 0, tokens: [], snakes: [], ...partial,
  } as GameState;
}

function firstStep(st: GameState, style: string): string {
  const r = buildAIPlan({ gameState: st, gridSize: 8, botRole: 'p2', difficulty: 'HARD', aiStyle: style, raceTurns: 20 });
  return r.plan[0]?.direction ?? '(none)';
}

function firstStepWithProfile(st: GameState, profile: typeof V3_PROFILE): string {
  const r = buildPlanWithProfile(
    { gameState: st, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 20 },
    profile,
  );
  return r.plan[0]?.direction ?? '(none)';
}

/** Flood area of the opponent at the end of the plan a profile commits to. */
function endOpponentArea(st: GameState, profile: typeof V3_PROFILE): number {
  const r = buildPlanWithProfile(
    { gameState: st, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 20 },
    profile,
  );
  let sim = initialSim(st);
  for (const e of r.plan) {
    if (e.type !== 'move' || !e.direction) continue;
    sim = advanceSim(st, sim, 8, 'p2', e.direction).sim;
  }
  const view = simToGameState(st, sim);
  const opp = view.snakes.find(s => s.id === 'p1');
  if (!opp || !opp.isAlive) return 0;
  return floodFillArea(opp.body[0], view, 8, opp, view.ringInset);
}

// --- Change 12: winning head-on bounty --------------------------------
// The bot (SP 10) faces a cell the shorter-SP opponent can also reach.
// The flat 10 charge makes every pre-v3 brain decline the trade for a
// quiet step north; the bounty pays the bot to step onto the contested
// cell it wins.
const bounty = state({
  tokens: [{ x: 4, y: 1 }, { x: 6, y: 6 }],
  snakes: [
    snake('p1', [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 6 }], 'UP', { skillPoints: 3 }),
    snake('p2', [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }], 'RIGHT', { skillPoints: 10 }),
  ],
});

test('Change 12: v3 steps onto the contested cell it wins; v2 and the Opportunist decline', () => {
  assert.equal(firstStep(bounty, 'opportunist'), 'UP');
  assert.equal(firstStep(bounty, 'v2'), 'UP');
  assert.equal(firstStep(bounty, 'v3'), 'RIGHT');
});

test('Change 12: revert proof — headOnBounty 0 restores the passive step', () => {
  assert.equal(firstStepWithProfile(bounty, { ...V3_PROFILE, headOnBounty: 0 }), 'UP');
});

test('Change 12: the bounty replaces the 10 charge with +150 at the rating level', () => {
  const v2c = calculateAIMoveCandidates(bounty, 8, 'p2', 'HARD', undefined, V2_PROFILE);
  const v3c = calculateAIMoveCandidates(bounty, 8, 'p2', 'HARD', undefined, V3_PROFILE);
  const v2Right = v2c.find(c => c.dir === 'RIGHT');
  const v3Right = v3c.find(c => c.dir === 'RIGHT');
  assert.ok(v2Right && v3Right);
  assert.equal(v3Right.score - v2Right.score, 160);
});

// --- Change 10: territory (liberty squeeze) ---------------------------
// The bot's long body lies along y=4 one step short of a full wall;
// the opponent is north of it. A token line south invites the dive
// every pre-v3 brain takes. Staying east along the wall (by either the
// pure wall route or the dive-hybrid that still seals the south-east)
// ends with the opponent's flood cut from ~51 to ~29; the dive leaves
// him the whole board. Measured on the committed plan's end state.
const territory = state({
  tokens: [{ x: 6, y: 6 }],
  snakes: [
    snake('p1', [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 1, y: 1 }], 'UP'),
    snake('p2', [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 5 }, { x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 2, y: 5 }], 'RIGHT'),
  ],
});
const v3TerritoryOnly = { ...V3_PROFILE, exitCutBonus: 0 };

test('Change 10: v3 territory term seals the opponent (end flood ~29 vs ~51)', () => {
  assert.ok(endOpponentArea(territory, V2_PROFILE) >= 40);
  assert.ok(endOpponentArea(territory, v3TerritoryOnly) <= 32);
});

test('Change 10: revert proof — territoryWeight 0 leaves the opponent the whole board', () => {
  assert.ok(endOpponentArea(territory, { ...v3TerritoryOnly, territoryWeight: 0 }) >= 40);
});

// --- Change 11: exit-cut (atari) ---------------------------------------
// A walled pocket (east wall x=3, sill at (2,3)) with a two-cell mouth
// on the south side. The opponent is held inside by the pocket token
// at (1,2). The plug route steps UP onto the sill and LEFT across the
// mouth, ending with the opponent at zero exits; the passive route
// eats down the west column and leaves the mouth open.
const exitCut = state({
  walls: [{ x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 }],
  tokens: [{ x: 1, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 5 }, { x: 0, y: 6 }, { x: 4, y: 4 }, { x: 6, y: 6 }],
  snakes: [
    snake('p1', [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }], 'DOWN'),
    snake('p2', [{ x: 1, y: 4 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 6 }], 'UP', { skillPoints: 10 }),
  ],
});
const v3ExitOnly = { ...V3_PROFILE, territoryWeight: 0 };

test('Change 11: v3 plugs the pocket mouth; v2 takes the passive west line', () => {
  assert.equal(firstStep(exitCut, 'v2'), 'LEFT');
  assert.equal(firstStepWithProfile(exitCut, v3ExitOnly), 'UP');
  assert.equal(firstStep(exitCut, 'v3'), 'UP');
});

test('Change 11: revert proof — exitCutBonus 0 restores the passive line', () => {
  assert.equal(firstStepWithProfile(exitCut, { ...v3ExitOnly, exitCutBonus: 0 }), 'LEFT');
});

// --- Registry / profile shape ------------------------------------------
test('v3 brain: registered, forked from v2, offense fields set; frozen brains untouched', () => {
  assert.ok(listBrains().some(b => b.id === 'v3'));
  assert.equal(getBrain('v3', 'HARD').brain.id, 'v3');
  assert.equal(getBrain('V3', 'HARD').brain.id, 'v3');
  // Inherited survival terms ride along (fork, not a fresh brain).
  assert.equal(V3_PROFILE.coffinPenaltyMax, V2_PROFILE.coffinPenaltyMax);
  assert.equal(V3_PROFILE.executionGuardLoss, V2_PROFILE.executionGuardLoss);
  assert.equal(V3_PROFILE.ringTelegraphAsWalls, true);
  // The offense terms.
  assert.equal(V3_PROFILE.territoryWeight, 5);
  assert.equal(V3_PROFILE.territoryCap, 300);
  assert.equal(V3_PROFILE.exitCutBonus, 150);
  assert.equal(V3_PROFILE.headOnBounty, 150);
  // Absent = neutral for every pre-existing brain.
  for (const p of [OPPORTUNIST_PROFILE, V2_PROFILE]) {
    assert.equal(p.territoryWeight, undefined);
    assert.equal(p.exitCutBonus, undefined);
    assert.equal(p.headOnBounty, undefined);
  }
});
