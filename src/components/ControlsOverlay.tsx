import React from 'react';
import { Direction } from '../types/game';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

interface ControlsOverlayProps {
  onDirection: (dir: Direction) => void;
}

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({ onDirection }) => {
  return (
    <div className="w-full max-w-[340px] sm:hidden flex flex-col items-center py-2 select-none">
      <div className="relative w-36 h-36 bg-[#8BAC0F] border-2 border-[#0F380F] p-1 shadow-[2px_2px_0px_#0F380F]">
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
      <div className="text-[9px] font-mono font-bold text-center mt-1.5 opacity-90 tracking-tight">
        Plan: D-pad queue • B undo • Y clear • A lock
      </div>
    </div>
  );
};
