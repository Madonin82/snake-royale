import React, { useEffect, useState } from 'react';
import { BufferEntry, Direction, GameState, LatencyReport, PlayMode } from '../types/game';
import { Activity, Gamepad, Wifi } from 'lucide-react';
import { getCampaignObjectiveProgress, isCampaignObjectiveComplete } from '../game/objectives';

interface HudProps {
  gameState: GameState;
  playMode: PlayMode;
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
}

export const Hud: React.FC<HudProps> = ({
  gameState,
  playMode,
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
}) => {
  // Who is "you" on this screen, per seat — drives the (YOU) tags.
  const seatTag = (seat: string): string => {
    const seatNumber = Number(seat.slice(1));
    if (playMode === 'ONLINE_SERVER' || playMode === 'ONLINE_SPECTATOR') return `(P${seatNumber})`;
    if (playMode === 'SOLO_AI') return seat === 'p1' ? '(YOU)' : `(BOT ${seatNumber})`;
    if (playMode === 'LOCAL_2P') return `(P${seatNumber})`;
    if (viewerSeat) return viewerSeat === seat ? '(YOU)' : '(REMOTE)';
    return seat === 'p1' ? '(YOU)' : '';
  };
  const isRacing = gameState.phase === 'RACING';
  const isShrinking = gameState.phase === 'SHRINKING';
  const objectiveList = gameState.campaignObjectives
    ? [gameState.campaignObjectives.primary, ...gameState.campaignObjectives.bonus]
        .map((objective, index) => ({ objective, index }))
        .filter((item): item is { objective: NonNullable<typeof item.objective>; index: number } => item.objective !== null)
    : [];

  // Live clock for the turn timer (re-renders 4x/sec while a turn is open)
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
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
    return seat === 'p1';
  };

  // Format seconds mm:ss
  const totalSeconds = Math.ceil(gameState.phaseTimeRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  const portraitTimerSeat = viewerSeat ?? 'p1';
  const portraitCountdown = thinkTimeRemaining?.[portraitTimerSeat] ?? null;
  const topStripContent = (
    <div className="top-strip-content h-9 [@media(max-height:540px)]:h-7 flex items-center justify-between gap-2 bg-[#8BAC0F] px-2.5 border-2 border-[#0F380F] text-xs font-bold tracking-wider w-full shadow-[2px_2px_0px_#0F380F] overflow-hidden shrink-0">
      <div className="flex items-center gap-1.5 flex-nowrap min-w-0 overflow-hidden">
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
            : `MATCH OVER`}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[10px] leading-tight bg-[#9BBC0F] px-1.5 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] tabular-nums">
          {isRacing ? `RND ${gameState.round} (${gameState.tokens.length} 💎)` : `RING ${gameState.ringInset}`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {gameState.turnBased && (
          <span className="hidden lg:inline text-[9px] opacity-80 whitespace-nowrap">
            {gameState.phase === 'OVER' ? 'GAME!' : 'BOTH LOCK → BOARD STEPS'}
          </span>
        )}

        <div className="whitespace-nowrap text-xs md:text-sm [@media(max-height:540px)]:text-[11px] leading-tight font-black tracking-widest bg-[#9BBC0F] px-2 py-0.5 [@media(max-height:540px)]:py-0 border border-[#0F380F] tabular-nums min-w-[8.5rem] text-center">
          {gameState.turnBased
            ? `TURN ${gameState.tick} • ${gameState.phase === 'RACING' ? `${gameState.phaseTurnsRemaining} LEFT` : gameState.phase === 'SHRINKING' ? `RING IN ${gameState.phaseTurnsRemaining}` : 'OVER'}`
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

  const renderDesktopPlayerPanel = (who: string) => {
    const snake = gameState.snakes.find(candidate => candidate.id === who);
    if (!snake) return null;
    const locked = isLocked(who);
    const canSeeMoves = replayActive || playMode === 'LOCAL_2P' || viewerSeat === who || gameState.snakes.length > 2;
    const lastTurn = gameState.lastTurnTimes?.[who] ?? null;
    const totalThink = gameState.totalThinkTime?.[who] ?? 0;
    const buffer = moveBuffers?.[who] ?? [];
    const countdown = thinkTimeRemaining?.[who] ?? null;

    return (
      <div className="bg-[#9BBC0F] p-3 [@media(max-height:540px)]:p-2 border-2 border-[#0F380F] flex flex-col h-full min-h-0 overflow-hidden shadow-[2px_2px_0px_#0F380F] w-full font-mono text-[#0F380F]">
        <div className="shrink-0">
          <div className="flex items-center justify-between text-xs [@media(max-height:540px)]:text-[11px] font-bold mb-2 [@media(max-height:540px)]:mb-1 h-4">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={`w-3 h-3 [@media(max-height:540px)]:w-2.5 [@media(max-height:540px)]:h-2.5 shrink-0 ${who === 'p1' ? 'bg-[#0F380F]' : 'bg-[#306230]'} inline-block border border-[#0F380F]`} />
              <span className="truncate">{snake.name} {seatTag(who)}</span>
            </span>
          </div>

          <div className="flex items-center justify-between mb-2 [@media(max-height:540px)]:mb-1 h-8 [@media(max-height:540px)]:h-6">
            <div className="flex items-baseline tabular-nums">
              <span className="text-3xl [@media(max-height:540px)]:text-2xl leading-none font-black">{snake.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-tight ml-1">PTS</span>
            </div>
            {snake.equippedSkill && (
              <span className="text-[9px] px-1.5 py-0.5 bg-[#0F380F] text-[#9BBC0F] border border-[#0F380F] font-black uppercase">
                ⚡ {snake.equippedSkill} (2)
              </span>
            )}
            {renderOutcomeBadge(who)}
            <span className="text-xs [@media(max-height:540px)]:text-[10px] font-bold opacity-80 tabular-nums">LEN: {snake.body.length}</span>
          </div>

          {gameState.turnBased && (
            <div className="mb-2 [@media(max-height:540px)]:mb-1 p-1.5 [@media(max-height:540px)]:p-1 bg-[#8BAC0F]/40 border border-[#0F380F] text-xs [@media(max-height:540px)]:text-[10px] font-bold h-[52px] [@media(max-height:540px)]:h-[42px] flex flex-col justify-between overflow-hidden">
              <div className={`flex items-center justify-between gap-1 h-6 [@media(max-height:540px)]:h-5 ${locked ? 'text-[#0F380F] opacity-100 font-extrabold' : 'opacity-80'}`}>
                <span className="truncate tabular-nums">
                  {gameState.phase === 'OVER'
                    ? gameState.winner === 'DRAW'
                      ? 'DRAW GAME'
                      : gameState.winner === who
                      ? '★ WINNER'
                      : '✕ DEFEATED'
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
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#8BAC0F]/20 border border-dashed border-[#0F380F]/40 p-1.5 [@media(max-height:540px)]:p-1 flex flex-col justify-start">
          <div className="text-[9px] font-bold opacity-75 mb-1 flex justify-between items-center shrink-0 h-3.5 tabular-nums">
            <span>QUEUE ({buffer.length}/{snake.body.length})</span>
            {locked && <span className="text-[8px] px-1 bg-[#0F380F] text-[#9BBC0F]">LOCKED</span>}
          </div>
          <div className="flex flex-wrap gap-1 content-start">
            {buffer.length === 0 ? (
              <span className="text-[10px] [@media(max-height:540px)]:text-[9px] opacity-50 italic">Swipe/tap board</span>
            ) : !canSeeMoves ? (
              <span className="text-[10px] opacity-60 italic">Hidden</span>
            ) : (
              buffer.map((entry, idx) => {
                const dir = entry.direction;
                const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                const label = entry.type === 'dart' ? `⚡${arrow}` : arrow;
                return (
                  <span key={idx} className="px-1 py-0.5 bg-[#0F380F] text-[#9BBC0F] text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0">
                    {label}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMobileCards = (
    <div className={`mobile-cards-area grid ${gameState.snakes.length > 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 w-full font-mono text-[#0F380F] shrink-0`}>
    {gameState.snakes.map((snake) => {
      const who = snake.id;
        const locked = isLocked(who);
        const buffer = moveBuffers?.[who] ?? [];
        const local = replayActive || isLocalSeat(who) || gameState.snakes.length > 2;
        const countdown = thinkTimeRemaining?.[who] ?? null;
        const lastTurn = gameState.lastTurnTimes?.[who] ?? null;
        const totalThink = gameState.totalThinkTime?.[who] ?? 0;
        return (
          <div key={who} className="bg-[#9BBC0F] p-2 border-2 border-[#0F380F] flex flex-col justify-between shadow-[2px_2px_0px_#0F380F] min-w-0 overflow-hidden">
            <div className="shrink-0">
              <div className="flex items-center justify-between text-[11px] font-bold h-4">
                <span className="flex items-center gap-1 min-w-0">
                  <span className={`w-2.5 h-2.5 shrink-0 ${who === 'p1' ? 'bg-[#0F380F]' : 'bg-[#306230]'} inline-block border border-[#0F380F]`} />
                  <span className="truncate">{snake.name} {seatTag(who)}</span>
                </span>
                <span className="text-[10px] opacity-80 shrink-0 tabular-nums">LEN: {snake.body.length}</span>
              </div>
              <div className="flex items-center justify-between mt-1 h-6 tabular-nums gap-1">
                <div className="flex items-baseline gap-1 shrink-0">
                  <span className="text-2xl leading-none font-black">{snake.score}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-tight">PTS</span>
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
                <div className="mt-1.5 bg-[#8BAC0F]/40 border border-[#0F380F] px-1.5 h-7 flex items-center justify-between gap-1 text-[9px] font-bold">
                  <span className="shrink-0 tabular-nums">{locked ? '🔒 ' : ''}QUEUE {buffer.length}/{snake.body.length}</span>
                  <span className="min-w-0 flex-1 truncate text-right opacity-80">
                    {buffer.map(entry => {
                      const dir = entry.direction;
                      const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                      return entry.type === 'dart' ? `⚡${arrow}` : arrow;
                    }).join('')}
                  </span>
                  <span className="shrink-0 w-7 text-right text-base leading-none font-black tabular-nums">
                    {!locked && countdown !== null && gameState.phase !== 'OVER' ? `${countdown}s` : ''}
                  </span>
                </div>
              ) : (
                <div className={`mt-1.5 bg-[#8BAC0F]/30 border border-[#0F380F]/60 px-1.5 h-7 flex items-center justify-between gap-1 overflow-hidden ${locked ? 'opacity-100 font-bold' : 'opacity-75'}`}>
                  <span className="text-[10px] truncate tabular-nums">
                    {thinkLabel(who)} {locked ? '🔒' : countdown === null ? `(${buffer.length})` : ''}
                  </span>
                  <span className="shrink-0 w-7 text-right text-base leading-none font-black tabular-nums">
                    {!locked && countdown !== null && gameState.phase !== 'OVER' ? `${countdown}s` : ''}
                  </span>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="top-strip-area w-full flex flex-col items-center">
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
        {gameState.snakes.map((snake) => {
          const who = snake.id;
          return (
            <div key={who} className="flex min-w-0 flex-1 items-center gap-1">
              <span className={`h-2 w-2 shrink-0 border border-[#0F380F] ${who === 'p1' ? 'bg-[#0F380F]' : 'bg-[#306230]'}`} />
              <span className="min-w-0 flex-1 truncate">{snake.name}</span>
              <span className="shrink-0">{snake.score}</span>
              <span className="shrink-0 opacity-80">L{snake.body.length}</span>
              <span className="shrink-0">{isLocked(who) ? 'LOCK' : 'PLAN'}</span>
            </div>
          );
        })}
      </div>

      <div className="desktop-panel-left">
        {gameState.snakes[0] && renderDesktopPlayerPanel(gameState.snakes[0].id)}
      </div>

      <div className="desktop-panel-right">
        {gameState.snakes.slice(1).map(snake => (
          <React.Fragment key={snake.id}>{renderDesktopPlayerPanel(snake.id)}</React.Fragment>
        ))}
      </div>

      {renderMobileCards}

      {playMode === 'LOCAL_2P' && (
        <div className="portrait-p2-controls-row hidden w-full min-h-9 [@media(max-height:540px)]:min-h-7 items-center gap-1.5 font-mono select-none shrink-0">
          <button
            type="button"
            onClick={onP2Undo}
            disabled={!gameState.turnBased || isLocked('p2') || (moveBuffers?.p2?.length ?? 0) === 0}
            className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#306230] px-2.5 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            P2 UNDO
          </button>
          <div className="flex min-w-0 min-h-9 [@media(max-height:540px)]:min-h-7 flex-1 flex-wrap items-center gap-1 border-2 border-dashed border-[#0F380F] bg-[#8BAC0F] px-2 py-1 text-[10px] font-bold text-[#0F380F] tabular-nums">
            <span className="shrink-0">P2 QUEUE {moveBuffers?.p2?.length ?? 0}/{gameState.snakes.find(snake => snake.id === 'p2')?.body.length ?? 0}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-0.5">
              {(moveBuffers?.p2 ?? []).map((direction, index) => (
                <span key={`${direction}-${index}`} className="shrink-0 bg-[#0F380F] px-1 py-0.5 leading-none text-[#9BBC0F]">
                  {direction === 'UP' ? '↑' : direction === 'DOWN' ? '↓' : direction === 'LEFT' ? '←' : '→'}
                </span>
              ))}
              {(moveBuffers?.p2?.length ?? 0) === 0 && <span className="opacity-75 truncate">SWIPE / TAP TOP</span>}
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
