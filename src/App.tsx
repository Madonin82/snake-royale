import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Direction, GameSettings, GameState, LatencyReport, PlayMode } from './types/game';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  processGameTick,
  queueSnakeDirection,
} from './game/engine';
import { calculateAIMove } from './game/ai';
import { gamepadController } from './game/gamepad';
import { networkManager } from './game/network';
import { soundEngine } from './audio/soundEngine';
import { GameBoard } from './components/GameBoard';
import { Hud } from './components/Hud';
import { LobbyView } from './components/LobbyView';
import { OnlineRoomLobby } from './components/OnlineRoomLobby';
import { LatencyHarnessModal } from './components/LatencyHarnessModal';
import { SettingsModal } from './components/SettingsModal';
import { MatchEndModal } from './components/MatchEndModal';
import { ControlsOverlay } from './components/ControlsOverlay';
import { GameBoyShell } from './components/GameBoyShell';
import { ArrowLeft, Gamepad, RefreshCw, Volume2, VolumeX } from 'lucide-react';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [playMode, setPlayMode] = useState<PlayMode>('SOLO_AI');
  const [inLobby, setInLobby] = useState<boolean>(true);
  const [inOnlineLobby, setInOnlineLobby] = useState<boolean>(false);
  const [onlineRoomId, setOnlineRoomId] = useState<string>('');
  const [onlineRole, setOnlineRole] = useState<'p1' | 'p2' | 'spectator' | null>(null);
  const [hasP1, setHasP1] = useState<boolean>(false);
  const [hasP2, setHasP2] = useState<boolean>(false);
  const [spectatorsCount, setSpectatorsCount] = useState<number>(0);

  const [gameState, setGameState] = useState<GameState>(() => createInitialState(DEFAULT_SETTINGS));
  const [latencyModalOpen, setLatencyModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [latencyReport, setLatencyReport] = useState<LatencyReport>(() => networkManager.getLatencyReport());
  const [gamepadCount, setGamepadCount] = useState<number>(0);

  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  const settingsRef = useRef<GameSettings>(settings);
  settingsRef.current = settings;

  const playModeRef = useRef<PlayMode>(playMode);
  playModeRef.current = playMode;

  const onlineRoleRef = useRef<'p1' | 'p2' | 'spectator' | null>(onlineRole);
  onlineRoleRef.current = onlineRole;

  // Handle Input routing
  const handleDirectionInput = useCallback((playerSlot: 1 | 2, dir: Direction) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;

    soundEngine.playTick();

    if (playModeRef.current === 'ONLINE_JOIN') {
      // Client (P2) sending input to Host
      networkManager.sendInput(dir, current.tick);
      // Optimistic local queued direction for instant responsive render
      const p2 = { ...current.snakes.p2 };
      queueSnakeDirection(p2, dir);
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, p2 }
      }));
      return;
    }

    if (playerSlot === 1) {
      queueSnakeDirection(stateRef.current.snakes.p1, dir);
      const p1 = { ...current.snakes.p1 };
      queueSnakeDirection(p1, dir);
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, p1 }
      }));
    } else if (playerSlot === 2 && playModeRef.current === 'LOCAL_2P') {
      queueSnakeDirection(stateRef.current.snakes.p2, dir);
      const p2 = { ...current.snakes.p2 };
      queueSnakeDirection(p2, dir);
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, p2 }
      }));
    }
  }, [inLobby, inOnlineLobby]);

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Player 1 controls (WASD & Arrow Keys if in solo/online)
      switch (e.code) {
        case 'KeyW':
          handleDirectionInput(1, 'UP');
          break;
        case 'KeyS':
          handleDirectionInput(1, 'DOWN');
          break;
        case 'KeyA':
          handleDirectionInput(1, 'LEFT');
          break;
        case 'KeyD':
          handleDirectionInput(1, 'RIGHT');
          break;

        // Player 2 controls in Local 2P (IJKL & Arrows)
        case 'KeyI':
          handleDirectionInput(2, 'UP');
          break;
        case 'KeyK':
          handleDirectionInput(2, 'DOWN');
          break;
        case 'KeyJ':
          handleDirectionInput(2, 'LEFT');
          break;
        case 'KeyL':
          handleDirectionInput(2, 'RIGHT');
          break;

        case 'ArrowUp':
          if (playModeRef.current === 'LOCAL_2P') handleDirectionInput(2, 'UP');
          else handleDirectionInput(1, 'UP');
          break;
        case 'ArrowDown':
          if (playModeRef.current === 'LOCAL_2P') handleDirectionInput(2, 'DOWN');
          else handleDirectionInput(1, 'DOWN');
          break;
        case 'ArrowLeft':
          if (playModeRef.current === 'LOCAL_2P') handleDirectionInput(2, 'LEFT');
          else handleDirectionInput(1, 'LEFT');
          break;
        case 'ArrowRight':
          if (playModeRef.current === 'LOCAL_2P') handleDirectionInput(2, 'RIGHT');
          else handleDirectionInput(1, 'RIGHT');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDirectionInput]);

  // Gamepad controller listener
  useEffect(() => {
    gamepadController.setCallback((slot, dir) => {
      handleDirectionInput(slot, dir);
    });

    const checkPads = setInterval(() => {
      const pads = gamepadController.getConnectedGamepads();
      setGamepadCount(pads.length);
    }, 1000);

    return () => {
      clearInterval(checkPads);
      gamepadController.cleanup();
    };
  }, [handleDirectionInput]);

  // Network message handling
  useEffect(() => {
    const unsubscribe = networkManager.addMessageHandler((msg) => {
      switch (msg.type) {
        case 'ROOM_JOINED': {
          setOnlineRole(msg.role);
          setHasP1(msg.hasP1);
          setHasP2(msg.hasP2);
          setSpectatorsCount(msg.spectatorsCount || 0);
          break;
        }

        case 'ROOM_MEMBERS_CHANGED': {
          setHasP1(msg.hasP1);
          setHasP2(msg.hasP2);
          setSpectatorsCount(msg.spectatorsCount || 0);
          break;
        }

        case 'STATE_SYNC': {
          // Client received authoritative state from Host
          if (playModeRef.current === 'ONLINE_JOIN' && msg.state) {
            setGameState(msg.state);
            if (inOnlineLobby) {
              setInOnlineLobby(false);
              setInLobby(false);
            }
          }
          break;
        }

        case 'INPUT_SYNC': {
          // Host received input from P2
          if (playModeRef.current === 'ONLINE_HOST' && msg.role === 'p2' && msg.dir) {
            const current = stateRef.current;
            networkManager.recordTickLag(msg.tick, current.tick);
            queueSnakeDirection(current.snakes.p2, msg.dir);
            const p2 = { ...current.snakes.p2 };
            queueSnakeDirection(p2, msg.dir);
            setGameState(prev => ({
              ...prev,
              snakes: { ...prev.snakes, p2 }
            }));
          }
          break;
        }

        case 'RESTART_MATCH': {
          startNewMatch();
          break;
        }
      }

      setLatencyReport(networkManager.getLatencyReport());
    });

    return () => {
      unsubscribe();
    };
  }, [inOnlineLobby]);

  // Latency Report Polling
  useEffect(() => {
    const interval = setInterval(() => {
      setLatencyReport(networkManager.getLatencyReport());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Main Simulation Loop (Runs on Host / Local)
  useEffect(() => {
    if (inLobby || inOnlineLobby) return;
    if (playMode === 'ONLINE_JOIN') return; // Client only listens to state updates

    const tickIntervalMs = 1000 / settings.tickRate;

    const intervalId = setInterval(() => {
      const current = stateRef.current;
      if (current.phase === 'OVER') return;

      // If Solo AI mode, compute AI move for Player 2
      if (playModeRef.current === 'SOLO_AI') {
        const aiDir = calculateAIMove(
          current,
          settingsRef.current.gridSize,
          'p2',
          settingsRef.current.botDifficulty
        );
        if (aiDir) {
          queueSnakeDirection(current.snakes.p2, aiDir);
        }
      }

      // Process Game Tick
      const { nextState, events } = processGameTick(current, settingsRef.current, tickIntervalMs);

      // Play sound effects for events
      if (events.tokenEatenP1 || events.tokenEatenP2) {
        soundEngine.playTokenEat();
      }
      if (events.shrinkTelegraphStarted) {
        soundEngine.playShrinkWarning();
      }
      if (events.ringShrunk) {
        soundEngine.playRingShrunk();
      }
      if (events.deathOccurred) {
        soundEngine.playCrash();
      }
      if (events.matchEnded) {
        soundEngine.playVictory();
      }

      setGameState(nextState);

      // If online host, broadcast state to connected client
      if (playModeRef.current === 'ONLINE_HOST') {
        networkManager.broadcastState(nextState);
      }
    }, tickIntervalMs);

    return () => clearInterval(intervalId);
  }, [inLobby, inOnlineLobby, playMode, settings.tickRate]);

  // Start match helper
  const startNewMatch = () => {
    const initial = createInitialState(settings);
    setGameState(initial);
    setInLobby(false);
    setInOnlineLobby(false);

    soundEngine.playCountdown(true);

    if (playMode === 'ONLINE_HOST') {
      networkManager.broadcastState(initial);
    }
  };

  // Solo Start
  const handleStartSolo = (diff: 'EASY' | 'MEDIUM' | 'HARD') => {
    setSettings(prev => ({ ...prev, botDifficulty: diff }));
    setPlayMode('SOLO_AI');
    startNewMatch();
  };

  // Local 2P Start
  const handleStartLocal2P = () => {
    setPlayMode('LOCAL_2P');
    startNewMatch();
  };

  // Create Online Room
  const handleCreateOnlineRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_HOST');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'p1');
    setOnlineRole('p1');
  };

  // Join Online Room
  const handleJoinOnlineRoom = async (code: string) => {
    const roomCode = code.toUpperCase().trim();
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_JOIN');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(roomCode, 'p2');
    setOnlineRole('p2');
  };

  const handleLeaveRoom = () => {
    networkManager.disconnect();
    setInOnlineLobby(false);
    setInLobby(true);
  };

  const handleRematch = () => {
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN') {
      networkManager.requestRematch();
    }
    startNewMatch();
  };

  const handleReturnToLobby = () => {
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN') {
      networkManager.disconnect();
    }
    setGameState(createInitialState(settingsRef.current));
    setInLobby(true);
    setInOnlineLobby(false);
  };

  return (
    <main className={`min-h-screen flex flex-col items-center justify-between p-2 sm:p-4 ${settings.crtFilterEnabled ? 'crt-overlay' : ''}`}>
      {/* Top Header Navbar */}
      <header className="w-full max-w-[500px] flex items-center justify-between py-1 px-2 border-b-2 border-[#0F380F] text-xs font-mono font-bold">
        <div className="flex items-center gap-2">
          {!inLobby && (
            <button
              onClick={handleReturnToLobby}
              className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>LOBBY</span>
            </button>
          )}
          <span className="tracking-wider">SNAKE ROYALE v1.0</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const next = !settings.soundEnabled;
              soundEngine.setEnabled(next);
              setSettings(s => ({ ...s, soundEnabled: next }));
            }}
            className="p-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] border border-[#0F380F] cursor-pointer"
            title="Toggle Sound"
          >
            {settings.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Main Container / Handheld frame */}
      <div className="flex-1 flex flex-col items-center justify-center w-full my-2">
        <GameBoyShell
          enabled={settings.gameBoyFrameEnabled}
          onDirectionInput={(dir) => handleDirectionInput(1, dir)}
        >
          {inLobby ? (
            <LobbyView
              onStartSolo={handleStartSolo}
              onStartLocal2P={handleStartLocal2P}
              onCreateOnlineRoom={handleCreateOnlineRoom}
              onJoinOnlineRoom={handleJoinOnlineRoom}
              onOpenSettings={() => setSettingsModalOpen(true)}
              onOpenLatencyHarness={() => setLatencyModalOpen(true)}
              gamepadCount={gamepadCount}
              settings={settings}
            />
          ) : inOnlineLobby ? (
            <OnlineRoomLobby
              roomId={onlineRoomId}
              role={onlineRole}
              hasP1={hasP1}
              hasP2={hasP2}
              spectatorsCount={spectatorsCount}
              onStartMatch={startNewMatch}
              onLeaveRoom={handleLeaveRoom}
              onOpenLatencyHarness={() => setLatencyModalOpen(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Hud
                gameState={gameState}
                playMode={playMode}
                latencyReport={latencyReport}
                onOpenLatencyHarness={() => setLatencyModalOpen(true)}
                onOpenSettings={() => setSettingsModalOpen(true)}
                gamepadCount={gamepadCount}
              />
              <GameBoard gameState={gameState} settings={settings} />
              <ControlsOverlay onDirection={(dir) => handleDirectionInput(1, dir)} />
            </div>
          )}
        </GameBoyShell>
      </div>

      {/* Footer info */}
      <footer className="text-center text-[10px] font-mono opacity-80 py-1">
        Game Boy 4-shade palette • {settings.gridSize}×{settings.gridSize} grid • Host-authoritative {settings.tickRate} TPS • Gamepad API ready
      </footer>

      {/* Modals */}
      <LatencyHarnessModal
        isOpen={latencyModalOpen}
        onClose={() => setLatencyModalOpen(false)}
        report={latencyReport}
        isConnected={networkManager.getIsConnected()}
        roomId={onlineRoomId}
        role={onlineRole}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings(s => ({ ...s, ...newVals }))}
      />

      {!inLobby && !inOnlineLobby && (
        <MatchEndModal
          gameState={gameState}
          playMode={playMode}
          onRematch={handleRematch}
          onReturnToLobby={handleReturnToLobby}
        />
      )}
    </main>
  );
};

export default App;
