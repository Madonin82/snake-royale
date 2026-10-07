import { GameState, PlayMode } from '../types/game';

export type ThinkPlayer = 'p1' | 'p2';

export interface ThinkTimeModel {
  sessions: Record<ThinkPlayer, { planningStartedAt: number | null; totalMilliseconds: number }>;
  lastTurnTimes: { p1: number; p2: number } | null;
}

export function createInitialThinkTimeValues(): Pick<GameState, 'lastTurnTimes' | 'totalThinkTime'> {
  return {
    lastTurnTimes: null,
    totalThinkTime: { p1: 0, p2: 0 },
  };
}

export type ThinkTimeEvent =
  | { type: 'PLANNING_ENTERED'; player: ThinkPlayer; at: number }
  | { type: 'LOCK_LANDED'; player: ThinkPlayer; at: number }
  | { type: 'CANCEL'; player: ThinkPlayer }
  | { type: 'RESET' };

export type ThinkTimeLockEvent = Extract<ThinkTimeEvent, { type: 'PLANNING_ENTERED' | 'LOCK_LANDED' }>;

export function createThinkTimeModel(): ThinkTimeModel {
  return {
    sessions: {
      p1: { planningStartedAt: null, totalMilliseconds: 0 },
      p2: { planningStartedAt: null, totalMilliseconds: 0 },
    },
    lastTurnTimes: null,
  };
}

export function transitionThinkTime(model: ThinkTimeModel, event: ThinkTimeEvent): ThinkTimeModel {
  if (event.type === 'RESET') return createThinkTimeModel();

  const session = model.sessions[event.player];
  if (event.type === 'PLANNING_ENTERED') {
    if (session.planningStartedAt !== null) return model;
    return {
      ...model,
      sessions: {
        ...model.sessions,
        [event.player]: { ...session, planningStartedAt: event.at },
      },
    };
  }

  if (event.type === 'CANCEL') {
    if (session.planningStartedAt === null) return model;
    return {
      ...model,
      sessions: {
        ...model.sessions,
        [event.player]: { ...session, planningStartedAt: null },
      },
    };
  }

  if (session.planningStartedAt === null) return model;
  const elapsedMilliseconds = Math.max(0, event.at - session.planningStartedAt);
  const totalMilliseconds = session.totalMilliseconds + elapsedMilliseconds;
  const elapsedSeconds = Math.round(elapsedMilliseconds / 100) / 10;
  return {
    sessions: {
      ...model.sessions,
      [event.player]: { planningStartedAt: null, totalMilliseconds },
    },
    lastTurnTimes: {
      ...(model.lastTurnTimes || { p1: 0, p2: 0 }),
      [event.player]: elapsedSeconds,
    },
  };
}

export function applyThinkTimeModel(state: GameState, model: ThinkTimeModel): GameState {
  return {
    ...state,
    totalThinkTime: {
      p1: Math.round(model.sessions.p1.totalMilliseconds / 100) / 10,
      p2: Math.round(model.sessions.p2.totalMilliseconds / 100) / 10,
    },
    lastTurnTimes: model.lastTurnTimes,
  };
}

export function adoptThinkTimeSnapshot(
  model: ThinkTimeModel,
  snapshot: GameState,
): { model: ThinkTimeModel; state: GameState } {
  const totalSeconds = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
    return value;
  };
  const totals = snapshot.totalThinkTime;
  const syncedModel: ThinkTimeModel = {
    sessions: {
      p1: { planningStartedAt: null, totalMilliseconds: totalSeconds(totals?.p1) * 1000 },
      p2: { planningStartedAt: null, totalMilliseconds: totalSeconds(totals?.p2) * 1000 },
    },
    lastTurnTimes: snapshot.lastTurnTimes ?? null,
  };
  return { model: syncedModel, state: applyThinkTimeModel(snapshot, syncedModel) };
}

export function getThinkTimeLockEvents(
  previous: { p1: boolean; p2: boolean },
  next: { p1: boolean; p2: boolean },
  at: number,
): ThinkTimeLockEvent[] {
  const events: ThinkTimeLockEvent[] = [];
  for (const player of ['p1', 'p2'] as const) {
    if (!previous[player] && next[player]) {
      events.push({ type: 'LOCK_LANDED', player, at });
    } else if (previous[player] && !next[player]) {
      events.push({ type: 'PLANNING_ENTERED', player, at });
    }
  }
  return events;
}

export function getPlanningEnteredEvents(
  state: GameState,
  locks: { p1: boolean; p2: boolean },
  mode: PlayMode,
  at: number,
): ThinkTimeLockEvent[] {
  if (
    mode === 'ONLINE_JOIN' ||
    mode === 'ONLINE_SPECTATOR' ||
    !state.turnBased ||
    state.tick < 1 ||
    state.phase === 'OVER' ||
    !state.readyConfirmed?.p1 ||
    !state.readyConfirmed?.p2
  ) return [];

  const events: ThinkTimeLockEvent[] = [];
  for (const player of ['p1', 'p2'] as const) {
    if (
      (mode === 'SOLO_AI' && player === 'p2') ||
      locks[player] ||
      !state.snakes[player]?.isAlive
    ) continue;
    events.push({ type: 'PLANNING_ENTERED', player, at });
  }
  return events;
}
