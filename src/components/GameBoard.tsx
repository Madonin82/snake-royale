import React, { PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { Direction, GameSettings, GameState, Position, Snake } from '../types/game';
import { GAMEBOY_COLORS, HitstopInfo } from '../game/engine';

interface GameBoardProps {
  gameState: GameState;
  settings: GameSettings;
  lockedPaths?: Record<string, Position[] | undefined>;
  plannedPaths?: Record<string, Position[] | undefined>;
  controlSeat: 'p1' | 'p2';
  onDirection: (direction: Direction, touchSeat?: 'p1' | 'p2') => void;
  interactionEnabled: boolean;
  splitTouchSeats?: boolean;
  animationsDisabled?: boolean;
  hitstop?: HitstopInfo | null;
  fatalMoveAnimating?: string[];
  deniedCells?: { x: number; y: number }[];
  onCellClick?: (cell: Position, event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCellDoubleClick?: (cell: Position, event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCellContextMenu?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  gameState, settings, lockedPaths, plannedPaths, controlSeat, onDirection, interactionEnabled,
  splitTouchSeats = false,
  animationsDisabled = false,
  hitstop = null,
  fatalMoveAnimating = [],
  deniedCells = [],
  onCellClick,
  onCellDoubleClick,
  onCellContextMenu,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastPointerTypeRef = useRef<string>('mouse');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gridSize = gameState.gridSize ?? settings.gridSize;
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
      const blinkState = !animationsDisabled && Math.floor(Date.now() / 200) % 2 === 0;
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

    // Campaign playtest walls are permanent cells within the arena.
    const rattleWallSet = new Set(
      (gameState.rattleWalls ?? []).map(w => `${w.x},${w.y}`),
    );
    for (const wall of gameState.walls ?? []) {
      if (rattleWallSet.has(`${wall.x},${wall.y}`)) continue;
      ctx.fillStyle = GAMEBOY_COLORS.DARKEST;
      ctx.fillRect(wall.x * cellSize, wall.y * cellSize, cellSize, cellSize);
      ctx.fillStyle = GAMEBOY_COLORS.DARK;
      ctx.fillRect(wall.x * cellSize + 4, wall.y * cellSize + 4, cellSize - 8, cellSize - 8);
    }

    // Rattle walls: tail-sized solid black square (distinct from full-cell walls and hollow attached tail tips)
    for (const wall of gameState.rattleWalls ?? []) {
      renderRattleWall(ctx, wall.x * cellSize, wall.y * cellSize, cellSize);
    }

    // 5. Render Tokens (Escalating Round Tokens)
    const tokenBlink = !animationsDisabled && Math.floor(Date.now() / 250) % 2 === 0;
    for (const token of gameState.tokens) {
      renderToken(ctx, token.x * cellSize, token.y * cellSize, cellSize, tokenBlink);
    }

    // 6. Render Planned Paths (Hatched pattern during planning) and Locked Paths (Solid committed shading)
    if (plannedPaths) {
      for (const snake of gameState.snakes) {
        if (lockedPaths?.[snake.id]) continue;
        const path = plannedPaths[snake.id];
        if (!path || path.length === 0) continue;

        const isP1 = snake.id === 'p1';
        const washColor = isP1 ? 'rgba(15, 56, 15, 0.08)' : 'rgba(48, 98, 48, 0.10)';
        const hatchColor = isP1 ? 'rgba(15, 56, 15, 0.40)' : 'rgba(48, 98, 48, 0.45)';
        const outlineColor = isP1 ? 'rgba(15, 56, 15, 0.45)' : 'rgba(48, 98, 48, 0.50)';

        // Draw planned cells (lighter + diagonal hatch lines)
        for (const pos of path) {
          const rx = pos.x * cellSize + 6;
          const ry = pos.y * cellSize + 6;
          const rw = cellSize - 12;
          const rh = cellSize - 12;

          // Lighter background wash
          ctx.fillStyle = washColor;
          ctx.fillRect(rx, ry, rw, rh);

          // Diagonal hatch lines
          ctx.save();
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          ctx.clip();

          ctx.strokeStyle = hatchColor;
          ctx.lineWidth = 1.5;
          const step = 5;
          for (let offset = -rh; offset <= rw + rh; offset += step) {
            ctx.beginPath();
            ctx.moveTo(rx + offset, ry);
            ctx.lineTo(rx + offset + rh, ry + rh);
            ctx.stroke();
          }

          // Subtle light border around the planned path cell
          ctx.strokeStyle = outlineColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
          ctx.restore();
        }

        // Distinct marker on the virtual head cell (the endpoint / click-to-lock target)
        const endpoint = path[path.length - 1];
        if (endpoint) {
          const epX = endpoint.x * cellSize;
          const epY = endpoint.y * cellSize;

          ctx.save();
          const targetColor = isP1 ? GAMEBOY_COLORS.DARKEST : GAMEBOY_COLORS.DARK;

          // Subtle wash inside endpoint cell
          const pulseAlpha = animationsDisabled ? 0.25 : 0.18 + 0.12 * Math.sin(Date.now() / 200);
          ctx.fillStyle = isP1 ? `rgba(15, 56, 15, ${pulseAlpha})` : `rgba(48, 98, 48, ${pulseAlpha})`;
          ctx.fillRect(epX + 3, epY + 3, cellSize - 6, cellSize - 6);

          // Distinct crisp outline around endpoint
          ctx.strokeStyle = targetColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(epX + 3, epY + 3, cellSize - 6, cellSize - 6);

          // Corner bracket reticles
          const cornerLen = 5;
          ctx.beginPath();
          // Top-left
          ctx.moveTo(epX + 3, epY + 3 + cornerLen);
          ctx.lineTo(epX + 3, epY + 3);
          ctx.lineTo(epX + 3 + cornerLen, epY + 3);
          // Top-right
          ctx.moveTo(epX + cellSize - 3 - cornerLen, epY + 3);
          ctx.lineTo(epX + cellSize - 3, epY + 3);
          ctx.lineTo(epX + cellSize - 3, epY + 3 + cornerLen);
          // Bottom-left
          ctx.moveTo(epX + 3, epY + cellSize - 3 - cornerLen);
          ctx.lineTo(epX + 3, epY + cellSize - 3);
          ctx.lineTo(epX + 3 + cornerLen, epY + cellSize - 3);
          // Bottom-right
          ctx.moveTo(epX + cellSize - 3 - cornerLen, epY + cellSize - 3);
          ctx.lineTo(epX + cellSize - 3, epY + cellSize - 3);
          ctx.lineTo(epX + cellSize - 3, epY + cellSize - 3 - cornerLen);
          ctx.stroke();

          // Small center target pip
          ctx.fillStyle = targetColor;
          ctx.fillRect(epX + cellSize / 2 - 2, epY + cellSize / 2 - 2, 4, 4);

          ctx.restore();
        }
      }
    }

    if (lockedPaths) {
      for (const snake of gameState.snakes) {
        const path = lockedPaths[snake.id];
        if (!path) continue;
        ctx.fillStyle = snake.id === 'p1' ? 'rgba(15, 56, 15, 0.22)' : 'rgba(48, 98, 48, 0.28)';
        for (const pos of path) {
          ctx.fillRect(pos.x * cellSize + 6, pos.y * cellSize + 6, cellSize - 12, cellSize - 12);
        }
      }
    }

    // 7. Render Snakes
    for (const snake of gameState.snakes) {
      const isFirst = gameState.snakes[0]?.id === snake.id;
      const isAnimatingFatalMove = !snake.isAlive && fatalMoveAnimating.includes(snake.id);
      const isDuringDeathHitstop = Boolean(
        !snake.isAlive &&
        hitstop &&
        (hitstop.kind === 'DEATH' || hitstop.kind === 'BOSS_DEATH') &&
        hitstop.flashCells.some(cell =>
          (snake.body[0] && cell.x === snake.body[0].x && cell.y === snake.body[0].y) ||
          (snake.deathPosition && cell.x === snake.deathPosition.x && cell.y === snake.deathPosition.y),
        ),
      );
      const renderAsAlive = snake.isAlive || isDuringDeathHitstop || isAnimatingFatalMove;
      const bodyColor = !renderAsAlive
        ? GAMEBOY_COLORS.DARKEST
        : (snake.color || (isFirst
          ? GAMEBOY_COLORS.DARKEST
          : GAMEBOY_COLORS.DARK));
      const accentColor = !renderAsAlive
        ? GAMEBOY_COLORS.DARKEST
        : isFirst
          ? GAMEBOY_COLORS.LIGHT
          : GAMEBOY_COLORS.LIGHTEST;
      renderSnake(
        ctx,
        snake,
        cellSize,
        bodyColor,
        accentColor,
        snake.id,
        isAnimatingFatalMove,
      );
    }

    // 8. Persistent red direction arrow on dead snake head cell for the rest of the match
    for (const snake of gameState.snakes) {
      if (snake.isAlive) continue;
      if (fatalMoveAnimating.includes(snake.id)) continue;
      const headPos = snake.body[0] || snake.deathPosition;
      if (!headPos) continue;
      const isFlashingNow = Boolean(
        hitstop &&
        (hitstop.kind === 'DEATH' || hitstop.kind === 'BOSS_DEATH') &&
        hitstop.flashCells.some(cell =>
          (cell.x === headPos.x && cell.y === headPos.y) ||
          (snake.deathPosition && cell.x === snake.deathPosition.x && cell.y === snake.deathPosition.y),
        ),
      );
      if (!isFlashingNow) {
        renderDeathMarker(ctx, headPos.x * cellSize, headPos.y * cellSize, cellSize, snake.direction);
      }
    }

    // 8b. White flash on the death cell during death hitstop
    if (hitstop && (hitstop.kind === 'DEATH' || hitstop.kind === 'BOSS_DEATH') && hitstop.flashCells.length > 0) {
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      for (const cell of hitstop.flashCells) {
        const cx = Math.max(0, Math.min(gridSize - 1, cell.x));
        const cy = Math.max(0, Math.min(gridSize - 1, cell.y));
        ctx.fillRect(cx * cellSize, cy * cellSize, cellSize, cellSize);
      }
      ctx.restore();
    }

    // 8c. Dart afterimage trail — fading ghost heads on intermediate cells
    if (hitstop && hitstop.kind === 'DART' && gameState.dartTrail) {
      ctx.save();
      for (const trail of gameState.dartTrail) {
        const snake = gameState.snakes.find(s => s.id === trail.snakeId);
        const baseColor = snake?.id === 'p1' ? GAMEBOY_COLORS.DARKEST : GAMEBOY_COLORS.DARK;
        trail.cells.forEach((cell, idx) => {
          // Fade: first cell (earliest) more transparent, later cells more solid
          const opacity = 0.25 + (idx / Math.max(1, trail.cells.length)) * 0.35;
          ctx.globalAlpha = opacity;
          ctx.fillStyle = baseColor;
          const cx = Math.max(0, Math.min(gridSize - 1, cell.x));
          const cy = Math.max(0, Math.min(gridSize - 1, cell.y));
          // Ghost head: slightly inset square
          const inset = cellSize * 0.15;
          ctx.fillRect(
            cx * cellSize + inset,
            cy * cellSize + inset,
            cellSize - inset * 2,
            cellSize - inset * 2
          );
        });
      }
      ctx.restore();
    }

    // 10. Render Denied Cell X Flashes
    if (deniedCells && deniedCells.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#5A6E5A'; // Retro Game Boy LCD gray
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const cell of deniedCells) {
        const px = cell.x * cellSize;
        const py = cell.y * cellSize;
        const pad = Math.floor(cellSize * 0.22);
        ctx.beginPath();
        ctx.moveTo(px + pad, py + pad);
        ctx.lineTo(px + cellSize - pad, py + cellSize - pad);
        ctx.moveTo(px + cellSize - pad, py + pad);
        ctx.lineTo(px + pad, py + cellSize - pad);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 11. Outer Frame Border
    ctx.strokeStyle = GAMEBOY_COLORS.DARKEST;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, boardPixelSize - 4, boardPixelSize - 4);

  }, [gameState, settings, lockedPaths, plannedPaths, animationsDisabled, hitstop, fatalMoveAnimating, deniedCells]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    lastPointerTypeRef.current = event.pointerType;
    if (!interactionEnabled || event.pointerType !== 'touch') return;
    pointerStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!interactionEnabled || !start || start.id !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const touchSeat = splitTouchSeats && rect
      ? start.y < rect.top + rect.height / 2 ? 'p2' : 'p1'
      : undefined;
    if (Math.hypot(deltaX, deltaY) > 12) {
      const direction: Direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? deltaX < 0 ? 'LEFT' : 'RIGHT'
        : deltaY < 0 ? 'UP' : 'DOWN';
      onDirection(direction, touchSeat);
      return;
    }

    const snake = gameState.snakes.find(candidate => candidate.id === (touchSeat ?? controlSeat));
    if (!snake) return;
    const head = snake.body[0];
    if (!canvas || !rect || !head) return;
    const contentLeft = rect.left + canvas.clientLeft;
    const contentTop = rect.top + canvas.clientTop;
    const contentRight = contentLeft + canvas.clientWidth;
    const contentBottom = contentTop + canvas.clientHeight;
    if (event.clientX < contentLeft || event.clientX > contentRight ||
      event.clientY < contentTop || event.clientY > contentBottom) return;

    const cellSize = 32;
    const x = ((event.clientX - contentLeft) / canvas.clientWidth) * canvas.width;
    const y = ((event.clientY - contentTop) / canvas.clientHeight) * canvas.height;
    const left = head.x * cellSize;
    const right = left + cellSize;
    const top = head.y * cellSize;
    const bottom = top + cellSize;
    if (x >= left && x < right && y >= top && y < bottom) return;

    const horizontalDistance = x < left ? left - x : x >= right ? x - right : -1;
    const verticalDistance = y < top ? top - y : y >= bottom ? y - bottom : -1;
    const direction: Direction = horizontalDistance > verticalDistance
      ? x < left ? 'LEFT' : 'RIGHT'
      : y < top ? 'UP' : 'DOWN';
    if (!isReverseDirection(snake.direction, direction)) onDirection(direction, touchSeat);
  };

  const getCellFromMouseEvent = (event: React.MouseEvent<HTMLCanvasElement>): Position | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const contentLeft = rect.left + canvas.clientLeft;
    const contentTop = rect.top + canvas.clientTop;
    if (
      event.clientX < contentLeft || event.clientX >= contentLeft + canvas.clientWidth ||
      event.clientY < contentTop || event.clientY >= contentTop + canvas.clientHeight
    ) return null;

    const gridSize = gameState.gridSize ?? settings.gridSize;
    const cellX = Math.floor(((event.clientX - contentLeft) / canvas.clientWidth) * gridSize);
    const cellY = Math.floor(((event.clientY - contentTop) / canvas.clientHeight) * gridSize);
    if (cellX < 0 || cellX >= gridSize || cellY < 0 || cellY >= gridSize) return null;
    return { x: cellX, y: cellY };
  };

  return (
    <div className="match-board relative flex flex-col items-center justify-center p-2 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[inset_0_0_12px_rgba(15,56,15,0.4)]">
      <canvas
        ref={canvasRef}
        className="w-full h-full max-w-full aspect-square block pixelated border-2 border-[#306230]"
        style={{ imageRendering: 'pixelated' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerStartRef.current = null; }}
        onClick={(e) => {
          if (lastPointerTypeRef.current === 'touch') return;
          if (e.button !== 0) return;
          const cell = getCellFromMouseEvent(e);
          if (cell && onCellClick) onCellClick(cell, e);
        }}
        onDoubleClick={(e) => {
          if (lastPointerTypeRef.current === 'touch') return;
          if (e.button !== 0) return;
          const cell = getCellFromMouseEvent(e);
          if (cell && onCellDoubleClick) onCellDoubleClick(cell, e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (lastPointerTypeRef.current === 'touch') return;
          if (onCellContextMenu) onCellContextMenu(e);
        }}
      />
      {splitTouchSeats && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-3">
          <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-[#0F380F]/45" />
        </div>
      )}
    </div>
  );
};

function isReverseDirection(current: Direction, next: Direction): boolean {
  return (current === 'UP' && next === 'DOWN') ||
    (current === 'DOWN' && next === 'UP') ||
    (current === 'LEFT' && next === 'RIGHT') ||
    (current === 'RIGHT' && next === 'LEFT');
}

// Helper: Render Snake Body & Head
function renderSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  cellSize: number,
  bodyColor: string,
  accentColor: string,
  _label: string,
  lungeFatalMove: boolean = false,
) {
  if (snake.body.length === 0) return;

  const tailIdx = snake.body.length - 1;

  // Render Body Segments (from tail to neck)
  for (let i = tailIdx; i >= 1; i--) {
    const seg = snake.body[i];
    const prevSeg = snake.body[i - 1];
    const px = seg.x * cellSize;
    const py = seg.y * cellSize;

    if (i === tailIdx && tailIdx > 1) {
      // Tapered tail: smaller centered block so the tail reads as an endpoint
      const tSize = cellSize * 0.55;
      const tOff = (cellSize - tSize) / 2;
      ctx.fillStyle = bodyColor;
      ctx.fillRect(px + tOff, py + tOff, tSize, tSize);
      ctx.fillStyle = accentColor;
      const inner = tSize * 0.45;
      const innerOff = (cellSize - inner) / 2;
      ctx.fillRect(px + innerOff, py + innerOff, inner, inner);
    } else {
      ctx.fillStyle = bodyColor;
      ctx.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);

      // Subtle scale pattern / inner block
      ctx.fillStyle = accentColor;
      ctx.fillRect(px + 6, py + 6, cellSize - 12, cellSize - 12);
    }

    // Connection seam / bridge
    if (prevSeg) {
      if (seg.x !== prevSeg.x) {
        const minX = Math.min(seg.x, prevSeg.x);
        ctx.fillRect((minX + 1) * cellSize - 2, py + 6, 4, cellSize - 12);
      } else if (seg.y !== prevSeg.y) {
        const minY = Math.min(seg.y, prevSeg.y);
        ctx.fillRect(px + 6, (minY + 1) * cellSize - 2, cellSize - 12, 4);
      }
    }
  }

  // Render Head (with fatal move lunge offset if playing back the fatal move)
  const head = snake.body[0];
  const lungeOffset = lungeFatalMove ? Math.round(cellSize * 0.42) : 0;
  const lungeDx = snake.direction === 'LEFT' ? -lungeOffset : snake.direction === 'RIGHT' ? lungeOffset : 0;
  const lungeDy = snake.direction === 'UP' ? -lungeOffset : snake.direction === 'DOWN' ? lungeOffset : 0;
  const hx = head.x * cellSize + lungeDx;
  const hy = head.y * cellSize + lungeDy;

  if (lungeFatalMove) {
    // Keep neck/head cell connected during the lunge into the fatal cell
    ctx.fillStyle = bodyColor;
    ctx.fillRect(head.x * cellSize + 4, head.y * cellSize + 4, cellSize - 8, cellSize - 8);
  }

  ctx.fillStyle = bodyColor;
  ctx.fillRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);

  // Directional eyes on the leading edge
  const eyeSize = Math.max(3, cellSize * 0.14);
  const edge = 3;
  const spread = cellSize * 0.28;
  const c = cellSize / 2;
  ctx.fillStyle = accentColor;
  if (snake.direction === 'UP') {
    ctx.fillRect(hx + c - spread / 2 - eyeSize / 2, hy + edge, eyeSize, eyeSize);
    ctx.fillRect(hx + c + spread / 2 - eyeSize / 2, hy + edge, eyeSize, eyeSize);
  } else if (snake.direction === 'DOWN') {
    ctx.fillRect(hx + c - spread / 2 - eyeSize / 2, hy + cellSize - edge - eyeSize, eyeSize, eyeSize);
    ctx.fillRect(hx + c + spread / 2 - eyeSize / 2, hy + cellSize - edge - eyeSize, eyeSize, eyeSize);
  } else if (snake.direction === 'LEFT') {
    ctx.fillRect(hx + edge, hy + c - spread / 2 - eyeSize / 2, eyeSize, eyeSize);
    ctx.fillRect(hx + edge, hy + c + spread / 2 - eyeSize / 2, eyeSize, eyeSize);
  } else {
    // RIGHT
    ctx.fillRect(hx + cellSize - edge - eyeSize, hy + c - spread / 2 - eyeSize / 2, eyeSize, eyeSize);
    ctx.fillRect(hx + cellSize - edge - eyeSize, hy + c + spread / 2 - eyeSize / 2, eyeSize, eyeSize);
  }
}

function renderDeathMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  direction: Direction = 'RIGHT',
) {
  ctx.save();
  ctx.strokeStyle = '#FF0000';
  ctx.fillStyle = '#FF0000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;
  const pad = 5;
  const tipOffset = cellSize / 2 - pad;
  const tailOffset = cellSize / 2 - pad - 1;
  const wingSpan = Math.round(cellSize * 0.28);
  const headLen = Math.round(cellSize * 0.28);

  ctx.lineWidth = 3;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  ctx.beginPath();
  if (direction === 'LEFT') {
    const tipX = cx - tipOffset;
    const endX = cx + tailOffset;
    ctx.moveTo(endX, cy);
    ctx.lineTo(tipX + 2, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(tipX + headLen, cy - wingSpan);
    ctx.lineTo(tipX + headLen, cy + wingSpan);
    ctx.closePath();
    ctx.fill();
  } else if (direction === 'RIGHT') {
    const tipX = cx + tipOffset;
    const endX = cx - tailOffset;
    ctx.moveTo(endX, cy);
    ctx.lineTo(tipX - 2, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(tipX - headLen, cy - wingSpan);
    ctx.lineTo(tipX - headLen, cy + wingSpan);
    ctx.closePath();
    ctx.fill();
  } else if (direction === 'UP') {
    const tipY = cy - tipOffset;
    const endY = cy + tailOffset;
    ctx.moveTo(cx, endY);
    ctx.lineTo(cx, tipY + 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - wingSpan, tipY + headLen);
    ctx.lineTo(cx + wingSpan, tipY + headLen);
    ctx.closePath();
    ctx.fill();
  } else {
    // DOWN
    const tipY = cy + tipOffset;
    const endY = cy - tailOffset;
    ctx.moveTo(cx, endY);
    ctx.lineTo(cx, tipY - 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - wingSpan, tipY - headLen);
    ctx.lineTo(cx + wingSpan, tipY - headLen);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderToken(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number, blink: boolean) {
  ctx.fillStyle = blink ? GAMEBOY_COLORS.DARKEST : GAMEBOY_COLORS.DARK;
  // Diamond shape token
  ctx.beginPath();
  ctx.moveTo(x + cellSize / 2, y + 4);
  ctx.lineTo(x + cellSize - 4, y + cellSize / 2);
  ctx.lineTo(x + cellSize / 2, y + cellSize - 4);
  ctx.lineTo(x + 4, y + cellSize / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = GAMEBOY_COLORS.LIGHTEST;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderShrunkWallCell(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  ctx.fillStyle = GAMEBOY_COLORS.DARKEST;
  ctx.fillRect(x, y, cellSize, cellSize);
  ctx.fillStyle = GAMEBOY_COLORS.DARK;
  ctx.fillRect(x + 4, y + 4, cellSize - 8, cellSize - 8);
  ctx.fillStyle = GAMEBOY_COLORS.LIGHTEST;
  ctx.fillRect(x + 12, y + 12, cellSize - 24, cellSize - 24);
}

function renderRattleWall(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  const tSize = cellSize * 0.55;
  const tOff = (cellSize - tSize) / 2;
  ctx.fillStyle = GAMEBOY_COLORS.DARKEST;
  ctx.fillRect(x + tOff, y + tOff, tSize, tSize);
}

function renderTelegraphCell(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  ctx.fillStyle = GAMEBOY_COLORS.DARK;
  ctx.fillRect(x, y, cellSize, cellSize);
  ctx.fillStyle = GAMEBOY_COLORS.LIGHTEST;
  ctx.fillRect(x + 6, y + 6, cellSize - 12, cellSize - 12);
}
