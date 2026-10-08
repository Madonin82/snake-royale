import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CampaignLevel } from './levelSchema';

describe('CampaignLevel Schema', () => {
  it('validates a complete level data structure', () => {
    const level: CampaignLevel = {
      id: 'maze-snake-01',
      name: 'THE MAZE',
      description: 'SURVIVE 30 TURNS INSIDE THE LABYRINTH.',
      gridSize: 12,
      walls: [
        { x: 3, y: 3 },
        { x: 3, y: 4 },
        { x: 8, y: 8 },
      ],
      playerSpawn: {
        position: { x: 1, y: 1 },
        direction: 'RIGHT',
        startLength: 3,
      },
      opponentSpawn: {
        position: { x: 10, y: 10 },
        direction: 'LEFT',
        startLength: 15,
        aiStyle: 'HEADHUNTER',
      },
      tokens: {
        positions: [{ x: 5, y: 5 }],
        count: 3,
        respawn: true,
      },
      phases: {
        raceTurns: 50,
        shrinkEveryTurns: 8,
      },
      objectives: {
        primary: 'SURVIVE 30 TURNS',
        bonus: ['COLLECT 5 TOKENS', 'OPPONENT SCORES ZERO'],
      },
    };

    const json = JSON.stringify(level);
    const parsed: CampaignLevel = JSON.parse(json);

    assert.strictEqual(parsed.id, 'maze-snake-01');
    assert.strictEqual(parsed.name, 'THE MAZE');
    assert.strictEqual(parsed.gridSize, 12);
    assert.strictEqual(parsed.walls.length, 3);
    assert.strictEqual(parsed.playerSpawn.direction, 'RIGHT');
    assert.strictEqual(parsed.playerSpawn.startLength, 3);
    assert.strictEqual(parsed.opponentSpawn.startLength, 15);
    assert.strictEqual(parsed.opponentSpawn.aiStyle, 'HEADHUNTER');
    assert.strictEqual(parsed.tokens.count, 3);
    assert.strictEqual(parsed.tokens.respawn, true);
    assert.strictEqual(parsed.phases.raceTurns, 50);
    assert.strictEqual(parsed.phases.shrinkEveryTurns, 8);
    assert.strictEqual(parsed.objectives.primary, 'SURVIVE 30 TURNS');
    assert.strictEqual(parsed.objectives.bonus.length, 2);
  });
});
