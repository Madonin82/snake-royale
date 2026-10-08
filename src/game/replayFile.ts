import { Direction, GameState, GameSettings } from '../types/game';
import { normalizeGameState } from './normalize';

export interface TurnDecision {
  tick: number;
  seat: 'p1' | 'p2';
  // Online clients only observe their own queue; opponent queues are fog-of-war by design.
  // A replay exported by one client may therefore omit opponent decisions; merge both exports.
  queue: Direction[];
  lockedAt: number;
  autoLock: boolean;
}

export interface ReplayFileObject {
  format: 'snake-royale-replay';
  version: 2;
  exportedAt: string;
  settings: {
    gridSize: number;
    turnBased: boolean;
    raceTurns: number;
    tickRate: number;
    thinkTimeSeconds?: number | null;
  };
  result: {
    winner: 'p1' | 'p2' | 'DRAW' | null;
    p1Score: number;
    p2Score: number;
  };
  states: GameState[];
  decisions: TurnDecision[];
  agentDriven: { p1: boolean; p2: boolean };
}

export function createReplayDataObject(
  matchHistory: GameState[],
  settings: GameSettings,
  decisions: TurnDecision[],
  agentDriven: { p1: boolean; p2: boolean },
): ReplayFileObject {
  const finalState = matchHistory[matchHistory.length - 1] || matchHistory[0];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const winner = finalState ? finalState.winner : null;
  const p1Score = finalState ? finalState.snakes.p1.score : 0;
  const p2Score = finalState ? finalState.snakes.p2.score : 0;

  return {
    format: 'snake-royale-replay',
    version: 2,
    exportedAt: now.toISOString(),
    settings: {
      gridSize: settings.gridSize,
      turnBased: settings.turnBased,
      raceTurns: settings.raceTurns,
      tickRate: settings.tickRate,
      thinkTimeSeconds: settings.thinkTimeSeconds,
    },
    result: {
      winner,
      p1Score,
      p2Score,
    },
    states: matchHistory,
    decisions,
    agentDriven,
  };
}

export function exportReplayToFile(
  matchHistory: GameState[],
  settings: GameSettings,
  decisions: TurnDecision[],
  agentDriven: { p1: boolean; p2: boolean },
): void {
  try {
    const replayObj = createReplayDataObject(matchHistory, settings, decisions, agentDriven);
    const jsonStr = JSON.stringify(replayObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `snake-royale-replay-${dateStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).catch(() => {});
    }
  } catch (err) {
    console.warn('Failed to export replay:', err);
  }
}

export function parseAndValidateReplayData(rawText: string): {
  states: GameState[];
  settings?: { gridSize: number; turnBased: boolean; raceTurns: number; tickRate: number; thinkTimeSeconds?: number | null };
  decisions: TurnDecision[];
  agentDriven: { p1: boolean; p2: boolean };
} {
  if (!rawText || rawText.length > 5 * 1024 * 1024) {
    throw new Error("That file isn't a Snake Royale replay");
  }

  let obj: any;
  try {
    obj = JSON.parse(rawText);
  } catch {
    throw new Error("That file isn't a Snake Royale replay");
  }

  if (!obj || typeof obj !== 'object') {
    throw new Error("That file isn't a Snake Royale replay");
  }

  if (
    obj.format !== 'snake-royale-replay' ||
    (obj.version !== 1 && obj.version !== 2) ||
    !Array.isArray(obj.states) ||
    obj.states.length <= 1
  ) {
    throw new Error("That file isn't a Snake Royale replay");
  }

  let decisions: TurnDecision[] = [];
  let agentDriven = { p1: false, p2: false };
  if (obj.version === 2) {
    const validDirections: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const validDecisions = Array.isArray(obj.decisions) && obj.decisions.every((decision: any) =>
      decision &&
      Number.isSafeInteger(decision.tick) &&
      (decision.seat === 'p1' || decision.seat === 'p2') &&
      Array.isArray(decision.queue) &&
      decision.queue.every((direction: unknown) => validDirections.includes(direction as Direction)) &&
      typeof decision.lockedAt === 'number' &&
      Number.isFinite(decision.lockedAt) &&
      typeof decision.autoLock === 'boolean',
    );
    const validAgentDriven = obj.agentDriven &&
      typeof obj.agentDriven.p1 === 'boolean' &&
      typeof obj.agentDriven.p2 === 'boolean';
    if (!validDecisions || !validAgentDriven) {
      throw new Error("That file isn't a Snake Royale replay");
    }
    decisions = obj.decisions;
    agentDriven = obj.agentDriven;
  }

  const normalizedStates: GameState[] = obj.states.map((s: any) => normalizeGameState(s as GameState));

  return {
    states: normalizedStates,
    settings: obj.settings,
    decisions,
    agentDriven,
  };
}
