import React from 'react';
import { GameSettings } from '../types/game';
import { soundEngine } from '../audio/soundEngine';
import { Settings, Volume2, VolumeX, X, Grid, Gauge, Tv } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GameSettings;
  onUpdateSettings: (newSettings: Partial<GameSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-mono select-none">
      <div className="w-full max-w-sm bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#0F380F] text-[#0F380F] p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-2">
          <div className="flex items-center gap-2 font-black text-sm uppercase">
            <Settings className="w-4 h-4" />
            <span>GAME SETTINGS</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#0F380F] hover:text-[#9BBC0F] border border-[#0F380F] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-3 text-xs font-bold">
          {/* Play Style: turn-based vs real-time */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 opacity-90">
              <Gauge className="w-3.5 h-3.5" />
              <span>PLAY STYLE:</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => onUpdateSettings({ turnBased: true })}
                className={`py-1.5 border border-[#0F380F] font-black cursor-pointer ${
                  settings.turnBased
                    ? 'bg-[#0F380F] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                }`}
              >
                TURN-BASED ★
              </button>
              <button
                onClick={() => onUpdateSettings({ turnBased: false })}
                className={`py-1.5 border border-[#0F380F] font-black cursor-pointer ${
                  !settings.turnBased
                    ? 'bg-[#0F380F] text-[#9BBC0F]'
                    : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                }`}
              >
                REAL-TIME
              </button>
            </div>
            <div className="text-[10px] font-medium opacity-80 leading-tight">
              {settings.turnBased
                ? 'Snakes step only when BOTH players lock a direction — chess pace, latency-proof.'
                : 'Classic clock-driven snake at the tick rate below.'}
            </div>
          </div>

          {/* Race length in turns (turn-based only) */}
          {settings.turnBased && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 opacity-90">
                <Grid className="w-3.5 h-3.5" />
                <span>RACE LENGTH (TURNS BEFORE SHRINK):</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[60, 90, 120].map((turns) => (
                  <button
                    key={turns}
                    onClick={() => onUpdateSettings({ raceTurns: turns })}
                    className={`py-1.5 border border-[#0F380F] font-black cursor-pointer ${
                      settings.raceTurns === turns
                        ? 'bg-[#0F380F] text-[#9BBC0F]'
                        : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                    }`}
                  >
                    {turns} {turns === 90 ? '★' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Grid Size */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 opacity-90">
              <Grid className="w-3.5 h-3.5" />
              <span>ARENA GRID SIZE:</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[8, 12, 16].map((size) => (
                <button
                  key={size}
                  onClick={() => onUpdateSettings({ gridSize: size })}
                  className={`py-1.5 border border-[#0F380F] font-black cursor-pointer ${
                    settings.gridSize === size
                      ? 'bg-[#0F380F] text-[#9BBC0F]'
                      : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                  }`}
                >
                  {size}×{size} {size === 8 ? '(v1)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Tick Rate Speed */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 opacity-90">
              <Gauge className="w-3.5 h-3.5" />
              <span>GAME TICK RATE (SPEED):</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[4, 5, 6, 8].map((tps) => (
                <button
                  key={tps}
                  onClick={() => onUpdateSettings({ tickRate: tps })}
                  className={`py-1.5 border border-[#0F380F] font-black cursor-pointer ${
                    settings.tickRate === tps
                      ? 'bg-[#0F380F] text-[#9BBC0F]'
                      : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                  }`}
                >
                  {tps} tps {tps === 5 ? '★' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Sound Toggle */}
          <div className="flex items-center justify-between bg-[#8BAC0F] p-2 border border-[#0F380F]">
            <div className="flex items-center gap-2">
              {settings.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>8-BIT SOUND EFFECTS</span>
            </div>
            <button
              onClick={() => {
                const next = !settings.soundEnabled;
                soundEngine.setEnabled(next);
                onUpdateSettings({ soundEnabled: next });
              }}
              className={`px-3 py-1 border border-[#0F380F] font-black cursor-pointer ${
                settings.soundEnabled ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              {settings.soundEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* CRT Scanline Filter Toggle */}
          <div className="flex items-center justify-between bg-[#8BAC0F] p-2 border border-[#0F380F]">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4" />
              <span>CRT SCANLINES</span>
            </div>
            <button
              onClick={() => onUpdateSettings({ crtFilterEnabled: !settings.crtFilterEnabled })}
              className={`px-3 py-1 border border-[#0F380F] font-black cursor-pointer ${
                settings.crtFilterEnabled ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              {settings.crtFilterEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

        </div>

        {/* Footer */}
        <button
          onClick={onClose}
          className="w-full bg-[#0F380F] text-[#9BBC0F] py-2 border-2 border-[#0F380F] font-black text-xs uppercase cursor-pointer"
        >
          SAVE & CLOSE
        </button>
      </div>
    </div>
  );
};
