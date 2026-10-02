import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

interface ClientInfo {
  ws: WebSocket;
  roomId?: string;
  role?: 'p1' | 'p2' | 'spectator';
  playerId: string;
}

const clients = new Map<WebSocket, ClientInfo>();
const rooms = new Map<string, {
  p1?: WebSocket;
  p2?: WebSocket;
  spectators: Set<WebSocket>;
  createdAt: number;
  lastActive: number;
}>();

// Simple API status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    roomsCount: rooms.size,
    clientsCount: clients.size,
    timestamp: Date.now()
  });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([id, r]) => ({
    id,
    hasP1: !!r.p1,
    hasP2: !!r.p2,
    spectators: r.spectators.size,
    createdAt: r.createdAt
  }));
  res.json({ rooms: roomList });
});

wss.on('connection', (ws) => {
  const playerId = 'pl_' + Math.random().toString(36).substring(2, 9);
  clients.set(ws, { ws, playerId });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const client = clients.get(ws);
      if (!client) return;

      switch (msg.type) {
        case 'JOIN_ROOM': {
          const roomId = (msg.roomId || '').trim().toUpperCase();
          if (!roomId) return;

          let room = rooms.get(roomId);
          if (!room) {
            room = {
              spectators: new Set(),
              createdAt: Date.now(),
              lastActive: Date.now()
            };
            rooms.set(roomId, room);
          }

          room.lastActive = Date.now();
          client.roomId = roomId;

          // Seat assignment
          if (msg.role === 'p1' || (!room.p1 && !msg.role)) {
            room.p1 = ws;
            client.role = 'p1';
          } else if (msg.role === 'p2' || (!room.p2 && !msg.role)) {
            room.p2 = ws;
            client.role = 'p2';
          } else {
            room.spectators.add(ws);
            client.role = 'spectator';
          }

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            roomId,
            role: client.role,
            playerId: client.playerId,
            hasP1: !!room.p1,
            hasP2: !!room.p2,
            spectatorsCount: room.spectators.size
          }));

          // Notify room members
          const broadcastMsg = JSON.stringify({
            type: 'ROOM_MEMBERS_CHANGED',
            roomId,
            hasP1: !!room.p1,
            hasP2: !!room.p2,
            spectatorsCount: room.spectators.size
          });

          if (room.p1 && room.p1.readyState === WebSocket.OPEN) room.p1.send(broadcastMsg);
          if (room.p2 && room.p2.readyState === WebSocket.OPEN) room.p2.send(broadcastMsg);
          room.spectators.forEach(s => {
            if (s.readyState === WebSocket.OPEN) s.send(broadcastMsg);
          });
          break;
        }

        case 'LEAVE_ROOM': {
          handleLeave(ws);
          break;
        }

        case 'STATE_SYNC': {
          // Host (P1) sending state to P2 and spectators
          const roomId = client.roomId;
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;
          room.lastActive = Date.now();

          const forward = JSON.stringify({
            type: 'STATE_SYNC',
            state: msg.state,
            hostTime: Date.now(),
            tick: msg.tick
          });

          if (room.p2 && room.p2 !== ws && room.p2.readyState === WebSocket.OPEN) {
            room.p2.send(forward);
          }
          room.spectators.forEach(s => {
            if (s !== ws && s.readyState === WebSocket.OPEN) s.send(forward);
          });
          break;
        }

        case 'INPUT_SYNC': {
          // Player input forwarded to host or opponent
          const roomId = client.roomId;
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;
          room.lastActive = Date.now();

          const forward = JSON.stringify({
            type: 'INPUT_SYNC',
            role: client.role,
            dir: msg.dir,
            tick: msg.tick,
            clientTime: msg.clientTime,
            serverReceiveTime: Date.now()
          });

          // If from P2, send to host (P1)
          if (client.role === 'p2' && room.p1 && room.p1.readyState === WebSocket.OPEN) {
            room.p1.send(forward);
          } else if (client.role === 'p1' && room.p2 && room.p2.readyState === WebSocket.OPEN) {
            room.p2.send(forward);
          }
          break;
        }

        case 'PING': {
          // Latency probe echo back to sender or peer
          const now = Date.now();
          if (msg.target === 'peer') {
            const roomId = client.roomId;
            const room = roomId ? rooms.get(roomId) : null;
            if (room) {
              const peer = client.role === 'p1' ? room.p2 : room.p1;
              if (peer && peer.readyState === WebSocket.OPEN) {
                peer.send(JSON.stringify({
                  type: 'PEER_PING',
                  pingId: msg.pingId,
                  t0: msg.t0,
                  fromRole: client.role
                }));
              } else {
                // If no peer, reply with server ack
                ws.send(JSON.stringify({
                  type: 'PONG',
                  pingId: msg.pingId,
                  t0: msg.t0,
                  t1: now,
                  peerMissing: true
                }));
              }
            }
          } else {
            // Direct server ping/pong
            ws.send(JSON.stringify({
              type: 'PONG',
              pingId: msg.pingId,
              t0: msg.t0,
              t1: now
            }));
          }
          break;
        }

        case 'PEER_PONG': {
          const roomId = client.roomId;
          const room = roomId ? rooms.get(roomId) : null;
          if (room) {
            const peer = client.role === 'p1' ? room.p2 : room.p1;
            if (peer && peer.readyState === WebSocket.OPEN) {
              peer.send(JSON.stringify({
                type: 'PEER_PONG_ECHO',
                pingId: msg.pingId,
                t0: msg.t0,
                peerTime: Date.now()
              }));
            }
          }
          break;
        }

        case 'RESTART_MATCH': {
          const roomId = client.roomId;
          const room = roomId ? rooms.get(roomId) : null;
          if (room) {
            const forward = JSON.stringify({
              type: 'RESTART_MATCH',
              sender: client.role
            });
            if (room.p1 && room.p1.readyState === WebSocket.OPEN) room.p1.send(forward);
            if (room.p2 && room.p2.readyState === WebSocket.OPEN) room.p2.send(forward);
            room.spectators.forEach(s => {
              if (s.readyState === WebSocket.OPEN) s.send(forward);
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
    clients.delete(ws);
  });
});

function handleLeave(ws: WebSocket) {
  const client = clients.get(ws);
  if (!client || !client.roomId) return;
  const roomId = client.roomId;
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.p1 === ws) room.p1 = undefined;
  if (room.p2 === ws) room.p2 = undefined;
  room.spectators.delete(ws);

  client.roomId = undefined;
  client.role = undefined;

  if (!room.p1 && !room.p2 && room.spectators.size === 0) {
    rooms.delete(roomId);
  } else {
    const notify = JSON.stringify({
      type: 'ROOM_MEMBERS_CHANGED',
      roomId,
      hasP1: !!room.p1,
      hasP2: !!room.p2,
      spectatorsCount: room.spectators.size
    });
    if (room.p1 && room.p1.readyState === WebSocket.OPEN) room.p1.send(notify);
    if (room.p2 && room.p2.readyState === WebSocket.OPEN) room.p2.send(notify);
    room.spectators.forEach(s => {
      if (s.readyState === WebSocket.OPEN) s.send(notify);
    });
  }
}

// Clean inactive rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms.entries()) {
    if (now - r.lastActive > 15 * 60 * 1000 && !r.p1 && !r.p2) {
      rooms.delete(id);
    }
  }
}, 60 * 1000);

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`🎮 Snake Royale server running at http://${HOST}:${PORT}`);
  });
}

startServer();
