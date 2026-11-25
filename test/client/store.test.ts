// 5C: the store + connection manager together, over fake sockets — the login rules (CLAUDE.md §3,
// §5, §6): token saved before it's sent, `join` only after a Join tap, terminal answers drop the
// token, REPLACED waits for "Use here", leave keeps the token until confirmed, capped reloads.
import { describe, expect, it } from 'vitest';
import { RECONNECT_MIN_MS, WS_CLOSE } from '../../src/shared/constants';
import type { ServerMessage, Snapshot } from '../../src/shared/protocol';
import { GAME_ID, GAME_KEY, P, T0 } from '../fixtures/common';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';
import { testApp, type TestApp } from './fakes';

const PROFILE = { nickname: 'Mikko', presetId: 'fox' } as const;

function fixture(name: string): Snapshot {
  const found = SCREEN_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.snapshot;
}

function welcome(snapshot: Snapshot = fixture('lobby-host')): ServerMessage {
  return {
    type: 'welcome',
    playerId: snapshot.you.playerId,
    gameId: GAME_ID,
    snapshot,
    serverTime: T0,
  };
}

/** Joined and welcomed into the lobby as Mikko. */
function joined(): TestApp {
  const app = testApp();
  app.store.joinGame(GAME_KEY, PROFILE);
  app.socket.open();
  app.socket.receive(welcome());
  return app;
}

/** The server closes the socket; the phone reconnects after the first backoff step. */
function reconnect(app: TestApp) {
  app.socket.drop();
  app.timers.advance(RECONNECT_MIN_MS);
  app.socket.open();
}

describe('hosting (POST /api/games)', () => {
  it('saves the token in the pending-create slot BEFORE the request, then under the key', async () => {
    let slotDuringRequest: string | null = null;
    const app = testApp({
      fetch: () => {
        slotDuringRequest = app.storage.loadPendingCreate();
        return Promise.resolve(
          new Response(JSON.stringify({ key: GAME_KEY, gameId: GAME_ID }), { status: 201 }),
        );
      },
    });
    expect(await app.store.hostGame(PROFILE)).toBe(true);
    expect(slotDuringRequest).toMatch(/^token/);
    expect(app.storage.loadPendingCreate()).toBeNull();
    expect(app.storage.loadGame(GAME_KEY)).toEqual({ token: slotDuringRequest, gameId: GAME_ID });

    // The creator resumes with that token — no join (the claim already made them the host).
    app.socket.open();
    expect(app.socket.gameMessages()[0]).toEqual({
      type: 'hello',
      token: slotDuringRequest,
      gameId: GAME_ID,
    });
  });

  it('a failed or lost create drops the slot and opens nothing — the host just tries again', async () => {
    const app = testApp({
      fetch: () =>
        Promise.resolve(new Response(JSON.stringify({ error: 'CREATE_FAILED' }), { status: 503 })),
    });
    expect(await app.store.hostGame(PROFILE)).toBe(false);
    expect(app.store.createError.value).toBe('CREATE_FAILED');
    expect(app.storage.loadPendingCreate()).toBeNull();
    expect(app.sockets).toEqual([]);

    const offline = testApp({ fetch: () => Promise.reject(new Error('offline')) });
    expect(await offline.store.hostGame(PROFILE)).toBe(false);
    expect(offline.store.createError.value).toBe('NETWORK');
  });
});

describe('joining and resuming', () => {
  it('a Join tap sends `join`; the token is saved first; reconnects send the token only', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    const saved = app.storage.loadGame(GAME_KEY);
    expect(saved?.token).toMatch(/^token/);
    app.socket.open();
    expect(app.socket.gameMessages()).toEqual([
      { type: 'hello', token: saved?.token, join: PROFILE },
    ]);

    app.socket.receive(welcome());
    expect(app.store.snapshot.value?.phase).toBe('LOBBY');
    expect(app.storage.loadGame(GAME_KEY)).toEqual({ token: saved?.token, gameId: GAME_ID });

    reconnect(app);
    expect(app.socket.gameMessages()).toEqual([
      { type: 'hello', token: saved?.token, gameId: GAME_ID },
    ]);
  });

  it('a Join hello lost before any answer is repeated with `join` (still the same tap)', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    reconnect(app); // no welcome yet
    expect(app.socket.gameMessages()[0]).toMatchObject({ type: 'hello', join: PROFILE });
  });

  it('resume() reopens a saved game without `join`; nothing saved → false', () => {
    const app = testApp();
    expect(app.store.resume(GAME_KEY)).toBe(false);
    app.storage.saveGame(GAME_KEY, { token: 'tokenAAAAAAAAAAAAAAAAA', gameId: GAME_ID });
    expect(app.store.resume(GAME_KEY)).toBe(true);
    app.socket.open();
    expect(app.socket.gameMessages()).toEqual([
      { type: 'hello', token: 'tokenAAAAAAAAAAAAAAAAA', gameId: GAME_ID },
    ]);
  });

  it('NAME_TAKEN → a join error (with "That\'s me" for an offline owner); another name, same token', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive({
      type: 'error',
      code: 'NAME_TAKEN',
      for: 'hello',
      reclaimPlayerId: P.emma,
    });
    expect(app.store.joinError.value).toEqual({ code: 'NAME_TAKEN', reclaimPlayerId: P.emma });

    app.store.retryJoin({ nickname: 'Mikko 2', presetId: 'fox' });
    const hellos = app.socket.gameMessages().filter((m) => m.type === 'hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[1]).toMatchObject({ join: { nickname: 'Mikko 2' } });
    expect(hellos[0]?.type === 'hello' && hellos[1]?.type === 'hello' && hellos[0].token).toBe(
      hellos[1]?.type === 'hello' && hellos[1].token,
    );
  });

  it("updates before this socket's welcome are ignored (safety net)", () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive({ type: 'resumed' });
    expect(app.store.snapshot.value).toBeNull();
  });
});

describe('"That\'s me" (G-44)', () => {
  it('a new token, saved first, sent from a fresh anonymous socket; the result is collected after a drop', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive({
      type: 'error',
      code: 'NAME_TAKEN',
      for: 'hello',
      reclaimPlayerId: P.emma,
    });

    app.store.reclaimPlayer(P.emma, { nickname: 'Emma', presetId: 'cat' });
    const reclaimToken = app.storage.loadGame(GAME_KEY)?.token;
    expect(app.store.reclaim.value).toMatchObject({ status: 'sending' });
    app.socket.open();
    expect(app.socket.gameMessages()).toEqual([
      { type: 'reclaim', playerId: P.emma, token: reclaimToken, nickname: 'Emma', presetId: 'cat' },
    ]);
    app.socket.receive({ type: 'reclaimPending', requestId: 'Req000000001' as never });
    expect(app.store.reclaim.value).toEqual({ status: 'pending' });

    reconnect(app); // the screen locked meanwhile
    expect(app.socket.gameMessages()).toEqual([{ type: 'hello', token: reclaimToken }]);
    app.socket.receive({ type: 'reclaimResult', approved: true });
    app.socket.receive(welcome(fixture('lobby-player')));
    expect(app.store.reclaim.value).toBeNull();
    expect(app.store.snapshot.value?.you.playerId).toBe(P.aino);
  });

  it('denied → the phone may join under another name; unavailable → a notice', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.store.reclaimPlayer(P.emma, PROFILE);
    app.socket.open();
    app.socket.receive({ type: 'reclaimResult', approved: false });
    expect(app.store.reclaim.value).toEqual({ status: 'denied' });

    app.socket.receive({ type: 'error', code: 'RECLAIM_UNAVAILABLE', for: 'reclaim' });
    expect(app.store.reclaim.value).toBeNull();
    expect(app.store.notice.value).toEqual({ code: 'RECLAIM_UNAVAILABLE', for: 'reclaim' });
  });
});

describe("the end of this phone's game", () => {
  it.each([
    ['NOT_FOUND', 'notFound'],
    ['LEFT', 'left'],
    ['REMOVED', 'removed'],
    ['RECLAIMED', 'reclaimed'],
  ] as const)('%s → token dropped, "%s" screen, no reconnect', (code, exit) => {
    const app = joined();
    app.socket.receive({ type: 'error', code, for: 'hello' });
    expect(app.store.exit.value).toEqual({ kind: exit });
    expect(app.storage.loadGame(GAME_KEY)).toBeNull();
    expect(app.store.snapshot.value).toBeNull();
    app.socket.drop();
    app.timers.advance(60_000);
    expect(app.sockets).toHaveLength(1);
  });

  it('REPLACED (message or close code) → "Opened somewhere else", token kept; "Use here" takes it back', () => {
    for (const how of ['message', 'close'] as const) {
      const app = joined();
      if (how === 'message') app.socket.receive({ type: 'error', code: 'REPLACED' });
      else app.socket.drop(WS_CLOSE.REPLACED);
      expect(app.store.exit.value).toEqual({ kind: 'replaced' });
      app.timers.advance(60_000);
      expect(app.sockets).toHaveLength(1);
      expect(app.storage.loadGame(GAME_KEY)).not.toBeNull();

      app.store.useHere();
      expect(app.store.exit.value).toBeNull();
      app.socket.open();
      expect(app.socket.gameMessages()[0]).toMatchObject({ type: 'hello', gameId: GAME_ID });
    }
  });

  it('the NOT_FOUND close code alone (unknown key) is "Game not found" too', () => {
    const app = testApp();
    app.storage.saveGame(GAME_KEY, { token: 'tokenAAAAAAAAAAAAAAAAA' });
    app.store.resume(GAME_KEY);
    app.socket.open();
    app.socket.drop(WS_CLOSE.NOT_FOUND);
    expect(app.store.exit.value).toEqual({ kind: 'notFound' });
    expect(app.storage.loadGame(GAME_KEY)).toBeNull();
  });

  it('a deleted game: the Game Over screen stays; anywhere else it is "Game not found"', () => {
    const over = testApp();
    over.store.joinGame(GAME_KEY, PROFILE);
    over.socket.open();
    over.socket.receive(welcome(fixture('ended-finished')));
    over.socket.drop(WS_CLOSE.GAME_DELETED);
    expect(over.store.snapshot.value?.phase).toBe('ENDED');
    expect(over.store.exit.value).toBeNull();
    expect(over.storage.loadGame(GAME_KEY)).toBeNull();

    const lobby = joined();
    lobby.socket.drop(WS_CLOSE.GAME_DELETED);
    expect(lobby.store.exit.value).toEqual({ kind: 'notFound' });
  });

  it('joinAgain after LEFT / REMOVED uses a NEW token (a new player)', () => {
    const app = joined();
    const old = app.storage.loadGame(GAME_KEY)?.token;
    app.socket.receive({ type: 'error', code: 'REMOVED', for: 'hello' });
    app.store.joinAgain(GAME_KEY, PROFILE);
    app.socket.open();
    const hello = app.socket.gameMessages()[0];
    expect(hello).toMatchObject({ type: 'hello', join: PROFILE });
    expect(hello?.type === 'hello' && hello.token).not.toBe(old);
  });
});

describe('leaving (G-41)', () => {
  it('the token is kept until leftGame, then dropped and the phone goes Home', () => {
    const app = joined();
    app.store.leave();
    expect(app.socket.gameMessages().at(-1)).toEqual({ type: 'leave' });
    expect(app.store.pending.value.has('leave')).toBe(true);
    expect(app.storage.loadGame(GAME_KEY)).not.toBeNull();

    app.socket.receive({ type: 'leftGame' });
    expect(app.storage.loadGame(GAME_KEY)).toBeNull();
    expect(app.store.gameKey.value).toBeNull();
    expect(app.store.exit.value).toBeNull(); // Home, not an exit screen
  });

  it('a Leave lost with the connection is asked again after the reconnect; LEFT then means done', () => {
    const app = joined();
    app.socket.drop(); // gone before the leave could be sent
    app.store.leave();
    app.timers.advance(RECONNECT_MIN_MS);
    app.socket.open();
    app.socket.receive(welcome());
    expect(app.socket.gameMessages().at(-1)).toEqual({ type: 'leave' });

    // Or: the first leave did arrive, but its leftGame was lost → the reconnect hears LEFT.
    reconnect(app);
    app.socket.receive({ type: 'error', code: 'LEFT', for: 'hello' });
    expect(app.store.exit.value).toBeNull();
    expect(app.store.gameKey.value).toBeNull();
    expect(app.storage.loadGame(GAME_KEY)).toBeNull();
  });
});

describe('updates and reloads', () => {
  it('OUTDATED_CLIENT reloads once per minute; after that "Please refresh" — shared with lazy chunks', () => {
    // One tab (one sessionStorage): the reload timestamp survives the reload.
    const app = joined();
    app.socket.receive({ type: 'error', code: 'OUTDATED_CLIENT' });
    expect(app.reloads).toBe(1);
    expect(app.session.map.size).toBe(1);

    // Still outdated (a cached old bundle), or a lazy chunk gone after a deploy, within the minute.
    app.timers.advance(10_000);
    app.store.lazyChunkFailed();
    expect(app.reloads).toBe(1); // capped
    expect(app.store.exit.value).toEqual({ kind: 'refresh' });

    app.timers.advance(60_000);
    app.store.lazyChunkFailed();
    expect(app.reloads).toBe(2);
  });

  it('SERVER_UPDATING → "Updating…" and retries with backoff, no reload; a welcome clears it', () => {
    const app = joined();
    app.socket.receive({ type: 'error', code: 'SERVER_UPDATING' });
    app.socket.drop(WS_CLOSE.PROTOCOL_MISMATCH);
    expect(app.store.updating.value).toBe(true);
    expect(app.reloads).toBe(0);
    app.timers.advance(RECONNECT_MIN_MS);
    expect(app.sockets).toHaveLength(2);
    app.socket.open();
    app.socket.receive(welcome());
    expect(app.store.updating.value).toBe(false);
  });
});

describe('requests in flight (buttons)', () => {
  it('Start stays pending until the round starts; a refusal clears it and explains why', () => {
    const app = joined();
    app.store.start();
    expect(app.store.pending.value.has('start')).toBe(true);
    app.socket.receive({ type: 'error', code: 'NOT_ENOUGH_PLAYERS', for: 'start' });
    expect(app.store.pending.value.has('start')).toBe(false);
    expect(app.store.notice.value).toEqual({ code: 'NOT_ENOUGH_PLAYERS', for: 'start' });

    app.store.start();
    const answering = fixture('question-answering');
    if (answering.phase !== 'QUESTION') throw new Error('fixture');
    app.socket.receive({ type: 'roundStarted', round: { ...answering.round, ready: [] } });
    expect(app.store.pending.value.has('start')).toBe(false);
    expect(app.store.snapshot.value?.phase).toBe('QUESTION');
  });

  it('TOO_EARLY re-enables the button and re-measures the clock', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive(welcome(fixture('results-done-host')));
    expect(app.store.advance()).toBe(true);
    const syncsBefore = app.socket
      .messages()
      .filter((m) => typeof m !== 'string' && m.type === 'timeSync').length;
    app.socket.receive({ type: 'error', code: 'TOO_EARLY', for: 'advance' });
    expect(app.store.pending.value.has('advance')).toBe(false);
    const syncsAfter = app.socket
      .messages()
      .filter((m) => typeof m !== 'string' && m.type === 'timeSync').length;
    expect(syncsAfter).toBe(syncsBefore + 1);
  });

  it('submit / advance carry the current roundId, and only in their phase', () => {
    const app = joined(); // lobby
    expect(app.store.submit([P.aino])).toBe(false);
    expect(app.store.advance()).toBe(false);
    app.socket.receive(welcome(fixture('question-answering')));
    const s = app.store.snapshot.value;
    if (s?.phase !== 'QUESTION') throw new Error('phase');
    expect(app.store.submit([P.aino, P.ville])).toBe(true);
    expect(app.socket.gameMessages().at(-1)).toEqual({
      type: 'submit',
      roundId: s.round.roundId,
      ranking: [P.aino, P.ville],
    });
  });
});

describe('Home', () => {
  it('goHome closes the game but keeps the login for "Return to game"', () => {
    const app = joined();
    app.store.goHome();
    expect(app.store.gameKey.value).toBeNull();
    expect(app.storage.savedGameKeys()).toEqual([GAME_KEY]);
    app.timers.advance(60_000);
    expect(app.sockets).toHaveLength(1);
  });
});

describe("the host's tools stay disabled until answered (no double taps)", () => {
  it('Remove until playerLeft, a "That\'s me" answer until reclaimClosed', () => {
    const app = joined();
    expect(app.store.removePlayer(P.emma)).toBe(true);
    expect(app.store.pending.value.has('removePlayer')).toBe(true);
    app.socket.receive({ type: 'playerLeft', playerId: P.emma, reason: 'removed' });
    expect(app.store.pending.value.has('removePlayer')).toBe(false);

    const requestId = 'Req000000001' as never;
    expect(app.store.answerReclaim(requestId, true)).toBe(true);
    expect(app.store.pending.value.has('answerReclaim')).toBe(true);
    app.socket.receive({ type: 'reclaimClosed', requestId });
    expect(app.store.pending.value.has('answerReclaim')).toBe(false);
  });
});

describe('play again (G-52)', () => {
  it('the host taps Play again: sent once, pending until the new lobby arrives, which replaces the snapshot', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive(welcome(fixture('ended-finished'))); // Mikko hosts the finished game
    expect(app.store.playAgain()).toBe(true);
    expect(app.socket.gameMessages().at(-1)).toEqual({ type: 'playAgain' });
    expect(app.store.pending.value.has('playAgain')).toBe(true);

    const lobby = fixture('lobby-host');
    if (lobby.phase !== 'LOBBY') throw new Error('fixture');
    app.socket.receive({ type: 'newGame', snapshot: lobby });
    expect(app.store.snapshot.value).toEqual(lobby);
    expect(app.store.pending.value.size).toBe(0);
    // Still the same game and login: nothing to reconnect, no exit screen.
    expect(app.store.gameKey.value).toBe(GAME_KEY);
    expect(app.store.exit.value).toBeNull();
  });

  it('a refusal re-enables the button and says why', () => {
    const app = testApp();
    app.store.joinGame(GAME_KEY, PROFILE);
    app.socket.open();
    app.socket.receive(welcome(fixture('ended-finished')));
    app.store.playAgain();
    app.socket.receive({ type: 'error', code: 'NOT_ALLOWED', for: 'playAgain' });
    expect(app.store.pending.value.has('playAgain')).toBe(false);
    expect(app.store.notice.value).toEqual({ code: 'NOT_ALLOWED', for: 'playAgain' });
  });
});
