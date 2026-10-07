import { Direction } from '../types/game';

export interface RtdbBridgeCommand {
  seq: number;
  moves?: Direction[];
  lock?: boolean;
  matchId: string;
}

const VALID_DIRECTIONS = new Set<string>(['UP', 'DOWN', 'LEFT', 'RIGHT']);

export function shouldApplyRtdbBridgeCommand(
  value: unknown,
  activeMatchId: string | null,
  lastAppliedSeq: number,
): value is RtdbBridgeCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const command = value as Record<string, unknown>;
  const seq = command.seq;
  const matchId = command.matchId;
  if (
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    typeof matchId !== 'string'
  ) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(command, 'moves')) {
    const moves = command.moves;
    if (
      !Array.isArray(moves) ||
      !moves.every(direction => typeof direction === 'string' && VALID_DIRECTIONS.has(direction))
    ) return false;
  }
  if (Object.prototype.hasOwnProperty.call(command, 'lock') && typeof command.lock !== 'boolean') return false;

  return matchId === activeMatchId && seq > lastAppliedSeq;
}
