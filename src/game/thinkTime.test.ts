import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, DEFAULT_SETTINGS } from './engine';
import {
  adoptThinkTimeSnapshot,
  applyThinkTimeModel,
  createThinkTimeModel,
  getThinkTimeLockEvents,
  getPlanningEnteredEvents,
  transitionThinkTime,
} from './thinkTime';
import { createReplayDataObject } from './replayFile';

test('accounts independently for both players across planning windows', () => {
  let model = createThinkTimeModel();
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p1', at: 100 });
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at: 250 });
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p1', at: 1300 });
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p2', at: 2250 });

  const state = applyThinkTimeModel(createInitialState(), model);
  assert.deepEqual(state.lastTurnTimes, { p1: 1.2, p2: 2 });
  assert.deepEqual(state.totalThinkTime, { p1: 1.2, p2: 2 });
});

test('human click-lock transitions accrue the same timer state', () => {
  let model = createThinkTimeModel();
  const unlocked = { p1: false, p2: false };
  const locked = { p1: true, p2: false };

  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p1', at: 500 });
  for (const event of getThinkTimeLockEvents(unlocked, locked, 1450)) {
    model = transitionThinkTime(model, event);
  }

  assert.equal(model.sessions.p1.totalMilliseconds, 950);
  assert.deepEqual(model.lastTurnTimes, { p1: 1, p2: 0 });
});

test('bridge-controlled P2 accrues think time in SOLO_AI after built-in AI takeover', () => {
  const state = createInitialState();
  state.tick = 1;
  state.readyConfirmed = { p1: true, p2: true };

  const builtInAiEvents = getPlanningEnteredEvents(
    state,
    { p1: false, p2: false },
    'SOLO_AI',
    100,
  );
  assert.deepEqual(builtInAiEvents.map(event => event.player), ['p1']);

  const bridgeEvents = getPlanningEnteredEvents(
    state,
    { p1: false, p2: false },
    'SOLO_AI',
    100,
    false,
  );
  assert.deepEqual(bridgeEvents.map(event => event.player), ['p1', 'p2']);

  let model = transitionThinkTime(createThinkTimeModel(), bridgeEvents[1]);
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p2', at: 1600 });
  assert.equal(applyThinkTimeModel(state, model).totalThinkTime.p2, 1.5);
});

test('retained post-tick locks stay paused, then re-enter planning when the buffer drains', () => {
  let model = createThinkTimeModel();
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p1', at: 100 });
  for (const event of getThinkTimeLockEvents(
    { p1: false, p2: false },
    { p1: true, p2: false },
    1100,
  )) {
    model = transitionThinkTime(model, event);
  }

  assert.deepEqual(getThinkTimeLockEvents(
    { p1: true, p2: false },
    { p1: true, p2: false },
    1200,
  ), []);
  assert.equal(model.sessions.p1.planningStartedAt, null);

  for (const event of getThinkTimeLockEvents(
    { p1: true, p2: false },
    { p1: false, p2: false },
    1500,
  )) {
    model = transitionThinkTime(model, event);
  }
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p1', at: 2000 });

  const state = applyThinkTimeModel(createInitialState(), model);
  assert.deepEqual(state.lastTurnTimes, { p1: 0.5, p2: 0 });
  assert.deepEqual(state.totalThinkTime, { p1: 1.5, p2: 0 });
});

test('rapid unlock and relock transitions preserve earlier accrued time', () => {
  let model = createThinkTimeModel();
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at: 1000 });
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p2', at: 2400 });
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at: 2500 });
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p2', at: 3200 });
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at: 3300 });
  model = transitionThinkTime(model, { type: 'LOCK_LANDED', player: 'p2', at: 3800 });

  const state = applyThinkTimeModel(createInitialState(), model);
  assert.deepEqual(state.lastTurnTimes, { p1: 0, p2: 0.5 });
  assert.deepEqual(state.totalThinkTime, { p1: 0, p2: 2.6 });
});

test('20 varied queue-depth planning windows accrue monotonically and match replay totals', () => {
  let model = createThinkTimeModel();
  let locks = { p1: false, p2: false };
  let at = 1000;
  let previousTotals = { p1: 0, p2: 0 };

  for (let window = 0; window < 20; window += 1) {
    if (window === 0) {
      model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p1', at });
      model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at });
    }
    const lockAt = at + 450 + (window % 4) * 150;
    const nextLocks = { p1: true, p2: true };
    for (const event of getThinkTimeLockEvents(locks, nextLocks, lockAt)) {
      model = transitionThinkTime(model, event);
    }
    locks = nextLocks;

    const stateAtLock = applyThinkTimeModel(createInitialState(), model);
    assert.ok(stateAtLock.totalThinkTime.p1 > previousTotals.p1);
    assert.ok(stateAtLock.totalThinkTime.p2 > previousTotals.p2);
    previousTotals = stateAtLock.totalThinkTime;

    const queueDepth = 1 + (window % 3);
    for (let queuedTick = 1; queuedTick < queueDepth; queuedTick += 1) {
      assert.deepEqual(getThinkTimeLockEvents(locks, locks, lockAt + queuedTick * 50), []);
    }

    const unlockedAt = lockAt + queueDepth * 50;
    const unlocked = { p1: false, p2: false };
    for (const event of getThinkTimeLockEvents(locks, unlocked, unlockedAt)) {
      model = transitionThinkTime(model, event);
    }
    locks = unlocked;
    at = unlockedAt;
  }

  const finalState = applyThinkTimeModel(createInitialState(), model);
  const replay = createReplayDataObject([finalState], DEFAULT_SETTINGS);
  assert.deepEqual(replay.states[0].totalThinkTime, finalState.totalThinkTime);

  const imported = adoptThinkTimeSnapshot(createThinkTimeModel(), replay.states[0]);
  assert.deepEqual(imported.state.totalThinkTime, finalState.totalThinkTime);
  assert.deepEqual(imported.model.sessions.p1.totalMilliseconds, finalState.totalThinkTime.p1 * 1000);
});

test('cancel closes a session without accruing automated-player time', () => {
  let model = createThinkTimeModel();
  model = transitionThinkTime(model, { type: 'PLANNING_ENTERED', player: 'p2', at: 0 });
  model = transitionThinkTime(model, { type: 'CANCEL', player: 'p2' });

  const state = applyThinkTimeModel(createInitialState(), model);
  assert.deepEqual(state.lastTurnTimes, null);
  assert.deepEqual(state.totalThinkTime, { p1: 0, p2: 0 });
});

test('RESET opens turn-one planning for both actionable local players and accrues on lock', () => {
  let model = transitionThinkTime(createThinkTimeModel(), { type: 'RESET' });
  const state = {
    ...createInitialState(),
    tick: 1,
    readyConfirmed: { p1: true, p2: true },
  };
  const locks = { p1: false, p2: false };

  for (const event of getPlanningEnteredEvents(state, locks, 'LOCAL_2P', 1000)) {
    model = transitionThinkTime(model, event);
  }
  for (const event of getPlanningEnteredEvents(state, locks, 'LOCAL_2P', 1500)) {
    model = transitionThinkTime(model, event);
  }
  assert.equal(model.sessions.p1.planningStartedAt, 1000);
  assert.equal(model.sessions.p2.planningStartedAt, 1000);

  for (const event of getThinkTimeLockEvents(locks, { p1: true, p2: true }, 2600)) {
    model = transitionThinkTime(model, event);
  }
  const lockedState = applyThinkTimeModel(state, model);
  assert.deepEqual(lockedState.lastTurnTimes, { p1: 1.6, p2: 1.6 });
  assert.deepEqual(lockedState.totalThinkTime, { p1: 1.6, p2: 1.6 });
});

test('players wait for both readiness confirmations and turn one before planning', () => {
  let model = transitionThinkTime(createThinkTimeModel(), { type: 'RESET' });
  const state = {
    ...createInitialState(),
    tick: 1,
    readyConfirmed: { p1: true, p2: false },
  };
  assert.deepEqual(getPlanningEnteredEvents(state, { p1: false, p2: false }, 'ONLINE_HOST', 1000), []);
  assert.equal(model.sessions.p1.planningStartedAt, null);

  const bothReadyAtTurnZero = {
    ...state,
    tick: 0,
    readyConfirmed: { p1: true, p2: true },
  };
  assert.deepEqual(
    getPlanningEnteredEvents(bothReadyAtTurnZero, { p1: false, p2: false }, 'ONLINE_HOST', 1100),
    [],
  );

  const actionable = { ...bothReadyAtTurnZero, tick: 1 };
  for (const event of getPlanningEnteredEvents(actionable, { p1: false, p2: false }, 'ONLINE_HOST', 1200)) {
    model = transitionThinkTime(model, event);
  }
  assert.equal(model.sessions.p1.planningStartedAt, 1200);
  assert.equal(model.sessions.p2.planningStartedAt, 1200);
});

test('SOLO_AI keeps P2 excluded through a complete planning window', () => {
  let model = transitionThinkTime(createThinkTimeModel(), { type: 'RESET' });
  const state = {
    ...createInitialState(),
    tick: 1,
    readyConfirmed: { p1: true, p2: true },
  };
  for (const event of getPlanningEnteredEvents(state, { p1: false, p2: false }, 'SOLO_AI', 1000)) {
    model = transitionThinkTime(model, event);
  }
  for (const event of getThinkTimeLockEvents(
    { p1: false, p2: false },
    { p1: true, p2: true },
    2400,
  )) {
    if (event.player === 'p2') continue;
    model = transitionThinkTime(model, event);
  }

  const finalState = applyThinkTimeModel(state, model);
  assert.equal(finalState.totalThinkTime.p1, 1.4);
  assert.equal(finalState.totalThinkTime.p2, 0);
  assert.equal(finalState.lastTurnTimes?.p2, 0);
});
