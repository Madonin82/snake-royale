import React, { useState, useEffect } from 'react';
import { GameState, PlayMode } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { RotateCcw, Home, Trophy, AlertTriangle, Play, ArrowLeft } from 'lucide-react';
import { computeMatchStats, computeTurnLedger, MatchSummaryStats, TurnLedgerEntry } from '../game/stats';
import { TurnDecision } from '../game/replayFile';
import { getCampaignObjectiveProgress, isCampaignObjectiveComplete } from '../game/objectives';
import { getPlayerColorPalette, splitPlayersTwoPerSide } from '../game/playerColors';

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
  onReturnToEditor?: () => void;
  onExportReplay?: () => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
  matchHistory?: GameState[];
  turnDecisions?: TurnDecision[];
}

export const Sparkline: React.FC<{
  p1Scores: number[];
  p2Scores: number[];
  scoresBySeat?: Record<string, number[]>;
}> = ({ p1Scores, p2Scores, scoresBySeat }) => {
  const seatEntries = scoresBySeat && Object.keys(scoresBySeat).length > 0
    ? Object.entries(scoresBySeat)
    : [['p1', p1Scores], ['p2', p2Scores]] as [string, number[]][];
  const allValues = seatEntries.flatMap(([, scores]) => scores);
  const maxScore = Math.max(1, ...allValues);
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
      {seatEntries.map(([seat, scores], idx) => {
        const palette = getPlayerColorPalette(seat, idx);
        return (
          <polyline
            key={seat}
            fill="none"
            stroke={palette.hex}
            strokeWidth="1.5"
            strokeDasharray={idx % 2 === 1 ? '2 2' : undefined}
            points={points(scores)}
          />
        );
      })}
    </svg>
  );
};

export const TurnLedgerView: React.FC<{ entries: TurnLedgerEntry[]; matchStats: MatchSummaryStats; snakes?: GameState['snakes'] }> = ({ entries, matchStats, snakes }) => {
  const [isOpen, setIsOpen] = useState(false);
  const activeSeats = snakes && snakes.length > 0
    ? snakes.map((snake, idx) => ({ id: snake.id, name: snake.name, color: snake.color, idx }))
    : [
        { id: 'p1', name: 'P1', color: '#0F380F', idx: 0 },
        { id: 'p2', name: 'P2', color: '#306230', idx: 1 },
      ];

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
          <Sparkline
            p1Scores={matchStats.p1Scores}
            p2Scores={matchStats.p2Scores}
            scoresBySeat={matchStats.scoresBySeat}
          />
        </span>
      </div>

      {isOpen && (
        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2 shrink-0 animate-fadeIn">
          {activeSeats.map((seatInfo) => {
            const seatEntries = entries.filter(e => e.seat === seatInfo.id);
            const palette = getPlayerColorPalette({ id: seatInfo.id, color: seatInfo.color }, seatInfo.idx);
            return (
              <div key={seatInfo.id} className={`bg-[#8BAC0F] border-2 ${palette.borderColor} p-1.5 text-left text-[10px] font-mono`}>
                <div className="font-black border-b border-[#0F380F] pb-0.5 mb-1 flex justify-between items-center gap-1">
                  <span className="flex items-center gap-1 truncate">
                    <span className={`inline-block w-2 h-2 shrink-0 border border-[#0F380F] ${palette.chipBg}`} />
                    <span className="truncate">{seatInfo.name} TURNS</span>
                  </span>
                  <span className="shrink-0">({seatEntries.length})</span>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {seatEntries.length === 0 ? (
                    <div className="opacity-60 italic text-center py-2">No turns recorded</div>
                  ) : (
                    seatEntries.map((e, idx) => (
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
            );
          })}
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
  onReturnToEditor,
  onExportReplay,
  onRegisterHandler,
  matchHistory = [],
  turnDecisions = [],
}) => {
  const p1 = gameState.snakes.find(snake => snake.id === 'p1') ?? gameState.snakes[0]!;
  const p2 = gameState.snakes.find(snake => snake.id === 'p2') ?? gameState.snakes[1]!;
  const handleReturn = onReturnToEditor ?? onReturnToLobby;
  const isDraw = gameState.winner === 'DRAW';
  const winnerSnake = gameState.winner && gameState.winner !== 'DRAW'
    ? gameState.snakes.find(snake => snake.id === gameState.winner) ?? null
    : null;

  const [expandedBySeat, setExpandedBySeat] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(gameState.snakes.map(snake => [snake.id, false]))
  );

  const history = matchHistory.length > 0 ? matchHistory : [gameState];
  const matchStats = computeMatchStats(history, turnDecisions);
  const turnLedgerEntries = computeTurnLedger(history, turnDecisions);
  const campaignObjectives = gameState.campaignObjectives;
  const objectiveRows = campaignObjectives
    ? [campaignObjectives.primary, ...campaignObjectives.bonus]
        .map((objective, index) => ({ objective, index }))
        .filter((item): item is { objective: NonNullable<typeof item.objective>; index: number } => item.objective !== null)
    : [];

  let titleText = 'MATCH FINISHED';
  if (isDraw) {
    titleText = 'DRAW GAME';
  } else if (winnerSnake) {
    if (playMode === 'SOLO_AI') {
      titleText = winnerSnake.id === 'p1' ? 'VICTORY!' : 'DEFEATED';
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
  const [confirmLeaveArmed, setConfirmLeaveArmed] = useState<boolean>(false);

  const currentBtn = buttons[focusIndex] || buttons[0];

  useEffect(() => {
    if (!confirmed || gameState.phase !== 'OVER') {
      setConfirmLeaveArmed(false);
    }
  }, [confirmed, gameState.phase]);

  useEffect(() => {
    if (currentBtn !== 'LOBBY') {
      setConfirmLeaveArmed(false);
    }
  }, [currentBtn]);

  useEffect(() => {
    if (gameState.phase !== 'OVER') {
      onRegisterHandler?.(null);
      return;
    }

    const navigateSpatially = (action: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', prevIdx: number): number => {
      const count = buttons.length;
      if (count <= 1) return 0;
      const is2x2Grid = count === 4;
      if (is2x2Grid) {
        // 2x2 Spatial Grid:
        // [0: REPLAY]  [1: EXPORT]
        // [2: REMATCH] [3: LOBBY]
        if (action === 'UP') return prevIdx >= 2 ? prevIdx - 2 : prevIdx;
        if (action === 'DOWN') return prevIdx < 2 ? prevIdx + 2 : prevIdx;
        if (action === 'LEFT') return prevIdx % 2 === 1 ? prevIdx - 1 : prevIdx;
        if (action === 'RIGHT') return prevIdx % 2 === 0 ? prevIdx + 1 : prevIdx;
      }
      if (action === 'UP' || action === 'LEFT') {
        return prevIdx > 0 ? prevIdx - 1 : count - 1;
      }
      return prevIdx < count - 1 ? prevIdx + 1 : 0;
    };

    const handleAction = (action: GamepadMenuAction) => {
      if (!confirmed) {
        if (action === 'CONFIRM' || action === 'START') {
          soundEngine.playMenuSelect();
          onConfirm();
        } else if (action === 'CANCEL') {
          soundEngine.playMenuBack();
          handleReturn();
        }
        return;
      }

      if (action === 'CANCEL') {
        const lobbyIdx = buttons.indexOf('LOBBY');
        if (currentBtn === 'LOBBY' && confirmLeaveArmed) {
          soundEngine.playMenuBack();
          setConfirmLeaveArmed(false);
          handleReturn();
        } else {
          soundEngine.playMenuMove();
          if (lobbyIdx !== -1) setFocusIndex(lobbyIdx);
          setConfirmLeaveArmed(true);
        }
        return;
      }

      if (action === 'UP' || action === 'DOWN' || action === 'LEFT' || action === 'RIGHT') {
        soundEngine.playMenuMove();
        setConfirmLeaveArmed(false);
        setFocusIndex((prev) => navigateSpatially(action, prev));
        return;
      }

      if (action === 'CONFIRM' || action === 'START') {
        soundEngine.playMenuSelect();
        if (currentBtn === 'REPLAY' && onWatchReplay) {
          setConfirmLeaveArmed(false);
          onWatchReplay();
        } else if (currentBtn === 'EXPORT' && onExportReplay) {
          setConfirmLeaveArmed(false);
          onExportReplay();
        } else if (currentBtn === 'REMATCH') {
          setConfirmLeaveArmed(false);
          onRematch();
        } else if (currentBtn === 'LOBBY') {
          if (confirmLeaveArmed) {
            setConfirmLeaveArmed(false);
            handleReturn();
          } else {
            setConfirmLeaveArmed(true);
          }
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [gameState.phase, confirmed, onConfirm, currentBtn, confirmLeaveArmed, onWatchReplay, onExportReplay, onRematch, handleReturn, buttons, onRegisterHandler]);

  if (gameState.phase !== 'OVER') return null;

  if (!confirmed) {
    return (
      <div
        data-testid="match-end-top-banner"
        className="fixed inset-x-0 top-1.5 z-50 flex justify-center px-3 pointer-events-none font-mono select-none"
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[4px_4px_0px_#0F380F] text-[#0F380F]">
          <span className="text-xs font-black tracking-wider uppercase">
            {titleText}
          </span>
          <button
            type="button"
            data-testid="show-results-confirm-btn"
            onClick={() => {
              soundEngine.playMenuSelect();
              onConfirm();
            }}
            className="px-3 py-1 bg-[#0F380F] text-[#9BBC0F] border-2 border-[#0F380F] font-black text-xs tracking-wider cursor-pointer hover:bg-[#306230] flex items-center gap-1.5"
          >
            <span>SHOW RESULTS</span>
            <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A / CONFIRM]</span>
          </button>
          <button
            type="button"
            data-testid="show-results-cancel-btn"
            onClick={() => {
              soundEngine.playMenuBack();
              handleReturn();
            }}
            className="px-2.5 py-1 bg-[#8BAC0F] text-[#0F380F] border-2 border-[#0F380F] font-black text-xs tracking-wider cursor-pointer hover:bg-[#0F380F] hover:text-[#9BBC0F] flex items-center gap-1"
          >
            <span>{onReturnToEditor ? 'EDITOR' : 'LOBBY'}</span>
            <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[B / CANCEL]</span>
          </button>
        </div>
      </div>
    );
  }

  const indexedSnakes = gameState.snakes.map((snake, index) => ({ snake, index }));
  const { left: leftSnakes, right: rightSnakes } = splitPlayersTwoPerSide(indexedSnakes);

  const renderStatCard = ({ snake, index }: { snake: GameState['snakes'][number]; index: number }) => {
    const who = snake.id;
    const stats = matchStats.statsBySeat[who] ?? (who === 'p1' ? matchStats.p1Stats : matchStats.p2Stats);
    const isExpanded = expandedBySeat[who] ?? false;
    const isWinner = gameState.winner === who;
    const palette = getPlayerColorPalette(snake, index);

    return (
      <div
        key={who}
        data-testid={`match-end-card-${who}`}
        className={`p-2 [@media(max-height:520px)]:p-1.5 border-2 ${palette.borderColor} ${palette.defaultShadow} flex flex-col items-center transition-all ${
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
              data-testid={`match-end-color-chip-${who}`}
              className={`inline-block w-2.5 h-2.5 shrink-0 border border-[#0F380F] ${palette.chipBg}`}
              title={`Snake Color ${palette.hex}`}
            />
            <span
              data-testid={`match-end-standing-${who}`}
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
        <div className="grid grid-cols-3 gap-1 w-full mt-1.5 [@media(max-height:520px)]:mt-1 bg-[#9BBC0F]/70 border border-[#0F380F] px-1.5 py-1 text-center">
          <div className="flex flex-col items-center">
            <span className="text-sm [@media(max-height:520px)]:text-xs font-black leading-none tabular-nums">{stats.points}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">POINTS</span>
          </div>
          <div className="flex flex-col items-center border-x border-[#0F380F]/40">
            <span className="text-sm [@media(max-height:520px)]:text-xs font-black leading-none tabular-nums">{stats.tokensCollected}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">TOKENS</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-sm [@media(max-height:520px)]:text-xs font-black leading-none tabular-nums">{stats.kills}</span>
            <span className="text-[8px] font-bold opacity-80 uppercase mt-0.5">KILLS</span>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-1.5 pt-1.5 border-t border-[#0F380F] w-full text-left text-[10px] font-bold space-y-1 bg-[#8BAC0F]/50 p-1.5">
            <div className="flex justify-between"><span>Avg Lock:</span><span className="tabular-nums">{stats.avgLockTime}</span></div>
            <div className="flex justify-between"><span>Fast / Slow:</span><span className="tabular-nums">{stats.fastestLock} / {stats.slowestLock}</span></div>
            <div className="flex justify-between"><span>Auto-Locks:</span><span className="tabular-nums">{stats.autoLockPct}</span></div>
            <div className="flex justify-between"><span>Avg Queue:</span><span className="tabular-nums">{stats.avgQueueLen}</span></div>
            <div className="flex justify-between"><span>SP:</span><span className="tabular-nums">{snake.skillPoints ?? 0} / {snake.spEarned ?? 0}</span></div>
            <div className="flex justify-between"><span>Outcome:</span><span className="truncate max-w-[110px]">{stats.causeOfDeath}</span></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 [@media(max-height:520px)]:p-1 bg-black/80 backdrop-blur-xs font-mono select-none">
      <div className="mobile-scroll-panel w-full max-w-sm sm:max-w-[660px] [@media(orientation:landscape)]:max-w-[680px] max-h-[96dvh] [@media(max-height:520px)]:max-h-[98dvh] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] [@media(max-height:520px)]:shadow-[4px_4px_0px_#0F380F] text-[#0F380F] p-3 sm:p-4 [@media(max-height:520px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:520px)]:gap-1 text-center overflow-y-auto">
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
          {/* Final Standings Banner (1st - 4th) */}
          {matchStats.standings.length > 0 && (
            <div
              data-testid="match-end-standings-strip"
              className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-black"
            >
              {matchStats.standings.map((entry) => {
                const snakeIndex = gameState.snakes.findIndex(s => s.id === entry.id);
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
        </div>

        {objectiveRows.length > 0 && (
          <div className="shrink-0 border-2 border-[#0F380F] bg-[#8BAC0F] p-2 text-left text-[10px] font-bold">
            <div className="mb-1 border-b border-[#0F380F] pb-1 font-black">OBJECTIVES</div>
            {objectiveRows.map(({ objective, index }) => {
              const complete = isCampaignObjectiveComplete(objective, gameState, index);
              return (
                <div key={`${index}-${objective.text}`} className="flex justify-between gap-2">
                  <span className="truncate">{index === 0 ? '' : `${complete ? '☑' : '☐'} `}{getCampaignObjectiveProgress(objective, gameState, index)}</span>
                  <span className="shrink-0 font-black">{complete ? 'COMPLETE' : 'FAILED'}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Final Stats Breakdown — 2 cards per side (Left: P1, P2; Right: P3, P4) */}
        <div
          data-testid="match-end-cards-grid"
          className="flex flex-col sm:grid sm:grid-cols-2 gap-2 bg-[#8BAC0F] p-2.5 [@media(max-height:520px)]:p-1.5 border-2 border-[#0F380F] shrink-0"
        >
          <div data-testid="match-end-side-left" className="flex flex-col gap-2">
            {leftSnakes.map(renderStatCard)}
          </div>
          <div data-testid="match-end-side-right" className="flex flex-col gap-2">
            {rightSnakes.map(renderStatCard)}
          </div>
        </div>

        {/* Per-Turn Detail Ledger (with collapsible TURNS/TIME toggle row) */}
        <TurnLedgerView entries={turnLedgerEntries} matchStats={matchStats} snakes={gameState.snakes} />

        {/* Series scoreboard + think-time totals */}
        {((series && (series.p1 + series.p2 + series.draws) > 0) ||
          (gameState.turnBased && Object.values(gameState.totalThinkTime).some(seconds => seconds > 0))) && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] [@media(max-height:520px)]:text-[10px] font-black bg-[#8BAC0F] border-2 border-[#0F380F] py-1 px-2 shrink-0">
            {series && (series.p1 + series.p2 + series.draws) > 0 && (
              <span>
                🏆 SERIES — {p1.name} {series.p1} · {p2.name} {series.p2}
                {series.draws > 0 ? ` · DRAWS ${series.draws}` : ''}
              </span>
            )}
            {gameState.turnBased && Object.values(gameState.totalThinkTime).some(seconds => seconds > 0) && (
              <span className="text-[10px] font-bold opacity-85">
                ⏱ THINK — {gameState.snakes.map(snake =>
                  `${snake.name} ${Math.floor((gameState.totalThinkTime[snake.id] ?? 0) / 60)}:${String(Math.floor((gameState.totalThinkTime[snake.id] ?? 0) % 60)).padStart(2, '0')}`,
                ).join(' · ')}
              </span>
            )}
          </div>
        )}

        {/* Action Buttons — 2x2 Grid so spatial D-pad navigation (UP from PLAY AGAIN -> WATCH REPLAY) matches visual layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 [@media(orientation:landscape)]:grid-cols-2 gap-1.5 [@media(max-height:520px)]:gap-1.5 pt-0.5 shrink-0">
          {canReplay && onWatchReplay && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playMenuSelect();
                setConfirmLeaveArmed(false);
                onWatchReplay();
              }}
              onMouseEnter={() => {
                setConfirmLeaveArmed(false);
                setFocusIndex(buttons.indexOf('REPLAY'));
              }}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                currentBtn === 'REPLAY'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#E0F8CF] shadow-[3px_3px_0px_#306230]'
                  : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F] shadow-[2px_2px_0px_#0F380F]'
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
              type="button"
              onClick={() => {
                soundEngine.playMenuSelect();
                setConfirmLeaveArmed(false);
                onExportReplay();
              }}
              onMouseEnter={() => {
                setConfirmLeaveArmed(false);
                setFocusIndex(buttons.indexOf('EXPORT'));
              }}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                currentBtn === 'EXPORT'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#E0F8CF] shadow-[3px_3px_0px_#306230]'
                  : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F] shadow-[2px_2px_0px_#0F380F]'
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
              type="button"
              onClick={() => {
                soundEngine.playMenuSelect();
                setConfirmLeaveArmed(false);
                onRematch();
              }}
              onMouseEnter={() => {
                setConfirmLeaveArmed(false);
                setFocusIndex(buttons.indexOf('REMATCH'));
              }}
              className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                currentBtn === 'REMATCH'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#E0F8CF] shadow-[3px_3px_0px_#306230]'
                  : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F] shadow-[2px_2px_0px_#0F380F]'
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
            type="button"
            data-testid="match-end-leave-btn"
            onClick={() => {
              if (confirmLeaveArmed) {
                soundEngine.playMenuBack();
                setConfirmLeaveArmed(false);
                handleReturn();
              } else {
                soundEngine.playMenuMove();
                setFocusIndex(buttons.indexOf('LOBBY'));
                setConfirmLeaveArmed(true);
              }
            }}
            onMouseEnter={() => setFocusIndex(buttons.indexOf('LOBBY'))}
            className={`w-full py-2.5 [@media(max-height:520px)]:py-2 px-2 border-2 border-[#0F380F] font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              currentBtn === 'LOBBY'
                ? confirmLeaveArmed
                  ? 'bg-[#8B1E0F] text-[#9BBC0F] ring-2 ring-[#E0F8CF] shadow-[3px_3px_0px_#0F380F]'
                  : 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#E0F8CF] shadow-[3px_3px_0px_#306230]'
                : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F] shadow-[2px_2px_0px_#0F380F]'
            }`}
          >
            {currentBtn === 'LOBBY' && <span className="animate-pulse">►</span>}
            {onReturnToEditor
              ? <ArrowLeft className="w-4 h-4 shrink-0" />
              : <Home className="w-4 h-4 shrink-0" />}
            <span>
              {confirmLeaveArmed
                ? `CONFIRM ${onReturnToEditor ? 'EXIT TO EDITOR' : 'LEAVE TO LOBBY'}?`
                : onReturnToEditor
                ? 'RETURN TO EDITOR'
                : 'RETURN TO LOBBY'}
            </span>
            {currentBtn === 'LOBBY' && (
              <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">
                {confirmLeaveArmed ? '[A / B CONFIRM]' : '[A / B]'}
              </span>
            )}
          </button>
        </div>

        {/* Gamepad Helper Bar */}
        <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around shrink-0">
          <span>🎮 [D-PAD] 2D NAVIGATE</span>
          <span>[A / START] SELECT</span>
          <span>{confirmLeaveArmed ? '⚠️ PRESS [A / B] AGAIN TO LEAVE' : '[B] SELECT LEAVE'}</span>
        </div>
      </div>
    </div>
  );
};