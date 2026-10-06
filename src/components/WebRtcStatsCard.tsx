import React, { useState, useEffect } from 'react';
import { networkManager } from '../game/network';
import { Wifi, ArrowUpRight, ArrowDownLeft, AlertCircle } from 'lucide-react';

export const WebRtcStatsCard: React.FC = () => {
  const [stats, setStats] = useState({
    connected: false,
    state: 'DISCONNECTED',
    dataChannelState: 'CLOSED',
    rtdbConnected: false,
    lastTransportError: null as string | null,
    bytesSent: 0,
    bytesReceived: 0,
    packetsLost: 0,
    packetsSent: 0,
    packetLossPercent: 0,
  });

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const res = await networkManager.getWebRtcStats();
        if (active) setStats(res);
      } catch {
        // ignore
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="bg-[#8BAC0F] p-2.5 border-2 border-[#0F380F] flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-bold border-b border-[#0F380F] pb-1">
        <div className="flex items-center gap-1.5">
          <Wifi className={`w-3.5 h-3.5 ${stats.connected ? 'text-[#0F380F]' : 'opacity-50'}`} />
          <span>WebRTC P2P Data Channel</span>
        </div>
        <span
          className={`px-1.5 py-0.5 text-[9px] font-black border border-[#0F380F] ${
            stats.connected ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F] text-[#0F380F]'
          }`}
        >
          {stats.connected ? 'ACTIVE P2P' : stats.state}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-[#9BBC0F] p-1.5 border border-[#0F380F]">
          <div className="text-[9px] font-bold opacity-80 uppercase flex items-center justify-center gap-0.5">
            <ArrowUpRight className="w-3 h-3" /> Sent
          </div>
          <div className="font-black text-sm mt-0.5">{formatBytes(stats.bytesSent)}</div>
        </div>

        <div className="bg-[#9BBC0F] p-1.5 border border-[#0F380F]">
          <div className="text-[9px] font-bold opacity-80 uppercase flex items-center justify-center gap-0.5">
            <ArrowDownLeft className="w-3 h-3" /> Recv
          </div>
          <div className="font-black text-sm mt-0.5">{formatBytes(stats.bytesReceived)}</div>
        </div>

        <div className="bg-[#9BBC0F] p-1.5 border border-[#0F380F]">
          <div className="text-[9px] font-bold opacity-80 uppercase flex items-center justify-center gap-0.5">
            <AlertCircle className="w-3 h-3" /> Loss
          </div>
          <div className="font-black text-sm mt-0.5">{stats.packetLossPercent}%</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[9px] font-bold border-t border-[#0F380F] pt-1">
        <span>RTDB FALLBACK: {stats.rtdbConnected ? 'ONLINE' : 'OFFLINE'}</span>
        <span>CHANNEL: {stats.dataChannelState.toUpperCase()}</span>
      </div>
      {stats.lastTransportError && (
        <div className="text-[9px] font-bold text-red-800 break-words" role="status">
          {stats.lastTransportError}
        </div>
      )}
    </div>
  );
};
