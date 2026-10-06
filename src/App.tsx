import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Direction, GameSettings, GameState, LatencyReport, PlayMode, Position } from './types/game';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  getNextHeadPosition,
  isOppositeDirection,
  processGameTick,
  queueSnakeDirection,
} from './game/engine';
import { calculateAIMove } from './game/ai';
import { gamepadController, GamepadMenuAction } from './game/gamepad';
import { networkManager } from './game/network';
import { normalizeGameState } from './game/normalize';
import { exportReplayToFile, parseAndValidateReplayData } from './game/replayFile';
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

function computePreviewSnake(snake: any, buffer: Direction[]): Position[] {
  if (buffer.length === 0) return snake.body;
  let body = [...snake.body.map((seg: any) => ({ ...seg }))];
  for (const dir of buffer) {
    const nextHead = getNextHeadPosition(body[0], dir);
    body.unshift(nextHead);
    body.pop();
  }
  return body;
}

function computeCommittedPath(snake: any, buffer: Direction[]): Position[] {
  if (buffer.length === 0) return [];
  let body = [...snake.body.map((seg: any) => ({ ...seg }))];
  const path: Position[] = [];
  for (const dir of buffer) {
    const nextHead = getNextHeadPosition(body[0], dir);
    path.push(nextHead);
    body.unshift(nextHead);
    body.pop();
  }
  return path;
}

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

  const [moveBuffers, setMoveBuffers] = useState<{ p1: Direction[]; p2: Direction[] }>({ p1: [], p2: [] });
  const moveBuffersRef = useRef<{ p1: Direction[]; p2: Direction[] }>({ p1: [], p2: [] });
  moveBuffersRef.current = moveBuffers;

  const clearMoveBuffers = useCallback(() => {
    moveBuffersRef.current = { p1: [], p2: [] };
    setMoveBuffers({ p1: [], p2: [] });
  }, []);

  // TURN-BASED MOVE LOCKS
  const locksRef = useRef<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const [locks, setLocks] = useState<{ p1: boolean; p2: boolean }>({ p1: false, p2: false });
  const [thinkTimeRemaining, setThinkTimeRemaining] = useState<{ p1: number | null; p2: number | null }>({ p1: null, p2: null });
  const thinkTimeRemainingRef = useRef(thinkTimeRemaining);
  thinkTimeRemainingRef.current = thinkTimeRemaining;
  const thinkTimeEndsRef = useRef<{ p1: number | null; p2: number | null }>({ p1: null, p2: null });
  const lastThinkTimeTickRef = useRef<{ p1: number | null; p2: number | null }>({ p1: null, p2: null });
  const sentTickRef = useRef<number>(-1);
  // BUGFIX 7: tracks the last STATE_SYNC tick processed on the guest so the
  // buffer drain runs exactly once per completed step. Duplicate, stale, or
  // re-delivered states must never consume buffered moves.
  const lastStateTickRef = useRef<number>(-1);

  const viewerSeat: 'p1' | 'p2' | null = useMemo(() => {
    if (playMode === 'SOLO_AI') return 'p1';
    if (playMode === 'ONLINE_HOST') return 'p1';
    if (playMode === 'ONLINE_JOIN') return onlineRole === 'p1' ? 'p1' : onlineRole === 'p2' ? 'p2' : null;
    if (playMode === 'ONLINE_SERVER' || playMode === 'ONLINE_SPECTATOR') return null;
    if (playMode === 'LOCAL_2P') return null; // Both local on shared keyboard
    return 'p1';
  }, [playMode, onlineRole]);

  const displayState = useMemo(() => {
    if (replayActive) return matchHistory[replayIdx] ?? gameState;
    const stateCopy: GameState = {
      ...gameState,
      snakes: {
        p1: { ...gameState.snakes.p1, body: [...gameState.snakes.p1.body] },
        p2: { ...gameState.snakes.p2, body: [...gameState.snakes.p2.body] },
      },
    };
    if (settings.turnBased) {
      const showP1 = playMode === 'LOCAL_2P' || viewerSeat === 'p1';
      const showP2 = playMode === 'LOCAL_2P' || viewerSeat === 'p2';

      if (showP1 && !locks.p1 && moveBuffers.p1.length > 0) {
        stateCopy.snakes.p1.body = computePreviewSnake(gameState.snakes.p1, moveBuffers.p1);
      }
      if (showP2 && !locks.p2 && moveBuffers.p2.length > 0) {
        stateCopy.snakes.p2.body = computePreviewSnake(gameState.snakes.p2, moveBuffers.p2);
      }
    }
    return stateCopy;
  }, [replayActive, matchHistory, replayIdx, gameState, moveBuffers, locks, settings.turnBased, playMode, viewerSeat]);

  const lockedPaths = useMemo(() => {
    if (!settings.turnBased) return undefined;
    const showP1 = playMode === 'LOCAL_2P' || viewerSeat === 'p1';
    const showP2 = playMode === 'LOCAL_2P' || viewerSeat === 'p2';

    return {
      p1: showP1 && locks.p1 && moveBuffers.p1.length > 0 ? computeCommittedPath(gameState.snakes.p1, moveBuffers.p1) : undefined,
      p2: showP2 && locks.p2 && moveBuffers.p2.length > 0 ? computeCommittedPath(gameState.snakes.p2, moveBuffers.p2) : undefined,
    };
  }, [settings.turnBased, locks, moveBuffers, gameState.snakes, playMode, viewerSeat]);

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

  // THINK CLOCK — per-player, per-decision-window timing.
  // A session runs only while the player's buffer is empty and accepting input.
  // It pauses the moment they lock; time accrues only for completed windows.
  // Driven by lock transitions (see the locks effect below), so every mode
  // (local, solo, online host/join) is handled in one place.
  interface ThinkSession { accum: number; sessionStart: number | null }
  const thinkRef = useRef<{ p1: ThinkSession; p2: ThinkSession }>({
    p1: { accum: 0, sessionStart: null },
    p2: { accum: 0, sessionStart: null },
  });
  const [thinkSessions, setThinkSessions] = useState({
    p1: { startTime: null as number | null },
    p2: { startTime: null as number | null },
  });

  const thinkSessionStart = useCallback((who: 'p1' | 'p2') => {
    const t = thinkRef.current[who];
    if (t.sessionStart !== null) return;
    const current = stateRef.current;
    if (current.phase === 'OVER') return;
    const snake = current.snakes[who];
    if (!snake || !snake.isAlive) return;
    t.sessionStart = Date.now();
    const startTime = t.sessionStart;
    setThinkSessions(prev => ({ ...prev, [who]: { startTime } }));
  }, []);

  const thinkSessionEnd = useCallback((who: 'p1' | 'p2') => {
    const t = thinkRef.current[who];
    if (t.sessionStart === null) return;
    const dt = parseFloat(((Date.now() - t.sessionStart) / 1000).toFixed(1));
    t.accum = parseFloat((t.accum + dt).toFixed(1));
    t.sessionStart = null;
    setThinkSessions(prev => ({ ...prev, [who]: { startTime: null } }));
    const accum = t.accum;
    setGameState(prev => ({
      ...prev,
      totalThinkTime: { ...prev.totalThinkTime, [who]: accum },
      lastTurnTimes: { ...(prev.lastTurnTimes || { p1: 0, p2: 0 }), [who]: dt },
    }));
  }, []);

  // Ends a session WITHOUT accruing (AI locks, game-over cleanup).
  const thinkSessionCancel = useCallback((who: 'p1' | 'p2') => {
    const t = thinkRef.current[who];
    if (t.sessionStart === null) return;
    t.sessionStart = null;
    setThinkSessions(prev => ({ ...prev, [who]: { startTime: null } }));
  }, []);

  // Lock transitions drive the think sessions.
  const prevLocksRef = useRef({ p1: false, p2: false });
  // Tracks whether think sessions were started for the current match.
  // Sessions start on the first tick after both players are ready (not at
  // match setup), so a player who confirms ready early isn't timed while
  // waiting for their opponent.
  const thinkStartedRef = useRef(false);
  useEffect(() => {
    (['p1', 'p2'] as const).forEach(who => {
      const was = prevLocksRef.current[who];
      const is = locks[who];
      if (!was && is) thinkSessionEnd(who);
      else if (was && !is) thinkSessionStart(who);
    });
    prevLocksRef.current = { ...locks };
  }, [locks, thinkSessionStart, thinkSessionEnd]);

  const getTargetKey = useCallback((playerSlot: 1 | 2): 'p1' | 'p2' => {
    if (playModeRef.current === 'SOLO_AI') return 'p1';
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') return 'p1';
    if (playModeRef.current === 'ONLINE_JOIN') return onlineRoleRef.current === 'p1' ? 'p1' : 'p2';
    if (playModeRef.current === 'LOCAL_2P') return playerSlot === 2 ? 'p2' : 'p1';
    return 'p1';
  }, []);

  const setLock = useCallback((who: 'p1' | 'p2') => {
    thinkTimeEndsRef.current = { ...thinkTimeEndsRef.current, [who]: null };
    lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: null };
    setThinkTimeRemaining(prev => ({ ...prev, [who]: null }));
    locksRef.current = { ...locksRef.current, [who]: true };
    setLocks(locksRef.current);
    // Think session ends via the locks-transition effect.
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
      networkManager.broadcastState(stateRef.current, locksRef.current);
    }
  }, []);

  const clearLocks = useCallback(() => {
    thinkTimeEndsRef.current = { p1: null, p2: null };
    lastThinkTimeTickRef.current = { p1: null, p2: null };
    thinkTimeRemainingRef.current = { p1: null, p2: null };
    setThinkTimeRemaining({ p1: null, p2: null });
    locksRef.current = { p1: false, p2: false };
    setLocks(locksRef.current);
    // New match: reset accumulators. Think sessions open on the first tick
    // after both players are ready (see maybeAdvanceTurn).
    thinkRef.current.p1 = { accum: 0, sessionStart: null };
    thinkRef.current.p2 = { accum: 0, sessionStart: null };
    setThinkSessions({ p1: { startTime: null }, p2: { startTime: null } });
    prevLocksRef.current = { p1: false, p2: false };
    thinkStartedRef.current = false;
    clearMoveBuffers();
  }, [clearMoveBuffers, thinkSessionStart]);

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

  const turnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (turnTimeoutRef.current) {
        clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
    };
  }, []);

  const maybeAdvanceTurn = useCallback(() => {
    if (turnTimeoutRef.current) {
      clearTimeout(turnTimeoutRef.current);
      turnTimeoutRef.current = null;
    }

    const current = stateRef.current;
    const s = settingsRef.current;
    if (!s.turnBased || current.phase === 'OVER') return;
    const isOnline = playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER';
    const bothReady = !isOnline || (current.readyConfirmed?.p1 && current.readyConfirmed?.p2);
    if (!bothReady) return;

    // Think sessions open on the first tick after both players are ready,
    // but turn 0 is a freebie — the clock starts at turn 1.
    if (!thinkStartedRef.current && current.tick >= 1) {
      thinkSessionStart('p1');
      thinkSessionStart('p2');
      thinkStartedRef.current = true;
    }

    if (playModeRef.current === 'SOLO_AI' && !locksRef.current.p2) {
      const p2Buf = [...moveBuffersRef.current.p2];
      const p2Snake = current.snakes.p2;
      if (p2Buf.length === 0) {
        let curDir = p2Snake.direction;
        let simBody = [...p2Snake.body];
        const planLen = Math.min(3, p2Snake.body.length);
        for (let i = 0; i < planLen; i++) {
          const aiDir = calculateAIMove({ ...current, snakes: { ...current.snakes, p2: { ...p2Snake, body: simBody, direction: curDir } } }, s.gridSize, 'p2', s.botDifficulty);
          if (aiDir && !isOppositeDirection(curDir, aiDir)) {
            p2Buf.push(aiDir);
            curDir = aiDir;
            const nextHead = getNextHeadPosition(simBody[0], aiDir);
            simBody.unshift(nextHead);
            simBody.pop();
          } else {
            break;
          }
        }
        if (p2Buf.length === 0) {
          const fallback = ['UP', 'DOWN', 'LEFT', 'RIGHT'].find(d => !isOppositeDirection(curDir, d as Direction)) as Direction || 'LEFT';
          p2Buf.push(fallback);
        }
      }
      moveBuffersRef.current = { ...moveBuffersRef.current, p2: p2Buf };
      setMoveBuffers({ ...moveBuffersRef.current });
      locksRef.current = { ...locksRef.current, p2: true };
      setLocks(locksRef.current);
      // AI doesn't accrue think time — close any open session silently.
      // (The locks-transition effect will see sessionStart already null.)
      thinkSessionCancel('p2');
    }

    const p1Buf = moveBuffersRef.current.p1;
    const p2Buf = moveBuffersRef.current.p2;

    if (!locksRef.current.p1 || !locksRef.current.p2) return;
    const nextP1Dir = p1Buf.shift() || current.snakes.p1.direction;
    const nextP2Dir = p2Buf.shift() || current.snakes.p2.direction;

    queueSnakeDirection(current.snakes.p1, nextP1Dir);
    queueSnakeDirection(current.snakes.p2, nextP2Dir);

    const { nextState, events } = processGameTick(stateRef.current, s, 0);
    // Think time accrues per decision window on lock (thinkSessionEnd),
    // not per executed tick — nothing to add here.
    playTickEvents(events);

    const newP1Buf = [...moveBuffersRef.current.p1];
    const newP2Buf = [...moveBuffersRef.current.p2];
    moveBuffersRef.current = { p1: newP1Buf, p2: newP2Buf };
    setMoveBuffers({ p1: newP1Buf, p2: newP2Buf });

    locksRef.current = {
      p1: newP1Buf.length > 0 ? locksRef.current.p1 : false,
      p2: newP2Buf.length > 0 ? locksRef.current.p2 : false,
    };
    setLocks(locksRef.current);

    setGameState(nextState);
    setMatchHistory(prev => [...prev, nextState]);

    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
      networkManager.broadcastState(nextState, locksRef.current);
    }

    const canProgress =
      nextState.phase !== 'OVER' &&
      ((moveBuffersRef.current.p1.length > 0 && moveBuffersRef.current.p2.length > 0) ||
       (playModeRef.current === 'SOLO_AI' && !locksRef.current.p2));

    if (canProgress) {
      turnTimeoutRef.current = setTimeout(() => {
        turnTimeoutRef.current = null;
        maybeAdvanceTurn();
      }, 550);
    }
  }, [playTickEvents, thinkSessionCancel]);

  const autoLockPlayer = useCallback((who: 'p1' | 'p2') => {
    if (locksRef.current[who]) return;
    const current = stateRef.current;
    const buffer = moveBuffersRef.current[who];

    setLock(who);
    if (playModeRef.current === 'ONLINE_JOIN') {
      if (buffer.length > 0 && sentTickRef.current !== current.tick) {
        sentTickRef.current = current.tick;
        networkManager.sendInput(buffer[0], current.tick);
      }
      return;
    }

    maybeAdvanceTurn();
  }, [maybeAdvanceTurn, setLock]);

  useEffect(() => {
    if (!settings.turnBased || settings.thinkTimeSeconds === null) {
      thinkTimeEndsRef.current = { p1: null, p2: null };
      lastThinkTimeTickRef.current = { p1: null, p2: null };
      thinkTimeRemainingRef.current = { p1: null, p2: null };
      setThinkTimeRemaining({ p1: null, p2: null });
      return;
    }

    const clearCountdown = (who: 'p1' | 'p2') => {
      if (thinkTimeEndsRef.current[who] === null && thinkTimeRemainingRef.current[who] === null) return;
      thinkTimeEndsRef.current = { ...thinkTimeEndsRef.current, [who]: null };
      lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: null };
      thinkTimeRemainingRef.current = { ...thinkTimeRemainingRef.current, [who]: null };
      setThinkTimeRemaining({ ...thinkTimeRemainingRef.current });
    };

    const interval = setInterval(() => {
      const current = stateRef.current;
      const mode = playModeRef.current;
      const ready = current.readyConfirmed;
      const isOnline = mode === 'ONLINE_HOST' || mode === 'ONLINE_JOIN' || mode === 'ONLINE_SERVER';
      const matchActive =
        !inLobby &&
        !inOnlineLobby &&
        !replayActive &&
        current.phase !== 'OVER' &&
        (!isOnline || (ready?.p1 && ready?.p2));

      (['p1', 'p2'] as const).forEach(who => {
        const isOwnSeat =
          mode === 'LOCAL_2P' ||
          (mode === 'SOLO_AI' && who === 'p1') ||
          (mode === 'ONLINE_HOST' && who === 'p1') ||
          (mode === 'ONLINE_JOIN' && onlineRoleRef.current === who);
        const isAuthority =
          mode !== 'ONLINE_JOIN' &&
          mode !== 'ONLINE_SPECTATOR' &&
          !(mode === 'SOLO_AI' && who === 'p2');
        const snake = current.snakes[who];

        if (
          !matchActive ||
          !isOwnSeat && !isAuthority ||
          !snake?.isAlive ||
          locksRef.current[who]
        ) {
          clearCountdown(who);
          return;
        }

        if (thinkTimeEndsRef.current[who] === null) {
          if (moveBuffersRef.current[who].length > 0) return;

          const endsAt = Date.now() + settings.thinkTimeSeconds! * 1000;
          thinkTimeEndsRef.current = { ...thinkTimeEndsRef.current, [who]: endsAt };
          const initialCount = settings.thinkTimeSeconds!;
          lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: initialCount };
          thinkTimeRemainingRef.current = { ...thinkTimeRemainingRef.current, [who]: initialCount };
          setThinkTimeRemaining({ ...thinkTimeRemainingRef.current });
          soundEngine.playThinkTimeTick();
          if (isOwnSeat) {
            const slot = mode === 'LOCAL_2P' && who === 'p2' ? 2 : 1;
            gamepadController.rumble(slot);
          }
          return;
        }

        const secondsLeft = Math.max(0, Math.ceil((thinkTimeEndsRef.current[who]! - Date.now()) / 1000));
        if (secondsLeft === 0) {
          clearCountdown(who);
          autoLockPlayer(who);
          return;
        }

        if (lastThinkTimeTickRef.current[who] !== secondsLeft) {
          lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: secondsLeft };
          soundEngine.playThinkTimeTick(secondsLeft === 1);
        }
        if (thinkTimeRemainingRef.current[who] !== secondsLeft) {
          thinkTimeRemainingRef.current = { ...thinkTimeRemainingRef.current, [who]: secondsLeft };
          setThinkTimeRemaining({ ...thinkTimeRemainingRef.current });
        }
      });
    }, 50);

    return () => clearInterval(interval);
  }, [
    autoLockPlayer,
    inLobby,
    inOnlineLobby,
    onlineRole,
    replayActive,
    settings.thinkTimeSeconds,
    settings.turnBased,
  ]);

  const handleBufferUndo = useCallback((playerSlot: 1 | 2) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby || !settingsRef.current.turnBased) return;
    const targetKey = getTargetKey(playerSlot);
    if (locksRef.current[targetKey]) return;

    const buf = [...moveBuffersRef.current[targetKey]];
    if (buf.length === 0) return;
    buf.pop();
    moveBuffersRef.current = { ...moveBuffersRef.current, [targetKey]: buf };
    setMoveBuffers({ ...moveBuffersRef.current });
    soundEngine.playTick();
  }, [inLobby, inOnlineLobby, getTargetKey]);

  const handleBufferClear = useCallback((playerSlot: 1 | 2) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby || !settingsRef.current.turnBased) return;
    const targetKey = getTargetKey(playerSlot);
    if (locksRef.current[targetKey]) return;

    moveBuffersRef.current = { ...moveBuffersRef.current, [targetKey]: [] };
    setMoveBuffers({ ...moveBuffersRef.current });
    soundEngine.playTick();
  }, [inLobby, inOnlineLobby, getTargetKey]);

  const handleBufferLock = useCallback((playerSlot: 1 | 2) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby || !settingsRef.current.turnBased) return;
    const targetKey = getTargetKey(playerSlot);
    const buf = moveBuffersRef.current[targetKey];
    if (buf.length === 0 || locksRef.current[targetKey]) return;

    soundEngine.playTick();
    setLock(targetKey);

    if (playModeRef.current === 'ONLINE_JOIN') {
      if (sentTickRef.current !== current.tick) {
        sentTickRef.current = current.tick;
        networkManager.sendInput(buf[0], current.tick);
      }
      return;
    }

    maybeAdvanceTurn();
  }, [inLobby, inOnlineLobby, maybeAdvanceTurn, setLock, getTargetKey]);

  const handleDirectionInput = useCallback((playerSlot: 1 | 2, dir: Direction) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;
    if (playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') return;

    const targetKey = getTargetKey(playerSlot);

    const currentSnake = current.snakes[targetKey];
    if (!currentSnake || !currentSnake.isAlive) return;

    soundEngine.playTick();

    if (settingsRef.current.turnBased) {
      if (locksRef.current[targetKey]) return;

      const buf = [...moveBuffersRef.current[targetKey]];
      if (buf.length >= currentSnake.body.length) return;

      const lastDir = buf.length > 0 ? buf[buf.length - 1] : currentSnake.direction;
      if (isOppositeDirection(lastDir, dir)) return;

      buf.push(dir);
      moveBuffersRef.current = { ...moveBuffersRef.current, [targetKey]: buf };
      setMoveBuffers({ ...moveBuffersRef.current });
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
  }, [inLobby, inOnlineLobby]);

  const handleUpdateSettings = useCallback((newVals: Partial<GameSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newVals };
      if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
        networkManager.updateRoomSettings(updated);
      }
      return updated;
    });
  }, []);

  const adoptRoomSettings = useCallback((roomSettings: Partial<GameSettings>) => {
    setSettings(prev => ({
      ...prev,
      ...roomSettings,
      thinkTimeSeconds: roomSettings.thinkTimeSeconds ?? null,
      soundEnabled: prev.soundEnabled,
      crtFilterEnabled: prev.crtFilterEnabled,
    }));
  }, []);

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
    const isUiActive =
      inLobby ||
      inOnlineLobby ||
      replayActive ||
      settingsModalOpen ||
      latencyModalOpen ||
      gameState.phase === 'OVER';

    if (isUiActive && activeHandlerRef.current) {
      activeHandlerRef.current(action);
    }
  }, [inLobby, inOnlineLobby, replayActive, settingsModalOpen, latencyModalOpen, gameState.phase]);

  // Gamepad controller listener setup (run once)
  useEffect(() => {
    gamepadController.setCallback((slot, dir) => {
      handleDirectionInput(slot, dir);
    });

    gamepadController.setMenuCallback((action, slot) => {
      handleMenuAction(action, slot);
    });

    gamepadController.setButtonCallback((slot, button, pressed) => {
      if (!pressed) return;
      const targetSlot = playModeRef.current === 'LOCAL_2P' && slot === 2 ? 2 : 1;
      if (button === 'A') {
        const isOnline = playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER';
        const ready = stateRef.current.readyConfirmed;
        const mySeat = onlineRoleRef.current === 'p2' ? 'p2' : 'p1';
        if (isOnline && (!ready || !ready[mySeat])) {
          handleConfirmReady();
        } else {
          handleBufferLock(targetSlot);
        }
      } else if (button === 'B') {
        handleBufferUndo(targetSlot);
      } else if (button === 'Y') {
        handleBufferClear(targetSlot);
      }
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
  }, [handleDirectionInput, handleMenuAction, handleBufferLock, handleBufferUndo, handleBufferClear]);

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

      // In-Game buffer / snake controls
      if (e.key === 'Backspace') {
        handleBufferUndo(1);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        handleBufferClear(1);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const isOnline = playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER';
        const ready = stateRef.current.readyConfirmed;
        const mySeat = onlineRoleRef.current === 'p2' ? 'p2' : 'p1';
        if (isOnline && (!ready || !ready[mySeat])) {
          handleConfirmReady();
          e.preventDefault();
          return;
        }
        handleBufferLock(1);
        e.preventDefault();
        return;
      }

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
          if (msg.settings) adoptRoomSettings(msg.settings);
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
          if (msg.settings) adoptRoomSettings(msg.settings);
          if (msg.series) setSeries(msg.series);
          break;
        }

        case 'SETTINGS_SYNC': {
          if (msg.settings) adoptRoomSettings(msg.settings);
          break;
        }

        case 'STATE_SYNC': {
          if ((playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SPECTATOR') && msg.state) {
            // Wire states (RTDB / WebRTC) can arrive with array fields
            // dropped or object-shaped; normalize before anything reads them.
            const safeState = normalizeGameState(msg.state);

            // BUGFIX 7: STATE_SYNC can fire multiple times per step — RTDB
            // listeners re-fire on unrelated room writes, both transports can
            // deliver, and lag reorders arrivals. Key the guest buffer drain
            // (and board updates) on the state tick so each completed step is
            // processed exactly once.
            const isNewTick = safeState.tick > lastStateTickRef.current;
            const isStaleTick = safeState.tick < lastStateTickRef.current;
            if (isNewTick) {
              lastStateTickRef.current = safeState.tick;
            }

            // Stale states are ignored for game purposes (no board snap-back,
            // no buffer drain, no lock updates). Equal-tick states may still
            // refresh display metadata (locks) but never touch board/buffer.
            if (!isStaleTick) {
              if (isNewTick) {
                setGameState(safeState);
                setMatchHistory(prev =>
                  prev.length === 0 || safeState.tick > prev[prev.length - 1].tick
                    ? [...prev, safeState]
                    : prev
                );
              }

              if (msg.locks) {
                const myRole = onlineRoleRef.current;
                setLocks(prevLocks => ({
                  p1: myRole === 'p1' ? (moveBuffersRef.current.p1.length > 0 ? prevLocks.p1 : msg.locks.p1) : msg.locks.p1,
                  p2: myRole === 'p2' ? (moveBuffersRef.current.p2.length > 0 ? prevLocks.p2 : msg.locks.p2) : msg.locks.p2,
                }));
                locksRef.current = {
                  p1: myRole === 'p1' ? (moveBuffersRef.current.p1.length > 0 ? locksRef.current.p1 : msg.locks.p1) : msg.locks.p1,
                  p2: myRole === 'p2' ? (moveBuffersRef.current.p2.length > 0 ? locksRef.current.p2 : msg.locks.p2) : msg.locks.p2,
                };
              }

              if (isNewTick && settingsRef.current.turnBased && playModeRef.current === 'ONLINE_JOIN' && onlineRoleRef.current) {
                const myRole = onlineRoleRef.current === 'p1' ? 'p1' : onlineRoleRef.current === 'p2' ? 'p2' : null;
                if (myRole) {
                  const buf = [...moveBuffersRef.current[myRole]];
                  if (buf.length > 0) {
                    buf.shift();
                    moveBuffersRef.current = { ...moveBuffersRef.current, [myRole]: buf };
                    setMoveBuffers({ ...moveBuffersRef.current });

                    if (buf.length > 0) {
                      if (sentTickRef.current !== safeState.tick) {
                        sentTickRef.current = safeState.tick;
                        networkManager.sendInput(buf[0], safeState.tick);
                      }
                    }
                  }
                  if (moveBuffersRef.current[myRole].length === 0) {
                    locksRef.current = { ...locksRef.current, [myRole]: false };
                    setLocks({ ...locksRef.current });
                  }
                }
              }

              if (settingsRef.current.turnBased && playModeRef.current === 'ONLINE_SPECTATOR') {
                if (msg.locks) {
                  setLocks(msg.locks);
                  locksRef.current = msg.locks;
                }
              }
            }

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
            const snake = current.snakes[key];
            const buf = [...moveBuffersRef.current[key]];
            if (buf.length < snake.body.length) {
              const lastDir = buf.length > 0 ? buf[buf.length - 1] : snake.direction;
              if (!isOppositeDirection(lastDir, msg.dir)) {
                buf.push(msg.dir);
                moveBuffersRef.current = { ...moveBuffersRef.current, [key]: buf };
                setMoveBuffers({ ...moveBuffersRef.current });
              }
            }
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

        case 'READY_SYNC': {
          if (msg.ready) {
            setGameState(prev => ({
              ...prev,
              readyConfirmed: {
                p1: !!msg.ready.p1,
                p2: !!msg.ready.p2,
              }
            }));
          }
          break;
        }

        case 'READY_CONFIRM': {
          if (msg.role) {
            setGameState(prev => {
              const cur = prev.readyConfirmed || { p1: false, p2: false };
              const updated = { ...cur, [msg.role]: true };
              return { ...prev, readyConfirmed: updated };
            });
          }
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
  }, [inOnlineLobby, clearLocks, maybeAdvanceTurn, setLock, adoptRoomSettings]);

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

  const handleConfirmReady = useCallback(() => {
    const isOnline = playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER';
    if (!isOnline) return;
    const mySeat = onlineRoleRef.current === 'p2' ? 'p2' : 'p1';

    setGameState(prev => {
      const cur = prev.readyConfirmed || { p1: false, p2: false };
      if (cur[mySeat]) return prev;
      const updated = { ...cur, [mySeat]: true };
      return { ...prev, readyConfirmed: updated };
    });

    soundEngine.playMenuSelect();
    networkManager.sendReadyConfirm(mySeat);
  }, []);

  const startNewMatch = () => {
    activeHandlerRef.current = null;
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
    const isOnline = playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER';
    const initial = createInitialState(settings, matchNames);
    if (isOnline) {
      initial.readyConfirmed = { p1: false, p2: false };
    } else {
      initial.readyConfirmed = { p1: true, p2: true };
    }
    seriesCountedRef.current = false;
    setMatchHistory([initial]);
    setReplayActive(false);
    setReplayIdx(0);
    setReplayPlaying(false);
    setGameState(initial);
    clearLocks();
    sentTickRef.current = -1;
    lastStateTickRef.current = -1;
    setInLobby(false);
    setInOnlineLobby(false);

    soundEngine.playCountdown(true);

    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') {
      networkManager.broadcastMatchStart(initial, settingsRef.current);
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

    await networkManager.connect(code, 'p1', displayName.trim() || undefined, settings);
    setOnlineRole('p1');
  };

  const handleCreateServerRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_SERVER');
    setInOnlineLobby(true);
    setInLobby(false);

    await networkManager.connect(code, 'server', displayName.trim() || undefined, settings);
    setOnlineRole('server');
  };

  const handleJoinOnlineRoom = async (code: string) => {
    const roomCode = code.toUpperCase().trim();
    setJoinError(null);
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_JOIN');
    setInOnlineLobby(true);
    setInLobby(false);
    // BUGFIX 7: fresh tick tracking for the incoming state stream.
    lastStateTickRef.current = -1;

    // BUGFIX 8: honor connect()'s result. A failed connect must not leave a
    // silent stuck lobby — show an error and return to the join form.
    const ok = await networkManager.connect(roomCode, undefined, displayName.trim() || undefined);
    const assigned = networkManager.getRole();
    if (!ok || !assigned) {
      networkManager.disconnect();
      setJoinError("Couldn't join room — check the code");
      setInOnlineLobby(false);
      setInLobby(true);
      return;
    }
    setOnlineRole(assigned);

    // BUGFIX 8: one explicit member-state sync after connect, so the lobby
    // is correct even if the first ROOM_MEMBERS_CHANGED was missed (handler
    // re-registration race / onValue only fires on changes).
    const members = await networkManager.getRoomMembers();
    if (members) {
      setHasP1(members.hasP1);
      setHasP2(members.hasP2);
      setPlayerNames({
        p1: members.p1Name || 'PLAYER 1',
        p2: members.p2Name || 'PLAYER 2',
      });
      setSeries(members.series);
    }
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

  const [importError, setImportError] = useState<string | null>(null);

  // BUGFIX 8: join failure message shown in the lobby join form.
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleExportReplay = () => {
    exportReplayToFile(matchHistory, settings);
  };

  const handleImportReplay = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = parseAndValidateReplayData(text);
      if (parsed.settings) {
        setSettings(s => ({
          ...s,
          gridSize: parsed.settings!.gridSize ?? s.gridSize,
          turnBased: parsed.settings!.turnBased ?? s.turnBased,
          raceTurns: parsed.settings!.raceTurns ?? s.raceTurns,
          tickRate: parsed.settings!.tickRate ?? s.tickRate,
          thinkTimeSeconds: parsed.settings!.thinkTimeSeconds === undefined
            ? s.thinkTimeSeconds
            : parsed.settings!.thinkTimeSeconds,
        }));
      }
      setMatchHistory(parsed.states);
      setGameState(parsed.states[0]);
      setReplayActive(true);
      setReplayIdx(0);
      setReplayPlaying(true);
      setInLobby(false);
      setInOnlineLobby(false);
      soundEngine.playMenuSelect();
    } catch (err: any) {
      setImportError(err.message || "That file isn't a Snake Royale replay");
      soundEngine.playCrash();
    }
  };

  // Single-screen match layout: when a match (or replay) is on screen, the
  // root <main> becomes a locked viewport (100dvh, no scroll). Lobby/menu
  // views keep their normal min-h-screen flow.
  const isMatchView = !inLobby && !inOnlineLobby;

  return (
    <main className={`${isMatchView ? 'h-[100dvh] overflow-hidden' : 'min-h-screen justify-between'} flex flex-col items-center p-2 sm:p-4 ${settings.crtFilterEnabled ? 'crt-overlay' : ''}`}>
      {/* Top Header Navbar */}
      <header className="w-full max-w-[500px] shrink-0 flex items-center justify-between py-1 px-2 border-b-2 border-[#0F380F] text-xs font-mono font-bold">
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
      <div className={`flex-1 ${isMatchView ? 'min-h-0 min-w-0 my-1' : 'my-2'} flex flex-col items-center justify-center w-full`}>
        <div className={`w-full flex flex-col items-center ${isMatchView ? 'flex-1 min-h-0' : ''}`}>
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
              onImportReplay={handleImportReplay}
              importError={importError}
              joinError={joinError}
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
              settings={settings}
              onStartMatch={startNewMatch}
              onLeaveRoom={handleLeaveRoom}
              onOpenLatencyHarness={() => setLatencyModalOpen(true)}
              onOpenSettings={() => setSettingsModalOpen(true)}
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
                thinkSessions={replayActive ? undefined : thinkSessions}
                thinkTimeRemaining={replayActive ? undefined : thinkTimeRemaining}
                moveBuffers={moveBuffers}
                viewerSeat={viewerSeat}
              />
              <div className="gameboard-area my-1">
                <GameBoard
                  gameState={displayState}
                  settings={settings}
                  lockedPaths={lockedPaths}
                  controlSeat={playMode === 'ONLINE_JOIN' && onlineRole === 'p2' ? 'p2' : 'p1'}
                  onDirection={(dir) => handleDirectionInput(1, dir)}
                  interactionEnabled={!replayActive}
                />
                {!replayActive && (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER') && !(displayState.readyConfirmed?.p1 && displayState.readyConfirmed?.p2) && (
                  <div className="absolute inset-0 bg-[#0F380F]/90 backdrop-blur-xs flex flex-col items-center justify-center p-3 z-20 font-mono text-[#9BBC0F]">
                    <div className="bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#0F380F] p-3 sm:p-4 max-w-[340px] w-full text-center flex flex-col gap-2.5">
                      <div className="text-xs font-black uppercase tracking-wider text-[#0F380F]">
                        🎮 MATCH READY CHECK
                      </div>
                      <div className="text-[10px] font-bold text-[#0F380F] bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
                        BOTH PLAYERS MUST CONFIRM TO START
                      </div>

                      <div className="flex flex-col gap-1.5 my-1">
                        <div className={`p-2 border-2 border-[#0F380F] flex items-center justify-between text-xs font-black ${displayState.readyConfirmed?.p1 ? 'bg-[#306230] text-[#9BBC0F]' : 'bg-[#8BAC0F] text-[#0F380F]'}`}>
                          <span>{playerNames.p1} (P1):</span>
                          <span>{displayState.readyConfirmed?.p1 ? '✅ READY' : '⏳ WAITING...'}</span>
                        </div>
                        <div className={`p-2 border-2 border-[#0F380F] flex items-center justify-between text-xs font-black ${displayState.readyConfirmed?.p2 ? 'bg-[#306230] text-[#9BBC0F]' : 'bg-[#8BAC0F] text-[#0F380F]'}`}>
                          <span>{playerNames.p2} (P2):</span>
                          <span>{displayState.readyConfirmed?.p2 ? '✅ READY' : '⏳ WAITING...'}</span>
                        </div>
                      </div>

                      {!(displayState.readyConfirmed?.[onlineRole === 'p2' ? 'p2' : 'p1']) ? (
                        <button
                          onClick={handleConfirmReady}
                          className="w-full py-2.5 bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] border-2 border-[#0F380F] font-black text-sm cursor-pointer shadow-[3px_3px_0px_#0F380F] flex items-center justify-center gap-2 animate-pulse"
                        >
                          <span>PRESS A TO START</span>
                          <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">[A / ENTER]</span>
                        </button>
                      ) : (
                        <div className="bg-[#306230] text-[#9BBC0F] p-2.5 border-2 border-[#0F380F] text-xs font-black">
                          ✅ YOU ARE READY! WAITING FOR OPPONENT...
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="controls-area">
                {!replayActive && (
                  <ControlsOverlay
                    onDirection={(dir) => handleDirectionInput(1, dir)}
                    onLock={() => handleBufferLock(1)}
                    onUndo={() => handleBufferUndo(1)}
                    onClear={() => handleBufferClear(1)}
                    queue={settings.turnBased
                      ? moveBuffers[getTargetKey(1)]
                      : [gameState.snakes[getTargetKey(1)].queuedDirection]
                        .filter((direction): direction is Direction => direction !== null)}
                    queueLimit={gameState.snakes[getTargetKey(1)].body.length}
                    locked={locks[getTargetKey(1)]}
                    turnBased={settings.turnBased}
                  />
                )}
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
                    onExportReplay={handleExportReplay}
                    onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info — hidden in match view to give the board the full vertical budget */}
      {!isMatchView && (
        <footer className="text-center text-[10px] font-mono opacity-80 py-1 shrink-0">
          4-shade palette • {settings.gridSize}×{settings.gridSize} grid • {settings.turnBased ? 'Turn-based simultaneous moves' : `Host-authoritative ${settings.tickRate} TPS`} • Gamepad API ready
        </footer>
      )}

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
        onUpdateSettings={handleUpdateSettings}
        isOnlineGuest={!inLobby && (playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SPECTATOR')}
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
          onExportReplay={handleExportReplay}
          onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
        />
      )}
    </main>
  );
};

export default App;
