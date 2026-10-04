import React, { useState, useEffect } from 'react';
import { GameState, PlayMode } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { RotateCcw, Home, Trophy, AlertTriangle, Play } from 'lucide-react';

interface MatchEndModalProps {
  gameState: GameState;
  playMode: PlayMode;
  series?: { p1: number; p2: number; draws: number };
  canReplay?: boolean;
  isSpectator?: boolean;
  onWatchReplay?: () => void;
  onRematch: () => void;
  onReturnToLobby: () => void;
  onExportReplay?: () => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
}

export const MatchEndModal: React.FC<MatchEndModalProps> = ({
  gameState,
  playMode,
  series,
  canReplay,
  isSpectator,
  onWatchReplay,
  onRematch,
  onReturnToLobby,
  onExportReplay,
  onRegisterHandler,
}) => {
  const { p1, p2 } = gameState.snakes;
  const isDraw = gameState.winner === 'DRAW';
  const winnerSnake = gameState.winner === 'p1' ? p1 : gameState.winner === 'p2' ? p2 : null;

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
      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        onReturnToLobby();
        return;
      }

      if (action === 'UP') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : buttons.length - 1));
        return;
      }

      if (action === 'DOWN') {
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
  }, [gameState.phase, currentBtn, onWatchReplay, onExportReplay, onRematch, onReturnToLobby, buttons.length, onRegisterHandler]);

  if (gameState.phase !== 'OVER') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs font-mono select-none">
      <div className="w-full max-w-sm bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] text-[#0F380F] p-4 flex flex-col gap-4 text-center">
        {/* Banner */}
        <div className="border-b-4 border-[#0F380F] pb-2">
          <div className="flex items-center justify-center gap-2">
            {isDraw ? (
              <AlertTriangle className="w-6 h-6 text-[#0F380F]" />
            ) : (
              <Trophy className="w-6 h-6 text-[#0F380F]" />
            )}
            <h2 className="text-xl font-black tracking-wider uppercase font-['Press_Start_2P',monospace]">
              {titleText}
            </h2>
          </div>
          <div className="text-xs font-bold mt-1 text-[#306230] leading-snug">
            {gameState.winReason}
          </div>
        </div>

        {/* Final Stats Breakdown */}
        <div className="grid grid-cols-2 gap-2 bg-[#8BAC0F] p-3 border-2 border-[#0F380F]">
          {/* P1 Column */}
          <div className={`p-2 border-2 border-[#0F380F] flex flex-col items-center ${gameState.winner === 'p1' ? 'bg-[#9BBC0F]' : 'bg-[#8BAC0F]/60'}`}>
            <div className="text-[11px] font-bold">{p1.name}</div>
            <div className="text-3xl font-black mt-1">{p1.score}</div>
            <div className="text-[10px] font-bold opacity-80 uppercase">Tokens Eaten</div>
            <div className="text-[10px] mt-1 border-t border-[#0F380F] pt-0.5 w-full">
              Length: {p1.body.length}
            </div>
          </div>

          {/* P2 Column */}
          <div className={`p-2 border-2 border-[#0F380F] flex flex-col items-center ${gameState.winner === 'p2' ? 'bg-[#9BBC0F]' : 'bg-[#8BAC0F]/60'}`}>
            <div className="text-[11px] font-bold">
              {p2.name}
            </div>
            <div className="text-3xl font-black mt-1">{p2.score}</div>
            <div className="text-[10px] font-bold opacity-80 uppercase">Tokens Eaten</div>
            <div className="text-[10px] mt-1 border-t border-[#0F380F] pt-0.5 w-full">
              Length: {p2.body.length}
            </div>
          </div>
        </div>

        {/* Series scoreboard + think-time totals */}
        {series && (series.p1 + series.p2 + series.draws) > 0 && (
          <div className="text-[11px] font-black bg-[#8BAC0F] border-2 border-[#0F380F] py-1.5 px-2">
            🏆 SERIES — {p1.name} {series.p1} · {p2.name} {series.p2}
            {series.draws > 0 ? ` · DRAWS ${series.draws}` : ''}
          </div>
        )}
        {gameState.turnBased && (gameState.totalThinkTime.p1 > 0 || gameState.totalThinkTime.p2 > 0) && (
          <div className="text-[10px] font-bold opacity-80 -mt-2">
            ⏱ TOTAL THINK TIME — {p1.name} {Math.floor(gameState.totalThinkTime.p1 / 60)}:{String(Math.floor(gameState.totalThinkTime.p1 % 60)).padStart(2, '0')} · {p2.name} {Math.floor(gameState.totalThinkTime.p2 / 60)}:{String(Math.floor(gameState.totalThinkTime.p2 % 60)).padStart(2, '0')}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          {canReplay && onWatchReplay && (
            <button
              onClick={() => {
                soundEngine.playMenuSelect();
                onWatchReplay();
              }}
              onMouseEnter={() => setFocusIndex(buttons.indexOf('REPLAY'))}
              className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'REPLAY'
                  ? 'bg-[#306230] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02]'
                  : 'bg-[#306230] hover:bg-[#0F380F] text-[#9BBC0F]'
              }`}
            >
              {currentBtn === 'REPLAY' && <span className="animate-pulse">►</span>}
              <Play className="w-4 h-4 fill-current" />
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
              className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'EXPORT'
                  ? 'bg-[#306230] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02]'
                  : 'bg-[#8BAC0F] hover:bg-[#306230] text-[#0F380F]'
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
              className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F] ${
                currentBtn === 'REMATCH'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentBtn === 'REMATCH' && <span className="animate-pulse">►</span>}
              <RotateCcw className="w-4 h-4" />
              <span>PLAY AGAIN (REMATCH)</span>
              {currentBtn === 'REMATCH' && (
                <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A / START]</span>
              )}
            </button>
          )}

          <button
            onClick={() => {
              soundEngine.playMenuBack();
              onReturnToLobby();
            }}
            onMouseEnter={() => setFocusIndex(buttons.indexOf('LOBBY'))}
            className={`w-full py-2 border-2 border-[#0F380F] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              currentBtn === 'LOBBY'
                ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] hover:bg-[#9BBC0F] text-[#0F380F]'
            }`}
          >
            {currentBtn === 'LOBBY' && <span className="animate-pulse">►</span>}
            <Home className="w-3.5 h-3.5" />
            <span>RETURN TO LOBBY</span>
            {currentBtn === 'LOBBY' && (
              <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A / B]</span>
            )}
          </button>
        </div>

        {/* Gamepad Helper Bar */}
        <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around">
          <span>🎮 [D-PAD] NAVIGATE</span>
          <span>[A / START] SELECT</span>
          <span>[B] LOBBY</span>
        </div>
      </div>
    </div>
  );
};
