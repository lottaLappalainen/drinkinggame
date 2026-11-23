// Test helpers for the Worker + Durable Object, running inside workerd: a scripted "phone" that
// talks to the real Worker over a real WebSocket, plus helpers to create games, move the game
// object's clock (instead of waiting 60 s for a host handover) and read its storage.
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { expect } from 'vitest';
import type { GameObject } from '../../../src/server/GameObject';
import { PROTOCOL_VERSION } from '../../../src/shared/constants';
import type { CreateGameResponse, GameState } from './types';
import type { ServerMessage } from '../../../src/shared/protocol';

export const BASE = 'https://example.com';

/** A valid phone token (the format TokenSchema accepts), different per name. */
export function tokenFor(name: string): string {
  return `token_${name}_`.padEnd(32, '0');
}

export function stub(key: string) {
  return env.GAME.getByName(key);
}

export async function createGame(
  nickname = 'Mikko',
  token = tokenFor('host'),
): Promise<CreateGameResponse & { token: string }> {
  const response = await exports.default.fetch(`${BASE}/api/games`, {
    method: 'POST',
    body: JSON.stringify({ nickname, presetId: 'fox', token }),
  });
  expect(response.status).toBe(201);
  const body: CreateGameResponse = await response.json();
  return { ...body, token };
}

/** Let in-flight messages arrive. */
export function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Set the game object's clock (game time only — the liveness check keeps real time). */
export async function setClock(key: string, now: number): Promise<void> {
  await runInDurableObject(stub(key), (instance: GameObject) => {
    instance.clock = () => now;
  });
}

/** The saved game state, straight from the object's storage (undefined = nothing stored). */
export async function storedState(key: string): Promise<GameState | undefined> {
  return runInDurableObject(stub(key), (_instance: GameObject, state) =>
    state.storage.kv.get<GameState>('state'),
  );
}

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export class Phone {
  /** Messages not yet taken by `next`. */
  readonly inbox: ServerMessage[] = [];
  /** Everything ever received, in order. */
  readonly received: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;

  private constructor(private readonly ws: WebSocket) {}

  /** Open `/ws/<key>?v=<version>` (version null = no `?v=` at all). */
  static async open(key: string, version: number | null = PROTOCOL_VERSION): Promise<Phone> {
    const query = version === null ? '' : `?v=${String(version)}`;
    const response = await exports.default.fetch(`${BASE}/ws/${key}${query}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(101);
    const ws = response.webSocket;
    if (ws === null) throw new Error('No WebSocket in the upgrade response');
    const phone = new Phone(ws);
    ws.addEventListener('message', (event) => {
      const text = String(event.data);
      if (text === 'pong') return;
      const message = JSON.parse(text) as ServerMessage;
      phone.inbox.push(message);
      phone.received.push(message);
    });
    ws.addEventListener('close', (event) => {
      phone.closedWith = { code: event.code, reason: event.reason };
    });
    ws.accept();
    return phone;
  }

  /** Open a socket and say hello: resume with `token`, or join as `nickname` when given. */
  static async hello(key: string, token: string, nickname?: string): Promise<Phone> {
    const phone = await Phone.open(key);
    phone.send({
      type: 'hello',
      token,
      ...(nickname !== undefined && { join: { nickname, presetId: 'fox' } }),
    });
    return phone;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(data: string | ArrayBuffer): void {
    this.ws.send(data);
  }

  ping(): void {
    this.ws.send('ping');
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }

  /** The first not-yet-taken message of this type (waits for it; fails with what did arrive). */
  async next<T extends ServerMessage['type']>(type: T): Promise<Of<T>> {
    for (let i = 0; i < 300; i++) {
      const index = this.inbox.findIndex((m) => m.type === type);
      if (index >= 0) return this.inbox.splice(index, 1)[0] as Of<T>;
      await settle(5);
    }
    throw new Error(
      `no "${type}" arrived; got: ${this.received.map((m) => m.type).join(', ') || 'nothing'}`,
    );
  }

  /** Wait until the server closed this socket; returns the close code and reason. */
  async closed(): Promise<{ code: number; reason: string }> {
    for (let i = 0; i < 300; i++) {
      if (this.closedWith !== null) return this.closedWith;
      await settle(5);
    }
    throw new Error('the socket was not closed');
  }

  /** Types received so far that `next` hasn't taken. */
  pending(): string[] {
    return this.inbox.map((m) => m.type);
  }
}
