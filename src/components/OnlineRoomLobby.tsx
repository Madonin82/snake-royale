import React, { useState } from 'react';
import { Copy, Check, Play, Users, ArrowLeft, Activity } from 'lucide-react';

interface OnlineRoomLobbyProps {
  roomId: string;
  role: 'p1' | 'p2' | 'spectator' | null;
  hasP1: boolean;
  hasP2: boolean;
  spectatorsCount: number;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onOpenLatencyHarness: () => void;
}

export const OnlineRoomLobby: React.FC<OnlineRoomLobbyProps> = ({
  roomId,
  role,
  hasP1,
  hasP2,
  spectatorsCount,
  onStartMatch,
  onLeaveRoom,
  onOpenLatencyHarness,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isHost = role === 'p1';
  const bothPlayersReady = hasP1 && hasP2;

  return (
    <div className="w-full max-w-[440px] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] text-[#0F380F] p-4 font-mono select-none flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-2">
        <button
          onClick={onLeaveRoom}
          className="flex items-center gap-1 bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-xs font-bold px-2 py-1 border border-[#0F380F] cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>LEAVE ROOM</span>
        </button>
        <button
          onClick={onOpenLatencyHarness}
          className="flex items-center gap-1 bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] text-xs font-bold px-2 py-1 border border-[#0F380F] cursor-pointer"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>NET HARNESS</span>
        </button>
      </div>

      {/* Room Code Display */}
      <div className="bg-[#8BAC0F] p-3 border-2 border-[#0F380F] text-center flex flex-col items-center gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider">ROOM CODE (SHARE WITH OPPONENT):</div>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black tracking-widest bg-[#9BBC0F] px-4 py-1 border-2 border-[#0F380F]">
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
      </div>

      {/* Seat Roster */}
      <div className="grid grid-cols-2 gap-2">
        {/* Seat P1 */}
        <div className="bg-[#8BAC0F] p-2.5 border-2 border-[#0F380F] flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase">SEAT 1 (HOST / P1)</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-3 bg-[#0F380F] border border-[#0F380F]" />
            <span className="font-black text-xs">
              {hasP1 ? (role === 'p1' ? 'YOU (HOST)' : 'PLAYER 1') : 'WAITING...'}
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
              {hasP2 ? (role === 'p2' ? 'YOU (CHALLENGER)' : 'PLAYER 2 READY') : 'WAITING FOR OPPONENT...'}
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

      {/* Start Button */}
      {isHost ? (
        <button
          onClick={onStartMatch}
          disabled={!bothPlayersReady}
          className={`w-full py-3 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 transition-all ${
            bothPlayersReady
              ? 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] cursor-pointer shadow-[3px_3px_0px_#0F380F]'
              : 'bg-[#8BAC0F] text-[#0F380F]/50 border-dashed cursor-not-allowed'
          }`}
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{bothPlayersReady ? 'LAUNCH MATCH NOW' : 'WAITING FOR PLAYER 2 TO JOIN...'}</span>
        </button>
      ) : (
        <div className="bg-[#8BAC0F] p-2.5 border border-[#0F380F] text-center text-xs font-bold">
          {bothPlayersReady
            ? '✅ Ready! Waiting for Host to launch match...'
            : '⏳ Connecting to match host...'}
        </div>
      )}
    </div>
  );
};
