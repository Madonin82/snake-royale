import type { Snake } from '../types/game';

export function withLegacySnakeAccessors(snakes: Snake[]): Snake[] {
  for (const id of ['p1', 'p2']) {
    if (Object.prototype.hasOwnProperty.call(snakes, id)) continue;
    Object.defineProperty(snakes, id, {
      configurable: true,
      enumerable: false,
      get: () => snakes.find(snake => snake.id === id),
    });
  }
  return snakes;
}
