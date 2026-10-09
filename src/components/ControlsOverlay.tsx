import React from 'react';
import { BufferEntry, Direction } from '../types/game';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

interface ControlsOverlayProps {
  onDirection: (dir: Direction) => void;
  onLock: () => void;
  onUndo: () => void;
  onClear: () => void;
  onSkill?: () => void;
  choosingSkill?: boolean;
  canUseSkill?: boolean;
  queue: BufferEntry[];
  queueLimit: number;
  locked: boolean;
  turnBased: boolean;
  localTwoPlayer?: boolean;
}

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
  onDirection, onLock, onUndo, onClear, onSkill, choosingSkill = false, canUseSkill = false, queue, queueLimit, locked, turnBased,
  localTwoPlayer = false,
}) => {
  return (
    <>
    <div className="legacy-mobile-controls w-full max-w-[340px] sm:hidden flex flex-col items-center py-2 select-none">
      <div className="flex items-center justify-center gap-4">
        <div className="relative w-36 h-36 bg-[#8BAC0F] border-2 border-[#0F380F] p-1 shadow-[2px_2px_0px_#0F380F] shrink-0">
        {/* Center pivot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-[#306230] border border-[#0F380F]" />

        {/* UP */}
        <button
          onClick={() => onDirection('UP')}
          className="absolute top-1 left-1/2 -translate-x-1/2 w-11 h-11 bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border border-[#0F380F] cursor-pointer"
        >
          <ArrowUp className="w-6 h-6" />
        </button>

        {/* DOWN */}
        <button
          onClick={() => onDirection('DOWN')}
          className="absolute bottom-1 left-1/2 -translate-x-1/2 w-11 h-11 bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border border-[#0F380F] cursor-pointer"
        >
          <ArrowDown className="w-6 h-6" />
        </button>

        {/* LEFT */}
        <button
          onClick={() => onDirection('LEFT')}
          className="absolute left-1 top-1/2 -translate-y-1/2 w-11 h-11 bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border border-[#0F380F] cursor-pointer"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        {/* RIGHT */}
        <button
          onClick={() => onDirection('RIGHT')}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border border-[#0F380F] cursor-pointer"
        >
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>
        {/* Touch buttons in a diamond cluster: Y left, X top, A right, B bottom */}
        <div className="relative w-36 h-36 shrink-0">
          <button
            onClick={onClear}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#306230] active:bg-[#0F380F] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-xs shadow-[2px_2px_0px_#0F380F]"
            title="Clear queued moves"
          >
            Y
          </button>
          {onSkill && (
            <button
              type="button"
              onClick={onSkill}
              className={`absolute top-1 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full border-2 border-[#0F380F] flex items-center justify-center font-black text-[10px] cursor-pointer shadow-[2px_2px_0px_#0F380F] ${
                choosingSkill
                  ? 'bg-[#E53935] text-white animate-pulse'
                  : canUseSkill
                  ? 'bg-[#0F380F] text-[#9BBC0F]'
                  : 'bg-[#306230]/50 text-[#9BBC0F]/60'
              }`}
              title="Dart Skill (Costs 2 tokens)"
            >
              ⚡
            </button>
          )}
          {localTwoPlayer ? (
            <button
              type="button"
              onClick={onLock}
              disabled={!turnBased || locked || queue.length === 0}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-14 h-10 rounded border-2 border-[#0F380F] bg-[#0F380F] text-[#9BBC0F] text-[10px] font-black disabled:opacity-40 cursor-pointer"
              title="Lock P1's queued moves"
            >
              LOCK
            </button>
          ) : (
            <button
              onClick={onLock}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-13 h-13 rounded-full bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-base shadow-[2px_2px_0px_#306230]"
              title="Lock in queued moves"
            >
              A
            </button>
          )}
          <button
            onClick={onUndo}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-[#306230] active:bg-[#0F380F] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-xs shadow-[2px_2px_0px_#0F380F]"
            title="Undo last queued move"
          >
            B
          </button>
        </div>
      </div>
      <div className="text-[9px] font-mono font-bold text-center mt-1.5 opacity-90 tracking-tight">
        {choosingSkill ? '🎯 CHOOSE DART DIRECTION (Fwd/L/R) • B/E to cancel' : localTwoPlayer ? 'Plan: D-pad P1 • B undo • Y clear • E skill • P1 LOCK' : 'Plan: D-pad queue • B undo • Y clear • E skill • A lock'}
      </div>
    </div>
    <div className="portrait-controls-row hidden w-full min-h-9 [@media(max-height:540px)]:min-h-7 items-center gap-1.5 font-mono select-none shrink-0">
      <button
        type="button"
        onClick={onUndo}
        disabled={!turnBased || locked || queue.length === 0}
        className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#306230] px-2 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
      >
        UNDO
      </button>
      {onSkill && (
        <button
          type="button"
          onClick={onSkill}
          className={`shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] px-2 text-[11px] font-black cursor-pointer flex items-center justify-center ${
            choosingSkill ? 'bg-[#E53935] text-white animate-pulse' : canUseSkill ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#306230]/50 text-[#9BBC0F]/60'
          }`}
          title="Activate Dart Skill"
        >
          {choosingSkill ? '🎯 CHOOSE DIR' : '⚡ DART'}
        </button>
      )}
      <div className="flex min-w-0 min-h-9 [@media(max-height:540px)]:min-h-7 flex-1 flex-wrap items-center gap-1 border-2 border-dashed border-[#0F380F] bg-[#8BAC0F] px-2 py-1 text-[10px] font-bold text-[#0F380F] tabular-nums">
        <span className="shrink-0">{localTwoPlayer ? 'P1 ' : ''}QUEUE {queue.length}/{queueLimit}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-0.5">
          {queue.map((direction, index) => (
            <span key={`${direction}-${index}`} className="shrink-0 bg-[#0F380F] px-1 py-0.5 leading-none text-[#9BBC0F]">
              {direction === 'UP' ? '↑' : direction === 'DOWN' ? '↓' : direction === 'LEFT' ? '←' : '→'}
            </span>
          ))}
          {queue.length === 0 && <span className="opacity-75 truncate">SWIPE / TAP BOARD</span>}
        </span>
        {locked && <span className="shrink-0 bg-[#0F380F] text-[#9BBC0F] px-1 py-0.5 text-[9px] leading-none">LOCKED</span>}
      </div>
      {localTwoPlayer ? (
        <button
          type="button"
          onClick={onLock}
          disabled={!turnBased || locked || queue.length === 0}
          className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#0F380F] px-1.5 text-[10px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
        >
          P1 LOCK
        </button>
      ) : (
        <button
          type="button"
          onClick={onLock}
          disabled={!turnBased || locked || queue.length === 0}
          className="shrink-0 h-9 [@media(max-height:540px)]:h-7 border-2 border-[#0F380F] bg-[#0F380F] px-3 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40 cursor-pointer flex items-center justify-center"
        >
          LOCK
        </button>
      )}
    </div>
    </>
  );
};
