// Engine routing and the checks common to every message. Game rules themselves are Phase 3;
// reaching a handler stub shows up as a NotImplementedError naming the owning phase.
import { describe, expect, it } from 'vitest';
import { MESSAGE_RULES, applyEvent } from '../../src/game/engine';
import { randomId } from '../../src/game/ids';
import { NotImplementedError } from '../../src/game/notImplemented';
import type { Ctx, EngineClientMessage, EngineEvent } from '../../src/game/types';
import { P, T0 } from '../fixtures/common';
import { lobbyState, lobbyWithReclaimState, questionState } from '../fixtures/states';

const ctx: Ctx = { now: T0 + 20_000, random: () => 0.5 };

function message(from: string, msg: EngineClientMessage): EngineEvent {
  return { kind: 'message', from, msg };
}

const MIKKO = 'conn-mikko'; // host
const AINO = 'conn-aino';

describe('timeSync', () => {
  it('answers with the server time and changes nothing (no storage write)', () => {
    const state = lobbyState();
    const result = applyEvent(state, message(AINO, { type: 'timeSync', t0: 123 }), ctx);
    expect(result.effects).toEqual([
      { kind: 'send', connId: AINO, message: { type: 'timeSync', t0: 123, serverTime: ctx.now } },
    ]);
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
  });
});

describe('common checks reject before any handler runs', () => {
  const notAllowed = (connId: string) => [
    { kind: 'send', connId, message: { type: 'error', code: 'NOT_ALLOWED' } },
  ];

  it('an unregistered connection', () => {
    const result = applyEvent(lobbyState(), message('ghost', { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed('ghost'));
    expect(result.changed).toBe(false);
  });

  it('a host-only action from a non-host', () => {
    const result = applyEvent(lobbyState(), message(AINO, { type: 'start' }), ctx);
    expect(result.effects).toEqual(notAllowed(AINO));
  });

  it('an action in the wrong phase (updateProfile outside the lobby, G-5)', () => {
    const result = applyEvent(
      questionState(),
      message(AINO, { type: 'updateProfile', presetId: 'cat' }),
      ctx,
    );
    expect(result.effects).toEqual(notAllowed(AINO));
  });

  it('a player action from a replaced (non-current) socket (G-18)', () => {
    const state = lobbyState();
    state.connections['conn-old'] = { playerId: P.aino, protocolVersion: 1 };
    const result = applyEvent(state, message('conn-old', { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed('conn-old'));
  });

  it('a player action from an anonymous connection', () => {
    const state = lobbyState();
    state.connections['conn-anon'] = { protocolVersion: 1 };
    const result = applyEvent(state, message('conn-anon', { type: 'leave' }), ctx);
    expect(result.effects).toEqual(notAllowed('conn-anon'));
  });

  it('cancelReclaim from a connection that has no request', () => {
    const result = applyEvent(lobbyState(), message(AINO, { type: 'cancelReclaim' }), ctx);
    expect(result.effects).toEqual(notAllowed(AINO));
  });

  it('a stale roundId is silently ignored (double tap / late answer)', () => {
    const result = applyEvent(
      questionState(),
      message(AINO, { type: 'submit', roundId: 99, ranking: [P.mikko] }),
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.changed).toBe(false);
  });
});

describe('routing reaches the right handler (stubs until Phase 3)', () => {
  const expectStub = (fn: () => unknown, owner: string) => {
    expect(fn).toThrow(NotImplementedError);
    expect(fn).toThrow(owner);
  };

  it('host start → rounds (3B)', () => {
    expectStub(() => applyEvent(lobbyState(), message(MIKKO, { type: 'start' }), ctx), 'Phase 3B');
  });

  it('submit for the current round → rounds (3B)', () => {
    expectStub(
      () =>
        applyEvent(
          questionState(),
          message(AINO, { type: 'submit', roundId: 1, ranking: [P.mikko] }),
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
          message(AINO, { type: 'hello', protocolVersion: 1, tokenHash: 'f'.repeat(64) }),
          ctx,
        ),
      'Phase 3A',
    );
  });

  it('cancelReclaim from the requester → players (3A)', () => {
    expectStub(
      () =>
        applyEvent(
          lobbyWithReclaimState(),
          message('conn-requester', { type: 'cancelReclaim' }),
          ctx,
        ),
      'Phase 3A',
    );
  });

  it('connection, photoStored and deadline events → handlers', () => {
    expectStub(
      () =>
        applyEvent(
          lobbyState(),
          { kind: 'connection', connId: 'c', online: true, protocolVersion: 1 },
          ctx,
        ),
      'Phase 3A',
    );
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
      applyEvent(state, message(MIKKO, { type: 'start' }), ctx);
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
});
