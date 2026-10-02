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
    if (playMode === 'ONLINE_SERVER') return seat === 'p1' ? '(P1)' : '(P2)';
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

  // Format seconds mm:ss
  const totalSeconds = Math.ceil(gameState.phaseTimeRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <div className="w-full max-w-[340px] sm:max-w-[400px] md:max-w-[460px] flex flex-col gap-2 font-mono text-[#0F380F]">
      {/* Top Banner: Status & Phase Indicator */}
      <div className="flex items-center justify-between bg-[#8BAC0F] px-3 py-1.5 border-2 border-[#0F380F] text-xs font-bold tracking-wider">
        <div className="flex items-center gap-2">
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

        {/* Phase Clock / Turn Counter */}
        <div className="text-sm font-black tracking-widest bg-[#9BBC0F] px-2 py-0.5 border border-[#0F380F]">
          {gameState.turnBased
            ? `TURN ${gameState.tick} • ${gameState.phase === 'RACING' ? `${gameState.phaseTurnsRemaining} LEFT` : gameState.phase === 'SHRINKING' ? `RING IN ${gameState.phaseTurnsRemaining}` : '—'}`
            : `⏱️ ${formattedTime}`}
        </div>
      </div>

      {/* Turn-based lock status + per-player thinking time */}
      {gameState.turnBased && locks && gameState.phase !== 'OVER' && (
        <div className="flex flex-col gap-0.5 text-[10px] font-bold bg-[#8BAC0F] px-2.5 py-1 border-2 border-[#0F380F]">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate ${locks.p1 ? 'text-[#0F380F]' : 'opacity-60'}`}>
              {thinkLabel('p1')}
            </span>
            <span className="opacity-70 whitespace-nowrap">BOTH LOCK → BOARD STEPS</span>
            <span className={`truncate text-right ${locks.p2 ? 'text-[#0F380F]' : 'opacity-60'}`}>
              {thinkLabel('p2')}
            </span>
          </div>
          {gameState.lastTurnTimes && (
            <div className="text-center opacity-70">
              LAST TURN — {p1.name} {gameState.lastTurnTimes.p1.toFixed(1)}s · {p2.name} {gameState.lastTurnTimes.p2.toFixed(1)}s
              {'  |  '}TOTAL — {p1.name} {fmtTotal(gameState.totalThinkTime.p1)} · {p2.name} {fmtTotal(gameState.totalThinkTime.p2)}
            </div>
          )}
        </div>
      )}

      {/* Score Boards: P1 vs P2 */}
      <div className="grid grid-cols-2 gap-2">
        {/* Player 1 Card */}
        <div className="bg-[#9BBC0F] p-2 border-2 border-[#0F380F] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2.5 h-2.5 shrink-0 bg-[#0F380F] inline-block border border-[#0F380F]" />
              <span className="truncate">{p1.name} {seatTag('p1')}</span>
            </span>
            <span className="text-[10px] opacity-80">LEN: {p1.body.length}</span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black">{p1.score}</span>
            <span className="text-[10px] font-semibold uppercase tracking-tight">PTS</span>
          </div>
        </div>

        {/* Player 2 Card */}
        <div className="bg-[#9BBC0F] p-2 border-2 border-[#0F380F] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2.5 h-2.5 shrink-0 bg-[#306230] inline-block border border-[#0F380F]" />
              <span className="truncate">{p2.name} {seatTag('p2')}</span>
            </span>
            <span className="text-[10px] opacity-80">LEN: {p2.body.length}</span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black">{p2.score}</span>
            <span className="text-[10px] font-semibold uppercase tracking-tight">PTS</span>
          </div>
        </div>
      </div>

      {/* Bottom Bar: Mode + Gamepad Indicator + NET telemetry toggle */}
      <div className="flex items-center justify-between text-[10px] bg-[#8BAC0F] px-2.5 py-1 border-2 border-[#0F380F]">
        <div className="flex items-center gap-2">
          {gamepadCount > 0 ? (
            <span className="flex items-center gap-1 text-[#0F380F] font-bold bg-[#9BBC0F] px-1 border border-[#0F380F]">
              <Gamepad className="w-3 h-3" /> GP: {gamepadCount}
            </span>
          ) : (
            <span className="text-[#306230] font-medium">⌨️ WASD/ARROWS</span>
          )}
        </div>

        {/* NET Latency Readout Button (First-class feature per spec) */}
        <button
          onClick={onOpenLatencyHarness}
          className="flex items-center gap-1.5 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-[#0F380F] px-2 py-0.5 border border-[#0F380F] font-bold cursor-pointer transition-colors shadow-[1px_1px_0px_#0F380F]"
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
};
