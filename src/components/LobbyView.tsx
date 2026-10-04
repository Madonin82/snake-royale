import React, { useState, useEffect, useRef } from 'react';
import { GameSettings } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { Bot, Gamepad, Globe, Play, Settings, Users, Sparkles } from 'lucide-react';

interface LobbyViewProps {
  onStartSolo: (difficulty: 'EASY' | 'MEDIUM' | 'HARD') => void;
  onStartLocal2P: () => void;
  onCreateOnlineRoom: () => void;
  onCreateServerRoom: () => void;
  onSpectateRoom: (roomCode: string) => void;
  onJoinOnlineRoom: (roomCode: string) => void;
  onOpenSettings: () => void;
  onOpenLatencyHarness: () => void;
  gamepadCount: number;
  settings: GameSettings;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
  isNintendoController?: boolean;
  onImportReplay: (file: File) => void;
  importError: string | null;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  onStartSolo,
  onStartLocal2P,
  onCreateOnlineRoom,
  onCreateServerRoom,
  onSpectateRoom,
  onJoinOnlineRoom,
  onOpenSettings,
  onOpenLatencyHarness,
  gamepadCount,
  settings,
  displayName,
  onDisplayNameChange,
  onRegisterHandler,
  isNintendoController = false,
  onImportReplay,
  importError,
}) => {
  const [roomInput, setRoomInput] = useState('');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
  const [tab, setTab] = useState<'SOLO' | 'LOCAL' | 'ONLINE'>('SOLO');
  const [focusIndex, setFocusIndex] = useState<number>(3); // Default focus on Start button
  const [, setIsUsingGamepad] = useState<boolean>(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const confirmKeyLabel = isNintendoController ? '[A] SELECT' : '[A] SELECT';
  const startKeyLabel = isNintendoController ? '[A / START]' : '[A / START]';

  type LobbyItem =
    | 'TABS'
    | 'NAME'
    | 'DIFFICULTY'
    | 'START'
    | 'CREATE_ROOM'
    | 'ROOM_INPUT'
    | 'JOIN_BTN'
    | 'SERVER_ROOM'
    | 'SPECTATE_ROOM'
    | 'SETTINGS'
    | 'HARNESS';

  const getItemsForTab = (currentTab: 'SOLO' | 'LOCAL' | 'ONLINE'): LobbyItem[] => {
    switch (currentTab) {
      case 'SOLO':
        return ['TABS', 'NAME', 'DIFFICULTY', 'START', 'SETTINGS', 'HARNESS'];
      case 'LOCAL':
        return ['TABS', 'NAME', 'START', 'SETTINGS', 'HARNESS'];
      case 'ONLINE':
        return [
          'TABS',
          'NAME',
          'CREATE_ROOM',
          'ROOM_INPUT',
          'JOIN_BTN',
          'SERVER_ROOM',
          'SPECTATE_ROOM',
          'SETTINGS',
          'HARNESS',
        ];
    }
  };

  const currentItems = getItemsForTab(tab);
  const currentItem = currentItems[focusIndex] || currentItems[0];

  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (roomInput.trim()) {
      soundEngine.playMenuSelect();
      onJoinOnlineRoom(roomInput.trim().toUpperCase());
    }
  };

  const cycleTab = (direction: 'left' | 'right') => {
    soundEngine.playMenuMove();
    const tabs: ('SOLO' | 'LOCAL' | 'ONLINE')[] = ['SOLO', 'LOCAL', 'ONLINE'];
    const curIdx = tabs.indexOf(tab);
    let nextIdx = direction === 'right' ? curIdx + 1 : curIdx - 1;
    if (nextIdx < 0) nextIdx = tabs.length - 1;
    if (nextIdx >= tabs.length) nextIdx = 0;
    setTab(tabs[nextIdx]);
    setFocusIndex(tabs[nextIdx] === 'ONLINE' ? 2 : (tabs[nextIdx] === 'LOCAL' ? 2 : 3));
  };

  const cycleDifficulty = (direction: 'left' | 'right') => {
    soundEngine.playMenuMove();
    const diffs: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
    const curIdx = diffs.indexOf(difficulty);
    let nextIdx = direction === 'right' ? curIdx + 1 : curIdx - 1;
    if (nextIdx < 0) nextIdx = diffs.length - 1;
    if (nextIdx >= diffs.length) nextIdx = 0;
    setDifficulty(diffs[nextIdx]);
  };

  const executeCurrentAction = () => {
    switch (currentItem) {
      case 'TABS':
        cycleTab('right');
        break;
      case 'NAME':
        nameInputRef.current?.focus();
        soundEngine.playMenuSelect();
        break;
      case 'DIFFICULTY':
        cycleDifficulty('right');
        break;
      case 'START':
        soundEngine.playMenuSelect();
        if (tab === 'SOLO') onStartSolo(difficulty);
        else if (tab === 'LOCAL') onStartLocal2P();
        break;
      case 'CREATE_ROOM':
        soundEngine.playMenuSelect();
        onCreateOnlineRoom();
        break;
      case 'ROOM_INPUT':
        roomInputRef.current?.focus();
        soundEngine.playMenuSelect();
        break;
      case 'JOIN_BTN':
        handleJoin();
        break;
      case 'SERVER_ROOM':
        soundEngine.playMenuSelect();
        onCreateServerRoom();
        break;
      case 'SPECTATE_ROOM':
        if (roomInput.trim()) {
          soundEngine.playMenuSelect();
          onSpectateRoom(roomInput.trim());
        }
        break;
      case 'SETTINGS':
        soundEngine.playMenuSelect();
        onOpenSettings();
        break;
      case 'HARNESS':
        soundEngine.playMenuSelect();
        onOpenLatencyHarness();
        break;
    }
  };

  useEffect(() => {
    const handleAction = (action: GamepadMenuAction) => {
      setIsUsingGamepad(true);

      if (action === 'START') {
        soundEngine.playMenuSelect();
        if (tab === 'SOLO') onStartSolo(difficulty);
        else if (tab === 'LOCAL') onStartLocal2P();
        else if (tab === 'ONLINE') {
          if (roomInput.trim()) onJoinOnlineRoom(roomInput.trim().toUpperCase());
          else onCreateOnlineRoom();
        }
        return;
      }

      if (action === 'PREV_TAB') {
        cycleTab('left');
        return;
      }

      if (action === 'NEXT_TAB') {
        cycleTab('right');
        return;
      }

      if (action === 'UP') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : currentItems.length - 1));
        return;
      }

      if (action === 'DOWN') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < currentItems.length - 1 ? prev + 1 : 0));
        return;
      }

      if (action === 'LEFT') {
        if (currentItem === 'TABS') {
          cycleTab('left');
        } else if (currentItem === 'DIFFICULTY') {
          cycleDifficulty('left');
        } else if (currentItem === 'SETTINGS' || currentItem === 'HARNESS') {
          soundEngine.playMenuMove();
          const settingsIdx = currentItems.indexOf('SETTINGS');
          const harnessIdx = currentItems.indexOf('HARNESS');
          if (focusIndex === harnessIdx && settingsIdx !== -1) setFocusIndex(settingsIdx);
        }
        return;
      }

      if (action === 'RIGHT') {
        if (currentItem === 'TABS') {
          cycleTab('right');
        } else if (currentItem === 'DIFFICULTY') {
          cycleDifficulty('right');
        } else if (currentItem === 'SETTINGS' || currentItem === 'HARNESS') {
          soundEngine.playMenuMove();
          const settingsIdx = currentItems.indexOf('SETTINGS');
          const harnessIdx = currentItems.indexOf('HARNESS');
          if (focusIndex === settingsIdx && harnessIdx !== -1) setFocusIndex(harnessIdx);
        }
        return;
      }

      if (action === 'CONFIRM') {
        executeCurrentAction();
        return;
      }

      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        nameInputRef.current?.blur();
        roomInputRef.current?.blur();
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [tab, focusIndex, difficulty, roomInput, currentItems, onRegisterHandler]);

  useEffect(() => {
    if (focusIndex >= currentItems.length) {
      setFocusIndex(currentItems.length - 1);
    }
  }, [tab, currentItems.length, focusIndex]);

  return (
    <div className="w-full max-w-[460px] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] text-[#0F380F] p-4 font-mono select-none flex flex-col gap-3">
      {/* Title Header */}
      <div className="text-center border-b-4 border-[#0F380F] pb-2">
        <div className="flex items-center justify-center gap-2">
          <span className="text-xl">🐍</span>
          <h1 className="text-xl font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
            SNAKE ROYALE
          </h1>
          <span className="text-xl">👑</span>
        </div>
        <div className="text-[11px] font-bold mt-1 text-[#306230] uppercase tracking-widest">
          {settings.turnBased ? 'Turn-Based Strategy' : '2-Player Token Race'} • {settings.gridSize}×{settings.gridSize} Battle Arena
        </div>

        {/* Gamepad Detection Banner */}
        <div className="mt-2 flex items-center justify-center gap-2">
          {gamepadCount > 0 ? (
            <div className="inline-flex items-center gap-1.5 bg-[#0F380F] text-[#9BBC0F] px-2 py-0.5 text-[10px] font-bold border border-[#0F380F]">
              <Gamepad className="w-3 h-3 text-[#9BBC0F]" />
              <span>
                {isNintendoController
                  ? 'SWITCH PRO CONTROLLER DETECTED'
                  : `GAMEPAD DETECTED (${gamepadCount})`}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 bg-[#8BAC0F] text-[#0F380F] px-2 py-0.5 text-[9px] font-bold border border-[#0F380F]">
              <Gamepad className="w-3 h-3 opacity-60" />
              <span>CONNECT ANY GAMEPAD (SWITCH PRO, XBOX, USB)</span>
            </div>
          )}
        </div>
      </div>

      {/* Optional display name */}
      <div
        className={`flex items-center gap-2 p-2 border-2 transition-all ${
          currentItem === 'NAME'
            ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
            : 'bg-[#8BAC0F] border-[#0F380F]'
        }`}
        onClick={() => {
          setFocusIndex(currentItems.indexOf('NAME'));
          nameInputRef.current?.focus();
        }}
      >
        {currentItem === 'NAME' && <span className="font-black animate-pulse">►</span>}
        <label className="text-[10px] font-bold uppercase whitespace-nowrap">
          Your name<br />(optional):
        </label>
        <input
          ref={nameInputRef}
          type="text"
          value={displayName}
          onFocus={() => {
            setIsUsingGamepad(false);
            setFocusIndex(currentItems.indexOf('NAME'));
          }}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="e.g. ANNIE"
          maxLength={14}
          className="flex-1 min-w-0 bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-2 py-1 font-black text-xs uppercase placeholder:text-[#306230]/50"
        />
        {currentItem === 'NAME' && (
          <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 py-0.5 font-bold">{confirmKeyLabel}</span>
        )}
      </div>

      {/* Mode Selector Tabs */}
      <div
        className={`grid grid-cols-3 gap-1 p-1 border-2 transition-all ${
          currentItem === 'TABS'
            ? 'bg-[#306230] border-[#0F380F] ring-2 ring-[#0F380F]'
            : 'bg-[#8BAC0F] border-[#0F380F]'
        }`}
      >
        <button
          onClick={() => {
            setTab('SOLO');
            setFocusIndex(3);
          }}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'SOLO'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <div className="flex items-center gap-1">
            {currentItem === 'TABS' && tab === 'SOLO' && <span className="animate-pulse">►</span>}
            <Bot className="w-4 h-4" />
          </div>
          <span>SOLO VS AI</span>
        </button>

        <button
          onClick={() => {
            setTab('LOCAL');
            setFocusIndex(2);
          }}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'LOCAL'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <div className="flex items-center gap-1">
            {currentItem === 'TABS' && tab === 'LOCAL' && <span className="animate-pulse">►</span>}
            <Users className="w-4 h-4" />
          </div>
          <span>LOCAL 2P</span>
        </button>

        <button
          onClick={() => {
            setTab('ONLINE');
            setFocusIndex(2);
          }}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'ONLINE'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <div className="flex items-center gap-1">
            {currentItem === 'TABS' && tab === 'ONLINE' && <span className="animate-pulse">►</span>}
            <Globe className="w-4 h-4" />
          </div>
          <span>ONLINE NET</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="bg-[#8BAC0F] p-3 border-2 border-[#0F380F] min-h-[165px] flex flex-col justify-between">
        {tab === 'SOLO' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold leading-tight">
              🎮 Spar against the built-in bot! Race for tokens, then survive the shrinking ring.
            </div>

            {/* Difficulty selector */}
            <div
              className={`flex flex-col gap-1 p-1 border transition-all ${
                currentItem === 'DIFFICULTY'
                  ? 'border-[#0F380F] bg-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                <span className="flex items-center gap-1">
                  {currentItem === 'DIFFICULTY' && <span className="animate-pulse">►</span>}
                  BOT Sparring Difficulty:
                </span>
                {currentItem === 'DIFFICULTY' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CHANGE</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 text-xs">
                {(['EASY', 'MEDIUM', 'HARD'] as const).map((diff) => (
                  <button
                    key={diff}
                    onClick={() => {
                      setDifficulty(diff);
                      setFocusIndex(currentItems.indexOf('DIFFICULTY'));
                      soundEngine.playMenuSelect();
                    }}
                    className={`py-1.5 border border-[#0F380F] font-bold text-[11px] cursor-pointer ${
                      difficulty === diff ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onStartSolo(difficulty);
              }}
              onMouseEnter={() => setFocusIndex(currentItems.indexOf('START'))}
              className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentItem === 'START'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'START' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current" />
              <span>START MATCH VS BOT</span>
              {currentItem === 'START' && (
                <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 ml-2 font-bold">
                  {startKeyLabel}
                </span>
              )}
            </button>
          </div>
        )}

        {tab === 'LOCAL' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold leading-tight">
              👥 2-Player Same Screen Showdown!
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] bg-[#9BBC0F] p-2 border border-[#0F380F]">
              <div>
                <span className="font-bold text-[#0F380F]">PLAYER 1:</span>
                <div>WASD or Gamepad 1</div>
              </div>
              <div>
                <span className="font-bold text-[#306230]">PLAYER 2:</span>
                <div>Arrow Keys / IJKL / Gamepad 2</div>
              </div>
            </div>

            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onStartLocal2P();
              }}
              onMouseEnter={() => setFocusIndex(currentItems.indexOf('START'))}
              className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentItem === 'START'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'START' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current" />
              <span>START LOCAL 2-PLAYER</span>
              {currentItem === 'START' && (
                <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 ml-2 font-bold">
                  {startKeyLabel}
                </span>
              )}
            </button>
          </div>
        )}

        {tab === 'ONLINE' && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-bold leading-tight">
              🌐 Host-authoritative online room with live Latency Harness!
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  soundEngine.playMenuSelect();
                  onCreateOnlineRoom();
                }}
                onMouseEnter={() => setFocusIndex(currentItems.indexOf('CREATE_ROOM'))}
                className={`py-2 px-2 border-2 border-[#0F380F] font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                  currentItem === 'CREATE_ROOM'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-3 ring-[#0F380F]'
                    : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
                }`}
              >
                <div className="flex items-center gap-1">
                  {currentItem === 'CREATE_ROOM' && <span className="animate-pulse">►</span>}
                  <Sparkles className="w-4 h-4" />
                </div>
                <span>CREATE ROOM</span>
                {currentItem === 'CREATE_ROOM' && (
                  <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">{confirmKeyLabel}</span>
                )}
              </button>

              <div className="flex flex-col gap-1">
                <input
                  ref={roomInputRef}
                  type="text"
                  placeholder="ROOM CODE"
                  value={roomInput}
                  onFocus={() => {
                    setIsUsingGamepad(false);
                    setFocusIndex(currentItems.indexOf('ROOM_INPUT'));
                  }}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className={`w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 text-center font-black text-xs uppercase placeholder:text-[#306230]/50 ${
                    currentItem === 'ROOM_INPUT' ? 'ring-2 ring-[#0F380F]' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={!roomInput.trim()}
                  onMouseEnter={() => setFocusIndex(currentItems.indexOf('JOIN_BTN'))}
                  className={`w-full py-1 border border-[#0F380F] font-bold text-xs cursor-pointer disabled:opacity-50 transition-colors ${
                    currentItem === 'JOIN_BTN'
                      ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                      : 'bg-[#306230] hover:bg-[#0F380F] text-[#9BBC0F]'
                  }`}
                >
                  {currentItem === 'JOIN_BTN' && <span className="animate-pulse mr-1">►</span>}
                  JOIN ROOM
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onCreateServerRoom();
              }}
              onMouseEnter={() => setFocusIndex(currentItems.indexOf('SERVER_ROOM'))}
              className={`w-full py-1.5 px-2 border-2 border-dashed border-[#0F380F] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                currentItem === 'SERVER_ROOM'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F]'
              }`}
            >
              {currentItem === 'SERVER_ROOM' && <span className="animate-pulse">►</span>}
              <Globe className="w-3.5 h-3.5" />
              <span>HOST AS SERVER (DM MODE)</span>
            </button>

            <button
              onClick={() => {
                if (roomInput.trim()) {
                  soundEngine.playMenuSelect();
                  onSpectateRoom(roomInput.trim());
                }
              }}
              disabled={!roomInput.trim()}
              onMouseEnter={() => setFocusIndex(currentItems.indexOf('SPECTATE_ROOM'))}
              className={`w-full py-1.5 px-2 border-2 border-dashed border-[#0F380F] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 ${
                currentItem === 'SPECTATE_ROOM'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F]'
              }`}
            >
              {currentItem === 'SPECTATE_ROOM' && <span className="animate-pulse">►</span>}
              <span>👁</span>
              <span>WATCH A MATCH (SPECTATOR)</span>
            </button>
          </div>
        )}
      </div>

      {/* Rules Summary Box */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            onImportReplay(e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      {importError && (
        <div className="bg-[#0F380F] text-[#9BBC0F] p-2 border-2 border-[#9BBC0F] text-xs font-bold text-center animate-bounce">
          ⚠️ {importError}
        </div>
      )}

      <div className="bg-[#9BBC0F] p-2 border-2 border-[#0F380F] text-[10px] leading-relaxed">
        <div className="font-bold border-b border-[#0F380F] pb-1 mb-1">RULES BRIEFING:</div>
        <ul className="list-disc pl-4 space-y-0.5">
          {settings.turnBased ? (
            <>
              <li><strong>Turns:</strong> Both snakes pick and lock a move — board advances once both are in.</li>
              <li><strong>Phase 1 ({settings.raceTurns} turns):</strong> Race for tokens. +1 length per token.</li>
              <li><strong>Phase 2:</strong> Outer ring closes every {settings.shrinkEveryTurns} turns.</li>
            </>
          ) : (
            <>
              <li><strong>Phase 1 (3:00):</strong> Real-time token race.</li>
              <li><strong>Phase 2 (2:00):</strong> Outer ring shrinks into deadly walls.</li>
            </>
          )}
          <li><strong>Win:</strong> Last snake alive. On tie: highest tokens, then length.</li>
        </ul>
      </div>

      {/* Footer Controls & Diagnostics */}
      <div className="flex items-center justify-between border-t-2 border-[#0F380F] pt-2 text-xs flex-wrap gap-1">
        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            onOpenSettings();
          }}
          onMouseEnter={() => setFocusIndex(currentItems.indexOf('SETTINGS'))}
          className={`flex items-center gap-1 px-2 py-1 border border-[#0F380F] font-bold cursor-pointer transition-colors ${
            currentItem === 'SETTINGS'
              ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
              : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
          }`}
        >
          {currentItem === 'SETTINGS' && <span className="animate-pulse">►</span>}
          <Settings className="w-3.5 h-3.5" />
          <span>SETTINGS ({settings.gridSize}×{settings.gridSize} / {settings.turnBased ? 'TURNS' : `${settings.tickRate}tps`})</span>
          {currentItem === 'SETTINGS' && (
            <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">{confirmKeyLabel}</span>
          )}
        </button>

        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            fileInputRef.current?.click();
          }}
          className="flex items-center gap-1 px-2 py-1 border border-[#0F380F] font-bold cursor-pointer transition-colors bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F]"
          title="Import Replay JSON"
        >
          <span>IMPORT REPLAY 📂</span>
        </button>

        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            onOpenLatencyHarness();
          }}
          onMouseEnter={() => setFocusIndex(currentItems.indexOf('HARNESS'))}
          className={`flex items-center gap-1 px-2 py-1 border border-[#0F380F] font-bold cursor-pointer transition-colors ${
            currentItem === 'HARNESS'
              ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
              : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
          }`}
        >
          {currentItem === 'HARNESS' && <span className="animate-pulse">►</span>}
          <Gamepad className="w-3.5 h-3.5" />
          <span>NET HARNESS</span>
          {currentItem === 'HARNESS' && (
            <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">{confirmKeyLabel}</span>
          )}
        </button>
      </div>

      {/* Gamepad Navigation Guide */}
      <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-1 px-1 flex items-center justify-around">
        <span>🎮 [D-PAD] NAVIGATE</span>
        <span>{isNintendoController ? '[A] SELECT • [B] BACK' : '[A] SELECT • [B] BACK'}</span>
        <span>[LB/RB] TABS</span>
      </div>
    </div>
  );
};
