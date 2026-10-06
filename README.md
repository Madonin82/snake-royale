# Snake Royale — 2-Player Token Race

A tiny competitive Snake game for two players: race for tokens on a small board, then survive as the arena shrinks. Game Boy 4-shade looks, chess-pace turn-based multiplayer by default, and a built-in latency harness because this started life as a networking testbed that turned into a real game.

**Play it:** https://madonin82.github.io/snake-royale/

## What it does now

- **Turn-based mode (default):** both players secretly pick a direction; the board steps once, simultaneously, when both have locked. Real-time mode (fixed tick rate) is still available in Settings for the brave.
- **Think Time (turn-based):** an optional per-turn countdown (Infinite/5s/10s/15s, default Infinite). When your buffer empties, a big countdown appears in your HUD panel — hit zero and whatever's buffered auto-locks (empty buffer = snake goes straight). Tick sounds and gamepad rumble on each count. Runs alongside the accumulating think clock, which tracks total time per player like a chess clock (turn 0 is free; the clock starts at turn 1).
- **Online rooms with 4-letter codes:** one player hosts, the other joins. Two extra roles on top:
  - **Server / DM mode:** a third client hosts *without playing* — it runs the simulation for two seated players, like a referee.
  - **Spectator mode:** anyone with the room code can watch a live match (watcher count shown in the lobby). No seat, no input.
- **Display names + series score:** set an optional name (saved per browser); the room keeps a running series score (wins/draws) across rematches, and each player's cumulative think time is tracked.
- **Move privacy:** your queued move arrows are visible only to you — opponents see "Hidden" (desktop HUD and mobile cards).
- **Snake visuals:** directional eyes on the head, tapered tail. Same Game Boy palette.
- **Match replay:** every match is recorded turn by turn. After a match, WATCH REPLAY scrubs through it at 2×/5×/10× (thinking pauses edited out). Replays include think-time data.
- **Solo vs AI and local 2P** for same-screen or bot-sparring play.
- **Latency harness:** a NET readout in the HUD with ping/pong probes (median + p95), plus input-to-render tick lag. Note: the ping number measures time-until-the-peer-acks, so on a slow-thinking opponent it reads huge — that's the harness being honest about a different thing than wire latency.

## How a match works

- Two snakes start at opposite ends facing each other, length 3.
- **Round 1** spawns 1 token. Whoever eats it grows +1 segment and scores +1 point; the round advances and spawns that many tokens (round 2 = 2, round 3 = 3, …).
- **Phase 1 (Token Race)** runs for a configurable number of turns (60/90/120). Then **Phase 2 (Shrink):** no new tokens, and every few turns the outer ring of the arena becomes wall (with a telegraphed warning ring first).
- Hit a wall, your own body, or the other snake and you die. Head-on in the same step kills both.
- **Win:** be the last snake alive. If both die together or the match expires: most tokens wins, then longest snake, then draw.
- Arena: 8×8, 12×12, or 16×16 (Settings). Palette is strictly the four Game Boy greens: `#0F380F`, `#306230`, `#8BAC0F`, `#9BBC0F`.

## Controls

- **Steer / lock a move:** Arrow keys, WASD, the on-screen direction pad, or a gamepad (D-pad / left stick). In turn-based mode, one direction press *is* your lock for that turn — choose carefully, there's no undo. 180° reversals are ignored, as classic Snake requires.
- **Player 2 (local 2P):** IJKL.
- The HUD shows each player's lock state and per-turn think time while you wait on each other.

## Multiplayer roles

| Role | How to get it | What it does |
|---|---|---|
| Host (P1) | CREATE ONLINE ROOM | Runs the simulation, plays Seat 1 |
| Joiner (P2) | JOIN ONLINE ROOM + code | Plays Seat 2 |
| Server (DM) | HOST AS SERVER | Runs the simulation, plays nobody |
| Spectator | WATCH A MATCH + code | Watches live; counted in the lobby |

The simulation authority (host or server) publishes game state to `rooms/{roomId}/state/current`; each player writes only their own input doc; spectators register a small presence doc under `rooms/{roomId}/spectators/`. Anonymous Firebase Auth gives every client a UID — no sign-up.

## Run it locally

```bash
npm install
npm run dev
```

The Firebase web config lives in `src/firebase.ts` (it's a public client config, not a secret). To point the game at your own Firebase project: create a project, enable **Anonymous** sign-in under Authentication, create a **Firestore** database, paste your config into `src/firebase.ts`, and deploy the rules from `firestore.rules` (permissive inside rooms for signed-in users — fine for a friends-only game, tighten before anything public-facing). The free Spark plan is plenty; nothing here needs Blaze.

Checks before pushing:

```bash
npm run build        # vite build
npx tsc --noEmit     # actually typechecks — vite build does NOT, and this has bitten us
```

## Deploy

Pushing to `main` triggers the GitHub Pages workflow (`.github/workflows/deploy-pages.yml`), which builds with the `/snake-royale/` base path and publishes to the live link above. The game is a static bundle; it can just as well be hosted on Firebase Hosting or any static host — hosting and the Firebase backend are independent.

## Stack

React + TypeScript + Vite, Tailwind, Firebase (Firestore + Anonymous Auth) for rooms/state/inputs, canvas-rendered board, WebAudio bleeps. No server code, no Cloud Functions.

## License / Notes

Personal project. Personal-use testing; licensing figured out later if it ever ships.
