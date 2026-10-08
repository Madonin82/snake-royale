import { DEFAULT_SETTINGS, createInitialState, getNextHeadPosition, spawnTokens } from '../game/engine';
import { Direction, GameSettings, GameState, Position } from '../types/game';
import { withLegacySnakeAccessors } from '../game/snakeArray';
import { CampaignLevel } from './levelSchema';

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

  return {
    ...DEFAULT_SETTINGS,
    gridSize: level.gridSize,
    raceTurns: level.phases.raceTurns,
    shrinkEveryTurns: level.phases.shrinkEveryTurns,
    botDifficulty: difficulty[level.opponentSpawn.aiStyle],
  };
}

function createSpawnBody(
  spawn: CampaignLevel['playerSpawn'] | CampaignLevel['opponentSpawn'],
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
  const p1Body = createSpawnBody(level.playerSpawn, level.gridSize, wallCells, new Set());
  const p2Body = createSpawnBody(
    level.opponentSpawn,
    level.gridSize,
    wallCells,
    new Set(p1Body.map(position => `${position.x},${position.y}`)),
  );
  const initial = createInitialState(settings, playerNames);
  const p1 = { ...initial.snakes.find(snake => snake.id === 'p1')!, body: p1Body, direction: level.playerSpawn.direction };
  const p2 = { ...initial.snakes.find(snake => snake.id === 'p2')!, body: p2Body, direction: level.opponentSpawn.direction };
  const occupied = new Set([...p1Body, ...p2Body].map(position => `${position.x},${position.y}`));
  const tokens = level.tokens.positions.length > 0
    ? level.tokens.positions.map(position => ({ ...position }))
    : spawnTokens(1, level.gridSize, 0, [p1, p2], [], walls);

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
    snakes: withLegacySnakeAccessors([p1, p2]),
    tokens,
    walls,
  };
}
