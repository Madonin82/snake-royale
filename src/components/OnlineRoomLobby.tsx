import React, { useState, useEffect } from 'react';
import { Copy, Check, Play, Users, ArrowLeft, Activity, Settings } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { GameSettings } from '../types/game';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { ADMIN_UIDS, auth } from '../firebase';

interface OnlineRoomLobbyProps {
  roomId: string;
  bridgeSecret: string | null;
  role: 'p1' | 'p2' | 'spectator' | 'server' | null;
  hasP1: boolean;
  hasP2: boolean;
  spectatorsCount: number;
  playerNames: { p1: string; p2: string };
  series: { p1: number; p2: number; draws: number };
  settings: GameSettings;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onOpenLatencyHarness: () => void;
  onOpenSettings?: () => void;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
}

export const OnlineRoomLobby: React.FC<OnlineRoomLobbyProps> = ({
  roomId,
  bridgeSecret,
  role,
  hasP1,
  hasP2,
  spectatorsCount,
  playerNames,
  series,
  settings,
  onStartMatch,
  onLeaveRoom,
  onOpenLatencyHarness,
  onOpenSettings,
  onRegisterHandler,
}) => {
  const [copied, setCopied] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [signedInUser, setSignedInUser] = useState<User | null>(() => {
    const user = auth.currentUser;
    return user && !user.isAnonymous ? user : null;
  });

  const isHost = role === 'p1';
  const isServer = role === 'server';
  const canStart = isHost || isServer;
  const bothPlayersReady = hasP1 && hasP2;

  useEffect(() => onAuthStateChanged(
    auth,
    (user) => setSignedInUser(user && !user.isAnonymous ? user : null),
    (error) => {
      console.error(`Authentication state failed: ${error.message}`);
      setSignedInUser(null);
    },
  ), []);

  const buttons: ('START' | 'COPY' | 'SETTINGS' | 'HARNESS' | 'LEAVE')[] = canStart
    ? ['START', 'COPY', 'SETTINGS', 'HARNESS', 'LEAVE']
    : ['COPY', 'SETTINGS', 'HARNESS', 'LEAVE'];

  const [focusIndex, setFocusIndex] = useState<number>(0);
  const currentBtn = buttons[focusIndex] || buttons[0];

  const handleCopy = () => {
    soundEngine.playMenuSelect();
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyBridgeSecret = () => {
    if (!bridgeSecret) return;
    soundEngine.playMenuSelect();
    navigator.clipboard.writeText(bridgeSecret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  useEffect(() => {
    const handleAction = (action: GamepadMenuAction) => {
      if (action === 'CANCEL') {
        soundEngine.playMenuBack();
        onLeaveRoom();
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
        if (currentBtn === 'START' && canStart) {
          if (bothPlayersReady) {
            soundEngine.playMenuSelect();
            onStartMatch();
          }
        } else if (currentBtn === 'COPY') {
          handleCopy();
        } else if (currentBtn === 'SETTINGS') {
          soundEngine.playMenuSelect();
          onOpenSettings?.();
        } else if (currentBtn === 'HARNESS') {
          soundEngine.playMenuSelect();
          onOpenLatencyHarness();
        } else if (currentBtn === 'LEAVE') {
          soundEngine.playMenuBack();
          onLeaveRoom();
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [currentBtn, canStart, bothPlayersReady, onStartMatch, onOpenSettings, onOpenLatencyHarness, onLeaveRoom, buttons.length, onRegisterHandler]);

  return (
    <div className="w-full max-w-[440px] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] text-[#0F380F] p-4 font-mono select-none flex flex-col gap-3">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-2">
        <button
          onClick={() => {
            soundEngine.playMenuBack();
            onLeaveRoom();
          }}
          onMouseEnter={() => setFocusIndex(buttons.indexOf('LEAVE'))}
          className={`flex items-center gap-1 px-2 py-1 border border-[#0F380F] text-xs font-bold cursor-pointer transition-colors ${
            currentBtn === 'LEAVE'
              ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
              : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
          }`}
        >
          {currentBtn === 'LEAVE' && <span className="animate-pulse">►</span>}
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>LEAVE ROOM</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              soundEngine.playMenuSelect();
              onOpenSettings?.();
            }}
            onMouseEnter={() => setFocusIndex(buttons.indexOf('SETTINGS'))}
            className={`flex items-center gap-1 px-2 py-1 border border-[#0F380F] text-xs font-bold cursor-pointer transition-colors ${
              currentBtn === 'SETTINGS'
                ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
            }`}
          >
            {currentBtn === 'SETTINGS' && <span className="animate-pulse">►</span>}
            <Settings className="w-3.5 h-3.5" />
            <span>RULES</span>
          </button>

          <button
            onClick={() => {
              soundEngine.playMenuSelect();
              onOpenLatencyHarness();
            }}
            onMouseEnter={() => setFocusIndex(buttons.indexOf('HARNESS'))}
            className={`flex items-center gap-1 px-2 py-1 border border-[#0F380F] text-xs font-bold cursor-pointer transition-colors ${
              currentBtn === 'HARNESS'
                ? 'bg-[#0F380F] text-[#9BBC0F] ring-2 ring-[#0F380F]'
                : 'bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F]'
            }`}
          >
            {currentBtn === 'HARNESS' && <span className="animate-pulse">►</span>}
            <Activity className="w-3.5 h-3.5" />
            <span>NET</span>
          </button>
        </div>
      </div>

      {/* Room Code Display */}
      <div
        className={`p-2.5 border-2 transition-all text-center flex flex-col items-center gap-1.5 ${
          currentBtn === 'COPY'
            ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
            : 'bg-[#8BAC0F] border-[#0F380F]'
        }`}
        onClick={handleCopy}
      >
        <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
          {currentBtn === 'COPY' && <span className="animate-pulse">►</span>}
          ROOM CODE (SHARE WITH OPPONENT):
        </div>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black tracking-widest bg-[#9BBC0F] px-4 py-0.5 border-2 border-[#0F380F]">
            {roomId}
          </span>
          <button
            onClick={handleCopy}
            className="bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] p-2 border-2 border-[#0F380F] cursor-pointer shadow-[2px_2px_0px_#0F380F]"
            title="Copy Code"
          >
            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
          </button>
        </div>
        {copied && <span className="text-[10px] font-bold">COPIED TO CLIPBOARD!</span>}
        {currentBtn === 'COPY' && (
          <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[A] COPY</span>
        )}
      </div>

      {isHost && bridgeSecret && signedInUser && ADMIN_UIDS.includes(signedInUser.uid) && (
        <div className="p-2.5 border-2 border-[#0F380F] bg-[#8BAC0F] text-center flex flex-col items-center gap-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider">
            BRIDGE SECRET (SHARE WITH AI AGENT):
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-widest bg-[#9BBC0F] px-3 py-1 border-2 border-[#0F380F]">
              {bridgeSecret}
            </span>
            <button
              onClick={handleCopyBridgeSecret}
              className="bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] p-2 border-2 border-[#0F380F] cursor-pointer shadow-[2px_2px_0px_#0F380F]"
              title="Copy Bridge Secret"
            >
              {secretCopied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          {secretCopied && <span className="text-[10px] font-bold">COPIED TO CLIPBOARD!</span>}
        </div>
      )}

      {/* Adopted Host Rules Banner */}
      <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F] flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] font-bold">
          <span className="flex items-center gap-1">
            <Settings className="w-3 h-3" />
            <span>MATCH RULES:</span>
          </span>
          <span className="bg-[#0F380F] text-[#9BBC0F] px-1 py-0.5 text-[9px] font-black uppercase">
            {canStart ? '⚙️ HOST CONTROL' : '👑 HOST RULES ADOPTED'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-center font-black">
          <div className="bg-[#9BBC0F] border border-[#0F380F] py-1">
            <div className="text-[8px] opacity-75 font-semibold">GRID</div>
            <div>{settings.gridSize}×{settings.gridSize}</div>
          </div>
          <div className="bg-[#9BBC0F] border border-[#0F380F] py-1">
            <div className="text-[8px] opacity-75 font-semibold">STYLE</div>
            <div>{settings.turnBased ? `TURNS (${settings.raceTurns})` : 'REAL-TIME'}</div>
          </div>
          <div className="bg-[#9BBC0F] border border-[#0F380F] py-1">
            <div className="text-[8px] opacity-75 font-semibold">{settings.turnBased ? 'THINK TIME' : 'SPEED'}</div>
            <div>{settings.turnBased ? (settings.thinkTimeSeconds === null ? 'INFINITE' : `${settings.thinkTimeSeconds}s`) : `${settings.tickRate} TPS`}</div>
          </div>
        </div>
      </div>

      {/* DM banner */}
      {isServer && (
        <div className="bg-[#0F380F] text-[#9BBC0F] p-2 border-2 border-[#0F380F] text-center text-[11px] font-black">
          🐉 DM MODE — YOU RUN THE WORLD. TWO PLAYERS TAKE THE SEATS.
        </div>
      )}

      {/* Spectator banner */}
      {role === 'spectator' && (
        <div className="bg-[#0F380F] text-[#9BBC0F] p-2 border-2 border-[#0F380F] text-center text-[11px] font-black">
          👁 SPECTATING — YOU'RE WATCHING. THE PLAYERS CAN'T SEE YOUR INPUT (YOU HAVE NONE).
        </div>
      )}

      {/* Seat Roster */}
      <div className="grid grid-cols-2 gap-2">
        {/* Seat P1 */}
        <div className="bg-[#8BAC0F] p-2.5 border-2 border-[#0F380F] flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase">SEAT 1 (HOST / P1)</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-3 bg-[#0F380F] border border-[#0F380F]" />
            <span className="font-black text-xs">
              {hasP1 ? (role === 'p1' ? `${playerNames.p1} (YOU)` : playerNames.p1) : 'WAITING...'}
            </span>
          </div>
          <span className="text-[9px] opacity-75 mt-0.5">Runs Host Simulation</span>
        </div>

        {/* Seat P2 */}
        <div className="bg-[#8BAC0F] p-2.5 border-2 border-[#0F380F] flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase">SEAT 2 (CHALLENGER / P2)</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-3 bg-[#306230] border border-[#0F380F]" />
            <span className="font-black text-xs">
              {hasP2 ? (role === 'p2' ? `${playerNames.p2} (YOU)` : playerNames.p2) : 'WAITING FOR OPPONENT...'}
            </span>
          </div>
          <span className="text-[9px] opacity-75 mt-0.5">Remote Input Stream</span>
        </div>
      </div>

      {spectatorsCount > 0 && (
        <div className="text-center text-[10px] font-bold opacity-80">
          <Users className="w-3 h-3 inline mr-1" />
          {spectatorsCount} spectator(s) connected
        </div>
      )}

      {/* Series scoreboard */}
      {(series.p1 + series.p2 + series.draws) > 0 && (
        <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F] text-center text-[11px] font-black">
          🏆 SERIES — {playerNames.p1} {series.p1} · {playerNames.p2} {series.p2}
          {series.draws > 0 ? ` · DRAWS ${series.draws}` : ''}
        </div>
      )}

      {/* Start Button */}
      {canStart ? (
        <button
          onClick={() => {
            if (bothPlayersReady) {
              soundEngine.playMenuSelect();
              onStartMatch();
            }
          }}
          disabled={!bothPlayersReady}
          onMouseEnter={() => setFocusIndex(buttons.indexOf('START'))}
          className={`w-full py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 transition-all ${
            bothPlayersReady
              ? currentBtn === 'START'
                ? 'bg-[#0F380F] text-[#9BBC0F] ring-4 ring-[#0F380F] scale-[1.02] cursor-pointer shadow-[3px_3px_0px_#0F380F]'
                : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] cursor-pointer shadow-[3px_3px_0px_#0F380F]'
              : 'bg-[#8BAC0F] text-[#0F380F]/50 border-dashed cursor-not-allowed'
          }`}
        >
          {currentBtn === 'START' && <span className="animate-pulse">►</span>}
          <Play className="w-4 h-4 fill-current" />
          <span>
            {bothPlayersReady
              ? 'LAUNCH MATCH NOW'
              : `WAITING FOR ${hasP1 ? 'PLAYER 2' : 'PLAYER 1'} TO JOIN...`}
          </span>
          {bothPlayersReady && currentBtn === 'START' && (
            <span className="text-[10px] bg-[#9BBC0F] text-[#0F380F] px-1.5 py-0.5 ml-2 font-bold">
              [A / START]
            </span>
          )}
        </button>
      ) : (
        <div className="bg-[#8BAC0F] p-2.5 border border-[#0F380F] text-center text-xs font-bold">
          {bothPlayersReady
            ? '✅ Ready! Waiting for Host to launch match...'
            : '⏳ Connecting to match host...'}
        </div>
      )}

      {/* Gamepad Helper Bar */}
      <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around">
        <span>🎮 [D-PAD] NAVIGATE</span>
        <span>[A / START] SELECT</span>
        <span>[B] LEAVE</span>
      </div>
    </div>
  );
};
