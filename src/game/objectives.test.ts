import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from './engine';
import {
  createCampaignObjectives,
  getCampaignObjectiveProgress,
  isCampaignObjectiveComplete,
  parseCampaignObjective,
  recordFirstToResults,
  recordSurviveResults,
} from './objectives';

test('parses supported objective strings and rejects malformed values', () => {
  assert.deepEqual(parseCampaignObjective('collect:5'), {
    text: 'collect:5',
    kind: 'collect',
    target: 5,
  });
  assert.deepEqual(parseCampaignObjective('SHUTOUT'), {
    text: 'SHUTOUT',
    kind: 'shutout',
    target: 0,
  });
  assert.deepEqual(parseCampaignObjective('SURVIVAL'), {
    text: 'SURVIVAL',
    kind: 'survival',
    target: 0,
  });
  assert.equal(parseCampaignObjective('survival:5'), null);
  assert.equal(parseCampaignObjective('survive'), null);
  assert.equal(parseCampaignObjective('collect:0'), null);
  assert.equal(parseCampaignObjective('shutout:1'), null);
  assert.equal(parseCampaignObjective('collect five tokens'), null);
});

test('tracks first_to outcomes and handles simultaneous thresholds as a tie', () => {
  const state = createInitialState();
  state.campaignObjectives = createCampaignObjectives('first_to:5', ['first_to:3'], 0, 0);
  state.snakes[0].score = 3;
  recordFirstToResults(state);
  assert.deepEqual(state.campaignObjectives.firstToResults, [null, 'p1']);

  state.snakes[1].score = 5;
  state.snakes[0].score = 5;
  recordFirstToResults(state);
  assert.deepEqual(state.campaignObjectives.firstToResults, ['tie', 'p1']);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), false);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.bonus[0]!, state, 1), true);
});

test('tracks first_to_sp outcomes on spEarned and handles simultaneous thresholds as a tie', () => {
  const state = createInitialState();
  state.campaignObjectives = createCampaignObjectives('first_to_sp:5', ['first_to_sp:3'], 0, 0, 0, 0);
  state.snakes[0].spEarned = 3;
  recordFirstToResults(state);
  assert.deepEqual(state.campaignObjectives.firstToResults, [null, 'p1']);

  state.snakes[1].spEarned = 5;
  state.snakes[0].spEarned = 5;
  recordFirstToResults(state);
  assert.deepEqual(state.campaignObjectives.firstToResults, ['tie', 'p1']);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), false);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.bonus[0]!, state, 1), true);
});

test('parses first_to_sp and does not confuse it with first_to', () => {
  assert.deepEqual(parseCampaignObjective('FIRST_TO_SP:10'), {
    text: 'FIRST_TO_SP:10',
    kind: 'first_to_sp',
    target: 10,
  });
  assert.equal(parseCampaignObjective('first_to_sp:0'), null);
  assert.deepEqual(parseCampaignObjective('FIRST_TO:10'), {
    text: 'FIRST_TO:10',
    kind: 'first_to',
    target: 10,
  });
});

test('first_to_sp progress shows SP values', () => {
  const state = createInitialState();
  state.snakes[0].spEarned = 3;
  const objective = parseCampaignObjective('first_to_sp:10')!;
  assert.equal(getCampaignObjectiveProgress(objective, state, 0), 'First to 10 SP: P1 3, OP 0');
});

test('evaluates end-of-match objectives against P1 and the highest-scoring opponent', () => {
  const state = createInitialState();
  state.phase = 'OVER';
  state.winner = 'p1';
  state.tick = 9;
  state.snakes[0].score = 7;
  state.snakes[1].score = 2;
  state.campaignObjectives = createCampaignObjectives('survive:9', ['collect:5'], 0, 0);
  state.campaignObjectives.p1TokensCollected = 5;
  recordSurviveResults(state);

  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('collect:5')!, state, 1), true);
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('survive:9')!, state, 0), true);
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('win_under:10')!, state, 0), true);
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('shutout')!, state, 0), false);
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('outscore:5')!, state, 0), true);

  state.winner = 'p2';
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('win_under:10')!, state, 0), false);
  assert.equal(isCampaignObjectiveComplete(parseCampaignObjective('outscore:5')!, state, 0), true);
});

test('survive objective remains completed if P1 dies after the required turn', () => {
  const state = createInitialState();
  state.campaignObjectives = createCampaignObjectives('survive:2', [], 0, 0);
  state.tick = 2;
  recordSurviveResults(state);
  state.snakes[0].isAlive = false;
  state.phase = 'OVER';
  state.winner = 'p2';

  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), true);
});

test('survival objective completes when P1 is the winner (last living player or simultaneous death tiebreak)', () => {
  const state = createInitialState();
  state.campaignObjectives = createCampaignObjectives('SURVIVAL', [], 0, 0);
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), false);

  state.phase = 'OVER';
  state.winner = 'p1';
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), true);

  state.winner = 'p2';
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), false);

  state.winner = 'DRAW';
  assert.equal(isCampaignObjectiveComplete(state.campaignObjectives.primary!, state, 0), false);
});

