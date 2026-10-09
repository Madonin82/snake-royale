import React, { useState, useEffect, useRef } from 'react';
import { GameSettings } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { CampaignLevel } from '../editor/levelSchema';
import { parseCampaignLevelJson, createMultiplayerCustomLevelState } from '../editor/playtestSession';
import { Bot, Gamepad, Globe, Play, Settings, Users, Sparkles, ArrowLeft, Upload, X } from 'lucide-react';

interface LobbyViewProps {
  onStartSolo: (difficulty: 'EASY' | 'MEDIUM' | 'HARD') => void;
  onStartLocal2P: () => void;
  onCreateOnlineRoom: (customLevel?: CampaignLevel | null) => void;
  onCreateServerRoom: (customLevel?: CampaignLevel | null) => void;
  onSpectateRoom: (roomCode: string) => void;
  onJoinOnlineRoom: (roomCode: string) => void;
  onOpenSettings: () => void;
  onOpenLatencyHarness: () => void;
  gamepadCount: number;
  settings: GameSettings;
  onUpdateSettings?: (newSettings: Partial<GameSettings>) => void;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  displayNameP2?: string;
  onDisplayNameP2Change?: (value: string) => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
  isNintendoController?: boolean;
  onImportReplay: (file: File) => void;
  importError: string | null;
  joinError: string | null;
  initialRoom?: string;
  customOnlineLevel?: CampaignLevel | null;
  onSelectCustomOnlineLevel?: (level: CampaignLevel | null) => void;
}

type ScreenId = 'MAIN' | 'SOLO' | 'VERSUS' | 'ONLINE' | 'SETTINGS';

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
  onUpdateSettings,
  displayName,
  onDisplayNameChange,
  displayNameP2 = '',
  onDisplayNameP2Change,
  onRegisterHandler,
  isNintendoController = false,
  onImportReplay,
  importError,
  joinError,
  initialRoom = '',
  customOnlineLevel = null,
  onSelectCustomOnlineLevel,
}) => {
  const [screen, setScreen] = useState<ScreenId>(initialRoom ? 'ONLINE' : 'MAIN');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>(settings.botDifficulty || 'MEDIUM');
  const [roomInput, setRoomInput] = useState(initialRoom);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [levelLoadError, setLevelLoadError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const p1InputRef = useRef<HTMLInputElement>(null);
  const p2InputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customLevelInputRef = useRef<HTMLInputElement>(null);

  const handleCustomLevelFile = async (file: File) => {
    setLevelLoadError(null);
    try {
      const text = await file.text();
      const parsed = parseCampaignLevelJson(text);
      // Validate that the first 2 spawns + tokens + walls can build a valid 2P state
      createMultiplayerCustomLevelState(parsed);
      onSelectCustomOnlineLevel?.(parsed);
      soundEngine.playMenuSelect();
    } catch (err: any) {
      setLevelLoadError(err?.message || 'INVALID CUSTOM LEVEL JSON');
      soundEngine.playCrash();
    }
  };

  const confirmKeyLabel = isNintendoController ? '[A] SELECT' : '[A] SELECT';
  const startKeyLabel = isNintendoController ? '[A / START]' : '[A / START]';

  const navigateTo = (nextScreen: ScreenId, defaultFocus = 0) => {
    soundEngine.playMenuSelect();
    setScreen(nextScreen);
    setFocusIndex(defaultFocus);
  };

  const navigateBack = () => {
    soundEngine.playMenuBack();
    const prevIdx =
      screen === 'SOLO'
        ? 0
        : screen === 'VERSUS'
        ? 1
        : screen === 'ONLINE'
        ? 2
        : screen === 'SETTINGS'
        ? 3
        : 0;
    setScreen('MAIN');
    setFocusIndex(prevIdx);
  };

  // Switch to ONLINE screen automatically if joinError arrives
  useEffect(() => {
    if (joinError && screen === 'MAIN') {
      setScreen('ONLINE');
      setFocusIndex(2);
    }
  }, [joinError, screen]);

  const cycleThinkTime = (dir: 1 | -1) => {
    if (!onUpdateSettings) return;
    soundEngine.playMenuMove();
    const opts: (number | null)[] = [null, 5, 10, 15];
    const cur = opts.indexOf(settings.thinkTimeSeconds);
    const nextIdx = (cur + dir + opts.length) % opts.length;
    onUpdateSettings({ thinkTimeSeconds: opts[nextIdx] });
  };

  const cycleGridSize = (dir: 1 | -1) => {
    if (!onUpdateSettings) return;
    soundEngine.playMenuMove();
    const opts = [8, 12, 16];
    const cur = opts.indexOf(settings.gridSize);
    const nextIdx = (cur + dir + opts.length) % opts.length;
    onUpdateSettings({ gridSize: opts[nextIdx] });
  };

  const toggleSound = () => {
    const next = !settings.soundEnabled;
    soundEngine.setEnabled(next);
    if (next) soundEngine.playMenuSelect();
    onUpdateSettings?.({ soundEnabled: next });
  };

  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (roomInput.trim()) {
      soundEngine.playMenuSelect();
      onJoinOnlineRoom(roomInput.trim().toUpperCase());
    }
  };

  const handleSpectate = () => {
    if (roomInput.trim()) {
      soundEngine.playMenuSelect();
      onSpectateRoom(roomInput.trim().toUpperCase());
    }
  };

  // Item lists per screen for D-Pad / keyboard navigation
  const getScreenItems = (s: ScreenId): string[] => {
    switch (s) {
      case 'MAIN':
        return ['SOLO', 'VERSUS', 'ONLINE', 'SETTINGS'];
      case 'SOLO':
        return ['BACK', 'EASY', 'MEDIUM', 'HARD', 'START_SOLO'];
      case 'VERSUS':
        return ['BACK', 'P1_NAME', 'P2_NAME', 'START_VERSUS'];
      case 'ONLINE':
        return ['BACK', 'PLAYER_NAME', 'CUSTOM_LEVEL', 'CREATE_ROOM', 'ROOM_CODE', 'JOIN_ROOM', 'SPECTATE_ROOM', 'SERVER_ROOM'];
      case 'SETTINGS':
        return [
          'BACK',
          'PLAYER_NAME',
          'THINK_TIME',
          'GRID_SIZE',
          'SOUND',
          'IMPORT_REPLAY',
          'MORE_OPTIONS',
          'NET_HARNESS',
        ];
    }
  };

  const items = getScreenItems(screen);
  const currentItem = items[focusIndex] || items[0];

  useEffect(() => {
    const handleAction = (action: GamepadMenuAction) => {
      if (action === 'CANCEL') {
        if (screen !== 'MAIN') {
          p1InputRef.current?.blur();
          p2InputRef.current?.blur();
          nameInputRef.current?.blur();
          roomInputRef.current?.blur();
          navigateBack();
        }
        return;
      }

      if (action === 'START') {
        if (screen === 'MAIN') {
          if (currentItem === 'SOLO') navigateTo('SOLO', 4);
          else if (currentItem === 'VERSUS') navigateTo('VERSUS', 3);
          else if (currentItem === 'ONLINE') navigateTo('ONLINE', 2);
          else if (currentItem === 'SETTINGS') navigateTo('SETTINGS', 1);
        } else if (screen === 'SOLO') {
          soundEngine.playMenuSelect();
          onStartSolo(difficulty);
        } else if (screen === 'VERSUS') {
          soundEngine.playMenuSelect();
          onStartLocal2P();
        } else if (screen === 'ONLINE') {
          if (roomInput.trim()) handleJoin();
          else {
            soundEngine.playMenuSelect();
            onCreateOnlineRoom(customOnlineLevel);
          }
        }
        return;
      }

      if (action === 'UP' || action === 'PREV_TAB') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        return;
      }

      if (action === 'DOWN' || action === 'NEXT_TAB') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        return;
      }

      if (action === 'LEFT' || action === 'RIGHT') {
        const dir = action === 'RIGHT' ? 1 : -1;
        if (screen === 'MAIN') {
          soundEngine.playMenuMove();
          setFocusIndex((prev) => (prev + dir + items.length) % items.length);
          return;
        }
        if (screen === 'SOLO') {
          if (currentItem === 'EASY' || currentItem === 'MEDIUM' || currentItem === 'HARD') {
            soundEngine.playMenuMove();
            const diffs: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
            const nextDiff = diffs[(diffs.indexOf(currentItem) + dir + 3) % 3];
            setDifficulty(nextDiff);
            setFocusIndex(items.indexOf(nextDiff));
            return;
          }
        }
        if (screen === 'SETTINGS') {
          if (currentItem === 'THINK_TIME') cycleThinkTime(dir);
          else if (currentItem === 'GRID_SIZE') cycleGridSize(dir);
          else if (currentItem === 'SOUND') toggleSound();
          else if (currentItem === 'IMPORT_REPLAY' && dir === 1) {
            soundEngine.playMenuMove();
            setFocusIndex(items.indexOf('MORE_OPTIONS'));
          } else if (currentItem === 'MORE_OPTIONS' && dir === -1) {
            soundEngine.playMenuMove();
            setFocusIndex(items.indexOf('IMPORT_REPLAY'));
          }
        }
        return;
      }

      if (action === 'CONFIRM') {
        if (currentItem === 'BACK') {
          navigateBack();
          return;
        }

        if (screen === 'MAIN') {
          if (currentItem === 'SOLO') navigateTo('SOLO', 4);
          else if (currentItem === 'VERSUS') navigateTo('VERSUS', 3);
          else if (currentItem === 'ONLINE') navigateTo('ONLINE', 2);
          else if (currentItem === 'SETTINGS') navigateTo('SETTINGS', 1);
          return;
        }

        if (screen === 'SOLO') {
          if (currentItem === 'EASY' || currentItem === 'MEDIUM' || currentItem === 'HARD') {
            soundEngine.playMenuSelect();
            setDifficulty(currentItem);
          } else if (currentItem === 'START_SOLO') {
            soundEngine.playMenuSelect();
            onStartSolo(difficulty);
          }
          return;
        }

        if (screen === 'VERSUS') {
          if (currentItem === 'P1_NAME') {
            soundEngine.playMenuSelect();
            p1InputRef.current?.focus();
          } else if (currentItem === 'P2_NAME') {
            soundEngine.playMenuSelect();
            p2InputRef.current?.focus();
          } else if (currentItem === 'START_VERSUS') {
            soundEngine.playMenuSelect();
            onStartLocal2P();
          }
          return;
        }

        if (screen === 'ONLINE') {
          if (currentItem === 'PLAYER_NAME') {
            soundEngine.playMenuSelect();
            nameInputRef.current?.focus();
          } else if (currentItem === 'CUSTOM_LEVEL') {
            soundEngine.playMenuSelect();
            customLevelInputRef.current?.click();
          } else if (currentItem === 'CREATE_ROOM') {
            soundEngine.playMenuSelect();
            onCreateOnlineRoom(customOnlineLevel);
          } else if (currentItem === 'ROOM_CODE') {
            soundEngine.playMenuSelect();
            roomInputRef.current?.focus();
          } else if (currentItem === 'JOIN_ROOM') {
            handleJoin();
          } else if (currentItem === 'SPECTATE_ROOM') {
            handleSpectate();
          } else if (currentItem === 'SERVER_ROOM') {
            soundEngine.playMenuSelect();
            onCreateServerRoom(customOnlineLevel);
          }
          return;
        }

        if (screen === 'SETTINGS') {
          if (currentItem === 'PLAYER_NAME') {
            soundEngine.playMenuSelect();
            nameInputRef.current?.focus();
          } else if (currentItem === 'THINK_TIME') {
            cycleThinkTime(1);
          } else if (currentItem === 'GRID_SIZE') {
            cycleGridSize(1);
          } else if (currentItem === 'SOUND') {
            toggleSound();
          } else if (currentItem === 'IMPORT_REPLAY') {
            soundEngine.playMenuSelect();
            fileInputRef.current?.click();
          } else if (currentItem === 'MORE_OPTIONS') {
            soundEngine.playMenuSelect();
            onOpenSettings();
          } else if (currentItem === 'NET_HARNESS') {
            soundEngine.playMenuSelect();
            onOpenLatencyHarness();
          }
          return;
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [
    screen,
    focusIndex,
    currentItem,
    items,
    difficulty,
    roomInput,
    settings,
    onRegisterHandler,
  ]);

  const thinkTimeLabel =
    settings.thinkTimeSeconds === null ? 'INFINITE' : `${settings.thinkTimeSeconds}S`;

  return (
    <div className="mobile-scroll-panel w-full max-w-[460px] md:max-w-[560px] [@media(orientation:landscape)]:max-w-[560px] max-h-full bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] [@media(max-height:500px)]:shadow-[4px_4px_0px_#0F380F] text-[#0F380F] p-3 sm:p-4 [@media(max-height:500px)]:p-2 font-mono select-none flex flex-col justify-between gap-2.5 [@media(max-height:500px)]:gap-1.5 overflow-hidden">
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
      <input
        ref={customLevelInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleCustomLevelFile(e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      {/* ============ MAIN MENU ============ */}
      {screen === 'MAIN' && (
        <div className="flex flex-col h-full justify-between gap-2.5 [@media(max-height:500px)]:gap-1.5 min-h-0">
          {/* Title Header */}
          <div className="text-center border-b-4 [@media(max-height:500px)]:border-b-2 border-[#0F380F] pb-2 [@media(max-height:500px)]:pb-1 shrink-0">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-xl sm:text-2xl [@media(max-height:500px)]:text-base font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
                SNAKE ROYALE
              </h1>
            </div>
            <div className="text-[11px] [@media(max-height:500px)]:text-[10px] font-bold mt-1 [@media(max-height:500px)]:mt-0.5 text-[#306230] uppercase tracking-widest">
              {settings.turnBased ? 'Turn-Based Strategy' : '2-Player Token Race'} • {settings.gridSize}×{settings.gridSize} Battle Arena
            </div>

            {/* Gamepad / Touch Detection Banner */}
            <div className="mt-1.5 [@media(max-height:500px)]:mt-1 flex flex-wrap items-center justify-center gap-1.5">
              {gamepadCount > 0 ? (
                <div className="inline-flex items-center gap-1.5 bg-[#0F380F] text-[#9BBC0F] px-2 py-0.5 text-[10px] [@media(max-height:500px)]:text-[9px] font-bold border border-[#0F380F]">
                  <Gamepad className="w-3 h-3 text-[#9BBC0F]" />
                  <span>
                    {isNintendoController
                      ? 'SWITCH PRO CONTROLLER DETECTED'
                      : `GAMEPAD DETECTED (${gamepadCount})`}
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1 bg-[#8BAC0F] text-[#0F380F] px-2 py-0.5 text-[9px] font-bold border border-[#0F380F]">
                  <span>📱 SWIPE / TAP BOARD TO MOVE • 🎮 GAMEPAD READY</span>
                </div>
              )}
            </div>
          </div>

          {/* 4 Main Menu Buttons — 2x2 Grid on Desktop, Tablet, AND Phone Landscape */}
          <div className="flex flex-col md:grid md:grid-cols-2 [@media(orientation:landscape)]:grid [@media(orientation:landscape)]:grid-cols-2 gap-2.5 [@media(max-height:500px)]:gap-1.5 flex-1 min-h-0 justify-center">
            <button
              type="button"
              onClick={() => navigateTo('SOLO', 4)}
              onMouseEnter={() => setFocusIndex(0)}
              className={`border-2 border-[#0F380F] p-3 sm:p-4 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:px-3 text-left transition-all cursor-pointer shadow-[3px_3px_0px_#0F380F] [@media(max-height:500px)]:shadow-[2px_2px_0px_#0F380F] flex flex-col justify-center ${
                currentItem === 'SOLO'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base sm:text-lg [@media(max-height:500px)]:text-sm font-black tracking-widest uppercase">
                  {currentItem === 'SOLO' && <span className="animate-pulse">►</span>}
                  <Bot className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
                  <span>SOLO</span>
                </div>
                {currentItem === 'SOLO' && (
                  <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">
                    {confirmKeyLabel}
                  </span>
                )}
              </div>
              <div
                className={`text-[11px] [@media(max-height:500px)]:text-[10px] font-bold tracking-wider uppercase mt-1 [@media(max-height:500px)]:mt-0.5 ${
                  currentItem === 'SOLO' ? 'text-[#8BAC0F]' : 'text-[#306230]'
                }`}
              >
                SPAR AGAINST THE BOT
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('VERSUS', 3)}
              onMouseEnter={() => setFocusIndex(1)}
              className={`border-2 border-[#0F380F] p-3 sm:p-4 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:px-3 text-left transition-all cursor-pointer shadow-[3px_3px_0px_#0F380F] [@media(max-height:500px)]:shadow-[2px_2px_0px_#0F380F] flex flex-col justify-center ${
                currentItem === 'VERSUS'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base sm:text-lg [@media(max-height:500px)]:text-sm font-black tracking-widest uppercase">
                  {currentItem === 'VERSUS' && <span className="animate-pulse">►</span>}
                  <Users className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
                  <span>VERSUS</span>
                </div>
                {currentItem === 'VERSUS' && (
                  <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">
                    {confirmKeyLabel}
                  </span>
                )}
              </div>
              <div
                className={`text-[11px] [@media(max-height:500px)]:text-[10px] font-bold tracking-wider uppercase mt-1 [@media(max-height:500px)]:mt-0.5 ${
                  currentItem === 'VERSUS' ? 'text-[#8BAC0F]' : 'text-[#306230]'
                }`}
              >
                SHARED SCREEN 2P
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('ONLINE', 2)}
              onMouseEnter={() => setFocusIndex(2)}
              className={`border-2 border-[#0F380F] p-3 sm:p-4 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:px-3 text-left transition-all cursor-pointer shadow-[3px_3px_0px_#0F380F] [@media(max-height:500px)]:shadow-[2px_2px_0px_#0F380F] flex flex-col justify-center ${
                currentItem === 'ONLINE'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base sm:text-lg [@media(max-height:500px)]:text-sm font-black tracking-widest uppercase">
                  {currentItem === 'ONLINE' && <span className="animate-pulse">►</span>}
                  <Globe className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
                  <span>ONLINE</span>
                </div>
                {currentItem === 'ONLINE' && (
                  <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">
                    {confirmKeyLabel}
                  </span>
                )}
              </div>
              <div
                className={`text-[11px] [@media(max-height:500px)]:text-[10px] font-bold tracking-wider uppercase mt-1 [@media(max-height:500px)]:mt-0.5 ${
                  currentItem === 'ONLINE' ? 'text-[#8BAC0F]' : 'text-[#306230]'
                }`}
              >
                CREATE OR JOIN A ROOM
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('SETTINGS', 1)}
              onMouseEnter={() => setFocusIndex(3)}
              className={`border-2 border-[#0F380F] p-3 sm:p-4 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:px-3 text-left transition-all cursor-pointer shadow-[3px_3px_0px_#0F380F] [@media(max-height:500px)]:shadow-[2px_2px_0px_#0F380F] flex flex-col justify-center ${
                currentItem === 'SETTINGS'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base sm:text-lg [@media(max-height:500px)]:text-sm font-black tracking-widest uppercase">
                  {currentItem === 'SETTINGS' && <span className="animate-pulse">►</span>}
                  <Settings className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
                  <span>SETTINGS</span>
                </div>
                {currentItem === 'SETTINGS' && (
                  <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">
                    {confirmKeyLabel}
                  </span>
                )}
              </div>
              <div
                className={`text-[11px] [@media(max-height:500px)]:text-[10px] font-bold tracking-wider uppercase mt-1 [@media(max-height:500px)]:mt-0.5 ${
                  currentItem === 'SETTINGS' ? 'text-[#8BAC0F]' : 'text-[#306230]'
                }`}
              >
                NAME &bull; RULES &bull; OPTIONS
              </div>
            </button>
          </div>

          {/* Touch & Gamepad Navigation Guide */}
          <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-1 [@media(max-height:500px)]:py-0.5 px-1 flex items-center justify-around shrink-0">
            <span>📱 TAP / SWIPE BOARD</span>
            <span>🎮 [D-PAD] NAVIGATE</span>
            <span>[A] SELECT • [B] BACK</span>
          </div>
        </div>
      )}

      {/* ============ SOLO SUBMENU ============ */}
      {screen === 'SOLO' && (
        <div className="flex flex-col h-full justify-between gap-2.5 [@media(max-height:500px)]:gap-1.5 min-h-0">
          <div className="flex items-center gap-3 border-b-2 border-[#0F380F] pb-2 [@media(max-height:500px)]:pb-1 shrink-0">
            <button
              type="button"
              onClick={navigateBack}
              onMouseEnter={() => setFocusIndex(0)}
              className={`flex items-center gap-1 px-2.5 py-1.5 [@media(max-height:500px)]:py-1 border-2 border-[#0F380F] text-xs font-black uppercase cursor-pointer transition-colors ${
                currentItem === 'BACK'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'BACK' && <span className="animate-pulse">►</span>}
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>BACK</span>
            </button>
            <div className="flex items-center gap-1.5 text-lg [@media(max-height:500px)]:text-sm font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
              <Bot className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
              <span>SOLO</span>
            </div>
          </div>

          <div className="bg-[#8BAC0F] p-3 [@media(max-height:500px)]:p-2 border-2 border-[#0F380F] flex flex-col gap-2.5 [@media(max-height:500px)]:gap-1.5 flex-1 justify-center min-h-0">
            <div className="text-xs [@media(max-height:500px)]:text-[11px] font-bold leading-tight">
              🎮 Spar against the built-in bot! On phones: swipe or tap the board to queue moves, then tap LOCK.
            </div>

            <div className="text-[10px] font-bold uppercase tracking-wider text-[#0F380F]">
              DIFFICULTY
            </div>
            <div className="flex flex-col [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-3 gap-2">
              {(['EASY', 'MEDIUM', 'HARD'] as const).map((diff, idx) => {
                const isSelected = difficulty === diff;
                const isFocused = currentItem === diff;
                return (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => {
                      soundEngine.playMenuSelect();
                      setDifficulty(diff);
                      setFocusIndex(idx + 1);
                    }}
                    onMouseEnter={() => setFocusIndex(idx + 1)}
                    className={`py-2.5 [@media(max-height:500px)]:py-2 px-4 border-2 border-[#0F380F] font-black text-xs sm:text-sm tracking-widest cursor-pointer flex items-center justify-center gap-2 transition-all ${
                      isSelected || isFocused
                        ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                        : 'bg-[#9BBC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
                    }`}
                  >
                    {isFocused && <span className="animate-pulse">►</span>}
                    <span>{diff}</span>
                    {isSelected && <span>★</span>}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                soundEngine.playMenuSelect();
                onStartSolo(difficulty);
              }}
              onMouseEnter={() => setFocusIndex(4)}
              className={`w-full py-3 [@media(max-height:500px)]:py-2 mt-1 [@media(max-height:500px)]:mt-0.5 border-2 border-[#0F380F] font-black text-sm [@media(max-height:500px)]:text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[3px_3px_0px_#0F380F] ${
                currentItem === 'START_SOLO'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.01]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'START_SOLO' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current" />
              <span>START MATCH VS BOT</span>
              {currentItem === 'START_SOLO' && (
                <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 ml-1 font-bold">
                  {startKeyLabel}
                </span>
              )}
            </button>
          </div>

          <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-1 [@media(max-height:500px)]:py-0.5 px-1 flex items-center justify-around shrink-0">
            <span>🎮 [D-PAD] NAVIGATE</span>
            <span>[A / START] SELECT</span>
            <span>[B / ESC] BACK</span>
          </div>
        </div>
      )}

      {/* ============ VERSUS SUBMENU ============ */}
      {screen === 'VERSUS' && (
        <div className="flex flex-col h-full justify-between gap-2.5 [@media(max-height:500px)]:gap-1.5 min-h-0">
          <div className="flex items-center gap-3 border-b-2 border-[#0F380F] pb-2 [@media(max-height:500px)]:pb-1 shrink-0">
            <button
              type="button"
              onClick={navigateBack}
              onMouseEnter={() => setFocusIndex(0)}
              className={`flex items-center gap-1 px-2.5 py-1.5 [@media(max-height:500px)]:py-1 border-2 border-[#0F380F] text-xs font-black uppercase cursor-pointer transition-colors ${
                currentItem === 'BACK'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'BACK' && <span className="animate-pulse">►</span>}
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>BACK</span>
            </button>
            <div className="flex items-center gap-1.5 text-lg [@media(max-height:500px)]:text-sm font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
              <Users className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
              <span>VERSUS</span>
            </div>
          </div>

          <div className="bg-[#8BAC0F] p-3 [@media(max-height:500px)]:p-2 border-2 border-[#0F380F] flex flex-col gap-2.5 [@media(max-height:500px)]:gap-1.5 flex-1 justify-center min-h-0">
            <div className="text-xs [@media(max-height:500px)]:text-[11px] font-bold leading-tight">
              👥 2-Player Same Screen Showdown!
            </div>

            <div className="flex flex-col [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  {currentItem === 'P1_NAME' && <span className="animate-pulse">►</span>}
                  <span>PLAYER 1 NAME</span>
                </label>
                <input
                  ref={p1InputRef}
                  type="text"
                  value={displayName}
                  onFocus={() => setFocusIndex(1)}
                  onChange={(e) => onDisplayNameChange(e.target.value.toUpperCase())}
                  placeholder="JIMMY"
                  maxLength={12}
                  className={`w-full bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-3 py-2 [@media(max-height:500px)]:py-1 font-black text-xs sm:text-sm uppercase placeholder:text-[#306230]/50 ${
                    currentItem === 'P1_NAME' ? 'ring-2 ring-[#0F380F]' : ''
                  }`}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  {currentItem === 'P2_NAME' && <span className="animate-pulse">►</span>}
                  <span>PLAYER 2 NAME</span>
                </label>
                <input
                  ref={p2InputRef}
                  type="text"
                  value={displayNameP2}
                  onFocus={() => setFocusIndex(2)}
                  onChange={(e) => onDisplayNameP2Change?.(e.target.value.toUpperCase())}
                  placeholder="ANNIE"
                  maxLength={12}
                  className={`w-full bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-3 py-2 [@media(max-height:500px)]:py-1 font-black text-xs sm:text-sm uppercase placeholder:text-[#306230]/50 ${
                    currentItem === 'P2_NAME' ? 'ring-2 ring-[#0F380F]' : ''
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] bg-[#9BBC0F] p-2 [@media(max-height:500px)]:p-1.5 border border-[#0F380F]">
              <div>
                <span className="font-bold text-[#0F380F]">PLAYER 1:</span>
                <div>WASD / Touch / Gamepad 1</div>
              </div>
              <div>
                <span className="font-bold text-[#306230]">PLAYER 2:</span>
                <div>Arrows / IJKL / Gamepad 2</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                soundEngine.playMenuSelect();
                onStartLocal2P();
              }}
              onMouseEnter={() => setFocusIndex(3)}
              className={`w-full py-3 [@media(max-height:500px)]:py-2 mt-1 [@media(max-height:500px)]:mt-0.5 border-2 border-[#0F380F] font-black text-sm [@media(max-height:500px)]:text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[3px_3px_0px_#0F380F] ${
                currentItem === 'START_VERSUS'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.01]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'START_VERSUS' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current" />
              <span>START MATCH</span>
              {currentItem === 'START_VERSUS' && (
                <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 ml-1 font-bold">
                  {startKeyLabel}
                </span>
              )}
            </button>
          </div>

          <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-1 [@media(max-height:500px)]:py-0.5 px-1 flex items-center justify-around shrink-0">
            <span>🎮 [D-PAD] NAVIGATE</span>
            <span>[A / START] SELECT</span>
            <span>[B / ESC] BACK</span>
          </div>
        </div>
      )}

      {/* ============ ONLINE SUBMENU ============ */}
      {screen === 'ONLINE' && (
        <div className="flex flex-col h-full justify-between gap-2 [@media(max-height:500px)]:gap-1 min-h-0">
          <div className="flex items-center gap-3 border-b-2 border-[#0F380F] pb-2 [@media(max-height:500px)]:pb-1 shrink-0">
            <button
              type="button"
              onClick={navigateBack}
              onMouseEnter={() => setFocusIndex(0)}
              className={`flex items-center gap-1 px-2.5 py-1.5 [@media(max-height:500px)]:py-1 border-2 border-[#0F380F] text-xs font-black uppercase cursor-pointer transition-colors ${
                currentItem === 'BACK'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'BACK' && <span className="animate-pulse">►</span>}
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>BACK</span>
            </button>
            <div className="flex items-center gap-1.5 text-lg [@media(max-height:500px)]:text-sm font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
              <Globe className="w-5 h-5 [@media(max-height:500px)]:w-4 [@media(max-height:500px)]:h-4" />
              <span>ONLINE</span>
            </div>
          </div>

          <div className="bg-[#8BAC0F] p-3 [@media(max-height:500px)]:p-2 border-2 border-[#0F380F] flex flex-col gap-2 [@media(max-height:500px)]:gap-1.5 flex-1 justify-center min-h-0">
            <div className="flex flex-col [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-2 gap-2">
              <div className="flex flex-col gap-1 [@media(max-height:500px)]:gap-0.5">
                <label className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  {currentItem === 'PLAYER_NAME' && <span className="animate-pulse">►</span>}
                  <span>YOUR NAME</span>
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={displayName}
                  onFocus={() => setFocusIndex(1)}
                  onChange={(e) => onDisplayNameChange(e.target.value.toUpperCase())}
                  placeholder="JIMMY"
                  maxLength={12}
                  className={`w-full bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-2.5 py-1.5 [@media(max-height:500px)]:py-1 font-black text-xs uppercase placeholder:text-[#306230]/50 ${
                    currentItem === 'PLAYER_NAME' ? 'ring-2 ring-[#0F380F]' : ''
                  }`}
                />
              </div>

              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playMenuSelect();
                    onCreateOnlineRoom(customOnlineLevel);
                  }}
                  onMouseEnter={() => setFocusIndex(items.indexOf('CREATE_ROOM'))}
                  className={`w-full py-2.5 [@media(max-height:500px)]:py-1.5 px-3 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                    currentItem === 'CREATE_ROOM'
                      ? 'bg-[#0F380F] text-[#9BBC0F] ring-3 ring-[#0F380F]'
                      : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
                  }`}
                >
                  {currentItem === 'CREATE_ROOM' && <span className="animate-pulse">►</span>}
                  <Sparkles className="w-4 h-4" />
                  <span>CREATE ROOM</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 [@media(max-height:500px)]:gap-0.5">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1">
                  {currentItem === 'CUSTOM_LEVEL' && <span className="animate-pulse">►</span>}
                  <span>HOST ARENA MAP:</span>
                </span>
                {customOnlineLevel && (
                  <span className="bg-[#0F380F] text-[#9BBC0F] px-1.5 py-0.5 text-[9px] font-black">
                    {customOnlineLevel.gridSize}×{customOnlineLevel.gridSize} · {customOnlineLevel.walls.length} WALLS
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playMenuSelect();
                    customLevelInputRef.current?.click();
                  }}
                  onMouseEnter={() => setFocusIndex(items.indexOf('CUSTOM_LEVEL'))}
                  className={`flex-1 py-1.5 px-2.5 border-2 border-[#0F380F] font-black text-xs flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                    currentItem === 'CUSTOM_LEVEL'
                      ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                      : customOnlineLevel
                        ? 'bg-[#306230] text-[#9BBC0F] hover:bg-[#0F380F]'
                        : 'bg-[#9BBC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
                  }`}
                >
                  <span className="truncate">
                    {customOnlineLevel ? `🗺 ${customOnlineLevel.name}` : '🗺 DEFAULT ARENA (LOAD LEVEL JSON...)'}
                  </span>
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                </button>
                {customOnlineLevel && (
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playMenuBack();
                      setLevelLoadError(null);
                      onSelectCustomOnlineLevel?.(null);
                    }}
                    title="Reset to Default Arena"
                    className="px-2 py-1.5 border-2 border-[#0F380F] bg-[#9BBC0F] hover:bg-[#8B1E0F] hover:text-white text-[#0F380F] font-black text-xs cursor-pointer flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {levelLoadError && (
                <div className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-700 px-2 py-0.5">
                  ⚠️ {levelLoadError}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 [@media(max-height:500px)]:gap-0.5">
              <label className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                {currentItem === 'ROOM_CODE' && <span className="animate-pulse">►</span>}
                <span>ROOM CODE</span>
              </label>
              <input
                ref={roomInputRef}
                type="text"
                value={roomInput}
                onFocus={() => setFocusIndex(items.indexOf('ROOM_CODE'))}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                placeholder="XXXX"
                maxLength={6}
                className={`w-full bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-2.5 py-1.5 [@media(max-height:500px)]:py-1 text-center font-black text-sm [@media(max-height:500px)]:text-xs uppercase tracking-widest placeholder:text-[#306230]/50 ${
                  currentItem === 'ROOM_CODE' ? 'ring-2 ring-[#0F380F]' : ''
                }`}
              />
            </div>

            <div className="grid grid-cols-2 [@media(max-height:500px)]:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleJoin}
                disabled={!roomInput.trim()}
                onMouseEnter={() => setFocusIndex(items.indexOf('JOIN_ROOM'))}
                className={`py-2 [@media(max-height:500px)]:py-1.5 px-2 border-2 border-[#0F380F] font-black text-xs [@media(max-height:500px)]:text-[11px] cursor-pointer disabled:opacity-50 transition-colors ${
                  currentItem === 'JOIN_ROOM'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#306230] hover:bg-[#0F380F] text-[#9BBC0F]'
                }`}
              >
                {currentItem === 'JOIN_ROOM' && <span className="animate-pulse mr-1">►</span>}
                JOIN ROOM
              </button>

              <button
                type="button"
                onClick={handleSpectate}
                disabled={!roomInput.trim()}
                onMouseEnter={() => setFocusIndex(items.indexOf('SPECTATE_ROOM'))}
                className={`py-2 [@media(max-height:500px)]:py-1.5 px-2 border-2 border-dashed border-[#0F380F] font-bold text-xs [@media(max-height:500px)]:text-[11px] cursor-pointer disabled:opacity-50 transition-colors ${
                  currentItem === 'SPECTATE_ROOM'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#9BBC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                {currentItem === 'SPECTATE_ROOM' && <span className="animate-pulse mr-1">►</span>}
                👁 SPECTATE
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playMenuSelect();
                  onCreateServerRoom(customOnlineLevel);
                }}
                onMouseEnter={() => setFocusIndex(items.indexOf('SERVER_ROOM'))}
                className={`col-span-2 [@media(max-height:500px)]:col-span-1 py-1.5 px-2 border-2 border-dashed border-[#0F380F] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                  currentItem === 'SERVER_ROOM'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#9BBC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                {currentItem === 'SERVER_ROOM' && <span className="animate-pulse">►</span>}
                <Globe className="w-3.5 h-3.5" />
                <span>DM SERVER</span>
              </button>
            </div>

            {joinError && (
              <div className="text-center text-xs font-bold text-red-700 bg-red-100 border border-red-700 px-2 py-1">
                ⚠️ {joinError}
              </div>
            )}
          </div>

          <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-1 [@media(max-height:500px)]:py-0.5 px-1 flex items-center justify-around shrink-0">
            <span>🎮 [D-PAD] NAVIGATE</span>
            <span>[A / START] SELECT</span>
            <span>[B / ESC] BACK</span>
          </div>
        </div>
      )}

      {/* ============ SETTINGS SUBMENU ============ */}
      {screen === 'SETTINGS' && (
        <div className="flex flex-col h-full justify-between gap-1.5 [@media(max-height:500px)]:gap-1 min-h-0">
          <div className="flex items-center gap-3 border-b-2 border-[#0F380F] pb-1.5 [@media(max-height:500px)]:pb-1 shrink-0">
            <button
              type="button"
              onClick={navigateBack}
              onMouseEnter={() => setFocusIndex(0)}
              className={`flex items-center gap-1 px-2.5 py-1 [@media(max-height:500px)]:py-0.5 border-2 border-[#0F380F] text-xs font-black uppercase cursor-pointer transition-colors ${
                currentItem === 'BACK'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'BACK' && <span className="animate-pulse">►</span>}
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>BACK</span>
            </button>
            <div className="flex items-center gap-1.5 text-base sm:text-lg [@media(max-height:500px)]:text-sm font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
              <Settings className="w-4 h-4" />
              <span>SETTINGS</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 [@media(max-height:500px)]:gap-1 flex-1 justify-between min-h-0">
            {/* Player Name + Toggles: 2x2 grid in short landscape */}
            <div className="grid grid-cols-1 [@media(max-height:500px)]:grid-cols-2 gap-1">
              <div className="bg-[#8BAC0F] px-2 py-1 border-2 border-[#0F380F] flex items-center gap-2">
                {currentItem === 'PLAYER_NAME' && <span className="font-black animate-pulse">►</span>}
                <label className="text-[10px] font-bold uppercase whitespace-nowrap">
                  NAME:
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={displayName}
                  onFocus={() => setFocusIndex(1)}
                  onChange={(e) => onDisplayNameChange(e.target.value.toUpperCase())}
                  placeholder="JIMMY"
                  maxLength={12}
                  className={`flex-1 min-w-0 bg-[#9BBC0F] text-[#0F380F] border-2 border-[#0F380F] px-2 py-0.5 font-black text-xs uppercase placeholder:text-[#306230]/50 ${
                    currentItem === 'PLAYER_NAME' ? 'ring-2 ring-[#0F380F]' : ''
                  }`}
                />
              </div>

              <button
                type="button"
                onClick={() => cycleThinkTime(1)}
                onMouseEnter={() => setFocusIndex(2)}
                className={`flex justify-between items-center border-2 border-[#0F380F] px-2.5 py-1 text-xs font-bold cursor-pointer transition-colors ${
                  currentItem === 'THINK_TIME'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
                }`}
              >
                <span className="flex items-center gap-1">
                  {currentItem === 'THINK_TIME' && <span className="animate-pulse">►</span>}
                  <span>THINK TIME</span>
                </span>
                <span className="font-black">&larr; {thinkTimeLabel} &rarr;</span>
              </button>

              <button
                type="button"
                onClick={() => cycleGridSize(1)}
                onMouseEnter={() => setFocusIndex(3)}
                className={`flex justify-between items-center border-2 border-[#0F380F] px-2.5 py-1 text-xs font-bold cursor-pointer transition-colors ${
                  currentItem === 'GRID_SIZE'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
                }`}
              >
                <span className="flex items-center gap-1">
                  {currentItem === 'GRID_SIZE' && <span className="animate-pulse">►</span>}
                  <span>GRID SIZE</span>
                </span>
                <span className="font-black">
                  &larr; {settings.gridSize}&times;{settings.gridSize} &rarr;
                </span>
              </button>

              <button
                type="button"
                onClick={toggleSound}
                onMouseEnter={() => setFocusIndex(4)}
                className={`flex justify-between items-center border-2 border-[#0F380F] px-2.5 py-1 text-xs font-bold cursor-pointer transition-colors ${
                  currentItem === 'SOUND'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] text-[#0F380F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
                }`}
              >
                <span className="flex items-center gap-1">
                  {currentItem === 'SOUND' && <span className="animate-pulse">►</span>}
                  <span>SOUND</span>
                </span>
                <span className="font-black">
                  &larr; {settings.soundEnabled ? 'ON' : 'OFF'} &rarr;
                </span>
              </button>
            </div>

            {/* Rules & Controls Briefing */}
            <div className="bg-[#9BBC0F] p-2 [@media(max-height:500px)]:p-1.5 border-2 border-[#0F380F] text-[10px] [@media(max-height:500px)]:text-[9px] leading-snug">
              <div className="font-bold border-b border-[#0F380F] pb-0.5 mb-0.5">RULES &amp; CONTROLS BRIEFING:</div>
              <div>
                Both players plan moves in secret, then the board steps simultaneously. Grab tokens to grow ({settings.raceTurns} turns), then survive the shrinking ring (closes every {settings.shrinkEveryTurns} turns). Last snake slithering wins.
              </div>
              <div className="mt-0.5 pt-0.5 border-t border-[#0F380F]/40 font-bold text-[#306230] flex flex-col gap-0.5">
                <div>📱 TOUCH / IPHONE: SWIPE OR TAP THE BOARD TO QUEUE MOVES • TAP LOCK / UNDO</div>
                <div>🎮 KEYBOARD / GAMEPAD: D-PAD / ARROWS • A / ENTER: SELECT • B / ESC: BACK</div>
              </div>
            </div>

            {importError && (
              <div className="bg-[#0F380F] text-[#9BBC0F] p-1 border-2 border-[#0F380F] text-[10px] font-bold text-center">
                ⚠️ {importError}
              </div>
            )}

            {/* Replay, Full Settings & Net Harness */}
            <div className="grid grid-cols-2 [@media(max-height:500px)]:grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playMenuSelect();
                  fileInputRef.current?.click();
                }}
                onMouseEnter={() => setFocusIndex(5)}
                className={`py-1.5 [@media(max-height:500px)]:py-1 px-2 border-2 border-[#0F380F] font-bold text-xs [@media(max-height:500px)]:text-[11px] cursor-pointer text-center transition-colors ${
                  currentItem === 'IMPORT_REPLAY'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                {currentItem === 'IMPORT_REPLAY' && <span className="animate-pulse mr-1">►</span>}
                IMPORT REPLAY 📂
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playMenuSelect();
                  onOpenSettings();
                }}
                onMouseEnter={() => setFocusIndex(6)}
                className={`py-1.5 [@media(max-height:500px)]:py-1 px-2 border-2 border-[#0F380F] font-bold text-xs [@media(max-height:500px)]:text-[11px] cursor-pointer text-center transition-colors ${
                  currentItem === 'MORE_OPTIONS'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                {currentItem === 'MORE_OPTIONS' && <span className="animate-pulse mr-1">►</span>}
                ALL OPTIONS ⚙️
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playMenuSelect();
                  onOpenLatencyHarness();
                }}
                onMouseEnter={() => setFocusIndex(7)}
                className={`col-span-2 [@media(max-height:500px)]:col-span-1 py-1.5 [@media(max-height:500px)]:py-1 px-2 border-2 border-[#0F380F] font-bold text-xs [@media(max-height:500px)]:text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  currentItem === 'NET_HARNESS'
                    ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                    : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F]'
                }`}
              >
                {currentItem === 'NET_HARNESS' && <span className="animate-pulse">►</span>}
                <Gamepad className="w-3.5 h-3.5" />
                <span>NET HARNESS</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
