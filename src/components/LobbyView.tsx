import React, { useState } from 'react';
import { GameSettings, PlayMode } from '../types/game';
import { Bot, Gamepad, Globe, Play, Settings, Users, Sparkles } from 'lucide-react';

interface LobbyViewProps {
  onStartSolo: (difficulty: 'EASY' | 'MEDIUM' | 'HARD') => void;
  onStartLocal2P: () => void;
  onCreateOnlineRoom: () => void;
  onCreateServerRoom: () => void;
  onSpectateRoom: (roomCode: string) => void;
  onJoinOnlineRoom: (roomCode: string) => void;
  onOpenSettings: () => void;
  onOpenLatencyHarness: () => void;
  gamepadCount: number;
  settings: GameSettings;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  onStartSolo,
  onStartLocal2P,
  onCreateOnlineRoom,
  onCreateServerRoom,
  onSpectateRoom,
  onJoinOnlineRoom,
  onOpenSettings,
  onOpenLatencyHarness,
  gamepadCount,
  settings,
  displayName,
  onDisplayNameChange,
}) => {
  const [roomInput, setRoomInput] = useState('');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
  const [tab, setTab] = useState<'SOLO' | 'LOCAL' | 'ONLINE'>('SOLO');

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim()) {
      onJoinOnlineRoom(roomInput.trim().toUpperCase());
    }
  };

  return (
    <div className="w-full max-w-[460px] bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[8px_8px_0px_#0F380F] text-[#0F380F] p-4 font-mono select-none flex flex-col gap-4">
      {/* Title Header */}
      <div className="text-center border-b-4 border-[#0F380F] pb-3">
        <div className="flex items-center justify-center gap-2">
          <span className="text-xl">🐍</span>
          <h1 className="text-xl font-black uppercase tracking-wider font-['Press_Start_2P',monospace] text-[#0F380F]">
            SNAKE ROYALE
          </h1>
          <span className="text-xl">👑</span>
        </div>
        <div className="text-[11px] font-bold mt-1 text-[#306230] uppercase tracking-widest">
          {settings.turnBased ? 'Turn-Based Strategy' : '2-Player Token Race'} • {settings.gridSize}×{settings.gridSize} Battle Arena
        </div>
      </div>

      {/* Optional display name */}
      <div className="flex items-center gap-2 bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
        <label className="text-[10px] font-bold uppercase whitespace-nowrap">Your name<br />(optional):</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="e.g. ANNIE"
          maxLength={14}
          className="flex-1 min-w-0 bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 font-black text-xs uppercase placeholder:text-[#306230]/50"
        />
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-3 gap-1 bg-[#8BAC0F] p-1 border-2 border-[#0F380F]">
        <button
          onClick={() => setTab('SOLO')}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'SOLO'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>SOLO VS AI</span>
        </button>

        <button
          onClick={() => setTab('LOCAL')}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'LOCAL'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>LOCAL 2P</span>
        </button>

        <button
          onClick={() => setTab('ONLINE')}
          className={`py-2 text-xs font-black uppercase flex flex-col items-center gap-1 cursor-pointer transition-colors border ${
            tab === 'ONLINE'
              ? 'bg-[#0F380F] text-[#9BBC0F] border-[#0F380F]'
              : 'bg-[#9BBC0F] text-[#0F380F] border-transparent hover:border-[#0F380F]'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>ONLINE NET</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="bg-[#8BAC0F] p-3 border-2 border-[#0F380F] min-h-[160px] flex flex-col justify-between">
        {tab === 'SOLO' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold leading-tight">
              🎮 Spar against the built-in bot! Race for tokens across rounds, then survive the shrinking walls.
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase">BOT Sparring Difficulty:</label>
              <div className="grid grid-cols-3 gap-1 text-xs">
                {(['EASY', 'MEDIUM', 'HARD'] as const).map((diff) => (
                  <button
                    key={diff}
                    onClick={() => setDifficulty(diff)}
                    className={`py-1.5 border border-[#0F380F] font-bold text-[11px] cursor-pointer ${
                      difficulty === diff ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => onStartSolo(difficulty)}
              className="mt-1 w-full bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START MATCH VS BOT</span>
            </button>
          </div>
        )}

        {tab === 'LOCAL' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold leading-tight">
              👥 2-Player Same Screen Showdown!
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] bg-[#9BBC0F] p-2 border border-[#0F380F]">
              <div>
                <span className="font-bold text-[#0F380F]">PLAYER 1:</span>
                <div>WASD or Gamepad 1</div>
              </div>
              <div>
                <span className="font-bold text-[#306230]">PLAYER 2:</span>
                <div>Arrow Keys / IJKL / Gamepad 2</div>
              </div>
            </div>

            <button
              onClick={onStartLocal2P}
              className="mt-1 w-full bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] py-2.5 border-2 border-[#0F380F] font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START LOCAL 2-PLAYER</span>
            </button>
          </div>
        )}

        {tab === 'ONLINE' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold leading-tight">
              🌐 Host-authoritative room with live Latency Harness! {settings.turnBased ? 'Turn-based: latency can\'t hurt you here.' : ''}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onCreateOnlineRoom}
                className="bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F] py-2 px-2 border-2 border-[#0F380F] font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer transition-all shadow-[2px_2px_0px_#0F380F]"
              >
                <Sparkles className="w-4 h-4" />
                <span>CREATE ROOM</span>
              </button>

              <form onSubmit={handleJoin} className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder="ROOM CODE"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="w-full bg-[#9BBC0F] border-2 border-[#0F380F] px-2 py-1 text-center font-black text-xs uppercase placeholder:text-[#306230]/50"
                />
                <button
                  type="submit"
                  disabled={!roomInput.trim()}
                  className="w-full bg-[#306230] hover:bg-[#0F380F] text-[#9BBC0F] py-1 border border-[#0F380F] font-bold text-xs cursor-pointer disabled:opacity-50 transition-colors"
                >
                  JOIN ROOM
                </button>
              </form>
            </div>

            <button
              onClick={onCreateServerRoom}
              className="w-full bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F] py-2 px-2 border-2 border-dashed border-[#0F380F] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              title="Run the simulation for two other players without taking a seat"
            >
              <Globe className="w-4 h-4" />
              <span>HOST AS SERVER (DM MODE) — RUN THE WORLD, DON'T PLAY</span>
            </button>

            <button
              onClick={() => roomInput.trim() && onSpectateRoom(roomInput.trim())}
              disabled={!roomInput.trim()}
              className="w-full bg-[#8BAC0F] hover:bg-[#306230] hover:text-[#9BBC0F] text-[#0F380F] py-2 px-2 border-2 border-dashed border-[#0F380F] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
              title="Watch a live match with a room code — no seat, no input"
            >
              <span>👁</span>
              <span>WATCH A MATCH (SPECTATOR) — ENTER CODE ABOVE</span>
            </button>
          </div>
        )}
      </div>

      {/* Rules Summary Box */}
      <div className="bg-[#9BBC0F] p-2.5 border-2 border-[#0F380F] text-[10px] leading-relaxed">
        <div className="font-bold border-b border-[#0F380F] pb-1 mb-1">RULES BRIEFING:</div>
        <ul className="list-disc pl-4 space-y-0.5">
          {settings.turnBased ? (
            <>
              <li><strong>Turns:</strong> Both snakes pick a direction and lock it — the board steps only when both moves are in. No clock, no lag deaths.</li>
              <li><strong>Phase 1 ({settings.raceTurns} turns):</strong> Race for tokens. Each eaten token adds +1 segment & spawns escalating tokens next round.</li>
              <li><strong>Phase 2:</strong> No new tokens. Outer ring shrinks every {settings.shrinkEveryTurns} turns into deadly walls.</li>
            </>
          ) : (
            <>
              <li><strong>Phase 1 (3:00):</strong> Race for tokens. Each eaten token adds +1 segment & spawns escalating tokens next round.</li>
              <li><strong>Phase 2 (2:00):</strong> No new tokens. Outer ring shrinks every 10s into deadly walls.</li>
            </>
          )}
          <li><strong>Win:</strong> Last snake alive. On tie/expiry: highest score, then longest length.</li>
        </ul>
      </div>

      {/* Footer Controls & Diagnostics */}
      <div className="flex items-center justify-between border-t-2 border-[#0F380F] pt-2 text-xs">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-2 py-1 border border-[#0F380F] font-bold cursor-pointer transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>SETTINGS ({settings.gridSize}×{settings.gridSize} / {settings.turnBased ? 'TURNS' : `${settings.tickRate}tps`})</span>
        </button>

        <button
          onClick={onOpenLatencyHarness}
          className="flex items-center gap-1 bg-[#8BAC0F] hover:bg-[#0F380F] hover:text-[#9BBC0F] px-2 py-1 border border-[#0F380F] font-bold cursor-pointer transition-colors"
        >
          <Gamepad className="w-3.5 h-3.5" />
          <span>NET HARNESS</span>
        </button>
      </div>
    </div>
  );
};
