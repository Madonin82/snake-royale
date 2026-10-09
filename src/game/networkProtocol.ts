export interface MatchIdentity {
  matchId: string;
  matchNumber: number;
}

export function mergeOnlineReadyFlags(
  current: Record<string, boolean> | undefined,
  incoming: Record<string, boolean> | undefined,
): Record<string, boolean> {
  return {
    ...current,
    p1: incoming?.p1 === true,
    p2: incoming?.p2 === true,
  };
}

export function areBothOnlinePlayersReady(ready: Record<string, boolean> | undefined): boolean {
  return ready?.p1 === true && ready.p2 === true;
}

export function isMatchStartAcknowledged(
  current: MatchIdentity | null,
  acknowledgedMatchId: string | null,
): boolean {
  return current !== null && current.matchId === acknowledgedMatchId;
}

export function canLockOnlineMatch(
  ready: Record<string, boolean> | undefined,
  isAuthority: boolean,
  joinerAcknowledgedStart: boolean,
): boolean {
  return areBothOnlinePlayersReady(ready) && (!isAuthority || joinerAcknowledgedStart);
}

export function canAdoptMatch(current: MatchIdentity | null, incoming: MatchIdentity): boolean {
  if (!incoming.matchId || !Number.isSafeInteger(incoming.matchNumber) || incoming.matchNumber < 1) {
    return false;
  }
  if (!current) return true;
  return incoming.matchNumber > current.matchNumber ||
    (incoming.matchNumber === current.matchNumber && incoming.matchId === current.matchId);
}

export function isCurrentMatch(current: MatchIdentity | null, incoming: MatchIdentity): boolean {
  return current?.matchId === incoming.matchId && current.matchNumber === incoming.matchNumber;
}

export function canAcceptState(
  currentMatch: MatchIdentity | null,
  currentRevision: number,
  incomingMatch: MatchIdentity,
  incomingRevision: number,
): boolean {
  return isCurrentMatch(currentMatch, incomingMatch) &&
    isNewerSequence(incomingRevision, currentRevision);
}

export function isNewerSequence(incoming: number, current: number): boolean {
  return Number.isSafeInteger(incoming) && incoming > current;
}
