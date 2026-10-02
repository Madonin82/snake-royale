import React from 'react';
import { Pause, Play, X } from 'lucide-react';

interface ReplayControlsProps {
  index: number; // current turn index (0-based)
  total: number; // total recorded states
  playing: boolean;
  speed: number; // turns per second
  onTogglePlay: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
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
}) => {
  const max = Math.max(0, total - 1);
  return (
    <div className="w-full max-w-[340px] sm:max-w-[400px] md:max-w-[460px] bg-[#8BAC0F] border-2 border-[#0F380F] px-3 py-2 font-mono text-[#0F380F] flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] font-black uppercase">
        <span>▶ Match Replay</span>
        <span>
          Turn {Math.min(index, max)} / {max}
        </span>
        <button
          onClick={onExit}
          className="flex items-center gap-1 bg-[#9BBC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F] cursor-pointer"
        >
          <X className="w-3 h-3" />
          <span>EXIT</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="bg-[#0F380F] text-[#9BBC0F] px-3 py-1.5 border border-[#0F380F] font-black text-xs flex items-center gap-1 cursor-pointer"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{playing ? 'PAUSE' : 'PLAY'}</span>
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
              onClick={() => onSpeedChange(s)}
              className={`px-1.5 py-1 border border-[#0F380F] text-[10px] font-black cursor-pointer ${
                speed === s ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
