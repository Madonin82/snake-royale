import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hud } from './Hud';
import { GameState } from '../types/game';

function createMockGameState(): GameState {
  return {
    tick: 1,
    phase: 'PLANNING',
    turnBased: true,
    snakes: [
      {
        id: 'p1',
        name: 'Player 1',
        isAlive: true,
        body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
        direction: 'RIGHT',
        queuedDirection: null,
        score: 10,
        skillPoints: 2,
        equippedSkill: 'dart',
        pendingSkill: null,
      },
      {
        id: 'p2',
        name: 'Player 2',
        isAlive: true,
        body: [{ x: 5, y: 5 }, { x: 5, y: 6 }],
        direction: 'UP',
        queuedDirection: null,
        score: 5,
        skillPoints: 2,
        equippedSkill: 'rattle',
        pendingSkill: null,
      },
    ],
    tokens: [],
    walls: [],
    rattleWalls: [],
    gridSize: 8,
    ringInset: 0,
    isTelegraphingShrink: false,
    telegraphRingInset: 0,
    activeMatchId: 'test-match',
    matchNumber: 1,
    phaseTimeRemaining: 15000,
    skillsAvailable: 'immediate',
  };
}

test('Hud renders equipped-skill badges as buttons', () => {
  const gameState = createMockGameState();
  const html = renderToStaticMarkup(
    React.createElement(Hud, {
      gameState,
      playMode: 'LOCAL_2P',
      latencyReport: { rtt: 0, ping: 0, jitter: 0, packetLoss: 0, quality: 'EXCELLENT', history: [] },
      onOpenLatencyHarness: () => {},
      onOpenSettings: () => {},
      gamepadCount: 0,
      onSkill: () => {},
      locks: { p1: false, p2: false },
      moveBuffers: { p1: [], p2: [] },
    })
  );

  // Both P1 and P2 skill badges should be buttons
  assert.ok(html.includes('data-testid="skill-badge-p1"'));
  assert.ok(html.includes('data-testid="skill-badge-p2"'));
  assert.ok(html.includes('⚡dart'));
  assert.ok(html.includes('⚡rattle'));
  assert.ok(html.includes('Equipped Skill: DART (2 SP)'));
  assert.ok(html.includes('Equipped Skill: RATTLE (2 SP)'));
  // Button tags rendered
  assert.ok(html.includes('<button'));
});

test('Hud disables skill button when unaffordable, locked, or choosingSkill', () => {
  const gameState = createMockGameState();
  // Unaffordable P1
  gameState.snakes[0].skillPoints = 0;

  const html = renderToStaticMarkup(
    React.createElement(Hud, {
      gameState,
      playMode: 'LOCAL_2P',
      latencyReport: { rtt: 0, ping: 0, jitter: 0, packetLoss: 0, quality: 'EXCELLENT', history: [] },
      onOpenLatencyHarness: () => {},
      onOpenSettings: () => {},
      gamepadCount: 0,
      onSkill: () => {},
      locks: { p1: false, p2: true }, // P2 is locked
      choosingSkillMap: { p1: false, p2: false },
      moveBuffers: { p1: [], p2: [] },
    })
  );

  // P1 button is disabled because unaffordable (0 SP)
  // P2 button is disabled because locked (p2: true)
  assert.ok(html.includes('disabled=""') || html.includes('disabled'));
  assert.ok(html.includes('cursor-not-allowed'));
});

test('Hud disables skill button when choosingSkillMap is active for seat', () => {
  const gameState = createMockGameState();

  const html = renderToStaticMarkup(
    React.createElement(Hud, {
      gameState,
      playMode: 'LOCAL_2P',
      latencyReport: { rtt: 0, ping: 0, jitter: 0, packetLoss: 0, quality: 'EXCELLENT', history: [] },
      onOpenLatencyHarness: () => {},
      onOpenSettings: () => {},
      gamepadCount: 0,
      onSkill: () => {},
      locks: { p1: false, p2: false },
      choosingSkillMap: { p1: true, p2: false },
      moveBuffers: { p1: [], p2: [] },
    })
  );

  assert.ok(html.includes('data-testid="skill-badge-p1"'));
  assert.ok(html.includes('cursor-not-allowed'));
});
