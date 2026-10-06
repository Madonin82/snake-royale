import React from 'react';
import { Direction } from '../types/game';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

interface ControlsOverlayProps {
  onDirection: (dir: Direction) => void;
  onLock: () => void;
  onUndo: () => void;
  onClear: () => void;
  queue: Direction[];
  queueLimit: number;
  locked: boolean;
  turnBased: boolean;
}

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
  onDirection, onLock, onUndo, onClear, queue, queueLimit, locked, turnBased,
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
        {/* Touch buttons in a diamond cluster (SNES layout): Y left, A right, B bottom */}
        <div className="relative w-36 h-36 shrink-0">
          <button
            onClick={onClear}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#306230] active:bg-[#0F380F] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-sm shadow-[2px_2px_0px_#0F380F]"
            title="Clear queued moves"
          >
            Y
          </button>
          <button
            onClick={onLock}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-[#0F380F] active:bg-[#306230] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-lg shadow-[2px_2px_0px_#306230]"
            title="Lock in queued moves"
          >
            A
          </button>
          <button
            onClick={onUndo}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-[#306230] active:bg-[#0F380F] text-[#9BBC0F] flex items-center justify-center border-2 border-[#0F380F] cursor-pointer font-black text-sm shadow-[2px_2px_0px_#0F380F]"
            title="Undo last queued move"
          >
            B
          </button>
        </div>
      </div>
      <div className="text-[9px] font-mono font-bold text-center mt-1.5 opacity-90 tracking-tight">
        Plan: D-pad queue • B undo • Y clear • A lock
      </div>
    </div>
    <div className="portrait-controls-row hidden items-center gap-1.5 w-full font-mono select-none">
      <button
        type="button"
        onClick={onUndo}
        disabled={!turnBased || locked || queue.length === 0}
        className="shrink-0 border-2 border-[#0F380F] bg-[#306230] px-2 py-2 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40"
      >
        UNDO
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto border-2 border-dashed border-[#0F380F] bg-[#8BAC0F] px-1.5 py-1.5 text-[10px] font-bold text-[#0F380F]">
        <span className="shrink-0">QUEUE {queue.length}/{queueLimit}</span>
        <span className="flex min-w-0 gap-0.5">
          {queue.map((direction, index) => (
            <span key={`${direction}-${index}`} className="shrink-0 bg-[#0F380F] px-1 text-[#9BBC0F]">
              {direction === 'UP' ? '↑' : direction === 'DOWN' ? '↓' : direction === 'LEFT' ? '←' : '→'}
            </span>
          ))}
          {queue.length === 0 && <span className="opacity-60">—</span>}
        </span>
        {locked && <span className="shrink-0">LOCKED</span>}
      </div>
      <button
        type="button"
        onClick={onLock}
        disabled={!turnBased || locked || queue.length === 0}
        className="shrink-0 border-2 border-[#0F380F] bg-[#0F380F] px-3 py-2 text-[11px] font-black text-[#9BBC0F] disabled:opacity-40"
      >
        LOCK
      </button>
    </div>
    </>
  );
};
