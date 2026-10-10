import { Position, Direction, SkillId, SkillsAvailableConfig } from '../types/game';

export type CampaignTokenMode = 'ESCALATING' | 'FIXED' | 'FIXED_SET';
export type CampaignAiStyle = 'GREEDY' | 'TURTLE' | 'CUTOFF' | 'HEADHUNTER' | 'PATROL' | 'AVALENA' | 'avalena';

export interface SpawnConfig {
  enabled?: boolean;
  position: Position;
  direction: Direction;
  startLength: number;
  startingScore: number; // tokens
  startingSkillPoints?: number; // skill wallet (optional: older level JSON lacks it)
  aiStyle: CampaignAiStyle;
  equippedSkill?: SkillId | null;
  body?: Position[];
}

export interface CampaignLevel {
  id: string;                    // slug, e.g. "maze-snake-01"
  name: string;                  // display name, e.g. "The Maze"
  description: string;           // one-line briefing shown before the stage

  gridSize: number;              // 4 through 16
  walls: Position[];             // static wall cells (empty = open arena)

  spawns: SpawnConfig[];
  skillsAvailable?: SkillsAvailableConfig;

  tokens: {
    positions: Position[];       // fixed spawn points (empty = random)
    count: number;               // how many active at once
    respawn: boolean;
    mode: CampaignTokenMode;
  };

  phases: {
    raceTurns: number;            // turns in Phase 1 before shrink
    shrinkEveryTurns: number;    // ring closes every N turns in Phase 2
  };

  objectives: {
    // Objective strings use "collect:N", "first_to:N", "survive:N",
    // "win_under:N", "shutout", or "outscore:N" (for example "collect:5").
    primary: string;
    bonus: string[];
  };
}
