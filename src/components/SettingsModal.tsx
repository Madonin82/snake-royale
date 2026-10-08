import React, { useState, useEffect, useCallback } from 'react';
import { GameSettings } from '../types/game';
import { soundEngine } from '../audio/soundEngine';
import { GamepadMenuAction } from '../game/gamepad';
import { ADMIN_UIDS, auth, signOutToAnonymous } from '../firebase';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, User } from 'firebase/auth';
import { Settings, Volume2, VolumeX, X, Grid, Gauge, Tv } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GameSettings;
  onUpdateSettings: (newSettings: Partial<GameSettings>) => void;
  isOnlineGuest?: boolean;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  isOnlineGuest = false,
  onRegisterHandler,
}) => {
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [authUser, setAuthUser] = useState<User | null>(auth.currentUser);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  type SettingsRow = 'STYLE' | 'TURNS' | 'GRID' | 'TICKS' | 'THINK_TIME' | 'SOUND' | 'CRT' | 'ACCOUNT' | 'CLOSE';

  const rows: SettingsRow[] = isOnlineGuest
    ? ['SOUND', 'CRT', 'ACCOUNT', 'CLOSE']
    : settings.turnBased
    ? ['STYLE', 'TURNS', 'GRID', 'THINK_TIME', 'SOUND', 'CRT', 'ACCOUNT', 'CLOSE']
    : ['STYLE', 'GRID', 'TICKS', 'SOUND', 'CRT', 'ACCOUNT', 'CLOSE'];

  const currentRow = rows[focusIndex] || rows[0];
  const signedInUser = authUser && !authUser.isAnonymous ? authUser : null;

  useEffect(() => {
    if (!isOpen) return;
    return onAuthStateChanged(auth, setAuthUser, (error) => {
      setAuthError(`Authentication state failed: ${error.message}`);
    });
  }, [isOpen]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        const message = error instanceof Error ? error.message : String(error);
        setAuthError(`Google sign-in failed: ${message}`);
      }
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutToAnonymous();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthError(`Sign out failed: ${message}`);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleAction = (action: GamepadMenuAction) => {
      if (action === 'CANCEL' || action === 'START') {
        soundEngine.playMenuBack();
        onClose();
        return;
      }

      if (action === 'UP') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
        return;
      }

      if (action === 'DOWN') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
        return;
      }

      if (action === 'CONFIRM') {
        soundEngine.playMenuSelect();
        switch (currentRow) {
          case 'STYLE':
            if (!isOnlineGuest) onUpdateSettings({ turnBased: !settings.turnBased });
            break;
          case 'TURNS': {
            if (!isOnlineGuest) {
              const turnOpts = [60, 90, 120];
              const next = turnOpts[(turnOpts.indexOf(settings.raceTurns) + 1) % turnOpts.length];
              onUpdateSettings({ raceTurns: next });
            }
            break;
          }
          case 'GRID': {
            if (!isOnlineGuest) {
              const gridOpts = [8, 12, 16];
              const next = gridOpts[(gridOpts.indexOf(settings.gridSize) + 1) % gridOpts.length];
              onUpdateSettings({ gridSize: next });
            }
            break;
          }
          case 'TICKS': {
            if (!isOnlineGuest) {
              const tickOpts = [4, 5, 6, 8];
              const next = tickOpts[(tickOpts.indexOf(settings.tickRate) + 1) % tickOpts.length];
              onUpdateSettings({ tickRate: next });
            }
            break;
          }
          case 'THINK_TIME': {
            if (!isOnlineGuest) {
              const thinkTimeOpts = [null, 5, 10, 15] as const;
              const index = thinkTimeOpts.findIndex(value => value === settings.thinkTimeSeconds);
              onUpdateSettings({ thinkTimeSeconds: thinkTimeOpts[(index + 1) % thinkTimeOpts.length] });
            }
            break;
          }
          case 'SOUND': {
            const next = !settings.soundEnabled;
            soundEngine.setEnabled(next);
            onUpdateSettings({ soundEnabled: next });
            break;
          }
          case 'CRT':
            onUpdateSettings({ crtFilterEnabled: !settings.crtFilterEnabled });
            break;
          case 'ACCOUNT':
            if (!authBusy) {
              if (signedInUser) void handleSignOut();
              else void handleGoogleSignIn();
            }
            break;
          case 'CLOSE':
            onClose();
            break;
        }
        return;
      }

      if (action === 'LEFT' || action === 'RIGHT') {
        soundEngine.playMenuSelect();
        const dir = action === 'RIGHT' ? 1 : -1;
        switch (currentRow) {
          case 'STYLE':
            if (!isOnlineGuest) onUpdateSettings({ turnBased: !settings.turnBased });
            break;
          case 'TURNS': {
            if (!isOnlineGuest) {
              const turnOpts = [60, 90, 120];
              let idx = turnOpts.indexOf(settings.raceTurns) + dir;
              if (idx < 0) idx = turnOpts.length - 1;
              if (idx >= turnOpts.length) idx = 0;
              onUpdateSettings({ raceTurns: turnOpts[idx] });
            }
            break;
          }
          case 'GRID': {
            if (!isOnlineGuest) {
              const gridOpts = [8, 12, 16];
              let idx = gridOpts.indexOf(settings.gridSize) + dir;
              if (idx < 0) idx = gridOpts.length - 1;
              if (idx >= gridOpts.length) idx = 0;
              onUpdateSettings({ gridSize: gridOpts[idx] });
            }
            break;
          }
          case 'TICKS': {
            if (!isOnlineGuest) {
              const tickOpts = [4, 5, 6, 8];
              let idx = tickOpts.indexOf(settings.tickRate) + dir;
              if (idx < 0) idx = tickOpts.length - 1;
              if (idx >= tickOpts.length) idx = 0;
              onUpdateSettings({ tickRate: tickOpts[idx] });
            }
            break;
          }
          case 'THINK_TIME': {
            if (!isOnlineGuest) {
              const thinkTimeOpts = [null, 5, 10, 15] as const;
              let idx = thinkTimeOpts.findIndex(value => value === settings.thinkTimeSeconds) + dir;
              if (idx < 0) idx = thinkTimeOpts.length - 1;
              if (idx >= thinkTimeOpts.length) idx = 0;
              onUpdateSettings({ thinkTimeSeconds: thinkTimeOpts[idx] });
            }
            break;
          }
          case 'SOUND': {
            const next = !settings.soundEnabled;
            soundEngine.setEnabled(next);
            onUpdateSettings({ soundEnabled: next });
            break;
          }
          case 'CRT':
            onUpdateSettings({ crtFilterEnabled: !settings.crtFilterEnabled });
            break;
          case 'CLOSE':
            break;
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [
    isOpen,
    currentRow,
    settings,
    rows.length,
    onUpdateSettings,
    onClose,
    onRegisterHandler,
    isOnlineGuest,
    authBusy,
    signedInUser,
    handleSignOut,
    handleGoogleSignIn,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs font-mono select-none">
      <div className="w-full max-w-sm max-h-[96dvh] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#0F380F] text-[#0F380F] p-3 flex flex-col justify-between gap-2 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-1.5 shrink-0">
          <div className="flex items-center gap-2 font-black text-sm uppercase">
            <Settings className="w-4 h-4" />
            <span>GAME SETTINGS</span>
          </div>
          <button
            onClick={() => {
              soundEngine.playMenuBack();
              onClose();
            }}
            className="p-1 hover:bg-[#0F380F] hover:text-[#9BBC0F] border border-[#0F380F] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Guest Adopted Rules Info Banner */}
        {isOnlineGuest && (
          <div className="bg-[#0F380F] text-[#9BBC0F] p-1.5 border border-[#0F380F] text-[10px] font-bold text-center flex flex-col gap-0.5 shrink-0">
            <div className="font-black">👑 ADOPTED HOST MATCH RULES:</div>
            <div>
              {settings.gridSize}×{settings.gridSize} Arena • {settings.turnBased ? `Turn-Based (${settings.raceTurns} Turns, Think Time: ${settings.thinkTimeSeconds === null ? 'Infinite' : `${settings.thinkTimeSeconds}s`})` : `Real-Time (${settings.tickRate} TPS)`}
            </div>
            <div className="text-[9px] opacity-80 italic">
              (Host controls match gameplay rules; you can toggle personal audio/CRT below)
            </div>
          </div>
        )}

        {/* Options */}
        <div className="flex flex-col gap-1.5 text-xs font-bold flex-1 justify-between min-h-0">
          {/* Play Style */}
          {!isOnlineGuest && (
            <div
              className={`flex flex-col gap-1 p-1.5 border transition-all ${
                currentRow === 'STYLE'
                  ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
              onClick={() => setFocusIndex(rows.indexOf('STYLE'))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 opacity-90">
                  {currentRow === 'STYLE' && <span className="animate-pulse">►</span>}
                  <Gauge className="w-3.5 h-3.5" />
                  <span>PLAY STYLE:</span>
                </div>
                {currentRow === 'STYLE' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] TOGGLE</span>
                )}
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
            </div>
          )}

          {/* Race length in turns (turn-based only) */}
          {!isOnlineGuest && settings.turnBased && (
            <div
              className={`flex flex-col gap-1 p-1.5 border transition-all ${
                currentRow === 'TURNS'
                  ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
              onClick={() => setFocusIndex(rows.indexOf('TURNS'))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 opacity-90">
                  {currentRow === 'TURNS' && <span className="animate-pulse">►</span>}
                  <Grid className="w-3.5 h-3.5" />
                  <span>RACE LENGTH (TURNS):</span>
                </div>
                {currentRow === 'TURNS' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CYCLE</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[60, 90, 120].map((turns) => (
                  <button
                    key={turns}
                    onClick={() => onUpdateSettings({ raceTurns: turns })}
                    className={`py-1 border border-[#0F380F] font-black cursor-pointer ${
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
          {!isOnlineGuest && (
            <div
              className={`flex flex-col gap-1 p-1.5 border transition-all ${
                currentRow === 'GRID'
                  ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
              onClick={() => setFocusIndex(rows.indexOf('GRID'))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 opacity-90">
                  {currentRow === 'GRID' && <span className="animate-pulse">►</span>}
                  <Grid className="w-3.5 h-3.5" />
                  <span>ARENA GRID SIZE:</span>
                </div>
                {currentRow === 'GRID' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CYCLE</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[8, 12, 16].map((size) => (
                  <button
                    key={size}
                    onClick={() => onUpdateSettings({ gridSize: size })}
                    className={`py-1 border border-[#0F380F] font-black cursor-pointer ${
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
          )}

          {/* Tick Rate Speed (real-time only) */}
          {!isOnlineGuest && !settings.turnBased && (
            <div
              className={`flex flex-col gap-1 p-1.5 border transition-all ${
                currentRow === 'TICKS'
                  ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
              onClick={() => setFocusIndex(rows.indexOf('TICKS'))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 opacity-90">
                  {currentRow === 'TICKS' && <span className="animate-pulse">►</span>}
                  <Gauge className="w-3.5 h-3.5" />
                  <span>GAME SPEED (TPS):</span>
                </div>
                {currentRow === 'TICKS' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CYCLE</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[4, 5, 6, 8].map((tps) => (
                  <button
                    key={tps}
                    onClick={() => onUpdateSettings({ tickRate: tps })}
                    className={`py-1 border border-[#0F380F] font-black cursor-pointer ${
                      settings.tickRate === tps
                        ? 'bg-[#0F380F] text-[#9BBC0F]'
                        : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                    }`}
                  >
                    {tps} tps
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Per-turn planning limit */}
          {!isOnlineGuest && settings.turnBased && (
            <div
              className={`flex flex-col gap-1 p-1.5 border transition-all ${
                currentRow === 'THINK_TIME'
                  ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                  : 'border-transparent'
              }`}
              onClick={() => setFocusIndex(rows.indexOf('THINK_TIME'))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 opacity-90">
                  {currentRow === 'THINK_TIME' && <span className="animate-pulse">►</span>}
                  <Gauge className="w-3.5 h-3.5" />
                  <span>THINK TIME:</span>
                </div>
                {currentRow === 'THINK_TIME' && (
                  <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CYCLE</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {([
                  { value: null, label: 'Infinite' },
                  { value: 5, label: '5s' },
                  { value: 10, label: '10s' },
                  { value: 15, label: '15s' },
                ] as const).map((option) => (
                  <button
                    key={option.label}
                    onClick={() => onUpdateSettings({ thinkTimeSeconds: option.value })}
                    className={`py-1 border border-[#0F380F] font-black cursor-pointer ${
                      settings.thinkTimeSeconds === option.value
                        ? 'bg-[#0F380F] text-[#9BBC0F]'
                        : 'bg-[#8BAC0F] hover:bg-[#9BBC0F]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sound Toggle */}
          <div
            className={`flex items-center justify-between p-2 border transition-all ${
              currentRow === 'SOUND'
                ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] border-[#0F380F]'
            }`}
            onClick={() => setFocusIndex(rows.indexOf('SOUND'))}
          >
            <div className="flex items-center gap-2">
              {currentRow === 'SOUND' && <span className="animate-pulse">►</span>}
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
          <div
            className={`flex items-center justify-between p-2 border transition-all ${
              currentRow === 'CRT'
                ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] border-[#0F380F]'
            }`}
            onClick={() => setFocusIndex(rows.indexOf('CRT'))}
          >
            <div className="flex items-center gap-2">
              {currentRow === 'CRT' && <span className="animate-pulse">►</span>}
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

          {/* Optional account sign-in */}
          <div
            className={`flex flex-col gap-1 p-2 border transition-all ${
              currentRow === 'ACCOUNT'
                ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] border-[#0F380F]'
            }`}
            onClick={() => setFocusIndex(rows.indexOf('ACCOUNT'))}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                {currentRow === 'ACCOUNT' && <span className="animate-pulse">►</span>}
                <span>ACCOUNT:</span>
                {signedInUser && (
                  <span className="truncate">
                    {signedInUser.displayName || signedInUser.email || 'Google account'}
                  </span>
                )}
                {signedInUser && ADMIN_UIDS.includes(signedInUser.uid) && (
                  <span className="shrink-0 bg-[#0F380F] text-[#9BBC0F] px-1 text-[9px]">ADMIN ✓</span>
                )}
              </div>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => {
                  if (signedInUser) void handleSignOut();
                  else void handleGoogleSignIn();
                }}
                className="shrink-0 px-2 py-1 border border-[#0F380F] font-black cursor-pointer disabled:cursor-wait disabled:opacity-60"
              >
                {authBusy ? 'PLEASE WAIT…' : signedInUser ? 'SIGN OUT' : 'SIGN IN WITH GOOGLE'}
              </button>
            </div>
            {authError && <div role="status" className="text-[9px] font-bold">{authError}</div>}
          </div>
        </div>

        {/* Footer Save & Close */}
        <button
          onClick={() => {
            soundEngine.playMenuSelect();
            onClose();
          }}
          onMouseEnter={() => setFocusIndex(rows.indexOf('CLOSE'))}
          className={`w-full py-2 border-2 border-[#0F380F] font-black text-xs uppercase cursor-pointer flex items-center justify-center gap-2 transition-all ${
            currentRow === 'CLOSE'
              ? 'bg-[#0F380F] text-[#9BBC0F] ring-3 ring-[#0F380F] scale-[1.02]'
              : 'bg-[#0F380F] text-[#9BBC0F]'
          }`}
        >
          {currentRow === 'CLOSE' && <span className="animate-pulse">►</span>}
          <span>SAVE & CLOSE</span>
          {currentRow === 'CLOSE' && (
            <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A / B]</span>
          )}
        </button>

        {/* Gamepad Helper Bar */}
        <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around">
          <span>🎮 [D-PAD] NAVIGATE</span>
          <span>[◄ ► / A] CHANGE</span>
          <span>[B / START] SAVE</span>
        </div>
      </div>
    </div>
  );
};
