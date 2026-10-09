import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Position, Direction } from '../types/game';
import { CampaignLevel } from './levelSchema';
import {
  createCampaignPlaytestState,
  createSpawnBody,
  getCampaignPlaytestLevel,
  setCampaignPlaytestLevel,
} from './playtestSession';

type Tool = 'WALL' | 'TOKEN' | 'ERASER' | `SPAWN_${number}` | `PAINT_${number}`;

const NEXT_DIRECTION: Record<Direction, Direction> = {
  UP: 'RIGHT',
  RIGHT: 'DOWN',
  DOWN: 'LEFT',
  LEFT: 'UP',
};

const DIRECTION_ARROWS: Record<Direction, string> = {
  UP: '▲',
  RIGHT: '▶',
  DOWN: '▼',
  LEFT: '◀',
};

const getPaintedDirection = (body: Position[]): Direction | undefined => {
  if (body.length < 2) return undefined;
  const head = body[0];
  const neck = body[1];
  if (neck.x < head.x) return 'RIGHT';
  if (neck.x > head.x) return 'LEFT';
  if (neck.y < head.y) return 'DOWN';
  return 'UP';
};

const DEFAULT_LEVEL: CampaignLevel = {
  id: 'custom-stage-01',
  name: 'UNTITLED STAGE',
  description: 'SURVIVE AND OUTSLITHER THE OPPONENT IN THE ARENA.',
  gridSize: 8,
  walls: [],
  spawns: [
    { position: { x: 1, y: 1 }, direction: 'RIGHT', startLength: 3, startingScore: 0, aiStyle: 'GREEDY' },
    { position: { x: 6, y: 6 }, direction: 'LEFT', startLength: 3, startingScore: 0, aiStyle: 'GREEDY' },
    { position: { x: 1, y: 6 }, direction: 'UP', startLength: 3, startingScore: 0, aiStyle: 'TURTLE' },
  ],
  tokens: {
    positions: [],
    count: 2,
    respawn: true,
    mode: 'ESCALATING',
  },
  phases: {
    raceTurns: 40,
    shrinkEveryTurns: 6,
  },
  objectives: {
    primary: 'COLLECT:5',
    bonus: ['FIRST_TO:10', 'SHUTOUT'],
  },
};

export const LevelEditor: React.FC = () => {
  const [level, setLevel] = useState<CampaignLevel>(() => getCampaignPlaytestLevel() ?? { ...DEFAULT_LEVEL });
  const levelRef = useRef(level);
  levelRef.current = level;
  const [activeTool, setActiveTool] = useState<Tool>('WALL');
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [bonusText, setBonusText] = useState<string>(() => level.objectives.bonus.join('\n'));
  const [statusMessage, setStatusMessage] = useState<string>('READY');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateSpawn = (index: number, changes: Partial<CampaignLevel['spawns'][number]>) => {
    setLevel(prev => ({
      ...prev,
      spawns: prev.spawns.map((spawn, spawnIndex) =>
        spawnIndex === index ? { ...spawn, ...changes } : spawn,
      ),
    }));
  };

  // Sync bonus objectives text to level
  const handleBonusTextChange = (text: string) => {
    setBonusText(text);
    const parsed = text
      .split('\n')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    setLevel((prev) => ({
      ...prev,
      objectives: {
        ...prev.objectives,
        bonus: parsed,
      },
    }));
  };

  // Stop mouse painting on global mouseup
  useEffect(() => {
    const handleMouseUp = () => setIsMouseDown(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage('READY');
    }, 3000);
  };

  // Handle cell click / drag paint
  const handleCellInteract = useCallback(
    (x: number, y: number, isInitialClick: boolean) => {
      if (activeTool === 'WALL' || activeTool === 'TOKEN') {
        const snakeOccupiesCell = levelRef.current.spawns.some(spawn =>
          (spawn.body ?? [spawn.position]).some(segment => segment.x === x && segment.y === y),
        );
        if (snakeOccupiesCell) {
          showStatus(`REMOVE THE SNAKE BEFORE PLACING A ${activeTool === 'WALL' ? 'WALL' : 'TOKEN'} HERE`);
          return;
        }
      }

      if (activeTool.startsWith('PAINT_')) {
        const prev = levelRef.current;
        const spawnIndex = Number(activeTool.slice('PAINT_'.length));
        const spawn = prev.spawns[spawnIndex];
        if (!spawn) return;
        const position = { x, y };
        const body = spawn.body ?? [];
        const wallCells = new Set(prev.walls.map(wall => `${wall.x},${wall.y}`));
        const occupiedByOtherSnake = prev.spawns.some((otherSpawn, index) => {
          if (index === spawnIndex) return false;
          try {
            const occupied = new Set<string>();
            const preceding = prev.spawns.slice(0, index);
            let otherBody: Position[] = [];
            for (const earlier of preceding) {
              otherBody = earlier.body
                ? earlier.body.map(segment => ({ ...segment }))
                : createSpawnBody(earlier, prev.gridSize, wallCells, occupied);
              otherBody.forEach(segment => occupied.add(`${segment.x},${segment.y}`));
            }
            otherBody = otherSpawn.body
              ? otherSpawn.body.map(segment => ({ ...segment }))
              : createSpawnBody(otherSpawn, prev.gridSize, wallCells, occupied);
            return otherBody.some(segment => segment.x === x && segment.y === y);
          } catch {
            return otherSpawn.position.x === x && otherSpawn.position.y === y;
          }
        });
        const rejection = prev.walls.some(wall => wall.x === x && wall.y === y)
          ? 'SNAKE BODY CANNOT OVERLAP A WALL'
          : prev.tokens.positions.some(token => token.x === x && token.y === y)
            ? 'SNAKE BODY CANNOT OVERLAP A TOKEN'
            : occupiedByOtherSnake
              ? 'SNAKE BODY CANNOT OVERLAP THE OTHER SNAKE'
              : body.some(segment => segment.x === x && segment.y === y)
                ? 'SNAKE BODY CANNOT OVERLAP ITSELF'
                : body.length > 0 &&
                  Math.abs(body[body.length - 1].x - x) + Math.abs(body[body.length - 1].y - y) !== 1
                  ? 'BODY SEGMENTS MUST BE CONTIGUOUS'
                  : null;

        if (x < 0 || x >= prev.gridSize || y < 0 || y >= prev.gridSize) {
          showStatus('SNAKE BODY MUST STAY INSIDE THE BOARD');
          return;
        }
        if (rejection) {
          showStatus(rejection);
          return;
        }
        if (!isInitialClick && !isMouseDown) return;

        const nextBody = [...body, position];
        const direction = getPaintedDirection(nextBody);
        const next = {
          ...prev,
          spawns: prev.spawns.map((currentSpawn, index) => index === spawnIndex
            ? {
                ...currentSpawn,
                position: body.length === 0 ? position : currentSpawn.position,
                startLength: nextBody.length,
                body: nextBody,
                ...(direction ? { direction } : {}),
              }
            : currentSpawn),
        };
        levelRef.current = next;
        setLevel(next);
        return;
      }

      setLevel((prev) => {
        const isWall = prev.walls.some((w) => w.x === x && w.y === y);
        const isToken = prev.tokens.positions.some((t) => t.x === x && t.y === y);
        const spawnIndex = activeTool.startsWith('SPAWN_') ? Number(activeTool.slice('SPAWN_'.length)) : -1;
        const clickedSpawnIndex = prev.spawns.findIndex(spawn =>
          spawn.position.x === x && spawn.position.y === y,
        );

        if (activeTool === 'WALL') {
          if (isWall) return prev;
          return {
            ...prev,
            walls: [...prev.walls, { x, y }],
            tokens: {
              ...prev.tokens,
              positions: prev.tokens.positions.filter((t) => !(t.x === x && t.y === y)),
            },
          };
        }

        if (activeTool === 'TOKEN') {
          if (isToken) return prev;
          return {
            ...prev,
            walls: prev.walls.filter((w) => !(w.x === x && w.y === y)),
            tokens: {
              ...prev.tokens,
              positions: [...prev.tokens.positions, { x, y }],
            },
          };
        }

        if (activeTool === 'ERASER') {
          return {
            ...prev,
            walls: prev.walls.filter((w) => !(w.x === x && w.y === y)),
            tokens: {
              ...prev.tokens,
              positions: prev.tokens.positions.filter((t) => !(t.x === x && t.y === y)),
            },
            spawns: prev.spawns.map(spawn =>
              spawn.body?.some(segment => segment.x === x && segment.y === y)
                ? { ...spawn, body: undefined, startLength: 3 }
                : spawn,
            ),
          };
        }

        if (spawnIndex >= 0) {
          if (!isInitialClick) return prev;
          const spawn = prev.spawns[spawnIndex];
          if (!spawn) return prev;
          if (clickedSpawnIndex === spawnIndex) {
            if (spawn.body) return prev;
            return {
              ...prev,
              spawns: prev.spawns.map((currentSpawn, index) => index === spawnIndex
                ? { ...currentSpawn, direction: NEXT_DIRECTION[currentSpawn.direction] }
                : currentSpawn),
            };
          }
          return {
            ...prev,
            walls: prev.walls.filter((w) => !(w.x === x && w.y === y)),
            tokens: {
              ...prev.tokens,
              positions: prev.tokens.positions.filter((t) => !(t.x === x && t.y === y)),
            },
            spawns: prev.spawns.map((currentSpawn, index) => index === spawnIndex
              ? { ...currentSpawn, position: { x, y }, body: undefined }
              : currentSpawn),
          };
        }

        return prev;
      });
    },
    [activeTool, isMouseDown]
  );

  // Grid size change with confirm
  const handleGridSizeChange = (newSize: number) => {
    if (newSize === level.gridSize) return;
    const confirmed = window.confirm(
      `CHANGING GRID SIZE TO ${newSize}X${newSize} WILL CLEAR ALL WALLS, FIXED TOKENS, AND PAINTED SNAKES. PROCEED?`
    );
    if (!confirmed) return;

    setLevel((prev) => ({
      ...prev,
      gridSize: newSize,
      walls: [],
      tokens: {
        ...prev.tokens,
        positions: [],
      },
      spawns: prev.spawns.map((spawn, index) => ({
        ...spawn,
        position: index === 0
          ? { x: 1, y: 1 }
          : { x: newSize - 2, y: newSize - 2 },
        body: undefined,
      })),
    }));
    showStatus(`GRID CHANGED TO ${newSize}X${newSize}`);
  };

  // Export JSON
  const handleExportJson = () => {
    try {
      const jsonStr = JSON.stringify(level, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `${level.id || 'campaign-level'}.json`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showStatus(`EXPORTED ${filename}`);
    } catch (err) {
      alert(`FAILED TO EXPORT: ${err}`);
    }
  };

  // Import JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as CampaignLevel;
        // Basic schema verification
        if (
          !parsed.id ||
          !parsed.name ||
          typeof parsed.gridSize !== 'number' ||
          !Array.isArray(parsed.walls) ||
          !Array.isArray(parsed.spawns) ||
          parsed.spawns.length < 2 ||
          !parsed.tokens ||
          !parsed.phases ||
          !parsed.objectives
        ) {
          throw new Error('INVALID LEVEL SCHEMA: MISSING REQUIRED FIELDS');
        }

        const nextLevel = {
          ...parsed,
          spawns: parsed.spawns.map(spawn => ({
            ...spawn,
            startingScore: spawn.startingScore ?? 0,
            aiStyle: spawn.aiStyle ?? 'GREEDY',
          })),
          tokens: { ...parsed.tokens, mode: parsed.tokens.mode ?? 'ESCALATING' },
        };
        levelRef.current = nextLevel;
        setLevel(nextLevel);
        setBonusText((parsed.objectives.bonus || []).join('\n'));
        showStatus(`LOADED ${file.name}`);
      } catch (err: any) {
        alert(`ERROR LOADING FILE: ${err.message || err}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Clear everything
  const handleClear = () => {
    const confirmed = window.confirm('CLEAR ALL LEVEL DATA AND RESET TO DEFAULT?');
    if (!confirmed) return;
    setLevel({ ...DEFAULT_LEVEL });
    setBonusText(DEFAULT_LEVEL.objectives.bonus.join('\n'));
    showStatus('RESET TO DEFAULTS');
  };

  const handlePlaytest = () => {
    try {
      createCampaignPlaytestState(level);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'INVALID LEVEL FOR PLAYTEST');
      return;
    }
    setCampaignPlaytestLevel(level);
    window.location.hash = '#/level-editor/playtest';
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#7b8860] text-[#0F380F] font-mono select-none overflow-hidden uppercase">
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#9BBC0F] border-b-4 border-[#0F380F] shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-black text-lg tracking-wider">
            SNAKE ROYALE // CAMPAIGN LEVEL EDITOR
          </span>
          <span className="px-2 py-0.5 text-xs bg-[#0F380F] text-[#9BBC0F] font-bold">
            DEV TOOL
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-bold">
          <span className="text-[#306230]">ROUTE: #/level-editor</span>
          <span className="bg-[#8BAC0F] px-2 py-1 border-2 border-[#0F380F]">
            STATUS: {statusMessage}
          </span>
          <a
            href="#/"
            className="px-2 py-1 bg-[#306230] text-[#9BBC0F] hover:bg-[#0F380F] border-2 border-[#0F380F]"
          >
            EXIT TO GAME
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 divide-x-4 divide-[#0F380F]">
        {/* Left Column: Palette & Canvas */}
        <div className="w-1/2 flex flex-col p-4 bg-[#9BBC0F] min-h-0 overflow-y-auto items-center justify-between">
          {/* Tool Palette Bar */}
          <div className="w-full max-w-[500px] mb-3">
            <div className="text-xs font-black mb-1">TOOL PALETTE:</div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setActiveTool('WALL')}
                className={`py-2 px-1 text-xs font-black border-4 border-[#0F380F] transition-colors ${
                  activeTool === 'WALL'
                    ? 'bg-[#0F380F] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                ■ WALL
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('TOKEN')}
                className={`py-2 px-1 text-xs font-black border-4 border-[#0F380F] transition-colors ${
                  activeTool === 'TOKEN'
                    ? 'bg-[#0F380F] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                ◆ TOKEN
              </button>
              {level.spawns.slice(0, 3).map((spawn, index) => (
                <React.Fragment key={index}>
                  <button
                    type="button"
                    onClick={() => setActiveTool(`SPAWN_${index}`)}
                    className={`py-2 px-1 text-[10px] font-black border-4 border-[#0F380F] transition-colors ${
                      activeTool === `SPAWN_${index}`
                        ? index === 2 ? 'bg-[#8B1E0F] text-white' : 'bg-[#306230] text-[#9BBC0F]'
                        : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                    }`}
                  >
                    P{index + 1} SPAWN
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool(`PAINT_${index}`)}
                    className={`py-2 px-1 text-[10px] font-black border-4 border-[#0F380F] transition-colors ${
                      activeTool === `PAINT_${index}`
                        ? index === 2 ? 'bg-[#8B1E0F] text-white' : 'bg-[#306230] text-[#9BBC0F]'
                        : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                    }`}
                  >
                    P{index + 1} PAINT
                  </button>
                </React.Fragment>
              ))}
              <button
                type="button"
                onClick={() => setActiveTool('ERASER')}
                className={`py-2 px-1 text-xs font-black border-4 border-[#0F380F] transition-colors ${
                  activeTool === 'ERASER'
                    ? 'bg-[#0F380F] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                ✕ ERASE
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {level.spawns.slice(0, 3).map((spawn, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => updateSpawn(index, { body: undefined, startLength: 3 })}
                  className="flex-1 py-1 border-2 border-[#0F380F] bg-[#8BAC0F] text-[9px] font-black"
                >
                  CLEAR P{index + 1} BODY
                </button>
              ))}
            </div>
            <div className="text-[10px] text-[#306230] mt-1 tracking-tight">
              * SPAWN USES DIRECTION/LENGTH. PAINT: CLICK HEAD, THEN DRAG CONTIGUOUS CELLS.
            </div>
          </div>

          {/* Grid Canvas */}
          <div className="flex-1 flex items-center justify-center w-full min-h-0">
            <div
              className="border-4 border-[#0F380F] bg-[#8BAC0F] p-1.5 shadow-[inset_0_0_8px_rgba(15,56,15,0.4)]"
              onMouseDown={() => setIsMouseDown(true)}
            >
              <div
                className="grid gap-[2px] bg-[#0F380F]"
                style={{
                  gridTemplateColumns: `repeat(${level.gridSize}, minmax(0, 1fr))`,
                  width: `${Math.min(460, level.gridSize * 48)}px`,
                  height: `${Math.min(460, level.gridSize * 48)}px`,
                }}
              >
                {Array.from({ length: level.gridSize }).map((_, y) =>
                  Array.from({ length: level.gridSize }).map((__, x) => {
                    const isWall = level.walls.some((w) => w.x === x && w.y === y);
                    const isToken = level.tokens.positions.some((t) => t.x === x && t.y === y);
                    const spawnIndex = level.spawns.findIndex(spawn =>
                      (spawn.body ?? [spawn.position]).some(segment => segment.x === x && segment.y === y),
                    );
                    const snakeSegmentIndex = spawnIndex < 0
                      ? -1
                      : level.spawns[spawnIndex].body?.findIndex(segment => segment.x === x && segment.y === y) ?? 0;

                    let cellBg = 'bg-[#9BBC0F]';
                    let cellContent = null;

                    if (isWall) {
                      cellBg = 'bg-[#0F380F]';
                    } else if (spawnIndex >= 0) {
                      const spawn = level.spawns[spawnIndex];
                      const p1 = spawnIndex === 0;
                      const p3 = spawnIndex === 2;
                      cellBg = p1 ? 'bg-[#306230]' : p3 ? 'bg-[#8B1E0F]' : 'bg-[#0F380F]';
                      cellContent = (
                        <div className="text-[#9BBC0F] font-black text-xs leading-none flex flex-col items-center justify-center">
                          <span>{snakeSegmentIndex === 0 ? `P${spawnIndex + 1}` : snakeSegmentIndex}</span>
                          {snakeSegmentIndex === 0 && (
                            <span className="text-[10px]">{DIRECTION_ARROWS[spawn.direction]}</span>
                          )}
                        </div>
                      );
                    } else if (isToken) {
                      cellContent = (
                        <div className="w-3.5 h-3.5 rotate-45 bg-[#0F380F] border border-[#9BBC0F]" />
                      );
                    }

                    return (
                      <div
                        key={`${x}-${y}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleCellInteract(x, y, true);
                        }}
                        onMouseEnter={() => {
                          if (isMouseDown && !activeTool.startsWith('SPAWN_')) {
                            handleCellInteract(x, y, false);
                          }
                        }}
                        className={`w-full h-full flex items-center justify-center cursor-pointer transition-colors select-none ${cellBg}`}
                        title={`(${x}, ${y})`}
                      >
                        {cellContent}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Grid Stats Footer */}
          <div className="text-xs font-bold text-[#306230] mt-2 flex gap-4">
            <span>GRID: {level.gridSize}X{level.gridSize}</span>
            <span>WALLS: {level.walls.length}</span>
            <span>FIXED TOKENS: {level.tokens.positions.length}</span>
          </div>
        </div>

        {/* Right Column: Properties Panel */}
        <div className="w-1/2 flex flex-col p-4 bg-[#8BAC0F] overflow-y-auto">
          <div className="text-sm font-black mb-3 border-b-2 border-[#0F380F] pb-1">
            LEVEL PROPERTIES
          </div>

          <div className="space-y-3 text-xs">
            {/* Level ID, Name, Description */}
            <div>
              <label className="block font-black mb-1">LEVEL ID (SLUG):</label>
              <input
                type="text"
                value={level.id}
                onChange={(e) => setLevel({ ...level, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                placeholder="e.g. maze-snake-01"
              />
            </div>

            <div>
              <label className="block font-black mb-1">NAME:</label>
              <input
                type="text"
                value={level.name}
                onChange={(e) => setLevel({ ...level, name: e.target.value.toUpperCase() })}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                placeholder="e.g. THE MAZE"
              />
            </div>

            <div>
              <label className="block font-black mb-1">DESCRIPTION (ONE-LINE BRIEFING):</label>
              <input
                type="text"
                value={level.description}
                onChange={(e) => setLevel({ ...level, description: e.target.value.toUpperCase() })}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                placeholder="e.g. SURVIVE 30 TURNS INSIDE THE LABYRINTH."
              />
            </div>

            {/* Grid Size */}
            <div>
              <label className="block font-black mb-1">GRID SIZE:</label>
              <select
                value={level.gridSize}
                onChange={(e) => handleGridSizeChange(Number(e.target.value))}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none cursor-pointer"
              >
                {Array.from({ length: 13 }, (_, index) => index + 4).map(size => (
                  <option key={size} value={size}>{size}X{size}</option>
                ))}
              </select>
            </div>

            {/* Spawn configuration */}
            <div className="space-y-2 pt-1 border-t-2 border-[#0F380F]">
              {level.spawns.slice(0, 3).map((spawn, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 border border-[#0F380F] p-2">
                  <div className="col-span-2 font-black">P{index + 1} {index === 0 ? 'HUMAN' : 'AI'} SPAWN</div>
                  <label className="flex flex-col gap-1 font-bold">
                    LENGTH
                    <input type="number" min="1" max="50" value={spawn.startLength}
                      onChange={e => updateSpawn(index, { startLength: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold outline-none" />
                  </label>
                  <label className="flex flex-col gap-1 font-bold">
                    START SCORE
                    <input type="number" min="0" value={spawn.startingScore}
                      onChange={e => updateSpawn(index, { startingScore: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold outline-none" />
                  </label>
                  <label className="flex flex-col gap-1 font-bold">
                    DIRECTION
                    <select value={spawn.direction} onChange={e => updateSpawn(index, { direction: e.target.value as Direction })}
                      className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold outline-none">
                      {(['UP', 'RIGHT', 'DOWN', 'LEFT'] as const).map(direction => <option key={direction} value={direction}>{direction}</option>)}
                    </select>
                  </label>
                  {index > 0 && (
                    <label className="flex flex-col gap-1 font-bold">
                      AI STYLE
                      <select value={spawn.aiStyle} onChange={e => updateSpawn(index, { aiStyle: e.target.value as CampaignLevel['spawns'][number]['aiStyle'] })}
                        className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold outline-none">
                        <option value="GREEDY">GREEDY</option>
                        <option value="TURTLE">TURTLE</option>
                        <option value="CUTOFF">CUTOFF</option>
                        <option value="HEADHUNTER">HEADHUNTER</option>
                        <option value="PATROL">PATROL</option>
                      </select>
                    </label>
                  )}
                  <div className="col-span-2 text-[9px] font-bold opacity-80">
                    CELL {spawn.position.x},{spawn.position.y} · {spawn.body ? `${spawn.body.length} PAINTED CELLS` : 'AUTO BODY'}
                  </div>
                </div>
              ))}
            </div>

            {/* Tokens */}
            <div>
              <label className="block font-black mb-1">TOKEN MODE:</label>
              <select
                value={level.tokens.mode}
                onChange={(e) => {
                  const mode = e.target.value as CampaignLevel['tokens']['mode'];
                  setLevel({
                    ...level,
                    tokens: {
                      ...level.tokens,
                      mode,
                      respawn: mode === 'FIXED_SET' ? false : level.tokens.respawn,
                    },
                  });
                }}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none cursor-pointer"
              >
                <option value="ESCALATING">ESCALATING</option>
                <option value="FIXED">FIXED</option>
                <option value="FIXED_SET">FIXED SET</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t-2 border-[#0F380F]">
              <div>
                <label className="block font-black mb-1">TOKEN COUNT:</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={level.tokens.count}
                  onChange={(e) =>
                    setLevel({
                      ...level,
                      tokens: {
                        ...level.tokens,
                        count: Math.max(1, parseInt(e.target.value) || 1),
                      },
                    })
                  }
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                />
              </div>

              <div>
                <label className="block font-black mb-1">TOKEN RESPAWN:</label>
                <button
                  type="button"
                  disabled={level.tokens.mode === 'FIXED_SET'}
                  onClick={() =>
                    setLevel({
                      ...level,
                      tokens: {
                        ...level.tokens,
                        respawn: !level.tokens.respawn,
                      },
                    })
                  }
                  className={`w-full py-1 font-black border-2 border-[#0F380F] disabled:opacity-50 disabled:cursor-not-allowed ${
                    level.tokens.respawn
                      ? 'bg-[#0F380F] text-[#9BBC0F]'
                      : 'bg-[#9BBC0F] text-[#0F380F]'
                  }`}
                >
                  {level.tokens.respawn ? 'ENABLED [ON]' : 'DISABLED [OFF]'}
                </button>
              </div>
            </div>

            {/* Phases */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t-2 border-[#0F380F]">
              <div>
                <label className="block font-black mb-1">RACE TURNS (PHASE 1):</label>
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={level.phases.raceTurns}
                  onChange={(e) =>
                    setLevel({
                      ...level,
                      phases: {
                        ...level.phases,
                        raceTurns: Math.max(0, parseInt(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                />
              </div>

              <div>
                <label className="block font-black mb-1">SHRINK EVERY N TURNS:</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={level.phases.shrinkEveryTurns}
                  onChange={(e) =>
                    setLevel({
                      ...level,
                      phases: {
                        ...level.phases,
                        shrinkEveryTurns: Math.max(1, parseInt(e.target.value) || 1),
                      },
                    })
                  }
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                />
              </div>
            </div>

            {/* Objectives */}
            <div className="pt-1 border-t-2 border-[#0F380F]">
              <label className="block font-black mb-1">PRIMARY OBJECTIVE (E.G. COLLECT:5):</label>
              <input
                type="text"
                value={level.objectives.primary}
                onChange={(e) =>
                  setLevel({
                    ...level,
                    objectives: {
                      ...level.objectives,
                      primary: e.target.value.toUpperCase(),
                    },
                  })
                }
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                placeholder="e.g. collect:5, first_to:10, survive:30"
              />
            </div>

            <div>
              <label className="block font-black mb-1">BONUS OBJECTIVES (ONE PER LINE):</label>
              <textarea
                rows={3}
                value={bonusText}
                onChange={(e) => handleBonusTextChange(e.target.value)}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] p-2 font-mono font-bold text-[#0F380F] outline-none resize-none"
                placeholder="collect:5&#10;shutout"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar: Action Buttons */}
      <footer className="flex items-center justify-between px-4 py-2.5 bg-[#9BBC0F] border-t-4 border-[#0F380F] shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePlaytest}
            className="px-4 py-1.5 bg-[#0F380F] text-[#9BBC0F] font-black text-xs hover:bg-[#306230] border-2 border-[#0F380F] active:translate-y-0.5"
          >
            ▶ PLAYTEST
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="px-4 py-1.5 bg-[#0F380F] text-[#9BBC0F] font-black text-xs hover:bg-[#306230] border-2 border-[#0F380F] active:translate-y-0.5"
          >
            ▼ EXPORT JSON
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-1.5 bg-[#8BAC0F] text-[#0F380F] font-black text-xs hover:bg-[#9BBC0F] border-2 border-[#0F380F] active:translate-y-0.5"
          >
            ▲ IMPORT JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            className="hidden"
          />

          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-1.5 bg-[#8BAC0F] text-[#0F380F] font-black text-xs hover:bg-[#8B1E0F] hover:text-white border-2 border-[#0F380F] active:translate-y-0.5"
          >
            ✕ CLEAR
          </button>
        </div>

        <div className="text-[11px] font-bold text-[#306230]">
          DOWNLOADS AS <span className="text-[#0F380F] font-black">{level.id || 'level'}.json</span>
        </div>
      </footer>
    </div>
  );
};
