// 5C building blocks: storage (validated, never throws), tokens the server accepts, clock math,
// the error table, message parsing, and the reload cap.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { clockSample, createClock } from '../../src/client/net/clock';
import { parseServerMessage } from '../../src/client/net/messages';
import { reloadOnce } from '../../src/client/net/reload';
import { newToken } from '../../src/client/net/token';
import { errorOutcome } from '../../src/client/store/errors';
import { createStorage } from '../../src/client/storage';
import { AVATAR_PRESET_IDS } from '../../src/shared/avatars';
import { OUTDATED_RELOAD_MIN_INTERVAL_MS } from '../../src/shared/constants';
import { ErrorCodeSchema, TokenSchema, type ErrorMessage } from '../../src/shared/protocol';
import { GAME_ID, GAME_KEY } from '../fixtures/common';
import { MemoryStore, THROWING_STORE } from './fakes';

describe('storage', () => {
  it('round-trips games, the pending-create slot, profile, photo and theme', () => {
    const storage = createStorage(new MemoryStore(), new MemoryStore());
    storage.saveGame(GAME_KEY, { token: 'tokenAAAAAAAAAAAAAAAAA', gameId: GAME_ID });
    expect(storage.loadGame(GAME_KEY)).toEqual({
      token: 'tokenAAAAAAAAAAAAAAAAA',
      gameId: GAME_ID,
    });
    expect(storage.savedGameKeys()).toEqual([GAME_KEY]);
    storage.forgetGame(GAME_KEY);
    expect(storage.loadGame(GAME_KEY)).toBeNull();

    storage.savePendingCreate('tokenBBBBBBBBBBBBBBBBB');
    expect(storage.loadPendingCreate()).toBe('tokenBBBBBBBBBBBBBBBBB');
    storage.clearPendingCreate();
    expect(storage.loadPendingCreate()).toBeNull();

    storage.saveProfile({ nickname: 'Aino', presetId: 'cat' });
    expect(storage.loadProfile()).toEqual({ nickname: 'Aino', presetId: 'cat' });
    storage.savePhoto('data:image/webp;base64,AAAA');
    expect(storage.loadPhoto()).toBe('data:image/webp;base64,AAAA');
    expect(storage.loadTheme()).toBe('system');
    storage.saveTheme('dark');
    expect(storage.loadTheme()).toBe('dark');
  });

  it('never throws when storage is blocked — it just remembers nothing', () => {
    const storage = createStorage(THROWING_STORE, THROWING_STORE);
    storage.saveGame(GAME_KEY, { token: 'tokenAAAAAAAAAAAAAAAAA' });
    expect(storage.loadGame(GAME_KEY)).toBeNull();
    expect(storage.savedGameKeys()).toEqual([]);
    expect(storage.loadProfile()).toBeNull();
    expect(storage.loadReloadedAt()).toBeNull();
    const nothing = createStorage(null, null);
    expect(nothing.loadTheme()).toBe('system');
  });

  it('ignores stored data of the wrong shape (it is as untrusted as anything else)', () => {
    const local = new MemoryStore();
    const storage = createStorage(local, null);
    local.setItem(`dg.game.${GAME_KEY}`, '{"token":"short"}');
    local.setItem('dg.game.BADKEY', JSON.stringify({ token: 'tokenAAAAAAAAAAAAAAAAA' }));
    local.setItem('dg.photo', '"javascript:alert(1)"');
    local.setItem('dg.theme', '"neon"');
    local.setItem('dg.profile', 'not json');
    expect(storage.loadGame(GAME_KEY)).toBeNull();
    expect(storage.savedGameKeys()).toEqual([]);
    expect(storage.loadPhoto()).toBeNull();
    expect(storage.loadTheme()).toBe('system');
    expect(storage.loadProfile()).toBeNull();
  });

  it('a profile with an unknown preset gets a random known one instead (never sent as is)', () => {
    const local = new MemoryStore();
    local.setItem('dg.profile', JSON.stringify({ nickname: 'Aino', presetId: 'dragon-2000' }));
    const profile = createStorage(local, null, () => 0.5).loadProfile();
    expect(profile?.nickname).toBe('Aino');
    expect(AVATAR_PRESET_IDS).toContain(profile?.presetId);
  });
});

describe('tokens', () => {
  it('are accepted by the server and different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(v.safeParse(TokenSchema, token).success).toBe(true);
  });
});

describe('clock', () => {
  it('offset = serverTime − (t0 + rtt / 2); the lowest round trip wins', () => {
    expect(clockSample(1_000, 6_100, 1_200)).toEqual({ rtt: 200, offset: 5_000 });
    let phone = 50_000;
    const clock = createClock(() => phone);
    expect(clock.serverNow()).toBe(50_000); // no samples: the phone's own clock
    clock.add({ rtt: 300, offset: 900 });
    clock.add({ rtt: 100, offset: 1_000 });
    clock.add({ rtt: 200, offset: 1_100 });
    expect(clock.offset).toBe(1_000);
    phone = 60_000;
    expect(clock.serverNow()).toBe(61_000);
    clock.reset();
    expect(clock.synced).toBe(false);
  });
});

describe('error table', () => {
  it('handles every error code the server can send', () => {
    for (const code of ErrorCodeSchema.options) {
      const outcome = errorOutcome({ type: 'error', code }, false);
      expect(outcome.kind, code).toBeTruthy();
    }
  });

  it('terminal codes drop the token — except REPLACED, which "Use here" needs', () => {
    const exit = (code: ErrorMessage['code']) =>
      errorOutcome({ type: 'error', code, for: 'hello' }, false);
    expect(exit('NOT_FOUND')).toEqual({ kind: 'exit', exit: 'notFound', forgetToken: true });
    expect(exit('REPLACED')).toEqual({ kind: 'exit', exit: 'replaced', forgetToken: false });
    expect(errorOutcome({ type: 'error', code: 'LEFT', for: 'hello' }, true)).toEqual({
      kind: 'leftDone',
    });
    // NOT_FOUND for something other than the hello is just a refused request.
    expect(
      errorOutcome({ type: 'error', code: 'NOT_FOUND', for: 'removePlayer' }, false).kind,
    ).toBe('notice');
  });
});

describe('message parsing', () => {
  it('accepts known types only', () => {
    expect(parseServerMessage('{"type":"resumed"}')).toEqual({ type: 'resumed' });
    for (const bad of ['', '{', 'null', '[]', '{"type":"__proto__"}', '{"type":1}', 42, null])
      expect(parseServerMessage(bad), String(bad)).toBeNull();
  });
});

describe('reload cap', () => {
  it(`at most one automatic reload per ${String(OUTDATED_RELOAD_MIN_INTERVAL_MS / 1000)} s`, () => {
    let stored: number | null = null;
    const guard = {
      loadReloadedAt: () => stored,
      saveReloadedAt: (at: number) => {
        stored = at;
      },
    };
    let reloads = 0;
    const reload = () => reloads++;
    expect(reloadOnce(guard, 1_000, reload)).toBe(true);
    expect(reloadOnce(guard, 1_000 + OUTDATED_RELOAD_MIN_INTERVAL_MS - 1, reload)).toBe(false);
    expect(reloadOnce(guard, 1_000 + OUTDATED_RELOAD_MIN_INTERVAL_MS, reload)).toBe(true);
    expect(reloads).toBe(2);
  });
});
