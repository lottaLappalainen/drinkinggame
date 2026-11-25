// Incoming WebSocket data is `unknown` (Phase 1 review): check it's a string, JSON.parse in
// try/catch, then narrow by `type`. The client can't run the Valibot schemas (they stay out of the
// bundle — lint-enforced), so this checks the envelope; the server is the one that validates
// everything strictly and only ever sends schema-valid messages (every outgoing message is parsed
// with ServerMessageSchema in the engine tests).
import type { ServerMessage, ServerMessageType } from '../../shared/protocol';

/** Every server message type. `satisfies Record<…>` makes a missing or unknown type a compile error. */
const SERVER_MESSAGE_TYPES = {
  welcome: true,
  playerJoined: true,
  playerLeft: true,
  playerConnection: true,
  playerUpdated: true,
  settingsChanged: true,
  leftGame: true,
  roundStarted: true,
  playerReady: true,
  roundResults: true,
  hostChanged: true,
  paused: true,
  resumed: true,
  reclaimPending: true,
  reclaimRequested: true,
  reclaimClosed: true,
  reclaimResult: true,
  gameEnded: true,
  newGame: true,
  timeSync: true,
  error: true,
} as const satisfies Record<ServerMessageType, true>;

function isServerMessageType(value: unknown): value is ServerMessageType {
  return typeof value === 'string' && Object.hasOwn(SERVER_MESSAGE_TYPES, value);
}

/** A server message, or null for anything else (binary frames, garbage, unknown types). */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  return isServerMessageType(type) ? (parsed as ServerMessage) : null;
}
