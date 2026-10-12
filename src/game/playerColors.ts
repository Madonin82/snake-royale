import { PlayMode, Snake } from '../types/game';

export const PLAYER_HEX_COLORS = ['#0F380F', '#306230', '#8B1E0F', '#5B2C83'] as const;

export interface PlayerColorPalette {
  hex: string;
  chipBg: string;
  borderColor: string;
  badgeBg: string;
  defaultShadow: string;
  lockedShadow: string;
  activeHighlight: string;
}

const PALETTES: Record<string, PlayerColorPalette> = {
  '#0F380F': {
    hex: '#0F380F',
    chipBg: 'bg-[#0F380F]',
    borderColor: 'border-[#0F380F]',
    badgeBg: 'bg-[#0F380F] text-[#9BBC0F]',
    defaultShadow: 'shadow-[3px_3px_0px_#0F380F]',
    lockedShadow: 'shadow-[1px_1px_0px_#0F380F]',
    activeHighlight: 'ring-2 ring-[#E0F8CF] shadow-[0_0_14px_rgba(224,248,207,0.95),3px_3px_0px_#0F380F]',
  },
  '#306230': {
    hex: '#306230',
    chipBg: 'bg-[#306230]',
    borderColor: 'border-[#306230]',
    badgeBg: 'bg-[#306230] text-[#9BBC0F]',
    defaultShadow: 'shadow-[3px_3px_0px_#306230]',
    lockedShadow: 'shadow-[1px_1px_0px_#306230]',
    activeHighlight: 'ring-2 ring-[#E0F8CF] shadow-[0_0_14px_rgba(224,248,207,0.95),3px_3px_0px_#306230]',
  },
  '#8B1E0F': {
    hex: '#8B1E0F',
    chipBg: 'bg-[#8B1E0F]',
    borderColor: 'border-[#8B1E0F]',
    badgeBg: 'bg-[#8B1E0F] text-[#9BBC0F]',
    defaultShadow: 'shadow-[3px_3px_0px_#8B1E0F]',
    lockedShadow: 'shadow-[1px_1px_0px_#8B1E0F]',
    activeHighlight: 'ring-2 ring-[#E0F8CF] shadow-[0_0_14px_rgba(224,248,207,0.95),3px_3px_0px_#8B1E0F]',
  },
  '#5B2C83': {
    hex: '#5B2C83',
    chipBg: 'bg-[#5B2C83]',
    borderColor: 'border-[#5B2C83]',
    badgeBg: 'bg-[#5B2C83] text-[#9BBC0F]',
    defaultShadow: 'shadow-[3px_3px_0px_#5B2C83]',
    lockedShadow: 'shadow-[1px_1px_0px_#5B2C83]',
    activeHighlight: 'ring-2 ring-[#E0F8CF] shadow-[0_0_14px_rgba(224,248,207,0.95),3px_3px_0px_#5B2C83]',
  },
};

const SEAT_DEFAULT_HEX: Record<string, string> = {
  p1: '#0F380F',
  p2: '#306230',
  p3: '#8B1E0F',
  p4: '#5B2C83',
};

export function getPlayerColorPalette(snakeOrSeat: Pick<Snake, 'id' | 'color'> | string, index?: number): PlayerColorPalette {
  if (typeof snakeOrSeat === 'string') {
    const hex = SEAT_DEFAULT_HEX[snakeOrSeat] ?? PLAYER_HEX_COLORS[index ?? 0] ?? '#0F380F';
    return PALETTES[hex] ?? PALETTES['#0F380F'];
  }
  const normalizedColor = snakeOrSeat.color?.toUpperCase();
  if (normalizedColor && PALETTES[normalizedColor]) {
    return PALETTES[normalizedColor];
  }
  const fallbackHex = SEAT_DEFAULT_HEX[snakeOrSeat.id] ?? PLAYER_HEX_COLORS[index ?? 0] ?? '#0F380F';
  return PALETTES[fallbackHex] ?? PALETTES['#0F380F'];
}

/**
 * Splits players into left and right side groups:
 * - For 2 players: Left = [P1], Right = [P2]
 * - For 3-4 players: Left = [P1, P2], Right = [P3, P4] (2 per side, never 1 on one side and 3 on the other)
 */
export function splitPlayersTwoPerSide<T>(items: T[]): { left: T[]; right: T[] } {
  if (items.length <= 2) {
    return {
      left: items.slice(0, 1),
      right: items.slice(1, 2),
    };
  }
  return {
    left: items.slice(0, 2),
    right: items.slice(2, 4),
  };
}

/**
 * Returns the seat tag to append after a player's name, avoiding any
 * redundant "(BOT 3)" suffix on bots that are named or already default to "BOT N".
 */
export function getSeatDisplayTag(
  seat: string,
  playMode: PlayMode,
  viewerSeat?: 'p1' | 'p2' | null,
): string {
  const seatNumber = Number(seat.slice(1));
  if (playMode === 'ONLINE_SERVER' || playMode === 'ONLINE_SPECTATOR') return `(P${seatNumber})`;
  if (playMode === 'SOLO_AI') return seat === 'p1' ? '(YOU)' : '';
  if (playMode === 'LOCAL_2P') return `(P${seatNumber})`;
  if (viewerSeat) return viewerSeat === seat ? '(YOU)' : '(REMOTE)';
  return seat === 'p1' ? '(YOU)' : '';
}
