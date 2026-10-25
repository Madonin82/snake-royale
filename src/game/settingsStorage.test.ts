import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResetSettings,
  getDeviceGestureDefaults,
  getStoredUserSettings,
  resolveInitialSettings,
  saveStoredUserSettings,
  SETTINGS_STORAGE_KEY,
} from './settingsStorage';
import { DEFAULT_SETTINGS } from './engine';
import { GameSettings } from '../types/game';

class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

test('device gesture defaults: touch device turns tap-to-path OFF, swipe ON', () => {
  const touchDefaults = getDeviceGestureDefaults(true);
  assert.equal(touchDefaults.gestureSwipeEnabled, true);
  assert.equal(touchDefaults.gestureTapPathEnabled, false);
  assert.equal(touchDefaults.gestureTapHeadLockEnabled, true);
  assert.equal(touchDefaults.gestureDragEnabled, true);
  assert.equal(touchDefaults.gestureLongPressEnabled, true);
  assert.equal(touchDefaults.gestureCardSwipeEnabled, true);
});

test('device gesture defaults: non-touch device turns tap-to-path ON, swipe ON', () => {
  const desktopDefaults = getDeviceGestureDefaults(false);
  assert.equal(desktopDefaults.gestureSwipeEnabled, true);
  assert.equal(desktopDefaults.gestureTapPathEnabled, true);
  assert.equal(desktopDefaults.gestureTapHeadLockEnabled, true);
  assert.equal(desktopDefaults.gestureDragEnabled, true);
  assert.equal(desktopDefaults.gestureLongPressEnabled, true);
  assert.equal(desktopDefaults.gestureCardSwipeEnabled, true);
});

test('fresh install without stored settings merges device defaults over DEFAULT_SETTINGS', () => {
  const storage = new MockStorage();
  const settings = getStoredUserSettings(storage);
  // In Node environment without window.matchMedia, isTouch is false
  assert.equal(settings.gestureTapPathEnabled, true);
  assert.equal(settings.gestureSwipeEnabled, true);
  assert.equal(settings.gridSize, DEFAULT_SETTINGS.gridSize);
});

test('persists settings to localStorage and reloads them', () => {
  const storage = new MockStorage();
  const modified: GameSettings = {
    ...DEFAULT_SETTINGS,
    gestureSwipeEnabled: false,
    gestureTapPathEnabled: false,
    gridSize: 16,
  };

  saveStoredUserSettings(modified, storage);
  assert.ok(storage.getItem(SETTINGS_STORAGE_KEY));

  const loaded = getStoredUserSettings(storage);
  assert.equal(loaded.gestureSwipeEnabled, false);
  assert.equal(loaded.gestureTapPathEnabled, false);
  assert.equal(loaded.gridSize, 16);
  // Future/other defaults are preserved
  assert.equal(loaded.gestureDragEnabled, true);
});

test('recovering from invalid JSON falls back gracefully', () => {
  const storage = new MockStorage();
  storage.setItem(SETTINGS_STORAGE_KEY, 'invalid json {[');
  const loaded = getStoredUserSettings(storage);
  assert.equal(loaded.gestureSwipeEnabled, true);
});

test('playtest-only fields in stored settings are stripped on load (editor leak, 2026-10-24)', () => {
  const storage = new MockStorage();
  // Simulate storage poisoned by a pre-fix playtest mount: the level's
  // bot AI rode along into the player's stored settings.
  const poisoned: GameSettings = {
    ...DEFAULT_SETTINGS,
    gridSize: 12,
    botDifficulty: 'HARD',
    levelId: 'editor-level-1',
    levelName: 'My Test Level',
    campaignAiStyles: { p2: 'OPPORTUNIST' },
    campaignAiDifficulties: { p2: 'EASY' },
  };
  saveStoredUserSettings(poisoned, storage);

  const loaded = getStoredUserSettings(storage);
  // The level's identity and per-seat bot overrides are gone, so a
  // solo game can no longer silently run the level's bot.
  assert.equal(loaded.levelId, undefined);
  assert.equal(loaded.levelName, undefined);
  assert.equal(loaded.campaignAiStyles, undefined);
  assert.equal(loaded.campaignAiDifficulties, undefined);
  // Legitimate solo choices survive the strip.
  assert.equal(loaded.gridSize, 12);
  assert.equal(loaded.botDifficulty, 'HARD');
  // And no level AI style survives: the player's own aiStyle is
  // unset here, so at game start the registry default (Constrictor
  // at HARD) applies — not the level's OPPORTUNIST.
  assert.equal(loaded.aiStyle, undefined);
});

test('precedence: campaign/level settings > stored user settings > DEFAULT_SETTINGS', () => {
  const storage = new MockStorage();
  const userSettings: GameSettings = {
    ...DEFAULT_SETTINGS,
    gridSize: 12,
    raceTurns: 60,
    gestureTapPathEnabled: false,
  };
  saveStoredUserSettings(userSettings, storage);

  // Campaign level overrides gridSize to 16, but does not specify gestureTapPathEnabled
  const campaignSettings: Partial<GameSettings> = {
    gridSize: 16,
  };

  const resolved = resolveInitialSettings(campaignSettings as GameSettings, storage);
  // Campaign wins for defined settings:
  assert.equal(resolved.gridSize, 16);
  // Stored user settings fill in what the level didn't specify:
  assert.equal(resolved.raceTurns, 60);
  assert.equal(resolved.gestureTapPathEnabled, false);
});

test('buildResetSettings matches a fresh install plus clears for fields DEFAULT_SETTINGS does not carry', () => {
  const reset = buildResetSettings();
  // Fresh-install values (Node env: non-touch device defaults).
  assert.equal(reset.gridSize, 8);
  assert.equal(reset.raceTurns, 60);
  assert.equal(reset.shrinkEveryTurns, 8);
  assert.equal(reset.shrinkEnabled, true);
  assert.equal(reset.botDifficulty, 'MEDIUM');
  assert.equal(reset.skillsAvailable, 'after_race');
  assert.equal(reset.soundEnabled, true);
  assert.equal(reset.crtFilterEnabled, false);
  // Fields DEFAULT_SETTINGS does not carry must be explicitly cleared,
  // or a merge-based reset would keep a leaked level bot/identity.
  assert.equal(reset.aiStyle, undefined);
  assert.equal(reset.campaignAiStyles, undefined);
  assert.equal(reset.campaignAiDifficulties, undefined);
  assert.equal(reset.levelId, undefined);
  assert.equal(reset.levelName, undefined);
});

test('buildResetSettings merged over poisoned settings clears every leaked field', () => {
  const poisoned: GameSettings = {
    ...DEFAULT_SETTINGS,
    gridSize: 12,
    raceTurns: 30,
    shrinkEveryTurns: 1,
    shrinkEnabled: false,
    botDifficulty: 'EASY',
    aiStyle: 'OPPORTUNIST',
    levelId: 'level-1',
    levelName: 'Leaked Level',
    campaignAiStyles: { p2: 'GREEDY' },
    campaignAiDifficulties: { p2: 'HARD' },
  };
  // This is the merge App.handleUpdateSettings performs.
  const merged = { ...poisoned, ...buildResetSettings() };
  assert.equal(merged.gridSize, 8);
  assert.equal(merged.raceTurns, 60);
  assert.equal(merged.shrinkEveryTurns, 8);
  assert.equal(merged.shrinkEnabled, true);
  assert.equal(merged.botDifficulty, 'MEDIUM');
  assert.equal(merged.aiStyle, undefined);
  assert.equal(merged.levelId, undefined);
  assert.equal(merged.levelName, undefined);
  assert.equal(merged.campaignAiStyles, undefined);
  assert.equal(merged.campaignAiDifficulties, undefined);
});
