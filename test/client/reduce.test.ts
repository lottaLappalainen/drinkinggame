// 5C: deltas patch the snapshot (CLAUDE.md §5). Every result must still be a valid snapshot — the
// same SnapshotSchema and invariants the server's welcomes pass — so the screens can render it.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { applyDelta } from '../../src/client/store/reduce';
import { checkSnapshotInvariants } from '../../src/game/invariants';
import {
  SnapshotSchema,
  type PublicRound,
  type RoundResults,
  type ServerMessage,
  type Snapshot,
} from '../../src/shared/protocol';
import { P, T0, player } from '../fixtures/common';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';

function fixture(name: string): Snapshot {
  const found = SCREEN_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.snapshot;
}

/** Apply, then check the result is a snapshot the server could have sent. */
function apply(snapshot: Snapshot, message: ServerMessage): Snapshot {
  const next = applyDelta(snapshot, message);
  const parsed = v.safeParse(SnapshotSchema, next);
  expect(parsed.issues?.map((i) => i.message) ?? [], 'schema').toEqual([]);
  expect(checkSnapshotInvariants(next), 'invariants').toEqual([]);
  return next;
}

describe('players', () => {
  it('join, update, connection, leave', () => {
    let s = fixture('lobby-host');
    s = apply(s, { type: 'playerJoined', player: player(P.late, 'Lauri') });
    expect(s.players.map((p) => p.playerId)).toContain(P.late);
    s = apply(s, {
      type: 'playerUpdated',
      playerId: P.late,
      nickname: 'Lauri K',
      avatar: { presetId: 'cat', photoVersion: 1 },
    });
    s = apply(s, { type: 'playerConnection', playerId: P.late, online: false, offlineSince: T0 });
    s = apply(s, { type: 'playerLeft', playerId: P.late, reason: 'removed' });
    expect(s.players.find((p) => p.playerId === P.late)).toMatchObject({
      nickname: 'Lauri K',
      avatar: { presetId: 'cat', photoVersion: 1 },
      online: false,
      offlineSince: T0,
      status: 'removed',
    });
  });

  it('a join that arrives twice is listed once; a patch for an unknown player changes nothing', () => {
    const s = fixture('lobby-host');
    const once = apply(s, { type: 'playerJoined', player: player(P.late, 'Lauri') });
    const twice = apply(once, { type: 'playerJoined', player: player(P.late, 'Lauri') });
    expect(twice.players).toHaveLength(once.players.length);
    expect(apply(s, { type: 'playerLeft', playerId: P.late, reason: 'left' })).toBe(s);
  });
});

describe('lobby', () => {
  it('settings and host changes; reclaim requests come and go (host only)', () => {
    let s = fixture('lobby-host'); // Mikko hosts
    s = apply(s, {
      type: 'settingsChanged',
      settings: { gameLength: 15, categories: ['luuppi'], mode: 'spotlight' },
    });
    expect(s.settings.gameLength).toBe(15);
    const request = {
      requestId: fixture('lobby-reclaim-pending').reclaims[0]?.requestId ?? ('' as never),
      targetPlayerId: P.emma,
      nickname: 'Emma',
      presetId: 'fox' as const,
      createdAt: T0,
      expiresAt: T0 + 300_000,
    };
    s = apply(s, { type: 'reclaimRequested', request });
    s = apply(s, { type: 'reclaimRequested', request }); // repeated: still one
    expect(s.reclaims).toHaveLength(1);
    s = apply(s, { type: 'reclaimClosed', requestId: request.requestId });
    expect(s.reclaims).toEqual([]);

    s = apply(s, { type: 'reclaimRequested', request });
    s = apply(s, { type: 'hostChanged', hostId: P.aino }); // not me any more → no host-only data
    expect(s.hostId).toBe(P.aino);
    expect(s.reclaims).toEqual([]);
  });
});

describe('a round, start to end', () => {
  const lobby = fixture('lobby-host');
  const answering = fixture('question-answering');
  if (answering.phase !== 'QUESTION') throw new Error('fixture');
  const round: PublicRound = { ...answering.round, ready: [] };

  it('roundStarted → playerReady (mine marks me submitted) → roundResults → gameEnded', () => {
    let s = apply(lobby, { type: 'roundStarted', round });
    expect(s).toMatchObject({ phase: 'QUESTION', paused: false, you: { submitted: false } });

    s = apply(s, { type: 'playerReady', roundId: round.roundId, playerId: P.aino });
    s = apply(s, { type: 'playerReady', roundId: round.roundId, playerId: P.aino }); // repeated
    if (s.phase !== 'QUESTION') throw new Error('phase');
    expect(s.round.ready).toEqual([P.aino]);
    expect(s.you.submitted).toBe(false); // Aino isn't me (Mikko)
    s = apply(s, { type: 'playerReady', roundId: round.roundId, playerId: P.mikko });
    expect(s.phase === 'QUESTION' && s.you.submitted).toBe(true);

    const results: RoundResults = {
      roundId: round.roundId,
      outcome: 'nobodyAnswered',
      answerCount: 0,
      revealStartsAt: T0,
      revealEndsAt: T0,
    };
    s = apply(s, { type: 'roundResults', results });
    expect(s).toMatchObject({ phase: 'RESULTS', results });

    s = apply(s, { type: 'gameEnded', reason: 'finished', summary: null });
    expect(s).toMatchObject({ phase: 'ENDED', endReason: 'finished', summary: null });
  });

  it('late deltas for another round are ignored (the server is the authority)', () => {
    const s = apply(lobby, { type: 'roundStarted', round });
    expect(apply(s, { type: 'playerReady', roundId: round.roundId + 1, playerId: P.aino })).toBe(s);
    const stale: RoundResults = {
      roundId: round.roundId - 1,
      outcome: 'nobodyAnswered',
      answerCount: 0,
      revealStartsAt: T0,
      revealEndsAt: T0,
    };
    expect(apply(s, { type: 'roundResults', results: stale })).toBe(s);
  });

  it('paused / resumed only mean something mid-game; the flag survives into the next round', () => {
    expect(apply(lobby, { type: 'paused', needed: 3 })).toBe(lobby);
    let s = apply(fixture('results-done-host'), { type: 'paused', needed: 3 });
    expect(s.phase === 'RESULTS' && s.paused).toBe(true);
    s = apply(s, { type: 'resumed' });
    expect(s.phase === 'RESULTS' && s.paused).toBe(false);
  });

  it('a finished game takes no new round', () => {
    const ended = fixture('ended-finished');
    expect(apply(ended, { type: 'roundStarted', round })).toBe(ended);
  });
});
