import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAIMove } from '../game/ai';
import { processGameTick, queueSnakeDirection } from '../game/engine';
import { CampaignLevel } from './levelSchema';
import {
  createCampaignPlaytestState,
  getCampaignPlaytestSettings,
} from './playtestSession';

const createLevel = (): CampaignLevel => ({
  id: 'playtest',
  name: 'PLAYTEST',
  description: 'TEST ARENA',
  gridSize: 8,
  walls: [],
  playerSpawn: {
    position: { x: 1, y: 1 },
    direction: 'RIGHT',
    startLength: 3,
  },
  opponentSpawn: {
    position: { x: 6, y: 6 },
    direction: 'LEFT',
    startLength: 5,
    aiStyle: 'TURTLE',
  },
  tokens: {
    positions: [],
    count: 2,
    respawn: true,
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

test('campaign playtest starts at configured spawns with configured lengths and AI difficulty', () => {
  const level = createLevel();
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.equal(settings.gridSize, level.gridSize);
  assert.equal(settings.raceTurns, level.phases.raceTurns);
  assert.equal(settings.shrinkEveryTurns, level.phases.shrinkEveryTurns);
  assert.equal(settings.botDifficulty, 'EASY');
  assert.deepEqual(state.snakes.p1.body[0], level.playerSpawn.position);
  assert.equal(state.snakes.p1.direction, level.playerSpawn.direction);
  assert.equal(state.snakes.p1.body.length, level.playerSpawn.startLength);
  assert.deepEqual(state.snakes.p2.body[0], level.opponentSpawn.position);
  assert.equal(state.snakes.p2.direction, level.opponentSpawn.direction);
  assert.equal(state.snakes.p2.body.length, level.opponentSpawn.startLength);
  assert.equal(state.tokens.length, 1);
});

test('campaign walls are rendered as blocked cells and rejected by the AI', () => {
  const level = createLevel();
  level.walls = [{ x: 3, y: 2 }, { x: 4, y: 3 }];
  level.playerSpawn = { position: { x: 2, y: 2 }, direction: 'RIGHT', startLength: 1 };
  level.opponentSpawn = { position: { x: 3, y: 3 }, direction: 'RIGHT', startLength: 1, aiStyle: 'GREEDY' };
  level.tokens.positions = [{ x: 6, y: 2 }];
  const settings = getCampaignPlaytestSettings(level);
  const state = createCampaignPlaytestState(level, settings);

  assert.deepEqual(state.walls, level.walls);
  assert.notEqual(calculateAIMove(state, settings.gridSize, 'p2', settings.botDifficulty), 'RIGHT');

  queueSnakeDirection(state.snakes.p1, 'RIGHT');
  const { nextState } = processGameTick(state, settings, 0);
  assert.equal(nextState.phase, 'OVER');
  assert.equal(nextState.snakes.p1.deathReason, 'WALL');
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
    level.opponentSpawn.aiStyle = aiStyle as CampaignLevel['opponentSpawn']['aiStyle'];
    assert.equal(getCampaignPlaytestSettings(level).botDifficulty, difficulty);
  }
});
