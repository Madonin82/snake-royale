import { Direction, GameState, LatencyReport, LatencySample } from '../types/game';
import { rtdb, initAuth } from '../firebase';
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  push,
  DatabaseReference,
} from 'firebase/database';

type MessageHandler = (data: any) => void;

export class NetworkManager {
  private roomId: string = '';
  private role: 'p1' | 'p2' | 'spectator' | 'server' | null = null;
  private uid: string | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnected: boolean = false;
  private rtdbListeners: { ref: DatabaseReference; callback: (snap: any) => void }[] = [];

  // WebRTC P2P state
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isWebRtcConnected: boolean = false;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private processedCandidateKeys: Set<string> = new Set();

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

  private simulatedDelayMs: number = 0;
  private simulatedJitterMs: number = 0;
  private lastRestartTrigger: number = 0;
  private lastMatchStartTrigger: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private bothPlayersWereReady: boolean = false;

  public async connect(
    roomId: string,
    requestedRole?: 'p1' | 'p2' | 'spectator' | 'server',
    displayName?: string,
    hostSettings?: any
  ): Promise<boolean> {
    this.disconnect();
    this.roomId = roomId.toUpperCase().trim();
    this.bothPlayersWereReady = false;
    const cleanName = (displayName || '').trim().slice(0, 14);

    try {
      const uid = await initAuth();
      this.uid = uid;
      const roomRef = ref(rtdb, `rooms/${this.roomId}`);
      const roomSnap = await get(roomRef);

      let joinedHasP1 = false;
      let joinedHasP2 = false;
      let p1Name: string | null = null;
      let p2Name: string | null = null;
      let series = { p1: 0, p2: 0, draws: 0 };
      let roomStatus = 'lobby';
      let roomSettings = hostSettings;

      if (!roomSnap.exists()) {
        if (requestedRole === 'spectator') {
          this.isConnected = false;
          return false;
        }
        this.role = requestedRole === 'p2' ? 'p2' : requestedRole === 'server' ? 'server' : 'p1';
        joinedHasP1 = this.role === 'p1';
        joinedHasP2 = this.role === 'p2';
        p1Name = this.role === 'p1' && cleanName ? cleanName : null;
        p2Name = this.role === 'p2' && cleanName ? cleanName : null;

        await set(roomRef, {
          createdAt: Date.now(),
          p1Uid: this.role === 'p1' ? uid : null,
          p2Uid: this.role === 'p2' ? uid : null,
          serverUid: this.role === 'server' ? uid : null,
          p1Name,
          p2Name,
          seriesP1: 0,
          seriesP2: 0,
          seriesDraws: 0,
          hasP1: joinedHasP1,
          hasP2: joinedHasP2,
          status: 'lobby',
          settings: hostSettings || null,
          lastActive: Date.now(),
        });
      } else if (requestedRole === 'server') {
        this.role = 'server';
        const data = roomSnap.val() || {};
        joinedHasP1 = !!data.hasP1;
        joinedHasP2 = !!data.hasP2;
        p1Name = data.p1Name || null;
        p2Name = data.p2Name || null;
        series = { p1: data.seriesP1 || 0, p2: data.seriesP2 || 0, draws: data.seriesDraws || 0 };
        roomStatus = data.status || 'lobby';
        roomSettings = data.settings || hostSettings;
        await update(roomRef, { serverUid: uid, lastActive: Date.now() }).catch(() => {});
      } else {
        const data = roomSnap.val() || {};
        series = { p1: data.seriesP1 || 0, p2: data.seriesP2 || 0, draws: data.seriesDraws || 0 };
        roomStatus = data.status || 'lobby';
        roomSettings = data.settings || hostSettings;

        if (requestedRole === 'p1' || (!data.hasP1 && data.p1Uid !== uid)) {
          this.role = 'p1';
          joinedHasP1 = true;
          joinedHasP2 = !!data.hasP2;
          p1Name = cleanName || data.p1Name || null;
          p2Name = data.p2Name || null;
          await update(roomRef, {
            hasP1: true,
            p1Uid: uid,
            lastActive: Date.now(),
            ...(cleanName ? { p1Name: cleanName } : {}),
          });
        } else if (requestedRole === 'p2' || (!data.hasP2 && data.p2Uid !== uid)) {
          this.role = 'p2';
          joinedHasP1 = !!data.hasP1;
          joinedHasP2 = true;
          p1Name = data.p1Name || null;
          p2Name = cleanName || data.p2Name || null;
          await update(roomRef, {
            hasP2: true,
            p2Uid: uid,
            lastActive: Date.now(),
            ...(cleanName ? { p2Name: cleanName } : {}),
          });
        } else {
          this.role = (data.p1Uid === uid) ? 'p1' : (data.p2Uid === uid ? 'p2' : 'spectator');
          joinedHasP1 = !!data.hasP1;
          joinedHasP2 = !!data.hasP2;
          p1Name = data.p1Name || null;
          p2Name = data.p2Name || null;
          if (cleanName && (this.role === 'p1' || this.role === 'p2')) {
            if (this.role === 'p1') p1Name = cleanName;
            if (this.role === 'p2') p2Name = cleanName;
            await update(roomRef, {
              [this.role === 'p1' ? 'p1Name' : 'p2Name']: cleanName,
              lastActive: Date.now(),
            }).catch(() => {});
          }
        }
      }

      this.isConnected = true;
      this.startContinuousHeartbeat();

      if (this.role === 'spectator' && this.roomId && uid) {
        const presenceRef = ref(rtdb, `rooms/${this.roomId}/spectators/${uid}`);
        set(presenceRef, { joinedAt: Date.now() }).catch(() => {});
      }

      // Immediately notify local app with complete joined room state
      this.notifyHandlers({
        type: 'ROOM_JOINED',
        roomId: this.roomId,
        role: this.role,
        hasP1: joinedHasP1,
        hasP2: joinedHasP2,
        p1Name,
        p2Name,
        series,
        status: roomStatus,
        settings: roomSettings,
      });

      if (joinedHasP1 && joinedHasP2) {
        this.bothPlayersWereReady = true;
        this.runLatencyBurst(12, 70);
      }

      // 1. Listen to Room metadata
      const unsubRoom = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const rData = snapshot.val() || {};
        const p1Ready = !!rData.hasP1;
        const p2Ready = !!rData.hasP2;

        this.notifyHandlers({
          type: 'ROOM_MEMBERS_CHANGED',
          roomId: this.roomId,
          hasP1: p1Ready,
          hasP2: p2Ready,
          p1Name: rData.p1Name || null,
          p2Name: rData.p2Name || null,
          status: rData.status || 'lobby',
          settings: rData.settings,
          series: {
            p1: rData.seriesP1 || 0,
            p2: rData.seriesP2 || 0,
            draws: rData.seriesDraws || 0,
          },
          spectatorsCount: 0,
        });

        // Trigger automatic latency probe burst as soon as both players connect
        if (p1Ready && p2Ready && !this.bothPlayersWereReady) {
          this.bothPlayersWereReady = true;
          this.runLatencyBurst(12, 70);
        } else if (!p1Ready || !p2Ready) {
          this.bothPlayersWereReady = false;
        }

        if (rData.settings) {
          this.notifyHandlers({
            type: 'SETTINGS_SYNC',
            settings: rData.settings,
          });
        }

        if (rData.matchStartTrigger && rData.matchStartTrigger !== this.lastMatchStartTrigger) {
          this.lastMatchStartTrigger = rData.matchStartTrigger;
          this.notifyHandlers({
            type: 'MATCH_START',
            status: rData.status,
            settings: rData.settings,
            trigger: rData.matchStartTrigger,
          });
        }

        if (rData.restartTrigger && rData.restartTrigger !== this.lastRestartTrigger) {
          this.lastRestartTrigger = rData.restartTrigger;
          this.notifyHandlers({ type: 'RESTART_MATCH', sender: rData.restartSender });
        }
      });
      this.rtdbListeners.push({ ref: roomRef, callback: unsubRoom });

      // 1b. Spectator count
      const specsRef = ref(rtdb, `rooms/${this.roomId}/spectators`);
      const unsubSpecs = onValue(specsRef, (snapshot) => {
        const val = snapshot.val() || {};
        const count = Object.keys(val).length;
        this.notifyHandlers({ type: 'SPECTATORS_CHANGED', count });
      });
      this.rtdbListeners.push({ ref: specsRef, callback: unsubSpecs });

      // 2. Fallback / RTDB state listeners
      const stateRef = ref(rtdb, `rooms/${this.roomId}/state/current`);
      const unsubState = onValue(stateRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const sData = snapshot.val() || {};
        if (sData.state && this.role !== 'p1') {
          this.notifyHandlers({
            type: 'STATE_SYNC',
            state: sData.state,
            tick: sData.tick,
            locks: sData.locks,
          });
        }
      });
      this.rtdbListeners.push({ ref: stateRef, callback: unsubState });

      const inputRolesToHear: Array<'p1' | 'p2'> =
        this.role === 'server' ? ['p1', 'p2'] : [this.role === 'p1' ? 'p2' : 'p1'];
      inputRolesToHear.forEach((inputDocName) => {
        const inputRef = ref(rtdb, `rooms/${this.roomId}/inputs/${inputDocName}`);
        const unsubInput = onValue(inputRef, (snapshot) => {
          if (!snapshot.exists()) return;
          const iData = snapshot.val() || {};
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
        this.rtdbListeners.push({ ref: inputRef, callback: unsubInput });
      });

      // 3. Pings listener
      const pingsRef = ref(rtdb, `rooms/${this.roomId}/pings`);
      const unsubPings = onValue(pingsRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const pingsObj = snapshot.val() || {};
        Object.keys(pingsObj).forEach(key => {
          const pData = pingsObj[key];
          if (!pData) return;
          if (pData.fromRole !== this.role && !pData.ack) {
            const pTarget = ref(rtdb, `rooms/${this.roomId}/pings/${key}`);
            update(pTarget, { ack: true, t1: Date.now() }).catch(() => {});
          } else if (pData.fromRole === this.role && pData.ack) {
            const sendTimePerf = this.pendingPings.get(pData.pingId);
            if (sendTimePerf !== undefined) {
              const rtt = performance.now() - sendTimePerf;
              this.pendingPings.delete(pData.pingId);
              this.recordLatencySample(pData.pingId, rtt, false);
            }
          }
        });
      });
      this.rtdbListeners.push({ ref: pingsRef, callback: unsubPings });

      // 3b. Ready sync listener
      const readyRef = ref(rtdb, `rooms/${this.roomId}/ready`);
      const unsubReady = onValue(readyRef, (snapshot) => {
        const val = snapshot.val() || {};
        this.notifyHandlers({
          type: 'READY_SYNC',
          ready: {
            p1: !!val.p1?.ready,
            p2: !!val.p2?.ready,
          },
        });
      });
      this.rtdbListeners.push({ ref: readyRef, callback: unsubReady });

      // 4. Initialize WebRTC P2P Signaling in the background
      if (this.role === 'p1' || this.role === 'p2') {
        this.setupWebRtcSignaling();
      }

      return true;
    } catch (err) {
      console.warn('Firebase RTDB / WebRTC connection error:', err);
      this.isConnected = false;
      return false;
    }
  }

  // WebRTC P2P Signaling & Data Channel Setup
  private setupWebRtcSignaling() {
    try {
      const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
      this.pc = new RTCPeerConnection({ iceServers });

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.roomId && this.role) {
          const candRef = ref(rtdb, `rooms/${this.roomId}/signals/${this.role}Candidates`);
          push(candRef, event.candidate.toJSON()).catch(() => {});
        }
      };

      if (this.role === 'p1') {
        // P1 (Host) creates data channel and offer
        this.dataChannel = this.pc.createDataChannel('snakeGameData', { ordered: false });
        this.setupDataChannel();

        this.pc.createOffer().then(offer => {
          if (!this.pc) return;
          this.pc.setLocalDescription(offer);
          set(ref(rtdb, `rooms/${this.roomId}/signals/offer`), offer).catch(() => {});
        }).catch(() => {});

        // Listen for P2 answer
        const ansRef = ref(rtdb, `rooms/${this.roomId}/signals/answer`);
        const unsubAns = onValue(ansRef, async (snap) => {
          const ans = snap.val();
          if (ans && this.pc && !this.pc.remoteDescription) {
            try {
              await this.pc.setRemoteDescription(new RTCSessionDescription(ans));
              this.drainPendingCandidates();
            } catch {}
          }
        });
        this.rtdbListeners.push({ ref: ansRef, callback: unsubAns });

        // Listen for P2 ICE candidates
        const candRef = ref(rtdb, `rooms/${this.roomId}/signals/p2Candidates`);
        const unsubCand = onValue(candRef, snap => {
          const cands = snap.val();
          if (cands) {
            Object.entries(cands).forEach(([key, c]: [string, any]) => {
              if (this.processedCandidateKeys.has(key)) return;
              this.processedCandidateKeys.add(key);
              if (this.pc && this.pc.remoteDescription) {
                this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              } else {
                this.pendingRemoteCandidates.push(c);
              }
            });
          }
        });
        this.rtdbListeners.push({ ref: candRef, callback: unsubCand });
      } else if (this.role === 'p2') {
        // P2 (Joiner) listens for data channel and offer
        this.pc.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };

        const offerRef = ref(rtdb, `rooms/${this.roomId}/signals/offer`);
        const unsubOffer = onValue(offerRef, async (snap) => {
          const offer = snap.val();
          if (offer && this.pc && !this.pc.remoteDescription) {
            try {
              await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              set(ref(rtdb, `rooms/${this.roomId}/signals/answer`), answer).catch(() => {});
              this.drainPendingCandidates();
            } catch {}
          }
        });
        this.rtdbListeners.push({ ref: offerRef, callback: unsubOffer });

        // Listen for P1 ICE candidates
        const candRef = ref(rtdb, `rooms/${this.roomId}/signals/p1Candidates`);
        const unsubCand = onValue(candRef, snap => {
          const cands = snap.val();
          if (cands) {
            Object.entries(cands).forEach(([key, c]: [string, any]) => {
              if (this.processedCandidateKeys.has(key)) return;
              this.processedCandidateKeys.add(key);
              if (this.pc && this.pc.remoteDescription) {
                this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              } else {
                this.pendingRemoteCandidates.push(c);
              }
            });
          }
        });
        this.rtdbListeners.push({ ref: candRef, callback: unsubCand });
      }
    } catch (err) {
      console.warn('WebRTC signaling initialization warning:', err);
    }
  }

  private drainPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.pendingRemoteCandidates.length > 0) {
      const c = this.pendingRemoteCandidates.shift();
      if (c) {
        this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    }
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.isWebRtcConnected = true;
      console.log('WebRTC P2P DataChannel Connected!');
      // Immediately run an ultra-fast burst over the new direct WebRTC connection
      this.runLatencyBurst(12, 60);
    };

    this.dataChannel.onclose = () => {
      this.isWebRtcConnected = false;
      console.log('WebRTC P2P DataChannel Closed');
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PING') {
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
              this.dataChannel.send(JSON.stringify({
                type: 'PONG',
                pingId: msg.pingId,
              }));
            } catch {}
          }
          return;
        }
        if (msg.type === 'PONG') {
          const sendTimePerf = this.pendingPings.get(msg.pingId);
          if (sendTimePerf !== undefined) {
            const rtt = performance.now() - sendTimePerf;
            this.pendingPings.delete(msg.pingId);
            this.recordLatencySample(msg.pingId, rtt, false);
          }
          return;
        }
        if (msg.type) {
          this.notifyHandlers(msg);
        }
      } catch {
        // Ignore parse error
      }
    };
  }

  public disconnect() {
    this.stopContinuousHeartbeat();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.isWebRtcConnected = false;
    this.pendingRemoteCandidates = [];
    this.processedCandidateKeys.clear();

    this.rtdbListeners.forEach(item => {
      off(item.ref, 'value', item.callback);
    });
    this.rtdbListeners = [];

    if (this.roomId && this.role) {
      const roomRef = ref(rtdb, `rooms/${this.roomId}`);
      const updatePayload: Record<string, boolean> = {};
      if (this.role === 'p1') updatePayload.hasP1 = false;
      if (this.role === 'p2') updatePayload.hasP2 = false;

      if (this.role === 'spectator' && this.uid) {
        remove(ref(rtdb, `rooms/${this.roomId}/spectators/${this.uid}`)).catch(() => {});
      } else if (Object.keys(updatePayload).length > 0) {
        update(roomRef, updatePayload).catch(() => {});
      }
    }

    this.isConnected = false;
    this.role = null;
    this.uid = null;
    this.roomId = '';
  }

  public getRole(): 'p1' | 'p2' | 'spectator' | 'server' | null {
    return this.role;
  }

  // BUGFIX 8: one-shot re-read of room membership, used by the guest right
  // after connect() so the lobby is correct even if a ROOM_MEMBERS_CHANGED
  // notification was missed. Returns null when the room can't be read.
  public async getRoomMembers(): Promise<{
    hasP1: boolean;
    hasP2: boolean;
    p1Name: string | null;
    p2Name: string | null;
    series: { p1: number; p2: number; draws: number };
  } | null> {
    if (!this.roomId) return null;
    try {
      const snap = await get(ref(rtdb, `rooms/${this.roomId}`));
      if (!snap.exists()) return null;
      const d = snap.val() || {};
      return {
        hasP1: !!d.hasP1,
        hasP2: !!d.hasP2,
        p1Name: d.p1Name || null,
        p2Name: d.p2Name || null,
        series: {
          p1: d.seriesP1 || 0,
          p2: d.seriesP2 || 0,
          draws: d.seriesDraws || 0,
        },
      };
    } catch {
      return null;
    }
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

  public async getWebRtcStats(): Promise<{
    connected: boolean;
    state: string;
    bytesSent: number;
    bytesReceived: number;
    packetsLost: number;
    packetsSent: number;
    packetLossPercent: number;
  }> {
    if (!this.pc) {
      return {
        connected: this.isWebRtcConnected,
        state: 'DISCONNECTED',
        bytesSent: 0,
        bytesReceived: 0,
        packetsLost: 0,
        packetsSent: 0,
        packetLossPercent: 0,
      };
    }

    let bytesSent = 0;
    let bytesReceived = 0;
    let packetsLost = 0;
    let packetsSent = 0;

    try {
      const stats = await this.pc.getStats();
      stats.forEach(report => {
        if (report.type === 'outbound-rtp') {
          bytesSent += report.bytesSent || 0;
          packetsSent += report.packetsSent || 0;
        }
        if (report.type === 'inbound-rtp') {
          bytesReceived += report.bytesReceived || 0;
          packetsLost += report.packetsLost || 0;
          packetsSent += report.packetsSent || 0;
        }
      });
    } catch {
      // Ignore if stats fail
    }

    const totalPackets = packetsSent + packetsLost;
    const packetLossPercent = totalPackets > 0 ? parseFloat(((packetsLost / totalPackets) * 100).toFixed(1)) : 0;

    return {
      connected: this.isWebRtcConnected,
      state: this.pc.connectionState || 'UNKNOWN',
      bytesSent,
      bytesReceived,
      packetsLost,
      packetsSent,
      packetLossPercent,
    };
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

  public updateRoomSettings(settings: any) {
    if (!this.isConnected || !this.roomId || (this.role !== 'p1' && this.role !== 'server')) return;
    const roomRef = ref(rtdb, `rooms/${this.roomId}`);
    update(roomRef, {
      settings,
      lastActive: Date.now(),
    }).catch(() => {});

    if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({
          type: 'SETTINGS_SYNC',
          settings,
        }));
      } catch {}
    }
  }

  public broadcastMatchStart(initialState: GameState, settings?: any) {
    if (!this.isConnected || (this.role !== 'p1' && this.role !== 'server')) return;

    this.withSimulation(() => {
      const payload = {
        type: 'MATCH_START',
        state: initialState,
        settings,
        status: 'racing',
        timestamp: Date.now(),
      };

      if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify(payload));
        } catch {}
      }

      const roomRef = ref(rtdb, `rooms/${this.roomId}`);
      update(roomRef, {
        status: 'racing',
        matchStartTrigger: Date.now(),
        settings: settings || null,
        lastActive: Date.now(),
      }).catch(() => {});

      const stateRef = ref(rtdb, `rooms/${this.roomId}/state/current`);
      set(stateRef, {
        state: initialState,
        locks: { p1: false, p2: false },
        tick: initialState.tick,
        updatedAt: Date.now(),
      }).catch(() => {});
    });
  }

  public broadcastState(state: GameState, locks?: { p1: boolean; p2: boolean }) {
    if (!this.isConnected || (this.role !== 'p1' && this.role !== 'server')) return;

    this.withSimulation(() => {
      const payload = {
        type: 'STATE_SYNC',
        state,
        locks,
        tick: state.tick,
      };

      // Send via WebRTC P2P DataChannel if connected for ultra-low latency
      if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify(payload));
      }

      // Also persist to RTDB as fallback/sync backup
      const stateRef = ref(rtdb, `rooms/${this.roomId}/state/current`);
      set(stateRef, {
        state,
        locks,
        tick: state.tick,
        updatedAt: Date.now(),
      }).catch(() => {});
    });
  }

  public sendInput(dir: Direction, currentTick: number) {
    if (!this.isConnected || !this.role) return;

    this.withSimulation(() => {
      const payload = {
        type: 'INPUT_SYNC',
        role: this.role,
        dir,
        tick: currentTick,
        clientTime: Date.now(),
      };

      // Send via WebRTC P2P DataChannel if connected
      if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify(payload));
      }

      // Also persist to RTDB as backup
      const inputRef = ref(rtdb, `rooms/${this.roomId}/inputs/${this.role}`);
      set(inputRef, {
        dir,
        tick: currentTick,
        clientTime: Date.now(),
      }).catch(() => {});
    });
  }

  public sendReadyConfirm(role: 'p1' | 'p2') {
    if (!this.isConnected || !this.roomId) return;
    const readyRef = ref(rtdb, `rooms/${this.roomId}/ready/${role}`);
    set(readyRef, { ready: true, updatedAt: Date.now() }).catch(() => {});

    if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({
          type: 'READY_CONFIRM',
          role,
        }));
      } catch {}
    }
  }

  public requestRematch() {
    if (!this.isConnected || !this.roomId) return;
    const roomRef = ref(rtdb, `rooms/${this.roomId}`);
    update(roomRef, {
      restartTrigger: Date.now(),
      restartSender: this.role,
      status: 'racing',
    }).catch(() => {});
  }

  public recordSeriesResult(winner: 'p1' | 'p2' | 'DRAW') {
    if (!this.isConnected || !this.roomId || (this.role !== 'p1' && this.role !== 'server')) return;
    const roomRef = ref(rtdb, `rooms/${this.roomId}`);
    get(roomRef).then((snap) => {
      const data = snap.val() || {};
      const curP1 = data.seriesP1 || 0;
      const curP2 = data.seriesP2 || 0;
      const curDraws = data.seriesDraws || 0;
      update(roomRef, {
        seriesP1: curP1 + (winner === 'p1' ? 1 : 0),
        seriesP2: curP2 + (winner === 'p2' ? 1 : 0),
        seriesDraws: curDraws + (winner === 'DRAW' ? 1 : 0),
        lastActive: Date.now(),
      }).catch(() => {});
    }).catch(() => {});
  }

  public sendPing() {
    if (!this.isConnected || !this.roomId) return;
    const pingId = 'p_' + Math.random().toString(36).substring(2, 8);
    const t0 = performance.now();
    this.pendingPings.set(pingId, t0);

    // Prune stale pending pings
    if (this.pendingPings.size > 80) {
      this.pendingPings.clear();
      this.pendingPings.set(pingId, t0);
    }

    // Direct WebRTC ping if available for accurate real-time P2P measurement
    if (this.isWebRtcConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({
          type: 'PING',
          pingId,
          fromRole: this.role,
        }));
        return;
      } catch {}
    }

    // RTDB ping fallback
    const pingsRef = ref(rtdb, `rooms/${this.roomId}/pings`);
    push(pingsRef, {
      pingId,
      t0: Date.now(),
      fromRole: this.role,
      ack: false,
    }).catch(() => {});
  }

  public startContinuousHeartbeat(intervalMs: number = 2000) {
    this.stopContinuousHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.roomId) {
        this.sendPing();
      }
    }, intervalMs);
  }

  public stopContinuousHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public runLatencyBurst(count: number = 15, intervalMs: number = 75) {
    if (!this.isConnected || !this.roomId) return;
    let sent = 0;
    const interval = setInterval(() => {
      if (sent >= count || !this.isConnected) {
        clearInterval(interval);
        return;
      }
      this.sendPing();
      sent++;
    }, intervalMs);
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
