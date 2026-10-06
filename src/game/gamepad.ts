import { Direction } from '../types/game';

export type GamepadButtonName =
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'LB'
  | 'RB'
  | 'LT'
  | 'RT'
  | 'SELECT'
  | 'START'
  | 'L3'
  | 'R3'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT';

export type GamepadMenuAction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'CONFIRM'
  | 'CANCEL'
  | 'PREV_TAB'
  | 'NEXT_TAB'
  | 'START'
  | 'SELECT';

export interface GamepadInfo {
  connected: boolean;
  id: string;
  index: number;
  slot: 1 | 2;
}

type DirectionCallback = (playerSlot: 1 | 2, dir: Direction) => void;
type MenuCallback = (action: GamepadMenuAction, playerSlot: 1 | 2) => void;
type ButtonCallback = (playerSlot: 1 | 2, button: GamepadButtonName, pressed: boolean) => void;

class GamepadController {
  private activeGamepads: Map<number, GamepadInfo> = new Map();
  private lastDirections: Map<number, Direction | null> = new Map();
  private prevButtonStates: Map<number, boolean[]> = new Map();

  // Menu repeat timers per gamepad index
  private menuRepeatState: Map<
    number,
    {
      dir: GamepadMenuAction | null;
      startTime: number;
      lastRepeatTime: number;
    }
  > = new Map();

  private directionCallback: DirectionCallback | null = null;
  private menuCallback: MenuCallback | null = null;
  private buttonCallback: ButtonCallback | null = null;
  private animFrameId: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.handleConnected);
      window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }

  public setCallback(cb: DirectionCallback) {
    this.directionCallback = cb;
    this.startPolling();
  }

  public setMenuCallback(cb: MenuCallback) {
    this.menuCallback = cb;
    this.startPolling();
  }

  public setButtonCallback(cb: ButtonCallback) {
    this.buttonCallback = cb;
    this.startPolling();
  }

  public getConnectedGamepads(): GamepadInfo[] {
    this.refreshActiveGamepads();
    return Array.from(this.activeGamepads.values());
  }

  public isNintendoSwitchController(): boolean {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        const id = (gp.id || '').toLowerCase();
        if (
          id.includes('switch') ||
          id.includes('nintendo') ||
          id.includes('pro controller') ||
          id.includes('057e') ||
          id.includes('joy-con')
        ) {
          return true;
        }
      }
    }
    return false;
  }

  public rumble(slot: 1 | 2) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const info = Array.from(this.activeGamepads.values()).find(gamepad => gamepad.slot === slot);
    if (!info) return;
    const gamepad = navigator.getGamepads()[info.index];
    const actuator = gamepad?.vibrationActuator;
    if (!actuator) return;

    try {
      actuator.playEffect('dual-rumble', {
        duration: 80,
        strongMagnitude: 0.18,
        weakMagnitude: 0.12,
      }).catch(() => {});
    } catch {
      // Haptics are optional and unsupported on some controllers.
    }
  }

  private startPolling() {
    if (!this.animFrameId && typeof window !== 'undefined') {
      this.poll();
    }
  }

  private handleConnected = (e: GamepadEvent) => {
    this.refreshActiveGamepads();
    this.startPolling();
  };

  private handleDisconnected = (e: GamepadEvent) => {
    this.activeGamepads.delete(e.gamepad.index);
    this.lastDirections.delete(e.gamepad.index);
    this.prevButtonStates.delete(e.gamepad.index);
    this.menuRepeatState.delete(e.gamepad.index);
    this.refreshActiveGamepads();
  };

  private refreshActiveGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return [];
    }

    const rawGamepads = navigator.getGamepads();
    const connectedList: Gamepad[] = [];

    for (let i = 0; i < rawGamepads.length; i++) {
      const gp = rawGamepads[i];
      if (gp && gp.connected) {
        connectedList.push(gp);
      }
    }

    // Assign slot based on position in connected array:
    // First gamepad -> Slot 1 (P1 / Menu)
    // Second gamepad -> Slot 2 (P2 in local 2P)
    // Third or more -> Slot 1
    this.activeGamepads.clear();
    connectedList.forEach((gp, idx) => {
      const slot: 1 | 2 = idx === 1 ? 2 : 1;
      this.activeGamepads.set(gp.index, {
        connected: true,
        id: gp.id,
        index: gp.index,
        slot,
      });
    });

    return connectedList;
  }

  private poll = () => {
    const connectedList = this.refreshActiveGamepads();
    const now = performance.now();

    for (const gp of connectedList) {
      const info = this.activeGamepads.get(gp.index);
      const slot: 1 | 2 = info?.slot || 1;
      this.processGamepadInputs(gp, slot, now);
    }

    this.animFrameId = requestAnimationFrame(this.poll);
  };

  private isButtonPressed(gp: Gamepad, index: number): boolean {
    const btn = gp.buttons[index];
    if (!btn) return false;
    return typeof btn === 'object' ? btn.pressed || btn.value > 0.5 : btn === 1.0;
  }

  private processGamepadInputs(gp: Gamepad, slot: 1 | 2, now: number) {
    const deadzone = 0.35;
    let detectedDir: Direction | null = null;

    // 1. D-Pad buttons standard mapping (12: UP, 13: DOWN, 14: LEFT, 15: RIGHT)
    const dUp = this.isButtonPressed(gp, 12);
    const dDown = this.isButtonPressed(gp, 13);
    const dLeft = this.isButtonPressed(gp, 14);
    const dRight = this.isButtonPressed(gp, 15);

    if (dUp) detectedDir = 'UP';
    else if (dDown) detectedDir = 'DOWN';
    else if (dLeft) detectedDir = 'LEFT';
    else if (dRight) detectedDir = 'RIGHT';

    // 2. Analog Sticks: Left Stick (Axes 0, 1), fallback Right Stick (Axes 2, 3)
    if (!detectedDir && gp.axes.length >= 2) {
      let x = gp.axes[0];
      let y = gp.axes[1];

      // If left stick is neutral, check right stick as fallback
      if (Math.abs(x) <= deadzone && Math.abs(y) <= deadzone && gp.axes.length >= 4) {
        if (Math.abs(gp.axes[2]) > deadzone || Math.abs(gp.axes[3]) > deadzone) {
          x = gp.axes[2];
          y = gp.axes[3];
        }
      }

      if (Math.abs(x) > deadzone || Math.abs(y) > deadzone) {
        if (Math.abs(y) > Math.abs(x)) {
          detectedDir = y < -deadzone ? 'UP' : 'DOWN';
        } else {
          detectedDir = x < -deadzone ? 'LEFT' : 'RIGHT';
        }
      }
    }

    // 3. Fallback for older controllers with POV Hat mapped to axis 4 or 9
    if (!detectedDir && gp.axes.length > 4) {
      const hat = gp.axes[gp.axes.length - 1]; // often axis 9 or last axis
      // Standard hat range: -1 to 1 around 8 directions
      if (typeof hat === 'number' && Math.abs(hat) > 0.05 && Math.abs(hat) <= 1.05) {
        if (hat > -1.05 && hat < -0.85) detectedDir = 'UP';
        else if (hat > 0.05 && hat < 0.25) detectedDir = 'DOWN';
        else if (hat > 0.65 && hat < 0.85) detectedDir = 'LEFT';
        else if (hat > -0.55 && hat < -0.35) detectedDir = 'RIGHT';
      }
    }

    // ----------------------------------------------------
    // IN-GAME DIRECTION HANDLING (Edge / Tap Triggered)
    // ----------------------------------------------------
    const lastDir = this.lastDirections.get(gp.index);
    if (detectedDir && detectedDir !== lastDir) {
      this.lastDirections.set(gp.index, detectedDir);
      if (this.directionCallback) {
        this.directionCallback(slot, detectedDir);
      }
    } else if (!detectedDir) {
      this.lastDirections.set(gp.index, null);
    }

    // ----------------------------------------------------
    // BUTTON EDGE-TRIGGERING (Just Pressed detection)
    // ----------------------------------------------------
    let prevButtons = this.prevButtonStates.get(gp.index);
    if (!prevButtons || prevButtons.length !== gp.buttons.length) {
      prevButtons = new Array(gp.buttons.length).fill(false);
    }

    const currentButtons: boolean[] = [];
    for (let b = 0; b < gp.buttons.length; b++) {
      currentButtons[b] = this.isButtonPressed(gp, b);
    }

    // Helper to check if button was just pressed this frame
    const justPressed = (idx: number) => currentButtons[idx] && !prevButtons![idx];

    // Standard Buttons mapping:
    // 0: A (Confirm / Select)
    // 1: B (Cancel / Back)
    // 2: X (Action / Secondary)
    // 3: Y (Tertiary)
    // 4: LB / L1 (Prev Tab)
    // 5: RB / R1 (Next Tab)
    // 8: Select / Share / Back
    // 9: Start / Options / Menu
    const isSwitch = this.isNintendoSwitchController();

    // Nintendo Switch vs Standard button mapping:
    // Nintendo: Button 0 (South) = B, Button 1 (East) = A, Button 2 (West) = Y, Button 3 (North) = X
    // Standard: Button 0 (South) = A, Button 1 (East) = B, Button 2 (West) = X, Button 3 (North) = Y
    const btnConfirm = isSwitch ? justPressed(1) : justPressed(0);
    const btnCancel = isSwitch ? justPressed(0) : justPressed(1);
    const btnX = isSwitch ? justPressed(3) : justPressed(2);
    const btnY = isSwitch ? justPressed(2) : justPressed(3);

    const btnLB = justPressed(4);
    const btnRB = justPressed(5);
    const btnSelect = justPressed(8);
    const btnStart = justPressed(9);

    if (this.buttonCallback) {
      if (btnConfirm) this.buttonCallback(slot, 'A', true);
      if (btnCancel) this.buttonCallback(slot, 'B', true);
      if (btnX) this.buttonCallback(slot, 'X', true);
      if (btnY) this.buttonCallback(slot, 'Y', true);
      if (btnLB) this.buttonCallback(slot, 'LB', true);
      if (btnRB) this.buttonCallback(slot, 'RB', true);
      if (btnSelect) this.buttonCallback(slot, 'SELECT', true);
      if (btnStart) this.buttonCallback(slot, 'START', true);
      if (justPressed(12)) this.buttonCallback(slot, 'UP', true);
      if (justPressed(13)) this.buttonCallback(slot, 'DOWN', true);
      if (justPressed(14)) this.buttonCallback(slot, 'LEFT', true);
      if (justPressed(15)) this.buttonCallback(slot, 'RIGHT', true);
    }

    // ----------------------------------------------------
    // MENU NAVIGATION ACTIONS WITH AUTO-REPEAT
    // ----------------------------------------------------
    if (this.menuCallback) {
      // 1. Buttons immediate trigger
      if (btnConfirm) this.menuCallback('CONFIRM', slot);
      if (btnCancel) this.menuCallback('CANCEL', slot);
      if (btnStart) this.menuCallback('START', slot);
      if (btnSelect) this.menuCallback('SELECT', slot);
      if (btnLB) this.menuCallback('PREV_TAB', slot);
      if (btnRB) this.menuCallback('NEXT_TAB', slot);

      // 2. Directional repeat (D-pad & Analog stick)
      let currentMenuDir: GamepadMenuAction | null = null;
      if (detectedDir === 'UP') currentMenuDir = 'UP';
      else if (detectedDir === 'DOWN') currentMenuDir = 'DOWN';
      else if (detectedDir === 'LEFT') currentMenuDir = 'LEFT';
      else if (detectedDir === 'RIGHT') currentMenuDir = 'RIGHT';

      let repeatState = this.menuRepeatState.get(gp.index);
      if (!repeatState) {
        repeatState = { dir: null, startTime: 0, lastRepeatTime: 0 };
        this.menuRepeatState.set(gp.index, repeatState);
      }

      if (currentMenuDir) {
        const initialDelayMs = 260; // Initial delay before repeat starts
        const repeatIntervalMs = 130; // Rapid repeat rate while held

        if (repeatState.dir !== currentMenuDir) {
          // New direction pressed: trigger immediately!
          repeatState.dir = currentMenuDir;
          repeatState.startTime = now;
          repeatState.lastRepeatTime = now;
          this.menuCallback(currentMenuDir, slot);
        } else {
          // Direction is held down: check if repeat time has passed
          const elapsed = now - repeatState.startTime;
          if (elapsed > initialDelayMs) {
            const timeSinceLast = now - repeatState.lastRepeatTime;
            if (timeSinceLast >= repeatIntervalMs) {
              repeatState.lastRepeatTime = now;
              this.menuCallback(currentMenuDir, slot);
            }
          }
        }
      } else {
        // Neutral: reset repeat state
        repeatState.dir = null;
        repeatState.startTime = 0;
        repeatState.lastRepeatTime = 0;
      }
    }

    // Store current button states for next frame
    this.prevButtonStates.set(gp.index, currentButtons);
  }

  public cleanup() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.handleConnected);
      window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }
}

export const gamepadController = new GamepadController();
