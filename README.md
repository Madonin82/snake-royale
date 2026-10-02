# Snake Royale — 2-Player Token Race

*Working title. A tiny competitive Snake game for two players: race for tokens on a small board, then survive as the arena shrinks. Built as a real-time multiplayer latency testbed that still plays like a game.*

## The Game

Two snakes start at opposite ends of an 8×8 board (64 cells). A token appears on a random empty cell. Both players race to grab it — whoever eats it grows by one segment and scores a point. Then **two** tokens appear, then **three**, then **four**, escalating each round. After 3 minutes the token rain stops and the board starts eating itself: every 10 seconds the outer ring of the arena closes in, battle-royale style, for up to 2 more minutes. Hit a wall, your own body, or the other snake and you're dead. Last snake alive wins; if time fully expires, most tokens wins, then longest snake.

Total match: ~5 minutes max, usually shorter.

## Rules (v1)

- **Board:** 8×8 grid. Wrap-around: **no** — edges are walls (the shrinking ring makes the boundary matter).
- **Start:** Player 1 at the left end facing right, Player 2 at the right end facing left. Both start length 3.
- **Ticks:** The game advances at a fixed tick rate (default 5 ticks/sec — deliberate pace, friendly to a slow "virtual controller" player). Each tick, a snake moves one cell in its current direction.
- **Input:** A player may queue one direction change per tick. Reverse-into-yourself (180° turn) is ignored, as classic Snake requires.
- **Tokens:** Exactly one token on the board at a time in round 1; after it's eaten, the round count rises and that many tokens spawn at once (round 2 = 2 tokens, round 3 = 3, …). Tokens spawn on random cells not occupied by a snake or another token. A token despawns only when eaten.
- **Growth & score:** Eating a token = +1 segment, +1 point.
- **Death:** Head hits a wall, own body, or the other snake's body.
- **Head-on collision:** Both snakes die on the same tick → the match is decided by token score, then by length.
- **Phase 1 — Token Race (3:00):** Tokens spawn and escalate as above.
- **Phase 2 — Shrink (up to 2:00):** No new tokens. Every 10 seconds the outer ring becomes wall (visually darkened first as a 2-second warning if easy; otherwise instant). On 8×8 the ring order is 8→6→4→2, so in practice someone usually dies within the first minute of Phase 2.
- **Win:** Opponent dies and you don't → you win. Both die same tick → token score, then length, then draw. Phase 2 timer expires with both alive → token score, then length, then draw. ("Draw" is an acceptable outcome; show it honestly.)

## Look & Feel

- **Game Boy 4-shade palette only:** `#0F380F` (darkest), `#306230`, `#8BAC0F`, `#9BBC0F` (lightest). Background `#9BBC0F`; Player 1 snake `#0F380F`, Player 2 snake `#306230` with a distinct head marker; tokens in `#0F380F` blinking to `#8BAC0F`; closed shrink ring solid `#0F380F`.
- **Chunky pixels:** Render at low internal resolution and upscale with `image-rendering: pixelated`. Board plus a minimal HUD: both scores, phase timer, and a phase label ("TOKEN RACE" / "SHRINK").
- No gradients, no anti-aliasing, no rounded anything. It should look like it fell out of a cartridge.

## Controls

- **Player 1 (local):** Arrow keys, WASD, and the **Gamepad API** — D-pad or left stick to steer (whichever a controller offers). This player is expected to be a human on a gamepad.
- **Player 2 (remote / virtual):** A second seat that takes direction inputs from the network room (see Multiplayer). The same seat must be drivable by a non-human "virtual controller" — anything that can write direction changes into the room on a few-hundred-millisecond cadence. (This is how an AI opponent plays; it also doubles as the latency test's second endpoint.)
- **Solo test mode:** A simple built-in AI (seek nearest token, avoid walls/self) fills Player 2's seat so one person can play immediately. Keep it dumb — it's a sparring partner, not a boss.

## Multiplayer

Client-only web app (single HTML page, vanilla JS + canvas). **Firebase, no Cloud Functions** (client SDK only; nothing Blaze-gated).

- **Rooms:** Player 1 creates a room and gets a short code; Player 2 joins with the code. Anonymous auth is fine for v1; Email/Password is fine too if already wired.
- **Host-authoritative (v1 choice):** Player 1's browser runs the simulation and publishes game state ~every tick to `rooms/{roomId}/state`. Each player writes only their own input to `rooms/{roomId}/p1Input` / `rooms/{roomId}/p2Input` as `{ dir, tick, clientTime }`. Player 2's client renders the latest published state. Simple, robust enough for 5 ticks/sec, and honest about latency instead of hiding it.
- **Data model (sketch):**
  - `rooms/{roomId}` — `{ createdAt, phase, phaseEndsAt (server timestamp), p1Score, p2Score, winner, status: lobby|racing|shrinking|over }`
  - `rooms/{roomId}/state` — `{ tick, snakes: [...cells], tokens: [...cells], ringInset }`
  - `rooms/{roomId}/p1Input`, `p2Input` — `{ dir, tick, clientTime }`
  - `rooms/{roomId}/pings/{pingId}` — latency probes (below)
- **Firestore rules:** Authenticated (incl. anonymous) users can read/write rooms they are in. Keep v1 permissive inside a room; tighten later.
- Realtime Database is an acceptable swap for Firestore if listener latency measures badly — decide from the latency harness numbers, not vibes.

## Latency Harness (first-class feature)

This game exists partly to measure real multiplayer latency, so the instruments ship in v1, behind a small "NET" readout in the HUD (toggleable):

- **Ping/pong probe:** Either client can write a ping `{ t0: serverTimestamp }`; the other client's listener echoes an ack immediately; the origin measures round-trip. Auto-run a burst of ~20 on room join and on demand via a "Test latency" button.
- **Report:** Median and 95th-percentile round-trip in ms. (Averages lie; show the tail.)
- **Input-to-render estimate:** Player 2 inputs carry the tick they were written for; the HUD shows how many ticks late they typically land. This is the number that decides whether host-authoritative is good enough or lockstep/netcode work is worth doing.
- **Test matrix to sanity-check by hand:** PC↔PC same network; PC↔phone on Wi-Fi; phone on cellular; one tab throttled to "Slow 4G" in DevTools.

## Milestones (suggested order)

1. **M1 — Local game:** Board, two snakes, token escalation, growth, death, 3:00 race + shrink phase, Game Boy palette, keyboard for both seats (P2 = IJKL or similar). Playable same-screen.
2. **M2 — Gamepad + solo AI:** Gamepad API steering for P1; dumb AI fills P2 when solo.
3. **M3 — Online rooms:** Firebase rooms, host-authoritative state, remote P2 seat, lobby with room codes.
4. **M4 — Latency harness:** Ping/pong, NET readout, input-to-render ticks. Decide Firestore vs RTDB from the numbers.
5. **M5 — Virtual controller seat:** Confirm the P2 seat accepts externally-written inputs at a slow cadence (an AI playing over the network), so networked AI-vs-human matches work.

## Open Questions (edit freely)

- Board 8×8 is intentionally brawl-sized; if matches feel too short, 12×12 or 16×16 is a one-line change. Playtest before deciding.
- Shrink warning: 2-second darkened-ring telegraph, or instant? (Telegraph is friendlier; instant is funnier.)
- Tick rate 5/sec is a starting guess — try 4 and 6.
- Should Phase 2 keep leftover tokens on the board as consolation points? (Currently: they stay and can still be eaten; only *new* spawns stop.)
- Rematch button: same room, one click. Assumed yes for v1.

## License / Notes

Personal project. Personal-use testing; licensing figured out later if it ever ships.
