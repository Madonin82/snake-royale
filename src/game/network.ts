import { Direction, GameState, LatencyReport, LatencySample } from '../types/game';
import { db, initAuth, auth } from '../firebase';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';

type MessageHandler = (data: any) => void;

export class NetworkManager {
  private roomId: string = '';
  private role: 'p1' | 'p2' | 'spectator' | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnected: boolean = false;
  private firestoreUnsubs: Unsubscribe[] = [];

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

  public async connect(roomId: string, requestedRole?: 'p1' | 'p2' | 'spectator'): Promise<boolean> {
    this.disconnect();
    this.roomId = roomId.toUpperCase().trim();

    try {
      const uid = await initAuth();
      const roomRef = doc(db, 'rooms', this.roomId);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        // Create new room as Host (P1)
        this.role = requestedRole === 'p2' ? 'p2' : 'p1';
        await setDoc(roomRef, {
          createdAt: Date.now(),
          p1Uid: this.role === 'p1' ? uid : null,
          p2Uid: this.role === 'p2' ? uid : null,
          hasP1: this.role === 'p1',
          hasP2: this.role === 'p2',
          status: 'lobby',
          lastActive: Date.now(),
        });
      } else {
        const data = roomSnap.data();
        if (requestedRole === 'p1' || (!data.hasP1 && data.p1Uid !== uid)) {
          this.role = 'p1';
          await updateDoc(roomRef, { hasP1: true, p1Uid: uid, lastActive: Date.now() });
        } else if (requestedRole === 'p2' || (!data.hasP2 && data.p2Uid !== uid)) {
          this.role = 'p2';
          await updateDoc(roomRef, { hasP2: true, p2Uid: uid, lastActive: Date.now() });
        } else {
          this.role = (data.p1Uid === uid) ? 'p1' : (data.p2Uid === uid ? 'p2' : 'spectator');
        }
      }

      this.isConnected = true;

      // Broadcast room joined to local subscribers
      this.notifyHandlers({
        type: 'ROOM_JOINED',
        roomId: this.roomId,
        role: this.role,
        hasP1: true,
        hasP2: false,
      });

      // 1. Listen to Room document (membership, restart)
      const unsubRoom = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const rData = snapshot.data();
        this.notifyHandlers({
          type: 'ROOM_MEMBERS_CHANGED',
          roomId: this.roomId,
          hasP1: !!rData.hasP1,
          hasP2: !!rData.hasP2,
          spectatorsCount: 0,
        });

        if (rData.restartTrigger && rData.restartTrigger !== this.lastRestartTrigger) {
          this.lastRestartTrigger = rData.restartTrigger;
          this.notifyHandlers({ type: 'RESTART_MATCH', sender: rData.restartSender });
        }
      });
      this.firestoreUnsubs.push(unsubRoom);

      // 2. Listen to Game State (Client/Spectator listens to Host)
      const stateRef = doc(db, 'rooms', this.roomId, 'state', 'current');
      const unsubState = onSnapshot(stateRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const sData = snapshot.data();
        if (sData.state && this.role !== 'p1') {
          this.notifyHandlers({
            type: 'STATE_SYNC',
            state: sData.state,
            tick: sData.tick,
          });
        }
      });
      this.firestoreUnsubs.push(unsubState);

      // 3. Listen to Inputs (Host listens to P2; Client listens to P1)
      const inputDocName = this.role === 'p1' ? 'p2' : 'p1';
      const inputRef = doc(db, 'rooms', this.roomId, 'inputs', inputDocName);
      const unsubInputs = onSnapshot(inputRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const iData = snapshot.data();
        if (iData && iData.dir && iData.tick !== undefined) {
          this.notifyHandlers({
            type: 'INPUT_SYNC',
            role: inputDocName,
            dir: iData.dir,
            tick: iData.tick,
            clientTime: iData.clientTime,
          });
        }
      });
      this.firestoreUnsubs.push(unsubInputs);

      // 4. Listen to Pings (for Latency Harness)
      const pingsCol = collection(db, 'rooms', this.roomId, 'pings');
      const unsubPings = onSnapshot(pingsCol, (snapshot) => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added' || change.type === 'modified') {
            const pData = change.doc.data();
            // If incoming ping from opponent and not yet acked
            if (pData.fromRole !== this.role && !pData.ack) {
              // Echo back ack immediately
              updateDoc(change.doc.ref, {
                ack: true,
                t1: Date.now(),
              }).catch(() => {});
            } else if (pData.fromRole === this.role && pData.ack) {
              // Received ack from peer
              const sendTimePerf = this.pendingPings.get(pData.pingId);
              if (sendTimePerf !== undefined) {
                const rtt = performance.now() - sendTimePerf;
                this.pendingPings.delete(pData.pingId);
                this.recordLatencySample(pData.pingId, rtt, false);
              }
            }
          }
        });
      });
      this.firestoreUnsubs.push(unsubPings);

      // Auto-run 20-burst latency test on room join per spec
      setTimeout(() => {
        this.runLatencyBurst(20);
      }, 600);

      return true;
    } catch (err) {
      console.warn('Firebase connection error:', err);
      this.isConnected = false;
      return false;
    }
  }

  private lastRestartTrigger: number = 0;

  public disconnect() {
    this.firestoreUnsubs.forEach(unsub => unsub());
    this.firestoreUnsubs = [];

    if (this.roomId && this.role) {
      const roomRef = doc(db, 'rooms', this.roomId);
      const updatePayload: Record<string, boolean> = {};
      if (this.role === 'p1') updatePayload.hasP1 = false;
      if (this.role === 'p2') updatePayload.hasP2 = false;

      updateDoc(roomRef, updatePayload).catch(() => {});
    }

    this.isConnected = false;
    this.role = null;
    this.roomId = '';
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

  private notifyHandlers(data: any) {
    this.messageHandlers.forEach(h => h(data));
  }

  public broadcastState(state: GameState) {
    if (!this.isConnected || this.role !== 'p1') return;

    this.withSimulation(() => {
      const stateRef = doc(db, 'rooms', this.roomId, 'state', 'current');
      setDoc(stateRef, {
        state,
        tick: state.tick,
        updatedAt: Date.now(),
      }).catch(() => {});
    });
  }

  public sendInput(dir: Direction, currentTick: number) {
    if (!this.isConnected || !this.role) return;

    this.withSimulation(() => {
      const inputRef = doc(db, 'rooms', this.roomId, 'inputs', this.role!);
      setDoc(inputRef, {
        dir,
        tick: currentTick,
        clientTime: Date.now(),
      }).catch(() => {});
    });
  }

  public requestRematch() {
    if (!this.isConnected || !this.roomId) return;
    const roomRef = doc(db, 'rooms', this.roomId);
    updateDoc(roomRef, {
      restartTrigger: Date.now(),
      restartSender: this.role,
      status: 'racing',
    }).catch(() => {});
  }

  // Latency Probe Trigger (auto 20-burst on join and on demand)
  public runLatencyBurst(count: number = 20) {
    if (!this.isConnected || !this.roomId) return;
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

      const pingsCol = collection(db, 'rooms', this.roomId, 'pings');
      addDoc(pingsCol, {
        pingId,
        t0: Date.now(),
        fromRole: this.role,
        ack: false,
      }).catch(() => {});

      sent++;
    }, 100);
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

  private withSimulation(fn: () => void) {
    const totalDelay = this.simulatedDelayMs + (Math.random() * this.simulatedJitterMs);
    if (totalDelay > 0) {
      setTimeout(fn, totalDelay);
    } else {
      fn();
    }
  }

  private recordLatencySample(pingId: string, rttMs: number, peerMissing: boolean) {
    const sample: LatencySample = {
      pingId,
      rttMs: parseFloat(rttMs.toFixed(1)),
      timestamp: Date.now(),
      peerMissing,
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

    const midIdx = Math.floor(rtts.length / 2);
    const median = rtts.length % 2 !== 0 ? rtts[midIdx] : (rtts[midIdx - 1] + rtts[midIdx]) / 2;

    const p95Idx = Math.min(rtts.length - 1, Math.floor(rtts.length * 0.95));
    const p95 = rtts[p95Idx];

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
