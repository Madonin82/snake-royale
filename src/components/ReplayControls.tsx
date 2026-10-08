import React, { useState, useEffect } from 'react';
import { Pause, Play, X, BarChart2 } from 'lucide-react';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { GameState } from '../types/game';
import { TurnDecision } from '../game/replayFile';
import { computeMatchStats, computeTurnLedger } from '../game/stats';
import { Sparkline, TurnLedgerView } from './MatchEndModal';

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
  
  const [expandedP1, setExpandedP1] = useState(true);
  const [expandedP2, setExpandedP2] = useState(true);

  const matchStats = computeMatchStats(matchHistory, turnDecisions);
  const turnLedgerEntries = computeTurnLedger(matchHistory, turnDecisions);
  const finalState = matchHistory[matchHistory.length - 1] || matchHistory[0];
  const p1 = finalState?.snakes?.p1 || { name: 'PLAYER 1', score: 0 };
  const p2 = finalState?.snakes?.p2 || { name: 'PLAYER 2', score: 0 };

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

          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
            {(['p1', 'p2'] as const).map((who) => {
              const snake = who === 'p1' ? p1 : p2;
              const stats = who === 'p1' ? matchStats.p1Stats : matchStats.p2Stats;
              const isExpanded = who === 'p1' ? expandedP1 : expandedP2;

              return (
                <div
                  key={who}
                  className="p-2 border-2 border-[#0F380F] bg-[#8BAC0F]/85 flex flex-col items-center"
                >
                  <div
                    onClick={() => {
                      soundEngine.playMenuSelect();
                      if (who === 'p1') setExpandedP1(prev => !prev);
                      else setExpandedP2(prev => !prev);
                    }}
                    className="flex items-center justify-between w-full text-[11px] font-bold cursor-pointer hover:opacity-80"
                    title="Tap to toggle panel"
                  >
                    <span className="truncate">{snake.name}</span>
                    <span className="text-[9px] opacity-80">{isExpanded ? '▴ HIDE STATS' : '▾ SHOW STATS'}</span>
                  </div>
                  <div className="text-xl font-black mt-0.5 tabular-nums">{stats.score} PTS</div>

                  {isExpanded && (
                    <div className="mt-2 pt-1.5 border-t border-[#0F380F] w-full text-[10px] font-bold space-y-1 bg-[#8BAC0F]/50 p-1.5">
                      <div className="flex justify-between"><span>Avg Lock:</span><span className="tabular-nums">{stats.avgLockTime}</span></div>
                      <div className="flex justify-between"><span>Fast / Slow:</span><span className="tabular-nums">{stats.fastestLock} / {stats.slowestLock}</span></div>
                      <div className="flex justify-between"><span>Auto-Locks:</span><span className="tabular-nums">{stats.autoLockPct}</span></div>
                      <div className="flex justify-between"><span>Avg Queue:</span><span className="tabular-nums">{stats.avgQueueLen}</span></div>
                      <div className="flex justify-between"><span>Outcome:</span><span className="truncate max-w-[110px]">{stats.causeOfDeath}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Per-Turn Detail Ledger (with collapsible TURNS/TIME toggle row) */}
          <TurnLedgerView entries={turnLedgerEntries} matchStats={matchStats} />
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
