import { CampaignObjective, GameState } from '../types/game';

const OBJECTIVE_PATTERN = /^(collect|first_to|survive|win_under|shutout|outscore)(?::(\d+))?$/i;

export function parseCampaignObjective(text: string): CampaignObjective | null {
  const match = OBJECTIVE_PATTERN.exec(text.trim());
  if (!match) return null;

  const kind = match[1].toLowerCase() as CampaignObjective['kind'];
  const requiresTarget = kind !== 'shutout';
  const target = requiresTarget ? Number(match[2]) : 0;
  if (requiresTarget && (!Number.isSafeInteger(target) || target < 1)) return null;
  if (!requiresTarget && match[2] !== undefined) return null;

  return { text, kind, target };
}

export function createCampaignObjectives(
  primaryText: string,
  bonusTexts: string[],
  p1Score: number,
  opponentScore: number,
): NonNullable<GameState['campaignObjectives']> {
  const primary = parseCampaignObjective(primaryText);
  const bonus = bonusTexts.map(parseCampaignObjective);
  const firstToResults = [primary, ...bonus].map(objective => {
    if (objective?.kind !== 'first_to') return null;
    const p1Reached = p1Score >= objective.target;
    const opponentReached = opponentScore >= objective.target;
    // In the current two-snake campaign, opponent means P2. For future matches,
    // this comparison uses the highest-scoring other snake.
    return p1Reached && opponentReached ? 'tie' : p1Reached ? 'p1' : opponentReached ? 'opponent' : null;
  });

  return {
    primary,
    bonus,
    p1TokensCollected: 0,
    firstToResults,
    surviveResults: [primary, ...bonus].map(() => false),
  };
}

export function recordFirstToResults(state: GameState): void {
  const objectives = state.campaignObjectives;
  if (!objectives) return;
  const p1 = state.snakes.find(snake => snake.id === 'p1');
  const opponents = state.snakes.filter(snake => snake.id !== 'p1');
  if (!p1) return;

  [objectives.primary, ...objectives.bonus].forEach((objective, index) => {
    if (!objective || objective.kind !== 'first_to' || objectives.firstToResults[index]) return;
    // In the current two-snake campaign, opponent means P2. For future matches,
    // the highest score across other snakes determines the opponent threshold.
    const p1Reached = p1.score >= objective.target;
    const opponentReached = opponents.some(snake => snake.score >= objective.target);
    if (p1Reached && opponentReached) objectives.firstToResults[index] = 'tie';
    else if (p1Reached) objectives.firstToResults[index] = 'p1';
    else if (opponentReached) objectives.firstToResults[index] = 'opponent';
  });
}

export function recordSurviveResults(state: GameState): void {
  const objectives = state.campaignObjectives;
  const p1 = state.snakes.find(snake => snake.id === 'p1');
  if (!objectives || !p1?.isAlive) return;

  [objectives.primary, ...objectives.bonus].forEach((objective, index) => {
    if (objective?.kind === 'survive' && state.tick >= objective.target) {
      objectives.surviveResults[index] = true;
    }
  });
}

export function isCampaignObjectiveComplete(
  objective: CampaignObjective,
  state: GameState,
  objectiveIndex: number,
): boolean {
  const p1 = state.snakes.find(snake => snake.id === 'p1');
  const opponents = state.snakes.filter(snake => snake.id !== 'p1');
  const opponentScore = Math.max(0, ...opponents.map(snake => snake.score));
  if (!p1) return false;

  switch (objective.kind) {
    case 'collect':
      return (state.campaignObjectives?.p1TokensCollected ?? 0) >= objective.target;
    case 'first_to':
      return state.campaignObjectives?.firstToResults[objectiveIndex] === 'p1';
    case 'survive':
      return state.campaignObjectives?.surviveResults[objectiveIndex] === true;
    case 'win_under':
      return state.phase === 'OVER' && state.winner === 'p1' && state.tick < objective.target;
    case 'shutout':
      return state.phase === 'OVER' && state.winner === 'p1' && opponents.every(snake => snake.score === 0);
    case 'outscore':
      return state.phase === 'OVER' && p1.score - opponentScore >= objective.target;
  }
}

export function getCampaignObjectiveProgress(
  objective: CampaignObjective,
  state: GameState,
  objectiveIndex: number,
): string {
  switch (objective.kind) {
    case 'collect':
      return `Tokens: ${state.campaignObjectives?.p1TokensCollected ?? 0}/${objective.target}`;
    case 'first_to': {
      const p1Score = state.snakes.find(snake => snake.id === 'p1')?.score ?? 0;
      // Opponent means the highest-scoring other snake if campaign matches ever add more seats.
      const opponentScore = Math.max(0, ...state.snakes
        .filter(snake => snake.id !== 'p1')
        .map(snake => snake.score));
      return `First to ${objective.target}: P1 ${p1Score}, OP ${opponentScore}`;
    }
    case 'survive':
      return `Turns: ${state.campaignObjectives?.surviveResults[objectiveIndex]
        ? objective.target
        : Math.min(state.tick, objective.target - 1)}/${objective.target}`;
    case 'win_under':
      return `Win before turn ${objective.target} (now ${state.tick})`;
    case 'shutout':
      return `Opponent tokens: ${Math.max(0, ...state.snakes
        .filter(snake => snake.id !== 'p1')
        .map(snake => snake.score))}/0`;
    case 'outscore': {
      const p1Score = state.snakes.find(snake => snake.id === 'p1')?.score ?? 0;
      const opponentScore = Math.max(0, ...state.snakes
        .filter(snake => snake.id !== 'p1')
        .map(snake => snake.score));
      return `Score lead: ${p1Score - opponentScore}/${objective.target}`;
    }
  }
}
