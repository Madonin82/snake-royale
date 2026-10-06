import assert from 'node:assert/strict';
import test from 'node:test';
import { canAcceptState, canAdoptMatch, isCurrentMatch, isNewerSequence, MatchIdentity } from './networkProtocol';

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
