// Phase 3 "done when": a whole game, lobby → Finish, played purely through the engine — with
// phones locking, a late joiner, a player leaving, a timer-closed round, the host's phone dying and
// a handover. Every step goes through apply() (invariants, saved-state schema, message schemas, and
// "welcome first"); on top of that EVERY player's snapshot is checked after every step, and the
// snapshots the engine produces are compared with the Phase 2 screen fixtures the client is
// built against — so a drift between them shows up here, not in Phase 6.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../../src/game/handlers/players';
import { keysOf } from '../../../src/game/ids';
import { checkSnapshotInvariants } from '../../../src/game/invariants';
import { HOST_HANDOVER_MS, QUESTION_INTRO_MS } from '../../../src/shared/constants';
import {
  SnapshotSchema,
  type ConnId,
  type PlayerId,
  type Snapshot,
} from '../../../src/shared/protocol';
import { C, P } from '../../fixtures/common';
import { SCREEN_FIXTURES } from '../../fixtures/snapshots';
import { lobbyState, lobbyWithReclaimState } from '../../fixtures/states';
import { conn, only, broadcasts, sentTo, session, types } from '../players/session';
import type { Session } from '../players/session';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Every active player's snapshot must be valid and consistent — after every step of the game. */
function everyoneSeesAValidGame(game: Session): void {
  for (const id of keysOf(game.state.players)) {
    if (game.state.players[id]?.status !== 'active') continue;
    const snapshot = buildSnapshot(game.state, id);
    const parsed = v.safeParse(SnapshotSchema, snapshot);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(v.flatten(parsed.issues))).toBe(
      true,
    );
    expect(checkSnapshotInvariants(snapshot), `snapshot of ${id}`).toEqual([]);
  }
}

/** The open sockets of everyone who is online and active. */
function liveConns(game: Session): ConnId[] {
  return Object.values(game.state.players).flatMap((p) =>
    p.status === 'active' && p.connId !== null ? [p.connId] : [],
  );
}

function hostConn(game: Session): ConnId {
  const host = game.state.hostId === null ? undefined : game.state.players[game.state.hostId];
  if (host?.connId == null) throw new Error('the host is not online');
  return host.connId;
}

function round(game: Session) {
  if (game.state.round === null) throw new Error('no round');
  return game.state.round;
}

function submit(game: Session, who: ConnId) {
  return game.send(who, {
    type: 'submit',
    roundId: round(game).roundId,
    ranking: [...round(game).candidates],
  });
}

function finishReveal(game: Session) {
  const results = round(game).results;
  if (results === null) throw new Error('the round has no results yet');
  game.wait(Math.max(0, results.revealEndsAt - game.now));
}

function next(game: Session) {
  const effects = game.send(hostConn(game), { type: 'advance', roundId: round(game).roundId });
  everyoneSeesAValidGame(game);
  return effects;
}

/** Everybody online answers, the reveal plays out. */
function playRound(game: Session) {
  game.wait(QUESTION_INTRO_MS);
  for (const c of liveConns(game)) submit(game, c);
  finishReveal(game);
  everyoneSeesAValidGame(game);
}

// ── Comparing with the Phase 2 fixtures ─────────────────────────────────────

/**
 * Differences in SHAPE between two values (same keys, same kinds of values), ignoring the values
 * themselves. A null on either side is skipped (nullable fields differ by case), and arrays are
 * compared by their first element.
 */
function shapeDiff(actual: unknown, expected: unknown, path = '$'): string[] {
  if (actual === null || expected === null) return [];
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return [`${path}: array vs not`];
    const [a] = actual as unknown[];
    const [e] = expected as unknown[];
    return a === undefined || e === undefined ? [] : shapeDiff(a, e, `${path}[]`);
  }
  if (typeof actual === 'object' && typeof expected === 'object') {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const aKeys = Object.keys(a).sort();
    const eKeys = Object.keys(e).sort();
    if (aKeys.join() !== eKeys.join())
      return [`${path}: keys [${aKeys.join()}] vs fixture [${eKeys.join()}]`];
    return aKeys.flatMap((key) => shapeDiff(a[key], e[key], `${path}.${key}`));
  }
  return typeof actual === typeof expected
    ? []
    : [`${path}: ${typeof actual} vs ${typeof expected}`];
}

function fixture(name: string): Snapshot {
  const found = SCREEN_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no screen fixture named ${name}`);
  return found.snapshot;
}

// ── The game ────────────────────────────────────────────────────────────────

describe('a whole game through the engine', () => {
  it('plays 15 questions, lobby to Finish, and every screen matches its fixture', () => {
    const game = session(lobbyState());
    const seen = new Map<string, Snapshot>();
    const juho = conn('juho');

    // Lobby: a fifth player joins, the host picks 15 questions and adds Spicy.
    game.hello(juho, 9, { nickname: 'Juho' });
    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 15, categories: ['spicy'], mode: 'spotlight' },
    });
    seen.set('lobby', buildSnapshot(game.state, P.mikko));
    everyoneSeesAValidGame(game);
    game.send(C.mikko, { type: 'start' });
    everyoneSeesAValidGame(game);

    // Round 1: five answers.
    game.wait(QUESTION_INTRO_MS);
    seen.set('answering', buildSnapshot(game.state, P.aino));
    for (const c of [C.mikko, C.aino, C.ville, C.sanna, juho]) {
      submit(game, c);
      if (c === C.aino) seen.set('waiting', buildSnapshot(game.state, P.aino));
    }
    expect(game.state.phase).toBe('RESULTS');
    seen.set('results', buildSnapshot(game.state, P.mikko));
    finishReveal(game);
    next(game);

    // Round 2: Sanna's phone locks and never answers; the others finish → the round ends at once.
    game.close(C.sanna);
    game.wait(QUESTION_INTRO_MS);
    for (const c of [C.mikko, C.aino, C.ville, juho]) submit(game, c);
    expect(game.state.phase).toBe('RESULTS');
    // She comes back during the results and lands on them (CLAUDE.md §4: phones jump to the right step).
    const back = game.hello(conn('sanna-2'), 4);
    expect(only(sentTo(back, conn('sanna-2')), 'welcome').snapshot.phase).toBe('RESULTS');
    finishReveal(game);
    next(game);

    // Round 3: Emma joins in the middle — she watches, everyone else answers.
    game.hello(conn('emma'), 10, { nickname: 'Emma' });
    const emma = game.playerWithToken(10) ?? P.emma;
    expect(buildSnapshot(game.state, emma).players.find((p) => p.playerId === emma)).toMatchObject({
      waitingForNextRound: true,
    });
    game.wait(QUESTION_INTRO_MS);
    for (const c of [C.mikko, C.aino, C.ville, conn('sanna-2'), juho]) submit(game, c);
    expect(game.state.phase).toBe('RESULTS'); // Emma isn't waited for
    finishReveal(game);
    next(game);
    expect(round(game).participants).toContain(emma);
    expect(round(game).candidates).toHaveLength(6); // six players: all of them (G-34)

    // Round 4: Ville leaves before answering — he stays rankable this round, the rest finish.
    game.wait(QUESTION_INTRO_MS);
    game.send(C.ville, { type: 'leave' });
    for (const c of [C.mikko, C.aino, conn('sanna-2'), juho, conn('emma')]) submit(game, c);
    expect(game.state.phase).toBe('RESULTS');
    expect(round(game).candidates).toContain(P.ville);
    finishReveal(game);
    next(game);
    expect(round(game).candidates).not.toContain(P.ville); // gone from the next question

    // Round 5: only two answer; the timer closes the round.
    game.wait(QUESTION_INTRO_MS);
    submit(game, C.mikko);
    submit(game, C.aino);
    game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
    expect(types(broadcasts(game.deadline()))).toContain('roundResults');
    finishReveal(game);
    next(game);

    // Round 6: the host's phone dies. The others finish; after 60 s the longest-connected player hosts.
    game.close(C.mikko);
    game.wait(QUESTION_INTRO_MS);
    for (const c of liveConns(game)) submit(game, c);
    expect(game.state.phase).toBe('RESULTS');
    finishReveal(game);
    game.wait(HOST_HANDOVER_MS);
    expect(types(broadcasts(game.deadline()))).toContain('hostChanged');
    expect(game.state.hostId).toBe(P.aino);
    game.hello(conn('mikko-2'), 1); // Mikko is back — as a player
    everyoneSeesAValidGame(game);
    next(game);

    // Rounds 7–14: everybody online answers; the new host presses Next.
    for (let n = 7; n <= 14; n++) {
      playRound(game);
      next(game);
    }

    // Round 15 (the last): Finish.
    expect(round(game).roundId).toBe(15);
    playRound(game);
    const finish = next(game);
    expect(broadcasts(finish)).toEqual([{ type: 'gameEnded', reason: 'finished', summary: null }]);
    expect(game.state.phase).toBe('ENDED');
    seen.set('ended', buildSnapshot(game.state, P.aino));
    everyoneSeesAValidGame(game);

    // No question twice; all 15 were used, once each (G-31).
    const ids = game.state.questions.map((q) => q.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);

    // Counters for the drinking rules add up: answered + missed = rounds taken part in.
    const stats = (id: PlayerId) => game.state.players[id]?.stats;
    expect(stats(P.mikko)).toMatchObject({ answered: 14, missed: 1 }); // phone died in round 6
    expect(stats(P.aino)).toMatchObject({ answered: 15, missed: 0 });
    expect(stats(P.sanna)).toMatchObject({ answered: 13, missed: 2 }); // rounds 2 and 5
    expect(stats(game.playerWithToken(9) ?? P.juho)).toMatchObject({ answered: 14, missed: 1 }); // round 5
    expect(stats(P.ville)).toMatchObject({ answered: 3, missed: 1 }); // left in round 4
    expect(stats(emma)).toMatchObject({ answered: 11, missed: 1 }); // rounds 4–15, missed 5

    // The engine's snapshots have exactly the shape the Phase 2 fixtures (and so the client) expect.
    const pairs: [string, string][] = [
      ['lobby', 'lobby-host'],
      ['answering', 'question-answering'],
      ['waiting', 'question-waiting'],
      ['results', 'results-done-host'],
      ['ended', 'ended-finished'],
    ];
    for (const [mine, theirs] of pairs) {
      const actual = seen.get(mine);
      expect(actual, mine).toBeDefined();
      expect(shapeDiff(actual, fixture(theirs)), `${mine} vs fixture ${theirs}`).toEqual([]);
    }
  });

  it('the other results screens match their fixtures too: not enough answers, nobody answered', () => {
    for (const [answers, fixtureName] of [
      [1, 'results-not-enough-answers'],
      [0, 'results-nobody-answered'],
    ] as const) {
      const game = session(lobbyState());
      game.send(C.mikko, { type: 'start' });
      game.wait(QUESTION_INTRO_MS);
      if (answers === 1) submit(game, C.mikko);
      game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
      game.deadline();
      expect(
        shapeDiff(buildSnapshot(game.state, P.mikko), fixture(fixtureName)),
        fixtureName,
      ).toEqual([]);
    }
  });

  it('the host sees a waiting "That\'s me" request in the same shape as its fixture', () => {
    const game = session(lobbyWithReclaimState());
    expect(shapeDiff(buildSnapshot(game.state, P.mikko), fixture('lobby-reclaim-pending'))).toEqual(
      [],
    );
  });
});
