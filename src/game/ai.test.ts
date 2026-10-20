import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAIPlan, calculateAIAction, calculateAIMove, calculateAIMoveCandidates, planDiverged } from './ai';
import { canAffordQueuedDart, isValidDartDirection } from './skills';
import { GameState, Snake } from '../types/game';

function makeSnake(overrides: Partial<Snake>): Snake {
  return {
    id: 'p2',
    name: 'AVALENA',
    body: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
    direction: 'LEFT',
    queuedDirection: null,
    score: 0,
    skillPoints: 0,
    isAlive: true,
    color: '#000',
    equippedSkill: 'dart',
    pendingSkill: null,
    ...overrides,
  } as Snake;
}

function makeState(p1: Partial<Snake>, p2: Partial<Snake>): GameState {
  return {
    phase: 'TOKEN_RACE',
    tick: 0,
    turn: 0,
    snakes: [
      makeSnake({ id: 'p1', name: 'PLAYER 1', body: [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], direction: 'RIGHT', ...p1 }),
      makeSnake({ ...p2 }),
    ],
    tokens: [{ x: 7, y: 7 }],
    ringInset: 0,
    skillsAvailable: 'immediate',
  } as GameState;
}

test('avalena hunts on wallet lead: darts, but never suicides into the head cell', () => {
  // Wallet lead of 4 → hunt phase. The head-aimed dart (LEFT, ending on the
  // player's head cell) is now correctly rejected as unsafe — the darter
  // would die. She fires the safe dart (UP) instead of suiciding.
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
  assert.equal(action.skill?.direction, 'UP'); // safe path, not the head cell
  assert.equal(action.direction, 'UP');
});

test('avalena farms on token lead alone: wallet tied means no hunt', () => {
  // 10 tokens ahead but wallets tied → farm phase (token lead doesn't trigger the hunt)
  // Body trails downward so RIGHT (toward the token) is clearly best.
  const state = makeState(
    { skillPoints: 3, score: 0 },
    { skillPoints: 3, score: 10, body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT'); // toward the token at (7,7), not the player
});

test('avalena returns to farming after spending: wallet lead lost', () => {
  // Was hunting (5 vs 1), spent two darts (now 1 vs 1) → back to farming
  const state = makeState(
    { skillPoints: 1, score: 4 },
    { skillPoints: 1, score: 8, body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT'); // farming again despite token lead
});

test('uppercase AVALENA style (as stored by the editor) also reaches the avalena brain', () => {
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
});

test('avalena dart decision passes the same legality gates as a player dart', () => {
  // In dart range with a wallet lead: the brain's skill must survive the
  // buffer legality checks (direction valid vs current heading, affordable).
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.ok(action.skill);
  const p2 = state.snakes[1];
  assert.ok(isValidDartDirection(p2.direction, action.skill.direction));
  assert.ok(canAffordQueuedDart(p2.skillPoints, 0));
});

test('avalena takes the dart when the snipe is lethal (wins the tiebreak)', () => {
  // Oddity #3 revisited with the snipe rule: p2 plans DART UP from (2,6).
  // p1 at (1,4) can reach (2,4) on sub-step 0 — but p2 holds the tiebreak
  // (3 pts > 0), so the reachable set is a kill opportunity, not a threat.
  // The dart must fire.
  const state = makeState(
    { body: [{ x: 1, y: 4 }, { x: 1, y: 3 }, { x: 1, y: 2 }], direction: 'DOWN', skillPoints: 0 },
    { body: [{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 7 }], direction: 'LEFT', skillPoints: 3 },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
  assert.equal(action.skill?.direction, 'UP');
});

test('avalena refuses a dart crossing a non-lethal opponent\'s reachable set', () => {
  // Three snakes: p2 hunts p1 (3 pts > 0, snipe lethal vs p1), but p3 holds
  // the tiebreak over p2 (5 pts > 3). The UP dart path crosses p3's reachable
  // set at (2,4) — p3 is not snipable, so that path stays a threat and no
  // safe dart exists.
  const state = makeState(
    { body: [{ x: 1, y: 4 }, { x: 1, y: 3 }, { x: 1, y: 2 }], direction: 'DOWN', skillPoints: 0 },
    { body: [{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }], direction: 'LEFT', skillPoints: 3 },
  );
  state.snakes.push(makeSnake({
    id: 'p3', name: 'P3',
    body: [{ x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 2 }], direction: 'LEFT',
    skillPoints: 5,
  }));
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.equal(action.skill, null); // no safe dart → falls back to hunt move
  assert.ok(action.direction);
});

test('avalena evaluates the dart path in the dart direction, not the facing', () => {
  // p2 faces UP but considers darting LEFT. The old code evaluated step 1 in
  // the facing direction (into a wall); the engine flies all 3 cells in the
  // dart direction, so the LEFT path is actually clear and must fire.
  const state = makeState(
    { body: [{ x: 5, y: 2 }, { x: 5, y: 1 }, { x: 5, y: 0 }], direction: 'DOWN', skillPoints: 1 },
    { body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP', skillPoints: 5 },
  );
  state.walls = [{ x: 5, y: 4 }];
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
  assert.equal(action.skill?.direction, 'LEFT');
});

test('greedy bot does not chase a token the opponent reaches first', () => {
  // Token A at (1,5) is closer to p1's head (0,5) than to p2 after any move —
  // racing for it is suicide. p2 must prefer the uncontested token B.
  const state = makeState(
    { body: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], direction: 'RIGHT' },
    { body: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }], direction: 'LEFT' },
  );
  state.tokens = [{ x: 1, y: 5 }, { x: 5, y: 0 }];
  assert.equal(calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY'), 'UP');
});

test('head-on avoidance follows the points tiebreak, not tokens', () => {
  // p2 is behind on points (1<5): a mutual head-on loses the tiebreak, so
  // HARD strongly avoids it (-50) even though the token straight ahead is
  // tempting. The old token-based logic only penalized -10 here and walked
  // into the losing trade.
  const state = makeState(
    { body: [{ x: 5, y: 3 }, { x: 5, y: 2 }, { x: 5, y: 1 }], direction: 'DOWN', skillPoints: 5, score: 5 },
    { body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], direction: 'UP', skillPoints: 1, score: 1 },
  );
  state.tokens = [{ x: 5, y: 4 }, { x: 4, y: 7 }];
  assert.equal(calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY'), 'LEFT');
});

test('greedy vetos a losing head-on even when the token sits on the collision cell', () => {
  // Replay 20261010-1519, tick 15: p2 at (6,5) facing DOWN, p1 at (5,6) facing
  // LEFT, token at (5,5). LEFT grabs the token but walks into p1's reachable
  // set — and p2 loses the tiebreak 1 < 4. The -50 nudge wasn't enough against
  // a 160-point token; the losing trade must be vetoed.
  const state = makeState(
    {
      body: [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }, { x: 4, y: 6 }, { x: 4, y: 5 }],
      direction: 'LEFT', skillPoints: 4, score: 4,
    },
    {
      body: [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }],
      direction: 'DOWN', skillPoints: 1, score: 0,
    },
  );
  state.tokens = [{ x: 5, y: 5 }, { x: 0, y: 0 }];
  // DOWN is p1's neck (hard skip), LEFT is the vetoed losing trade → RIGHT.
  assert.equal(calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY'), 'RIGHT');
});

test('dead-end veto rejects moves leading to a reachable area smaller than snake body length', () => {
  const state = makeState(
    { body: [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }], direction: 'UP' },
    { body: [{ x: 7, y: 7 }, { x: 7, y: 6 }], direction: 'DOWN' },
  );
  state.walls = [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    { x: 2, y: 3 }, { x: 4, y: 3 }
  ];
  state.tokens = [{ x: 0, y: 0 }];
  const move = calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY');
  assert.notEqual(move, 'UP');
});

test('HARD bot with tokensSinceLock=1 still seeks tokens (chain mult active)', () => {
  // Token directly ahead. The 2x chain multiplier (tsl=1 → min(2,3)=2) must
  // not break token seeking — the bot still moves toward the token.
  // (The multiplier's exact 2x/3x values are verified by code inspection;
  // token scores dominate area scores, so a decision-flip test would need
  // fragile flood-fill tuning. Live playtesting validates the bias.)
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 1, y: 0 }], direction: 'RIGHT' },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], direction: 'UP', skillPoints: 0, tokensSinceLock: 1 },
  );
  state.tokens = [{ x: 4, y: 2 }];
  assert.equal(calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY'), 'UP');
});

test('MEDIUM chain multiplier caps at 2x with tsl=5 (no breakage)', () => {
  // MEDIUM with tsl=5: min(5+1, 2) = 2x. The cap must not break seeking —
  // the bot still moves toward the token.
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 1, y: 0 }], direction: 'RIGHT' },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], direction: 'UP', skillPoints: 0, tokensSinceLock: 5 },
  );
  state.tokens = [{ x: 4, y: 2 }];
  assert.equal(calculateAIMove(state, 8, 'p2', 'MEDIUM', 'GREEDY'), 'UP');
});

test('trapped fallback picks largest survivable flood area, not blind validDirs[0]', () => {
  // Replay 20261014-1628, tick 59: bot head (1,0) facing RIGHT, 18-coil body
  // top-left, opponent walling the right side. UP (wall) and DOWN (own body)
  // vetoed correctly; RIGHT vetoed by flood-fill (area 15 < length 18).
  // Old fallback returned 'UP' (wall suicide). New fallback excludes
  // certain-death moves and picks RIGHT (15 cells of survivable room).
  const state = makeState(
    {
      body: [
        { x: 6, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 },
        { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }, { x: 5, y: 7 },
        { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 6 }, { x: 7, y: 5 },
        { x: 7, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 },
        { x: 5, y: 6 }, { x: 5, y: 5 },
      ],
      direction: 'RIGHT', skillPoints: 21, score: 15,
    },
    {
      body: [
        { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
        { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 },
        { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 },
        { x: 1, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 5 }, { x: 0, y: 4 },
        { x: 0, y: 3 }, { x: 0, y: 2 },
      ],
      direction: 'RIGHT', skillPoints: 16, score: 15, tokensSinceLock: 1,
    },
  );
  state.tokens = [
    { x: 7, y: 2 }, { x: 0, y: 7 }, { x: 7, y: 3 },
    { x: 3, y: 0 }, { x: 3, y: 5 }, { x: 2, y: 0 },
  ];
  assert.equal(calculateAIMove(state, 8, 'p2', 'HARD', 'GREEDY'), 'RIGHT');
});

test('EASY chain multiplier is 1x — token seeking unchanged', () => {
  // EASY ignores tokensSinceLock (1x). The bot still seeks the token, and
  // the deliberate (non-random) move is UP. Run multiple times to average
  // out the 25% randomness — UP must be the most common deliberate choice.
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 1, y: 0 }], direction: 'RIGHT' },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], direction: 'UP', skillPoints: 0, tokensSinceLock: 5 },
  );
  state.tokens = [{ x: 4, y: 2 }];
  let upCount = 0;
  for (let i = 0; i < 40; i++) {
    if (calculateAIMove(state, 8, 'p2', 'EASY', 'GREEDY') === 'UP') upCount++;
  }
  // Deliberate UP (75%) + random UP (~25% of 25% ≈ 6%) ≈ 81% expected.
  // Assert UP is clearly the dominant move (not suppressed by a leaked mult).
  assert.ok(upCount >= 25, `EASY should still seek token UP (got ${upCount}/40)`);
});

// ============================================================
// Bot-balance spec fixtures (Oct 20 2026). Boards are reconstructed
// from the batch replays Jimmy played against the HARD bot
// (snake-royale-replay-20261020-1232 / -1235 / -1240) — the three
// traced endings the spec's acceptance criteria name.
// ============================================================

function fixtureSnake(id: string, body: [number, number][], direction: Snake['direction'], extra: Partial<Snake>): Snake {
  return {
    id,
    name: id.toUpperCase(),
    body: body.map(([x, y]) => ({ x, y })),
    direction,
    queuedDirection: null,
    score: 0,
    skillPoints: 0,
    isAlive: true,
    color: '#000',
    equippedSkill: null,
    pendingSkill: null,
    tokensSinceLock: 0,
    spEarned: 0,
    ...extra,
  } as Snake;
}

function fixtureState(snakes: Snake[], tokens: [number, number][], extra: Partial<GameState>): GameState {
  return {
    tick: 0,
    turnBased: true,
    phaseTurnsRemaining: 30,
    lastTurnTimes: null,
    totalThinkTime: {},
    phase: 'RACING',
    phaseTimeRemaining: 0,
    phaseEndTime: 0,
    round: 1,
    tokens: tokens.map(([x, y]) => ({ x, y })),
    snakes,
    ringInset: 0,
    skillsAvailable: 'immediate',
    ...extra,
  } as GameState;
}

const STEP: Record<string, [number, number]> = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

function planHeads(state: GameState, botId: string, plan: { direction: string }[]): { x: number; y: number }[] {
  const bot = state.snakes.find(s => s.id === botId)!;
  let head = bot.body[0];
  return plan.map(entry => {
    const [dx, dy] = STEP[entry.direction];
    head = { x: head.x + dx, y: head.y + dy };
    return head;
  });
}

test('bot-balance 1232: the plan never steps onto the token the opponent is projected to take', () => {
  // Replay 1232, tick 27 — the board the bot locked [LEFT, LEFT, UP]
  // from and died head-on at (3,3). The sim now projects Jimmy diving
  // (4,1) -> (3,1) -> (3,2) -> (3,3): he takes the token and grows.
  const state = fixtureState([
    fixtureSnake('p1', [[4, 1], [5, 1], [5, 2], [5, 3], [6, 3], [7, 3], [7, 2], [7, 1]], 'LEFT', { score: 5, skillPoints: 6, tokensSinceLock: 2, spEarned: 6 }),
    fixtureSnake('p2', [[5, 4], [6, 4], [7, 4], [7, 5], [6, 5], [5, 5]], 'LEFT', { score: 3, skillPoints: 3 }),
  ], [[0, 1], [3, 3]], { tick: 27, phaseTurnsRemaining: 33, round: 4 });
  const result = buildAIPlan({ gameState: state, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 60, intent: null });
  const heads = planHeads(state, 'p2', result.plan);
  assert.ok(heads.length > 0, 'planner produced a plan');
  for (const h of heads) {
    assert.ok(!(h.x === 3 && h.y === 3), `plan steps onto (3,3): ${JSON.stringify(result.plan)}`);
  }
  // The mechanism, not luck: the final projection has Jimmy ON (3,3).
  const finalProj = result.projections[result.projections.length - 1];
  assert.equal(finalProj.p1[0].x, 3);
  assert.equal(finalProj.p1[0].y, 3);
});

test('bot-balance 1235: contesting a head-on the bot wins stays allowed (not vetoed)', () => {
  // Replay 1235 at the route's last ply: bot on (7,5) facing RIGHT,
  // token on (7,4) inside Jimmy's reach — but the bot wins that
  // tiebreak (SP 8 vs 7), so UP must survive as a candidate.
  const state = fixtureState([
    fixtureSnake('p1', [[6, 4], [6, 3], [6, 2], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 1]], 'DOWN', { score: 6, skillPoints: 7, spEarned: 7 }),
    fixtureSnake('p2', [[7, 5], [6, 5], [5, 5], [4, 5], [4, 4], [4, 3], [3, 3], [3, 4], [3, 5], [3, 6]], 'RIGHT', { score: 7, skillPoints: 8, spEarned: 8 }),
  ], [[7, 6], [7, 4]], { tick: 46, phaseTurnsRemaining: 14, round: 5 });
  const candidates = calculateAIMoveCandidates(state, 8, 'p2', 'HARD');
  assert.ok(candidates.some(c => c.dir === 'UP'), `UP (the (7,4) contest) must not be vetoed: ${JSON.stringify(candidates)}`);
});

test('bot-balance 1235: the plan still takes a token on the winning race board', () => {
  // Replay 1235, tick 44 — the bot beelined (7,4) and won the head-on.
  // The planner must keep racing: some token falls by the final ply,
  // and no ply lands inside the projected opponent body.
  const state = fixtureState([
    fixtureSnake('p1', [[6, 2], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 0]], 'DOWN', { score: 6, skillPoints: 7, spEarned: 7 }),
    fixtureSnake('p2', [[5, 5], [4, 5], [3, 5], [2, 5], [2, 4], [2, 3], [1, 3], [1, 4], [1, 5], [1, 6]], 'RIGHT', { score: 7, skillPoints: 8, spEarned: 8 }),
  ], [[7, 6], [7, 4]], { tick: 44, phaseTurnsRemaining: 16, round: 5 });
  const result = buildAIPlan({ gameState: state, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 60, intent: null });
  const heads = planHeads(state, 'p2', result.plan);
  const finalHead = heads[heads.length - 1];
  assert.ok(
    (finalHead.x === 7 && finalHead.y === 4) || (finalHead.x === 7 && finalHead.y === 6),
    `plan should end on a token, ended at (${finalHead.x},${finalHead.y}): ${JSON.stringify(result.plan)}`,
  );
  heads.forEach((h, i) => {
    const projBody = result.projections[i]?.p1 ?? [];
    assert.ok(!projBody.some(c => c.x === h.x && c.y === h.y), `ply ${i} head (${h.x},${h.y}) inside projected body`);
  });
});

test('bot-balance 1240: no ply enters a cell the projection shows occupied', () => {
  // Replay 1240, tick 71 — shrink endgame, every flood-fill veto
  // fails (36-cell box, 27 occupied). Outcome-based on purpose (the
  // historical fatal step was RIGHT into the body): the produced
  // plan, whatever its shape, must not route into the projected body.
  const state = fixtureState([
    fixtureSnake('p1', [[3, 2], [4, 2], [4, 3], [5, 3], [6, 3], [7, 3], [7, 2], [7, 1], [7, 0], [6, 0], [6, 1], [5, 1], [4, 1], [3, 1]], 'LEFT', { score: 11, skillPoints: 15, spEarned: 15 }),
    fixtureSnake('p2', [[3, 4], [3, 5], [4, 5], [4, 6], [3, 6], [2, 6], [2, 5], [2, 4], [1, 4], [0, 4], [0, 3], [1, 3], [2, 3]], 'UP', { score: 10, skillPoints: 12, spEarned: 12 }),
  ], [], { tick: 71, phaseTurnsRemaining: 5, round: 6, phase: 'SHRINKING', ringInset: 1 });
  const result = buildAIPlan({ gameState: state, gridSize: 8, botRole: 'p2', difficulty: 'HARD', raceTurns: 60, intent: null });
  const heads = planHeads(state, 'p2', result.plan);
  assert.ok(heads.length > 0, 'planner produced a plan');
  heads.forEach((h, i) => {
    const projBody = result.projections[i]?.p1 ?? [];
    assert.ok(!projBody.some(c => c.x === h.x && c.y === h.y), `ply ${i} head (${h.x},${h.y}) inside projected body`);
  });
});

test('planDiverged: matching projection is not a divergence; a shifted or dead opponent is', () => {
  const body = [{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 2 }];
  const projections = [{ p1: body.map(c => ({ ...c })) }];
  const alive = (cells: { x: number; y: number }[]) =>
    ({ id: 'p1', body: cells, isAlive: true } as Snake);
  assert.equal(planDiverged(projections, 0, [alive(body)]), false); // nothing executed yet
  assert.equal(planDiverged(projections, 1, [alive(body)]), false); // world matches projection
  assert.equal(planDiverged(projections, 1, [alive([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }])]), true); // veered
  assert.equal(planDiverged(projections, 1, [{ id: 'p1', body, isAlive: false } as Snake]), true); // died
  assert.equal(planDiverged(projections, 1, []), true); // gone entirely
});
