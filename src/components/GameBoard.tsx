import React, { useEffect, useRef } from 'react';
import { Direction, GameSettings, GameState, Position, Snake } from '../types/game';
import { GAMEBOY_COLORS } from '../game/engine';

interface GameBoardProps {
  gameState: GameState;
  settings: GameSettings;
}

export const GameBoard: React.FC<GameBoardProps> = ({ gameState, settings }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gridSize = settings.gridSize;
    const cellSize = 32; // Crisp base internal cell size in pixels
    const boardPixelSize = gridSize * cellSize;

    if (canvas.width !== boardPixelSize || canvas.height !== boardPixelSize) {
      canvas.width = boardPixelSize;
      canvas.height = boardPixelSize;
    }

    // Disable smoothing for sharp retro Game Boy pixels
    ctx.imageSmoothingEnabled = false;

    // 1. Background Fill (Lightest Game Boy shade)
    ctx.fillStyle = GAMEBOY_COLORS.LIGHTEST;
    ctx.fillRect(0, 0, boardPixelSize, boardPixelSize);

    // 2. Subtle LCD Dot Matrix / Grid lines
    ctx.fillStyle = GAMEBOY_COLORS.LIGHT;
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        // Micro grid intersection pixel
        ctx.fillRect(x * cellSize, y * cellSize, 1, 1);
        ctx.fillRect((x + 1) * cellSize - 1, y * cellSize, 1, 1);
      }
    }

    // 3. Render Shrink Ring / Outer Walls (Closed in)
    const ringInset = gameState.ringInset;
    if (ringInset > 0) {
      ctx.fillStyle = GAMEBOY_COLORS.DARKEST;
      for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
          const isShrunkWall = x < ringInset || x >= gridSize - ringInset || y < ringInset || y >= gridSize - ringInset;
          if (isShrunkWall) {
            renderShrunkWallCell(ctx, x * cellSize, y * cellSize, cellSize);
          }
        }
      }
    }

    // 4. Render Telegraph Warning for Shrink Phase (Blinking hazard)
    if (gameState.isTelegraphingShrink) {
      const telegraphInset = gameState.telegraphRingInset;
      // Pulse blink every 200ms
      const blinkState = Math.floor(Date.now() / 200) % 2 === 0;
      if (blinkState) {
        ctx.fillStyle = GAMEBOY_COLORS.DARK;
        for (let x = 0; x < gridSize; x++) {
          for (let y = 0; y < gridSize; y++) {
            const isWarningWall = (x === telegraphInset - 1 || x === gridSize - telegraphInset ||
                                   y === telegraphInset - 1 || y === gridSize - telegraphInset) &&
                                  (x >= ringInset && x < gridSize - ringInset && y >= ringInset && y < gridSize - ringInset);
            if (isWarningWall) {
              renderTelegraphCell(ctx, x * cellSize, y * cellSize, cellSize);
            }
          }
        }
      }
    }

    // 5. Render Tokens (Escalating Round Tokens)
    const tokenBlink = Math.floor(Date.now() / 250) % 2 === 0;
    for (const token of gameState.tokens) {
      renderToken(ctx, token.x * cellSize, token.y * cellSize, cellSize, tokenBlink);
    }

    // 6. Render Snakes
    renderSnake(ctx, gameState.snakes.p1, cellSize, '#0F380F', '#8BAC0F', 'P1');
    renderSnake(ctx, gameState.snakes.p2, cellSize, '#306230', '#9BBC0F', 'P2');

    // 7. Outer Frame Border
    ctx.strokeStyle = GAMEBOY_COLORS.DARKEST;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, boardPixelSize - 4, boardPixelSize - 4);

  }, [gameState, settings]);

  return (
    <div className="relative flex flex-col items-center justify-center p-2 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[inset_0_0_12px_rgba(15,56,15,0.4)]">
      <canvas
        ref={canvasRef}
        className="w-full h-full max-w-full aspect-square block pixelated border-2 border-[#306230]"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};

// Helper: Render Snake Body & Head
function renderSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  cellSize: number,
  bodyColor: string,
  accentColor: string,
  _label: string
) {
  if (snake.body.length === 0) return;

  // Render Body Segments (from tail to neck)
  for (let i = snake.body.length - 1; i >= 1; i--) {
    const seg = snake.body[i];
    const prevSeg = snake.body[i - 1];
    const px = seg.x * cellSize;
    const py = seg.y * cellSize;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);

    // Subtle scale pattern / inner block
    ctx.fillStyle = accentColor;
    ctx.fillRect(px + 6, py + 6, cellSize - 12, cellSize - 12);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(px + 10, py + 10, cellSize - 20, cellSize - 20);

    // Bridge connector to adjacent segment for continuous snake feel
    if (prevSeg) {
      const dx = prevSeg.x - seg.x;
      const dy = prevSeg.y - seg.y;
      if (dx === 1) ctx.fillRect(px + cellSize - 3, py + 2, 4, cellSize - 4);
      if (dx === -1) ctx.fillRect(px - 1, py + 2, 4, cellSize - 4);
      if (dy === 1) ctx.fillRect(px + 2, py + cellSize - 3, cellSize - 4, 4);
      if (dy === -1) ctx.fillRect(px + 2, py - 1, cellSize - 4, 4);
    }
  }

  // Render Head Segment
  const head = snake.body[0];
  const hx = head.x * cellSize;
  const hy = head.y * cellSize;

  ctx.fillStyle = bodyColor;
  ctx.fillRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);

  // Directional Eyes
  renderEyes(ctx, hx, hy, cellSize, snake.direction, accentColor, bodyColor);

  // If snake died, draw small X mark on head
  if (!snake.isAlive) {
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx + 6, hy + 6);
    ctx.lineTo(hx + cellSize - 6, hy + cellSize - 6);
    ctx.moveTo(hx + cellSize - 6, hy + 6);
    ctx.lineTo(hx + 6, hy + cellSize - 6);
    ctx.stroke();
  }
}

function renderEyes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  dir: Direction,
  eyeWhite: string,
  eyePupil: string
) {
  const eyeSize = 6;
  const pupilSize = 3;
  let e1: Position = { x: 0, y: 0 };
  let e2: Position = { x: 0, y: 0 };
  let p1: Position = { x: 0, y: 0 };
  let p2: Position = { x: 0, y: 0 };

  switch (dir) {
    case 'UP':
      e1 = { x: x + 4, y: y + 4 };
      e2 = { x: x + size - 4 - eyeSize, y: y + 4 };
      p1 = { x: e1.x + 1, y: e1.y };
      p2 = { x: e2.x + 2, y: e2.y };
      break;
    case 'DOWN':
      e1 = { x: x + 4, y: y + size - 4 - eyeSize };
      e2 = { x: x + size - 4 - eyeSize, y: y + size - 4 - eyeSize };
      p1 = { x: e1.x + 1, y: e1.y + 3 };
      p2 = { x: e2.x + 2, y: e2.y + 3 };
      break;
    case 'LEFT':
      e1 = { x: x + 4, y: y + 4 };
      e2 = { x: x + 4, y: y + size - 4 - eyeSize };
      p1 = { x: e1.x, y: e1.y + 1 };
      p2 = { x: e2.x, y: e2.y + 2 };
      break;
    case 'RIGHT':
      e1 = { x: x + size - 4 - eyeSize, y: y + 4 };
      e2 = { x: x + size - 4 - eyeSize, y: y + size - 4 - eyeSize };
      p1 = { x: e1.x + 3, y: e1.y + 1 };
      p2 = { x: e2.x + 3, y: e2.y + 2 };
      break;
  }

  // Draw eye bases
  ctx.fillStyle = eyeWhite;
  ctx.fillRect(e1.x, e1.y, eyeSize, eyeSize);
  ctx.fillRect(e2.x, e2.y, eyeSize, eyeSize);

  // Draw pupils
  ctx.fillStyle = eyePupil;
  ctx.fillRect(p1.x, p1.y, pupilSize, pupilSize);
  ctx.fillRect(p2.x, p2.y, pupilSize, pupilSize);
}

// Helper: Render Token (Coin / Gem)
function renderToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  isAltBlink: boolean
) {
  const primary = isAltBlink ? GAMEBOY_COLORS.DARKEST : GAMEBOY_COLORS.DARK;
  const highlight = isAltBlink ? GAMEBOY_COLORS.LIGHT : GAMEBOY_COLORS.LIGHTEST;

  // Diamond / Coin pixel sprite
  ctx.fillStyle = primary;
  ctx.fillRect(x + 6, y + 2, size - 12, size - 4);
  ctx.fillRect(x + 2, y + 6, size - 4, size - 12);

  // Inner sparkle
  ctx.fillStyle = highlight;
  ctx.fillRect(x + 8, y + 8, size - 16, size - 16);
  ctx.fillStyle = primary;
  ctx.fillRect(x + 12, y + 12, size - 24, size - 24);
}

// Helper: Shrunk Wall cell with chunky brick crosshatch pattern
function renderShrunkWallCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
) {
  ctx.fillStyle = GAMEBOY_COLORS.DARKEST;
  ctx.fillRect(x, y, size, size);

  // Brick lines in DARK
  ctx.fillStyle = GAMEBOY_COLORS.DARK;
  ctx.fillRect(x + 1, y + 1, size - 2, 2);
  ctx.fillRect(x + 1, y + Math.floor(size / 2), size - 2, 2);
  ctx.fillRect(x + Math.floor(size / 2), y + 3, 2, Math.floor(size / 2) - 3);
  ctx.fillRect(x + 2, y + Math.floor(size / 2) + 2, 2, Math.floor(size / 2) - 3);
}

// Helper: Telegraph Warning Cell
function renderTelegraphCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
) {
  ctx.fillStyle = GAMEBOY_COLORS.DARK;
  // Diagonal warning hash
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  ctx.fillStyle = GAMEBOY_COLORS.LIGHT;
  ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
}
