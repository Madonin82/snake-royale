import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BufferEntry, CompactGameState, Direction, GameSettings, GameState, LatencyReport, PlayMode, Position, SkillId } from './types/game';
import { onAuthStateChanged, User } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import {
  createInitialState,
  DEFAULT_SETTINGS,
  getHitstopForTransition,
  getNextHeadPosition,
  HitstopInfo,
  isCellInArena,
  isOppositeDirection,
  processGameTick,
  queueSnakeDirection,
  queueSnakeSkill,
} from './game/engine';
import { canActivateSkill, canAffordQueuedDart, isValidDartDirection, SKILLS } from './game/skills';
import { calculateAIAction, calculateAIMove } from './game/ai';
import { cloneGameState, toCompactGameState } from './game/aiBridge';
import { shouldApplyRtdbBridgeCommand } from './game/aiBridgeRtdb';
import { gamepadController, GamepadMenuAction } from './game/gamepad';
import { networkManager } from './game/network';
import { ADMIN_UIDS, auth, rtdb } from './firebase';
import {
  areBothOnlinePlayersReady,
  canAcceptState,
  canAdoptMatch,
  canLockOnlineMatch,
  isCurrentMatch,
  isMatchStartAcknowledged,
  mergeOnlineReadyFlags,
  isNewerSequence,
  MatchIdentity,
} from './game/networkProtocol';
import { normalizeGameState } from './game/normalize';
import { exportReplayToFile, parseAndValidateReplayData, TurnDecision } from './game/replayFile';
import {
  adoptThinkTimeSnapshot,
  applyThinkTimeModel,
  createThinkTimeModel,
  getThinkTimeLockEvents,
  getPlanningEnteredEvents,
  ThinkTimeEvent,
  transitionThinkTime,
} from './game/thinkTime';
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
import { LevelEditor } from './editor/LevelEditor';
import { CampaignLevel } from './editor/levelSchema';
import {
  createCampaignPlaytestState,
  createMultiplayerCustomLevelState,
  getCampaignPlaytestLevel,
  getCampaignPlaytestSettings,
  getMultiplayerCustomLevelSettings,
} from './editor/playtestSession';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';

function computePreviewSnake(snake: any, buffer: BufferEntry[]): Position[] {
  if (buffer.length === 0) return snake.body;
  let body = [...snake.body.map((seg: any) => ({ ...seg }))];
  for (const entry of buffer) {
    if (entry.type === 'dart') {
      // Dart: 1 normal cell + 2 dart cells in the chosen direction
      for (let i = 0; i < 3; i++) {
        const nextHead = getNextHeadPosition(body[0], entry.direction);
        body.unshift(nextHead);
        body.pop();
      }
    } else {
      const nextHead = getNextHeadPosition(body[0], entry.direction);
      body.unshift(nextHead);
      body.pop();
    }
  }
  return body;
}

function computeCommittedPath(snake: any, buffer: BufferEntry[]): Position[] {
  if (buffer.length === 0) return [];
  let body = [...snake.body.map((seg: any) => ({ ...seg }))];
  const path: Position[] = [];
  for (const entry of buffer) {
    if (entry.type === 'dart') {
      // Dart: 1 normal cell + 2 dart cells — show all intermediate cells
      for (let i = 0; i < 3; i++) {
        const nextHead = getNextHeadPosition(body[0], entry.direction);
        path.push(nextHead);
        body.unshift(nextHead);
        body.pop();
      }
    } else {
      const nextHead = getNextHeadPosition(body[0], entry.direction);
      path.push(nextHead);
      body.unshift(nextHead);
      body.pop();
    }
  }
  return path;
}

function createLobbyState(settings: GameSettings): GameState {
  return { ...createInitialState(settings), phase: 'LOBBY' };
}

export const App: React.FC = () => {
  const [currentHash, setCurrentHash] = useState<string>(() => window.location.hash);
  const [signedInUser, setSignedInUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, setSignedInUser);
  }, []);

  const campaignPlaytestLevel = currentHash === '#/level-editor/playtest'
    ? getCampaignPlaytestLevel()
    : null;
  const isEditorRoute = currentHash === '#/level-editor' ||
    (currentHash === '#/level-editor/playtest' && !campaignPlaytestLevel);

  if (isEditorRoute) {
    const isAdmin = Boolean(signedInUser && ADMIN_UIDS.includes(signedInUser.uid));
    if (isAdmin) {
      return <LevelEditor />;
    }

    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#7b8860] text-[#0F380F] font-mono select-none p-4 uppercase">
        <div className="w-full max-w-md bg-[#9BBC0F] border-4 border-[#0F380F] p-6 text-center shadow-[inset_0_0_12px_rgba(15,56,15,0.4)]">
          <div className="text-2xl font-black mb-3 tracking-wider text-[#0F380F]">
            ACCESS DENIED
          </div>
          <div className="text-xs font-bold text-[#306230] mb-6 tracking-wide leading-relaxed">
            THIS TOOL IS RESTRICTED TO ADMINISTRATORS.
          </div>
          <a
            href="#/"
            className="inline-block px-4 py-2 bg-[#0F380F] text-[#9BBC0F] font-black text-xs hover:bg-[#306230] border-2 border-[#0F380F] active:translate-y-0.5"
          >
            RETURN TO GAME
          </a>
        </div>
      </div>
    );
  }

  return (
    <GameApp
      key={campaignPlaytestLevel ? `playtest-${campaignPlaytestLevel.id}-${campaignPlaytestLevel.spawns.length}` : 'default'}
      campaignPlaytestLevel={campaignPlaytestLevel}
    />
  );
};

const GameApp: React.FC<{ campaignPlaytestLevel: CampaignLevel | null }> = ({ campaignPlaytestLevel }) => {
  const aiMode = useMemo(() => new URLSearchParams(window.location.search).get('ai') === '1', []);
  const initialRoomParam = useMemo(() => new URLSearchParams(window.location.search).get('room') || '', []);
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches) return;

    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'portrait') => Promise<void>;
    };
    if (!orientation || typeof orientation.lock !== 'function') return;

    orientation.lock('portrait').catch(() => {
      // The landscape overlay is the fallback when the browser blocks orientation locking.
    });
  }, []);
  const initialCampaignSettings = useMemo(
    () => campaignPlaytestLevel ? getCampaignPlaytestSettings(campaignPlaytestLevel) : null,
    [campaignPlaytestLevel],
  );
  const initialCampaignState = useMemo(
    () => campaignPlaytestLevel && initialCampaignSettings
      ? createCampaignPlaytestState(campaignPlaytestLevel, initialCampaignSettings)
      : null,
    [campaignPlaytestLevel, initialCampaignSettings],
  );
  const [settings, setSettings] = useState<GameSettings>(initialCampaignSettings ?? DEFAULT_SETTINGS);
  const [playMode, setPlayMode] = useState<PlayMode>('SOLO_AI');
  const [inLobby, setInLobby] = useState<boolean>(!campaignPlaytestLevel);
  const [inOnlineLobby, setInOnlineLobby] = useState<boolean>(false);
  const [showTurnHint, setShowTurnHint] = useState<boolean>(() => {
    try { return localStorage.getItem('snake-royale-turn-hint-dismissed') !== 'true'; } catch { return true; }
  });
  const [onlineRoomId, setOnlineRoomId] = useState<string>('');
  const [bridgeSecret, setBridgeSecret] = useState<string | null>(null);
  const [onlineRole, setOnlineRole] = useState<'p1' | 'p2' | 'spectator' | 'server' | null>(null);
  const [customOnlineLevel, setCustomOnlineLevel] = useState<CampaignLevel | null>(null);
  const customOnlineLevelRef = useRef<CampaignLevel | null>(null);
  customOnlineLevelRef.current = customOnlineLevel;
  const [hasP1, setHasP1] = useState<boolean>(false);
  const [hasP2, setHasP2] = useState<boolean>(false);
  const [spectatorsCount, setSpectatorsCount] = useState<number>(0);

  const [gameState, setGameState] = useState<GameState>(() =>
    initialCampaignState ?? createLobbyState(initialCampaignSettings ?? DEFAULT_SETTINGS)
  );
  const [joinerAcknowledgedMatchStart, setJoinerAcknowledgedMatchStart] = useState(false);
  const joinerAcknowledgedMatchStartRef = useRef(false);
  const [hasAcknowledgedMatchStart, setHasAcknowledgedMatchStart] = useState(false);
  const hasAcknowledgedMatchStartRef = useRef(false);
  const acknowledgedMatchStartRef = useRef<string | null>(null);
  const [gameOverConfirmed, setGameOverConfirmed] = useState(false);
  const [activeHitstop, setActiveHitstop] = useState<HitstopInfo | null>(null);
  const activeHitstopRef = useRef<HitstopInfo | null>(null);
  activeHitstopRef.current = activeHitstop;
  const hitstopUntilRef = useRef<number>(0);
  const hitstopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [fatalMoveSnakes, setFatalMoveSnakes] = useState<string[]>([]);
  const fatalMoveSnakesRef = useRef<string[]>([]);
  fatalMoveSnakesRef.current = fatalMoveSnakes;
  const fatalMoveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const realTimeInputBufferRef = useRef<Record<string, Direction[]>>({});
  const [latencyModalOpen, setLatencyModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [latencyReport, setLatencyReport] = useState<LatencyReport>(() => networkManager.getLatencyReport());
  const [gamepadCount, setGamepadCount] = useState<number>(0);
  const [isNintendoController, setIsNintendoController] = useState<boolean>(false);
  const [choosingSkillMap, setChoosingSkillMap] = useState<Record<string, boolean>>({});
  const choosingSkillMapRef = useRef(choosingSkillMap);
  choosingSkillMapRef.current = choosingSkillMap;

  useEffect(() => {
    if (gameState.phase !== 'OVER' || inLobby || inOnlineLobby) {
      setGameOverConfirmed(false);
    }
  }, [gameState.phase, inLobby, inOnlineLobby]);

  // Optional display name + room seat names + series score
  const [displayName, setDisplayName] = useState<string>(() => {
    try { return localStorage.getItem('snake-royale-name') || ''; } catch { return ''; }
  });
  const [displayNameP2, setDisplayNameP2] = useState<string>(() => {
    try { return localStorage.getItem('snake-royale-name-p2') || ''; } catch { return ''; }
  });
  const [playerNames, setPlayerNames] = useState<{ p1: string; p2: string }>({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
  const playerNamesRef = useRef(playerNames);
  playerNamesRef.current = playerNames;
  const [series, setSeries] = useState<{ p1: number; p2: number; draws: number }>({ p1: 0, p2: 0, draws: 0 });
  const seriesCountedRef = useRef<boolean>(false);

  // MATCH REPLAY: recorded states
  const [matchHistory, setMatchHistory] = useState<GameState[]>(() =>
    initialCampaignState ? [initialCampaignState] : []
  );
  const turnDecisionsRef = useRef<TurnDecision[]>([]);
  const agentDrivenRef = useRef<{ p1: boolean; p2: boolean; [key: string]: boolean }>({ p1: false, p2: false });
  const [replayActive, setReplayActive] = useState<boolean>(false);
  const [replayIdx, setReplayIdx] = useState<number>(0);
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(5);

  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value);
    try { localStorage.setItem('snake-royale-name', value); } catch { /* private mode */ }
  }, []);

  const handleDisplayNameP2Change = useCallback((value: string) => {
    setDisplayNameP2(value);
    try { localStorage.setItem('snake-royale-name-p2', value); } catch { /* private mode */ }
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

  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;
  const initialBuffers = Object.fromEntries(gameState.snakes.map(snake => [snake.id, [] as BufferEntry[]]));
  const [moveBuffers, setMoveBuffers] = useState<Record<string, BufferEntry[]>>(initialBuffers);
  const moveBuffersRef = useRef<Record<string, BufferEntry[]>>(initialBuffers);
  moveBuffersRef.current = moveBuffers;

  const clearMoveBuffers = useCallback(() => {
    const emptyBuffers = Object.fromEntries(stateRef.current.snakes.map(snake => [snake.id, []]));
    moveBuffersRef.current = emptyBuffers;
    setMoveBuffers(emptyBuffers);
  }, []);

  // TURN-BASED MOVE LOCKS
  const initialSeatRecords = Object.fromEntries(gameState.snakes.map(snake => [snake.id, false]));
  const locksRef = useRef<Record<string, boolean>>(initialSeatRecords);
  const [locks, setLocks] = useState<Record<string, boolean>>(initialSeatRecords);
  const [thinkTimeRemaining, setThinkTimeRemaining] = useState<Record<string, number | null>>(
    Object.fromEntries(gameState.snakes.map(snake => [snake.id, null])),
  );
  const thinkTimeRemainingRef = useRef(thinkTimeRemaining);
  thinkTimeRemainingRef.current = thinkTimeRemaining;
  const thinkTimeEndsRef = useRef<Record<string, number | null>>(
    Object.fromEntries(gameState.snakes.map(snake => [snake.id, null])),
  );
  const lastThinkTimeTickRef = useRef<Record<string, number | null>>(
    Object.fromEntries(gameState.snakes.map(snake => [snake.id, null])),
  );
  const notifiedPlanningWindowRef = useRef<Record<string, boolean>>(
    Object.fromEntries(gameState.snakes.map(snake => [snake.id, false])),
  );
  const sentTickRef = useRef<number>(-1);
  const activeMatchRef = useRef<MatchIdentity | null>(null);
  const lastStateRevisionRef = useRef<number>(-1);
  const lastInputSequenceRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 });
  const lastBridgeCommandSequencesRef = useRef<Record<string, { matchId: string; seq: number }>>({});
  const startNewMatchRef = useRef<() => void>(() => {});
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

  const replayDecisionQueues = useMemo(() => {
    if (!replayActive) return null;
    const baseState = matchHistory[replayIdx] ?? gameState;
    const currentTick = baseState.tick;
    const decisions = turnDecisionsRef.current;
    const queues: Record<string, BufferEntry[]> = Object.fromEntries(
      baseState.snakes.map(snake => [snake.id, [] as BufferEntry[]]),
    );
    for (const d of decisions) {
      if (d.tick === currentTick) {
        queues[d.seat] = d.queue;
      }
    }
    return queues;
  }, [replayActive, matchHistory, replayIdx, gameState]);

  const displayState = useMemo(() => {
    const baseState = replayActive ? (matchHistory[replayIdx] ?? gameState) : gameState;
    const stateCopy: GameState = {
      ...baseState,
      snakes: baseState.snakes.map(snake => ({ ...snake, body: [...snake.body] })),
    };
    if (settings.turnBased && !replayActive) {
      const showP1 = playMode === 'LOCAL_2P' || viewerSeat === 'p1';
      const showP2 = playMode === 'LOCAL_2P' || viewerSeat === 'p2';

      if (showP1 && !locks.p1 && moveBuffers.p1.length > 0) {
        const snake = stateCopy.snakes.find(candidate => candidate.id === 'p1');
        if (snake) snake.body = computePreviewSnake(snake, moveBuffers.p1);
      }
      if (showP2 && !locks.p2 && moveBuffers.p2.length > 0) {
        const snake = stateCopy.snakes.find(candidate => candidate.id === 'p2');
        if (snake) snake.body = computePreviewSnake(snake, moveBuffers.p2);
      }
    }
    return stateCopy;
  }, [replayActive, matchHistory, replayIdx, gameState, moveBuffers, locks, settings.turnBased, playMode, viewerSeat]);

  const lockedPaths = useMemo(() => {
    if (!settings.turnBased || replayActive) return undefined;

    const showP1 = playMode === 'LOCAL_2P' || viewerSeat === 'p1';
    const showP2 = playMode === 'LOCAL_2P' || viewerSeat === 'p2';

    return {
      p1: showP1 && locks.p1 && moveBuffers.p1.length > 0
        ? computeCommittedPath(gameState.snakes.find(snake => snake.id === 'p1')!, moveBuffers.p1)
        : undefined,
      p2: showP2 && locks.p2 && moveBuffers.p2.length > 0
        ? computeCommittedPath(gameState.snakes.find(snake => snake.id === 'p2')!, moveBuffers.p2)
        : undefined,
    };
  }, [settings.turnBased, replayActive, locks, moveBuffers, gameState, playMode, viewerSeat]);

  const bridgeSeatRef = useRef<'p1' | 'p2'>('p1');
  const soloAiP2OverriddenRef = useRef(false);
  const dispatchAiState = useCallback((state: GameState = stateRef.current) => {
    window.dispatchEvent(new CustomEvent<GameState>('snake-ai-state', {
      detail: cloneGameState(state, state.gridSize ?? settingsRef.current.gridSize),
    }));
  }, []);

  const settingsRef = useRef<GameSettings>(settings);
  settingsRef.current = settings;

  const playModeRef = useRef<PlayMode>(playMode);
  playModeRef.current = playMode;

  const onlineRoleRef = useRef<'p1' | 'p2' | 'spectator' | 'server' | null>(onlineRole);
  onlineRoleRef.current = onlineRole;

  const isBuiltInAiActive = useCallback(
    () => playModeRef.current === 'SOLO_AI' && !soloAiP2OverriddenRef.current,
    [],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('snake-ai-mode', aiMode);
    return () => document.documentElement.classList.remove('snake-ai-mode');
  }, [aiMode]);

  // Active menu handler ref for zero-re-render gamepad/keyboard dispatch
  const activeHandlerRef = useRef<((action: GamepadMenuAction) => void) | null>(null);

  // The think-time model is the sole source of last-turn and cumulative times.
  const thinkRef = useRef(createThinkTimeModel(gameState.snakes.map(snake => snake.id)));
  const applyThinkTransition = useCallback((event: ThinkTimeEvent) => {
    const nextModel = transitionThinkTime(thinkRef.current, event);
    if (nextModel === thinkRef.current) return;
    thinkRef.current = nextModel;
    const nextState = applyThinkTimeModel(stateRef.current, nextModel);
    stateRef.current = nextState;
    setGameState(prev => applyThinkTimeModel(prev, nextModel));
  }, []);
  const thinkSessions = Object.fromEntries(Object.entries(thinkRef.current.sessions).map(([id, session]) =>
    [id, { startTime: session.planningStartedAt }],
  ));

  const maybeOpenPlanningSessions = useCallback(() => {
    const mode = playModeRef.current;
    const events = getPlanningEnteredEvents(
      stateRef.current,
      locksRef.current,
      mode,
      Date.now(),
      isBuiltInAiActive(),
    );
    for (const event of events) applyThinkTransition(event);
  }, [applyThinkTransition, isBuiltInAiActive]);

  const commitLocks = useCallback((
    nextLocks: Record<string, boolean>,
    emitState = true,
  ) => {
    const previousLocks = locksRef.current;
    locksRef.current = nextLocks;
    setLocks(nextLocks);

    const mode = playModeRef.current;
    const events = getThinkTimeLockEvents(previousLocks, nextLocks, Date.now());
    if (mode === 'ONLINE_JOIN') {
      const ownSeat = onlineRoleRef.current;
      if (ownSeat === 'p1' || ownSeat === 'p2') {
        for (const event of events) {
          if (event.player !== ownSeat) continue;
          applyThinkTransition(
            event.type === 'PLANNING_ENTERED'
              ? event
              : { type: 'CANCEL', player: ownSeat },
          );
        }
      }
    } else if (mode !== 'ONLINE_SPECTATOR') {
      for (const event of events) {
        if (event.player !== 'p1' && isBuiltInAiActive()) continue;
        if (event.type === 'PLANNING_ENTERED') {
          const state = stateRef.current;
          if (state.phase === 'OVER' || !state.snakes.find(snake => snake.id === event.player)?.isAlive) continue;
        }
        applyThinkTransition(event);
      }
      maybeOpenPlanningSessions();
    }
    if (emitState) dispatchAiState();
  }, [applyThinkTransition, dispatchAiState, isBuiltInAiActive, maybeOpenPlanningSessions]);

  const getTargetKey = useCallback((
    playerSlot: 1 | 2,
    bridgeSeat?: 'p1' | 'p2',
  ): 'p1' | 'p2' => {
    if (
      bridgeSeat &&
      (playModeRef.current === 'SOLO_AI' || playModeRef.current === 'LOCAL_2P')
    ) return bridgeSeat;
    if (playModeRef.current === 'SOLO_AI') return 'p1';
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') return 'p1';
    if (playModeRef.current === 'ONLINE_JOIN') return onlineRoleRef.current === 'p1' ? 'p1' : 'p2';
    if (playModeRef.current === 'LOCAL_2P') return playerSlot === 2 ? 'p2' : 'p1';
    return 'p1';
  }, []);

  const handleSkillButton = useCallback((playerSlot: 1 | 2) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;
    const targetKey = getTargetKey(playerSlot);
    const snake = current.snakes.find(s => s.id === targetKey);
    if (!snake || !snake.isAlive) return;

    const skillsAvail = current.skillsAvailable ?? settingsRef.current.skillsAvailable;
    if (!canActivateSkill(snake, current, skillsAvail)) return;

    soundEngine.playTick();
    setChoosingSkillMap(prev => {
      const nextVal = !prev[targetKey];
      const updated = { ...prev, [targetKey]: nextVal };
      choosingSkillMapRef.current = updated;
      return updated;
    });
  }, [getTargetKey, inLobby, inOnlineLobby]);

  const setLock = useCallback((who: string, isAuto = false) => {
    const mode = playModeRef.current;
    const isOnline = mode === 'ONLINE_HOST' || mode === 'ONLINE_JOIN' || mode === 'ONLINE_SERVER';
    const isAuthority = mode === 'ONLINE_HOST' || mode === 'ONLINE_SERVER';
    if (
      isOnline &&
      !canLockOnlineMatch(
        stateRef.current.readyConfirmed,
        isAuthority,
        joinerAcknowledgedMatchStartRef.current,
      )
    ) return false;

    thinkTimeEndsRef.current = { ...thinkTimeEndsRef.current, [who]: null };
    lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: null };
    notifiedPlanningWindowRef.current = { ...notifiedPlanningWindowRef.current, [who]: false };
    setThinkTimeRemaining(prev => ({ ...prev, [who]: null }));
    commitLocks({ ...locksRef.current, [who]: true });
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
      networkManager.broadcastState(stateRef.current, locksRef.current);
    }
    turnDecisionsRef.current.push({
      tick: stateRef.current.tick,
      seat: who,
      queue: [...moveBuffersRef.current[who]],
      lockedAt: Date.now(),
      autoLock: isAuto,
    });
    return true;
  }, [commitLocks]);

  const clearLocks = useCallback(() => {
    const playerIds = stateRef.current.snakes.map(snake => snake.id);
    thinkTimeEndsRef.current = Object.fromEntries(playerIds.map(id => [id, null]));
    lastThinkTimeTickRef.current = Object.fromEntries(playerIds.map(id => [id, null]));
    notifiedPlanningWindowRef.current = Object.fromEntries(playerIds.map(id => [id, false]));
    thinkTimeRemainingRef.current = Object.fromEntries(playerIds.map(id => [id, null]));
    setThinkTimeRemaining(thinkTimeRemainingRef.current);
    locksRef.current = Object.fromEntries(playerIds.map(id => [id, false]));
    setLocks(locksRef.current);
    applyThinkTransition({ type: 'RESET' });
    clearMoveBuffers();
  }, [applyThinkTransition, clearMoveBuffers]);

  const playTickEvents = useCallback((events: {
    tokenEaten: Record<string, boolean>;
    shrinkTelegraphStarted: boolean;
    ringShrunk: boolean;
    deathOccurred: boolean;
    matchEnded: boolean;
  }) => {
    if (Object.values(events.tokenEaten).some(Boolean)) soundEngine.playTokenEat();
    if (events.shrinkTelegraphStarted) soundEngine.playShrinkWarning();
    if (events.ringShrunk) soundEngine.playRingShrunk();
    if (events.deathOccurred) soundEngine.playCrash();
    if (events.matchEnded) soundEngine.playVictory();
  }, []);

  const turnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearHitstop = useCallback(() => {
    if (hitstopTimerRef.current) {
      clearTimeout(hitstopTimerRef.current);
      hitstopTimerRef.current = null;
    }
    if (fatalMoveTimerRef.current) {
      clearTimeout(fatalMoveTimerRef.current);
      fatalMoveTimerRef.current = null;
    }
    hitstopUntilRef.current = 0;
    activeHitstopRef.current = null;
    setActiveHitstop(null);
    fatalMoveSnakesRef.current = [];
    setFatalMoveSnakes([]);
  }, []);

  const triggerHitstop = useCallback((
    prevState: GameState | null | undefined,
    nextState: GameState,
    onResume?: () => void,
  ): number => {
    if (aiMode || inLobby || inOnlineLobby || replayActive) {
      onResume?.();
      return 0;
    }
    const isCampaign = Boolean(
      campaignPlaytestLevel ||
      settingsRef.current.levelId ||
      nextState.campaignObjectives ||
      nextState.campaignTokenRules,
    );
    const info = getHitstopForTransition(prevState, nextState, isCampaign);
    if (!info) {
      onResume?.();
      return 0;
    }

    const newlyDeadIds = prevState
      ? nextState.snakes
          .filter(snake => {
            const prevSnake = prevState.snakes.find(candidate => candidate.id === snake.id);
            return prevSnake?.isAlive && !snake.isAlive;
          })
          .map(snake => snake.id)
      : [];

    if (hitstopTimerRef.current) {
      clearTimeout(hitstopTimerRef.current);
    }
    if (fatalMoveTimerRef.current) {
      clearTimeout(fatalMoveTimerRef.current);
      fatalMoveTimerRef.current = null;
    }
    fatalMoveSnakesRef.current = [];
    setFatalMoveSnakes([]);
    hitstopUntilRef.current = Date.now() + info.durationMs;
    activeHitstopRef.current = info;
    setActiveHitstop(info);
    hitstopTimerRef.current = setTimeout(() => {
      hitstopTimerRef.current = null;
      hitstopUntilRef.current = 0;
      activeHitstopRef.current = null;
      setActiveHitstop(null);

      if ((info.kind === 'DEATH' || info.kind === 'BOSS_DEATH') && newlyDeadIds.length > 0) {
        fatalMoveSnakesRef.current = newlyDeadIds;
        setFatalMoveSnakes(newlyDeadIds);
        fatalMoveTimerRef.current = setTimeout(() => {
          fatalMoveTimerRef.current = null;
          fatalMoveSnakesRef.current = [];
          setFatalMoveSnakes([]);
          onResume?.();
        }, 220);
      } else {
        onResume?.();
      }
    }, info.durationMs);
    return info.durationMs;
  }, [aiMode, campaignPlaytestLevel, inLobby, inOnlineLobby, replayActive]);

  useEffect(() => {
    return () => {
      if (turnTimeoutRef.current) {
        clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
      if (hitstopTimerRef.current) {
        clearTimeout(hitstopTimerRef.current);
        hitstopTimerRef.current = null;
      }
      if (fatalMoveTimerRef.current) {
        clearTimeout(fatalMoveTimerRef.current);
        fatalMoveTimerRef.current = null;
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
    const isAuthority = playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER';
    if (
      isOnline &&
      !canLockOnlineMatch(
        current.readyConfirmed,
        isAuthority,
        joinerAcknowledgedMatchStartRef.current,
      )
    ) return;

    // Force the AI to replan every tick: clear its queued buffer and lock so
    // the planning below always runs from the live board. (The human player's
    // lock persists — their queued moves are their own commitment.)
    // Only for actual AI snakes: in LOCAL_2P, P2 is human and their buffer
    // must persist like P1's.
    if (isBuiltInAiActive()) {
      for (const snake of current.snakes) {
        if (snake.isAlive && snake.id !== 'p1') {
          moveBuffersRef.current[snake.id] = [];
          locksRef.current[snake.id] = false;
        }
      }
    }
    const aiSnakes = current.snakes.filter(snake =>
      snake.isAlive &&
      snake.id !== 'p1' &&
      !locksRef.current[snake.id],
    );
    if (isBuiltInAiActive()) {
      for (const aiSnake of aiSnakes) {
        // Replan from the live board EVERY tick into a HIDDEN plan (her brain).
        // The visible queue only ever shows LOCKED moves — the plan is never
        // displayed mid-thought. Lock length is dynamic by confidence: 1 careful
        // move when tight, up to 3 when wide open. Like a person: think, then
        // buffer, then lock.
        const hiddenPlan: NonNullable<(typeof moveBuffersRef.current)[string]> = [];
        let curDir = aiSnake.direction;
        let simBody = [...aiSnake.body];
        const planLen = Math.min(3, aiSnake.body.length);
        const botStyle = s.campaignAiStyles?.[aiSnake.id] ?? s.aiStyle;
        const botDifficulty = s.campaignAiDifficulties?.[aiSnake.id] ?? s.botDifficulty;
        for (let i = 0; i < planLen; i++) {
          const action = calculateAIAction({
            ...current,
            snakes: current.snakes.map(snake => snake.id === aiSnake.id
              ? { ...snake, body: simBody, direction: curDir }
              : snake),
          }, s.gridSize, aiSnake.id, botDifficulty, botStyle, current.skillsAvailable);
          // Skill path: the brain may decide to dart. Same legality rules
          // as the player (direction validated against the last entry,
          // escrow affordability) before a dart entry goes in the plan.
          const skillDir = action.skill?.skillId === 'dart' ? action.skill.direction : null;
          const queuedDarts = hiddenPlan.filter(entry => typeof entry !== 'string' && entry.type === 'dart').length;
          if (skillDir && isValidDartDirection(curDir, skillDir) &&
              canAffordQueuedDart(aiSnake.skillPoints, queuedDarts)) {
            hiddenPlan.push({ type: 'dart', direction: skillDir });
            curDir = skillDir;
            for (let k = 0; k < 3; k++) {
              simBody.unshift(getNextHeadPosition(simBody[0], skillDir));
              simBody.pop();
            }
            continue;
          }
          const aiDir = action.direction;
          if (aiDir && !isOppositeDirection(curDir, aiDir)) {
            hiddenPlan.push({ type: 'move', direction: aiDir });
            curDir = aiDir;
            const nextHead = getNextHeadPosition(simBody[0], aiDir);
            simBody.unshift(nextHead);
            simBody.pop();
          } else {
            break;
          }
        }
        if (hiddenPlan.length === 0) {
          const fallback = ['UP', 'DOWN', 'LEFT', 'RIGHT'].find(d => !isOppositeDirection(curDir, d as Direction)) as Direction || 'LEFT';
          hiddenPlan.push({ type: 'move', direction: fallback });
        }
        // Dynamic lock: how many of the hidden plan to commit visibly.
        // If the destination after move 0 is tight (<=1 safe escape), lock just
        // 1 and reassess next tick. In open space, lock the full plan.
        // A dart always locks as a single committed entry (its 3 cells are atomic).
        let lockCount = hiddenPlan.length;
        const firstEntry = hiddenPlan[0];
        const firstIsDart = typeof firstEntry !== 'string' && firstEntry.type === 'dart';
        if (!firstIsDart && hiddenPlan.length > 1) {
          // Simulate the board after move 0 to count escape routes.
          const afterMove0 = [...aiSnake.body];
          const firstDir = (firstEntry as { direction: Direction }).direction;
          const dest = getNextHeadPosition(afterMove0[0], firstDir);
          afterMove0.unshift(dest);
          afterMove0.pop();
          const allBodies = new Set<string>();
          for (const snake of current.snakes) {
            const body = snake.id === aiSnake.id ? afterMove0 : snake.body;
            for (const seg of body) allBodies.add(`${seg.x},${seg.y}`);
          }
          let safeEscapes = 0;
          for (const d of ['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[]) {
            if (isOppositeDirection(firstDir, d)) continue;
            const n = getNextHeadPosition(dest, d);
            if (isCellInArena(n, s.gridSize, current.ringInset) && !allBodies.has(`${n.x},${n.y}`)) {
              safeEscapes++;
            }
          }
          if (safeEscapes <= 1) lockCount = 1;
        }
        const aiBuffer = hiddenPlan.slice(0, lockCount);
        moveBuffersRef.current = { ...moveBuffersRef.current, [aiSnake.id]: aiBuffer };
        agentDrivenRef.current[aiSnake.id] = true;
        commitLocks({ ...locksRef.current, [aiSnake.id]: true });
        turnDecisionsRef.current.push({
          tick: current.tick,
          seat: aiSnake.id,
          queue: [...aiBuffer],
          lockedAt: Date.now(),
          autoLock: false,
        });
        applyThinkTransition({ type: 'CANCEL', player: aiSnake.id });
      }
      setMoveBuffers({ ...moveBuffersRef.current });
    }

    for (const snake of current.snakes) {
      if (!snake.isAlive) continue;
      if (!locksRef.current[snake.id]) return;
    }
    for (const snake of current.snakes) {
      if (!snake.isAlive) continue;
      const buffer = moveBuffersRef.current[snake.id] ?? [];
      const entry = buffer.shift();
      if (entry) {
        // Defensive: handle legacy raw direction strings
        if (typeof entry === 'string') {
          queueSnakeDirection(snake, entry as Direction);
        } else if (entry.type === 'dart') {
          queueSnakeSkill(snake, { skillId: 'dart', direction: entry.direction });
        } else {
          queueSnakeDirection(snake, entry.direction);
        }
      } else {
        queueSnakeDirection(snake, snake.direction);
      }
    }

    const prevState = stateRef.current;
    const { nextState, events } = processGameTick(prevState, s, 0);
    playTickEvents(events);

    const nextBuffers = Object.fromEntries(nextState.snakes.map(snake => [
      snake.id,
      snake.isAlive ? [...(moveBuffersRef.current[snake.id] ?? [])] : [],
    ]));
    moveBuffersRef.current = nextBuffers;
    setMoveBuffers(nextBuffers);

    const nextLocks = Object.fromEntries(nextState.snakes.map(snake => [
      snake.id,
      snake.isAlive && nextBuffers[snake.id].length > 0 && locksRef.current[snake.id],
    ]));
    stateRef.current = nextState;

    setGameState(nextState);
    setMatchHistory(prev => [...prev, nextState]);
    dispatchAiState(nextState);

    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
      networkManager.broadcastState(nextState, nextLocks);
    }

    const openNextLockPhase = () => {
      const mergedLocks = Object.fromEntries(stateRef.current.snakes.map(snake => [
        snake.id,
        snake.isAlive && (moveBuffersRef.current[snake.id]?.length ?? 0) > 0 && Boolean(nextLocks[snake.id] || locksRef.current[snake.id]),
      ]));
      commitLocks(mergedLocks, false);

      const canProgress =
        nextState.phase !== 'OVER' &&
        nextState.snakes
          .filter(snake => snake.isAlive)
          .every(snake =>
            (moveBuffersRef.current[snake.id]?.length ?? 0) > 0 ||
            (isBuiltInAiActive() && snake.id !== 'p1')
          );

      if (canProgress && aiMode) {
        queueMicrotask(() => {
          turnTimeoutRef.current = null;
          maybeAdvanceTurn();
        });
      } else if (canProgress) {
        turnTimeoutRef.current = setTimeout(() => {
          turnTimeoutRef.current = null;
          maybeAdvanceTurn();
        }, 550);
      }
    };

    const freezeMs = triggerHitstop(prevState, nextState, openNextLockPhase);
    // Dart resolution effects: zing sound + haptics
    if (nextState.dartTrail && nextState.dartTrail.length > 0) {
      soundEngine.playDart();
      for (const trail of nextState.dartTrail) {
        const who = trail.snakeId;
        // Controller rumble for the darting player's gamepad
        const slot = who === 'p2' ? 2 : 1;
        gamepadController.rumble(slot);
        // Phone vibration
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(50);
        }
      }
    }
    if (freezeMs > 0) {
      // During hitstop between board resolution and next lock phase, release
      // human seat locks so inputs pressed during the freeze buffer cleanly,
      // while deferring planning session opening until hitstop finishes.
      locksRef.current = nextLocks;
      setLocks(nextLocks);
    }
  }, [aiMode, applyThinkTransition, campaignPlaytestLevel, commitLocks, dispatchAiState, isBuiltInAiActive, playTickEvents, triggerHitstop]);

  const autoLockPlayer = useCallback((who: string) => {
    if (locksRef.current[who]) return;
    const current = stateRef.current;
    const buffer = moveBuffersRef.current[who];

    if (!setLock(who, true)) return;
    if (playModeRef.current === 'ONLINE_JOIN') {
      if (buffer.length > 0 && sentTickRef.current !== current.tick) {
        sentTickRef.current = current.tick;
        networkManager.sendInput(buffer[0].direction, current.tick);
      }
      return;
    }

    maybeAdvanceTurn();
  }, [maybeAdvanceTurn, setLock]);

  useEffect(() => {
    if (!settings.turnBased) {
      thinkTimeEndsRef.current = { p1: null, p2: null };
      lastThinkTimeTickRef.current = { p1: null, p2: null };
      thinkTimeRemainingRef.current = { p1: null, p2: null };
      notifiedPlanningWindowRef.current = { p1: false, p2: false };
      setThinkTimeRemaining({ p1: null, p2: null });
      return;
    }

    if (settings.thinkTimeSeconds === null) {
      thinkTimeEndsRef.current = { p1: null, p2: null };
      lastThinkTimeTickRef.current = { p1: null, p2: null };
      thinkTimeRemainingRef.current = { p1: null, p2: null };
      setThinkTimeRemaining({ p1: null, p2: null });
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
        Date.now() >= hitstopUntilRef.current &&
        current.phase !== 'OVER' &&
        (!isOnline || (ready?.p1 && ready?.p2));

      (['p1', 'p2'] as const).forEach(who => {
        const isOwnSeat =
          mode === 'LOCAL_2P' ||
          (mode === 'SOLO_AI' && (who === 'p1' || !isBuiltInAiActive())) ||
          (mode === 'ONLINE_HOST' && who === 'p1') ||
          (mode === 'ONLINE_JOIN' && onlineRoleRef.current === who);
        const isAuthority =
          mode !== 'ONLINE_JOIN' &&
          mode !== 'ONLINE_SPECTATOR' &&
          !(mode === 'SOLO_AI' && who === 'p2' && isBuiltInAiActive());
        const snake = current.snakes.find(candidate => candidate.id === who);

        if (
          !matchActive ||
          !isOwnSeat && !isAuthority ||
          !snake?.isAlive ||
          locksRef.current[who]
        ) {
          clearCountdown(who);
          if (notifiedPlanningWindowRef.current[who]) {
            notifiedPlanningWindowRef.current = { ...notifiedPlanningWindowRef.current, [who]: false };
          }
          return;
        }

        if (thinkTimeEndsRef.current[who] === null) {
          if (moveBuffersRef.current[who].length > 0) return;

          if (settings.thinkTimeSeconds !== null) {
            const endsAt = Date.now() + settings.thinkTimeSeconds * 1000;
            thinkTimeEndsRef.current = { ...thinkTimeEndsRef.current, [who]: endsAt };
            const initialCount = settings.thinkTimeSeconds;
            lastThinkTimeTickRef.current = { ...lastThinkTimeTickRef.current, [who]: initialCount };
            thinkTimeRemainingRef.current = { ...thinkTimeRemainingRef.current, [who]: initialCount };
            setThinkTimeRemaining({ ...thinkTimeRemainingRef.current });
          }
          if (!notifiedPlanningWindowRef.current[who]) {
            notifiedPlanningWindowRef.current = { ...notifiedPlanningWindowRef.current, [who]: true };
            soundEngine.playThinkTimeTick();
            if (isOwnSeat) {
              const slot = mode === 'LOCAL_2P' && who === 'p2' ? 2 : 1;
              gamepadController.rumble(slot);
            }
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
    isBuiltInAiActive,
  ]);

  const handleBufferUndo = useCallback((playerSlot: 1 | 2) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return;
    const targetKey = getTargetKey(playerSlot);
    if (choosingSkillMapRef.current[targetKey]) {
      setChoosingSkillMap(prev => {
        const updated = { ...prev, [targetKey]: false };
        choosingSkillMapRef.current = updated;
        return updated;
      });
      soundEngine.playTick();
      return;
    }
    if (!settingsRef.current.turnBased) return;
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

  const handleBufferLock = useCallback((
    playerSlot: 1 | 2,
    bridgeSeat?: 'p1' | 'p2',
  ) => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby || !settingsRef.current.turnBased) return;
    const targetKey = getTargetKey(playerSlot, bridgeSeat);
    const buf = moveBuffersRef.current[targetKey];
    if (buf.length === 0 || locksRef.current[targetKey]) return;

    soundEngine.playTick();
    if (!setLock(targetKey)) return;

    if (playModeRef.current === 'ONLINE_JOIN') {
      if (sentTickRef.current !== current.tick) {
        sentTickRef.current = current.tick;
        networkManager.sendInput(buf[0].direction, current.tick);
      }
      return;
    }

    maybeAdvanceTurn();
  }, [inLobby, inOnlineLobby, maybeAdvanceTurn, setLock, getTargetKey]);

  const handleDirectionInput = useCallback((
    playerSlot: 1 | 2,
    dir: Direction,
    bridgeSeat?: 'p1' | 'p2',
  ): boolean => {
    const current = stateRef.current;
    if (current.phase === 'OVER' || inLobby || inOnlineLobby) return false;
    if (playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') return false;
    if (playModeRef.current === 'ONLINE_HOST' && !joinerAcknowledgedMatchStartRef.current) return false;

    const targetKey = getTargetKey(playerSlot, bridgeSeat);

    const currentSnake = current.snakes.find(snake => snake.id === targetKey);
    if (!currentSnake || !currentSnake.isAlive) return false;

    if (choosingSkillMapRef.current[targetKey]) {
      setChoosingSkillMap(prev => {
        const updated = { ...prev, [targetKey]: false };
        choosingSkillMapRef.current = updated;
        return updated;
      });
      // Queue dart as a buffer entry — no auto-lock, player continues planning
      if (settingsRef.current.turnBased) {
        if (locksRef.current[targetKey]) return false;
        const buf = [...moveBuffersRef.current[targetKey]];
        if (buf.length >= currentSnake.body.length) return false;
        // Item 1: validate against the last queued entry's direction — the same
        // ruler regular moves use — not the snake's current heading.
        const lastEntry = buf.length > 0 ? buf[buf.length - 1] : null;
        const lastDir = lastEntry && typeof lastEntry !== 'string' ? lastEntry.direction : currentSnake.direction;
        if (!isValidDartDirection(lastDir, dir)) {
          soundEngine.playDenied();
          return false;
        }
        // Item 3d: escrow — direction first, then affordability. A dart rejected
        // for illegal direction consumes no escrow. Reserved count is derived
        // from the buffer, so undo/clear refunds are automatic.
        const queuedDarts = buf.filter(entry => typeof entry !== 'string' && entry.type === 'dart').length;
        if (!canAffordQueuedDart(currentSnake.skillPoints, queuedDarts)) {
          soundEngine.playDenied();
          return false;
        }
        soundEngine.playTick();
        buf.push({ type: 'dart', direction: dir });
        moveBuffersRef.current = { ...moveBuffersRef.current, [targetKey]: buf };
        setMoveBuffers({ ...moveBuffersRef.current });
      } else {
        if (!isValidDartDirection(currentSnake.direction, dir)) {
          soundEngine.playDenied();
          return false;
        }
        soundEngine.playTick();
        currentSnake.pendingSkill = { skillId: 'dart' as SkillId, direction: dir };
        const snakeCopy = { ...currentSnake, pendingSkill: { skillId: 'dart' as SkillId, direction: dir } };
        setGameState(prev => ({
          ...prev,
          snakes: prev.snakes.map(s => s.id === targetKey ? snakeCopy : s),
        }));
      }
      return true;
    }

    soundEngine.playTick();

    if (settingsRef.current.turnBased) {
      if (locksRef.current[targetKey]) return false;

      const buf = [...moveBuffersRef.current[targetKey]];
      if (buf.length >= currentSnake.body.length) return false;

      const lastEntry = buf.length > 0 ? buf[buf.length - 1] : null;
      const lastDir = lastEntry ? lastEntry.direction : currentSnake.direction;
      if (isOppositeDirection(lastDir, dir)) return false;

      buf.push({ type: 'move', direction: dir });
      moveBuffersRef.current = { ...moveBuffersRef.current, [targetKey]: buf };
      setMoveBuffers({ ...moveBuffersRef.current });
      return true;
    }

    if (playModeRef.current === 'ONLINE_JOIN') {
      if (Date.now() < hitstopUntilRef.current) {
        const q = realTimeInputBufferRef.current[targetKey] ?? [];
        const lastDir = q.length > 0 ? q[q.length - 1] : (currentSnake.queuedDirection || currentSnake.direction);
        if (isOppositeDirection(lastDir, dir)) return false;
        realTimeInputBufferRef.current[targetKey] = [...q, dir];
      }
      networkManager.sendInput(dir, current.tick);
      const snakeCopy = { ...current.snakes.find(snake => snake.id === targetKey)!, queuedDirection: dir };
      setGameState(prev => ({
        ...prev,
        snakes: prev.snakes.map(snake => snake.id === targetKey ? snakeCopy : snake),
      }));
      return true;
    }

    if (Date.now() < hitstopUntilRef.current) {
      const q = realTimeInputBufferRef.current[targetKey] ?? [];
      const lastDir = q.length > 0 ? q[q.length - 1] : (currentSnake.queuedDirection || currentSnake.direction);
      if (isOppositeDirection(lastDir, dir)) return false;
      realTimeInputBufferRef.current[targetKey] = [...q, dir];
      if (!currentSnake.queuedDirection && !isOppositeDirection(currentSnake.direction, dir)) {
        currentSnake.queuedDirection = dir;
        const snakeCopy = { ...currentSnake, queuedDirection: dir };
        setGameState(prev => ({
          ...prev,
          snakes: prev.snakes.map(snake => snake.id === targetKey ? snakeCopy : snake),
        }));
      }
      return true;
    }

    if (!queueSnakeDirection(currentSnake, dir)) return false;
    const snakeCopy = { ...currentSnake, queuedDirection: dir };
    setGameState(prev => ({
      ...prev,
      snakes: prev.snakes.map(snake => snake.id === targetKey ? snakeCopy : snake),
    }));
    return true;
  }, [getTargetKey, inLobby, inOnlineLobby]);

  const getBridgeSeat = useCallback((): 'p1' | 'p2' | null => {
    const mode = playModeRef.current;
    if (mode === 'LOCAL_2P' || mode === 'SOLO_AI') return bridgeSeatRef.current;
    if (mode === 'ONLINE_HOST') return 'p1';
    if (mode === 'ONLINE_JOIN') {
      return onlineRoleRef.current === 'p1' || onlineRoleRef.current === 'p2'
        ? onlineRoleRef.current
        : null;
    }
    if (mode === 'ONLINE_SERVER' || mode === 'ONLINE_SPECTATOR') return null;
    return 'p1';
  }, []);

  const queueBridgeMoves = useCallback((moves: Direction[]): Direction[] => {
    const seat = getBridgeSeat();
    if (!seat) return [];

    const accepted: Direction[] = [];
    const slot: 1 | 2 = seat === 'p1' ? 1 : 2;
    for (const direction of moves) {
      if (!['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(direction)) continue;
      const snake = stateRef.current.snakes.find(candidate => candidate.id === seat);
      if (!snake) return [];
      if (
        settingsRef.current.turnBased &&
        moveBuffersRef.current[seat].length >= snake.body.length
      ) break;
      if (handleDirectionInput(slot, direction, seat)) accepted.push(direction);
    }
    return accepted;
  }, [getBridgeSeat, handleDirectionInput]);

  const lockBridgeSeat = useCallback(() => {
    const seat = getBridgeSeat();
    if (!seat) return;
    handleBufferLock(seat === 'p1' ? 1 : 2, seat);
  }, [getBridgeSeat, handleBufferLock]);

  useEffect(() => {
    if (
      !onlineRoomId ||
      (playMode !== 'ONLINE_HOST' && playMode !== 'ONLINE_JOIN')
    ) return;

    const seat = getBridgeSeat();
    if (!seat || onlineRole !== seat) return;

    const commandPath = `bridges/${onlineRoomId}/${seat}`;
    const commandRef = ref(rtdb, commandPath);
    const unsubscribe = onValue(
      commandRef,
      snapshot => {
        const command = snapshot.val();
        const lastAppliedEntry = lastBridgeCommandSequencesRef.current[commandPath];
        const lastAppliedSeq = lastAppliedEntry?.matchId === command?.matchId ? lastAppliedEntry.seq : -1;
        if (!shouldApplyRtdbBridgeCommand(command, activeMatchRef.current?.matchId ?? null, lastAppliedSeq)) {
          return;
        }

        agentDrivenRef.current[seat] = true;
        if (command.moves) queueBridgeMoves(command.moves);
        if (command.lock) lockBridgeSeat();
        lastBridgeCommandSequencesRef.current[commandPath] = { matchId: command.matchId, seq: command.seq };
      },
      error => console.error(`AI bridge RTDB listener failed for ${commandPath}:`, error),
    );

    return unsubscribe;
  }, [getBridgeSeat, lockBridgeSeat, onlineRole, onlineRoomId, playMode, queueBridgeMoves]);

  const selectBridgeSeat = useCallback((seat: 'p1' | 'p2') => {
    const mode = playModeRef.current;
    if (mode !== 'LOCAL_2P' && mode !== 'SOLO_AI') return;
    bridgeSeatRef.current = seat;
    if (mode === 'SOLO_AI' && seat === 'p2') soloAiP2OverriddenRef.current = true;
  }, []);

  const subscribeAiState = useCallback((
    cb: (state: GameState | CompactGameState) => void,
    opts?: { compact?: boolean },
  ) => {
    const listener = (event: Event) => {
      const state = (event as CustomEvent<GameState>).detail;
      const gSize = state.gridSize ?? settingsRef.current.gridSize;
      cb(opts?.compact ? toCompactGameState(state, locksRef.current, gSize) : state);
    };
    window.addEventListener('snake-ai-state', listener);
    return () => window.removeEventListener('snake-ai-state', listener);
  }, []);

  useEffect(() => {
    const bridge = {
      getSeat: getBridgeSeat,
      getState: (opts?: { compact?: boolean }) => {
        const state = stateRef.current;
        const gSize = state.gridSize ?? settingsRef.current.gridSize;
        return opts?.compact
          ? toCompactGameState(state, locksRef.current, gSize)
          : cloneGameState(state, gSize);
      },
      queueMoves: queueBridgeMoves,
      lock: lockBridgeSeat,
      selectSeat: selectBridgeSeat,
      onState: subscribeAiState,
    };
    window.__SNAKE_AI__ = bridge;
    return () => {
      if (window.__SNAKE_AI__ === bridge) delete window.__SNAKE_AI__;
    };
  }, [getBridgeSeat, lockBridgeSeat, queueBridgeMoves, selectBridgeSeat, subscribeAiState]);

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
    clearHitstop();
    realTimeInputBufferRef.current = {};
    if (campaignPlaytestLevel) {
      window.location.hash = '#/level-editor';
      return;
    }
    setGameOverConfirmed(false);
    if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_JOIN' || playModeRef.current === 'ONLINE_SERVER' || playModeRef.current === 'ONLINE_SPECTATOR') {
      networkManager.disconnect();
      setBridgeSecret(null);
      setSeries({ p1: 0, p2: 0, draws: 0 });
      setPlayerNames({ p1: 'PLAYER 1', p2: 'PLAYER 2' });
    }
    const initial = createLobbyState(settingsRef.current);
    stateRef.current = initial;
    setGameState(initial);
    dispatchAiState(initial);
    setInLobby(true);
    setInOnlineLobby(false);
    setReplayActive(false);
    setSettingsModalOpen(false);
    setLatencyModalOpen(false);
    turnDecisionsRef.current = [];
    agentDrivenRef.current = { p1: false, p2: false };
  }, [campaignPlaytestLevel]);

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
      } else if (button === 'NORTH') {
        handleSkillButton(targetSlot);
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
        (gameState.phase === 'OVER' && !activeHitstopRef.current && fatalMoveSnakesRef.current.length === 0) ||
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
      if (e.code === 'KeyE') {
        handleSkillButton(1);
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyO') {
        handleSkillButton(2);
        e.preventDefault();
        return;
      }
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
        const playMode = playModeRef.current;
        if (playMode === 'LOCAL_2P') {
          handleBufferLock(e.key === ' ' ? 2 : 1);
          e.preventDefault();
          return;
        }

        const isOnline = playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER';
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
          if (typeof msg.matchId === 'string' && Number.isSafeInteger(msg.matchNumber)) {
            activeMatchRef.current = { matchId: msg.matchId, matchNumber: msg.matchNumber };
          } else {
            activeMatchRef.current = null;
          }
          lastStateRevisionRef.current = -1;
          lastStateTickRef.current = -1;
          sentTickRef.current = -1;
          lastInputSequenceRef.current = { p1: 0, p2: 0 };
          clearLocks();
          setMatchHistory([]);
          turnDecisionsRef.current = [];
          agentDrivenRef.current = { p1: false, p2: false };
          setReplayActive(false);
          setReplayIdx(0);
          setReplayPlaying(false);
          if (msg.settings) adoptRoomSettings(msg.settings);
          break;
        }

        case 'MATCH_START': {
          if (typeof msg.matchId !== 'string' || !Number.isSafeInteger(msg.matchNumber)) break;
          const incomingMatch = { matchId: msg.matchId, matchNumber: msg.matchNumber };
          if (!canAdoptMatch(activeMatchRef.current, incomingMatch)) break;
          if (msg.settings) adoptRoomSettings(msg.settings);
          if (!isCurrentMatch(activeMatchRef.current, incomingMatch)) {
            activeMatchRef.current = incomingMatch;
            lastStateRevisionRef.current = -1;
            lastStateTickRef.current = -1;
            sentTickRef.current = -1;
            lastInputSequenceRef.current = { p1: 0, p2: 0 };
            clearLocks();
            setMatchHistory([]);
            turnDecisionsRef.current = [];
            agentDrivenRef.current = { p1: false, p2: false };
            setReplayActive(false);
            setReplayIdx(0);
            setReplayPlaying(false);
          }
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
            const incomingMatch = { matchId: msg.matchId, matchNumber: msg.matchNumber };
            if (
              typeof msg.matchId !== 'string' ||
              !Number.isSafeInteger(msg.matchNumber) ||
              !canAcceptState(activeMatchRef.current, lastStateRevisionRef.current, incomingMatch, msg.stateRevision)
            ) break;

            // Wire states (RTDB / WebRTC) can arrive with array fields
            // dropped or object-shaped; normalize before anything reads them.
            const safeState = normalizeGameState(msg.state);
            if (safeState.tick < lastStateTickRef.current) break;

            if (typeof safeState.gridSize === 'number' && safeState.gridSize !== settingsRef.current.gridSize) {
              adoptRoomSettings({ gridSize: safeState.gridSize });
            }

            const isNewTick = safeState.tick > lastStateTickRef.current;
            lastStateRevisionRef.current = msg.stateRevision;
            lastStateTickRef.current = safeState.tick;

            const prevState = stateRef.current;
            const snapshot = adoptThinkTimeSnapshot(thinkRef.current, safeState);
            thinkRef.current = snapshot.model;
            stateRef.current = snapshot.state;
            setGameState(snapshot.state);
            if (isNewTick) {
              triggerHitstop(prevState, snapshot.state);
            }
            setMatchHistory(prev => {
              if (prev.length === 0 || snapshot.state.tick > prev[prev.length - 1].tick) {
                return [...prev, snapshot.state];
              }
              if (snapshot.state.tick === prev[prev.length - 1].tick) {
                return [...prev.slice(0, -1), snapshot.state];
              }
              return prev;
            });

            if (msg.locks) {
              const myRole = onlineRoleRef.current;
              commitLocks({
                p1: myRole === 'p1' ? (moveBuffersRef.current.p1.length > 0 ? locksRef.current.p1 : msg.locks.p1) : msg.locks.p1,
                p2: myRole === 'p2' ? (moveBuffersRef.current.p2.length > 0 ? locksRef.current.p2 : msg.locks.p2) : msg.locks.p2,
              });
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
                      networkManager.sendInput(buf[0].direction, safeState.tick);
                    }
                  }
                }
                if (moveBuffersRef.current[myRole].length === 0) {
                  commitLocks({ ...locksRef.current, [myRole]: false });
                }
              }
            }

            if (
              playModeRef.current === 'ONLINE_JOIN' &&
              (onlineRoleRef.current === 'p1' || onlineRoleRef.current === 'p2') &&
              !locksRef.current[onlineRoleRef.current] &&
              areBothOnlinePlayersReady(snapshot.state.readyConfirmed) &&
              snapshot.state.phase !== 'OVER' &&
              snapshot.state.snakes.find(snake => snake.id === onlineRoleRef.current)?.isAlive
            ) {
              applyThinkTransition({
                type: 'PLANNING_ENTERED',
                player: onlineRoleRef.current,
                at: Date.now(),
              });
            }

            if (inOnlineLobby) {
              setInOnlineLobby(false);
              setInLobby(false);
            }
            dispatchAiState(stateRef.current);
          }
          break;
        }

        case 'INPUT_SYNC': {
          if (msg.role !== 'p1' && msg.role !== 'p2') break;
          const inputRole: 'p1' | 'p2' = msg.role;
          if (
            typeof msg.matchId !== 'string' ||
            !Number.isSafeInteger(msg.matchNumber) ||
            !isCurrentMatch(activeMatchRef.current, { matchId: msg.matchId, matchNumber: msg.matchNumber }) ||
            !isNewerSequence(msg.inputSequence, lastInputSequenceRef.current[inputRole])
          ) break;
          lastInputSequenceRef.current = { ...lastInputSequenceRef.current, [inputRole]: msg.inputSequence };

          const isAuthority =
            (playModeRef.current === 'ONLINE_HOST' && msg.role === 'p2') ||
            (playModeRef.current === 'ONLINE_SERVER' && (msg.role === 'p1' || msg.role === 'p2'));
          if (isAuthority && msg.dir) {
            const current = stateRef.current;
            if (
              !canLockOnlineMatch(
                current.readyConfirmed,
                true,
                joinerAcknowledgedMatchStartRef.current,
              )
            ) break;
            networkManager.recordTickLag(msg.tick, current.tick);
            const key = msg.role === 'p1' ? 'p1' : 'p2';
            const snake = current.snakes.find(candidate => candidate.id === key);
            if (!snake) break;
            const buf = [...moveBuffersRef.current[key]];
            if (buf.length < snake.body.length) {
              const lastEntry = buf.length > 0 ? buf[buf.length - 1] : null;
              const lastDir = lastEntry ? lastEntry.direction : snake.direction;
              if (!isOppositeDirection(lastDir, msg.dir)) {
                buf.push({ type: 'move', direction: msg.dir });
                moveBuffersRef.current = { ...moveBuffersRef.current, [key]: buf };
                setMoveBuffers({ ...moveBuffersRef.current });
              }
            }
            if (settingsRef.current.turnBased) {
              if (!setLock(key)) break;
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
              readyConfirmed: mergeOnlineReadyFlags(prev.readyConfirmed, msg.ready),
            }));
          }
          break;
        }

        case 'READY_CONFIRM': {
          if (msg.role === 'p1' || msg.role === 'p2') {
            setGameState(prev => {
              const cur = prev.readyConfirmed || Object.fromEntries(prev.snakes.map(snake => [snake.id, false]));
              const updated = { ...cur, [msg.role]: true };
              return { ...prev, readyConfirmed: updated };
            });
          }
          break;
        }

        case 'MATCH_START_ACK_SYNC': {
          if (
            (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') &&
            msg.role === 'p2' &&
            isMatchStartAcknowledged(activeMatchRef.current, msg.matchId)
          ) {
            joinerAcknowledgedMatchStartRef.current = true;
            setJoinerAcknowledgedMatchStart(true);
          }
          break;
        }

        case 'RESTART_MATCH': {
          const isAuthority =
            playModeRef.current === 'ONLINE_HOST' ||
            playModeRef.current === 'ONLINE_SERVER';
          if (isAuthority && msg.sender !== onlineRoleRef.current) {
            startNewMatchRef.current();
          }
          break;
        }
      }

      setLatencyReport(networkManager.getLatencyReport());
    });

    return () => {
      unsubscribe();
    };
  }, [inOnlineLobby, clearLocks, maybeAdvanceTurn, setLock, adoptRoomSettings, commitLocks, applyThinkTransition, dispatchAiState]);

  useEffect(() => {
    if (playMode !== 'ONLINE_JOIN' || inLobby || inOnlineLobby) return;
    const match = activeMatchRef.current;
    if (!match || acknowledgedMatchStartRef.current === match.matchId) return;

    acknowledgedMatchStartRef.current = match.matchId;
    hasAcknowledgedMatchStartRef.current = false;
    setHasAcknowledgedMatchStart(false);
    void networkManager.acknowledgeMatchStart(match).then(acknowledged => {
      if (acknowledged && activeMatchRef.current?.matchId === match.matchId) {
        hasAcknowledgedMatchStartRef.current = true;
        setHasAcknowledgedMatchStart(true);
      }
    });
  }, [gameState, inLobby, inOnlineLobby, playMode]);

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
      gridSize: gameState.gridSize ?? settings.gridSize,
      walls: gameState.walls ?? [],
      snakes: Object.fromEntries(gameState.snakes.map(snake => [snake.id, {
        head: snake.body[0] || { x: 0, y: 0 },
        body: snake.body,
        facing: snake.direction,
        score: snake.score,
        length: snake.body.length,
        locked: locks[snake.id] ?? false,
        isAlive: snake.isAlive,
      }])),
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
      if (Date.now() < hitstopUntilRef.current) return;
      const current = stateRef.current;
      if (current.phase === 'OVER') return;
      const isOnlineAuthority =
        playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER';
      if (
        isOnlineAuthority &&
        !canLockOnlineMatch(
          current.readyConfirmed,
          true,
          joinerAcknowledgedMatchStartRef.current,
        )
      ) return;

      for (const snake of current.snakes) {
        const buffered = realTimeInputBufferRef.current[snake.id];
        if (buffered && buffered.length > 0 && !snake.queuedDirection) {
          const nextDir = buffered.shift()!;
          queueSnakeDirection(snake, nextDir);
        }
      }

      if (isBuiltInAiActive()) {
        for (const bot of current.snakes.filter(snake =>
          snake.isAlive && snake.id !== 'p1',
        )) {
          const aiDir = calculateAIMove(
            current,
            settingsRef.current.gridSize,
            bot.id,
            settingsRef.current.campaignAiDifficulties?.[bot.id] ?? settingsRef.current.botDifficulty,
            settingsRef.current.campaignAiStyles?.[bot.id] ?? settingsRef.current.aiStyle,
          );
          if (aiDir) queueSnakeDirection(bot, aiDir);
        }
      }

      const { nextState, events } = processGameTick(current, settingsRef.current, tickIntervalMs);
      triggerHitstop(current, nextState);
      for (const snake of nextState.snakes) {
        const buffered = realTimeInputBufferRef.current[snake.id];
        if (buffered && buffered.length > 0 && !snake.queuedDirection) {
          const nextDir = buffered.shift()!;
          queueSnakeDirection(snake, nextDir);
        }
      }

      if (Object.values(events.tokenEaten).some(Boolean)) soundEngine.playTokenEat();
      if (events.shrinkTelegraphStarted) soundEngine.playShrinkWarning();
      if (events.ringShrunk) soundEngine.playRingShrunk();
      if (events.deathOccurred) soundEngine.playCrash();
      if (events.matchEnded) soundEngine.playVictory();

      stateRef.current = nextState;
      setGameState(nextState);
      setMatchHistory(prev => [...prev, nextState]);
      dispatchAiState(nextState);

      if (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') {
        networkManager.broadcastState(nextState);
      }
    }, tickIntervalMs);

    return () => clearInterval(intervalId);
  }, [campaignPlaytestLevel, dispatchAiState, inLobby, inOnlineLobby, isBuiltInAiActive, playMode, settings.tickRate, settings.turnBased]);

  // Series scorebook
  useEffect(() => {
    if (gameState.phase !== 'OVER' || seriesCountedRef.current) return;
    if (playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SPECTATOR') return;
    if (!gameState.winner) return;
    seriesCountedRef.current = true;
    const w = gameState.winner;
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') {
      if (w === 'p1' || w === 'p2' || w === 'DRAW') networkManager.recordSeriesResult(w);
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
    if (
      (playModeRef.current === 'ONLINE_HOST' || playModeRef.current === 'ONLINE_SERVER') &&
      !joinerAcknowledgedMatchStartRef.current
    ) return;
    if (playModeRef.current === 'ONLINE_JOIN' && !hasAcknowledgedMatchStartRef.current) return;
    const mySeat = onlineRoleRef.current === 'p2' ? 'p2' : 'p1';

    setGameState(prev => {
      const cur = prev.readyConfirmed || Object.fromEntries(prev.snakes.map(snake => [snake.id, false]));
      if (cur[mySeat]) return prev;
      const updated = { ...cur, [mySeat]: true };
      return { ...prev, readyConfirmed: updated };
    });

    soundEngine.playMenuSelect();
    networkManager.sendReadyConfirm(mySeat);
  }, []);

  const startNewMatch = () => {
    clearHitstop();
    realTimeInputBufferRef.current = {};
    setGameOverConfirmed(false);
    activeHandlerRef.current = null;
    soloAiP2OverriddenRef.current = playMode === 'SOLO_AI' && bridgeSeatRef.current === 'p2';
    const me = displayName.trim();
    const p2Local = displayNameP2.trim();
    let matchNames = { p1: 'PLAYER 1', p2: 'PLAYER 2' };
    if (playMode === 'SOLO_AI') {
      matchNames = { p1: me || 'PLAYER 1', p2: 'BOT' };
    } else if (playMode === 'LOCAL_2P') {
      matchNames = { p1: me || 'PLAYER 1', p2: p2Local || 'PLAYER 2' };
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
    const isOnlineAuthority = playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER';
    if (isOnlineAuthority) {
      joinerAcknowledgedMatchStartRef.current = false;
      setJoinerAcknowledgedMatchStart(false);
    }
    if (playMode === 'ONLINE_JOIN') {
      hasAcknowledgedMatchStartRef.current = false;
      setHasAcknowledgedMatchStart(false);
    }
    const hostCustomLevel = (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER')
      ? customOnlineLevelRef.current
      : null;
    const matchSettings = hostCustomLevel
      ? getMultiplayerCustomLevelSettings(hostCustomLevel, settingsRef.current)
      : settingsRef.current;
    if (hostCustomLevel && matchSettings !== settingsRef.current) {
      settingsRef.current = matchSettings;
      setSettings(matchSettings);
    }
    const initial = campaignPlaytestLevel
      ? createCampaignPlaytestState(campaignPlaytestLevel, matchSettings, matchNames)
      : hostCustomLevel
        ? createMultiplayerCustomLevelState(hostCustomLevel, matchSettings, matchNames)
        : createInitialState(matchSettings, matchNames);
    if (isOnline) {
      initial.readyConfirmed = Object.fromEntries(initial.snakes.map(snake => [snake.id, false]));
    } else {
      initial.readyConfirmed = Object.fromEntries(initial.snakes.map(snake => [snake.id, true]));
    }
    seriesCountedRef.current = false;
    setMatchHistory([initial]);
    turnDecisionsRef.current = [];
    agentDrivenRef.current = { p1: false, p2: false };
    setReplayActive(false);
    setReplayIdx(0);
    setReplayPlaying(false);
    stateRef.current = initial;
    setGameState(initial);
    clearLocks();
    maybeOpenPlanningSessions();
    dispatchAiState(initial);
    sentTickRef.current = -1;
    lastStateTickRef.current = -1;
    lastStateRevisionRef.current = -1;
    lastInputSequenceRef.current = { p1: 0, p2: 0 };
    setInLobby(false);
    setInOnlineLobby(false);

    soundEngine.playCountdown(true);

    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') {
      activeMatchRef.current = networkManager.broadcastMatchStart(initial, settingsRef.current);
    } else {
      activeMatchRef.current = null;
    }
  };
  startNewMatchRef.current = startNewMatch;

  const handleStartSolo = (diff: 'EASY' | 'MEDIUM' | 'HARD') => {
    bridgeSeatRef.current = 'p1';
    setSettings(prev => ({ ...prev, botDifficulty: diff }));
    setPlayMode('SOLO_AI');
    startNewMatch();
  };

  const handleStartLocal2P = () => {
    bridgeSeatRef.current = 'p1';
    setPlayMode('LOCAL_2P');
    startNewMatch();
  };

  const handleCreateOnlineRoom = async (levelOverride?: CampaignLevel | null) => {
    setJoinError(null);
    setBridgeSecret(null);
    const chosenLevel = levelOverride !== undefined ? levelOverride : customOnlineLevelRef.current;
    customOnlineLevelRef.current = chosenLevel;
    setCustomOnlineLevel(chosenLevel);
    const hostSettings: GameSettings = chosenLevel
      ? getMultiplayerCustomLevelSettings(chosenLevel, settingsRef.current)
      : {
          ...settingsRef.current,
          levelId: undefined,
          levelName: undefined,
        };
    settingsRef.current = hostSettings;
    setSettings(hostSettings);
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_HOST');
    setInOnlineLobby(true);
    setInLobby(false);

    const ok = await networkManager.connect(code, 'p1', displayName.trim() || undefined, hostSettings);
    if (!ok) {
      const error = networkManager.getLastConnectionError();
      networkManager.disconnect();
      setJoinError(error ? `Online room connection failed: ${error}` : "Couldn't create online room.");
      setInOnlineLobby(false);
      setInLobby(true);
      return;
    }
    setBridgeSecret(networkManager.getBridgeSecret());
    setOnlineRole('p1');
  };

  const handleCreateServerRoom = async (levelOverride?: CampaignLevel | null) => {
    setJoinError(null);
    setBridgeSecret(null);
    const chosenLevel = levelOverride !== undefined ? levelOverride : customOnlineLevelRef.current;
    customOnlineLevelRef.current = chosenLevel;
    setCustomOnlineLevel(chosenLevel);
    const hostSettings: GameSettings = chosenLevel
      ? getMultiplayerCustomLevelSettings(chosenLevel, settingsRef.current)
      : {
          ...settingsRef.current,
          levelId: undefined,
          levelName: undefined,
        };
    settingsRef.current = hostSettings;
    setSettings(hostSettings);
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setOnlineRoomId(code);
    setPlayMode('ONLINE_SERVER');
    setInOnlineLobby(true);
    setInLobby(false);

    const ok = await networkManager.connect(code, 'server', displayName.trim() || undefined, hostSettings);
    if (!ok) {
      const error = networkManager.getLastConnectionError();
      networkManager.disconnect();
      setJoinError(error ? `Server room connection failed: ${error}` : "Couldn't create server room.");
      setInOnlineLobby(false);
      setInLobby(true);
      return;
    }
    setBridgeSecret(networkManager.getBridgeSecret());
    setOnlineRole('server');
  };

  const handleJoinOnlineRoom = async (code: string) => {
    const roomCode = code.toUpperCase().trim();
    setJoinError(null);
    setBridgeSecret(null);
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_JOIN');
    setInOnlineLobby(true);
    setInLobby(false);
    activeMatchRef.current = null;
    lastStateRevisionRef.current = -1;
    lastStateTickRef.current = -1;
    lastInputSequenceRef.current = { p1: 0, p2: 0 };

    // BUGFIX 8: honor connect()'s result. A failed connect must not leave a
    // silent stuck lobby — show an error and return to the join form.
    const ok = await networkManager.connect(roomCode, undefined, displayName.trim() || undefined);
    const assigned = networkManager.getRole();
    if (!ok || !assigned) {
      const error = networkManager.getLastConnectionError();
      networkManager.disconnect();
      setJoinError(error ? `Room connection failed: ${error}` : "Couldn't join room — check the code");
      setInOnlineLobby(false);
      setInLobby(true);
      return;
    }
    setBridgeSecret(networkManager.getBridgeSecret());
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
    setBridgeSecret(null);
    setOnlineRoomId(roomCode);
    setPlayMode('ONLINE_SPECTATOR');
    setInOnlineLobby(true);
    setInLobby(false);

    const ok = await networkManager.connect(roomCode, 'spectator', displayName.trim() || undefined);
    if (ok) {
      setBridgeSecret(networkManager.getBridgeSecret());
      setOnlineRole('spectator');
    } else {
      const error = networkManager.getLastConnectionError();
      networkManager.disconnect();
      setJoinError(error ? `Spectator connection failed: ${error}` : "Couldn't watch that room — check the code");
      setInOnlineLobby(false);
      setInLobby(true);
    }
  };

  const handleLeaveRoom = () => {
    setGameOverConfirmed(false);
    networkManager.disconnect();
    setBridgeSecret(null);
    setInOnlineLobby(false);
    setInLobby(true);
  };

  const handleRematch = () => {
    if (playMode === 'ONLINE_SPECTATOR') return;
    if (playMode === 'ONLINE_JOIN') {
      networkManager.requestRematch();
      return;
    }
    startNewMatch();
  };

  const [importError, setImportError] = useState<string | null>(null);

  // BUGFIX 8: join failure message shown in the lobby join form.
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleExportReplay = () => {
    exportReplayToFile(matchHistory, settings, turnDecisionsRef.current, agentDrivenRef.current);
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
      const uniqueStates: GameState[] = [];
      const seenTicks = new Set<number>();
      for (const st of parsed.states) {
        if (!seenTicks.has(st.tick)) {
          seenTicks.add(st.tick);
          uniqueStates.push(st);
        } else {
          const idx = uniqueStates.findIndex(s => s.tick === st.tick);
          if (idx !== -1) uniqueStates[idx] = st;
        }
      }
      setMatchHistory(uniqueStates);
      turnDecisionsRef.current = parsed.decisions;
      agentDrivenRef.current = parsed.agentDriven;
      const snapshot = adoptThinkTimeSnapshot(thinkRef.current, parsed.states[0]);
      thinkRef.current = snapshot.model;
      stateRef.current = snapshot.state;
      setGameState(snapshot.state);
      setReplayActive(true);
      setReplayIdx(0);
      setReplayPlaying(false);
      setInLobby(false);
      setInOnlineLobby(false);
      soundEngine.playMenuSelect();
    } catch (err: any) {
      setImportError(err.message || "That file isn't a Snake Royale replay");
      soundEngine.playCrash();
    }
  };

  // Single-screen match layout: when a match (or replay) is on screen, the
  // root <main> becomes a locked viewport (100dvh, no scroll).
  const isMatchView = !inLobby && !inOnlineLobby;
  const controlsSnake = gameState.snakes.find(snake => snake.id === getTargetKey(1))!;

  return (
    <main className={`h-[100dvh] overflow-hidden flex flex-col items-center justify-between p-1.5 sm:p-3 [@media(max-height:500px)]:p-1 ${settings.crtFilterEnabled ? 'crt-overlay' : ''}`}>
      <div className="mobile-rotate-overlay hidden" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3 border-4 border-[#0F380F] bg-[#9BBC0F] p-6 text-center shadow-[6px_6px_0px_#0F380F]">
          <span className="text-4xl" aria-hidden="true">↻</span>
          <span className="text-xl font-black tracking-wider">PLEASE ROTATE YOUR PHONE</span>
          <span className="text-sm font-bold">SNAKE ROYALE IS DESIGNED FOR PORTRAIT PLAY</span>
        </div>
      </div>
      {/* Top Header Navbar */}
      <header className={`${isMatchView ? 'match-header' : ''} w-full max-w-[560px] shrink-0 flex items-center justify-between py-0.5 sm:py-1 px-2 border-b-2 border-[#0F380F] text-xs font-mono font-bold [@media(max-height:500px)]:py-0.5`}>
        <div className="flex items-center gap-2">
          {!inLobby && (
            <button
              onClick={handleReturnToLobby}
              className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{campaignPlaytestLevel ? 'EDITOR' : 'LOBBY'}</span>
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
      <div className="flex-1 min-h-0 min-w-0 my-1 [@media(max-height:500px)]:my-0.5 flex flex-col items-center justify-center w-full">
        <div className="w-full flex flex-col items-center justify-center flex-1 min-h-0">
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
              onUpdateSettings={handleUpdateSettings}
              displayName={displayName}
              onDisplayNameChange={handleDisplayNameChange}
              displayNameP2={displayNameP2}
              onDisplayNameP2Change={handleDisplayNameP2Change}
              onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
              isNintendoController={isNintendoController}
              onImportReplay={handleImportReplay}
              importError={importError}
              joinError={joinError}
              initialRoom={initialRoomParam}
              customOnlineLevel={customOnlineLevel}
              onSelectCustomOnlineLevel={setCustomOnlineLevel}
            />
          ) : inOnlineLobby ? (
            <OnlineRoomLobby
              roomId={onlineRoomId}
              bridgeSecret={bridgeSecret}
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
                moveBuffers={replayActive && replayDecisionQueues ? replayDecisionQueues : moveBuffers}
                viewerSeat={viewerSeat}
                replayActive={replayActive}
                onP2Undo={() => handleBufferUndo(2)}
                onP2Lock={() => handleBufferLock(2)}
              />
              <div className="gameboard-area relative">
                <GameBoard
                  gameState={displayState}
                  settings={settings}
                  lockedPaths={lockedPaths}
                  controlSeat={playMode === 'ONLINE_JOIN' && onlineRole === 'p2' ? 'p2' : 'p1'}
                  onDirection={(dir, touchSeat) => handleDirectionInput(touchSeat === 'p2' ? 2 : 1, dir)}
                  interactionEnabled={!replayActive}
                  splitTouchSeats={playMode === 'LOCAL_2P'}
                  animationsDisabled={aiMode}
                  hitstop={activeHitstop}
                  fatalMoveAnimating={fatalMoveSnakes}
                />
                {!replayActive &&
                  (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') &&
                  !joinerAcknowledgedMatchStart && (
                    <div role="status" className="absolute inset-0 bg-[#0F380F]/90 backdrop-blur-xs flex items-center justify-center p-3 z-20 font-mono text-[#9BBC0F]">
                      <div className="bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#0F380F] p-4 max-w-[340px] w-full text-center text-sm font-black text-[#0F380F]">
                        WAITING FOR PLAYER 2 TO LOAD THE MATCH...
                      </div>
                    </div>
                  )}
                {showTurnHint && displayState.turnBased && displayState.phase !== 'OVER' && !replayActive && (
                  <div role="status" className="absolute top-1 left-1/2 z-30 flex w-[min(20rem,calc(100%-1rem))] -translate-x-1/2 items-center justify-between gap-2 border-2 border-[#0F380F] bg-[#9BBC0F] px-2 py-1 font-mono text-[10px] font-bold text-[#0F380F] shadow-[2px_2px_0px_#0F380F]">
                    <span>BOTH LOCK → BOARD STEPS</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTurnHint(false);
                        try { localStorage.setItem('snake-royale-turn-hint-dismissed', 'true'); } catch { /* private mode */ }
                      }}
                      aria-label="Dismiss move planning hint"
                      className="shrink-0 border border-[#0F380F] px-1 leading-none"
                    >
                      ×
                    </button>
                  </div>
                )}
                {!replayActive &&
                  (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_JOIN' || playMode === 'ONLINE_SERVER') &&
                  !((playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') && !joinerAcknowledgedMatchStart) &&
                  !areBothOnlinePlayersReady(displayState.readyConfirmed) && (
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
                        playMode === 'ONLINE_JOIN' && !hasAcknowledgedMatchStart ? (
                          <div className="bg-[#8BAC0F] text-[#0F380F] p-2.5 border-2 border-[#0F380F] text-xs font-black">
                            SYNCING MATCH START...
                          </div>
                        ) : (
                          <button
                            onClick={handleConfirmReady}
                            className="w-full py-2.5 bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] border-2 border-[#0F380F] font-black text-sm cursor-pointer shadow-[3px_3px_0px_#0F380F] flex items-center justify-center gap-2 animate-pulse"
                          >
                            <span>PRESS A TO START</span>
                            <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 font-bold">[A / ENTER]</span>
                          </button>
                        )
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
                    onSkill={() => handleSkillButton(1)}
                    choosingSkill={Boolean(choosingSkillMap[getTargetKey(1)])}
                    canUseSkill={canActivateSkill(gameState.snakes.find(s => s.id === getTargetKey(1)), gameState, gameState.skillsAvailable ?? settings.skillsAvailable)}
                    queue={settings.turnBased
                      ? moveBuffers[getTargetKey(1)]
                      : [controlsSnake.queuedDirection]
                        .filter((direction): direction is Direction => direction !== null)}
                    queueLimit={controlsSnake.body.length}
                    locked={locks[getTargetKey(1)]}
                    turnBased={settings.turnBased}
                    localTwoPlayer={playMode === 'LOCAL_2P'}
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
                    matchHistory={matchHistory}
                    turnDecisions={turnDecisionsRef.current}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info — hidden in match view and short landscape screens to give full vertical budget */}
      {!isMatchView && (
        <footer className="text-center text-[10px] font-mono opacity-80 py-0.5 shrink-0 [@media(max-height:500px)]:hidden">
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

      {!inLobby && !inOnlineLobby && !replayActive && !activeHitstop && fatalMoveSnakes.length === 0 && (
        <MatchEndModal
          gameState={gameState}
          playMode={playMode}
          confirmed={gameOverConfirmed}
          onConfirm={() => setGameOverConfirmed(true)}
          series={series}
          canReplay={matchHistory.length > 1}
          isSpectator={playMode === 'ONLINE_SPECTATOR'}
          onWatchReplay={() => {
            setReplayActive(true);
            setReplayIdx(0);
            setReplayPlaying(false);
          }}
          onRematch={handleRematch}
          onReturnToLobby={handleReturnToLobby}
          onReturnToEditor={campaignPlaytestLevel ? handleReturnToLobby : undefined}
          onExportReplay={handleExportReplay}
          onRegisterHandler={(h) => { activeHandlerRef.current = h; }}
          matchHistory={matchHistory}
          turnDecisions={turnDecisionsRef.current}
        />
      )}
    </main>
  );
};

export default App;
