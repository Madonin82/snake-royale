import { Direction, GameState, LatencyReport, LatencySample } from '../types/game';

type MessageHandler = (data: any) => void;

export class NetworkManager {
  private ws: WebSocket | null = null;
  private roomId: string = '';
  private role: 'p1' | 'p2' | 'spectator' | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnected: boolean = false;

  // Latency Harness state
  private pendingPings: Map<string, number> = new Map();
  private latencySamples: LatencySample[] = [];
  private tickLagSamples: number[] = [];
  private currentLatencyReport: LatencyReport = {
    samples: [],
    medianRtt: 0,
    p95Rtt: 0,
    minRtt: 0,
    maxRtt: 0,
    avgRtt: 0,
    jitterMs: 0,
    packetLossPercent: 0,
    inputTickLagAvg: 0,
    lastTestedAt: Date.now(),
  };

  // Simulated latency for testing
  private simulatedDelayMs: number = 0;
  private simulatedJitterMs: number = 0;

  constructor() {
    // Initialized when connecting
  }

  public connect(roomId: string, requestedRole?: 'p1' | 'p2' | 'spectator'): Promise<boolean> {
    return new Promise((resolve) => {
      this.disconnect();
      this.roomId = roomId.toUpperCase().trim();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.sendRaw({
            type: 'JOIN_ROOM',
            roomId: this.roomId,
            role: requestedRole
          });
          resolve(true);

          // Auto-run 20-burst latency test on room join per spec
          setTimeout(() => {
            this.runLatencyBurst(20);
          }, 500);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleIncomingMessage(data);
          } catch (e) {
            console.error('Failed to parse WS msg:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.warn('WS error (falling back to local/peer):', err);
          this.isConnected = false;
          resolve(false);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
        };
      } catch (err) {
        console.warn('WS initialization error:', err);
        this.isConnected = false;
        resolve(false);
      }
    });
  }

  public disconnect() {
    if (this.ws) {
      try {
        this.sendRaw({ type: 'LEAVE_ROOM' });
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.role = null;
  }

  public getRole(): 'p1' | 'p2' | 'spectator' | null {
    return this.role;
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getLatencyReport(): LatencyReport {
    return this.currentLatencyReport;
  }

  public setSimulatedConditions(delayMs: number, jitterMs: number) {
    this.simulatedDelayMs = delayMs;
    this.simulatedJitterMs = jitterMs;
  }

  public addMessageHandler(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public broadcastState(state: GameState) {
    this.sendWithSimulation({
      type: 'STATE_SYNC',
      state,
      tick: state.tick,
    });
  }

  public sendInput(dir: Direction, currentTick: number) {
    this.sendWithSimulation({
      type: 'INPUT_SYNC',
      dir,
      tick: currentTick,
      clientTime: Date.now(),
    });
  }

  public requestRematch() {
    this.sendRaw({
      type: 'RESTART_MATCH',
    });
  }

  // Latency Probe Trigger
  public runLatencyBurst(count: number = 20) {
    this.latencySamples = [];
    let sent = 0;
    const interval = setInterval(() => {
      if (sent >= count || !this.isConnected) {
        clearInterval(interval);
        return;
      }
      const pingId = 'p_' + Math.random().toString(36).substring(2, 8);
      const t0 = performance.now();
      this.pendingPings.set(pingId, t0);

      this.sendRaw({
        type: 'PING',
        target: 'peer',
        pingId,
        t0: Date.now()
      });
      sent++;
    }, 80);
  }

  public recordTickLag(inputTick: number, currentHostTick: number) {
    const lag = currentHostTick - inputTick;
    if (lag >= 0 && lag < 100) {
      this.tickLagSamples.push(lag);
      if (this.tickLagSamples.length > 50) this.tickLagSamples.shift();
      const avg = this.tickLagSamples.reduce((a, b) => a + b, 0) / this.tickLagSamples.length;
      this.currentLatencyReport.inputTickLagAvg = parseFloat(avg.toFixed(2));
    }
  }

  private sendWithSimulation(data: any) {
    const totalDelay = this.simulatedDelayMs + (Math.random() * this.simulatedJitterMs);
    if (totalDelay > 0) {
      setTimeout(() => {
        this.sendRaw(data);
      }, totalDelay);
    } else {
      this.sendRaw(data);
    }
  }

  private sendRaw(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleIncomingMessage(data: any) {
    switch (data.type) {
      case 'ROOM_JOINED': {
        this.role = data.role;
        break;
      }

      case 'PEER_PING': {
        // Echo back immediately to pinging peer
        this.sendRaw({
          type: 'PEER_PONG',
          pingId: data.pingId,
          t0: data.t0
        });
        break;
      }

      case 'PEER_PONG_ECHO':
      case 'PONG': {
        const pingId = data.pingId;
        const sendTimePerf = this.pendingPings.get(pingId);
        if (sendTimePerf !== undefined) {
          const rtt = performance.now() - sendTimePerf;
          this.pendingPings.delete(pingId);
          this.recordLatencySample(pingId, rtt, !!data.peerMissing);
        }
        break;
      }
    }

    // Forward to all subscribers
    this.messageHandlers.forEach(handler => handler(data));
  }

  private recordLatencySample(pingId: string, rttMs: number, peerMissing: boolean) {
    const sample: LatencySample = {
      pingId,
      rttMs: parseFloat(rttMs.toFixed(1)),
      timestamp: Date.now(),
      peerMissing
    };

    this.latencySamples.push(sample);
    if (this.latencySamples.length > 50) {
      this.latencySamples.shift();
    }

    this.recalculateLatencyStats();
  }

  private recalculateLatencyStats() {
    if (this.latencySamples.length === 0) return;

    const rtts = this.latencySamples.map(s => s.rttMs).sort((a, b) => a - b);
    const sum = rtts.reduce((a, b) => a + b, 0);
    const avg = sum / rtts.length;
    const min = rtts[0];
    const max = rtts[rtts.length - 1];

    // Median (50th percentile)
    const midIdx = Math.floor(rtts.length / 2);
    const median = rtts.length % 2 !== 0 ? rtts[midIdx] : (rtts[midIdx - 1] + rtts[midIdx]) / 2;

    // 95th Percentile
    const p95Idx = Math.min(rtts.length - 1, Math.floor(rtts.length * 0.95));
    const p95 = rtts[p95Idx];

    // Jitter (Average deviation from mean)
    const jitter = rtts.reduce((acc, val) => acc + Math.abs(val - avg), 0) / rtts.length;

    this.currentLatencyReport = {
      samples: [...this.latencySamples],
      medianRtt: parseFloat(median.toFixed(1)),
      p95Rtt: parseFloat(p95.toFixed(1)),
      minRtt: parseFloat(min.toFixed(1)),
      maxRtt: parseFloat(max.toFixed(1)),
      avgRtt: parseFloat(avg.toFixed(1)),
      jitterMs: parseFloat(jitter.toFixed(1)),
      packetLossPercent: 0,
      inputTickLagAvg: this.currentLatencyReport.inputTickLagAvg,
      lastTestedAt: Date.now(),
    };
  }
}

export const networkManager = new NetworkManager();
