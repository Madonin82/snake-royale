import { GameState, GameSettings } from '../types/game';
import { normalizeGameState } from './normalize';

export interface ReplayFileObject {
  format: 'snake-royale-replay';
  version: number;
  exportedAt: string;
  settings: {
    gridSize: number;
    turnBased: boolean;
    raceTurns: number;
    tickRate: number;
  };
  result: {
    winner: 'p1' | 'p2' | 'DRAW' | null;
    p1Score: number;
    p2Score: number;
  };
  states: GameState[];
}

export function createReplayDataObject(matchHistory: GameState[], settings: GameSettings): ReplayFileObject {
  const finalState = matchHistory[matchHistory.length - 1] || matchHistory[0];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const winner = finalState ? finalState.winner : null;
  const p1Score = finalState ? finalState.snakes.p1.score : 0;
  const p2Score = finalState ? finalState.snakes.p2.score : 0;

  return {
    format: 'snake-royale-replay',
    version: 1,
    exportedAt: now.toISOString(),
    settings: {
      gridSize: settings.gridSize,
      turnBased: settings.turnBased,
      raceTurns: settings.raceTurns,
      tickRate: settings.tickRate,
    },
    result: {
      winner,
      p1Score,
      p2Score,
    },
    states: matchHistory,
  };
}

export function exportReplayToFile(matchHistory: GameState[], settings: GameSettings): void {
  try {
    const replayObj = createReplayDataObject(matchHistory, settings);
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

export function parseAndValidateReplayData(rawText: string): { states: GameState[]; settings?: { gridSize: number; turnBased: boolean; raceTurns: number; tickRate: number } } {
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

  if (obj.format !== 'snake-royale-replay' || obj.version !== 1 || !Array.isArray(obj.states) || obj.states.length <= 1) {
    throw new Error("That file isn't a Snake Royale replay");
  }

  const normalizedStates: GameState[] = obj.states.map((s: any) => normalizeGameState(s as GameState));

  return {
    states: normalizedStates,
    settings: obj.settings,
  };
}
