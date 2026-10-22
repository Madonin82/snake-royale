import { AIBrain } from './types';
import { opportunistBrain } from './brains/opportunist';
import { avalenaBrain } from './brains/avalena';
import { legacyBrain } from './brains/legacy';

export const BRAINS: Record<string, AIBrain> = {
  opportunist: opportunistBrain,
  avalena: avalenaBrain,
  legacy: legacyBrain,
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
  if (norm === 'opportunist') {
    return { brain: BRAINS['opportunist'], effectiveDifficulty: difficulty || 'MEDIUM' };
  }
  return { brain: BRAINS['opportunist'], effectiveDifficulty: difficulty || 'MEDIUM' };
}

export function listBrains(): AIBrain[] {
  return Object.values(BRAINS);
}
