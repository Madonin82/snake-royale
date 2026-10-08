import React, { useState, useEffect } from 'react';
import { GameState, PlayMode } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { RotateCcw, Home, Trophy, AlertTriangle, Play } from 'lucide-react';
import { computeMatchStats, computeTurnLedger, MatchSummaryStats, TurnLedgerEntry } from '../game/stats';
import { TurnDecision } from '../game/replayFile';

interface MatchEndModalProps {
  gameState: GameState;
  playMode: PlayMode;
  confirmed: boolean;
  onConfirm: () => void;
  series?: { p1: number; p2: number; draws: number };
  canReplay?: boolean;
  isSpectator?: boolean;
  onWatchReplay?: () => void;
  onRematch: () => void;
  onReturnToLobby: () => void;
  onExportReplay?: () => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
  matchHistory?: GameState[];
  turnDecisions?: TurnDecision[];
}

export const Sparkline: React.FC<{ p1Scores: number[]; p2Scores: number[] }> = ({ p1Scores, p2Scores }) => {
  const maxScore = Math.max(1, ...p1Scores, ...p2Scores);
  const width = 110;
  const height = 18;
  const points = (scores: number[]) => {
    if (scores.length <= 1) return `0,${height} ${width},${height}`;
    return scores.map((s, i) => {
      const x = (i / (scores.length - 1)) * width;
      const y = height - (s / maxScore) * (height - 4) - 2;
      return `${x},${y}`;
    }).join(' ');
  };

  return (
    <svg width={width} height={height} className="inline-block overflow-visible align-middle">
      <polyline fill="none" stroke="#0F380F" strokeWidth="1.5" points={points(p1Scores)} />
      <polyline fill="none" stroke="#306230" strokeWidth="1.5" strokeDasharray="2 2" points={points(p2Scores)} />
    </svg>
  );
};

export const TurnLedgerView: React.FC<{ entries: TurnLedgerEntry[]; matchStats: MatchSummaryStats }> = ({ entries, matchStats }) => {
  const [isOpen, setIsOpen] = useState(false);
  const p1Entries = entries.filter(e => e.seat === 'p1');
  const p2Entries = entries.filter(e => e.seat === 'p2');

  return (
    <>
      <div
        onClick={() => {
          soundEngine.playMenuSelect();
          setIsOpen(prev => !prev);
        }}
        className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold bg-[#8BAC0F] border-2 border-[#0F380F] py-1 px-2 shrink-0 cursor-pointer hover:bg-[#9BBC0F] transition-colors select-none"
        title="Click to expand/collapse per-turn detail ledger"
      >
        <span>TURNS: {matchStats.totalTurns} · TIME: {matchStats.durationFormatted} <span className="underline">{isOpen ? '▴ HIDE LEDGER' : '▾ SHOW LEDGER'}</span></span>
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="opacity-80">SCORE:</span>
          <Sparkline p1Scores={matchStats.p1Scores} p2Scores={matchStats.p2Scores} />
        </span>
      </div>

      {isOpen && (
        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2 shrink-0 animate-fadeIn">
          {/* P1 Column */}
          <div className="bg-[#8BAC0F] border-2 border-[#0F380F] p-1.5 text-left text-[10px] font-mono">
            <div className="font-black border-b border-[#0F380F] pb-0.5 mb-1 flex justify-between">
              <span>P1 TURNS</span>
              <span>({p1Entries.length})</span>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {p1Entries.length === 0 ? (
                <div className="opacity-60 italic text-center py-2">No turns recorded</div>
              ) : (
                p1Entries.map((e, idx) => (
                  <div key={idx} className="bg-[#9BBC0F] border border-[#0F380F] p-1 flex flex-wrap items-center justify-between gap-1 tabular-nums">
                    <span className="font-black">T{e.tick}</span>
                    <span className="font-bold tracking-widest text-[#306230]">{e.arrows.length > 0 ? e.arrows.join(' ') : '—'}</span>
                    <span className="opacity-95">{e.lockTimeMs > 0 ? `${(e.lockTimeMs / 1000).toFixed(1)}s` : '—'}{e.isAutoLock ? ' [AUTO]' : ''}</span>
                    <span className="font-bold">{e.tokensCollected > 0 ? `+${e.tokensCollected} 💎` : e.terminalResult || (e.scoreDelta !== 0 ? `${e.scoreDelta > 0 ? '+' : ''}${e.scoreDelta}` : '')}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* P2 Column */}
          <div className="bg-[#8BAC0F] border-2 border-[#0F380F] p-1.5 text-left text-[10px] font-mono">
            <div className="font-black border-b border-[#0F380F] pb-0.5 mb-1 flex justify-between">
              <span>P2 TURNS</span>
              <span>({p2Entries.length})</span>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {p2Entries.length === 0 ? (
                <div className="opacity-60 italic text-center py-2">No turns recorded</div>
              ) : (
                p2Entries.map((e, idx) => (
                  <div key={idx} className="bg-[#9BBC0F] border border-[#0F380F] p-1 flex flex-wrap items-center justify-between gap-1 tabular-nums">
                    <span className="font-black">T{e.tick}</span>
                    <span className="font-bold tracking-widest text-[#306230]">{e.arrows.length > 0 ? e.arrows.join(' ') : '—'}</span>
                    <span className="opacity-95">{e.lockTimeMs > 0 ? `${(e.lockTimeMs / 1000).toFixed(1)}s` : '—'}{e.isAutoLock ? ' [AUTO]' : ''}</span>
                    <span className="font-bold">{e.tokensCollected > 0 ? `+${e.tokensCollected} 💎` : e.terminalResult || (e.scoreDelta !== 0 ? `${e.scoreDelta > 0 ? '+' : ''}${e.scoreDelta}` : '')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const MatchEndModal: React.FC<MatchEndModalProps> = ({
  gameState,
  playMode,
  confirmed,
  onConfirm,
  series,
  canReplay,
  isSpectator,
  onWatchReplay,
  onRematch,
  onReturnToLobby,
  onExportReplay,
  onRegisterHandler,
  matchHistory = [],
  turnDecisions = [],
}) => {
  const { p1, p2 } = gameState.snakes;
  const isDraw = gameState.winner === 'DRAW';
  const winnerSnake = gameState.winner === 'p1' ? p1 : gameState.winner === 'p2' ? p2 : null;
  
  const [expandedP1, setExpandedP1] = useState(true);
  const [expandedP2, setExpandedP2] = useState(true);

  const history = matchHistory.length > 0 ? matchHistory : [gameState];
  const matchStats = computeMatchStats(history, turnDecisions);
  const turnLedgerEntries = computeTurnLedger(history, turnDecisions);

  let titleText = 'MATCH FINISHED';
  if (isDraw) {
    titleText = 'DRAW GAME';
  } else if (winnerSnake) {
    if (playMode === 'SOLO_AI') {
      titleText = gameState.winner === 'p1' ? 'VICTORY!' : 'DEFEATED';
    } else {
      titleText = `${winnerSnake.name} WINS!`;
    }
  }

  const buttons: ('REPLAY' | 'EXPORT' | 'REMATCH' | 'LOBBY')[] = [];
  if (canReplay && onWatchReplay) buttons.push('REPLAY');
  if (canReplay && onExportReplay) buttons.push('EXPORT');
  if (!isSpectator) buttons.push('REMATCH');
  buttons.push('LOBBY');

  const defaultFocus = buttons.indexOf('REMATCH') !== -1 ? buttons.indexOf('REMATCH') : 0;
  const [focusIndex, setFocusIndex] = useState<number>(defaultFocus);

  const currentBtn = buttons[focusIndex] || buttons[0];

  useEffect(() => {
    if (gameState.phase !== 'OVER') {
      onRegisterHandler?.(null);
      return;
    }

    const handleAction = (action: GamepadMenuAction) => {
      if (!confirmed) {
        if (action === 'CONFIRM' || action === 'START') {
          soundEngine.playMenuSelect();
          onConfirm();
        } else if (action === 'CANCEL') {
          soundEngine.playMenuBack();
          onReturnToLobby();
        }
        return;
      }

      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        onReturnToLobby();
        return;
      }

      if (action === 'UP' || action === 'LEFT') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : buttons.length - 1));
        return;
      }

      if (action === 'DOWN' || action === 'RIGHT') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < buttons.length - 1 ? prev + 1 : 0));
        return;
      }

      if (action === 'CONFIRM' || action === 'START') {
        soundEngine.playMenuSelect();
        if (currentBtn === 'REPLAY' && onWatchReplay) {
          onWatchReplay();
        } else if (currentBtn === 'EXPORT' && onExportReplay) {
          onExportReplay();
        } else if (currentBtn === 'REMATCH') {
          onRematch();
        } else if (currentBtn === 'LOBBY') {
          onReturnToLobby();
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [gameState.phase, confirmed, onConfirm, currentBtn, onWatchReplay, onExportReplay, onRematch, onReturnToLobby, buttons.length, onRegisterHandler]);

  if (gameState.phase !== 'OVER') return null;

  if (!confirmed) {
    return (
      <div className="fixed inset-x-0 bottom-3 z-50 flex justify-center px-4 pointer-events-none font-mono select-none">
        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            onConfirm();
          }}
          className="pointer-events-auto px-5 py-2.5 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[4px_4px_0px_#0F380F] text-[#0F380F] font-black text-sm tracking-wider cursor-pointer hover:bg-[#8BAC0F] focus-visible:outline-4 focus-visible:outline-[#0F380F]"
        >
          SHOW RESULTS
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 [@media(max-height:520px)]:p-1 bg-black/80 backdrop-blur-xs font-mono select-none">
      <div className="w-full max-w-sm [@media(orientation:landscape)]:max-w-[640px] max-h-[96dvh] [@media(max-height:520px)]:max-h-[98dvh] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] [@media(max-height:520px)]:shadow-[4px_4px_0px_#0F380F] text-[#0F380F] p-3 sm:p-4 [@media(max-height:520px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:520px)]:gap-1 text-center overflow-y-auto">
        {/* Banner */}
        <div className="border-b-4 [@media(max-height:520px)]:border-b-2 border-[#0F380F] pb-2 [@media(max-height:520px)]:pb-1 shrink-0">
          <div className="flex items-center justify-center gap-2">
            {isDraw ? (
              <AlertTriangle className="w-6 h-6 [@media(max-height:520px)]:w-4 [@media(max-height:520px)]:h-4 text-[#0F380F]" />
            ) : (
              <Trophy className="w-6 h-6 [@media(max-height:520px)]:w-4 [@media(max-height:520px)]:h-4 text-[#0F380F]" />
            )}
            <h2 className="text-xl [@media(max-height:520px)]:text-base font-black tracking-wider uppercase font-['Press_Start_2P',monospace]">
              {titleText}
            </h2>
          </div>
          <div className="text-xs [@media(max-height:520px)]:text-[11px] font-bold mt-1 [@media(max-height:520px)]:mt-0.5 text-[#306230] leading-snug">
            {gameState.winReason}
          </div>
        </div>

        {/* Final Stats Breakdown — Independent Expandable Player Cards */}
        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2 bg-[#8BAC0F] p-2.5 [@media(max-height:520px)]:p-1.5 border-2 border-[#0F380F] shrink-0">
          {(['p1', 'p2'] as const).map((who) => {
            const snake = who === 'p1' ? p1 : p2;
            const stats = who === 'p1' ? matchStats.p1Stats : matchStats.p2Stats;
            const isExpanded = who === 'p1' ? expandedP1 : expandedP2;
            const isWinner = gameState.winner === who;

            return (
              <div
                key={who}
                className={`p-2 [@media(max-height:520px)]:p-1.5 border-2 border-[#0F380F] flex flex-col items-center transition-all ${
                  isWinner ? 'bg-[#9BBC0F]' : 'bg-[#8BAC0F]/85'
                }`}
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
                <div className="flex items-baseline gap-1 mt-1 [@media(max-height:520px)]:mt-0.5">
                  <span className="text-3xl [@media(max-height:520px)]:text-xl font-black leading-none">{snake.score}</span>
                  <span className="text-[10px] font-bold opacity-80 uppercase">TOKENS</span>
                </div>

                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-[#0F380F] w-full text-left text-[10px] font-bold space-y-1 bg-[#8BAC0F]/50 p-1.5">
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

        {/* Series scoreboard + think-time totals */}
        {((series && (series.p1 + series.p2 + series.draws) > 0) ||
          (gameState.turnBased && (gameState.totalThinkTime.p1 > 0 || gameState.totalThinkTime.p2 > 0))) && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] [@media(max-height:520px)]:text-[10px] font-black bg-[#8BAC0F] border-2 border-[#0F380F] py-1 px-2 shrink-0">
            {series && (series.p1 + series.p2 + series.draws) > 0 && (
              <span>
                🏆 SERIES — {p1.name} {series.p1} · {p2.name} {series.p2}
                {series.draws > 0 ? ` · DRAWS ${series.draws}` : ''}
              </span>
            )}
            {gameState.turnBased && (gameState.totalThinkTime.p1 > 0 || gameState.totalThinkTime.p2 > 0) && (
              <span className="text-[10px] font-bold opacity-85">
                ⏱ THINK — {p1.name} {Math.floor(gameState.totalThinkTime.p1 / 60)}:{String(Math.floor(gameState.totalThinkTime.p1 % 60)).padStart(2, '0')} · {p2.name} {Math.floor(gameState.totalThinkTime.p2 / 60)}:{String(Math.floor(gameState.totalThinkTime.p2 % 60)).padStart(2, '0')}
              </span>
            )}
          </div>
        )}

        {/* Action Buttons — 2x2 Grid in Landscape so all options fit on a single screen */}
        <div className="flex flex-col [@media(orientation:landscape)]:grid [@media(orientation:landscape)]:grid-cols-2 gap-1.5 [@media(max-height:520px)]:gap-1.5 pt-0.5 shrink-0">
          {canReplay && onWatchReplay && (
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onWatchReplay();
              }}
              onMouseEnter={() => setFocusIndex(buttons.indexOf('REPLAY'))}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'REPLAY'
                  ? 'bg-[#306230] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#306230] hover:bg-[#0F380F] text-[#9BBC0F]'
              }`}
            >
              {currentBtn === 'REPLAY' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current shrink-0" />
              <span>WATCH REPLAY</span>
              {currentBtn === 'REPLAY' && (
                <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A]</span>
              )}
            </button>
          )}

          {canReplay && onExportReplay && (
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onExportReplay();
              }}
              onMouseEnter={() => setFocusIndex(buttons.indexOf('EXPORT'))}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'EXPORT'
                  ? 'bg-[#306230] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F]'
              }`}
            >
              {currentBtn === 'EXPORT' && <span className="animate-pulse">►</span>}
              <span>EXPORT REPLAY ⬇</span>
              {currentBtn === 'EXPORT' && (
                <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A]</span>
              )}
            </button>
          )}

          {!isSpectator && (
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onRematch();
              }}
              onMouseEnter={() => setFocusIndex(buttons.indexOf('REMATCH'))}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'REMATCH'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentBtn === 'REMATCH' && <span className="animate-pulse">►</span>}
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>PLAY AGAIN</span>
              {currentBtn === 'REMATCH' && (
                <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A]</span>
              )}
            </button>
          )}

          <button
            onClick={() => {
              soundEngine.playMenuBack();
              onReturnToLobby();
            }}
            onMouseEnter={() => setFocusIndex(buttons.indexOf('LOBBY'))}
            className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-[2px_2px_0px_#0F380F] ${
              currentBtn === 'LOBBY'
                ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
            }`}
          >
            {currentBtn === 'LOBBY' && <span className="animate-pulse">►</span>}
            <Home className="w-4 h-4 shrink-0" />
            <span>RETURN TO LOBBY</span>
            {currentBtn === 'LOBBY' && (
              <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[B]</span>
            )}
          </button>
        </div>

        {/* Gamepad Helper Bar */}
        <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around shrink-0">
          <span>🎮 [D-PAD] NAVIGATE</span>
          <span>[A / START] SELECT</span>
          <span>[B] LOBBY</span>
        </div>
      </div>
    </div>
  );
};
