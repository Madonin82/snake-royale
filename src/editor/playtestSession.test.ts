import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAIMove } from '../game/ai';
import { processGameTick, queueSnakeDirection } from '../game/engine';
import { isCampaignObjectiveComplete } from '../game/objectives';
import { CampaignLevel } from './levelSchema';
import {
  createCampaignPlaytestState,
  createMultiplayerCustomLevelState,
  getCampaignPlaytestSettings,
  getExportableCampaignLevel,
  getMultiplayerCustomLevelSettings,
  parseCampaignLevelJson,
} from './playtestSession';

const createLevel = (): CampaignLevel => ({
  id: 'playtest',
  name: 'PLAYTEST',
  description: 'TEST ARENA',
  gridSize: 8,
  walls: [],
  spawns: [
    { position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 3, startingScore: 0, aiStyle: 'GREEDY' },
    { position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 5, startingScore: 0, aiStyle: 'TURTLE' },
  ],
  tokens: {
    positions: [],
    count: 2,
    respawn: true,
    mode: 'ESCALATING',
  },
  phases: {
    raceTurns: 40,
    shrinkEveryTurns: 6,
  },
  objectives: {
    primary: 'TEST',
    bonus: [],
  },
});

const getSnake = (state: ReturnType<typeof createCampaignPlaytestState>, id: string) =>
  state.snakes.find(snake => snake.id === id)!;

test('campaign playtest starts at configured spawns with configured lengths and AI difficulty', () => {
  const level = createLevel();
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.equal(settings.gridSize, level.gridSize);
  assert.equal(settings.raceTurns, level.phases.raceTurns);
  assert.equal(settings.shrinkEveryTurns, level.phases.shrinkEveryTurns);
  assert.equal(settings.botDifficulty, 'EASY');
  assert.equal(settings.levelId, level.id);
  assert.equal(settings.levelName, level.name);
  assert.equal(settings.aiStyle, level.spawns[1].aiStyle);
  assert.equal(state.campaignObjectives?.primary, null);
  assert.deepEqual(getSnake(state, 'p1').body[0], level.spawns[0].position);
  assert.equal(getSnake(state, 'p1').direction, level.spawns[0].direction);
  assert.equal(getSnake(state, 'p1').body.length, level.spawns[0].startLength);
  assert.deepEqual(getSnake(state, 'p2').body[0], level.spawns[1].position);
  assert.equal(getSnake(state, 'p2').direction, level.spawns[1].direction);
  assert.equal(getSnake(state, 'p2').body.length, level.spawns[1].startLength);
  assert.equal(state.tokens.length, 2);
  assert.equal(getSnake(state, 'p1').score, 0);
  assert.equal(getSnake(state, 'p2').score, 0);
  assert.equal(state.campaignTokenRules?.count, 2);
});

test('campaign playtest builds P3 with its own AI style, painted body, and starting score', () => {
  const level = createLevel();
  level.spawns.push({
    position: { x: 1, y: 6 },
    direction: 'UP',
    startLength: 99,
    startingScore: 17,
    aiStyle: 'HEADHUNTER',
    body: [{ x: 1, y: 6 }, { x: 2, y: 6 }],
  });
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.equal(state.snakes.length, 3);
  assert.equal(settings.campaignAiDifficulties?.p2, 'EASY');
  assert.equal(settings.campaignAiDifficulties?.p3, 'HARD');
  assert.deepEqual(getSnake(state, 'p3').body, level.spawns[2].body);
  assert.equal(getSnake(state, 'p3').score, 17);
  assert.equal(getSnake(state, 'p3').skillPoints, 17); // starting score fills both counters
});

test('disabled spawn is excluded from exported JSON and playtest runs with 2 snakes', () => {
  const level = createLevel();
  level.spawns.push({
    enabled: false,
    position: { x: 1, y: 6 },
    direction: 'UP',
    startLength: 3,
    startingScore: 0,
    aiStyle: 'HEADHUNTER',
  });

  const exported = getExportableCampaignLevel(level);
  assert.equal(exported.spawns.length, 2);
  assert.equal('enabled' in exported.spawns[0], false);

  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);
  assert.equal(state.snakes.length, 2);
  assert.deepEqual(state.snakes.map(snake => snake.id), ['p1', 'p2']);
  assert.equal(settings.campaignAiDifficulties?.p3, undefined);
});

test('campaign walls are rendered as blocked cells and rejected by the AI', () => {
  const level = createLevel();
  level.walls = [{ x: 3, y: 2 }, { x: 4, y: 3 }];
  level.spawns[0] = { ...level.spawns[0], position: { x: 2, y: 2 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 3, y: 3 }, direction: 'RIGHT', startLength: 1, aiStyle: 'GREEDY' };
  level.tokens.positions = [{ x: 6, y: 2 }];
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.deepEqual(state.walls, level.walls);
  assert.notEqual(calculateAIMove(state, settings.gridSize, 'p2', settings.botDifficulty), 'RIGHT');

  queueSnakeDirection(getSnake(state, 'p1'), 'RIGHT');
  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.phase, 'OVER');
  assert.equal(getSnake(nextState, 'p1').deathReason, 'WALL');
});

test('campaign playtest uses starting scores and painted tokens', () => {
  const level = createLevel();
  level.spawns[0].startingScore = 0;
  level.spawns[1].startingScore = 20;
  level.tokens.count = 3;
  level.tokens.positions = [{ x: 2, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }];

  const state = createCampaignPlaytestState(level);

  assert.equal(getSnake(state, 'p1').score, 0);
  assert.equal(getSnake(state, 'p2').score, 20);
  assert.deepEqual(state.tokens, level.tokens.positions);
});

test('campaign playtest uses a painted body exactly without auto-filling it', () => {
  const level = createLevel();
  const paintedBody = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ];
  level.gridSize = 4;
  level.spawns[0] = { ...level.spawns[0], position: paintedBody[0], startLength: 99, body: paintedBody };
  level.spawns[1] = { ...level.spawns[1], position: { x: 3, y: 3 }, startLength: 1, body: [{ x: 3, y: 3 }] };

  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.equal(settings.gridSize, 4);
  assert.deepEqual(getSnake(state, 'p1').body, paintedBody);
  assert.deepEqual(getSnake(state, 'p2').body, [{ x: 3, y: 3 }]);
});

test('campaign playtest tracks objective token collection during gameplay', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens = {
    positions: [{ x: 2, y: 1 }],
    count: 1,
    respawn: false,
    mode: 'FIXED_SET',
  };
  level.objectives.primary = 'collect:1';
  const settings = getCampaignPlaytestSettings(level);
  const initialState = createCampaignPlaytestState(level, settings);
  const state = processGameTick(initialState, settings, 0).nextState;

  assert.equal(state.campaignObjectives?.p1TokensCollected, 1);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives!.primary!, state, 0), true);
});

test('campaign playtest spawns the configured count and safely skips unavailable cells', () => {
  const level = createLevel();
  level.tokens.count = 3;
  const state = createCampaignPlaytestState(level);
  assert.equal(state.tokens.length, 3);

  const fullBoard = createLevel();
  fullBoard.spawns[0] = { ...fullBoard.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  fullBoard.spawns[1] = { ...fullBoard.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  fullBoard.walls = Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 8 }, (_, y) => ({ x, y })),
  ).flat().filter(({ x, y }) => !(x === 1 && y === 1) && !(x === 6 && y === 6));
  fullBoard.tokens.count = 3;
  assert.deepEqual(createCampaignPlaytestState(fullBoard).tokens, []);
});

test('campaign playtest with FIXED and respawn disabled ends the race when its final tokens are collected', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens.count = 5;
  level.tokens.respawn = false;
  level.tokens.mode = 'FIXED';
  level.tokens.positions = [2, 3, 4, 5, 6].map(x => ({ x, y: 1 }));
  const settings = getCampaignPlaytestSettings(level);
  let state = createCampaignPlaytestState(level, settings);

  for (let i = 0; i < 5; i++) {
    state = processGameTick(state, settings, 0).nextState;
  }

  assert.equal(getSnake(state, 'p1').score, 5);
  assert.equal(state.tokens.length, 0);
  assert.equal(state.phase, 'SHRINKING');
});

test('ESCALATING with respawn disabled waits until all round tokens are cleared before spawning the next wave', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens = {
    positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    count: 2,
    respawn: false,
    mode: 'ESCALATING',
  };
  const settings = getCampaignPlaytestSettings(level);
  let state = createCampaignPlaytestState(level, settings);

  // Eat first token of round 1 -> 1 token left on board, no respawn yet
  state = processGameTick(state, settings, 0).nextState;
  assert.equal(state.round, 1);
  assert.equal(state.tokens.length, 1);
  assert.equal(state.phase, 'RACING');

  // Eat final token of round 1 -> board clears, round 2 spawns wave of 3 tokens
  state = processGameTick(state, settings, 0).nextState;
  assert.equal(state.round, 2);
  assert.equal(state.tokens.length, 3);
  assert.equal(state.phase, 'RACING');
});

test('FIXED keeps its configured token count across rounds', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens = {
    positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    count: 2,
    respawn: true,
    mode: 'FIXED',
  };
  const settings = getCampaignPlaytestSettings(level);
  let state = createCampaignPlaytestState(level, settings);

  state = processGameTick(state, settings, 0).nextState;
  state = processGameTick(state, settings, 0).nextState;

  assert.equal(state.round, 2);
  assert.equal(state.tokens.length, 2);
  assert.equal(
    state.tokens.some(token => state.snakes.some(snake =>
      snake.body.some(segment => segment.x === token.x && segment.y === token.y),
    )),
    false,
  );
});

test('ESCALATING increases its token count each round', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens = {
    positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    count: 2,
    respawn: true,
    mode: 'ESCALATING',
  };
  const settings = getCampaignPlaytestSettings(level);
  let state = createCampaignPlaytestState(level, settings);

  state = processGameTick(state, settings, 0).nextState;
  state = processGameTick(state, settings, 0).nextState;

  assert.equal(state.round, 2);
  assert.equal(state.tokens.length, 3);
});

test('FIXED_SET forces respawn off regardless of the configured toggle', () => {
  const level = createLevel();
  level.spawns[0] = { ...level.spawns[0], position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 1 };
  level.spawns[1] = { ...level.spawns[1], position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 1, aiStyle: 'TURTLE' };
  level.tokens = {
    positions: [{ x: 2, y: 1 }],
    count: 1,
    respawn: true,
    mode: 'FIXED_SET',
  };
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.equal(state.campaignTokenRules?.respawn, false);
  const nextState = processGameTick(state, settings, 0).nextState;
  assert.equal(nextState.tokens.length, 0);
  assert.equal(nextState.phase, 'SHRINKING');
});

test('campaign AI styles map to the requested temporary game difficulties', () => {
  const level = createLevel();
  const expected = {
    GREEDY: 'HARD',
    TURTLE: 'EASY',
    CUTOFF: 'MEDIUM',
    HEADHUNTER: 'HARD',
    PATROL: 'MEDIUM',
  } as const;

  for (const [aiStyle, difficulty] of Object.entries(expected)) {
    level.spawns[1].aiStyle = aiStyle as CampaignLevel['spawns'][number]['aiStyle'];
    assert.equal(getCampaignPlaytestSettings(level).botDifficulty, difficulty);
  }
});

test('multiplayer custom level applies 12x12 grid, walls, token config, startingScore, and caps at 2 human spawns', () => {
  const level = createLevel();
  level.gridSize = 12;
  level.walls = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
  level.spawns = [
    { position: { x: 2, y: 2 }, direction: 'DOWN', startLength: 4, startingScore: 3, aiStyle: 'HEADHUNTER' },
    { position: { x: 9, y: 9 }, direction: 'UP', startLength: 5, startingScore: 7, aiStyle: 'TURTLE' },
    { position: { x: 2, y: 9 }, direction: 'RIGHT', startLength: 3, startingScore: 99, aiStyle: 'GREEDY' },
  ];
  level.tokens = {
    positions: [{ x: 4, y: 4 }, { x: 7, y: 7 }],
    count: 2,
    respawn: false,
    mode: 'FIXED',
  };

  const parsed = parseCampaignLevelJson(JSON.stringify(level));
  const settings = getMultiplayerCustomLevelSettings(parsed);
  const state = createMultiplayerCustomLevelState(parsed, settings, { p1: 'HOST', p2: 'GUEST' });

  assert.equal(settings.gridSize, 12);
  assert.equal(state.gridSize, 12);
  assert.deepEqual(state.walls, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  assert.equal(state.snakes.length, 2);
  assert.deepEqual(state.snakes.map(s => s.id), ['p1', 'p2']);
  assert.equal(getSnake(state, 'p1').name, 'HOST');
  assert.equal(getSnake(state, 'p2').name, 'GUEST');
  assert.deepEqual(getSnake(state, 'p1').body[0], { x: 2, y: 2 });
  assert.equal(getSnake(state, 'p1').direction, 'DOWN');
  assert.equal(getSnake(state, 'p1').body.length, 4);
  assert.equal(getSnake(state, 'p1').score, 3);
  assert.deepEqual(getSnake(state, 'p2').body[0], { x: 9, y: 9 });
  assert.equal(getSnake(state, 'p2').direction, 'UP');
  assert.equal(getSnake(state, 'p2').body.length, 5);
  assert.equal(getSnake(state, 'p2').score, 7);
  assert.deepEqual(state.tokens, [{ x: 4, y: 4 }, { x: 7, y: 7 }]);
  assert.deepEqual(state.campaignTokenRules, {
    count: 2,
    respawn: false,
    mode: 'FIXED',
    tokensEatenInRound: 0,
  });
});
