import { Direction, GameState, LatencyReport, LatencySample } from '../types/game';
import { rtdb, initAuth } from '../firebase';
import { canAcceptState, canAdoptMatch, isCurrentMatch, isNewerSequence, MatchIdentity } from './networkProtocol';
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  push,
} from 'firebase/database';

type MessageHandler = (data: any) => void;

const BRIDGE_SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generateBridgeSecret(): string {
  const secret: string[] = [];
  const randomValues = new Uint8Array(16);
  const maxUnbiasedByte = Math.floor(256 / BRIDGE_SECRET_ALPHABET.length) * BRIDGE_SECRET_ALPHABET.length;

  while (secret.length < 12) {
    crypto.getRandomValues(randomValues);
    for (const value of randomValues) {
      if (value < maxUnbiasedByte) {
        secret.push(BRIDGE_SECRET_ALPHABET[value % BRIDGE_SECRET_ALPHABET.length]);
        if (secret.length === 12) break;
      }
    }
  }

  return secret.join('');
}

export class NetworkManager {
  private roomId: string = '';
  private bridgeSecret: string | null = null;
  private role: 'p1' | 'p2' | 'spectator' | 'server' | null = null;
  private uid: string | null = null;
  private activeMatchId: string | null = null;
  private matchNumber = 0;
  private nextStateRevision = 0;
  private lastReceivedStateRevision = -1;
  private nextInputSequence: Record<'p1' | 'p2', number> = { p1: 0, p2: 0 };
  private lastReceivedInputSequence: Record<'p1' | 'p2', number> = { p1: 0, p2: 0 };
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnected: boolean = false;
  private isRtdbConnected = false;
  private lastConnectionError: string | null = null;
  private lastTransportError: string | null = null;
  private connectionGeneration = 0;
  private rtdbListeners: (() => void)[] = [];

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
  private orderedSimulationQueue: Promise<void> = Promise.resolve();
  private lastRestartTrigger: number = 0;
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
    this.lastConnectionError = null;
    this.lastTransportError = null;
    this.lastRestartTrigger = 0;
    const cleanName = (displayName || '').trim().slice(0, 14);

    try {
      const uid = await initAuth();
      if (!uid) throw new Error('Firebase authentication did not return a user.');
      this.uid = uid;
      const roomRef = ref(rtdb, `rooms/${this.roomId}`);
      const roomSnap = await get(roomRef);
      const existingRoomData = roomSnap.exists() ? roomSnap.val() || {} : null;
      this.matchNumber = Number.isSafeInteger(existingRoomData?.matchNumber) ? existingRoomData.matchNumber : 0;
      this.activeMatchId = typeof existingRoomData?.matchId === 'string' ? existingRoomData.matchId : null;
      this.lastRestartTrigger = Number(existingRoomData?.restartTrigger) || 0;

      let joinedHasP1 = false;
      let joinedHasP2 = false;
      let p1Name: string | null = null;
      let p2Name: string | null = null;
      let series = { p1: 0, p2: 0, draws: 0 };
      let roomStatus = 'lobby';
      let roomSettings = hostSettings;
      let createdRoom = false;

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

        createdRoom = true;
        const settings = hostSettings ? { ...hostSettings } : null;
        if (settings && settings.levelId === undefined) {
          delete settings.levelId;
        }
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
          settings,
          matchNumber: 0,
          matchId: null,
          lastActive: Date.now(),
        });
        if (this.role === 'p1') {
          this.bridgeSecret = generateBridgeSecret();
          await set(ref(rtdb, `bridgeSecrets/${this.roomId}`), this.bridgeSecret);
        }
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

      const currentStateSnap = await get(ref(rtdb, `rooms/${this.roomId}/state/current`));
      if (currentStateSnap.exists()) {
        const currentState = currentStateSnap.val() || {};
        if (
          currentState.matchId === this.activeMatchId &&
          currentState.matchNumber === this.matchNumber &&
          Number.isSafeInteger(currentState.stateRevision)
        ) {
          this.nextStateRevision = Math.max(this.nextStateRevision, currentState.stateRevision);
          if (this.role === 'p1' || this.role === 'server') {
            this.lastReceivedStateRevision = currentState.stateRevision;
          }
        }
      }
      if (this.role === 'p1' || this.role === 'p2') {
        const ownInputSnap = await get(ref(rtdb, `rooms/${this.roomId}/inputs/${this.role}`));
        const ownInput = ownInputSnap.val() || {};
        if (
          ownInput.matchId === this.activeMatchId &&
          ownInput.matchNumber === this.matchNumber &&
          Number.isSafeInteger(ownInput.inputSequence)
        ) {
          this.nextInputSequence[this.role] = Math.max(this.nextInputSequence[this.role], ownInput.inputSequence);
        }
      }

      this.isConnected = true;
      this.startContinuousHeartbeat();

      const connectionRef = ref(rtdb, '.info/connected');
      const unsubConnection = onValue(connectionRef, (snapshot) => {
        this.isRtdbConnected = snapshot.val() === true;
        if (this.isRtdbConnected) this.lastTransportError = null;
      }, (error) => {
        this.isRtdbConnected = false;
        this.reportTransportError('Realtime Database connection', error);
      });
      this.rtdbListeners.push(unsubConnection);

      if (this.role === 'spectator' && this.roomId && uid) {
        const presenceRef = ref(rtdb, `rooms/${this.roomId}/spectators/${uid}`);
        set(presenceRef, { joinedAt: Date.now() }).catch(() => {});
      }

      // Immediately notify local app with complete joined room state
      this.notifyHandlers({
        type: 'ROOM_JOINED',
        roomId: this.roomId,
        role: this.role,
        matchId: this.activeMatchId,
        matchNumber: this.matchNumber,
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

        this.adoptRoomMatch(rData);

        if (rData.restartTrigger && rData.restartTrigger !== this.lastRestartTrigger) {
          this.lastRestartTrigger = rData.restartTrigger;
          this.notifyHandlers({ type: 'RESTART_MATCH', sender: rData.restartSender });
        }
      });
      this.rtdbListeners.push(unsubRoom);

      // 1b. Spectator count
      const specsRef = ref(rtdb, `rooms/${this.roomId}/spectators`);
      const unsubSpecs = onValue(specsRef, (snapshot) => {
        const val = snapshot.val() || {};
        const count = Object.keys(val).length;
        this.notifyHandlers({ type: 'SPECTATORS_CHANGED', count });
      });
      this.rtdbListeners.push(unsubSpecs);

      // 2. Fallback / RTDB state listeners
      const stateRef = ref(rtdb, `rooms/${this.roomId}/state/current`);
      const unsubState = onValue(stateRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const sData = snapshot.val() || {};
        if (sData.state && this.role !== 'p1') {
          this.receiveState({
            type: 'STATE_SYNC',
            matchId: sData.matchId,
            matchNumber: sData.matchNumber,
            stateRevision: sData.stateRevision,
            state: sData.state,
            tick: sData.tick,
            locks: sData.locks,
          });
        }
      });
      this.rtdbListeners.push(unsubState);

      const inputRolesToHear: Array<'p1' | 'p2'> =
        this.role === 'server' ? ['p1', 'p2'] : [this.role === 'p1' ? 'p2' : 'p1'];
      inputRolesToHear.forEach((inputDocName) => {
        const inputRef = ref(rtdb, `rooms/${this.roomId}/inputs/${inputDocName}`);
        let isInitialSnapshot = true;
        const unsubInput = onValue(inputRef, (snapshot) => {
          const initialSnapshot = isInitialSnapshot;
          isInitialSnapshot = false;
          if (!snapshot.exists()) return;
          const iData = snapshot.val() || {};
          if (iData && iData.dir && iData.tick !== undefined) {
            if (initialSnapshot) {
              if (
                iData.matchId === this.activeMatchId &&
                iData.matchNumber === this.matchNumber &&
                Number.isSafeInteger(iData.inputSequence)
              ) {
                this.lastReceivedInputSequence[inputDocName] = Math.max(
                  this.lastReceivedInputSequence[inputDocName],
                  iData.inputSequence,
                );
              }
              return;
            }
            this.receiveInput({
              type: 'INPUT_SYNC',
              ...iData,
              role: inputDocName,
            });
          }
        });
        this.rtdbListeners.push(unsubInput);
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
      this.rtdbListeners.push(unsubPings);

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
      this.rtdbListeners.push(unsubReady);

      // 4. Initialize WebRTC P2P Signaling in the background
      if (this.role === 'p1' || this.role === 'p2') {
        this.setupWebRtcSignaling();
      }

      if (!createdRoom) {
        try {
          const bridgeSecretSnap = await get(ref(rtdb, `bridgeSecrets/${this.roomId}`));
          const bridgeSecret = bridgeSecretSnap.val();
          this.bridgeSecret = typeof bridgeSecret === 'string' ? bridgeSecret : null;
        } catch {
          // Non-host room members are expected to be denied access to this host-only value.
        }
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Firebase room connection failed:', err);
      this.disconnect();
      this.lastConnectionError = message;
      return false;
    }
  }

  private getCurrentMatch(): MatchIdentity | null {
    return this.activeMatchId ? { matchId: this.activeMatchId, matchNumber: this.matchNumber } : null;
  }

  private adoptMatch(match: MatchIdentity): boolean {
    const current = this.getCurrentMatch();
    if (!canAdoptMatch(current, match)) return false;

    const changed = !isCurrentMatch(current, match);
    if (changed) {
      this.activeMatchId = match.matchId;
      this.matchNumber = match.matchNumber;
      this.nextStateRevision = 0;
      this.lastReceivedStateRevision = -1;
      this.nextInputSequence = { p1: 0, p2: 0 };
      this.lastReceivedInputSequence = { p1: 0, p2: 0 };
      this.notifyHandlers({
        type: 'MATCH_START',
        matchId: match.matchId,
        matchNumber: match.matchNumber,
      });
    }
    return true;
  }

  private adoptRoomMatch(roomData: Record<string, any>) {
    if (typeof roomData.matchId !== 'string' || !Number.isSafeInteger(roomData.matchNumber)) return;
    this.adoptMatch({ matchId: roomData.matchId, matchNumber: roomData.matchNumber });
  }

  private receiveState(message: Record<string, any>) {
    if (
      typeof message.matchId !== 'string' ||
      !Number.isSafeInteger(message.matchNumber) ||
      !Number.isSafeInteger(message.stateRevision) ||
      !message.state
    ) return;

    const match = { matchId: message.matchId, matchNumber: message.matchNumber };
    if (!this.adoptMatch(match)) return;
    if (!canAcceptState(this.getCurrentMatch(), this.lastReceivedStateRevision, match, message.stateRevision)) return;

    this.lastReceivedStateRevision = message.stateRevision;
    this.notifyHandlers({ ...message, type: 'STATE_SYNC' });
  }

  private receiveInput(message: Record<string, any>) {
    if (
      (message.role !== 'p1' && message.role !== 'p2') ||
      typeof message.matchId !== 'string' ||
      !Number.isSafeInteger(message.matchNumber) ||
      !Number.isSafeInteger(message.inputSequence)
    ) return;

    const role: 'p1' | 'p2' = message.role;
    const match = { matchId: message.matchId, matchNumber: message.matchNumber };
    if (!isCurrentMatch(this.getCurrentMatch(), match)) return;
    if (!isNewerSequence(message.inputSequence, this.lastReceivedInputSequence[role])) return;

    this.lastReceivedInputSequence[role] = message.inputSequence;
    this.notifyHandlers({ ...message, role, type: 'INPUT_SYNC' });
  }

  private receiveMatchStart(message: Record<string, any>) {
    if (typeof message.matchId !== 'string' || !Number.isSafeInteger(message.matchNumber)) return;
    const match = { matchId: message.matchId, matchNumber: message.matchNumber };
    if (!this.adoptMatch(match)) return;
    if (message.state) {
      this.receiveState({
        ...message,
        type: 'STATE_SYNC',
        stateRevision: Number.isSafeInteger(message.stateRevision) ? message.stateRevision : 0,
      });
    }
  }

  private sendDataChannelMessage(message: object): boolean {
    if (!this.isWebRtcConnected || !this.dataChannel || this.dataChannel.readyState !== 'open') return false;
    try {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.isWebRtcConnected = false;
      this.reportTransportError('WebRTC DataChannel send', error);
      return false;
    }
  }

  private reportTransportError(operation: string, error: unknown) {
    this.lastTransportError = `${operation}: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(this.lastTransportError);
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
        this.dataChannel = this.pc.createDataChannel('snakeGameData', { ordered: true });
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
        this.rtdbListeners.push(unsubAns);

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
        this.rtdbListeners.push(unsubCand);
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
        this.rtdbListeners.push(unsubOffer);

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
        this.rtdbListeners.push(unsubCand);
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
        if (msg.type === 'MATCH_START') {
          this.receiveMatchStart(msg);
        } else if (msg.type === 'STATE_SYNC') {
          this.receiveState(msg);
        } else if (msg.type === 'INPUT_SYNC') {
          this.receiveInput(msg);
        } else if (msg.type) {
          this.notifyHandlers(msg);
        }
      } catch {
        // Ignore parse error
      }
    };
  }

  public disconnect() {
    this.connectionGeneration += 1;
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

    this.rtdbListeners.forEach(unsubscribe => unsubscribe());
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
    this.isRtdbConnected = false;
    this.bridgeSecret = null;
    this.role = null;
    this.uid = null;
    this.roomId = '';
    this.activeMatchId = null;
    this.matchNumber = 0;
    this.nextStateRevision = 0;
    this.lastReceivedStateRevision = -1;
    this.nextInputSequence = { p1: 0, p2: 0 };
    this.lastReceivedInputSequence = { p1: 0, p2: 0 };
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

  public getBridgeSecret(): string | null {
    return this.bridgeSecret;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getLastConnectionError(): string | null {
    return this.lastConnectionError;
  }

  public getLatencyReport(): LatencyReport {
    return this.currentLatencyReport;
  }

  public async getWebRtcStats(): Promise<{
    connected: boolean;
    state: string;
    dataChannelState: string;
    rtdbConnected: boolean;
    lastTransportError: string | null;
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
        dataChannelState: this.dataChannel?.readyState || 'CLOSED',
        rtdbConnected: this.isRtdbConnected,
        lastTransportError: this.lastTransportError,
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
      dataChannelState: this.dataChannel?.readyState || 'CLOSED',
      rtdbConnected: this.isRtdbConnected,
      lastTransportError: this.lastTransportError,
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

  public broadcastMatchStart(initialState: GameState, settings?: any): MatchIdentity | null {
    if (!this.isConnected || (this.role !== 'p1' && this.role !== 'server')) return null;

    const roomId = this.roomId;
    const connectionGeneration = this.connectionGeneration;
    const matchId = crypto.randomUUID();
    const matchNumber = this.matchNumber + 1;
    this.activeMatchId = matchId;
    this.matchNumber = matchNumber;
    this.nextStateRevision = 0;
    this.lastReceivedStateRevision = -1;
    this.nextInputSequence = { p1: 0, p2: 0 };
    this.lastReceivedInputSequence = { p1: 0, p2: 0 };
    const stateRevision = this.nextStateRevision;
    const timestamp = Date.now();

    this.withOrderedSimulation(() => {
      if (connectionGeneration !== this.connectionGeneration) return;
      const payload = {
        type: 'MATCH_START',
        matchId,
        matchNumber,
        stateRevision,
        state: initialState,
        settings,
        status: 'racing',
        timestamp,
      };

      this.sendDataChannelMessage(payload);

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      update(roomRef, {
        status: 'racing',
        matchId,
        matchNumber,
        matchStartTrigger: timestamp,
        settings: settings || null,
        lastActive: timestamp,
        // Reset ready flags so this match's confirms are real false->true
        // transitions. onValue only fires on change — stale `true`s from a
        // previous match would leave both clients stuck at the ready check.
        ready: {
          p1: { ready: false, updatedAt: timestamp },
          p2: { ready: false, updatedAt: timestamp },
        },
      }).catch(error => this.reportTransportError('Writing match start to RTDB', error));

      const stateRef = ref(rtdb, `rooms/${roomId}/state/current`);
      set(stateRef, {
        matchId,
        matchNumber,
        stateRevision,
        state: initialState,
        locks: { p1: false, p2: false },
        tick: initialState.tick,
        updatedAt: timestamp,
      }).catch(error => this.reportTransportError('Writing initial state to RTDB', error));
    });
    return { matchId, matchNumber };
  }

  public broadcastState(state: GameState, locks?: Record<string, boolean>) {
    if (!this.isConnected || (this.role !== 'p1' && this.role !== 'server')) return;
    if (!this.activeMatchId) return;

    const roomId = this.roomId;
    const connectionGeneration = this.connectionGeneration;
    const matchId = this.activeMatchId;
    const matchNumber = this.matchNumber;
    const stateRevision = ++this.nextStateRevision;
    const updatedAt = Date.now();
    this.withOrderedSimulation(() => {
      if (connectionGeneration !== this.connectionGeneration) return;
      const payload = {
        type: 'STATE_SYNC',
        matchId,
        matchNumber,
        stateRevision,
        state,
        locks,
        tick: state.tick,
      };

      // Send via WebRTC P2P DataChannel if connected for ultra-low latency
      this.sendDataChannelMessage(payload);

      // Also persist to RTDB as fallback/sync backup
      const stateRef = ref(rtdb, `rooms/${roomId}/state/current`);
      set(stateRef, {
        matchId,
        matchNumber,
        stateRevision,
        state,
        locks,
        tick: state.tick,
        updatedAt,
      }).catch(error => this.reportTransportError('Writing state to RTDB', error));
    });
  }

  public sendInput(dir: Direction, currentTick: number) {
    if (!this.isConnected || (this.role !== 'p1' && this.role !== 'p2') || !this.activeMatchId) return;

    const roomId = this.roomId;
    const connectionGeneration = this.connectionGeneration;
    const role = this.role;
    const matchId = this.activeMatchId;
    const matchNumber = this.matchNumber;
    const inputSequence = ++this.nextInputSequence[role];
    const clientTime = Date.now();
    const payload = {
      type: 'INPUT_SYNC',
      matchId,
      matchNumber,
      inputSequence,
      role,
      dir,
      tick: currentTick,
      clientTime,
    };

    this.withOrderedSimulation(() => {
      if (connectionGeneration !== this.connectionGeneration) return;
      // Send via WebRTC P2P DataChannel if connected
      this.sendDataChannelMessage(payload);

      // Also persist to RTDB as backup
      const inputRef = ref(rtdb, `rooms/${roomId}/inputs/${role}`);
      set(inputRef, {
        matchId,
        matchNumber,
        inputSequence,
        dir,
        tick: currentTick,
        clientTime,
      }).catch(error => this.reportTransportError('Writing input to RTDB', error));
    });
  }

  public sendReadyConfirm(role: 'p1' | 'p2') {
    if (!this.isConnected || !this.roomId) return;
    const readyRef = ref(rtdb, `rooms/${this.roomId}/ready/${role}`);
    set(readyRef, { ready: true, updatedAt: Date.now() }).catch(() => {});

    this.sendDataChannelMessage({ type: 'READY_CONFIRM', role });
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

  private withOrderedSimulation(fn: () => void) {
    const totalDelay = this.simulatedDelayMs + Math.random() * this.simulatedJitterMs;
    this.orderedSimulationQueue = this.orderedSimulationQueue.then(() => new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          fn();
        } catch (error) {
          this.reportTransportError('Sending ordered network update', error);
        } finally {
          resolve();
        }
      }, totalDelay);
    }));
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
