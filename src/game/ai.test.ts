import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAIAction, calculateAIMove } from './ai';
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
