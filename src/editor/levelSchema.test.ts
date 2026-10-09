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
      spawns: [
        {
          position: { x: 1, y: 1 },
          direction: 'RIGHT',
          startLength: 3,
          startingScore: 0,
          aiStyle: 'GREEDY',
          body: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
        },
        {
          position: { x: 10, y: 10 },
          direction: 'LEFT',
          startLength: 15,
          startingScore: 20,
          aiStyle: 'HEADHUNTER',
        },
      ],
      tokens: {
        positions: [{ x: 5, y: 5 }],
        count: 3,
        respawn: true,
        mode: 'ESCALATING',
      },
      phases: {
        raceTurns: 50,
        shrinkEveryTurns: 8,
      },
      objectives: {
        primary: 'survive:30',
        bonus: ['collect:5', 'shutout'],
      },
    };

    const json = JSON.stringify(level);
    const parsed: CampaignLevel = JSON.parse(json);

    assert.strictEqual(parsed.id, 'maze-snake-01');
    assert.strictEqual(parsed.name, 'THE MAZE');
    assert.strictEqual(parsed.gridSize, 12);
    assert.strictEqual(parsed.walls.length, 3);
    assert.strictEqual(parsed.spawns[0].direction, 'RIGHT');
    assert.strictEqual(parsed.spawns[0].startLength, 3);
    assert.deepEqual(parsed.spawns[0].body, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    assert.strictEqual(parsed.spawns[1].startLength, 15);
    assert.strictEqual(parsed.spawns[1].aiStyle, 'HEADHUNTER');
    assert.strictEqual(parsed.spawns[1].startingScore, 20);
    assert.strictEqual(parsed.tokens.count, 3);
    assert.strictEqual(parsed.tokens.respawn, true);
    assert.strictEqual(parsed.tokens.mode, 'ESCALATING');
    assert.strictEqual(parsed.phases.raceTurns, 50);
    assert.strictEqual(parsed.phases.shrinkEveryTurns, 8);
    assert.strictEqual(parsed.objectives.primary, 'survive:30');
    assert.strictEqual(parsed.objectives.bonus.length, 2);
  });
});
