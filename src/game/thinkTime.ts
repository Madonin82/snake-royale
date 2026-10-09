import { GameState, PlayMode } from '../types/game';

export type ThinkPlayer = string;

export interface ThinkTimeModel {
  sessions: Record<string, { planningStartedAt: number | null; totalMilliseconds: number }>;
  lastTurnTimes: Record<string, number> | null;
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

export function createThinkTimeModel(players: string[] = ['p1', 'p2']): ThinkTimeModel {
  return {
    sessions: Object.fromEntries(players.map(player => [player, { planningStartedAt: null, totalMilliseconds: 0 }])),
    lastTurnTimes: null,
  };
}

export function transitionThinkTime(model: ThinkTimeModel, event: ThinkTimeEvent): ThinkTimeModel {
  if (event.type === 'RESET') return createThinkTimeModel(Object.keys(model.sessions));

  const session = model.sessions[event.player] ?? { planningStartedAt: null, totalMilliseconds: 0 };
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
      ...(model.lastTurnTimes || Object.fromEntries(Object.keys(model.sessions).map(player => [player, 0]))),
      [event.player]: elapsedSeconds,
    },
  };
}

export function applyThinkTimeModel(state: GameState, model: ThinkTimeModel): GameState {
  return {
    ...state,
    totalThinkTime: Object.fromEntries(state.snakes.map(snake => {
      const milliseconds = model.sessions[snake.id]?.totalMilliseconds ??
        (state.totalThinkTime[snake.id] ?? 0) * 1000;
      return [snake.id, Math.round(milliseconds / 100) / 10];
    })),
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
    sessions: Object.fromEntries(snapshot.snakes.map(snake => [
      snake.id,
      { planningStartedAt: null, totalMilliseconds: totalSeconds(totals?.[snake.id]) * 1000 },
    ])),
    lastTurnTimes: snapshot.lastTurnTimes ?? null,
  };
  return { model: syncedModel, state: applyThinkTimeModel(snapshot, syncedModel) };
}

export function getThinkTimeLockEvents(
  previous: Record<string, boolean>,
  next: Record<string, boolean>,
  at: number,
): ThinkTimeLockEvent[] {
  const events: ThinkTimeLockEvent[] = [];
  for (const player of new Set([...Object.keys(previous), ...Object.keys(next)])) {
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
  locks: Record<string, boolean>,
  mode: PlayMode,
  at: number,
  builtInAiActive = mode === 'SOLO_AI',
): ThinkTimeLockEvent[] {
  if (
    mode === 'ONLINE_JOIN' ||
    mode === 'ONLINE_SPECTATOR' ||
    !state.turnBased ||
    state.tick < 1 ||
    state.phase === 'OVER' ||
    state.snakes.some(snake => snake.isAlive && !state.readyConfirmed?.[snake.id])
  ) return [];

  const events: ThinkTimeLockEvent[] = [];
  for (const snake of state.snakes) {
    const player = snake.id;
    if (
      (builtInAiActive && player !== 'p1') ||
      locks[player] ||
      !snake.isAlive
    ) continue;
    events.push({ type: 'PLANNING_ENTERED', player, at });
  }
  return events;
}
