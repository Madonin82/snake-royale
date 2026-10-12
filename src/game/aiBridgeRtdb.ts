import { BufferEntry, Direction } from '../types/game';

export interface RtdbBridgeCommand {
  seq: number;
  moves?: (Direction | BufferEntry)[];
  lock?: boolean;
  matchId: string;
}

const VALID_DIRECTIONS = new Set<string>(['UP', 'DOWN', 'LEFT', 'RIGHT']);
const VALID_ENTRY_TYPES = new Set<string>(['move', 'dart', 'rattle']);

function isValidMoveEntry(entry: unknown): boolean {
  if (typeof entry === 'string') {
    return VALID_DIRECTIONS.has(entry);
  }
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const item = entry as Record<string, unknown>;
    return (
      typeof item.type === 'string' &&
      VALID_ENTRY_TYPES.has(item.type) &&
      typeof item.direction === 'string' &&
      VALID_DIRECTIONS.has(item.direction)
    );
  }
  return false;
}

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
      !moves.every(isValidMoveEntry)
    ) return false;
  }
  if (Object.prototype.hasOwnProperty.call(command, 'lock') && typeof command.lock !== 'boolean') return false;

  return matchId === activeMatchId && seq > lastAppliedSeq;
}
