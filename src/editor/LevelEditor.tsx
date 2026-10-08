import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Position, Direction } from '../types/game';
import { CampaignLevel } from './levelSchema';
import {
  createCampaignPlaytestState,
  getCampaignPlaytestLevel,
  setCampaignPlaytestLevel,
} from './playtestSession';

type Tool = 'WALL' | 'TOKEN' | 'P1_SPAWN' | 'P2_SPAWN' | 'ERASER';

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

const DEFAULT_LEVEL: CampaignLevel = {
  id: 'custom-stage-01',
  name: 'UNTITLED STAGE',
  description: 'SURVIVE AND OUTSLITHER THE OPPONENT IN THE ARENA.',
  gridSize: 8,
  walls: [],
  playerSpawn: {
    position: { x: 1, y: 1 },
    direction: 'RIGHT',
    startLength: 3,
  },
  opponentSpawn: {
    position: { x: 6, y: 6 },
    direction: 'LEFT',
    startLength: 3,
    aiStyle: 'GREEDY',
  },
  tokens: {
    positions: [],
    count: 2,
    respawn: true,
  },
  phases: {
    raceTurns: 40,
    shrinkEveryTurns: 6,
  },
  objectives: {
    primary: 'ELIMINATE OPPONENT SNAKE',
    bonus: ['COLLECT AT LEAST 5 TOKENS', 'WIN WITHIN 30 TURNS'],
  },
};

export const LevelEditor: React.FC = () => {
  const [level, setLevel] = useState<CampaignLevel>(() => getCampaignPlaytestLevel() ?? { ...DEFAULT_LEVEL });
  const [activeTool, setActiveTool] = useState<Tool>('WALL');
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [bonusText, setBonusText] = useState<string>(() => level.objectives.bonus.join('\n'));
  const [statusMessage, setStatusMessage] = useState<string>('READY');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setLevel((prev) => {
        const isWall = prev.walls.some((w) => w.x === x && w.y === y);
        const isToken = prev.tokens.positions.some((t) => t.x === x && t.y === y);
        const isP1 = prev.playerSpawn.position.x === x && prev.playerSpawn.position.y === y;
        const isP2 = prev.opponentSpawn.position.x === x && prev.opponentSpawn.position.y === y;

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
          };
        }

        if (activeTool === 'P1_SPAWN') {
          if (!isInitialClick) return prev;
          if (isP1) {
            // Cycle direction
            const nextDir = NEXT_DIRECTION[prev.playerSpawn.direction];
            return {
              ...prev,
              playerSpawn: {
                ...prev.playerSpawn,
                direction: nextDir,
              },
            };
          }
          // Move P1 spawn here
          return {
            ...prev,
            walls: prev.walls.filter((w) => !(w.x === x && w.y === y)),
            tokens: {
              ...prev.tokens,
              positions: prev.tokens.positions.filter((t) => !(t.x === x && t.y === y)),
            },
            playerSpawn: {
              ...prev.playerSpawn,
              position: { x, y },
            },
          };
        }

        if (activeTool === 'P2_SPAWN') {
          if (!isInitialClick) return prev;
          if (isP2) {
            // Cycle direction
            const nextDir = NEXT_DIRECTION[prev.opponentSpawn.direction];
            return {
              ...prev,
              opponentSpawn: {
                ...prev.opponentSpawn,
                direction: nextDir,
              },
            };
          }
          // Move P2 spawn here
          return {
            ...prev,
            walls: prev.walls.filter((w) => !(w.x === x && w.y === y)),
            tokens: {
              ...prev.tokens,
              positions: prev.tokens.positions.filter((t) => !(t.x === x && t.y === y)),
            },
            opponentSpawn: {
              ...prev.opponentSpawn,
              position: { x, y },
            },
          };
        }

        return prev;
      });
    },
    [activeTool]
  );

  // Grid size change with confirm
  const handleGridSizeChange = (newSize: number) => {
    if (newSize === level.gridSize) return;
    const confirmed = window.confirm(
      `CHANGING GRID SIZE TO ${newSize}X${newSize} WILL CLEAR ALL WALLS AND FIXED TOKENS. PROCEED?`
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
      playerSpawn: {
        ...prev.playerSpawn,
        position: { x: 1, y: 1 },
      },
      opponentSpawn: {
        ...prev.opponentSpawn,
        position: { x: newSize - 2, y: newSize - 2 },
      },
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
          !parsed.playerSpawn ||
          !parsed.opponentSpawn ||
          !parsed.tokens ||
          !parsed.phases ||
          !parsed.objectives
        ) {
          throw new Error('INVALID LEVEL SCHEMA: MISSING REQUIRED FIELDS');
        }

        setLevel(parsed);
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
            <div className="grid grid-cols-5 gap-2">
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
              <button
                type="button"
                onClick={() => setActiveTool('P1_SPAWN')}
                className={`py-2 px-1 text-xs font-black border-4 border-[#0F380F] transition-colors ${
                  activeTool === 'P1_SPAWN'
                    ? 'bg-[#306230] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                P1 SPAWN
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('P2_SPAWN')}
                className={`py-2 px-1 text-xs font-black border-4 border-[#0F380F] transition-colors ${
                  activeTool === 'P2_SPAWN'
                    ? 'bg-[#8B1E0F] text-white'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                P2 SPAWN
              </button>
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
            <div className="text-[10px] text-[#306230] mt-1 tracking-tight">
              * CLICK OR DRAG TO PAINT. CLICKING P1/P2 SPAWN CELL CYCLES DIRECTION.
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
                    const isP1 =
                      level.playerSpawn.position.x === x && level.playerSpawn.position.y === y;
                    const isP2 =
                      level.opponentSpawn.position.x === x && level.opponentSpawn.position.y === y;

                    let cellBg = 'bg-[#9BBC0F]';
                    let cellContent = null;

                    if (isWall) {
                      cellBg = 'bg-[#0F380F]';
                    } else if (isP1) {
                      cellBg = 'bg-[#306230]';
                      cellContent = (
                        <div className="text-[#9BBC0F] font-black text-xs leading-none flex flex-col items-center justify-center">
                          <span>P1</span>
                          <span className="text-[10px]">
                            {DIRECTION_ARROWS[level.playerSpawn.direction]}
                          </span>
                        </div>
                      );
                    } else if (isP2) {
                      cellBg = 'bg-[#8B1E0F]';
                      cellContent = (
                        <div className="text-white font-black text-xs leading-none flex flex-col items-center justify-center">
                          <span>P2</span>
                          <span className="text-[10px]">
                            {DIRECTION_ARROWS[level.opponentSpawn.direction]}
                          </span>
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
                          if (isMouseDown && activeTool !== 'P1_SPAWN' && activeTool !== 'P2_SPAWN') {
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
              <div className="flex gap-2">
                {[8, 12, 16].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => handleGridSizeChange(size)}
                    className={`flex-1 py-1 font-black border-2 border-[#0F380F] ${
                      level.gridSize === size
                        ? 'bg-[#0F380F] text-[#9BBC0F]'
                        : 'bg-[#9BBC0F] text-[#0F380F] hover:bg-[#7b8860]'
                    }`}
                  >
                    {size}X{size}
                  </button>
                ))}
              </div>
            </div>

            {/* Spawns & Start Lengths */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t-2 border-[#0F380F]">
              <div>
                <label className="block font-black mb-1">P1 START LENGTH:</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={level.playerSpawn.startLength}
                  onChange={(e) =>
                    setLevel({
                      ...level,
                      playerSpawn: {
                        ...level.playerSpawn,
                        startLength: Math.max(1, parseInt(e.target.value) || 1),
                      },
                    })
                  }
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                />
              </div>

              <div>
                <label className="block font-black mb-1">P2 START LENGTH:</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={level.opponentSpawn.startLength}
                  onChange={(e) =>
                    setLevel({
                      ...level,
                      opponentSpawn: {
                        ...level.opponentSpawn,
                        startLength: Math.max(1, parseInt(e.target.value) || 1),
                      },
                    })
                  }
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none"
                />
              </div>
            </div>

            {/* AI Style */}
            <div>
              <label className="block font-black mb-1">OPPONENT AI STYLE:</label>
              <select
                value={level.opponentSpawn.aiStyle}
                onChange={(e) =>
                  setLevel({
                    ...level,
                    opponentSpawn: {
                      ...level.opponentSpawn,
                      aiStyle: e.target.value as any,
                    },
                  })
                }
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-mono font-bold text-[#0F380F] outline-none cursor-pointer"
              >
                <option value="GREEDY">GREEDY (AGGRESSIVE TOKEN HUNTER)</option>
                <option value="TURTLE">TURTLE (DEFENSIVE SURVIVOR)</option>
                <option value="CUTOFF">CUTOFF (TRAPS & INTERCEPTS)</option>
                <option value="HEADHUNTER">HEADHUNTER (PURSUES ENEMY HEAD)</option>
                <option value="PATROL">PATROL (PERIMETER & CORRIDORS)</option>
              </select>
            </div>

            {/* Tokens */}
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
                  onClick={() =>
                    setLevel({
                      ...level,
                      tokens: {
                        ...level.tokens,
                        respawn: !level.tokens.respawn,
                      },
                    })
                  }
                  className={`w-full py-1 font-black border-2 border-[#0F380F] ${
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
              <label className="block font-black mb-1">PRIMARY OBJECTIVE:</label>
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
                placeholder="e.g. SURVIVE 30 TURNS"
              />
            </div>

            <div>
              <label className="block font-black mb-1">BONUS OBJECTIVES (ONE PER LINE):</label>
              <textarea
                rows={3}
                value={bonusText}
                onChange={(e) => handleBonusTextChange(e.target.value)}
                className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] p-2 font-mono font-bold text-[#0F380F] outline-none resize-none"
                placeholder="COLLECT 5 TOKENS&#10;OPPONENT SCORES ZERO"
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
