// The Worker's routes and creating a game (CLAUDE.md §6 "Creating a game = one atomic claim").
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createGame as createGameRoute } from '../../../src/server/worker';
import { GAME_KEY_ALPHABET } from '../../../src/shared/constants';
import type { HttpErrorResponse } from '../../../src/shared/protocol';
import { BASE, Phone, createGame, storedState, stub, tokenFor } from './phone';

const post = (body: unknown) =>
  exports.default.fetch(`${BASE}/api/games`, { method: 'POST', body: JSON.stringify(body) });

const errorOf = async (response: Response) => (await response.json<HttpErrorResponse>()).error;

describe('POST /api/games', () => {
  it('creates a game with a read-aloud key; the creator is its (still offline) host', async () => {
    const { key, gameId, token } = await createGame();
    expect(key).toMatch(new RegExp(`^[${GAME_KEY_ALPHABET}]{5}$`));
    const state = await storedState(key);
    expect(state?.gameId).toBe(gameId);
    expect(state?.phase).toBe('LOBBY');
    const host =
      state?.hostId === null || state === undefined ? undefined : state.players[state.hostId];
    expect(host?.nickname).toBe('Mikko');
    expect(host?.connId).toBeNull(); // the phone hasn't connected yet
    // Only the hash is stored — the raw token never (CLAUDE.md §4).
    expect(JSON.stringify(state)).not.toContain(token);
  });

  it('refuses a bad body, a bad nickname, an oversized body and other methods', async () => {
    expect(await errorOf(await post({ nickname: 'Mikko' }))).toBe('INVALID');
    const badName = await post({ nickname: '   ', presetId: 'fox', token: tokenFor('x') });
    expect(badName.status).toBe(400);
    expect(await errorOf(badName)).toBe('INVALID_NICKNAME'); // only spaces: right shape, not a name
    const tooLong = await post({
      nickname: 'x'.repeat(5000),
      presetId: 'fox',
      token: tokenFor('x'),
    });
    expect(tooLong.status).toBe(413);
    const emptyAfterTrim = await post({ nickname: '​', presetId: 'fox', token: tokenFor('y') });
    expect(emptyAfterTrim.status).toBe(400);
    expect(await errorOf(emptyAfterTrim)).toBe('INVALID_NICKNAME');
    const get = await exports.default.fetch(`${BASE}/api/games`);
    expect(get.status).toBe(405);
  });

  it('a key that is already taken is never claimed twice (atomic claim)', async () => {
    const { key } = await createGame();
    const second = await stub(key).claim({
      key,
      nickname: 'Intruder',
      presetId: 'cat',
      token: tokenFor('intruder'),
    });
    expect(second).toEqual({ ok: false, error: 'TAKEN' });
    const state = await storedState(key);
    expect(Object.values(state?.players ?? {}).map((p) => p.nickname)).toEqual(['Mikko']);
  });

  it('gives up with CREATE_FAILED when every key it tries is taken', async () => {
    const { key } = await createGame();
    const request = new Request(`${BASE}/api/games`, {
      method: 'POST',
      body: JSON.stringify({ nickname: 'Aino', presetId: 'cat', token: tokenFor('aino') }),
    });
    const response = await createGameRoute(request, env, () => key);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('CREATE_FAILED');
  });
});

describe('WebSocket routing', () => {
  it('a malformed key gets a plain 404 (no real phone builds one); no upgrade → 426', async () => {
    const malformed = await exports.default.fetch(`${BASE}/ws/abc`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(malformed.status).toBe(404);
    const noUpgrade = await exports.default.fetch(`${BASE}/ws/ABCDE`);
    expect(noUpgrade.status).toBe(426);
    const unknownApi = await exports.default.fetch(`${BASE}/api/nope`);
    expect(unknownApi.status).toBe(404);
  });

  it('an unknown game: the socket is accepted, told NOT_FOUND and closed — and nothing is stored', async () => {
    const phone = await Phone.open('ZZZZ9');
    expect(await phone.next('error')).toEqual({ type: 'error', code: 'NOT_FOUND' });
    expect((await phone.closed()).code).toBe(4005);
    expect(await storedState('ZZZZ9')).toBeUndefined();
  });
});
