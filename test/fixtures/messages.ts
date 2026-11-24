// Screens that are driven by a single message rather than a snapshot (the phone has no game
// snapshot in these states). Validated against ServerMessageSchema by a test.
import type { ServerMessage } from '../../src/shared/protocol';
import { P, REQUEST_ID } from './common';

export type MessageFixture = {
  readonly name: string;
  readonly screen: string;
  readonly message: ServerMessage;
};

export const MESSAGE_FIXTURES: readonly MessageFixture[] = [
  {
    name: 'ended-updated',
    screen:
      '"The game was updated. Please start a new game" (saved state failed version/schema check)',
    message: { type: 'gameEnded', reason: 'updated', summary: null },
  },
  {
    name: 'error-not-found',
    screen: '"Game not found" (G-12)',
    message: { type: 'error', code: 'NOT_FOUND' },
  },
  {
    name: 'error-game-full',
    screen: '"Game is full" (G-13)',
    message: { type: 'error', code: 'GAME_FULL' },
  },
  {
    name: 'error-name-taken',
    screen: '"Name taken": owner online (G-14)',
    message: { type: 'error', code: 'NAME_TAKEN' },
  },
  {
    name: 'error-name-taken-reclaimable',
    screen: '"Name taken" + "That\'s me": owner offline (G-14, G-44)',
    message: { type: 'error', code: 'NAME_TAKEN', reclaimPlayerId: P.emma },
  },
  {
    name: 'error-invalid-nickname',
    screen: 'Nickname invalid (G-1)',
    message: { type: 'error', code: 'INVALID_NICKNAME' },
  },
  {
    name: 'error-left',
    screen: '"You left this game" (G-41)',
    message: { type: 'error', code: 'LEFT' },
  },
  {
    name: 'error-removed',
    screen: '"You were removed from this game" (G-43)',
    message: { type: 'error', code: 'REMOVED' },
  },
  {
    name: 'error-replaced',
    screen: '"Opened somewhere else" + Use here (G-18)',
    message: { type: 'error', code: 'REPLACED' },
  },
  {
    name: 'error-outdated-client',
    screen: 'Outdated app → reload once, then "Please refresh"',
    message: { type: 'error', code: 'OUTDATED_CLIENT' },
  },
  {
    name: 'error-server-updating',
    screen: '"Updating…": retry without reload',
    message: { type: 'error', code: 'SERVER_UPDATING' },
  },
  {
    name: 'reclaim-pending',
    screen: '"Waiting for the host…" + Cancel (G-44)',
    message: { type: 'reclaimPending', requestId: REQUEST_ID },
  },
  {
    name: 'reclaim-denied',
    screen: '"That\'s me" was denied (G-44)',
    message: { type: 'reclaimResult', approved: false },
  },
  {
    name: 'error-reclaim-unavailable',
    screen: '"That\'s me" not possible (player came back / already requested)',
    message: { type: 'error', code: 'RECLAIM_UNAVAILABLE', for: 'reclaim' },
  },
];
