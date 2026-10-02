import { Direction } from '../types/game';

export interface GamepadState {
  connected: boolean;
  id: string;
  index: number;
}

type DirectionCallback = (playerIndex: 1 | 2, dir: Direction) => void;

class GamepadController {
  private activeGamepads: Map<number, GamepadState> = new Map();
  private lastDirections: Map<number, Direction | null> = new Map();
  private listenerCallback: DirectionCallback | null = null;
  private animFrameId: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.handleConnected);
      window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    }
  }

  public setCallback(cb: DirectionCallback) {
    this.listenerCallback = cb;
    if (!this.animFrameId) {
      this.poll();
    }
  }

  public getConnectedGamepads(): GamepadState[] {
    return Array.from(this.activeGamepads.values());
  }

  private handleConnected = (e: GamepadEvent) => {
    this.activeGamepads.set(e.gamepad.index, {
      connected: true,
      id: e.gamepad.id,
      index: e.gamepad.index
    });
    if (!this.animFrameId) {
      this.poll();
    }
  };

  private handleDisconnected = (e: GamepadEvent) => {
    this.activeGamepads.delete(e.gamepad.index);
    this.lastDirections.delete(e.gamepad.index);
  };

  private poll = () => {
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected) {
          this.processGamepad(gp);
        }
      }
    }
    this.animFrameId = requestAnimationFrame(this.poll);
  };

  private processGamepad(gp: Gamepad) {
    let detectedDir: Direction | null = null;
    const deadzone = 0.45;

    // 1. D-Pad buttons standard mapping
    // Button 12: Up, 13: Down, 14: Left, 15: Right
    if (gp.buttons[12]?.pressed) detectedDir = 'UP';
    else if (gp.buttons[13]?.pressed) detectedDir = 'DOWN';
    else if (gp.buttons[14]?.pressed) detectedDir = 'LEFT';
    else if (gp.buttons[15]?.pressed) detectedDir = 'RIGHT';

    // 2. Left Analog Stick (Axes 0 = X, 1 = Y)
    if (!detectedDir && gp.axes.length >= 2) {
      const x = gp.axes[0];
      const y = gp.axes[1];

      if (Math.abs(x) > deadzone || Math.abs(y) > deadzone) {
        if (Math.abs(y) > Math.abs(x)) {
          detectedDir = y < -deadzone ? 'UP' : 'DOWN';
        } else {
          detectedDir = x < -deadzone ? 'LEFT' : 'RIGHT';
        }
      }
    }

    const lastDir = this.lastDirections.get(gp.index);
    if (detectedDir && detectedDir !== lastDir) {
      this.lastDirections.set(gp.index, detectedDir);
      if (this.listenerCallback) {
        // Gamepad index 0 defaults to Player 1, index 1 to Player 2
        const playerSlot = gp.index === 1 ? 2 : 1;
        this.listenerCallback(playerSlot, detectedDir);
      }
    } else if (!detectedDir) {
      this.lastDirections.set(gp.index, null);
    }
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
