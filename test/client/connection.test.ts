// 5C: the connection manager against a fake socket and manual timers — reconnect and backoff,
// screen-on, heartbeat, clock sync, and (the important one) events from abandoned sockets ignored.
import { describe, expect, it } from 'vitest';
import { createClock } from '../../src/client/net/clock';
import { createConnection } from '../../src/client/net/connection';
import {
  CLIENT_PING_MS,
  PING_MESSAGE,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  TIME_SYNC_SAMPLES,
  VISIBLE_PONG_TIMEOUT_MS,
  WS_CLOSE,
} from '../../src/shared/constants';
import type { ServerMessage } from '../../src/shared/protocol';
import { T0 } from '../fixtures/common';
import { FakeSocket, FakeTimers } from './fakes';

function setup() {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const visible: (() => void)[] = [];
  const log: string[] = [];
  const messages: ServerMessage[] = [];
  const clock = createClock(() => timers.now);
  const conn = createConnection(
    {
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      socketUrl: (key) => `ws://test/ws/${key}?v=2`,
      timers,
      now: () => timers.now,
      onVisible: (callback) => {
        visible.push(callback);
        return () => undefined;
      },
      clock,
    },
    {
      onOpen: () => {
        log.push('open');
        conn.send({ type: 'start' }); // stands in for the store's hello
      },
      onMessage: (message) => messages.push(message),
      onClose: (code) => log.push(`close ${String(code)}`),
    },
  );
  const last = () => {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket');
    return socket;
  };
  return {
    conn,
    timers,
    sockets,
    log,
    messages,
    clock,
    last,
    visible: () => {
      visible.forEach((v) => {
        v();
      });
    },
  };
}

describe('opening', () => {
  it('connects to the versioned URL; the first message is the hello, then time sync', () => {
    const { conn, last, log } = setup();
    conn.connect('ABCDE');
    expect(conn.status).toBe('connecting');
    expect(last().url).toBe('ws://test/ws/ABCDE?v=2');
    last().open();
    expect(conn.status).toBe('open');
    expect(log).toEqual(['open']);
    expect(last().messages()).toEqual([{ type: 'start' }, { type: 'timeSync', t0: T0 }]);
  });

  it('send() is false (and sends nothing) while no socket is open', () => {
    const { conn } = setup();
    expect(conn.send({ type: 'start' })).toBe(false);
    conn.connect('ABCDE');
    expect(conn.send({ type: 'start' })).toBe(false);
  });
});

describe('reconnecting', () => {
  it(`backs off ${String(RECONNECT_MIN_MS)} ms → ${String(RECONNECT_MAX_MS)} ms, and starts over after resetBackoff()`, () => {
    const { conn, timers, sockets, last } = setup();
    conn.connect('ABCDE');
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      last().drop();
      expect(conn.status).toBe('waiting');
      delays.push(timers.waiting()[0] ?? -1);
      timers.advance(delays[delays.length - 1] ?? 0);
    }
    expect(delays).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000]);
    expect(sockets).toHaveLength(8);

    conn.resetBackoff(); // a welcome arrived
    last().drop();
    expect(timers.waiting()).toEqual([RECONNECT_MIN_MS]);
  });

  it('stop() inside onClose prevents the reconnect (a terminal close)', () => {
    const { conn, timers, sockets, last } = setup();
    conn.connect('ABCDE');
    last().open();
    conn.stop();
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(conn.status).toBe('stopped');
  });

  it('screen on while a reconnect is scheduled → reconnect at once', () => {
    const { conn, timers, sockets, last, visible } = setup();
    conn.connect('ABCDE');
    last().drop();
    last(); // still the first socket
    timers.advance(10); // not yet due
    visible();
    expect(sockets).toHaveLength(2);
    expect(conn.status).toBe('connecting');
  });

  it('screen on while open: ping, and reconnect if no pong comes', () => {
    const { conn, timers, sockets, last, visible } = setup();
    conn.connect('ABCDE');
    last().open();
    visible();
    expect(last().sent).toContain(PING_MESSAGE);
    timers.advance(VISIBLE_PONG_TIMEOUT_MS - 1);
    expect(sockets).toHaveLength(1);
    timers.advance(1);
    expect(sockets).toHaveLength(2); // the "open" socket was a dead one (iOS)
  });

  it('screen on while open and the pong arrives: nothing happens', () => {
    const { conn, timers, sockets, last, visible } = setup();
    conn.connect('ABCDE');
    last().open();
    visible();
    last().answerPing();
    timers.advance(VISIBLE_PONG_TIMEOUT_MS * 2);
    expect(sockets).toHaveLength(1);
  });

  it(`heartbeat: a ping every ${String(CLIENT_PING_MS / 1000)} s; a whole interval without an answer → reconnect`, () => {
    const { conn, timers, sockets, last } = setup();
    conn.connect('ABCDE');
    last().open();
    timers.advance(CLIENT_PING_MS);
    expect(last().sent.filter((d) => d === PING_MESSAGE)).toHaveLength(1);
    last().answerPing();
    timers.advance(CLIENT_PING_MS); // second ping, never answered
    timers.advance(CLIENT_PING_MS);
    expect(sockets).toHaveLength(2);
  });
});

describe('only the CURRENT socket counts (CLAUDE.md §6 "One socket per player")', () => {
  it("an abandoned socket's REPLACED error and close are ignored", () => {
    const { conn, messages, log, last, sockets } = setup();
    conn.connect('ABCDE');
    const old = last();
    old.open();
    conn.connect('ABCDE'); // the page reconnected itself (e.g. screen on)
    const current = last();
    current.open();
    expect(old.closedWith).not.toBeNull();

    // The server now replaces the OLD socket — the page must not react to it.
    old.receive({ type: 'error', code: 'REPLACED' });
    old.drop(WS_CLOSE.REPLACED);
    expect(messages).toEqual([]);
    expect(log).toEqual(['open', 'open']);
    expect(conn.status).toBe('open');
    expect(sockets).toHaveLength(2);
  });
});

describe('messages', () => {
  it('passes server messages on; drops garbage, binary frames, unknown types and pongs', () => {
    const { conn, messages, last } = setup();
    conn.connect('ABCDE');
    last().open();
    last().receive({ type: 'resumed' });
    last().receive('not json');
    last().receive('{"type":"hack"}');
    last().receive('[1,2]');
    last().receiveRaw(new Uint8Array([1, 2]));
    last().answerPing();
    expect(messages).toEqual([{ type: 'resumed' }]);
  });

  it(`clock sync: ${String(TIME_SYNC_SAMPLES)} samples, the lowest round trip wins; not passed on`, () => {
    const { conn, messages, last, timers, clock } = setup();
    conn.connect('ABCDE');
    last().open();
    const rtts = [400, 100, 300, 250, 500];
    for (const rtt of rtts) {
      const request = last()
        .messages()
        .filter((m) => typeof m !== 'string' && m.type === 'timeSync')
        .pop();
      if (typeof request === 'string' || request?.type !== 'timeSync')
        throw new Error('no timeSync');
      timers.advance(rtt);
      // The server's clock is 10 s ahead; it answers exactly halfway.
      last().receive({
        type: 'timeSync',
        t0: request.t0,
        serverTime: request.t0 + 10_000 + rtt / 2,
      });
    }
    const syncs = last()
      .messages()
      .filter((m) => typeof m !== 'string' && m.type === 'timeSync');
    expect(syncs).toHaveLength(TIME_SYNC_SAMPLES);
    expect(clock.offset).toBe(10_000);
    expect(clock.serverNow()).toBe(timers.now + 10_000);
    expect(messages).toEqual([]);
  });

  it('resyncClock() forgets the samples and measures again', () => {
    const { conn, last, clock } = setup();
    conn.connect('ABCDE');
    last().open();
    clock.add({ rtt: 10, offset: 5_000 });
    conn.resyncClock();
    expect(clock.synced).toBe(false);
    const syncs = last()
      .messages()
      .filter((m) => typeof m !== 'string' && m.type === 'timeSync');
    expect(syncs).toHaveLength(2);
  });
});
