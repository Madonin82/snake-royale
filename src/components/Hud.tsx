import React, { useEffect, useState } from 'react';
import { Direction, GameState, LatencyReport, PlayMode } from '../types/game';
import { Activity, Gamepad, Wifi } from 'lucide-react';

interface HudProps {
  gameState: GameState;
  playMode: PlayMode;
  latencyReport: LatencyReport;
  onOpenLatencyHarness: () => void;
  onOpenSettings: () => void;
  gamepadCount: number;
  locks?: { p1: boolean; p2: boolean };
  thinkSessions?: { p1: { startTime: number | null }; p2: { startTime: number | null } };
  thinkTimeRemaining?: { p1: number | null; p2: number | null };
  viewerSeat?: 'p1' | 'p2' | null;
  moveBuffers?: { p1: Direction[]; p2: Direction[] };
  replayActive?: boolean;
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
}) => {
  const { p1, p2 } = gameState.snakes;

  // Who is "you" on this screen, per seat — drives the (YOU) tags.
  const seatTag = (seat: 'p1' | 'p2'): string => {
    if (playMode === 'ONLINE_SERVER' || playMode === 'ONLINE_SPECTATOR') return seat === 'p1' ? '(P1)' : '(P2)';
    if (playMode === 'SOLO_AI') return seat === 'p1' ? '(YOU)' : '(BOT)';
    if (playMode === 'LOCAL_2P') return seat === 'p1' ? '(P1)' : '(P2)';
    if (viewerSeat) return viewerSeat === seat ? '(YOU)' : '(REMOTE)';
    return seat === 'p1' ? '(YOU)' : '';
  };
  const isRacing = gameState.phase === 'RACING';
  const isShrinking = gameState.phase === 'SHRINKING';

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
  const thinkLabel = (who: 'p1' | 'p2') => {
    const snake = who === 'p1' ? p1 : p2;
    if (!thinkSessions) return snake.name;
    const session = thinkSessions[who];
    const locked = isLocked(who);
    const lastTurn = gameState.lastTurnTimes ? (who === 'p1' ? gameState.lastTurnTimes.p1 : gameState.lastTurnTimes.p2) : null;
    if (locked) {
      return `${snake.name} ✓ ${lastTurn !== null ? `${lastTurn.toFixed(1)}s` : ''}`;
    }
    const elapsed = session.startTime !== null ? nowMs - session.startTime : 0;
    return `${snake.name} … ${fmtSecs(elapsed)}`;
  };

  const isLocked = (who: 'p1' | 'p2') => {
    if (!locks) return false;
    return who === 'p1' ? locks.p1 : locks.p2;
  };

  const isLocalSeat = (seat: 'p1' | 'p2'): boolean => {
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

  const renderOutcomeBadge = (who: 'p1' | 'p2') => {
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

  const renderDesktopPlayerPanel = (who: 'p1' | 'p2') => {
    const snake = who === 'p1' ? p1 : p2;
    const locked = isLocked(who);
    const canSeeMoves = replayActive || playMode === 'LOCAL_2P' || viewerSeat === who;
    const lastTurn = gameState.lastTurnTimes ? (who === 'p1' ? gameState.lastTurnTimes.p1 : gameState.lastTurnTimes.p2) : null;
    const totalThink = gameState.totalThinkTime ? (who === 'p1' ? gameState.totalThinkTime.p1 : gameState.totalThinkTime.p2) : 0;
    const buffer = moveBuffers ? (who === 'p1' ? moveBuffers.p1 : moveBuffers.p2) : [];
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
              buffer.map((dir, idx) => {
                const arrow = dir === 'UP' ? '↑' : dir === 'DOWN' ? '↓' : dir === 'LEFT' ? '←' : '→';
                return (
                  <span key={idx} className="px-1 py-0.5 bg-[#0F380F] text-[#9BBC0F] text-[10px] leading-tight font-bold border border-[#0F380F] shrink-0">
                    {arrow}
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
    <div className="mobile-cards-area grid grid-cols-2 gap-2 w-full font-mono text-[#0F380F] shrink-0">
      {(['p1', 'p2'] as const).map((who) => {
        const snake = who === 'p1' ? p1 : p2;
        const locked = isLocked(who);
        const buffer = moveBuffers ? (who === 'p1' ? moveBuffers.p1 : moveBuffers.p2) : [];
        const local = replayActive || isLocalSeat(who);
        const countdown = thinkTimeRemaining?.[who] ?? null;
        const lastTurn = gameState.lastTurnTimes ? (who === 'p1' ? gameState.lastTurnTimes.p1 : gameState.lastTurnTimes.p2) : null;
        const totalThink = gameState.totalThinkTime ? (who === 'p1' ? gameState.totalThinkTime.p1 : gameState.totalThinkTime.p2) : 0;
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
      </div>

      <div className="portrait-opponents hidden w-full items-center gap-1 border-2 border-[#0F380F] bg-[#9BBC0F] px-1 py-0.5 font-mono text-[10px] font-bold text-[#0F380F]">
        {(['p1', 'p2'] as const).map((who) => {
          const snake = who === 'p1' ? p1 : p2;
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
        {renderDesktopPlayerPanel('p1')}
      </div>

      <div className="desktop-panel-right">
        {renderDesktopPlayerPanel('p2')}
      </div>

      {renderMobileCards}
    </>
  );
};
