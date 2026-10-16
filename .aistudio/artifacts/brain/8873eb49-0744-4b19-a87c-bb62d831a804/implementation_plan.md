# Local 2P Touch & Controls Unification

This specification updates local modes (simultaneous 2P, 1P, hotseat) to remove split-board touch routing, unify touch gestures around snake handles and card swipe, add long-press locking, card swipe (portrait-only), drag-to-draw-path, gesture disambiguation timers, 2P card-swipe hints, and customizable gesture toggles in Settings.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following design choices have been confirmed during the interactive planning phase:
> - **Player 2 Keyboard Layout**: Arrow keys for directions + Enter for lock (P1 uses WASD + Space). In 1P mode, both Space and Enter lock P1.
> - **Card Swipe Orientation**: Restricted to portrait mode only (since landscape cards are currently clipped/compact).
> - **Gesture Disambiguation Threshold**: 500ms threshold on touch-down to distinguish between tap (pathfind), drag (draw path), and long-press (lock).

- **Confirmed Decision 1**: Remove `splitTouchSeats` entirely. Board touches route by nearest head or snake body handle, never by board half.
- **Confirmed Decision 2**: Swipe lives on the HUD player cards in simultaneous 2P. Board swipe is retired in simultaneous 2P but remains active in 1P and hotseat.
- **Confirmed Decision 3**: Add Settings toggles for each gesture type (Swipe, Tap-to-path, Tap-head lock, Drag, Long-press, Card-swipe) with default ON.

---

## 1. Overview & Core Concept

- **What It Changes**: 
  1. **Removes Split-Board Touch**: Eliminates the top/bottom half-based routing trap in simultaneous 2P.
  2. **Card-Swipe & Board Gestures**: Swipe on your Hud player card steers your snake. Board touches support Tap-to-path, Tap-head lock, Drag-to-draw-path, and Long-press (500ms hold) to lock nearest head.
  3. **Gesture Disambiguation**: 500ms touch-down timer where movement past a threshold cancels the timer into a drag, completion without movement/threshold triggers long-press (lock), and release before 500ms triggers tap (pathfind / tap head lock).
  4. **Prominent 2P Hint**: "SWIPE YOUR CARD, NOT THE BOARD" in a fixed-height container reusing existing hint space.
  5. **Keyboard Seating Layout**: P1 = WASD + Space (left seat), P2 = Arrows + Enter (right seat). In 1P, both Space and Enter lock P1.
  6. **Settings Controls Section**: Toggles for enabling/disabling individual gestures.

- **Target Audience**: Local multiplayer and single-player snake players seeking intuitive, conflict-free touch and keyboard controls on shared screens.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Simultaneous 2P Touch**: Players swipe their respective HUD player cards to step directions, tap the board to pathfind to the nearest snake head, tap a snake head to lock, drag from their snake to draw a custom path, or long-press on the board to lock the nearest snake.
  - **Settings Customization**: Players open Settings -> Controls section and toggle individual gestures on/off.
  - **Hint Banner**: Prominent fixed-height hint in simultaneous 2P guiding players to swipe their cards.
- **Visual Identity & Theme**: Retains the retro GameBoy / arcade shell aesthetic, ensuring high contrast touch targets ($\ge 44\text{px}$) and clear feedback.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1**: Portrait-Only Card Swipe.
  - *Chosen Approach*: Card-swipe is enabled only in portrait orientation.
  - *Why*: Landscape cards are currently compact/clipped; preventing card-swipe in landscape avoids gesture misinterpretation.
- **Decision 2**: 500ms Disambiguation Timer.
  - *Chosen Approach*: Touch-down starts a 500ms timer; movement cancels into drag; expiry triggers lock; early release triggers tap.
  - *Why*: Perfectly separates tapping, drawing paths, and holding to lock without ambiguous overlap.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────┐
│                   Input Dispatcher                     │
│  (Touch / Mouse / Keyboard / Gamepad Events)           │
└────────┬───────────────────┬───────────────────┬───────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐
│  Gesture State   │ │  Card Swipe   │ │ Keyboard Mapper  │
│  (500ms Timer,   │ │  (HUD Card    │ │ (P1: WASD+Space, │
│   Drag/Tap/Hold) │ │   Handlers)   │ │  P2: Arrow+Enter)│
└────────┬─────────┘ └───────┬───────┘ └────────┬─────────┘
         │                   │                  │
         └─────────► ┌───────┴───────┐ ◄────────┘
                     │  Game Engine  │
                     │  & State      │
                     └───────────────┘
```

- **State & Storage Updates**:
  - Add control gesture toggle preferences to app settings state (persisted in localStorage / settings).
  - Update touch event handlers in `GameBoard.tsx`, `Hud.tsx`, `ControlsOverlay.tsx`, and engine helpers.
  - Remove `splitTouchSeats` logic entirely.
  - Implement gesture disambiguation state machine (touchStart, touchMove, touchEnd, timer ref).
