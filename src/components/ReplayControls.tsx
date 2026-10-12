import React, { useState, useEffect } from 'react';
import { Pause, Play, X, BarChart2 } from 'lucide-react';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { GameState } from '../types/game';
import { TurnDecision } from '../game/replayFile';
import { computeMatchStats, computeTurnLedger } from '../game/stats';
import { getPlayerColorPalette, splitPlayersTwoPerSide } from '../game/playerColors';
import { TurnLedgerView } from './MatchEndModal';

interface ReplayControlsProps {
  index: number; // current turn index (0-based)
  total: number; // total recorded states
  playing: boolean;
  speed: number; // turns per second
  onTogglePlay: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
  onExportReplay?: () => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
  matchHistory?: GameState[];
  turnDecisions?: TurnDecision[];
}

export const ReplayControls: React.FC<ReplayControlsProps> = ({
  index,
  total,
  playing,
  speed,
  onTogglePlay,
  onSeek,
  onSpeedChange,
  onExit,
  onExportReplay,
  onRegisterHandler,
  matchHistory = [],
  turnDecisions = [],
}) => {
  const max = Math.max(0, total - 1);
  const [statsOpen, setStatsOpen] = useState(false);

  const matchStats = computeMatchStats(matchHistory, turnDecisions);
  const turnLedgerEntries = computeTurnLedger(matchHistory, turnDecisions);
  const finalState = matchHistory[matchHistory.length - 1] || matchHistory[0];
  const snakes = finalState?.snakes && finalState.snakes.length > 0
    ? finalState.snakes
    : [
        { id: 'p1', name: 'PLAYER 1', color: '#0F380F', score: 0, kills: 0, isAlive: true, body: [], direction: 'RIGHT' as const, queuedDirection: null, skillPoints: 0, equippedSkill: null },
        { id: 'p2', name: 'PLAYER 2', color: '#306230', score: 0, kills: 0, isAlive: true, body: [], direction: 'LEFT' as const, queuedDirection: null, skillPoints: 0, equippedSkill: null },
      ];

  const [expandedBySeat, setExpandedBySeat] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(snakes.map(snake => [snake.id, true]))
  );

  const indexedSnakes = snakes.map((snake, idx) => ({ snake, index: idx }));
  const { left: leftSnakes, right: rightSnakes } = splitPlayersTwoPerSide(indexedSnakes);

  const renderStatCard = ({ snake, index: snakeIndex }: { snake: typeof snakes[number]; index: number }) => {
    const who = snake.id;
    const stats = matchStats.statsBySeat[who] ?? (who === 'p1' ? matchStats.p1Stats : matchStats.p2Stats);
    const isExpanded = expandedBySeat[who] ?? true;
    const isWinner = finalState?.winner === who;
    const palette = getPlayerColorPalette(snake, snakeIndex);

    return (
      <div
        key={who}
        data-testid={`replay-stats-card-${who}`}
        className={`p-2 border-2 ${palette.borderColor} ${palette.defaultShadow} flex flex-col items-center transition-all ${
          isWinner ? 'bg-[#9BBC0F]' : 'bg-[#8BAC0F]/90'
        }`}
      >
        <div
          onClick={() => {
            soundEngine.playMenuSelect();
            setExpandedBySeat(prev => ({ ...prev, [who]: !(prev[who] ?? true) }));
          }}
          className="flex items-center justify-between gap-1.5 w-full text-[11px] font-bold cursor-pointer hover:opacity-80"
          title="Tap to toggle panel"
        >
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <span
              data-testid={`replay-stats-color-chip-${who}`}
              className={`inline-block w-2.5 h-2.5 shrink-0 border border-[#0F380F] ${palette.chipBg}`}
              title={`Snake Color ${palette.hex}`}
            />
            <span
              data-testid={`replay-stats-standing-${who}`}
              className={`px-1 py-0.5 text-[9px] font-black leading-none shrink-0 border border-[#0F380F] ${
                stats.standing === 1 ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F] text-[#0F380F]'
              }`}
            >
              {stats.standingLabel}
            </span>
            <span className="truncate font-black">{snake.name}</span>
          </span>
          <span className="text-[9px] opacity-80 shrink-0">{isExpanded ? '▴ HIDE STATS' : '▾ SHOW STATS'}</span>
        </div>

        {/* Standings summary bar: Points, Tokens, Kills */}
        <div className="grid grid-cols-3 gap-1 w-full mt-1.5 bg-[#9BBC0F]/70 border border-[#0F380F] px-1.5 py-1 text-center">
          <div className="flex flex-col items-center">
            <span className="text-sm font-black leading-none tabular-nums">{stats.points}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">POINTS</span>
          </div>
          <div className="flex flex-col items-center border-x border-[#0F380F]/40">
            <span className="text-sm font-black leading-none tabular-nums">{stats.tokensCollected}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">TOKENS</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-sm font-black leading-none tabular-nums">{stats.kills}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">KILLS</span>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-1.5 pt-1.5 border-t border-[#0F380F] w-full text-[10px] font-bold space-y-1 bg-[#8BAC0F]/50 p-1.5">
            <div className="flex justify-between"><span>Avg Lock:</span><span className="tabular-nums">{stats.avgLockTime}</span></div>
            <div className="flex justify-between"><span>Fast / Slow:</span><span className="tabular-nums">{stats.fastestLock} / {stats.slowestLock}</span></div>
            <div className="flex justify-between"><span>Auto-Locks:</span><span className="tabular-nums">{stats.autoLockPct}</span></div>
            <div className="flex justify-between"><span>Avg Queue:</span><span className="tabular-nums">{stats.avgQueueLen}</span></div>
            <div className="flex justify-between"><span>Outcome:</span><span className="truncate max-w-[110px]">{stats.causeOfDeath}</span></div>
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    const handleAction = (action: GamepadMenuAction) => {
      if (statsOpen) {
        if (action === 'CANCEL' || action === 'CONFIRM' || action === 'START') {
          soundEngine.playMenuBack();
          setStatsOpen(false);
        }
        return;
      }

      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        onExit();
        return;
      }

      if (action === 'CONFIRM' || action === 'START') {
        soundEngine.playMenuSelect();
        onTogglePlay();
        return;
      }

      if (action === 'LEFT') {
        soundEngine.playMenuMove();
        onSeek(Math.max(0, index - 1));
        return;
      }

      if (action === 'RIGHT') {
        soundEngine.playMenuMove();
        onSeek(Math.min(max, index + 1));
        return;
      }

      if (action === 'PREV_TAB' || action === 'NEXT_TAB') {
        soundEngine.playMenuSelect();
        const speeds = [2, 5, 10];
        const curIdx = speeds.indexOf(speed);
        const nextIdx = action === 'NEXT_TAB'
          ? (curIdx + 1) % speeds.length
          : (curIdx - 1 + speeds.length) % speeds.length;
        onSpeedChange(speeds[nextIdx]);
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [index, max, speed, statsOpen, onExit, onTogglePlay, onSeek, onSpeedChange, onRegisterHandler]);

  return (
    <div className="w-full max-w-[360px] sm:max-w-[420px] md:max-w-[480px] bg-[#8BAC0F] border-2 border-[#0F380F] px-3 py-2 font-mono text-[#0F380F] flex flex-col gap-2 relative">
      {statsOpen && (
        <div className="absolute bottom-full mb-2 inset-x-0 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[4px_4px_0px_#0F380F] p-3 z-30 flex flex-col gap-2 text-left animate-fadeIn max-h-[70dvh] overflow-y-auto">
          <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-1">
            <span className="font-black text-xs uppercase">📊 Match Analytics & Stats</span>
            <button
              onClick={() => { soundEngine.playMenuBack(); setStatsOpen(false); }}
              className="px-1.5 py-0.5 bg-[#8BAC0F] border border-[#0F380F] text-[10px] font-bold cursor-pointer"
            >
              ✕ CLOSE
            </button>
          </div>

          {/* Final Standings Banner (1st - 4th) */}
          {matchStats.standings.length > 0 && (
            <div
              data-testid="replay-stats-standings-strip"
              className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-black"
            >
              {matchStats.standings.map((entry) => {
                const snakeIndex = snakes.findIndex(s => s.id === entry.id);
                const palette = getPlayerColorPalette({ id: entry.id, color: entry.color }, snakeIndex >= 0 ? snakeIndex : 0);
                return (
                  <span
                    key={entry.id}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 border border-[#0F380F] ${
                      entry.standing === 1 ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#8BAC0F] text-[#0F380F]'
                    }`}
                  >
                    <span className={`inline-block w-2 h-2 border border-[#9BBC0F]/60 ${palette.chipBg}`} />
                    <span>{entry.standingLabel} {entry.name}</span>
                    <span className="opacity-85">({entry.points} PTS · {entry.tokensCollected} 💎 · {entry.kills} ⚔)</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Player Stat Cards — 2 per side (Left: P1, P2; Right: P3, P4) */}
          <div
            data-testid="replay-stats-cards-grid"
            className="flex flex-col sm:grid sm:grid-cols-2 gap-2"
          >
            <div data-testid="replay-stats-side-left" className="flex flex-col gap-2">
              {leftSnakes.map(renderStatCard)}
            </div>
            <div data-testid="replay-stats-side-right" className="flex flex-col gap-2">
              {rightSnakes.map(renderStatCard)}
            </div>
          </div>

          {/* Per-Turn Detail Ledger (with collapsible TURNS/TIME toggle row) */}
          <TurnLedgerView entries={turnLedgerEntries} matchStats={matchStats} snakes={finalState?.snakes} />
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-black uppercase">
        <span>▶ Match Replay</span>
        <span>
          Turn {Math.min(index, max)} / {max}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              soundEngine.playMenuSelect();
              setStatsOpen(prev => !prev);
            }}
            className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
            title="View Match Analytics & Stats"
          >
            <BarChart2 className="w-3 h-3" />
            <span>STATS</span>
          </button>
          {onExportReplay && (
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onExportReplay();
              }}
              className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
              title="Export Replay JSON"
            >
              <span>EXPORT ⬇</span>
            </button>
          )}
          <button
            onClick={() => {
              soundEngine.playMenuBack();
              onExit();
            }}
            className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>EXIT [B]</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            onTogglePlay();
          }}
          className="bg-[#0F380F] text-[#9BBC0F] px-3 py-1.5 border border-[#0F380F] font-black text-xs flex items-center gap-1 cursor-pointer"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{playing ? 'PAUSE [A]' : 'PLAY [A]'}</span>
        </button>

        <input
          type="range"
          min={0}
          max={max}
          value={Math.min(index, max)}
          onChange={(e) => onSeek(parseInt(e.target.value, 10))}
          className="flex-1 accent-[#0F380F] cursor-pointer"
          aria-label="Scrub replay"
        />

        <div className="flex gap-1">
          {[2, 5, 10].map((s) => (
            <button
              key={s}
              onClick={() => {
                soundEngine.playMenuSelect();
                onSpeedChange(s);
              }}
              className={`px-1.5 py-1 border border-[#0F380F] text-[10px] font-black cursor-pointer ${
                speed === s ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Gamepad Helper */}
      <div className="text-center text-[9px] font-bold opacity-80 flex items-center justify-around">
        <span>[◄ ►] STEP TURN</span>
        <span>[A] PLAY/PAUSE</span>
        <span>[LB/RB] SPEED</span>
        <span>[B] EXIT</span>
      </div>
    </div>
  );
};
