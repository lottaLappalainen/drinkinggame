// Profile photo upload and download (CLAUDE.md §5 HTTP, §6 "Avatars — photos") over the real Worker
// and game object inside workerd.
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { detectPhotoType } from '../../../src/server/photos/photoStore';
import type { GameObject } from '../../../src/server/GameObject';
import { MAX_PHOTO_BYTES } from '../../../src/shared/constants';
import type { HttpErrorResponse } from '../../../src/shared/protocol';
import { BASE, Phone, createGame, setClock, storedState, stub, tokenFor } from '../core/phone';

/** A minimal JPEG / WebP: the right first bytes, then filler. */
function jpeg(size = 2000): Uint8Array {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}
function webp(size = 2000): Uint8Array {
  const bytes = new Uint8Array(size).fill(9);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return bytes;
}

function upload(key: string, playerId: string, body: BodyInit, token?: string) {
  return exports.default.fetch(`${BASE}/api/games/${key}/photos/${playerId}`, {
    method: 'PUT',
    body,
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });
}

function download(key: string, gameId: string, playerId: string, version: number | string) {
  return exports.default.fetch(
    `${BASE}/api/games/${key}/${gameId}/photos/${playerId}?v=${String(version)}`,
  );
}

const errorOf = async (response: Response) => (await response.json<HttpErrorResponse>()).error;

/** A lobby with the host (online) and Aino; returns ids and tokens. */
async function lobby() {
  const game = await createGame();
  const host = await Phone.hello(game.key, game.token);
  const hostId = (await host.next('welcome')).playerId;
  const ainoToken = tokenFor(`aino-${game.key}`);
  const aino = await Phone.hello(game.key, ainoToken, 'Aino');
  const ainoId = (await aino.next('welcome')).playerId;
  return { ...game, host, hostId, aino, ainoId, ainoToken };
}

describe('magic bytes, not headers, decide the type', () => {
  it('JPEG and WebP are photos; anything else is not', () => {
    expect(detectPhotoType(jpeg())).toBe('image/jpeg');
    expect(detectPhotoType(webp())).toBe('image/webp');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectPhotoType(png)).toBeNull();
    expect(detectPhotoType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(detectPhotoType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('uploading a photo', () => {
  it('the player uploads their own photo: version 1, everyone hears it, anyone in the game can load it', async () => {
    const game = await lobby();
    const bytes = jpeg();
    const response = await upload(game.key, game.ainoId, bytes, game.ainoToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photoVersion: 1 });
    const update = await game.host.next('playerUpdated');
    expect(update).toMatchObject({ playerId: game.ainoId, avatar: { photoVersion: 1 } });

    const photo = await download(game.key, game.gameId, game.ainoId, 1);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
    expect(photo.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(photo.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(bytes);
  });

  it('a new photo in the lobby gets a new version; the old URL is gone (the URL is cached forever)', async () => {
    const game = await lobby();
    await upload(game.key, game.ainoId, jpeg(), game.ainoToken);
    const second = await upload(game.key, game.ainoId, webp(), game.ainoToken);
    expect(await second.json()).toEqual({ photoVersion: 2 });
    expect((await download(game.key, game.gameId, game.ainoId, 1)).status).toBe(404);
    const current = await download(game.key, game.gameId, game.ainoId, 2);
    expect(current.headers.get('Content-Type')).toBe('image/webp'); // stored type, from the bytes
  });

  it("needs the player's own token (G-6)", async () => {
    const game = await lobby();
    expect((await upload(game.key, game.ainoId, jpeg())).status).toBe(401); // no token
    const wrong = await upload(game.key, game.ainoId, jpeg(), game.token); // the host's token
    expect(wrong.status).toBe(401);
    expect(await errorOf(wrong)).toBe('NOT_ALLOWED');
    const malformed = await upload(game.key, game.ainoId, jpeg(), 'not a token');
    expect(malformed.status).toBe(401);
    const nobody = await upload(game.key, 'Nobody000001', jpeg(), game.ainoToken);
    expect(nobody.status).toBe(404);
    expect((await storedState(game.key))?.players[game.ainoId]?.avatar.photoVersion).toBeNull();
  });

  it(`refuses more than ${String(MAX_PHOTO_BYTES / 1024)} KB — also when no Content-Length says so`, async () => {
    const game = await lobby();
    expect(
      (await upload(game.key, game.ainoId, jpeg(MAX_PHOTO_BYTES + 1), game.ainoToken)).status,
    ).toBe(413);
    // A streamed body has no Content-Length: the limit is counted while reading.
    const chunk = jpeg(16 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(chunk); // 80 KB in total
        controller.close();
      },
    });
    const streamed = await upload(game.key, game.ainoId, stream, game.ainoToken);
    expect(streamed.status).toBe(413);
    expect(
      (await upload(game.key, game.ainoId, jpeg(MAX_PHOTO_BYTES), game.ainoToken)).status,
    ).toBe(200);
  });

  it('refuses anything that is not a JPEG or WebP, whatever it claims to be', async () => {
    const game = await lobby();
    const response = await exports.default.fetch(
      `${BASE}/api/games/${game.key}/photos/${game.ainoId}`,
      {
        method: 'PUT',
        body: '<svg onload="alert(1)"></svg>',
        headers: { Authorization: `Bearer ${game.ainoToken}`, 'Content-Type': 'image/jpeg' },
      },
    );
    expect(response.status).toBe(415);
  });

  it('after the start: a first photo is allowed (late joiner), changing one is not (G-5)', async () => {
    const game = await lobby();
    await upload(game.key, game.ainoId, jpeg(), game.ainoToken); // Aino has a photo from the lobby
    const villeToken = tokenFor(`ville-${game.key}`);
    const ville = await Phone.hello(game.key, villeToken, 'Ville');
    const villeId = (await ville.next('welcome')).playerId;
    game.host.send({ type: 'start' });
    await game.host.next('roundStarted');

    const change = await upload(game.key, game.ainoId, jpeg(), game.ainoToken);
    expect(change.status).toBe(409);
    const late = await Phone.hello(game.key, tokenFor(`late-${game.key}`), 'Late');
    const lateId = (await late.next('welcome')).playerId;
    expect((await upload(game.key, lateId, jpeg(), tokenFor(`late-${game.key}`))).status).toBe(200);
    expect((await upload(game.key, villeId, webp(), villeToken)).status).toBe(200); // Ville had none
  });

  it('only PUT uploads and only GET downloads', async () => {
    const game = await lobby();
    const get = await exports.default.fetch(`${BASE}/api/games/${game.key}/photos/${game.ainoId}`);
    expect(get.status).toBe(405);
  });
});

describe('downloading a photo', () => {
  it('404 for another game id, a missing or wrong version, or no photo at all', async () => {
    const game = await lobby();
    expect((await download(game.key, game.gameId, game.ainoId, 1)).status).toBe(404); // none yet
    await upload(game.key, game.ainoId, jpeg(), game.ainoToken);
    expect((await download(game.key, 'Other0000001', game.ainoId, 1)).status).toBe(404);
    expect((await download(game.key, game.gameId, game.ainoId, 2)).status).toBe(404);
    expect((await download(game.key, game.gameId, game.ainoId, 'x')).status).toBe(404);
    expect((await download(game.key, game.gameId, game.ainoId, 1)).status).toBe(200);
  });

  it('photos are deleted with the game, and a reused key never serves an old photo (G-48)', async () => {
    const game = await lobby();
    await upload(game.key, game.ainoId, jpeg(), game.ainoToken);
    game.host.send({ type: 'end' });
    await game.host.next('gameEnded');
    const retention = (await storedState(game.key))?.deadlines.retention;
    if (retention === undefined) throw new Error('no retention deadline');
    await setClock(game.key, retention);
    await runDurableObjectAlarm(stub(game.key));

    const left = await runInDurableObject(stub(game.key), (_o: GameObject, state) => [
      ...state.storage.kv.list({ prefix: 'photo:' }),
    ]);
    expect(left).toEqual([]);

    // The same key, claimed again by a new game: the old URL (old game id) is a 404.
    const reclaimed = await stub(game.key).claim({
      key: game.key,
      nickname: 'New host',
      presetId: 'owl',
      token: tokenFor('new-host'),
    });
    expect(reclaimed.ok).toBe(true);
    expect((await download(game.key, game.gameId, game.ainoId, 1)).status).toBe(404);
    if (reclaimed.ok) {
      expect((await download(game.key, reclaimed.gameId, game.ainoId, 1)).status).toBe(404);
    }
  });
});
