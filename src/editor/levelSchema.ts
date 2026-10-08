import { Position, Direction } from '../types/game';

export interface CampaignLevel {
  id: string;                    // slug, e.g. "maze-snake-01"
  name: string;                  // display name, e.g. "The Maze"
  description: string;           // one-line briefing shown before the stage

  gridSize: number;              // 8, 12, or 16
  walls: Position[];             // static wall cells (empty = open arena)

  playerSpawn: {                 // P1 (the human)
    position: Position;
    direction: Direction;
    startLength: number;         // e.g. 3
  };
  opponentSpawn: {               // P2 (the AI)
    position: Position;
    direction: Direction;
    startLength: number;         // e.g. 20 for maze-snake
    aiStyle: 'GREEDY' | 'TURTLE' | 'CUTOFF' | 'HEADHUNTER' | 'PATROL';
  };

  tokens: {
    positions: Position[];       // fixed spawn points (empty = random)
    count: number;               // how many active at once
    respawn: boolean;
  };

  phases: {
    raceTurns: number;            // turns in Phase 1 before shrink
    shrinkEveryTurns: number;    // ring closes every N turns in Phase 2
  };

  objectives: {
    primary: string;             // e.g. "Survive 30 turns"
    bonus: string[];             // e.g. ["Collect 5 tokens", "Opponent scores zero"]
  };
}
