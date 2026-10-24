import type { BufferEntry } from '../types/game';

/**
 * Pure pending-prime plan transitions, extracted from App.tsx so they
 * can be unit-tested. Escrow is derived from the buffer + pending
 * counter, never a separate counter — so undo/clear/lock refunds are
 * automatic: dropping the counter (or the step carrying the primes)
 * is the refund.
 *
 * - undoPlan: one undo press. While primes are pending, it un-primes
 *   one segment. Only when no primes are pending does it pop the
 *   last buffered step (and with it, that step's attached primes).
 * - clearPlan: clear the whole plan — buffer and pending counter.
 * - lockPlan: lock the plan — buffered steps stand, pending primes
 *   are dropped (they were never attached to a step).
 */
export function undoPlan(
  buffer: BufferEntry[],
  pendingPrimes: number,
): { buffer: BufferEntry[]; pendingPrimes: number } {
  if (pendingPrimes > 0) {
    return { buffer: [...buffer], pendingPrimes: pendingPrimes - 1 };
  }
  return { buffer: buffer.slice(0, -1), pendingPrimes: 0 };
}

export function clearPlan(): { buffer: BufferEntry[]; pendingPrimes: number } {
  return { buffer: [], pendingPrimes: 0 };
}

export function lockPlan(
  buffer: BufferEntry[],
  _pendingPrimes: number,
): { buffer: BufferEntry[]; pendingPrimes: number } {
  return { buffer: [...buffer], pendingPrimes: 0 };
}
