import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areBothOnlinePlayersReady,
  canAcceptState,
  canAdoptMatch,
  canLockOnlineMatch,
  isCurrentMatch,
  isMatchStartAcknowledged,
  mergeOnlineReadyFlags,
  isNewerSequence,
  MatchIdentity,
  sanitizeSettings,
} from './networkProtocol';

test('sanitizeSettings strips undefined keys while preserving null and defined values', () => {
  const rawSettings = {
    gridSize: 8,
    turnBased: true,
    thinkTimeSeconds: null,
    levelId: undefined,
    levelName: undefined,
    aiStyle: undefined,
    campaignAiDifficulties: undefined,
  };
  const sanitized = sanitizeSettings(rawSettings);
  assert.deepEqual(sanitized, {
    gridSize: 8,
    turnBased: true,
    thinkTimeSeconds: null,
  });
  assert.equal('levelId' in (sanitized ?? {}), false);
  assert.equal('levelName' in (sanitized ?? {}), false);

  const customLevelSettings = {
    ...rawSettings,
    levelId: 'lvl-1',
    levelName: 'Arena One',
  };
  assert.deepEqual(sanitizeSettings(customLevelSettings), {
    gridSize: 8,
    turnBased: true,
    thinkTimeSeconds: null,
    levelId: 'lvl-1',
    levelName: 'Arena One',
  });

  assert.equal(sanitizeSettings(undefined), null);
  assert.equal(sanitizeSettings(null), null);
});

test('RTDB seat readiness merges into p1 and p2 without replacing other snake state', () => {
  assert.deepEqual(
    mergeOnlineReadyFlags(
      { p1: false, p2: false, p3: true },
      { p1: true, p2: false },
    ),
    { p1: true, p2: false, p3: true },
  );
});

test('online readiness follows the p1 and p2 seat keys', () => {
  assert.equal(areBothOnlinePlayersReady({ p1: true, p2: false }), false);
  assert.equal(areBothOnlinePlayersReady({ p1: true, p2: true }), true);
  assert.equal(areBothOnlinePlayersReady({ snake1: true, snake2: true }), false);
});

test('the authority cannot lock until the joiner acknowledges the current match start', () => {
  const ready = { p1: true, p2: true };
  assert.equal(canLockOnlineMatch(ready, true, false), false);
  assert.equal(canLockOnlineMatch(ready, true, true), true);
  assert.equal(canLockOnlineMatch({ p1: true, p2: false }, true, true), false);
  assert.equal(canLockOnlineMatch(ready, false, false), true);
});

test('only an acknowledgment for the active match releases the start gate', () => {
  const current = { matchId: 'match-3', matchNumber: 3 };
  assert.equal(isMatchStartAcknowledged(current, 'match-3'), true);
  assert.equal(isMatchStartAcknowledged(current, 'match-2'), false);
  assert.equal(isMatchStartAcknowledged(null, 'match-3'), false);
});

test('adopts three consecutive matches in order', () => {
  let current: MatchIdentity | null = null;
  for (let matchNumber = 1; matchNumber <= 3; matchNumber += 1) {
    const incoming = { matchId: `match-${matchNumber}`, matchNumber };
    assert.equal(canAdoptMatch(current, incoming), true);
    current = incoming;
  }
});

test('rejects an old snapshot even when its revision is higher', () => {
  const current = { matchId: 'match-3', matchNumber: 3 };
  const previousMatch = { matchId: 'match-2', matchNumber: 2 };
  assert.equal(canAdoptMatch(current, previousMatch), false);
  assert.equal(isCurrentMatch(current, previousMatch), false);
  assert.equal(canAcceptState(current, 2, previousMatch, 900), false);
});

test('accepts only newer snapshots belonging to the active match', () => {
  const current = { matchId: 'match-3', matchNumber: 3 };
  assert.equal(canAcceptState(current, 2, current, 3), true);
  assert.equal(canAcceptState(current, 3, current, 3), false);
  assert.equal(canAcceptState(current, 3, current, 2), false);
});

test('rejects a conflicting ID at the same match generation', () => {
  assert.equal(canAdoptMatch(
    { matchId: 'match-3', matchNumber: 3 },
    { matchId: 'other', matchNumber: 3 },
  ), false);
});

test('accepts only strictly increasing state and input sequences', () => {
  assert.equal(isNewerSequence(4, 3), true);
  assert.equal(isNewerSequence(3, 3), false);
  assert.equal(isNewerSequence(2, 3), false);
  assert.equal(isNewerSequence(Number.NaN, 3), false);
});
