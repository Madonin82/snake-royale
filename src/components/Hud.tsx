import React, { useEffect, useState, useRef } from 'react';
import { BufferEntry, Direction, GameSettings, GameState, LatencyReport, PlayMode } from '../types/game';
import { Activity, Gamepad, Wifi } from 'lucide-react';
import { getCampaignObjectiveProgress, isCampaignObjectiveComplete } from '../game/objectives';
import { getPlayerColorPalette, getSeatDisplayTag, splitPlayersTwoPerSide } from '../game/playerColors';

import { canActivateSkill, canAffordQueuedSkill, canAffordQueuedRattle, canQueueRattleWithLength, getBufferCapacity } from '../game/skills';

interface HudProps {
  gameState: GameState;
  playMode: PlayMode;
  isPlaytest?: boolean;
  latencyReport: LatencyReport;
  onOpenLatencyHarness: () => void;
  onOpenSettings: () => void;
  gamepadCount: number;
  locks?: Record<string, boolean>;
  thinkSessions?: Record<string, { startTime: number | null }>;
  thinkTimeRemaining?: Record<string, number | null>;
  viewerSeat?: 'p1' | 'p2' | null;
  moveBuffers?: Record<string, BufferEntry[]>;
  replayActive?: boolean;
  onP2Undo?: () => void;
  onP2Lock?: () => void;
  mouseSeat?: 'p1' | 'p2';
  onToggleMouseSeat?: () => void;
  onSkill?: (seat: string) => void;
  settings: GameSettings;
  onCardSwipe?: (seat: 'p1' | 'p2', dir: Direction) => void;
  choosingSkillMap?: Record<string, boolean>;
  canUseSkill?: (seat: string) => boolean;
  pendingPrimesMap?: Record<string, number>;
}

export const Hud: React.FC<HudProps> = ({
  gameState,
  playMode,
  isPlaytest = false,
  latencyReport,
  onOpenLatencyHarness,
  gamepadCount,
  locks,
  thinkSessions,
  thinkTimeRemaining,
  viewerSeat,
  moveBuffers,
  replayActive = false,
  onP2Undo,
  onP2Lock,
  mouseSeat,
  onToggleMouseSeat,
  onSkill,
  settings,
  onCardSwipe,
  choosingSkillMap,
  canUseSkill: canUseSkillProp,
  pendingPrimesMap,
}) => {
  // Who is "you" on this screen, per seat — drives the (YOU) tags without redundant (BOT N) tags.
  const seatTag = (seat: string): string => getSeatDisplayTag(seat, playMode, viewerSeat);
  const isRacing = gameState.phase === 'RACING';
  const isShrinking = gameState.phase === 'SHRINKING';
  const isTerritory = gameState.phase === 'TERRITORY';
  const isMultiCardSide = gameState.snakes.length > 2;
  const { left: leftSnakes, right: rightSnakes } = splitPlayersTwoPerSide(gameState.snakes);
  const objectiveList = gameState.campaignObjectives
    ? [gameState.campaignObjectives.primary, ...(gameState.campaignObjectives.required ?? []), ...gameState.campaignObjectives.bonus]
        .map((objective, index) => ({ objective, index }))
        .filter((item): item is { objective: NonNullable<typeof item.objective>; index: number } => item.objective !== null)
    : [];

  // Live clock for the turn timer (re-renders 4x/sec while a turn is open)
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const cardPointerStartRef = useRef<Record<string, { x: number; y: number }>>({});

  const handleCardPointerDown = (who: string, e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    cardPointerStartRef.current[who] = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCardPointerUp = (who: 'p1' | 'p2', e: React.PointerEvent) => {
    const start = cardPointerStartRef.current[who];
    if (!start) return;
    delete cardPointerStartRef.current[who];

    if (settings.gestureCardSwipeEnabled === false) return;
    if (typeof window !== 'undefined' && window.innerWidth > window.innerHeight) return; // portrait only

    const deltaX = e.clientX - start.x;
    const deltaY = e.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) > 20) {
      const dir: Direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? deltaX < 0 ? 'LEFT' : 'RIGHT'
        : deltaY < 0 ? 'UP' : 'DOWN';
      onCardSwipe?.(who, dir);
    }
  };
  useEffect(() => {
    if (!gameState.turnBased || gameState.phase === 'OVER') return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [gameState.turnBased, gameState.phase]);

  const fmtSecs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const fmtTotal = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m > 0 ? `${m}:${s < 10 ? '0' : ''}${s}` : `${s}s`;
  };
  const thinkLabel = (who: string) => {
    const snake = gameState.snakes.find(candidate => candidate.id === who);
    if (!snake) return who;
    if (!thinkSessions || !thinkSessions[who]) return snake.name;
    const session = thinkSessions[who];
    const locked = isLocked(who);
    const lastTurn = gameState.lastTurnTimes?.[who] ?? null;
    if (locked) {
      return `${snake.name} ✓ ${lastTurn !== null ? `${lastTurn.toFixed(1)}s` : ''}`;
    }
    const elapsed = session.startTime !== null ? nowMs - session.startTime : 0;
    return `${snake.name} … ${fmtSecs(elapsed)}`;
  };

  const isLocked = (who: string) => {
    if (!locks) return false;
    return locks[who] ?? false;
  };

  const isLocalSeat = (seat: string): boolean => {
    if (playMode === 'LOCAL_2P') return true;
    if (playMode === 'SOLO_AI') return seat === 'p1';
    if (playMode === 'ONLINE_HOST' || playMode === 'ONLINE_SERVER') return seat === 'p1';
    if (playMode === 'ONLINE_JOIN') return viewerSeat ? viewerSeat === seat : seat === 'p1';
    // Hotseat: only the active player (holding the phone) is local.
    if (playMode === 'LOCAL_HOTSEAT') return viewerSeat === seat;
    return seat === 'p1';
  };

  const isSkillUsable = (who: string): boolean => {
    if (canUseSkillProp) return canUseSkillProp(who);

    if (!onSkill) return false;
    if (!gameState.turnBased) return false;
    if (gameState.phase === 'OVER' || replayActive) return false;
    if (!isLocalSeat(who)) return false;
    if (isLocked(who)) return false;
    if (choosingSkillMap?.[who]) return false;

    const snake = gameState.snakes.find(s => s.id === who);
    if (!snake || !snake.isAlive || !snake.equippedSkill) return false;
    if (!canActivateSkill(snake, gameState, gameState.skillsAvailable)) return false;

    const buf = moveBuffers?.[who] ?? [];
    const capacity = getBufferCapacity(snake);
    if (buf.length >= capacity) return false;
    const skillId = snake.equippedSkill;
    if (!skillId) return false;
    if (snake.equippedSkill === 'rattle') {
      const queuedPrimes = buf.reduce((acc, e) => acc + (typeof e !== 'string' && e.type === 'rattle' ? (e.primes ?? 1) : 0), 0) + (pendingPrimesMap?.[who] ?? 0);
      if (!canAffordQueuedRattle(snake.skillPoints, queuedPrimes)) return false;
      if (!canQueueRattleWithLength(snake.body.length, queuedPrimes)) return false;
    } else {
      const queued = buf.filter(e => typeof e !== 'string' && e.type === skillId).length;
      if (!canAffordQueuedSkill(snake.skillPoints, skillId, queued)) return false;
    }
    return true;
  };

  const renderSkillBadge = (who: string, skill: string) => {
    const usable = isSkillUsable(who);
    const pendingPrimes = pendingPrimesMap?.[who] ?? 0;
    const isPriming = skill === 'rattle' && pendingPrimes > 0;
    const label = isPriming ? `${pendingPrimes} primed, ${pendingPrimes} SP escrowed` : `⚡${skill}`;
    return (
      <button
        type="button"
        data-testid={`skill-badge-${who}`}
        disabled={!usable}
        onClick={() => onSkill?.(who)}
        className={`text-[8px] px-1 py-0.5 border font-black uppercase leading-none tracking-tight transition-colors ${
          usable
            ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F] cursor-pointer hover:bg-[#306230] active:translate-y-0.5 shadow-[1px_1px_0px_#0F380F]'
            : 'bg-[#306230]/50 text-[#9BBC0F]/60 border-[#0F380F]/50 cursor-not-allowed opacity-60'
        }`}
        title={`Equipped Skill: ${skill.toUpperCase()} (2 SP)`}
      >
        {label}
      </button>
    );
  };

  // Format seconds mm:ss
  const totalSeconds = Math.ceil(gameState.phaseTimeRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  const portraitTimerSeat = viewerSeat ?? 'p1';
  const portraitCountdown = thinkTimeRemaining?.[portraitTimerSeat] ?? null;
  const isPlaytestHud = isPlaytest || Boolean(gameState.campaignObjectives);
  const primaryObjective = objectiveList[0] ?? null;

  const topStripContent = (
    <div className="top-strip-content h-9 [@media(max-height:540px)]:h-7 flex items-center justify-between gap-2 bg-[#8BAC0F] px-2.5 border-2 border-[#0F380F] text-xs font-bold tracking-wider w-full shadow-[2px_2px_0px_#0F380F] overflow-hidden shrink-0">
      <div className="flex items-center gap-1.5 flex-nowrap min-w-0 overflow-hidden shrink-0">
        <span
          className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] text-[10px] leading-tight ${
            isRacing
              ? 'bg-[#0F380F] text-[#9BBC0F]'
              : isShrinking
              ? 'bg-[#306230] text-[#9BBC0F] animate-pulse'
              : 'bg-[#8BAC0F] text-[#0F380F]'
          }`}
        >
          {gameState.phase === 'RACING'
            ? `PHASE 1: TOKEN RACE`
            : gameState.phase === 'SHRINKING'
            ? `PHASE 2: SHRINK ARENA`
            : gameState.phase === 'TERRITORY'
            ? `TERRITORY: LAST SURVIVOR`
            : `MATCH OVER`}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[10px] leading-tight bg-[#9BBC0F] px-1.5 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] tabular-nums">
          {isRacing || isTerritory ? `RND ${gameState.round} (${gameState.tokens.length} 💎)` : `RING ${gameState.ringInset}`}
        </span>
      </div>

      {/* Center Strip: Phase progression, Turn count, Turns left, and Primary Objective in Playtest */}
      {isPlaytestHud && (
        <div
          data-testid="playtest-top-strip-center"
          className="hidden sm:flex items-center justify-center gap-1.5 min-w-0 flex-1 px-1 overflow-hidden"
        >
          <span className="truncate px-2 py-0.5 [@media(max-height:540px)]:py-0 bg-[#9BBC0F] border border-[#0F380F] text-[10px] font-black text-[#0F380F] tabular-nums">
            {isRacing
              ? `PHASE 1: TOKEN RACE • TURN ${gameState.tick} • ${gameState.phaseTurnsRemaining} TURNS LEFT → PHASE 2 SHRINK`
              : isShrinking
              ? `PHASE 2: SHRINK ARENA • TURN ${gameState.tick} • RING CLOSES IN ${gameState.phaseTurnsRemaining} TURNS`
              : `MATCH COMPLETE • ${gameState.tick} TURNS`}
          </span>
          {primaryObjective && (
            <span className="hidden md:inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 [@media(max-height:540px)]:py-0 bg-[#0F380F] text-[#9BBC0F] border border-[#0F380F] text-[9px] font-black">
              <span>{isCampaignObjectiveComplete(primaryObjective.objective, gameState, primaryObjective.index) ? '✓' : '◎'}</span>
              <span>{getCampaignObjectiveProgress(primaryObjective.objective, gameState, primaryObjective.index)}</span>
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 shrink-0">
        {gameState.turnBased && !isPlaytestHud && (
          <span className="hidden lg:inline text-[9px] opacity-80 whitespace-nowrap">
            {gameState.phase === 'OVER'
              ? 'GAME!'
              : playMode === 'LOCAL_HOTSEAT'
                ? (viewerSeat === 'p2' ? 'P2 TURN • UNLOCK → MOVE → LOCK → PASS' : 'P1 TURN • UNLOCK → MOVE → LOCK → PASS')
                : 'BOTH LOCK → BOARD STEPS'}
          </span>
        )}

        <div className="whitespace-nowrap text-xs md:text-sm [@media(max-height:540px)]:text-[11px] leading-tight font-black tracking-widest bg-[#9BBC0F] px-2 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] tabular-nums min-w-[8.5rem] text-center">
          {gameState.turnBased
            ? `TURN ${gameState.tick} • ${gameState.phase === 'RACING' ? `${gameState.phaseTurnsRemaining} LEFT` : gameState.phase === 'SHRINKING' ? `RING IN ${gameState.phaseTurnsRemaining}` : gameState.phase === 'TERRITORY' ? 'TERRITORY' : 'OVER'}`
            : `⏱️ ${formattedTime}`}
        </div>

        {gamepadCount > 0 && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-[#0F380F] font-bold bg-[#9BBC0F] px-1 border border-[#0F380F] tabular-nums">
            <Gamepad className="w-3 h-3" /> {gamepadCount}
          </span>
        )}

        <button
          onClick={onOpenLatencyHarness}
          className="shrink-0 flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F] px-2 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] font-bold cursor-pointer transition-colors text-[10px] leading-tight tabular-nums"
          title="Open Latency Diagnostic Suite & Diagnostics"
        >
          <Activity className="w-3 h-3 shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">
            NET: {latencyReport.medianRtt > 0 ? `${latencyReport.medianRtt}ms` : 'DIAG'}
          </span>
          <Wifi className="w-2.5 h-2.5 shrink-0" />
        </button>
      </div>
    </div>
  );

  const renderOutcomeBadge = (who: string) => {
    if (gameState.phase !== 'OVER' || !gameState.winner) return null;
    const isWinner = gameState.winner === who;
    const isDraw = gameState.winner === 'DRAW';
    const label = isDraw ? 'DRAW' : isWinner ? '★ WIN' : '✕ LOSS';
    return (
      <span
        className={`shrink-0 px-1.5 py-0.5 text-[10px] leading-none font-black uppercase tracking-wider border border-[#0F380F] ${
          isWinner
            ? 'bg-[#0F380F] text-[#9BBC0F]'
            : isDraw
            ? 'bg-[#306230] text-[#9BBC0F]'
            : 'bg-[#8BAC0F] text-[#0F380F]'
        }`}
      >
        {label}
      </span>
    );
  };

  const renderPlanningStatusBadge = (isAlive: boolean, locked: boolean) => {
    if (!gameState.turnBased || gameState.phase === 'OVER') return null;
    if (!isAlive) {
      return (
        <span className="shrink-0 px-1 py-0.5 text-[9px] leading-none font-black bg-[#0F380F] text-[#9BBC0F] border border-[#0F380F]">
          ✕ OUT
        </span>
      );
    }
    if (locked) {
      return (
        <span className="shrink-0 px-1 py-0.5 text-[9px] leading-none font-black bg-[#0F380F]/85 text-[#9BBC0F] border border-[#0F380F]">
          🔒 LOCKED
        </span>
      );
    }
    return (
      <span className="shrink-0 px-1 py-0.5 text-[9px] leading-none font-black bg-[#E0F8CF] text-[#0F380F] border border-[#0F380F]">
        ✏️ THINKING
      </span>
    );
  };

  const getCardContainerClasses = (who: string) => {
    const snakeIndex = gameState.snakes.findIndex(candidate => candidate.id === who);
    const snake = gameState.snakes[snakeIndex];
    const palette = getPlayerColorPalette(snake ?? who, snakeIndex >= 0 ? snakeIndex : 0);
    const locked = isLocked(who);
    const isAlive = snake?.isAlive ?? true;
    const isTurnActive = gameState.turnBased && gameState.phase !== 'OVER';

    if (!isAlive) {
      return `bg-[#8BAC0F]/50 opacity-45 border-4 border-dashed ${palette.borderColor}`;
    }
    if (isTurnActive && locked) {
      return `bg-[#8BAC0F]/75 opacity-60 border-4 border-dashed ${palette.borderColor} ${palette.lockedShadow}`;
    }
    if (isTurnActive && !locked) {
      return `bg-[#9BBC0F] opacity-100 border-4 ${palette.borderColor} ${palette.activeHighlight}`;
    }
    return `bg-[#9BBC0F] opacity-100 border-4 ${palette.borderColor} ${palette.defaultShadow}`;
  };

  const renderMouseHints = (who: string) => {
    if (!mouseSeat || mouseSeat !== who) return null;
    if (!gameState.turnBased || gameState.phase === 'OVER' || replayActive) return null;

    const label = `🖱 ${who.toUpperCase()}`;
    const badge = playMode === 'LOCAL_2P' && onToggleMouseSeat ? (
      <button
        type="button"
        onClick={onToggleMouseSeat}
        title="Click to switch mouse control between P1 and P2"
        className="flex items-center gap-0.5 px-1 py-0.5 bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] border border-[#0F380F] shadow-[1px_1px_0px_#0F380F] active:translate-y-0.5 cursor-pointer text-[8px] leading-none shrink-0 font-bold"
      >
        <span>{label}</span>
      </button>
    ) : (
      <span className="flex items-center gap-0.5 px-1 py-0.5 bg-[#8BAC0F]/70 border border-[#0F380F]/50 text-[8px] leading-none shrink-0 font-bold">
        {label}
      </span>
    );

    return {
      badge,
      caption: (
        <span className="text-[8px] font-mono font-bold opacity-75 leading-none flex items-center gap-1.5 flex-wrap">
          <span>right-click: undo</span>
          <span className="opacity-40">•</span>
          <span>click endpoint: lock</span>
        </span>
      ),
    };
  };

  const renderDesktopPlayerPanel = (who: string) => {
    const snakeIndex = gameState.snakes.findIndex(candidate => candidate.id === who);
    const snake = gameState.snakes[snakeIndex];
    if (!snake) return null;
    const palette = getPlayerColorPalette(snake, snakeIndex);
    const locked = isLocked(who);
    const canSeeMoves = replayActive || playMode === 'LOCAL_2P' || viewerSeat === who;
    const lastTurn = gameState.lastTurnTimes?.[who] ?? null;
    const totalThink = gameState.totalThinkTime?.[who] ?? 0;
    const buffer = moveBuffers?.[who] ?? [];
    const countdown = thinkTimeRemaining?.[who] ?? null;
    const tag = seatTag(who);
    const mouseHints = renderMouseHints(who);

    if (isPlaytestHud) {
      return (
        <div
          data-seat={who}
          data-locked={locked ? 'true' : 'false'}
          data-planning={gameState.turnBased && gameState.phase !== 'OVER' && snake.isAlive && !locked ? 'true' : 'false'}
          onPointerDown={(e) => handleCardPointerDown(who, e)}
          onPointerUp={(e) => handleCardPointerUp(who as 'p1' | 'p2', e)}
          className={`relative ${getCardContainerClasses(who)} ${
            isMultiCardSide ? 'p-2' : 'p-2.5'
          } [@media(max-height:540px)]:p-1.5 flex flex-col h-full min-h-0 overflow-hidden w-full font-mono text-[#0F380F] transition-all`}
        >
          {/* Row 1: Identity (Color chip + Name) & Planning Status Badge */}
          <div className="shrink-0 flex items-center justify-between gap-1 text-xs [@media(max-height:540px)]:text-[11px] font-bold mb-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-3 h-3 [@media(max-height:540px)]:w-2.5 [@media(max-height:540px)]:h-2.5 shrink-0 ${palette.chipBg} inline-block border-2 border-[#0F380F] shadow-[1px_1px_0px_#0F380F]`}
                title={`Snake color ${palette.hex}`}
              />
              <span className="truncate font-black">{snake.name}{tag ? ` ${tag}` : ''}</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {renderOutcomeBadge(who)}
              {renderPlanningStatusBadge(snake.isAlive, locked)}
            </div>
          </div>

          {/* Row 2: Primary Score Hierarchy + Secondary Stats Pill Group (LEN & SP) + Corner Skill Tag */}
          <div className="shrink-0 flex items-end justify-between gap-1.5 mb-1.5 pb-1 border-b border-[#0F380F]/30">
            <div data-score-card={who} className="flex items-baseline tabular-nums leading-none">
              <span className={`${isMultiCardSide ? 'text-xl' : 'text-2xl'} [@media(max-height:540px)]:text-lg leading-none font-black`}>
                {snake.score}
              </span>
              <span className="text-[9px] font-black uppercase tracking-tight ml-1 opacity-80">PTS</span>
            </div>

            <div className="flex items-center gap-1 flex-wrap justify-end">
              <span className="text-[9px] px-1 py-0.5 bg-[#8BAC0F]/60 border border-[#0F380F]/60 font-bold tabular-nums leading-none">
                LEN {snake.body.length}
              </span>
              <span
                data-sp-card={who}
                className="text-[9px] px-1 py-0.5 bg-[#8BAC0F]/60 border border-[#0F380F]/60 font-bold tabular-nums leading-none"
                title="Skill points"
              >
                ⚡{snake.skillPoints ?? 0} SP
              </span>
              {snake.equippedSkill && renderSkillBadge(who, snake.equippedSkill)}
            </div>
          </div>

          {/* Row 3: Compact Think Timer Bar */}
          {gameState.turnBased && (
            <div className="shrink-0 mb-1 px-1.5 py-0.5 bg-[#8BAC0F]/40 border border-[#0F380F]/70 text-[9px] font-bold flex items-center justify-between gap-1 tabular-nums leading-tight">
              <span className="truncate">
                {gameState.phase === 'OVER'
                  ? gameState.winner === 'DRAW'
                    ? 'DRAW GAME'
                    : gameState.winner === who
                    ? '★ WINNER'
                    : '✕ DEFEATED'
                  : !snake.isAlive
                  ? '✕ ELIMINATED'
                  : locked
                  ? `LOCKED ${lastTurn !== null ? `(${lastTurn.toFixed(1)}s)` : ''}`
                  : thinkLabel(who)}
              </span>
              <span className="shrink-0 flex items-center gap-1.5">
                {!locked && countdown !== null && gameState.phase !== 'OVER' && (
                  <span className="font-black text-[#0F380F]">{countdown}s</span>
                )}
                <span className="opacity-80">TOT {fmtTotal(totalThink)}</span>
              </span>
            </div>
          )}

          {/* Row 4: Move Queue Box (Opponent queues hidden during live play, revealed in replay) */}
          <div className="flex-1 min-h-0 overflow-hidden bg-[#8BAC0F]/20 border border-dashed border-[#0F380F]/40 p-1 flex flex-col justify-start">
            <div className="text-[9px] font-bold opacity-80 mb-0.5 flex justify-between items-center shrink-0 min-h-[16px] tabular-nums">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">
                  {canSeeMoves
                    ? `QUEUE (${buffer.length}/${getBufferCapacity(snake)})`
                    : 'MOVE QUEUE'}
                </span>
                {mouseHints?.badge}
              </div>
              {locked && <span className="text-[8px] px-1 bg-[#0F380F] text-[#9BBC0F] shrink-0">LOCKED</span>}
            </div>
            {mouseHints && (
              <div className="mb-0.5">
                {mouseHints.caption}
              </div>
            )}
            <div className="flex flex-wrap gap-1 content-start shrink-0 portrait:overflow-y-auto portrait:max-h-[52px]">
              {!canSeeMoves ? (
                <span data-testid={`queue-hidden-${who}`} className="text-[10px] opacity-75 italic font-bold">
                  Hidden
                </span>
              ) : buffer.length === 0 ? (
                <>
                  {/* Invisible chips: pixel-identical to real chips, hold 2 rows in portrait */}
                  <span
                    aria-hidden="true"
                    className="px-1 py-0.5 text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0 invisible"
                  >↑</span>
                  <span
                    aria-hidden="true"
                    className="px-1 py-0.5 text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0 invisible portrait:inline hidden"
                  >↑</span>
                </>
              ) : (
                buffer.map((entry, idx) => {
                  const dir = entry.direction;
                  const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                  const label = entry.type === 'rattle' ? `⚡×${entry.primes ?? 1}${arrow}` : entry.type === 'dart' ? `⚡${arrow}` : arrow;
                  return (
                    <span key={idx} className={`px-1 py-0.5 ${palette.badgeBg} text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0`}>
                      {label}
                    </span>
                  );
                })
              )}
              {canSeeMoves && snake.pendingSkill && (
                <span className={`px-1 py-0.5 ${palette.badgeBg} text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0`}>
                  ⚡
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        data-seat={who}
        data-locked={locked ? 'true' : 'false'}
        data-planning={gameState.turnBased && gameState.phase !== 'OVER' && snake.isAlive && !locked ? 'true' : 'false'}
        onPointerDown={(e) => handleCardPointerDown(who, e)}
        onPointerUp={(e) => handleCardPointerUp(who as 'p1' | 'p2', e)}
        className={`${getCardContainerClasses(who)} ${
          isMultiCardSide ? 'p-2' : 'p-3'
        } [@media(max-height:540px)]:p-1.5 flex flex-col h-full min-h-0 overflow-hidden w-full font-mono text-[#0F380F] transition-all`}
      >
        <div className="shrink-0">
          <div className={`flex items-center justify-between gap-1 text-xs [@media(max-height:540px)]:text-[11px] font-bold ${isMultiCardSide ? 'mb-1' : 'mb-2'} [@media(max-height:540px)]:mb-1 h-4`}>
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-3.5 h-3.5 [@media(max-height:540px)]:w-2.5 [@media(max-height:540px)]:h-2.5 shrink-0 ${palette.chipBg} inline-block border-2 border-[#0F380F] shadow-[1px_1px_0px_#0F380F]`}
                title={`Snake color ${palette.hex}`}
              />
              <span className="truncate font-black">{snake.name}{tag ? ` ${tag}` : ''}</span>
            </span>
            {renderPlanningStatusBadge(snake.isAlive, locked)}
          </div>

          <div className={`flex items-center justify-between ${isMultiCardSide ? 'mb-1 h-6' : 'mb-2 h-8'} [@media(max-height:540px)]:mb-1 [@media(max-height:540px)]:h-6`}>
            <div data-score-card={who} className="flex items-baseline tabular-nums">
              <span className={`${isMultiCardSide ? 'text-2xl' : 'text-3xl'} [@media(max-height:540px)]:text-xl leading-none font-black`}>{snake.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-tight ml-1">PTS</span>
            </div>
            {snake.equippedSkill && renderSkillBadge(who, snake.equippedSkill)}
            <span data-sp-card={who} className="text-[9px] px-1.5 py-0.5 border border-[#0F380F] font-black uppercase" title="Skill points">
              ⚡{snake.skillPoints ?? 0}
            </span>
            {renderOutcomeBadge(who)}
            <span className="text-xs [@media(max-height:540px)]:text-[10px] font-bold opacity-80 tabular-nums">LEN: {snake.body.length}</span>
          </div>

          {gameState.turnBased && (
            <div className={`${isMultiCardSide ? 'mb-1 p-1 h-[40px]' : 'mb-2 p-1.5 h-[52px]'} [@media(max-height:540px)]:mb-1 [@media(max-height:540px)]:p-1 bg-[#8BAC0F]/40 border border-[#0F380F] text-xs [@media(max-height:540px)]:text-[10px] font-bold [@media(max-height:540px)]:h-[38px] flex flex-col justify-between overflow-hidden`}>
              <div className={`flex items-center justify-between gap-1 h-5 ${locked ? 'text-[#0F380F] opacity-90' : 'text-[#0F380F] font-black'}`}>
                <span className="truncate tabular-nums">
                  {gameState.phase === 'OVER'
                    ? gameState.winner === 'DRAW'
                      ? 'DRAW GAME'
                      : gameState.winner === who
                      ? '★ WINNER'
                      : '✕ DEFEATED'
                    : !snake.isAlive
                    ? '✕ ELIMINATED'
                    : `${thinkLabel(who)} ${locked ? '🔒' : countdown === null ? '✏️' : ''}`}
                </span>
                <span className="shrink-0 w-9 text-right text-xl [@media(max-height:540px)]:text-base leading-none font-black tabular-nums">
                  {!locked && countdown !== null && gameState.phase !== 'OVER' ? `${countdown}s` : ''}
                </span>
              </div>
              <div className="text-[10px] [@media(max-height:540px)]:text-[9px] opacity-80 flex justify-between tabular-nums leading-none">
                <span>LAST: {lastTurn !== null ? `${lastTurn.toFixed(1)}s` : '—'}</span>
                <span>TOT: {fmtTotal(totalThink)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Queued move arrows list in the reserved bottom slot — the flexible
            region: fixed header rows above stay put, this absorbs the rest.
            Chips wrap; never pushes the layout taller. */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[#8BAC0F]/20 border border-dashed border-[#0F380F]/40 p-1.5 [@media(max-height:540px)]:p-1 flex flex-col justify-start">
          <div className="text-[9px] font-bold opacity-75 mb-1 flex justify-between items-center shrink-0 min-h-[16px] tabular-nums">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{canSeeMoves ? `QUEUE (${buffer.length}/${getBufferCapacity(snake)})` : 'QUEUE'}</span>
              {mouseHints?.badge}
            </div>
            {locked && <span className="text-[8px] px-1 bg-[#0F380F] text-[#9BBC0F] shrink-0">LOCKED</span>}
          </div>
          {mouseHints && (
            <div className="mb-1">
              {mouseHints.caption}
            </div>
          )}
          <div className="flex flex-wrap gap-1 content-start shrink-0 portrait:overflow-y-auto portrait:max-h-[52px]">
            {!canSeeMoves ? (
              <span className="text-[10px] opacity-60 italic">Hidden</span>
            ) : buffer.length === 0 ? (
              <>
                {/* Invisible chips: pixel-identical to real chips, hold 2 rows in portrait */}
                <span
                  aria-hidden="true"
                  className="px-1 py-0.5 text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0 invisible"
                >↑</span>
                <span
                  aria-hidden="true"
                  className="px-1 py-0.5 text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0 invisible portrait:inline hidden"
                >↑</span>
              </>
            ) : (
              buffer.map((entry, idx) => {
                const dir = entry.direction;
                const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                const label = entry.type === 'rattle' ? `⚡×${entry.primes ?? 1}${arrow}` : entry.type === 'dart' ? `⚡${arrow}` : arrow;
                return (
                  <span key={idx} className={`px-1 py-0.5 ${palette.badgeBg} text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0`}>
                    {label}
                  </span>
                );
              })
            )}
            {canSeeMoves && snake.pendingSkill && (
              <span className={`px-1 py-0.5 ${palette.badgeBg} text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0`}>
                ⚡
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMobilePlayerCard = (snake: GameState['snakes'][number]) => {
    const who = snake.id;
    const snakeIndex = gameState.snakes.findIndex(candidate => candidate.id === who);
    const palette = getPlayerColorPalette(snake, snakeIndex);
    const locked = isLocked(who);
    const buffer = moveBuffers?.[who] ?? [];
    const local = replayActive || isLocalSeat(who);
    const countdown = thinkTimeRemaining?.[who] ?? null;
    const lastTurn = gameState.lastTurnTimes?.[who] ?? null;
    const totalThink = gameState.totalThinkTime?.[who] ?? 0;
    const tag = seatTag(who);
    const mouseHints = renderMouseHints(who);

    return (
      <div
        key={who}
        data-seat={who}
        data-locked={locked ? 'true' : 'false'}
        data-planning={gameState.turnBased && gameState.phase !== 'OVER' && snake.isAlive && !locked ? 'true' : 'false'}
        onPointerDown={(e) => handleCardPointerDown(who, e)}
        onPointerUp={(e) => handleCardPointerUp(who as 'p1' | 'p2', e)}
        className={`${getCardContainerClasses(who)} p-2 flex flex-col justify-between min-w-0 overflow-hidden transition-all`}
      >
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold h-4">
            <span className="flex items-center gap-1 min-w-0">
              <span className={`w-3 h-3 shrink-0 ${palette.chipBg} inline-block border-2 border-[#0F380F]`} />
              <span className="truncate font-black">{snake.name}{tag ? ` ${tag}` : ''}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {renderPlanningStatusBadge(snake.isAlive, locked)}
              {snake.equippedSkill && renderSkillBadge(who, snake.equippedSkill)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1 h-6 tabular-nums gap-1">
            <div data-score-card={who} className="flex items-baseline gap-1 shrink-0">
              <span className="text-2xl leading-none font-black">{snake.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-tight">PTS</span>
              <span className="text-[9px] font-bold shrink-0 opacity-85">· LEN {snake.body.length}</span>
              <span data-sp-card={who} className="text-[9px] font-bold shrink-0" title="Skill points">· ⚡{snake.skillPoints ?? 0}</span>
            </div>
            {renderOutcomeBadge(who)}
            {gameState.turnBased && (
              <span className="text-[9px] font-bold opacity-80 whitespace-nowrap shrink-0">
                {lastTurn !== null ? `${lastTurn.toFixed(1)}s / ${fmtTotal(totalThink)}` : `TOT ${fmtTotal(totalThink)}`}
              </span>
            )}
          </div>
        </div>
        {gameState.turnBased && (
          local ? (
            <div className="mt-1.5 bg-[#8BAC0F]/40 border border-[#0F380F] px-1.5 h-7 portrait:h-auto portrait:min-h-7 portrait:max-h-[52px] portrait:overflow-y-auto flex items-center portrait:items-start justify-between gap-1 text-[9px] font-bold overflow-hidden">
              <div className="flex flex-wrap gap-1 content-start min-w-0">
                <span className="shrink-0">{locked ? '🔒 ' : '✏️ '}</span>
                {buffer.length === 0 ? (
                  <>
                    <span aria-hidden="true" className="px-1 py-0.5 bg-[#0F380F] text-[#9BBC0F] text-[10px] font-black shrink-0 invisible">↑</span>
                    <span aria-hidden="true" className="px-1 py-0.5 bg-[#0F380F] text-[#9BBC0F] text-[10px] font-black shrink-0 invisible portrait:inline hidden">↑</span>
                  </>
                ) : (
                  buffer.map((entry, idx) => {
                    const dir = entry.direction;
                    const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                    const label = entry.type === 'rattle' ? `⚡×${entry.primes ?? 1}${arrow}` : entry.type === 'dart' ? `⚡${arrow}` : arrow;
                    return (
                      <span key={idx} className="px-1 py-0.5 bg-[#0F380F] text-[#9BBC0F] text-[10px] font-black shrink-0">
                        {label}
                      </span>
                    );
                  })
                )}
                {mouseHints?.badge}
              </div>
              <span className="shrink-0 w-7 text-right text-base leading-none font-black tabular-nums">
                {!locked && countdown !== null && gameState.phase !== 'OVER' ? `${countdown}s` : ''}
              </span>
            </div>
          ) : (
            <div className={`mt-1.5 bg-[#8BAC0F]/30 border border-[#0F380F]/60 px-1.5 h-7 flex items-center justify-between gap-1 overflow-hidden ${locked ? 'opacity-90' : 'font-black'}`}>
              <span className="text-[10px] truncate tabular-nums">
                <span className="italic opacity-80">Hidden</span>
              </span>
              <span className="shrink-0 w-7 text-right text-base leading-none font-black tabular-nums">
                {!locked && countdown !== null && gameState.phase !== 'OVER' ? `${countdown}s` : ''}
              </span>
            </div>
          )
        )}
      </div>
    );
  };

  const renderMobileCards = (
    <div className="mobile-cards-area grid grid-cols-2 gap-2 w-full font-mono text-[#0F380F] shrink-0">
      <div className="flex flex-col gap-2 min-w-0">
        {leftSnakes.map(snake => renderMobilePlayerCard(snake))}
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        {rightSnakes.map(snake => renderMobilePlayerCard(snake))}
      </div>
    </div>
  );

  return (
    <>
      <div className="top-strip-area relative w-full flex flex-col items-center">
        {playMode === 'LOCAL_2P' && (
          <div data-testid="swipe-card-hint" className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none bg-[#0F380F]/95 text-[#9BBC0F] px-2 py-0.5 text-center text-[9px] font-black font-mono border border-[#0F380F] shadow-[1px_1px_0px_#0F380F] whitespace-nowrap">
            SWIPE YOUR CARD, NOT THE BOARD
          </div>
        )}
        <div className="portrait-match-header hidden w-full flex-col gap-1 font-mono text-[#0F380F]">
          <div className="flex h-8 items-center justify-between gap-1 border-2 border-[#0F380F] bg-[#8BAC0F] px-2 text-[10px] font-black tracking-tight">
            <span className={`min-w-0 truncate ${isRacing ? '' : isShrinking ? 'animate-pulse' : ''}`}>
              {isRacing ? 'PHASE 1: RACE' : isShrinking ? 'PHASE 2: SHRINK' : 'MATCH OVER'}
            </span>
            <span className="shrink-0 tabular-nums">RND {gameState.round}</span>
            <span className="shrink-0 tabular-nums">TURN {gameState.tick} · {isRacing ? `${gameState.phaseTurnsRemaining} LEFT` : isShrinking ? `RING IN ${gameState.phaseTurnsRemaining}` : 'OVER'}</span>
          </div>
          <div className="flex h-7 items-center justify-between gap-2 border-2 border-[#0F380F] bg-[#9BBC0F] px-2 text-[10px] font-bold tabular-nums">
            <span className="shrink-0">
              {gameState.turnBased ? `THINK ${portraitCountdown ?? '∞'}${portraitCountdown === null ? '' : 's'}` : `TIME ${formattedTime}`}
            </span>
            <span className="shrink-0 text-right">
              {gameState.turnBased
                ? isRacing ? `SHRINK IN ${gameState.phaseTurnsRemaining}` : isShrinking ? `RING IN ${gameState.phaseTurnsRemaining}` : 'SHRINK —'
                : isShrinking ? `RING IN ${formattedTime}` : `SHRINK IN ${formattedTime}`}
            </span>
            <button
              type="button"
              onClick={onOpenLatencyHarness}
              aria-label="Open network diagnostics"
              title="Open Latency Diagnostic Suite & Diagnostics"
              className="flex shrink-0 items-center gap-0.5 border border-[#0F380F] bg-[#8BAC0F] px-1 py-0.5"
            >
              <Activity className="h-3 w-3" />
              <Wifi className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
        {topStripContent}
        {objectiveList.length > 0 && (
          <div className="w-full border-x-2 border-b-2 border-[#0F380F] bg-[#9BBC0F] px-2 py-1 font-mono text-[9px] font-bold text-[#0F380F]">
            {objectiveList.map(({ objective, index }) => {
              const complete = isCampaignObjectiveComplete(objective, gameState, index);
              const icon = complete ? '✓' : gameState.phase === 'OVER' ? '✗' : '○';
              return (
                <div key={`${index}-${objective.text}`} className="flex justify-between gap-2">
                  <span className="truncate">{icon} {getCampaignObjectiveProgress(objective, gameState, index)}</span>
                  <span className="shrink-0">{index === 0 ? 'PRIMARY' : `BONUS ${index}`}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="portrait-opponents hidden w-full items-center gap-1 border-2 border-[#0F380F] bg-[#9BBC0F] px-1 py-0.5 font-mono text-[10px] font-bold text-[#0F380F]">
        {gameState.snakes.map((snake, idx) => {
          const who = snake.id;
          const palette = getPlayerColorPalette(snake, idx);
          return (
            <div key={who} className={`flex min-w-0 flex-1 items-center gap-1 ${isLocked(who) ? 'opacity-60' : 'opacity-100'}`}>
              <span className={`h-2.5 w-2.5 shrink-0 border border-[#0F380F] ${palette.chipBg}`} />
              <span className="min-w-0 flex-1 truncate">{snake.name}</span>
              <span data-score-card={who} className="shrink-0">{snake.score}</span>
              <span className="shrink-0 opacity-80">L{snake.body.length}</span>
              <span className="shrink-0">{isLocked(who) ? 'LOCK' : 'PLAN'}</span>
            </div>
          );
        })}
      </div>

      <div className="desktop-panel-left">
        {leftSnakes.map(snake => (
          <React.Fragment key={snake.id}>{renderDesktopPlayerPanel(snake.id)}</React.Fragment>
        ))}
      </div>

      <div className="desktop-panel-right">
        {rightSnakes.map(snake => (
          <React.Fragment key={snake.id}>{renderDesktopPlayerPanel(snake.id)}</React.Fragment>
        ))}
      </div>

      {renderMobileCards}

      {playMode === 'LOCAL_2P' && (
        <div className="portrait-p2-controls-row hidden w-full min-h-9 [@media(max-height:540px)]:min-h-7 items-center gap-1.5 font-mono select-none shrink-0">
          <button
            type="button"
            onClick={onP2Undo}
            disabled={!gameState.turnBased || isLocked('p2') || ((moveBuffers?.p2?.length ?? 0) === 0 && (pendingPrimesMap?.p2 ?? 0) === 0)}
            className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#306230] px-2.5 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            P2 UNDO
          </button>
          <div className="flex min-w-0 min-h-9 [@media(max-height:540px)]:min-h-7 flex-1 items-center gap-1 border-2 border-dashed border-[#0F380F] bg-[#8BAC0F] px-2 py-1 text-[10px] font-bold text-[#0F380F] tabular-nums">
            <span className="shrink-0">P2 {moveBuffers?.p2?.length ?? 0}/{getBufferCapacity(gameState.snakes.find(snake => snake.id === 'p2'))}</span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-0.5 content-start portrait:overflow-y-auto portrait:max-h-[44px]">
              {(moveBuffers?.p2 ?? []).map((entry, index) => {
                const dir = entry.direction;
                const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                const label = entry.type === 'rattle' ? `⚡×${entry.primes ?? 1}${arrow}` : entry.type === 'dart' ? `⚡${arrow}` : arrow;
                return (
                  <span key={`${dir}-${index}`} className="shrink-0 bg-[#0F380F] px-1 py-0.5 leading-none text-[#9BBC0F]">
                    {label}
                  </span>
                );
              })}
              {(moveBuffers?.p2?.length ?? 0) === 0 && (
                <>
                <span
                  aria-hidden="true"
                  className="shrink-0 bg-[#0F380F] px-1 py-0.5 leading-none text-[#9BBC0F] invisible"
                >↑</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 bg-[#0F380F] px-1 py-0.5 leading-none text-[#9BBC0F] invisible portrait:inline hidden"
                >↑</span>
                </>
              )}
            </span>
            {isLocked('p2') && <span className="shrink-0 bg-[#0F380F] text-[#9BBC0F] px-1 py-0.5 text-[9px] leading-none">LOCKED</span>}
          </div>
          <button
            type="button"
            onClick={onP2Lock}
            disabled={!gameState.turnBased || isLocked('p2') || (moveBuffers?.p2?.length ?? 0) === 0}
            className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#0F380F] px-2 text-[10px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            P2 LOCK
          </button>
        </div>
      )}
    </>
  );
};