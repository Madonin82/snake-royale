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
import { ReplayControls } from './components/ReplayControls';
import { ArrowLeft, Gamepad, RefreshCw, Volume2, VolumeX } from 'lucide-react';

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

  // Optional display name (persisted locally) + room seat names + series score
  const [displayName, setDisplayName] = useState<string>(() => {
    try { return localStorage.getItem('snake-royale-name') || ''; } catch { return ''; }
  });
  const [playerNames, setPlayerNames] = useState<{ p1: string; p2: string }>({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
  const playerNamesRef = useRef(playerNames);
  playerNamesRef.current = playerNames;
  const [series, setSeries] = useState<{ p1: number; p2: number; draws: number }>({ p1: 0, p2: 0, draws: 0 });
  const seriesCountedRef = useRef<boolean>(false);

  // MATCH REPLAY: every completed turn's state is recorded; the replay viewer
  // plays them back at a steady pace (thinking pauses edited out).
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

  // What the board + HUD render: live state, or the replayed turn while replaying.
  const displayState = replayActive ? (matchHistory[replayIdx] ?? gameState) : gameState;

  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  const settingsRef = useRef<GameSettings>(settings);
  settingsRef.current = settings;

  const playModeRef = useRef<PlayMode>(playMode);
  playModeRef.current = playMode;

  const onlineRoleRef = useRef<'p1' | 'p2' | 'spectator' | 'server' | null>(onlineRole);
  onlineRoleRef.current = onlineRole;

  // TURN-BASED MOVE LOCKS
  // The board steps only when BOTH players have locked a direction for the
  // current turn. Locks reset after every step. (refs for sync logic, state for HUD)
  const locksRef = useRef<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const [locks, setLocks] = useState<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const sentTickRef = useRef<number>(-1); // ONLINE_JOIN: tick we already sent a move for

  // TURN CLOCK: when this turn started and when each player locked (ms epoch),
  // so the HUD can show per-player thinking time. State mirror for rendering.
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

  // Sound effects for a completed step (shared by real-time loop + turn steps)
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

  // Advance exactly one turn if both players have locked a move.
  const maybeAdvanceTurn = useCallback(() => {
    const current = stateRef.current;
    const s = settingsRef.current;
    if (!s.turnBased || current.phase === 'OVER') return;

    // Solo vs bot: the bot locks the instant the human does.
    if (playModeRef.current === 'SOLO_AI' && !locksRef.current.p2) {
      const aiDir = calculateAIMove(current, s.gridSize, 'p2', s.botDifficulty);
      if (aiDir) queueSnakeDirection(current.snakes.p2, aiDir);
      locksRef.current = { ...locksRef.current, p2: true };
      setLocks(locksRef.current);
      stampLockTime('p2', turnClockRef.current.startedAt); // bot thinks in 0.0s
    }

    if (!locksRef.current.p1 || !locksRef.current.p2) return;

    // Record how long each player took to lock this turn (seconds, 0.1 precision).
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

  // Handle Input routing
  const handleDirectionInput = useCallback((playerSlot: 1 | 2, dir: Direction) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;

    // The server and spectators have no snake: ignore local steering.
    if (playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') return;

    soundEngine.playTick();

    // TURN-BASED: an input locks that player's move for this turn.
    if (settingsRef.current.turnBased) {
      if (playModeRef.current === 'ONLINE_JOIN') {
        // One locked move per turn: ignore extra presses until state advances.
        if (sentTickRef.current === current.tick) return;
        sentTickRef.current = current.tick;
        networkManager.sendInput(dir, current.tick);
        setLock(onlineRoleRef.current === 'p1' ? 'p1' : 'p2');
        return;
      }

      if (playerSlot === 1) {
        if (locksRef.current.p1) return; // already locked this turn
        queueSnakeDirection(stateRef.current.snakes.p1, dir);
        const p1 = { ...current.snakes.p1 };
        queueSnakeDirection(p1, dir);
        setGameState(prev => ({
          ...prev,
          snakes: { ...prev.snakes, p1 }
        }));
        setLock('p1');
        maybeAdvanceTurn();
      } else if (playerSlot === 2 && playModeRef.current === 'LOCAL_2P') {
        if (locksRef.current.p2) return; // already locked this turn
        queueSnakeDirection(stateRef.current.snakes.p2, dir);
        const p2 = { ...current.snakes.p2 };
        queueSnakeDirection(p2, dir);
        setGameState(prev => ({
          ...prev,
          snakes: { ...prev.snakes, p2 }
        }));
        setLock('p2');
        maybeAdvanceTurn();
      }
      return;
    }

    if (playModeRef.current === 'ONLINE_JOIN') {
      // Client (either seat) sending input to the simulation authority.
      networkManager.sendInput(dir, current.tick);
      // Optimistic local queued direction for instant responsive render
      const myKey = onlineRoleRef.current === 'p1' ? 'p1' : 'p2';
      const mine = { ...current.snakes[myKey] };
      queueSnakeDirection(mine, dir);
      setGameState(prev => ({
        ...prev,
        snakes: { ...prev.snakes, [myKey]: mine }
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
          // Client received authoritative state from Host
          if ((playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SPECTATOR') && msg.state) {
            setGameState(msg.state);
            setMatchHistory(prev =>
              prev.length === 0 || msg.state.tick > prev[prev.length - 1].tick
                ? [...prev, msg.state]
                : prev
            );
            if (settingsRef.current.turnBased) clearLocks(); // new turn: moves unlocked
            if (inOnlineLobby) {
              setInOnlineLobby(false);
              setInLobby(false);
            }
          }
          break;
        }

        case 'INPUT_SYNC': {
          // Simulation authority received a player's input.
          // Host (plays P1): only P2's stream matters. Server: both streams.
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
            // Turn-based: this input locks that player's move.
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
            // Spectators just reset their recording; the host re-deals the match.
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
  }, [inOnlineLobby]);

  // Latency Report Polling
  useEffect(() => {
    const interval = setInterval(() => {
      setLatencyReport(networkManager.getLatencyReport());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Main Simulation Loop (Runs on Host / Local — real-time mode only;
  // turn-based matches step event-driven from maybeAdvanceTurn instead)
  useEffect(() => {
    if (inLobby || inOnlineLobby) return;
    if (playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SPECTATOR') return; // Clients/spectators only listen to state updates
    if (settings.turnBased) return; // No wall-clock loop in turn-based mode

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
      setMatchHistory(prev => [...prev, nextState]);

      // If online host/server, broadcast state to connected clients
      if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
        networkManager.broadcastState(nextState);
      }
    }, tickIntervalMs);

    return () => clearInterval(intervalId);
  }, [inLobby, inOnlineLobby, playMode, settings.tickRate, settings.turnBased]);

  // Series scorebook: count each finished match exactly once.
  // Online: only the host writes, to the room doc (the joining client reads it
  // back via ROOM_MEMBERS_CHANGED). Solo/local: counted in local state.
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

  // Start match helper
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

  // Create Online Room (play as P1 host)
  const handleCreateOnlineRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_HOST');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'p1', displayName.trim() || undefined);
    setOnlineRole('p1');
  };

  // Create Online Room as a seat-less simulation server (DM mode):
  // this browser runs the world; two other clients take the seats.
  const handleCreateServerRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_SERVER');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'server', displayName.trim() || undefined);
    setOnlineRole('server');
  };

  // Join Online Room: claim whichever seat is free (P1 first, then P2).
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

  // Watch a room as a public spectator (no seat, no input).
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

  const handleReturnToLobby = () => {
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER' || playMode === 'ONLINE_SPECTATOR') {
      networkManager.disconnect();
      setSeries({ p1: 0, p2: 0, draws: 0 });
      setPlayerNames({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
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
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
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
              <GameBoard gameState={displayState} settings={settings} />
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
                />
              )}
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
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings(s => ({ ...s, ...newVals }))}
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
        />
      )}
    </main>
  );
};

export default App;
