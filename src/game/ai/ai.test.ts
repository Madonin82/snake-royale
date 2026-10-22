import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAIPlan, calculateAIAction, calculateAIMove, calculateAIMoveCandidates, planDiverged } from './index';
import { canAffordQueuedDart, isValidDartDirection } from '../skills';
import { GameState, Snake } from '../../types/game';

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

function makeState(p1: Partial<Snake>, p2: Partial<Snake>, overrides: Partial<GameState> = {}): GameState {
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
    phaseTurnsRemaining: 20,
    totalThinkTime: {},
    lastTurnTimes: null,
    phaseEndTime: 0,
    phaseTimeRemaining: 0,
    turnBased: true,
    ...overrides,
  } as GameState;
}

test('avalena hunts on wallet lead: darts, but never suicides into the head cell', () => {
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
  assert.equal(action.skill?.direction, 'UP');
  assert.equal(action.direction, 'UP');
});

test('avalena farms on token lead alone: wallet tied means no hunt', () => {
  const state = makeState(
    { skillPoints: 3, score: 0 },
    { skillPoints: 3, score: 10, body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT');
});

test('avalena returns to farming after spending: wallet lead lost', () => {
  const state = makeState(
    { skillPoints: 1, score: 4 },
    { skillPoints: 1, score: 8, body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], direction: 'UP' },
  );
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'avalena', 'immediate');
  assert.equal(action.skill, null);
  assert.equal(action.direction, 'RIGHT');
});

test('uppercase AVALENA style reaches the avalena brain', () => {
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.equal(action.skill?.skillId, 'dart');
});

test('avalena dart decision passes the same legality gates as a player dart', () => {
  const state = makeState({ skillPoints: 1, score: 0 }, { skillPoints: 5, score: 0 });
  const action = calculateAIAction(state, 8, 'p2', 'HARD', 'AVALENA', 'immediate');
  assert.ok(action.skill);
  const p2 = state.snakes[1];
  assert.ok(isValidDartDirection(p2.direction, action.skill.direction));
  assert.ok(canAffordQueuedDart(p2.skillPoints, 0));
});

test('opportunist builds beam plan on MEDIUM and HARD', () => {
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }], direction: 'DOWN' },
    { tokens: [{ x: 4, y: 6 }] },
  );
  const planMedium = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'MEDIUM',
    aiStyle: 'OPPORTUNIST',
    raceTurns: 20,
  });
  assert.ok(planMedium.plan.length > 0);
  assert.equal(planMedium.plan[0].direction, 'DOWN');

  const planHard = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'HARD',
    aiStyle: 'opportunist',
    raceTurns: 20,
  });
  assert.ok(planHard.plan.length > 0);
  assert.equal(planHard.plan[0].direction, 'DOWN');
});

test('opportunist on EASY uses greedy path', () => {
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }], direction: 'DOWN' },
    { tokens: [{ x: 4, y: 6 }] },
  );
  const plan = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'EASY',
    aiStyle: 'opportunist',
    raceTurns: 20,
  });
  assert.ok(plan.plan.length > 0);
  assert.equal(plan.plan[0].direction, 'DOWN');
});

test('legacy brain returns valid moves across all difficulty faces', () => {
  const state = makeState(
    { body: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
    { body: [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }], direction: 'DOWN' },
    { tokens: [{ x: 4, y: 6 }] },
  );

  const easyPlan = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'EASY',
    aiStyle: 'LEGACY_EASY',
    raceTurns: 20,
  });
  assert.ok(easyPlan.plan.length > 0);
  assert.ok(['DOWN', 'RIGHT', 'LEFT'].includes(easyPlan.plan[0].direction!));

  const medPlan = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'MEDIUM',
    aiStyle: 'LEGACY_MEDIUM',
    raceTurns: 20,
  });
  assert.ok(medPlan.plan.length > 0);
  assert.equal(medPlan.plan[0].direction, 'DOWN');

  const hardPlan = buildAIPlan({
    gameState: state,
    gridSize: 8,
    botRole: 'p2',
    difficulty: 'HARD',
    aiStyle: 'LEGACY_HARD',
    raceTurns: 20,
  });
  assert.ok(hardPlan.plan.length > 0);
  assert.equal(hardPlan.plan[0].direction, 'DOWN');
});

test('planDiverged detects actual snake deviations from projections', () => {
  const projections = [
    {
      p1: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
    },
  ];
  const snakesMatching: Snake[] = [
    makeSnake({ id: 'p1', body: [{ x: 2, y: 5 }, { x: 1, y: 5 }], isAlive: true }),
  ];
  const snakesDiverged: Snake[] = [
    makeSnake({ id: 'p1', body: [{ x: 3, y: 5 }, { x: 2, y: 5 }], isAlive: true }),
  ];

  assert.equal(planDiverged(projections, 1, snakesMatching), false);
  assert.equal(planDiverged(projections, 1, snakesDiverged), true);
  assert.equal(planDiverged(projections, 0, snakesDiverged), false);
});
