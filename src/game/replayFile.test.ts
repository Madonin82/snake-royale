import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS } from './engine';
import { createReplayDataObject, parseAndValidateReplayData, TurnDecision } from './replayFile';

const states = [createInitialState(), { ...createInitialState(), tick: 1 }];

test('replay v2 exports and parses decision metadata', () => {
  const decisions: TurnDecision[] = [
    { tick: 1, seat: 'p1', queue: ['UP', 'LEFT'], lockedAt: 1000, autoLock: false },
    { tick: 1, seat: 'p2', queue: ['RIGHT'], lockedAt: 1010, autoLock: true },
  ];
  const agentDriven = { p1: false, p2: true };
  const replay = createReplayDataObject(states, DEFAULT_SETTINGS, decisions, agentDriven);

  assert.equal(replay.version, 2);
  assert.deepEqual(
    parseAndValidateReplayData(JSON.stringify(replay)),
    {
      states: replay.states,
      settings: replay.settings,
      decisions,
      agentDriven,
    },
  );
});

test('replay settings retain campaign level and AI style metadata', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    levelId: 'boss-01',
    levelName: 'THE BOSS',
    aiStyle: 'HEADHUNTER' as const,
  };
  const replay = createReplayDataObject(states, settings, [], { p1: false, p2: false });

  assert.equal(replay.settings.levelId, 'boss-01');
  assert.equal(replay.settings.levelName, 'THE BOSS');
  assert.equal(replay.settings.aiStyle, 'HEADHUNTER');
  assert.deepEqual(parseAndValidateReplayData(JSON.stringify(replay)).settings, replay.settings);
});

test('legacy replay v1 defaults decision metadata', () => {
  const replay = {
    format: 'snake-royale-replay',
    version: 1,
    states,
  };

  const parsed = parseAndValidateReplayData(JSON.stringify(replay));

  assert.deepEqual(parsed.decisions, []);
  assert.deepEqual(parsed.agentDriven, { p1: false, p2: false });
});

test('replay v2 rejects malformed decision metadata', () => {
  const replay = createReplayDataObject(states, DEFAULT_SETTINGS, [], { p1: false, p2: false });

  assert.throws(
    () => parseAndValidateReplayData(JSON.stringify({ ...replay, decisions: [{ tick: 1, seat: 'p1' }] })),
    /That file isn't a Snake Royale replay/,
  );
});
