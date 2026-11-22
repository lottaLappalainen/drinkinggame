// Engine routing and the checks common to every message. Game rules themselves are Phase 3;
// reaching a handler stub shows up as a NotImplementedError naming the owning phase.
import { describe, expect, it } from 'vitest';
import { MESSAGE_RULES, applyEvent } from '../../src/game/engine';
import { newPlayerId, randomId } from '../../src/game/ids';
import { NotImplementedError } from '../../src/game/notImplemented';
import type { Ctx, EngineClientMessage, EngineEvent } from '../../src/game/types';
import type { ClientMessageType, ConnId } from '../../src/shared/protocol';
import { C, P, T0, connId } from '../fixtures/common';
import { lobbyState, lobbyWithReclaimState, questionState } from '../fixtures/states';
import { apply } from './helpers';

const ctx: Ctx = { now: T0 + 20_000, random: () => 0.5 };

function message(from: ConnId, msg: EngineClientMessage): EngineEvent {
  return { kind: 'message', from, msg };
}

const notAllowed = (to: ConnId, forType: ClientMessageType) => [
  { kind: 'send', connId: to, message: { type: 'error', code: 'NOT_ALLOWED', for: forType } },
];

describe('timeSync', () => {
  it('answers with the server time and changes nothing (no storage write)', () => {
    const state = lobbyState();
    const result = apply(state, message(C.aino, { type: 'timeSync', t0: 123 }), ctx);
    expect(result.effects).toEqual([
      { kind: 'send', connId: C.aino, message: { type: 'timeSync', t0: 123, serverTime: ctx.now } },
    ]);
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
  });
});

describe('common checks reject before any handler runs — errors name the request', () => {
  it('an unregistered connection', () => {
    const ghost = connId('ghost');
    const result = apply(lobbyState(), message(ghost, { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed(ghost, 'leave'));
    expect(result.changed).toBe(false);
  });

  it('a host-only action from a non-host', () => {
    const result = apply(lobbyState(), message(C.aino, { type: 'start' }), ctx);
    expect(result.effects).toEqual(notAllowed(C.aino, 'start'));
  });

  it('an action in the wrong phase (updateProfile outside the lobby, G-5)', () => {
    const result = apply(
      questionState(),
      message(C.aino, { type: 'updateProfile', presetId: 'cat' }),
      ctx,
    );
    expect(result.effects).toEqual(notAllowed(C.aino, 'updateProfile'));
  });

  it('a player action from a replaced (non-current) socket (G-18)', () => {
    const state = lobbyState();
    const old = connId('conn-old');
    state.connections[old] = { playerId: P.aino, protocolVersion: 1 };
    const result = apply(state, message(old, { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed(old, 'leave'));
  });

  it('a player action from an anonymous connection', () => {
    const state = lobbyState();
    const anon = connId('conn-anon');
    state.connections[anon] = { protocolVersion: 1 };
    const result = apply(state, message(anon, { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed(anon, 'leave'));
  });

  it('cancelReclaim from a connection that has no request', () => {
    const result = apply(lobbyState(), message(C.aino, { type: 'cancelReclaim' }), ctx);
    expect(result.effects).toEqual(notAllowed(C.aino, 'cancelReclaim'));
  });

  it('"That\'s me" from a connection that is already a player (G-44)', () => {
    const msg = {
      type: 'reclaim',
      playerId: P.sanna,
      tokenHash: 'a'.repeat(64),
      nickname: 'Sanna',
      presetId: 'owl',
    } as const;
    expect(apply(lobbyState(), message(C.aino, msg), ctx).effects).toEqual(
      notAllowed(C.aino, 'reclaim'),
    );
    // …and from a requester who already has a pending request.
    expect(apply(lobbyWithReclaimState(), message(C.requester, msg), ctx).effects).toEqual(
      notAllowed(C.requester, 'reclaim'),
    );
  });
});

describe('late or repeated round actions are ignored silently (G-39)', () => {
  const submit = (roundId: number) =>
    message(C.aino, { type: 'submit', roundId, ranking: [P.mikko] });

  it('a stale roundId (double tap)', () => {
    const result = apply(questionState(), submit(99), ctx);
    expect(result.effects).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("a submit for the current round arriving after time's up (now RESULTS)", () => {
    const state = questionState();
    state.phase = 'RESULTS'; // the round closed while the answer was in flight
    const result = applyEvent(state, submit(1), ctx);
    expect(result.effects).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('a double-tapped Next arriving after the next round started', () => {
    const state = questionState(); // round 1 is running; Next for round 1 is late
    const result = apply(state, message(C.mikko, { type: 'advance', roundId: 1 }), ctx);
    expect(result.effects).toEqual([]);
  });
});

describe('routing reaches the right handler (stubs until Phase 3)', () => {
  const expectStub = (fn: () => unknown, owner: string) => {
    expect(fn).toThrow(NotImplementedError);
    expect(fn).toThrow(owner);
  };

  it('host start → rounds (3B)', () => {
    expectStub(
      () => applyEvent(lobbyState(), message(C.mikko, { type: 'start' }), ctx),
      'Phase 3B',
    );
  });

  it('submit for the current round → rounds (3B)', () => {
    expectStub(
      () =>
        applyEvent(
          questionState(),
          message(C.aino, { type: 'submit', roundId: 1, ranking: [P.mikko] }),
          ctx,
        ),
      'Phase 3B',
    );
  });

  it('hello → players (3A)', () => {
    expectStub(
      () =>
        applyEvent(
          lobbyState(),
          message(C.aino, { type: 'hello', protocolVersion: 1, tokenHash: 'f'.repeat(64) }),
          ctx,
        ),
      'Phase 3A',
    );
  });

  it('"That\'s me" from an anonymous connection → players (3A)', () => {
    const state = lobbyState();
    const anon = connId('conn-anon');
    state.connections[anon] = { protocolVersion: 1 };
    expectStub(
      () =>
        applyEvent(
          state,
          message(anon, {
            type: 'reclaim',
            playerId: P.sanna,
            tokenHash: 'a'.repeat(64),
            nickname: 'Sanna',
            presetId: 'owl',
          }),
          ctx,
        ),
      'Phase 3A',
    );
  });

  it('cancelReclaim from the requester → players (3A)', () => {
    expectStub(
      () =>
        applyEvent(lobbyWithReclaimState(), message(C.requester, { type: 'cancelReclaim' }), ctx),
      'Phase 3A',
    );
  });

  it('connection, rebuild, photoStored and deadline events → handlers', () => {
    const c = connId('c');
    expectStub(
      () =>
        applyEvent(lobbyState(), { kind: 'connectionOpened', connId: c, protocolVersion: 1 }, ctx),
      'connectionOpened',
    );
    expectStub(
      () => applyEvent(lobbyState(), { kind: 'connectionClosed', connId: c }, ctx),
      'connectionClosed',
    );
    // A rebuild is handled like any event (its effects are kept), not silently dropped.
    expectStub(() => applyEvent(lobbyState(), { kind: 'rebuild', sockets: [] }, ctx), 'rebuild');
    expectStub(
      () => applyEvent(lobbyState(), { kind: 'photoStored', playerId: P.aino }, ctx),
      'Phase 3A',
    );
    expectStub(() => applyEvent(lobbyState(), { kind: 'deadline' }, ctx), 'Phase 3B');
  });
});

describe('the engine never mutates its input', () => {
  it('state is deep-copied before handlers run', () => {
    const state = lobbyState();
    const before = JSON.stringify(state);
    try {
      applyEvent(state, message(C.mikko, { type: 'start' }), ctx);
    } catch {
      // stub throws — irrelevant here
    }
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('MESSAGE_RULES', () => {
  it('host-only actions are exactly the host controls (G-20, G-21, G-43, G-44, G-45, G-46)', () => {
    const hostOnly = Object.entries(MESSAGE_RULES)
      .filter(([, rule]) => 'hostOnly' in rule && rule.hostOnly)
      .map(([type]) => type)
      .sort();
    expect(hostOnly).toEqual([
      'advance',
      'answerReclaim',
      'end',
      'removePlayer',
      'setGameLength',
      'start',
    ]);
  });
});

describe('randomId', () => {
  it('makes 12-char base62 ids from the injected random source', () => {
    let i = 0;
    const id = randomId(() => (i++ % 62) / 62);
    expect(id).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(id).toBe('0123456789AB');
  });

  it('stays 12 characters even if the source returns exactly 1', () => {
    expect(randomId(() => 1)).toBe('z'.repeat(12));
    expect(newPlayerId(() => 0)).toBe('0'.repeat(12));
  });
});
