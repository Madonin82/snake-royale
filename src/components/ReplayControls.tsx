import React, { useEffect } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';

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
}) => {
  const max = Math.max(0, total - 1);

  useEffect(() => {
    const handleAction = (action: GamepadMenuAction) => {
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
  }, [index, max, speed, onExit, onTogglePlay, onSeek, onSpeedChange, onRegisterHandler]);

  return (
    <div className="w-full max-w-[340px] sm:max-w-[400px] md:max-w-[460px] bg-[#8BAC0F] border-2 border-[#0F380F] px-3 py-2 font-mono text-[#0F380F] flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] font-black uppercase">
        <span>▶ Match Replay</span>
        <span>
          Turn {Math.min(index, max)} / {max}
        </span>
        <div className="flex items-center gap-1.5">
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
