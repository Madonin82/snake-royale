import { AIBrain } from './types';
import { opportunistBrain } from './brains/opportunist';
import { avalenaBrain } from './brains/avalena';
import { legacyBrain } from './brains/legacy';
import { v2Brain } from './brains/v2';
import { constrictorBrain } from './brains/constrictor';

export const BRAINS: Record<string, AIBrain> = {
  opportunist: opportunistBrain,
  avalena: avalenaBrain,
  legacy: legacyBrain,
  v2: v2Brain,
  constrictor: constrictorBrain,
};

export function getBrain(aiStyle?: string, difficulty?: 'EASY' | 'MEDIUM' | 'HARD'): { brain: AIBrain; effectiveDifficulty: 'EASY' | 'MEDIUM' | 'HARD' } {
  const norm = (aiStyle || '').toLowerCase();
  if (norm === 'legacy' || norm.startsWith('legacy_')) {
    const diffPart = norm.startsWith('legacy_') ? norm.replace('legacy_', '').toUpperCase() : (difficulty || 'MEDIUM');
    const diff = (diffPart === 'EASY' || diffPart === 'MEDIUM' || diffPart === 'HARD') ? diffPart : (difficulty || 'MEDIUM');
    return { brain: BRAINS['legacy'], effectiveDifficulty: diff };
  }
  if (norm === 'avalena') {
    return { brain: BRAINS['avalena'], effectiveDifficulty: difficulty || 'HARD' };
  }
  if (norm === 'constrictor' || norm === 'v3') {
    // 'v3' was the brain's working id before batch 4 earned it the name
    // Constrictor — kept resolving for saved levels and replays.
    return { brain: BRAINS['constrictor'], effectiveDifficulty: difficulty || 'MEDIUM' };
  }
  if (norm === 'v2') {
    return { brain: BRAINS['v2'], effectiveDifficulty: difficulty || 'MEDIUM' };
  }
  if (norm === 'opportunist') {
    return { brain: BRAINS['opportunist'], effectiveDifficulty: difficulty || 'MEDIUM' };
  }
  // The main-game seat (Jimmy's ruling, 2026-10-22): Constrictor is the
  // HARD bot. An unnamed seat at HARD — quickplay, where settings carry
  // no aiStyle — gets the Constrictor. Every named style (including the
  // editor's difficulty presets) and the EASY/MEDIUM seats resolve
  // exactly as before.
  if (!norm && difficulty === 'HARD') {
    return { brain: BRAINS['constrictor'], effectiveDifficulty: 'HARD' };
  }
  return { brain: BRAINS['opportunist'], effectiveDifficulty: difficulty || 'MEDIUM' };
}

export function listBrains(): AIBrain[] {
  return Object.values(BRAINS);
}
