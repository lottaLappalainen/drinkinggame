// Fakes for the client's browser dependencies: a scripted WebSocket, manual timers, a Map-backed
// Web Storage and a ready-made app (store + connection) wired to them. Client tests run in Node.
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol';
import { PING_MESSAGE, PONG_MESSAGE } from '../../src/shared/constants';
import type { SocketLike, Timers } from '../../src/client/net/connection';
import { createApp } from '../../src/client/store/app';
import { createStorage, type KeyValueStore, type Storage } from '../../src/client/storage';
import type { FetchLike } from '../../src/client/net/api';
import { T0 } from '../fixtures/common';

type Listener = (event: never) => void;

export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = {
      ...(code !== undefined && { code }),
      ...(reason !== undefined && { reason }),
    };
    this.readyState = 3;
  }

  // ── Server side ──
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? [])
      (listener as (e: unknown) => void)(event);
  }
  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }
  receive(message: ServerMessage | string): void {
    this.emit('message', { data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  receiveRaw(data: unknown): void {
    this.emit('message', { data });
  }
  /** The server (or the network) closes the socket. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.emit('close', { code });
  }
  /** Everything the phone sent, parsed (pings stay strings). */
  messages(): (ClientMessage | string)[] {
    return this.sent.map((data) =>
      data === PING_MESSAGE ? data : (JSON.parse(data) as ClientMessage),
    );
  }
  /** The phone's messages without pings and time sync. */
  gameMessages(): ClientMessage[] {
    return this.messages().filter(
      (m): m is ClientMessage => typeof m !== 'string' && m.type !== 'timeSync',
    );
  }
  answerPing(): void {
    this.receive(PONG_MESSAGE);
  }
}

/** Manual time: `advance(ms)` runs every timer that falls due, in order. */
export class FakeTimers implements Timers {
  now = T0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(id: number): void {
    this.pending.delete(id);
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = end;
  }
  /** Delays of the timers still waiting (from now). */
  waiting(): number[] {
    return [...this.pending.values()].map((t) => t.at - this.now).sort((a, b) => a - b);
  }
}

export class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

/** A storage that throws on every access (private mode, blocked site data). */
export const THROWING_STORE: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
  get length(): number {
    throw new Error('blocked');
  },
  key: () => {
    throw new Error('blocked');
  },
};

/** A token that passes the server's format check; `n` makes it unique. */
export function token(n: number): string {
  return `token${String(n).padStart(17, '0')}`;
}

export type TestApp = ReturnType<typeof testApp>;

/** A store + connection wired to fakes. `sockets` lists every socket the phone opened. */
export function testApp(options: { fetch?: FetchLike; storage?: Storage } = {}) {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const visible = new Set<() => void>();
  const local = new MemoryStore();
  const session = new MemoryStore();
  const storage = options.storage ?? createStorage(local, session, () => 0);
  let tokens = 0;
  let reloads = 0;
  const store = createApp({
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    socketUrl: (key) => `ws://test/ws/${key}?v=2`,
    timers,
    now: () => timers.now,
    onVisible: (callback) => {
      visible.add(callback);
      return () => visible.delete(callback);
    },
    storage,
    fetch: options.fetch ?? (() => Promise.reject(new Error('no fetch in this test'))),
    newToken: () => token(++tokens),
    reload: () => {
      reloads++;
    },
  });
  return {
    store,
    timers,
    sockets,
    local,
    session,
    storage,
    get reloads() {
      return reloads;
    },
    /** The most recent socket. */
    get socket(): FakeSocket {
      const last = sockets[sockets.length - 1];
      if (last === undefined) throw new Error('no socket opened yet');
      return last;
    },
    becomeVisible(): void {
      for (const callback of visible) callback();
    },
  };
}
