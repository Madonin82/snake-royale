import React, { useEffect, useState } from 'react';
import { GameSettings } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';

interface PauseMenuProps {
  isOpen: boolean;
  onResume: () => void;
  onQuit: () => void;
  quitLabel: string;
  settings: GameSettings;
  // Local-only: control style is a per-device input preference, not a
  // match rule, so it must never be broadcast to an online opponent.
  // Callers pass a setter that does NOT call networkManager.updateRoomSettings.
  onUpdateControlSettings: (newSettings: Partial<GameSettings>) => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
}

const CONTROL_TOGGLES = [
  { key: 'gestureSwipeEnabled', label: 'Swipe' },
  { key: 'gestureCardSwipeEnabled', label: 'Card-Swipe' },
  { key: 'gestureTapPathEnabled', label: 'Tap-to-Path' },
  { key: 'gestureTapHeadLockEnabled', label: 'Tap-Head Lock' },
  { key: 'gestureDragEnabled', label: 'Drag' },
  { key: 'gestureLongPressEnabled', label: 'Long-Press' },
] as const;

export const PauseMenu: React.FC<PauseMenuProps> = ({
  isOpen,
  onResume,
  onQuit,
  quitLabel,
  settings,
  onUpdateControlSettings,
  onRegisterHandler,
}) => {
  const [quitArmed, setQuitArmed] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);

  // Linear focus order, top to bottom: RESUME, the 6 control toggles,
  // QUIT, and CANCEL once quit is armed. Linear (not grid-aware) so
  // D-pad up/down and left/right both move one step, wrapping around.
  const focusIds: string[] = [
    'resume',
    ...CONTROL_TOGGLES.map((t) => t.key),
    'quit',
    ...(quitArmed ? ['cancel'] : []),
  ];

  useEffect(() => {
    if (isOpen) {
      setQuitArmed(false);
      setFocusIndex(0);
    }
  }, [isOpen]);

  // Disarming quit removes CANCEL from the list; clamp focus back to QUIT.
  useEffect(() => {
    if (isOpen && focusIndex >= focusIds.length) {
      setFocusIndex(focusIds.length - 1);
    }
  }, [isOpen, quitArmed, focusIndex, focusIds.length]);

  useEffect(() => {
    if (!isOpen) return;

    const activate = (id: string) => {
      if (id === 'resume') {
        onResume();
        return;
      }
      if (id === 'quit') {
        if (quitArmed) onQuit();
        else setQuitArmed(true);
        return;
      }
      if (id === 'cancel') {
        setQuitArmed(false);
        return;
      }
      const toggle = CONTROL_TOGGLES.find((t) => t.key === id);
      if (toggle) {
        const enabled = (settings as any)[toggle.key] !== false;
        onUpdateControlSettings({ [toggle.key]: !enabled });
      }
    };

    const handleAction = (action: GamepadMenuAction) => {
      if (action === 'UP' || action === 'LEFT') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : focusIds.length - 1));
        return;
      }
      if (action === 'DOWN' || action === 'RIGHT') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < focusIds.length - 1 ? prev + 1 : 0));
        return;
      }
      if (action === 'CONFIRM') {
        soundEngine.playMenuSelect();
        activate(focusIds[focusIndex]);
        return;
      }
      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        // B backs out of the quit confirmation first, then closes pause.
        if (quitArmed) setQuitArmed(false);
        else onResume();
        return;
      }
      // START is the pause toggle itself: pressing it while paused resumes,
      // same as P on keyboard. It does not confirm the focused item.
      if (action === 'START') {
        soundEngine.playMenuBack();
        onResume();
        return;
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [isOpen, quitArmed, focusIndex, focusIds, settings, onResume, onQuit, onUpdateControlSettings, onRegisterHandler]);

  if (!isOpen) return null;

  const focused = (id: string) =>
    focusIds[focusIndex] === id ? ' ring-4 ring-[#ffffff] scale-[1.01]' : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pause menu"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#0F380F]/90 p-4 font-mono text-[#9BBC0F]"
    >
      <div className="w-full max-w-[340px] flex flex-col gap-3 bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#306230] p-4 text-[#0F380F]">
        <div className="text-center">
          <div className="text-xl font-black tracking-wider">PAUSED</div>
          <div className="mt-1 text-[11px] font-bold opacity-80">
            Your moves are blocked until you resume.
          </div>
          <div className="mt-1 text-[10px] font-bold opacity-70">
            Gamepad: D-pad to move, A to pick, B to go back, Start to resume.
          </div>
        </div>

        <button
          type="button"
          onClick={onResume}
          className={`w-full cursor-pointer py-3 bg-[#0F380F] text-[#9BBC0F] font-black text-base border-2 border-[#0F380F] shadow-[3px_3px_0px_#306230] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none${focused('resume')}`}
        >
          RESUME
        </button>

        <div className="flex flex-col gap-1.5 p-2 border-2 border-[#0F380F] bg-[#8BAC0F]">
          <div className="text-xs font-black uppercase">Control style</div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            {CONTROL_TOGGLES.map(({ key, label }) => {
              const enabled = (settings as any)[key] !== false;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onUpdateControlSettings({ [key]: !enabled })}
                  className={`min-h-[44px] py-2 px-2 border border-[#0F380F] font-black flex items-center justify-between cursor-pointer ${
                    enabled ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F] text-[#0F380F]'
                  }${focused(key)}`}
                >
                  <span>{label}</span>
                  <span>{enabled ? 'ON' : 'OFF'}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] font-bold opacity-80">
            Only controls, not match settings. Changes here stay on this device.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (quitArmed) onQuit();
            else setQuitArmed(true);
          }}
          className={`w-full cursor-pointer py-3 font-black text-base border-2 border-[#0F380F] ${
            quitArmed ? 'bg-red-700 text-white' : 'bg-[#9BBC0F] text-[#0F380F]'
          }${focused('quit')}`}
        >
          {quitArmed ? 'QUIT MATCH — ARE YOU SURE?' : quitLabel}
        </button>
        {quitArmed && (
          <button
            type="button"
            onClick={() => setQuitArmed(false)}
            className={`w-full cursor-pointer py-2 bg-[#8BAC0F] text-[#0F380F] font-black text-sm border-2 border-[#0F380F]${focused('cancel')}`}
          >
            CANCEL
          </button>
        )}
      </div>
    </div>
  );
};
