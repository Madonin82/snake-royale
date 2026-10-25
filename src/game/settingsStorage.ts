import { GameSettings } from '../types/game';
import { DEFAULT_SETTINGS } from './engine';

export const SETTINGS_STORAGE_KEY = 'snake-royale-settings';

/**
 * Detects whether the current environment has a coarse pointer (touch device).
 * Safely handles SSR/testing environments where window or matchMedia is undefined.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Returns gesture defaults based on the device type:
 * - Touch device: Swipe ON, Tap-to-path OFF, Tap-head lock ON, Drag ON, Long-press ON, Card-swipe ON
 * - Non-touch: Swipe ON, Tap-to-path ON, Tap-head lock ON, Drag ON, Long-press ON, Card-swipe ON
 */
export function getDeviceGestureDefaults(isTouch: boolean): Pick<
  GameSettings,
  | 'gestureSwipeEnabled'
  | 'gestureTapPathEnabled'
  | 'gestureTapHeadLockEnabled'
  | 'gestureDragEnabled'
  | 'gestureLongPressEnabled'
  | 'gestureCardSwipeEnabled'
> {
  return {
    gestureSwipeEnabled: true,
    gestureTapPathEnabled: !isTouch,
    gestureTapHeadLockEnabled: true,
    gestureDragEnabled: true,
    gestureLongPressEnabled: true,
    gestureCardSwipeEnabled: true,
  };
}

/**
 * Reads stored user settings from localStorage (if any), merged over DEFAULT_SETTINGS
 * and initial per-device gesture defaults for fresh installs.
 */
export function getStoredUserSettings(storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): GameSettings {
  const isTouch = isTouchDevice();
  const deviceDefaults = getDeviceGestureDefaults(isTouch);
  const baseDefaults: GameSettings = {
    ...DEFAULT_SETTINGS,
    ...deviceDefaults,
  };

  if (!storage) {
    return baseDefaults;
  }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return baseDefaults;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      // Playtest-only fields are never user preferences: they can only
      // have arrived here from a level-editor playtest mount (before
      // the save guard in App.tsx), and left in place they would make
      // a solo game run a level's bot AI instead of the player's own
      // settings. Strip them on load so already-poisoned storage
      // self-cleans the next time the main game mounts; the save
      // effect then writes the cleaned settings back. Deliberately
      // NOT stripped: gridSize, raceTurns, shrink, botDifficulty,
      // aiStyle, skillsAvailable — those are also legitimate solo
      // choices, so a level's values there cannot be told apart from
      // the player's and must be reset by hand once, in Settings.
      const {
        levelId: _levelId,
        levelName: _levelName,
        campaignAiStyles: _campaignAiStyles,
        campaignAiDifficulties: _campaignAiDifficulties,
        ...userSettings
      } = parsed as GameSettings;
      return {
        ...baseDefaults,
        ...userSettings,
      };
    }
  } catch {
    // If parse fails or localStorage access fails (e.g. private mode), fall back to defaults
  }

  return baseDefaults;
}

/**
 * Resolves active settings honoring the precedence:
 * campaign/level settings > stored user settings > DEFAULT_SETTINGS (with device defaults).
 */
export function resolveInitialSettings(
  initialCampaignSettings: GameSettings | null | undefined,
  storage?: Storage
): GameSettings {
  const userSettings = getStoredUserSettings(storage);
  if (!initialCampaignSettings) {
    return userSettings;
  }
  return {
    ...userSettings,
    ...initialCampaignSettings,
  };
}

/**
 * Saves current settings to localStorage.
 */
export function saveStoredUserSettings(
  settings: GameSettings,
  storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined
): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode / quota errors
  }
}

/**
 * Builds a full factory reset: exactly what a fresh install loads
 * (DEFAULT_SETTINGS overlaid with per-device gesture defaults), plus
 * explicit clears for the optional fields DEFAULT_SETTINGS does not
 * carry. Those fields (bot AI style, campaign AI maps, level id/name)
 * can only have arrived from a level-editor playtest or campaign
 * mount, so a merge-based reset must clear them — otherwise spreading
 * this over current settings would silently keep a leaked bot style
 * or level behind. Callers apply it with onUpdateSettings, which
 * merges it over current settings and persists it via the save
 * effect; JSON drops the undefined-valued keys on save.
 */
export function buildResetSettings(): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...getDeviceGestureDefaults(isTouchDevice()),
    aiStyle: undefined,
    campaignAiStyles: undefined,
    campaignAiDifficulties: undefined,
    levelId: undefined,
    levelName: undefined,
  };
}
