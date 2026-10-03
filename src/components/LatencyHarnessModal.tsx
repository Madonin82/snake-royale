import React, { useState, useEffect } from 'react';
import { LatencyReport } from '../types/game';
import { networkManager } from '../game/network';
import { GamepadMenuAction } from '../game/gamepad';
import { soundEngine } from '../audio/soundEngine';
import { Activity, Play, RefreshCw, X, Sliders, ShieldCheck } from 'lucide-react';
import { WebRtcStatsCard } from './WebRtcStatsCard';

interface LatencyHarnessModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: LatencyReport;
  isConnected: boolean;
  roomId: string;
  role: string | null;
  onRegisterHandler?: (handler: ((action: GamepadMenuAction) => void) | null) => void;
}

export const LatencyHarnessModal: React.FC<LatencyHarnessModalProps> = ({
  isOpen,
  onClose,
  report,
  isConnected,
  roomId,
  role,
  onRegisterHandler,
}) => {
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [simPreset, setSimPreset] = useState<'NONE' | 'WIFI_JITTER' | 'SLOW_4G' | 'HIGH_LAG'>('NONE');
  const [focusIndex, setFocusIndex] = useState<number>(0);

  const presets = ['NONE', 'WIFI_JITTER', 'SLOW_4G', 'HIGH_LAG'] as const;
  const items = ['PROBE', 'PRESETS', 'CLOSE'] as const;
  const currentItem = items[focusIndex] || 'PROBE';

  const handleRunBurst = () => {
    soundEngine.playMenuSelect();
    setIsRunningTest(true);
    networkManager.runLatencyBurst(25);
    setTimeout(() => {
      setIsRunningTest(false);
    }, 2200);
  };

  const handleApplySimulation = (preset: 'NONE' | 'WIFI_JITTER' | 'SLOW_4G' | 'HIGH_LAG') => {
    soundEngine.playMenuSelect();
    setSimPreset(preset);
    switch (preset) {
      case 'NONE':
        networkManager.setSimulatedConditions(0, 0);
        break;
      case 'WIFI_JITTER':
        networkManager.setSimulatedConditions(15, 25);
        break;
      case 'SLOW_4G':
        networkManager.setSimulatedConditions(120, 45);
        break;
      case 'HIGH_LAG':
        networkManager.setSimulatedConditions(280, 80);
        break;
    }
  };

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
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        return;
      }

      if (action === 'DOWN') {
        soundEngine.playMenuMove();
        setFocusIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        return;
      }

      if (action === 'CONFIRM') {
        if (currentItem === 'PROBE') {
          if (!isRunningTest) handleRunBurst();
        } else if (currentItem === 'CLOSE') {
          soundEngine.playMenuBack();
          onClose();
        } else if (currentItem === 'PRESETS') {
          const next = presets[(presets.indexOf(simPreset) + 1) % presets.length];
          handleApplySimulation(next);
        }
        return;
      }

      if (action === 'LEFT' || action === 'RIGHT') {
        if (currentItem === 'PRESETS') {
          const dir = action === 'RIGHT' ? 1 : -1;
          let idx = presets.indexOf(simPreset) + dir;
          if (idx < 0) idx = presets.length - 1;
          if (idx >= presets.length) idx = 0;
          handleApplySimulation(presets[idx]);
        }
      }
    };

    onRegisterHandler?.(handleAction);
    return () => {
      onRegisterHandler?.(null);
    };
  }, [isOpen, currentItem, simPreset, isRunningTest, onClose, onRegisterHandler, items.length, presets]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-mono select-none">
      <div className="w-full max-w-lg bg-[#9BBC0F] border-4 border-[#0F380F] shadow-[6px_6px_0px_#0F380F] text-[#0F380F] p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#0F380F] pb-2">
          <div className="flex items-center gap-2 font-black text-sm uppercase tracking-wider">
            <Activity className="w-5 h-5" />
            <span>NET Latency Diagnostic Harness</span>
          </div>
          <button
            onClick={() => {
              soundEngine.playMenuBack();
              onClose();
            }}
            className="p-1 hover:bg-[#0F380F] hover:text-[#9BBC0F] border border-[#0F380F] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Connection Status Banner */}
        <div className="flex items-center justify-between bg-[#8BAC0F] p-2 border border-[#0F380F] text-xs">
          <div>
            <span className="font-bold">STATUS: </span>
            <span className={isConnected ? 'text-[#0F380F] font-black' : 'text-[#306230]'}>
              {isConnected ? `CONNECTED (${roomId ? `ROOM: ${roomId}` : 'LOCAL WS'})` : 'STANDALONE / DISCONNECTED'}
            </span>
          </div>
          <div className="text-[11px] font-bold">
            SEAT: <span className="bg-[#9BBC0F] px-1.5 py-0.5 border border-[#0F380F]">{role || 'LOCAL'}</span>
          </div>
        </div>

        {/* Main Metrics Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
            <div className="text-[10px] font-bold uppercase opacity-80">Median RTT</div>
            <div className="text-xl font-black mt-1">
              {report.medianRtt > 0 ? `${report.medianRtt} ms` : '—'}
            </div>
            <div className="text-[9px] opacity-75">50th percentile</div>
          </div>

          <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
            <div className="text-[10px] font-bold uppercase text-[#0F380F] bg-[#9BBC0F] border border-[#0F380F]">
              P95 Tail RTT
            </div>
            <div className="text-xl font-black mt-1">
              {report.p95Rtt > 0 ? `${report.p95Rtt} ms` : '—'}
            </div>
            <div className="text-[9px] font-bold">95th percentile</div>
          </div>

          <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
            <div className="text-[10px] font-bold uppercase opacity-80">Jitter</div>
            <div className="text-xl font-black mt-1">
              {report.jitterMs > 0 ? `±${report.jitterMs} ms` : '—'}
            </div>
            <div className="text-[9px] opacity-75">Mean variance</div>
          </div>

          <div className="bg-[#8BAC0F] p-2 border-2 border-[#0F380F]">
            <div className="text-[10px] font-bold uppercase opacity-80">Input Tick Lag</div>
            <div className="text-xl font-black mt-1">
              {report.inputTickLagAvg > 0 ? `${report.inputTickLagAvg} t` : '0 t'}
            </div>
            <div className="text-[9px] opacity-75">Host arrival lag</div>
          </div>
        </div>

        {/* Tail Analysis & Historical Samples Sparkline */}
        <div className="bg-[#8BAC0F] p-2.5 border-2 border-[#0F380F] flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span>RECENT PING SAMPLES (BURST 25)</span>
            <span className="text-[10px]">
              MIN: {report.minRtt}ms | MAX: {report.maxRtt}ms | AVG: {report.avgRtt}ms
            </span>
          </div>

          <div className="h-14 bg-[#9BBC0F] border border-[#0F380F] p-1 flex items-end gap-1 overflow-hidden">
            {report.samples.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[10px] opacity-70">
                Click "Run Latency Probe Burst" to collect telemetry
              </div>
            ) : (
              report.samples.slice(-25).map((sample, idx) => {
                const maxVal = Math.max(100, report.maxRtt);
                const heightPercent = Math.min(100, Math.max(10, (sample.rttMs / maxVal) * 100));
                return (
                  <div
                    key={idx}
                    className="flex-1 bg-[#0F380F] hover:bg-[#306230] relative group transition-all"
                    style={{ height: `${heightPercent}%` }}
                    title={`Ping #${idx + 1}: ${sample.rttMs}ms`}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* WebRTC P2P Connection Stats */}
        <WebRtcStatsCard />

        {/* Network Conditions Simulator */}
        <div
          className={`border p-2 flex flex-col gap-1.5 transition-all ${
            currentItem === 'PRESETS'
              ? 'bg-[#8BAC0F] border-[#0F380F] ring-2 ring-[#0F380F]'
              : 'border-[#0F380F] bg-[#8BAC0F]'
          }`}
          onClick={() => setFocusIndex(items.indexOf('PRESETS'))}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <div className="flex items-center gap-1.5">
              {currentItem === 'PRESETS' && <span className="animate-pulse">►</span>}
              <Sliders className="w-3.5 h-3.5" />
              <span>SIMULATED NETWORK TEST MATRIX</span>
            </div>
            {currentItem === 'PRESETS' && (
              <span className="text-[9px] bg-[#0F380F] text-[#9BBC0F] px-1 font-bold">[◄ ►] CYCLE</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
            <button
              onClick={() => handleApplySimulation('NONE')}
              className={`px-2 py-1 border border-[#0F380F] font-bold text-[10px] cursor-pointer ${
                simPreset === 'NONE' ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              Direct / LAN
            </button>
            <button
              onClick={() => handleApplySimulation('WIFI_JITTER')}
              className={`px-2 py-1 border border-[#0F380F] font-bold text-[10px] cursor-pointer ${
                simPreset === 'WIFI_JITTER' ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              Wi-Fi Jitter
            </button>
            <button
              onClick={() => handleApplySimulation('SLOW_4G')}
              className={`px-2 py-1 border border-[#0F380F] font-bold text-[10px] cursor-pointer ${
                simPreset === 'SLOW_4G' ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              Cellular 4G
            </button>
            <button
              onClick={() => handleApplySimulation('HIGH_LAG')}
              className={`px-2 py-1 border border-[#0F380F] font-bold text-[10px] cursor-pointer ${
                simPreset === 'HIGH_LAG' ? 'bg-[#0F380F] text-[#9BBC0F]' : 'bg-[#9BBC0F]'
              }`}
            >
              High Lag (300ms)
            </button>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2 border-t-2 border-[#0F380F]">
          <div className="flex items-center gap-1 text-[10px]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Host-authoritative 5t/s loop</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunBurst}
              disabled={isRunningTest}
              onMouseEnter={() => setFocusIndex(items.indexOf('PROBE'))}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#0F380F] text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors shadow-[2px_2px_0px_#0F380F] ${
                currentItem === 'PROBE'
                  ? 'bg-[#0F380F] text-[#9BBC0F] ring-3 ring-[#0F380F]'
                  : 'bg-[#0F380F] hover:bg-[#306230] text-[#9BBC0F]'
              }`}
            >
              {currentItem === 'PROBE' && <span className="animate-pulse">►</span>}
              {isRunningTest ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>PROBING...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>TEST LATENCY NOW</span>
                  {currentItem === 'PROBE' && (
                    <span className="text-[9px] bg-[#9BBC0F] text-[#0F380F] px-1 font-bold">[A]</span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Gamepad Helper Bar */}
        <div className="text-center text-[9px] font-bold bg-[#8BAC0F] border border-[#0F380F] py-0.5 px-1 flex items-center justify-around">
          <span>🎮 [D-PAD] NAVIGATE</span>
          <span>[A] SELECT</span>
          <span>[B] CLOSE</span>
        </div>
      </div>
    </div>
  );
};
