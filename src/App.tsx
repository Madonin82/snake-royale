import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Direction, GameSettings, GameState, LatencyReport, PlayMode } from './types/game';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  isOppositeDirection,
  processGameTick,
  queueSnakeDirection,
} from './game/engine';
import { calculateAIMove } from './game/ai';
import { gamepadController, GamepadMenuAction } from './game/gamepad';
import { networkManager } from './game/network';
import { normalizeGameState } from './game/normalize';
import { soundEngine } from './audio/soundEngine';
import { GameBoard } from './components/GameBoard';
import { Hud } from './components/Hud';
import { LobbyView } from './components/LobbyView';
import { OnlineRoomLobby } from './components/OnlineRoomLobby';
import { LatencyHarnessModal } from './components/LatencyHarnessModal';
import { SettingsModal } from './components/SettingsModal';
import { MatchEndModal } from './components/MatchEndModal';
import { ControlsOverlay } from './components/ControlsOverlay';
import { ReplayControls } from './components/ReplayControls';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [playMode, setPlayMode] = useState<PlayMode>('SOLO_AI');
  const [inLobby, setInLobby] = useState<boolean>(true);
  const [inOnlineLobby, setInOnlineLobby] = useState<boolean>(false);
  const [onlineRoomId, setOnlineRoomId] = useState<string>('');
  const [onlineRole, setOnlineRole] = useState<'p1' | 'p2' | 'spectator' | 'server' | null>(null);
  const [hasP1, setHasP1] = useState<boolean>(false);
  const [hasP2, setHasP2] = useState<boolean>(false);
  const [spectatorsCount, setSpectatorsCount] = useState<number>(0);

  const [gameState, setGameState] = useState<GameState>(() => createInitialState(DEFAULT_SETTINGS));
  const [latencyModalOpen, setLatencyModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [latencyReport, setLatencyReport] = useState<LatencyReport>(() => networkManager.getLatencyReport());
  const [gamepadCount, setGamepadCount] = useState<number>(0);
  const [isNintendoController, setIsNintendoController] = useState<boolean>(false);

  // Optional display name + room seat names + series score
  const [displayName, setDisplayName] = useState<string>(() => {
    try { return localStorage.getItem('snake-royale-name') || ''; } catch { return ''; }
  });
  const [playerNames, setPlayerNames] = useState<{ p1: string; p2: string }>({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
  const playerNamesRef = useRef(playerNames);
  playerNamesRef.current = playerNames;
  const [series, setSeries] = useState<{ p1: number; p2: number; draws: number }>({ p1: 0, p2: 0, draws: 0 });
  const seriesCountedRef = useRef<boolean>(false);

  // MATCH REPLAY: recorded states
  const [matchHistory, setMatchHistory] = useState<GameState[]>([]);
  const [replayActive, setReplayActive] = useState<boolean>(false);
  const [replayIdx, setReplayIdx] = useState<number>(0);
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(5);

  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value);
    try { localStorage.setItem('snake-royale-name', value); } catch { /* private mode */ }
  }, []);

  // Replay playback driver
  useEffect(() => {
    if (!replayActive || !replayPlaying) return;
    const id = setInterval(() => {
      setReplayIdx(prev => {
        if (prev >= matchHistory.length - 1) {
          setReplayPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000 / replaySpeed);
    return () => clearInterval(id);
  }, [replayActive, replayPlaying, replaySpeed, matchHistory.length]);

  const displayState = replayActive ? (matchHistory[replayIdx] ?? gameState) : gameState;

  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  const settingsRef = useRef<GameSettings>(settings);
  settingsRef.current = settings;

  const playModeRef = useRef<PlayMode>(playMode);
  playModeRef.current = playMode;

  const onlineRoleRef = useRef<'p1' | 'p2' | 'spectator' | 'server' | null>(onlineRole);
  onlineRoleRef.current = onlineRole;

  // Active menu handler ref for zero-re-render gamepad/keyboard dispatch
  const activeHandlerRef = useRef<((action: GamepadMenuAction) => void) | null>(null);

  // TURN-BASED MOVE LOCKS
  const locksRef = useRef<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const [locks, setLocks] = useState<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const sentTickRef = useRef<number>(-1);

  // TURN CLOCK
  interface TurnClock { startedAt: number; p1At: number | null; p2At: number | null }
  const turnClockRef = useRef<TurnClock>({ startedAt: Date.now(), p1At: null, p2At: null });
  const [turnClock, setTurnClock] = useState<TurnClock>(turnClockRef.current);

  const stampLockTime = useCallback((who: 'p1' | 'p2', atMs?: number) => {
    const key = who === 'p1' ? 'p1At' : 'p2At';
    if (turnClockRef.current[key] === null) {
      turnClockRef.current = { ...turnClockRef.current, [key]: atMs ?? Date.now() };
      setTurnClock(turnClockRef.current);
    }
  }, []);

  const resetTurnClock = useCallback(() => {
    turnClockRef.current = { startedAt: Date.now(), p1At: null, p2At: null };
    setTurnClock(turnClockRef.current);
  }, []);

  const setLock = useCallback((who: 'p1' | 'p2') => {
    locksRef.current = { ...locksRef.current, [who]: true };
    setLocks(locksRef.current);
    stampLockTime(who);
  }, [stampLockTime]);

  const clearLocks = useCallback(() => {
    locksRef.current = { p1: false, p2: false };
    setLocks(locksRef.current);
    resetTurnClock();
  }, [resetTurnClock]);

  const playTickEvents = useCallback((events: {
    tokenEatenP1: boolean;
    tokenEatenP2: boolean;
    shrinkTelegraphStarted: boolean;
    ringShrunk: boolean;
    deathOccurred: boolean;
    matchEnded: boolean;
  }) => {
    if (events.tokenEatenP1 || events.tokenEatenP2) soundEngine.playTokenEat();
    if (events.shrinkTelegraphStarted) soundEngine.playShrinkWarning();
    if (events.ringShrunk) soundEngine.playRingShrunk();
    if (events.deathOccurred) soundEngine.playCrash();
    if (events.matchEnded) soundEngine.playVictory();
  }, []);

  const maybeAdvanceTurn = useCallback(() => {
    const current = stateRef.current;
    const s = settingsRef.current;
    if (!s.turnBased || current.phase === 'OVER') return;

    if (playModeRef.current === 'SOLO_AI' && !locksRef.current.p2) {
      const aiDir = calculateAIMove(current, s.gridSize, 'p2', s.botDifficulty);
      if (aiDir) queueSnakeDirection(current.snakes.p2, aiDir);
      locksRef.current = { ...locksRef.current, p2: true };
      setLocks(locksRef.current);
      stampLockTime('p2', turnClockRef.current.startedAt);
    }

    if (!locksRef.current.p1 || !locksRef.current.p2) return;

    const now = Date.now();
    const clock = turnClockRef.current;
    const secs = (at: number | null) => parseFloat((((at ?? now) - clock.startedAt) / 1000).toFixed(1));

    const { nextState, events } = processGameTick(stateRef.current, s, 0);
    const turnTimes = { p1: secs(clock.p1At), p2: secs(clock.p2At) };
    nextState.lastTurnTimes = turnTimes;
    nextState.totalThinkTime = {
      p1: parseFloat((stateRef.current.totalThinkTime.p1 + turnTimes.p1).toFixed(1)),
      p2: parseFloat((stateRef.current.totalThinkTime.p2 + turnTimes.p2).toFixed(1)),
    };
    playTickEvents(events);
    setGameState(nextState);
    setMatchHistory(prev => [...prev, nextState]);

    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
      networkManager.broadcastState(nextState);
    }
    clearLocks();
  }, [clearLocks, playTickEvents, stampLockTime]);

  const handleDirectionInput = useCallback((playerSlot: 1 | 2, dir: Direction) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;
    if (playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') return;

    let targetKey: 'p1' | 'p2';
    if (playModeRef.current === 'SOLO_AI') {
      targetKey = 'p1';
    } else if (playModeRef.current === 'ONLINE_HOST') {
      targetKey = 'p1';
    } else if (playModeRef.current === 'ONLINE_JOIN') {
      targetKey = onlineRoleRef.current === 'p1' ? 'p1' : 'p2';
    } else if (playModeRef.current === 'LOCAL_2P') {
      targetKey = playerSlot === 2 ? 'p2' : 'p1';
    } else {
      targetKey = 'p1';
    }

    const currentSnake = current.snakes[targetKey];
    if (!currentSnake || !currentSnake.isAlive) return;

    const effectiveDir = currentSnake.queuedDirection || currentSnake.direction;
    if (isOppositeDirection(effectiveDir, dir)) {
      return;
    }

    soundEngine.playTick();

    if (settingsRef.current.turnBased) {
      if (playModeRef.current === 'ONLINE_JOIN') {
        if (sentTickRef.current === current.tick) return;
        sentTickRef.current = current.tick;
        networkManager.sendInput(dir, current.tick);
        setLock(targetKey);
        return;
      }

      if (locksRef.current[targetKey]) return;

      queueSnakeDirection(stateRef.current.snakes[targetKey], dir);
      const snakeCopy = { ...current.snakes[targetKey], queuedDirection: dir };
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, [targetKey]: snakeCopy }
      }));
      setLock(targetKey);
      maybeAdvanceTurn();
      return;
    }

    if (playModeRef.current === 'ONLINE_JOIN') {
      networkManager.sendInput(dir, current.tick);
      const snakeCopy = { ...current.snakes[targetKey], queuedDirection: dir };
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, [targetKey]: snakeCopy }
      }));
      return;
    }

    queueSnakeDirection(stateRef.current.snakes[targetKey], dir);
    const snakeCopy = { ...current.snakes[targetKey], queuedDirection: dir };
    setGameState(prev => ({
      ...prev,
      snakes: { ...prev.snakes, [targetKey]: snakeCopy }
    }));
  }, [inLobby, inOnlineLobby, maybeAdvanceTurn, setLock]);

  const handleReturnToLobby = useCallback(() => {
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') {
      networkManager.disconnect();
      setSeries({ p1: 0, p2: 0, draws: 0 });
      setPlayerNames({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
    }
    setGameState(createInitialState(settingsRef.current));
    setInLobby(true);
    setInOnlineLobby(false);
    setReplayActive(false);
    setSettingsModalOpen(false);
    setLatencyModalOpen(false);
  }, []);

  const handleMenuAction = useCallback((action: GamepadMenuAction, _slot: 1 | 2) => {
    if (activeHandlerRef.current) {
      activeHandlerRef.current(action);
    }
  }, []);

  // Gamepad controller listener setup (run once)
  useEffect(() => {
    gamepadController.setCallback((slot, dir) => {
      handleDirectionInput(slot, dir);
    });

    gamepadController.setMenuCallback((action, slot) => {
      handleMenuAction(action, slot);
    });

    setGamepadCount(gamepadController.getConnectedGamepads().length);
    setIsNintendoController(gamepadController.isNintendoSwitchController());

    const checkPads = setInterval(() => {
      const pads = gamepadController.getConnectedGamepads();
      setGamepadCount(pads.length);
      setIsNintendoController(gamepadController.isNintendoSwitchController());
    }, 500);

    return () => {
      clearInterval(checkPads);
      gamepadController.cleanup();
    };
  }, [handleDirectionInput, handleMenuAction]);

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

      const isInMenuOrModal =
        inLobby ||
        inOnlineLobby ||
        settingsModalOpen ||
        latencyModalOpen ||
        gameState.phase === 'OVER' ||
        replayActive;

      if (isInMenuOrModal) {
        if (e.key === 'Escape') {
          handleMenuAction('CANCEL', 1);
          return;
        }

        if (isInputFocused) {
          if (e.key === 'Enter') {
            handleMenuAction('CONFIRM', 1);
          }
          return;
        }

        switch (e.key) {
          case 'ArrowUp':
          case 'KeyW':
          case 'w':
          case 'W':
            handleMenuAction('UP', 1);
            e.preventDefault();
            break;
          case 'ArrowDown':
          case 'KeyS':
          case 's':
          case 'S':
            handleMenuAction('DOWN', 1);
            e.preventDefault();
            break;
          case 'ArrowLeft':
          case 'KeyA':
          case 'a':
          case 'A':
            handleMenuAction('LEFT', 1);
            e.preventDefault();
            break;
          case 'ArrowRight':
          case 'KeyD':
          case 'd':
          case 'D':
            handleMenuAction('RIGHT', 1);
            e.preventDefault();
            break;
          case 'Enter':
          case ' ':
            handleMenuAction('CONFIRM', 1);
            e.preventDefault();
            break;
          case 'Tab':
            handleMenuAction(e.shiftKey ? 'PREV_TAB' : 'NEXT_TAB', 1);
            e.preventDefault();
            break;
        }
        return;
      }

      // In-Game snake controls
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
  }, [
    handleDirectionInput,
    handleMenuAction,
    inLobby,
    inOnlineLobby,
    settingsModalOpen,
    latencyModalOpen,
    gameState.phase,
    replayActive,
  ]);

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
          if ('p1Name' in msg || 'p2Name' in msg) {
            setPlayerNames({
              p1: msg.p1Name || 'PLAYER 1',
              p2: msg.p2Name || 'PLAYER 2',
            });
          }
          if (msg.series) setSeries(msg.series);
          break;
        }

        case 'STATE_SYNC': {
          if ((playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SPECTATOR') && msg.state) {
            // Wire states (RTDB / WebRTC) can arrive with array fields
            // dropped or object-shaped; normalize before anything reads them.
            const safeState = normalizeGameState(msg.state);
            setGameState(safeState);
            setMatchHistory(prev =>
              prev.length === 0 || safeState.tick > prev[prev.length - 1].tick
                ? [...prev, safeState]
                : prev
            );
            if (settingsRef.current.turnBased) clearLocks();
            if (inOnlineLobby) {
              setInOnlineLobby(false);
              setInLobby(false);
            }
          }
          break;
        }

        case 'INPUT_SYNC': {
          const isAuthority =
            (playModeRef.current === 'ONLINE_HOST' && msg.role === 'p2') ||
            (playModeRef.current === 'ONLINE_SERVER' && (msg.role === 'p1' || msg.role === 'p2'));
          if (isAuthority && msg.dir) {
            const current = stateRef.current;
            networkManager.recordTickLag(msg.tick, current.tick);
            const key = msg.role === 'p1' ? 'p1' : 'p2';
            queueSnakeDirection(current.snakes[key], msg.dir);
            const snakeCopy = { ...current.snakes[key] };
            queueSnakeDirection(snakeCopy, msg.dir);
            setGameState(prev => ({
              ...prev,
              snakes: { ...prev.snakes, [key]: snakeCopy }
            }));
            if (settingsRef.current.turnBased) {
              setLock(key);
              maybeAdvanceTurn();
            }
          }
          break;
        }

        case 'SPECTATORS_CHANGED': {
          setSpectatorsCount(msg.count || 0);
          break;
        }

        case 'RESTART_MATCH': {
          if (playModeRef.current === 'ONLINE_SPECTATOR') {
            setMatchHistory([]);
            setReplayActive(false);
            setReplayIdx(0);
            setReplayPlaying(false);
          } else {
            startNewMatch();
          }
          break;
        }
      }

      setLatencyReport(networkManager.getLatencyReport());
    });

    return () => {
      unsubscribe();
    };
  }, [inOnlineLobby, clearLocks, maybeAdvanceTurn, setLock]);

  // Latency Report Polling
  useEffect(() => {
    const interval = setInterval(() => {
      setLatencyReport(networkManager.getLatencyReport());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Agent JSON State Blob synchronization (window.__SNAKE_ROYALE_STATE & <script id="snake-state">)
  useEffect(() => {
    const agentState = {
      turn: gameState.tick,
      phase: gameState.phase,
      round: gameState.round,
      gridSize: settings.gridSize,
      snakes: {
        p1: {
          head: gameState.snakes.p1.body[0] || { x: 0, y: 0 },
          body: gameState.snakes.p1.body,
          facing: gameState.snakes.p1.direction,
          score: gameState.snakes.p1.score,
          length: gameState.snakes.p1.body.length,
          locked: locks.p1,
          isAlive: gameState.snakes.p1.isAlive,
        },
        p2: {
          head: gameState.snakes.p2.body[0] || { x: 0, y: 0 },
          body: gameState.snakes.p2.body,
          facing: gameState.snakes.p2.direction,
          score: gameState.snakes.p2.score,
          length: gameState.snakes.p2.body.length,
          locked: locks.p2,
          isAlive: gameState.snakes.p2.isAlive,
        }
      },
      tokens: gameState.tokens,
      ringInset: gameState.ringInset,
      gameOver: gameState.phase === 'OVER',
      winner: gameState.winner,
      turnLocks: locks,
    };

    (window as any).__SNAKE_ROYALE_STATE = agentState;
    const scriptEl = document.getElementById('snake-state');
    if (scriptEl) {
      scriptEl.textContent = JSON.stringify(agentState, null, 2);
    }
  }, [gameState, locks, settings.gridSize]);

  // Main Simulation Loop for Real-time mode
  useEffect(() => {
    if (inLobby || inOnlineLobby) return;
    if (playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SPECTATOR') return;
    if (settings.turnBased) return;

    const tickIntervalMs = 1000 / settings.tickRate;

    const intervalId = setInterval(() => {
      const current = stateRef.current;
      if (current.phase === 'OVER') return;

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

      const { nextState, events } = processGameTick(current, settingsRef.current, tickIntervalMs);

      if (events.tokenEatenP1 || events.tokenEatenP2) soundEngine.playTokenEat();
      if (events.shrinkTelegraphStarted) soundEngine.playShrinkWarning();
      if (events.ringShrunk) soundEngine.playRingShrunk();
      if (events.deathOccurred) soundEngine.playCrash();
      if (events.matchEnded) soundEngine.playVictory();

      setGameState(nextState);
      setMatchHistory(prev => [...prev, nextState]);

      if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
        networkManager.broadcastState(nextState);
      }
    }, tickIntervalMs);

    return () => clearInterval(intervalId);
  }, [inLobby, inOnlineLobby, playMode, settings.tickRate, settings.turnBased]);

  // Series scorebook
  useEffect(() => {
    if (gameState.phase !== 'OVER' || seriesCountedRef.current) return;
    if (playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SPECTATOR') return;
    if (!gameState.winner) return;
    seriesCountedRef.current = true;
    const w = gameState.winner;
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') {
      networkManager.recordSeriesResult(w);
    } else {
      setSeries(prev => ({
        p1: prev.p1 + (w === 'p1' ? 1 : 0),
        p2: prev.p2 + (w === 'p2' ? 1 : 0),
        draws: prev.draws + (w === 'DRAW' ? 1 : 0),
      }));
    }
  }, [gameState.phase, gameState.winner, playMode]);

  const startNewMatch = () => {
    const me = displayName.trim();
    let matchNames = { p1: 'PLAYER 1', p2: 'PLAYER 2' };
    if (playMode === 'SOLO_AI') {
      matchNames = { p1: me || 'PLAYER 1', p2: 'BOT' };
    } else if (playMode === 'LOCAL_2P') {
      matchNames = { p1: me || 'PLAYER 1', p2: 'PLAYER 2' };
    } else if (playMode === 'ONLINE_HOST') {
      matchNames = { p1: me || 'PLAYER 1', p2: playerNamesRef.current.p2 || 'PLAYER 2' };
    } else if (playMode === 'ONLINE_SERVER') {
      matchNames = { p1: playerNamesRef.current.p1 || 'PLAYER 1', p2: playerNamesRef.current.p2 || 'PLAYER 2' };
    } else if (playMode === 'ONLINE_JOIN') {
      matchNames = onlineRoleRef.current === 'p1'
        ? { p1: me || 'PLAYER 1', p2: playerNamesRef.current.p2 || 'PLAYER 2' }
        : { p1: playerNamesRef.current.p1 || 'PLAYER 1', p2: me || 'PLAYER 2' };
    }
    const initial = createInitialState(settings, matchNames);
    seriesCountedRef.current = false;
    setMatchHistory([initial]);
    setReplayActive(false);
    setReplayIdx(0);
    setReplayPlaying(false);
    setGameState(initial);
    clearLocks();
    sentTickRef.current = -1;
    setInLobby(false);
    setInOnlineLobby(false);

    soundEngine.playCountdown(true);

    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') {
      networkManager.broadcastState(initial);
    }
  };

  const handleStartSolo = (diff: 'EASY' | 'MEDIUM' | 'HARD') => {
    setSettings(prev => ({ ...prev, botDifficulty: diff }));
    setPlayMode('SOLO_AI');
    startNewMatch();
  };

  const handleStartLocal2P = () => {
    setPlayMode('LOCAL_2P');
    startNewMatch();
  };

  const handleCreateOnlineRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_HOST');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'p1', displayName.trim() || undefined);
    setOnlineRole('p1');
  };

  const handleCreateServerRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_SERVER');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'server', displayName.trim() || undefined);
    setOnlineRole('server');
  };

  const handleJoinOnlineRoom = async (code: string) => {
    const roomCode = code.toUpperCase().trim();
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_JOIN');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(roomCode, undefined, displayName.trim() || undefined);
    const assigned = networkManager.getRole();
    if (assigned) setOnlineRole(assigned);
  };

  const handleSpectateRoom = async (code: string) => {
    const roomCode = code.toUpperCase().trim();
    if (!roomCode) return;
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_SPECTATOR');
    setInOnlineLobby(true);
    setInLobby(false);

    const ok = await networkManager.connect(roomCode, 'spectator', displayName.trim() || undefined);
    if (ok) {
      setOnlineRole('spectator');
    }
  };

  const handleLeaveRoom = () => {
    networkManager.disconnect();
    setInOnlineLobby(false);
    setInLobby(true);
  };

  const handleRematch = () => {
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER') {
      networkManager.requestRematch();
    }
    startNewMatch();
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

      {/* Main Container */}
      <div className="flex-1 flex flex-col items-center justify-center w-full my-2">
        <div className="w-full flex flex-col items-center">
          {inLobby ? (
            <LobbyView
              onStartSolo={handleStartSolo}
              onStartLocal2P={handleStartLocal2P}
              onCreateOnlineRoom={handleCreateOnlineRoom}
              onCreateServerRoom={handleCreateServerRoom}
              onSpectateRoom={handleSpectateRoom}
              onJoinOnlineRoom={handleJoinOnlineRoom}
              onOpenSettings={() => setSettingsModalOpen(true)}
              onOpenLatencyHarness={() => setLatencyModalOpen(true)}
              gamepadCount={gamepadCount}
              settings={settings}
              displayName={displayName}
              onDisplayNameChange={handleDisplayNameChange}
              onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
              isNintendoController={isNintendoController}
            />
          ) : inOnlineLobby ? (
            <OnlineRoomLobby
              roomId={onlineRoomId}
              role={onlineRole}
              hasP1={hasP1}
              hasP2={hasP2}
              spectatorsCount={spectatorsCount}
              playerNames={playerNames}
              series={series}
              onStartMatch={startNewMatch}
              onLeaveRoom={handleLeaveRoom}
              onOpenLatencyHarness={() => setLatencyModalOpen(true)}
              onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
            />
          ) : (
            <div className="match-grid-container gap-2">
              <Hud
                gameState={displayState}
                playMode={playMode}
                latencyReport={latencyReport}
                onOpenLatencyHarness={() => setLatencyModalOpen(true)}
                onOpenSettings={() => setSettingsModalOpen(true)}
                gamepadCount={gamepadCount}
                locks={replayActive ? undefined : locks}
                turnClock={replayActive ? undefined : turnClock}
                viewerSeat={
                  playMode === 'ONLINE_HOST' ? 'p1'
                  : playMode === 'ONLINE_JOIN' ? (onlineRole === 'p1' ? 'p1' : onlineRole === 'p2' ? 'p2' : null)
                  : null
                }
              />
              <div className="gameboard-area my-1">
                <GameBoard gameState={displayState} settings={settings} />
              </div>
              <div className="controls-area">
                {!replayActive && <ControlsOverlay onDirection={(dir) => handleDirectionInput(1, dir)} />}
                {replayActive && (
                  <ReplayControls
                    index={replayIdx}
                    total={matchHistory.length}
                    playing={replayPlaying}
                    speed={replaySpeed}
                    onTogglePlay={() => setReplayPlaying(p => !p)}
                    onSeek={(i) => setReplayIdx(i)}
                    onSpeedChange={setReplaySpeed}
                    onExit={() => { setReplayActive(false); setReplayPlaying(false); }}
                    onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info */}
      <footer className="text-center text-[10px] font-mono opacity-80 py-1">
        4-shade palette • {settings.gridSize}×{settings.gridSize} grid • {settings.turnBased ? 'Turn-based simultaneous moves' : `Host-authoritative ${settings.tickRate} TPS`} • Gamepad API ready
      </footer>

      {/* Modals */}
      <LatencyHarnessModal
        isOpen={latencyModalOpen}
        onClose={() => setLatencyModalOpen(false)}
        report={latencyReport}
        isConnected={networkManager.getIsConnected()}
        roomId={onlineRoomId}
        role={onlineRole}
        onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings(s => ({ ...s, ...newVals }))}
        onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
      />

      {!inLobby && !inOnlineLobby && !replayActive && (
        <MatchEndModal
          gameState={gameState}
          playMode={playMode}
          series={series}
          canReplay={matchHistory.length > 1}
          isSpectator={playMode === 'ONLINE_SPECTATOR'}
          onWatchReplay={() => {
            setReplayActive(true);
            setReplayIdx(0);
            setReplayPlaying(true);
          }}
          onRematch={handleRematch}
          onReturnToLobby={handleReturnToLobby}
          onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
        />
      )}
    </main>
  );
};

export default App;
