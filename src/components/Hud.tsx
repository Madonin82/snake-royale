import React, { useEffect, useState } from 'react';
import { GameState, LatencyReport, PlayMode } from '../types/game';
import { Activity, Gamepad, Wifi } from 'lucide-react';

interface HudProps {
  gameState: GameState;
  playMode: PlayMode;
  latencyReport: LatencyReport;
  onOpenLatencyHarness: () => void;
  onOpenSettings: () => void;
  gamepadCount: number;
  locks?: { p1: boolean; p2: boolean };
  turnClock?: { startedAt: number; p1At: number | null; p2At: number | null };
  viewerSeat?: 'p1' | 'p2' | null;
}

export const Hud: React.FC<HudProps> = ({
  gameState,
  playMode,
  latencyReport,
  onOpenLatencyHarness,
  gamepadCount,
  locks,
  turnClock,
  viewerSeat,
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
    if (!turnClock) return snake.name;
    const at = who === 'p1' ? turnClock.p1At : turnClock.p2At;
    return at !== null
      ? `${snake.name} ✓ ${fmtSecs(at - turnClock.startedAt)}`
      : `${snake.name} … ${fmtSecs(nowMs - turnClock.startedAt)}`;
  };

  const isLocked = (who: 'p1' | 'p2') => {
    if (!locks || !turnClock) return false;
    return who === 'p1' ? locks.p1 : locks.p2;
  };

  // Format seconds mm:ss
  const totalSeconds = Math.ceil(gameState.phaseTimeRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const topStripContent = (
    <div className="flex items-center justify-between bg-[#8BAC0F] px-3 py-1.5 border-2 border-[#0F380F] text-xs font-bold tracking-wider w-full shadow-[2px_2px_0px_#0F380F]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`px-1.5 py-0.5 border border-[#0F380F] text-[10px] ${
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
        {isRacing && (
          <span className="text-[10px] bg-[#9BBC0F] px-1 border border-[#0F380F]">
            RND {gameState.round} ({gameState.tokens.length} 💎)
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {gameState.turnBased && gameState.phase !== 'OVER' && (
          <span className="hidden xl:inline text-[9px] opacity-80 whitespace-nowrap">BOTH LOCK → BOARD STEPS</span>
        )}

        <div className="text-xs md:text-sm font-black tracking-widest bg-[#9BBC0F] px-2 py-0.5 border border-[#0F380F]">
          {gameState.turnBased
            ? `TURN ${gameState.tick} • ${gameState.phase === 'RACING' ? `${gameState.phaseTurnsRemaining} LEFT` : gameState.phase === 'SHRINKING' ? `RING IN ${gameState.phaseTurnsRemaining}` : '—'}`
            : `⏱️ ${formattedTime}`}
        </div>

        {gamepadCount > 0 && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-[#0F380F] font-bold bg-[#9BBC0F] px-1 border border-[#0F380F]">
            <Gamepad className="w-3 h-3" /> {gamepadCount}
          </span>
        )}

        <button
          onClick={onOpenLatencyHarness}
          className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F] px-2 py-0.5 border border-[#0F380F] font-bold cursor-pointer transition-colors text-[10px]"
          title="Open Latency Diagnostic Suite & Diagnostics"
        >
          <Activity className="w-3 h-3" />
          <span>NET: {latencyReport.medianRtt > 0 ? `${latencyReport.medianRtt}ms` : 'DIAG'}</span>
          {latencyReport.inputTickLagAvg > 0 && (
            <span className="text-[9px] opacity-90">({latencyReport.inputTickLagAvg}t lag)</span>
          )}
          <Wifi className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );

  const renderDesktopPlayerPanel = (who: 'p1' | 'p2') => {
    const snake = who === 'p1' ? p1 : p2;
    const locked = isLocked(who);
    const lastTurn = gameState.lastTurnTimes ? (who === 'p1' ? gameState.lastTurnTimes.p1 : gameState.lastTurnTimes.p2) : null;
    const totalThink = gameState.totalThinkTime ? (who === 'p1' ? gameState.totalThinkTime.p1 : gameState.totalThinkTime.p2) : 0;

    return (
      <div className="bg-[#9BBC0F] p-3 border-2 border-[#0F380F] flex flex-col justify-between h-full shadow-[2px_2px_0px_#0F380F] w-full font-mono text-[#0F380F]">
        <div>
          <div className="flex items-center justify-between text-xs font-bold mb-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={`w-3 h-3 shrink-0 ${who === 'p1' ? 'bg-[#0F380F]' : 'bg-[#306230]'} inline-block border border-[#0F380F]`} />
              <span className="truncate">{snake.name} {seatTag(who)}</span>
            </span>
          </div>

          <div className="flex items-baseline justify-between mb-3">
            <div>
              <span className="text-3xl font-black">{snake.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-tight ml-1">PTS</span>
            </div>
            <span className="text-xs font-bold opacity-80">LEN: {snake.body.length}</span>
          </div>

          {gameState.turnBased && gameState.phase !== 'OVER' && (
            <div className="mb-3 p-2 bg-[#8BAC0F]/40 border border-[#0F380F] text-xs font-bold">
              <div className={`truncate ${locked ? 'text-[#0F380F] opacity-100 font-extrabold' : 'opacity-60'}`}>
                {thinkLabel(who)}
              </div>
              {lastTurn !== null && (
                <div className="text-[10px] opacity-80 mt-1.5 flex justify-between">
                  <span>LAST: {lastTurn.toFixed(1)}s</span>
                  <span>TOT: {fmtTotal(totalThink)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Empty reserved placeholder section at bottom (min-height, no content) */}
        <div className="min-h-[80px] flex-1 bg-[#8BAC0F]/20 border border-dashed border-[#0F380F]/40 flex items-center justify-center text-[10px] opacity-50 tracking-wider">
          {/* Queued moves reserved slot */}
        </div>
      </div>
    );
  };

  const renderMobileCards = (
    <div className="mobile-cards-area grid grid-cols-2 gap-2 w-full max-w-[340px] sm:max-w-[400px] font-mono text-[#0F380F]">
      {(['p1', 'p2'] as const).map((who) => {
        const snake = who === 'p1' ? p1 : p2;
        const locked = isLocked(who);
        return (
          <div key={who} className="bg-[#9BBC0F] p-2 border-2 border-[#0F380F] flex flex-col justify-between shadow-[2px_2px_0px_#0F380F]">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1 min-w-0">
                <span className={`w-2.5 h-2.5 shrink-0 ${who === 'p1' ? 'bg-[#0F380F]' : 'bg-[#306230]'} inline-block border border-[#0F380F]`} />
                <span className="truncate">{snake.name} {seatTag(who)}</span>
              </span>
              <span className="text-[10px] opacity-80">LEN: {snake.body.length}</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xl font-black">{snake.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-tight">PTS</span>
            </div>
            {gameState.turnBased && gameState.phase !== 'OVER' && (
              <div className={`text-[10px] mt-1 truncate ${locked ? 'opacity-100 font-bold' : 'opacity-60'}`}>
                {thinkLabel(who)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="top-strip-area w-full flex flex-col items-center">
        {topStripContent}
        {gameState.turnBased && gameState.phase !== 'OVER' && (
          <div className="md:hidden text-center text-[10px] font-bold bg-[#8BAC0F] px-2 py-0.5 border-x-2 border-b-2 border-[#0F380F] w-full">
            BOTH LOCK → BOARD STEPS
          </div>
        )}
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
