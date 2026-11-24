// The connection manager (CLAUDE.md §6 "Reconnect", "One socket per player", "Timer sync").
// Hand-written on purpose (§2): reconnect with backoff 250 ms → 5 s, reconnect at once when the
// screen turns back on, a ~20 s heartbeat answered by the server's auto-response, clock sync after
// every open — and it tracks its CURRENT socket only. Every event from a socket it has abandoned
// is ignored, so a page that reconnected itself never reacts to its own old socket's REPLACED.
//
// It knows nothing about games: the store says when to connect / stop and what to send, and gets
// every server message except `timeSync` replies (handled here) and pongs. All browser APIs are
// injected, so tests drive it with a fake socket and fake timers.
import {
  CLIENT_PING_MS,
  PING_MESSAGE,
  PONG_MESSAGE,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  TIME_SYNC_SAMPLES,
  VISIBLE_PONG_TIMEOUT_MS,
} from '../../shared/constants';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { clockSample, type Clock } from './clock';
import { parseServerMessage } from './messages';

/** WebSocket.OPEN — a literal, so tests can run without a WebSocket global. */
const OPEN = 1;

/** The part of the WebSocket API we use. */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number }) => void): void;
};

export type Timers = {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export type ConnectionDeps = {
  readonly createSocket: (url: string) => SocketLike;
  /** `/ws/<KEY>?v=<PROTOCOL_VERSION>` as an absolute ws(s):// URL. */
  readonly socketUrl: (key: string) => string;
  readonly timers: Timers;
  /** The phone's clock (epoch ms) — for time-sync samples. */
  readonly now: () => number;
  /** Subscribe to "the page became visible"; returns an unsubscribe function. */
  readonly onVisible: (callback: () => void) => () => void;
  readonly clock: Clock;
};

export type ConnectionHandlers = {
  /** A new socket is open — send `hello` now (it must be the first message). */
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  /** The current socket closed. Calling `stop()` in here prevents the automatic reconnect. */
  onClose(code: number): void;
};

export type ConnectionStatus =
  | 'idle' // never connected
  | 'connecting' // a socket is opening
  | 'open'
  | 'waiting' // closed; a reconnect is scheduled
  | 'stopped'; // closed on purpose; nothing happens until connect()

export type Connection = ReturnType<typeof createConnection>;

export function createConnection(deps: ConnectionDeps, handlers: ConnectionHandlers) {
  const { timers, clock } = deps;
  let key: string | null = null;
  let socket: SocketLike | null = null;
  /** Bumped whenever the current socket is abandoned; events carry the generation they belong to. */
  let generation = 0;
  let status: ConnectionStatus = 'idle';
  let attempt = 0;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let pongTimer: number | null = null;
  let awaitingPong = false;
  let syncSamples = 0;
  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  const setStatus = (next: ConnectionStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  };
  const clear = (timer: number | null) => {
    if (timer !== null) timers.clearTimeout(timer);
  };
  const clearAllTimers = () => {
    clear(reconnectTimer);
    clear(heartbeatTimer);
    clear(pongTimer);
    reconnectTimer = heartbeatTimer = pongTimer = null;
  };
  const rawSend = (data: string): boolean => {
    if (socket?.readyState !== OPEN) return false;
    try {
      socket.send(data);
      return true;
    } catch {
      return false;
    }
  };

  /** Stop listening to the current socket and close it (its events are ignored from now on). */
  const abandon = () => {
    generation++;
    const old = socket;
    socket = null;
    clearAllTimers();
    try {
      old?.close(1000, 'abandoned');
    } catch {
      // already closed
    }
  };

  const scheduleReconnect = (delay: number) => {
    setStatus('waiting');
    clear(reconnectTimer);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };
  const nextDelay = () => Math.min(RECONNECT_MIN_MS * 2 ** attempt++, RECONNECT_MAX_MS);

  /** The socket looks dead (no pong): drop it and reconnect right away. */
  const reconnectNow = () => {
    abandon();
    attempt = 0;
    open();
  };

  const heartbeat = () => {
    heartbeatTimer = timers.setTimeout(() => {
      heartbeatTimer = null;
      if (awaitingPong) {
        reconnectNow(); // a whole interval without any sign of life
        return;
      }
      awaitingPong = rawSend(PING_MESSAGE);
      heartbeat();
    }, CLIENT_PING_MS);
  };

  const sendTimeSync = () => {
    rawSend(JSON.stringify({ type: 'timeSync', t0: deps.now() } satisfies ClientMessage));
  };

  function open() {
    if (key === null) return;
    abandon();
    const mine = generation;
    const isCurrent = () => mine === generation;
    setStatus('connecting');
    let created: SocketLike;
    try {
      created = deps.createSocket(deps.socketUrl(key));
    } catch {
      scheduleReconnect(nextDelay());
      return;
    }
    socket = created;

    created.addEventListener('open', () => {
      if (!isCurrent()) return;
      setStatus('open');
      awaitingPong = false;
      syncSamples = 0;
      handlers.onOpen(); // hello first
      sendTimeSync();
      heartbeat();
    });
    created.addEventListener('message', (event) => {
      if (!isCurrent()) return;
      awaitingPong = false; // any message is a sign of life
      clear(pongTimer);
      pongTimer = null;
      if (event.data === PONG_MESSAGE) return;
      const message = parseServerMessage(event.data);
      if (message === null) return;
      if (message.type === 'timeSync') {
        clock.add(clockSample(message.t0, message.serverTime, deps.now()));
        if (++syncSamples < TIME_SYNC_SAMPLES) sendTimeSync();
        return;
      }
      handlers.onMessage(message);
    });
    created.addEventListener('close', (event) => {
      if (!isCurrent()) return;
      socket = null;
      generation++;
      clearAllTimers();
      setStatus('waiting');
      handlers.onClose(event.code);
      // onClose may have called stop() (a terminal close) or connect() (a fresh start).
      if (status === 'waiting' && reconnectTimer === null) scheduleReconnect(nextDelay());
    });
    // Browsers fire `close` after `error`; nothing to do here.
    created.addEventListener('error', () => undefined);
  }

  const unsubscribeVisible = deps.onVisible(() => {
    if (key === null || status === 'stopped' || status === 'idle') return;
    if (status === 'open') {
      // Probably fine — but iOS keeps dead sockets "open". Ask, and reconnect if nobody answers.
      if (rawSend(PING_MESSAGE)) {
        clear(pongTimer);
        pongTimer = timers.setTimeout(() => {
          pongTimer = null;
          reconnectNow();
        }, VISIBLE_PONG_TIMEOUT_MS);
      }
      return;
    }
    // Waiting for a backoff timer — don't, the user is looking. (A socket that is still opening
    // is left alone.)
    if (status === 'waiting') reconnectNow();
  });

  return {
    get status(): ConnectionStatus {
      return status;
    },
    get key(): string | null {
      return key;
    },
    onStatus(listener: (status: ConnectionStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    /** Connect to a game (or reconnect now, with a fresh backoff). */
    connect(gameKey: string): void {
      key = gameKey;
      attempt = 0;
      open();
    },
    /** Close on purpose: no reconnect until `connect()` (REPLACED, LEFT, NOT_FOUND, Home …). */
    stop(): void {
      abandon();
      setStatus('stopped');
    },
    /** A welcome arrived: the server accepted us, so the next drop starts the backoff over. */
    resetBackoff(): void {
      attempt = 0;
    },
    /** Sends on the current socket; false if it isn't open (the message is NOT queued). */
    send(message: ClientMessage): boolean {
      return rawSend(JSON.stringify(message));
    },
    /** Forget the clock samples and measure again (after TOO_EARLY: this phone's clock is off). */
    resyncClock(): void {
      clock.reset();
      syncSamples = 0;
      if (status === 'open') sendTimeSync();
    },
    /** Tear down for good (tests, page unload). */
    dispose(): void {
      unsubscribeVisible();
      abandon();
      setStatus('stopped');
      statusListeners.clear();
    },
  };
}
