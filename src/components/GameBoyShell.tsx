import React from 'react';
import { Direction } from '../types/game';

interface GameBoyShellProps {
  children: React.ReactNode;
  onDirectionInput?: (dir: Direction) => void;
  enabled: boolean;
}

export const GameBoyShell: React.FC<GameBoyShellProps> = ({
  children,
  onDirectionInput,
  enabled,
}) => {
  if (!enabled) {
    return <div className="w-full flex justify-center py-2">{children}</div>;
  }

  return (
    <div className="relative w-full max-w-[500px] bg-[#c4c4b8] p-4 sm:p-6 rounded-b-[40px] rounded-t-2xl border-4 border-[#828276] shadow-[10px_10px_0px_#42423a,inset_0_2px_4px_rgba(255,255,255,0.8)] select-none">
      {/* Top Accent Lines */}
      <div className="flex justify-between items-center mb-3 px-2">
        <div className="flex gap-1">
          <div className="w-12 h-1 bg-[#828276] rounded-full" />
          <div className="w-4 h-1 bg-[#828276] rounded-full" />
        </div>
        <div className="text-[10px] font-black text-[#6a6a60] tracking-widest font-mono">
          DOT MATRIX WITH STEREO SOUND
        </div>
      </div>

      {/* Screen Bezel Housing */}
      <div className="bg-[#6b7280] p-4 sm:p-6 rounded-t-xl rounded-b-[24px] border-4 border-[#374151] shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)] flex flex-col items-center">
        {/* Screen Header with Battery LED */}
        <div className="w-full flex items-center justify-between text-[9px] text-[#9ca3af] font-mono font-bold mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shadow-[0_0_6px_#ef4444]" />
            <span className="tracking-wider">BATTERY</span>
          </div>
          <div className="tracking-wider opacity-80">SNAKE-ROYALE 8-BIT</div>
        </div>

        {/* The Greenish Game Boy LCD Matrix */}
        <div className="w-full flex justify-center">{children}</div>
      </div>

      {/* Handheld Brand Header */}
      <div className="flex items-baseline justify-between mt-4 px-3 font-mono">
        <div className="text-sm font-black italic text-[#25325e] tracking-tighter">
          SnakeBoy <span className="text-[10px] not-italic text-red-700 font-black">ROYALE</span>
        </div>
        <div className="text-[9px] font-bold text-[#6a6a60] tracking-widest">
          EST. 2026
        </div>
      </div>

      {/* Physical Handheld Controls (for touch/mouse interaction) */}
      <div className="mt-4 flex items-center justify-between px-2 sm:px-4">
        {/* D-PAD */}
        <div className="relative w-28 h-28 bg-[#9ca3af] rounded-full p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] flex items-center justify-center">
          <div className="relative w-24 h-24">
            {/* Center */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-[#1f2937] border border-[#111827]" />

            {/* UP */}
            <button
              onClick={() => onDirectionInput?.('UP')}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-9 bg-[#1f2937] active:bg-[#374151] rounded-t-sm cursor-pointer shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
            />
            {/* DOWN */}
            <button
              onClick={() => onDirectionInput?.('DOWN')}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-9 bg-[#1f2937] active:bg-[#374151] rounded-b-sm cursor-pointer shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
            />
            {/* LEFT */}
            <button
              onClick={() => onDirectionInput?.('LEFT')}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-9 h-8 bg-[#1f2937] active:bg-[#374151] rounded-l-sm cursor-pointer shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
            />
            {/* RIGHT */}
            <button
              onClick={() => onDirectionInput?.('RIGHT')}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-9 h-8 bg-[#1f2937] active:bg-[#374151] rounded-r-sm cursor-pointer shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
            />
          </div>
        </div>

        {/* Speaker Grill Corner */}
        <div className="flex flex-col gap-1.5 rotate-[-25deg] opacity-70">
          <div className="w-16 h-1.5 bg-[#6a6a60] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]" />
          <div className="w-16 h-1.5 bg-[#6a6a60] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]" />
          <div className="w-16 h-1.5 bg-[#6a6a60] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]" />
          <div className="w-16 h-1.5 bg-[#6a6a60] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]" />
        </div>
      </div>
    </div>
  );
};
