// 5D: the photo pipeline's decisions (crop maths, which encoding to keep, decode failures) with the
// browser parts faked, and the upload: PUT with the player's token, retries on network / server
// errors only, automatic after joining (any phase while the game has no photo of ours), on a
// change only in the lobby (G-2, G-5, CLAUDE.md §6 "Avatars — photos").
import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES } from '../../src/shared/constants';
import type { ServerMessage, Snapshot } from '../../src/shared/protocol';
import {
  dataUrlToBlob,
  encodeSmallest,
  preparePhoto,
  squareCrop,
  type ImageEnv,
  type PhotoType,
} from '../../src/client/media/photo';
import {
  createPhotoUploader,
  PHOTO_RETRY_DELAYS_MS,
  putPhoto,
} from '../../src/client/media/upload';
import { GAME_ID, GAME_KEY, P, T0 } from '../fixtures/common';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';
import { FakeTimers, testApp } from './fakes';

const PHOTO = 'data:image/webp;base64,UklGRg=='; // "RIFF"
const OTHER_PHOTO = 'data:image/jpeg;base64,/9j/4A=='; // a JPEG start
const PROFILE = { nickname: 'Mikko', presetId: 'fox' } as const;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function blob(type: string, size: number): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

function fixture(name: string): Snapshot {
  const found = SCREEN_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.snapshot;
}

describe('squareCrop', () => {
  it('cuts the largest centred square', () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, size: 3000 });
    expect(squareCrop(192, 192)).toEqual({ sx: 0, sy: 0, size: 192 });
    expect(squareCrop(101, 50)).toEqual({ sx: 25, sy: 0, size: 50 });
  });
});

describe('encodeSmallest', () => {
  it('keeps WebP when the browser really writes WebP', async () => {
    const result = await encodeSmallest((type) => Promise.resolve(blob(type, 12_000)));
    expect(result?.type).toBe('image/webp');
  });

  it('falls back to JPEG when "WebP" comes back as PNG (iOS Safari 16)', async () => {
    const asked: PhotoType[] = [];
    const result = await encodeSmallest((type) => {
      asked.push(type);
      return Promise.resolve(
        type === 'image/webp' ? blob('image/png', 30_000) : blob(type, 15_000),
      );
    });
    expect(result?.type).toBe('image/jpeg');
    expect(asked).toEqual(['image/webp', 'image/jpeg']);
  });

  it('lowers the quality when too big, and gives up rather than send an oversized photo', async () => {
    const big = await encodeSmallest((type, quality) =>
      Promise.resolve(blob(type, quality > 0.6 ? MAX_PHOTO_BYTES + 1 : 20_000)),
    );
    expect(big?.size).toBe(20_000);
    expect(
      await encodeSmallest((type) => Promise.resolve(blob(type, MAX_PHOTO_BYTES + 1))),
    ).toBeNull();
    expect(await encodeSmallest(() => Promise.reject(new Error('no canvas')))).toBeNull();
  });
});

describe('preparePhoto', () => {
  const env = (
    decoded: { width: number; height: number } | null,
  ): ImageEnv & { closed: number } => {
    const state = {
      closed: 0,
      decode: () =>
        Promise.resolve(
          decoded === null
            ? null
            : {
                ...decoded,
                close: () => {
                  state.closed++;
                },
              },
        ),
      draw: () => (type: PhotoType) => Promise.resolve(blob(type, 9_000)),
      toDataUrl: (b: Blob) => Promise.resolve(`data:${b.type};base64,AAAA`),
    };
    return state;
  };

  it('turns a readable picture into a small data URL and frees the decoded image', async () => {
    const fake = env({ width: 4032, height: 3024 });
    expect(await preparePhoto(new Blob(), fake)).toEqual({
      ok: true,
      dataUrl: 'data:image/webp;base64,AAAA',
      bytes: 9_000,
    });
    expect(fake.closed).toBe(1);
  });

  it('an unreadable picture (HEIC on some Androids) is reported, not thrown', async () => {
    expect(await preparePhoto(new Blob(), env(null))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await preparePhoto(new Blob(), env({ width: 0, height: 0 }))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('dataUrlToBlob', () => {
  it('reads a saved JPEG/WebP data URL back into bytes', async () => {
    const result = dataUrlToBlob(PHOTO);
    expect(result?.type).toBe('image/webp');
    expect(new TextDecoder().decode(await result?.arrayBuffer())).toBe('RIFF');
  });

  it('refuses anything else', () => {
    expect(dataUrlToBlob('data:image/png;base64,AAAA')).toBeNull();
    expect(dataUrlToBlob('data:image/webp,plain')).toBeNull();
    expect(dataUrlToBlob('https://example.com/x.webp')).toBeNull();
  });
});

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(answers: (Response | 'offline')[]) {
  const calls: Call[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift() ?? new Response('{}', { status: 500 });
    return answer === 'offline' ? Promise.reject(new Error('offline')) : Promise.resolve(answer);
  };
  return { fetch, calls };
}

const ok = (photoVersion = 1) => new Response(JSON.stringify({ photoVersion }), { status: 200 });

describe('putPhoto', () => {
  it('PUTs the bytes with the bearer token', async () => {
    const { fetch, calls } = fakeFetch([ok(3)]);
    const photo = dataUrlToBlob(PHOTO);
    if (photo === null) throw new Error('bad test photo');
    expect(
      await putPhoto(fetch, { key: GAME_KEY, playerId: P.mikko, token: 'tok', photo }),
    ).toEqual({ ok: true, photoVersion: 3 });
    expect(calls[0]?.url).toBe(`/api/games/${GAME_KEY}/photos/${P.mikko}`);
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('retries only what may work next time', async () => {
    const photo = new Blob(['x'], { type: 'image/webp' });
    const req = { key: GAME_KEY, playerId: P.mikko, token: 'tok', photo };
    const status = async (answer: Response | 'offline') => putPhoto(fakeFetch([answer]).fetch, req);
    expect(await status('offline')).toEqual({ ok: false, retry: true });
    expect(await status(new Response('', { status: 500 }))).toEqual({ ok: false, retry: true });
    expect(await status(new Response('', { status: 409 }))).toEqual({ ok: false, retry: false });
    expect(await status(new Response('', { status: 401 }))).toEqual({ ok: false, retry: false });
  });
});

describe('createPhotoUploader', () => {
  const target = { key: GAME_KEY, playerId: P.mikko, token: 'tok' };

  it('retries network failures with growing waits, then gives up', async () => {
    const timers = new FakeTimers();
    const { fetch, calls } = fakeFetch(['offline', 'offline', 'offline', 'offline', ok()]);
    createPhotoUploader({ fetch, timers }).upload(target, PHOTO);
    await flush();
    for (const delay of PHOTO_RETRY_DELAYS_MS) {
      expect(timers.waiting()).toEqual([delay]);
      timers.advance(delay);
      await flush();
    }
    expect(calls).toHaveLength(1 + PHOTO_RETRY_DELAYS_MS.length);
    expect(timers.waiting()).toEqual([]);
  });

  it('a refusal is final; the same photo is not sent twice after it got through', async () => {
    const timers = new FakeTimers();
    const { fetch, calls } = fakeFetch([new Response('', { status: 409 }), ok(), ok()]);
    const uploader = createPhotoUploader({ fetch, timers });
    uploader.upload(target, PHOTO);
    await flush();
    expect(timers.waiting()).toEqual([]);

    uploader.upload(target, OTHER_PHOTO);
    await flush();
    uploader.upload(target, OTHER_PHOTO); // done already
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('cancel drops a waiting retry', async () => {
    const timers = new FakeTimers();
    const { fetch, calls } = fakeFetch(['offline', ok()]);
    const uploader = createPhotoUploader({ fetch, timers });
    uploader.upload(target, PHOTO);
    await flush();
    uploader.cancel();
    timers.advance(60_000);
    await flush();
    expect(calls).toHaveLength(1);
  });
});

describe('the store uploads this phone’s photo', () => {
  function welcomeWith(snapshot: Snapshot): ServerMessage {
    return {
      type: 'welcome',
      playerId: snapshot.you.playerId,
      gameId: GAME_ID,
      snapshot,
      serverTime: T0,
    };
  }

  function joinedWithPhoto(snapshot: Snapshot, answers: Response[] = [ok()]) {
    const { fetch, calls } = fakeFetch(answers);
    const app = testApp({ fetch });
    app.storage.savePhoto(PHOTO);
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive(welcomeWith(snapshot));
    return { app, calls };
  }

  it('right after joining, with the token this phone saved', async () => {
    const { app, calls } = joinedWithPhoto(fixture('lobby-host'));
    await flush();
    expect(calls).toHaveLength(1);
    const you = app.store.snapshot.value?.you.playerId;
    expect(calls[0]?.url).toBe(`/api/games/${GAME_KEY}/photos/${String(you)}`);
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: `Bearer ${String(app.storage.loadGame(GAME_KEY)?.token)}`,
    });
  });

  it('not when the game already has our photo (a reconnect), nor without a photo', async () => {
    const lobby = fixture('lobby-host');
    const withPhoto: Snapshot = {
      ...lobby,
      players: lobby.players.map((p) =>
        p.playerId === lobby.you.playerId
          ? { ...p, avatar: { presetId: p.avatar.presetId, photoVersion: 2 } }
          : p,
      ),
    };
    const { calls } = joinedWithPhoto(withPhoto);
    await flush();
    expect(calls).toHaveLength(0);

    const { fetch, calls: none } = fakeFetch([ok()]);
    const app = testApp({ fetch });
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive(welcomeWith(lobby));
    await flush();
    expect(none).toHaveLength(0);
  });

  it('a new photo picked in the lobby replaces the old one; after the start it waits', async () => {
    const lobby = fixture('lobby-host');
    const { app, calls } = joinedWithPhoto(lobby, [ok(), ok(2)]);
    await flush();
    app.store.photoChanged(OTHER_PHOTO);
    await flush();
    expect(calls).toHaveLength(2);

    // Mid-game with a photo already in place: changing it is lobby-only (G-5).
    const question = fixture(
      SCREEN_FIXTURES.find((f) => f.snapshot.phase === 'QUESTION')?.name ?? 'missing',
    );
    const started = joinedWithPhoto({
      ...question,
      players: question.players.map((p) =>
        p.playerId === question.you.playerId
          ? { ...p, avatar: { presetId: p.avatar.presetId, photoVersion: 1 } }
          : p,
      ),
    });
    await flush();
    started.app.store.photoChanged(OTHER_PHOTO);
    await flush();
    expect(started.calls).toHaveLength(0);
  });

  it('a late joiner without a photo in the game uploads in any phase', async () => {
    const question = fixture(
      SCREEN_FIXTURES.find((f) => f.snapshot.phase === 'QUESTION')?.name ?? 'missing',
    );
    const me = question.players.find((p) => p.playerId === question.you.playerId);
    expect(me?.avatar.photoVersion).toBeNull();
    const { calls } = joinedWithPhoto(question);
    await flush();
    expect(calls).toHaveLength(1);
  });
});
