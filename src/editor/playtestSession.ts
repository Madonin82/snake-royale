import { DEFAULT_SETTINGS, createInitialState, getNextHeadPosition, spawnTokens } from '../game/engine';
import { Direction, GameSettings, GameState, Position } from '../types/game';
import { createCampaignObjectives } from '../game/objectives';
import { CampaignLevel, SpawnConfig } from './levelSchema';

let campaignPlaytestLevel: CampaignLevel | null = null;

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  UP: 'DOWN',
  RIGHT: 'LEFT',
  DOWN: 'UP',
  LEFT: 'RIGHT',
};

const DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export function setCampaignPlaytestLevel(level: CampaignLevel): void {
  campaignPlaytestLevel = structuredClone(level);
}

export function getCampaignPlaytestLevel(): CampaignLevel | null {
  return campaignPlaytestLevel;
}

export function getCampaignPlaytestSettings(level: CampaignLevel): GameSettings {
  const difficulty = {
    GREEDY: 'HARD',
    TURTLE: 'EASY',
    CUTOFF: 'MEDIUM',
    HEADHUNTER: 'HARD',
    PATROL: 'MEDIUM',
  } as const;

  const difficultyForStyle = (style: SpawnConfig['aiStyle']) => difficulty[style];
  const aiSpawns = level.spawns.slice(1);
  return {
    ...DEFAULT_SETTINGS,
    gridSize: level.gridSize,
    raceTurns: level.phases.raceTurns,
    shrinkEveryTurns: level.phases.shrinkEveryTurns,
    botDifficulty: difficultyForStyle(aiSpawns[0]?.aiStyle ?? 'GREEDY'),
    levelId: level.id,
    levelName: level.name,
    aiStyle: aiSpawns[0]?.aiStyle ?? 'GREEDY',
    campaignAiDifficulties: Object.fromEntries(
      aiSpawns.map((spawn, index) => [`p${index + 2}`, difficultyForStyle(spawn.aiStyle)]),
    ),
  };
}

export function createSpawnBody(
  spawn: SpawnConfig,
  gridSize: number,
  walls: Set<string>,
  occupied: Set<string>,
): Position[] {
  const length = spawn.startLength;
  const head = spawn.position;
  const cellKey = (position: Position) => `${position.x},${position.y}`;
  const isAvailable = (position: Position, path: Position[]) =>
    position.x >= 0 &&
    position.x < gridSize &&
    position.y >= 0 &&
    position.y < gridSize &&
    !walls.has(cellKey(position)) &&
    !occupied.has(cellKey(position)) &&
    !path.some(segment => segment.x === position.x && segment.y === position.y);

  if (!Number.isInteger(length) || length < 1) {
    throw new Error('SNAKE START LENGTH MUST BE A POSITIVE WHOLE NUMBER');
  }
  if (length > gridSize * gridSize - walls.size - occupied.size) {
    throw new Error('NOT ENOUGH OPEN CELLS TO FIT THE SNAKE START LENGTH');
  }
  if (!isAvailable(head, [])) {
    throw new Error('SNAKE SPAWN MUST BE INSIDE THE BOARD AND CLEAR OF WALLS');
  }

  const body = [head];
  const behindHead = getNextHeadPosition(head, OPPOSITE_DIRECTION[spawn.direction]);
  if (length > 1 && !isAvailable(behindHead, body)) {
    throw new Error('SNAKE SPAWN NEEDS AN OPEN CELL BEHIND ITS STARTING DIRECTION');
  }
  if (length > 1) body.push(behindHead);

  let searchNodes = 0;
  const extendBody = (): boolean => {
    if (body.length === length) return true;
    if (++searchNodes > 25000) return false;
    const tail = body[body.length - 1];
    for (const direction of DIRECTIONS) {
      const next = getNextHeadPosition(tail, direction);
      if (!isAvailable(next, body)) continue;
      body.push(next);
      if (extendBody()) return true;
      body.pop();
    }
    return false;
  };

  if (!extendBody()) {
    throw new Error('UNABLE TO FIT THE SNAKE START LENGTH AROUND THE WALLS');
  }
  return body;
}

export function createCampaignPlaytestState(
  level: CampaignLevel,
  settings: GameSettings = getCampaignPlaytestSettings(level),
  playerNames: { p1?: string; p2?: string } = { p1: 'PLAYER 1', p2: 'BOT' },
): GameState {
  const walls = level.walls.map(wall => ({ ...wall }));
  const wallCells = new Set(walls.map(wall => `${wall.x},${wall.y}`));
  const initial = createInitialState(settings, playerNames);
  const colors = ['#0F380F', '#306230', '#8B1E0F', '#5B2C83'];
  const snakes = level.spawns.map((spawn, index) => {
    const occupied = new Set<string>();
    for (const previous of level.spawns.slice(0, index)) {
      const previousBody = previous.body
        ? previous.body.map(position => ({ ...position }))
        : createSpawnBody(previous, level.gridSize, wallCells, occupied);
      previousBody.forEach(position => occupied.add(`${position.x},${position.y}`));
    }
    const body = spawn.body
      ? spawn.body.map(position => ({ ...position }))
      : createSpawnBody(spawn, level.gridSize, wallCells, occupied);
    const template = initial.snakes[index] ?? initial.snakes[1];
    return {
      ...template,
      id: `p${index + 1}`,
      name: index === 0 ? template.name : `BOT ${index + 1}`,
      color: colors[index] ?? template.color,
      body,
      direction: spawn.direction,
      score: spawn.startingScore,
    };
  });
  const occupied = new Set(snakes.flatMap(snake => snake.body.map(position => `${position.x},${position.y}`)));
  const tokens = level.tokens.positions.length > 0
    ? level.tokens.positions.slice(0, level.tokens.count).map(position => ({ ...position }))
    : spawnTokens(level.tokens.count, level.gridSize, 0, snakes, [], walls);

  for (const token of tokens) {
    const key = `${token.x},${token.y}`;
    if (
      token.x < 0 ||
      token.x >= level.gridSize ||
      token.y < 0 ||
      token.y >= level.gridSize ||
      wallCells.has(key) ||
      occupied.has(key)
    ) {
      throw new Error('TOKENS MUST BE INSIDE THE BOARD AND CLEAR OF SNAKES AND WALLS');
    }
    occupied.add(key);
  }

  return {
    ...initial,
    phase: 'RACING',
    snakes,
    tokens,
    campaignTokenRules: {
      count: level.tokens.positions.length > 0 ? tokens.length : level.tokens.count,
      respawn: level.tokens.mode !== 'FIXED_SET' && level.tokens.respawn,
      mode: level.tokens.mode,
      tokensEatenInRound: 0,
    },
    campaignObjectives: createCampaignObjectives(
      level.objectives.primary,
      level.objectives.bonus,
      snakes[0]?.score ?? 0,
      snakes[1]?.score ?? 0,
    ),
    walls,
  };
}
