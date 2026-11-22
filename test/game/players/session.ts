// A tiny scripted game for 3A tests: holds the state and the clock, applies every event through
// `apply()` (so invariants, the saved-state schema and every outgoing message are checked after
// EACH step), and offers readable helpers for sockets and messages.
import type { GameState } from '../../../src/game/stateSchema';
import type { Effect, EngineClientMessage, EngineEvent } from '../../../src/game/types';
import { PROTOCOL_VERSION } from '../../../src/shared/constants';
import type { ConnId, PlayerId, ServerMessage } from '../../../src/shared/protocol';
import { T0, connId } from '../../fixtures/common';
import { fakeTokenHash } from '../../fixtures/states';
import { apply } from '../helpers';

/** Deterministic random source (a small LCG) — ids differ between calls but repeat between runs. */
function seeded(seed: number): () => number {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

export type Session = ReturnType<typeof session>;

export function session(initial: GameState, start = T0 + 20_000) {
  let state = initial;
  let now = start;
  let effects: readonly Effect[] = [];
  const random = seeded(start);

  const event = (e: EngineEvent): readonly Effect[] => {
    const result = apply(state, e, { now, random });
    state = result.state;
    effects = result.effects;
    return effects;
  };

  return {
    get state() {
      return state;
    },
    get effects() {
      return effects;
    },
    get now() {
      return now;
    },
    wait(ms: number) {
      now += ms;
    },
    event,
    open: (conn: ConnId) =>
      event({ kind: 'connectionOpened', connId: conn, protocolVersion: PROTOCOL_VERSION }),
    close: (conn: ConnId) => event({ kind: 'connectionClosed', connId: conn }),
    send: (conn: ConnId, msg: EngineClientMessage) => event({ kind: 'message', from: conn, msg }),
    /** Open a socket and say hello with token #n (plus a nickname/preset to join as new). */
    hello(
      conn: ConnId,
      token: number,
      join?: { nickname: string; presetId?: 'fox' | 'cat' | 'owl' | 'frog' },
    ) {
      event({ kind: 'connectionOpened', connId: conn, protocolVersion: PROTOCOL_VERSION });
      return event({
        kind: 'message',
        from: conn,
        msg: {
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          tokenHash: fakeTokenHash(token),
          ...(join && { nickname: join.nickname, presetId: join.presetId ?? 'fox' }),
        },
      });
    },
    deadline: () => event({ kind: 'deadline' }),
    /** The player whose saved token is #n. */
    playerWithToken(token: number): PlayerId | undefined {
      return Object.entries(state.players).find(
        ([, p]) => p.tokenHash === fakeTokenHash(token),
      )?.[0] as PlayerId | undefined;
    },
  };
}

export const conn = (name: string): ConnId => connId(`conn-${name}`);

// ── Reading effects ─────────────────────────────────────────────────────────

/** Messages sent directly to one socket. */
export function sentTo(effects: readonly Effect[], to: ConnId): ServerMessage[] {
  return effects.flatMap((e) => (e.kind === 'send' && e.connId === to ? [e.message] : []));
}

export function broadcasts(effects: readonly Effect[]): ServerMessage[] {
  return effects.flatMap((e) => (e.kind === 'broadcast' ? [e.message] : []));
}

export function toHostMessages(effects: readonly Effect[]): ServerMessage[] {
  return effects.flatMap((e) => (e.kind === 'sendToHost' ? [e.message] : []));
}

export function closed(effects: readonly Effect[]): ConnId[] {
  return effects.flatMap((e) => (e.kind === 'close' ? [e.connId] : []));
}

export function types(messages: readonly ServerMessage[]): string[] {
  return messages.map((m) => m.type);
}

/** The single message of a type sent to a socket (fails loudly if missing). */
export function only<T extends ServerMessage['type']>(
  messages: readonly ServerMessage[],
  type: T,
): Extract<ServerMessage, { type: T }> {
  const found = messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  if (found.length !== 1) throw new Error(`expected one ${type}, got ${types(messages).join()}`);
  // Safe: checked just above.
  return found[0] as Extract<ServerMessage, { type: T }>;
}
