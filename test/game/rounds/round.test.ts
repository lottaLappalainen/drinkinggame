// 3B: starting, answering, closing a round, Next / Finish, End — through the engine with the
// scripted `session`, so every step also checks the invariants, the saved-state schema and every
// outgoing message (test/game/helpers.ts apply()).
import { describe, expect, it } from 'vitest';
import {
  ANSWER_GRACE_MS,
  ENDED_RETENTION_MS,
  IDLE_STARTED_MS,
  MIN_PLAYERS,
  QUESTION_INTRO_MS,
  ROUND_MS,
} from '../../../src/shared/constants';
import type { ConnId, PlayerId } from '../../../src/shared/protocol';
import { C, P } from '../../fixtures/common';
import { lobbyState, lobbyWithReclaimState } from '../../fixtures/states';
import { broadcasts, conn, only, sentTo, session, toHostMessages, types } from '../players/session';
import type { Session } from '../players/session';

// ── Helpers ─────────────────────────────────────────────────────────────────

const ALL: readonly ConnId[] = [C.mikko, C.aino, C.ville, C.sanna];

/** A started game: the lobby's four players, Mikko hosting, round 1 in its intro. */
function started(): Session {
  const game = session(lobbyState());
  game.send(C.mikko, { type: 'start' });
  return game;
}

function round(game: Session) {
  const current = game.state.round;
  if (current === null) throw new Error('no round is running');
  return current;
}

function submit(game: Session, who: ConnId, ranking?: readonly PlayerId[]) {
  return game.send(who, {
    type: 'submit',
    roundId: round(game).roundId,
    ranking: [...(ranking ?? round(game).candidates)],
  });
}

const next = (game: Session, who: ConnId = C.mikko) =>
  game.send(who, { type: 'advance', roundId: round(game).roundId });

const openAnswering = (game: Session) => {
  game.wait(QUESTION_INTRO_MS);
};

/** Wait until the reveal of the current results is over (the host's Next unlocks). */
function finishReveal(game: Session) {
  const results = round(game).results;
  if (results === null) throw new Error('the round has no results yet');
  game.wait(Math.max(0, results.revealEndsAt - game.now));
}

/** One whole round: everybody answers (same ranking), the reveal plays out. */
function playRound(game: Session, who: readonly ConnId[] = ALL) {
  openAnswering(game);
  for (const c of who) submit(game, c);
  finishReveal(game);
}

function reasonOf(messages: ReturnType<typeof sentTo>) {
  const error = only(messages, 'error');
  return error.code;
}

// ── Start ───────────────────────────────────────────────────────────────────

describe('starting the game (G-21, G-22, G-23, G-31)', () => {
  it('draws the questions and starts round 1 with its timeline (G-40, G-49)', () => {
    const game = session(lobbyState());
    const startedAt = game.now;
    const effects = game.send(C.mikko, { type: 'start' });

    const { round: shown } = only(broadcasts(effects), 'roundStarted');
    expect(shown).toMatchObject({ roundId: 1, number: 1, total: 25 });
    expect(shown.question).toEqual(game.state.questions[0]);
    expect(game.state.phase).toBe('QUESTION');
    expect(game.state.questions).toHaveLength(25);

    const r = round(game);
    expect(r.startedAt).toBe(startedAt);
    expect(r.answerStartsAt).toBe(startedAt + QUESTION_INTRO_MS); // intro first (G-49)
    expect(r.endsAt).toBe(r.answerStartsAt + ROUND_MS); // answer time counts from the answer screen
    expect(game.state.deadlines.roundEnd).toBe(r.endsAt + ANSWER_GRACE_MS);
    expect([...r.candidates].sort()).toEqual([P.mikko, P.aino, P.ville, P.sanna].sort());
    expect(r.participants).toHaveLength(4);
    for (const player of Object.values(game.state.players)) expect(player.timesShown).toBe(1);
  });

  it('only the host can start (engine rule)', () => {
    const game = session(lobbyState());
    expect(reasonOf(sentTo(game.send(C.aino, { type: 'start' }), C.aino))).toBe('NOT_ALLOWED');
    expect(game.state.phase).toBe('LOBBY');
  });

  it(`needs ${MIN_PLAYERS} active players (G-21)`, () => {
    const game = session(lobbyState());
    game.send(C.ville, { type: 'leave' });
    game.send(C.sanna, { type: 'leave' });
    const messages = sentTo(game.send(C.mikko, { type: 'start' }), C.mikko);
    expect(messages).toEqual([{ type: 'error', code: 'NOT_ALLOWED', for: 'start' }]);
    expect(game.state.phase).toBe('LOBBY');
    expect(game.state.questions).toEqual([]);
  });

  it('categories that cannot fill the length refuse to start — and the host can fix it (G-23)', () => {
    const game = session(lobbyState());
    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 25, categories: ['personal'] }, // 10 questions
    });
    const messages = sentTo(game.send(C.mikko, { type: 'start' }), C.mikko);
    expect(messages).toEqual([{ type: 'error', code: 'NOT_ENOUGH_QUESTIONS', for: 'start' }]);
    expect(game.state.phase).toBe('LOBBY');
    expect(game.state.questions).toEqual([]);

    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 25, categories: ['mild', 'spicy'] },
    });
    game.send(C.mikko, { type: 'start' });
    expect(game.state.phase).toBe('QUESTION');
  });

  it('only questions of the chosen categories are drawn (G-22)', () => {
    const game = session(lobbyState());
    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 25, categories: ['mild', 'personal'] },
    });
    game.send(C.mikko, { type: 'start' });
    expect(game.state.questions).toHaveLength(25);
    for (const question of game.state.questions)
      expect(['mild', 'personal']).toContain(question.category);
  });

  it('a double-tapped Start changes nothing', () => {
    const game = started();
    const before = JSON.stringify(game.state);
    game.send(C.mikko, { type: 'start' });
    expect(JSON.stringify(game.state)).toBe(before);
  });
});

// ── Answering ───────────────────────────────────────────────────────────────

describe('answering (G-36, G-37, G-38)', () => {
  it('a ranking is announced to everyone as "ready" — without the ranking itself', () => {
    const game = started();
    openAnswering(game);
    const effects = submit(game, C.aino);
    expect(broadcasts(effects)).toEqual([{ type: 'playerReady', roundId: 1, playerId: P.aino }]);
    expect(game.state.round?.answers[P.aino]).toEqual(round(game).candidates);
  });

  it('before the answer window opens it is refused (the intro shows only the question)', () => {
    const game = started();
    const messages = sentTo(submit(game, C.aino), C.aino);
    expect(messages).toEqual([{ type: 'error', code: 'NOT_ALLOWED', for: 'submit' }]);
    expect(game.state.round?.answers).toEqual({});
  });

  it('is final: a second tap, even with another ranking, changes nothing (G-37)', () => {
    const game = started();
    openAnswering(game);
    const first = [...round(game).candidates];
    submit(game, C.aino, first);
    const effects = submit(game, C.aino, [...first].reverse());
    expect(effects).toEqual([]);
    expect(game.state.round?.answers[P.aino]).toEqual(first);
  });

  it('must rank exactly the shown players, each once (G-36)', () => {
    const game = started();
    openAnswering(game);
    const [a, b, c, d] = round(game).candidates;
    for (const bad of [
      [a, b, c],
      [a, a, b, c],
      [a, b, c, P.late],
      [a, b, c, d, a],
    ]) {
      const messages = sentTo(submit(game, C.aino, bad as PlayerId[]), C.aino);
      expect(messages).toEqual([{ type: 'error', code: 'INVALID', for: 'submit' }]);
    }
    expect(game.state.round?.answers).toEqual({});
  });

  it('a late joiner watches the round and cannot answer it (G-19)', () => {
    const game = started();
    game.hello(conn('late'), 9, { nickname: 'Late' });
    expect(game.state.players[game.playerWithToken(9) ?? P.late]?.activeFromRound).toBe(2);
    openAnswering(game);
    const messages = sentTo(submit(game, conn('late')), conn('late'));
    expect(messages).toEqual([{ type: 'error', code: 'NOT_ALLOWED', for: 'submit' }]);
  });

  it('answers sent in the last moment still count; one millisecond later they do not (G-39)', () => {
    const game = started();
    const r = round(game);
    game.wait(r.endsAt + ANSWER_GRACE_MS - game.now);
    expect(types(broadcasts(submit(game, C.mikko)))).toEqual(['playerReady']);
    game.wait(1);
    expect(submit(game, C.aino)).toEqual([]); // too late: ignored, not an error
    expect(game.state.round?.answers[P.aino]).toBeUndefined();
  });

  it('a phone that locked and came back can still answer (G-16, G-39)', () => {
    const game = started();
    openAnswering(game);
    game.close(C.sanna);
    game.hello(conn('sanna-2'), 4);
    const effects = submit(game, conn('sanna-2'));
    expect(broadcasts(effects)).toEqual([{ type: 'playerReady', roundId: 1, playerId: P.sanna }]);
  });
});

// ── The round ends ──────────────────────────────────────────────────────────

describe('the round ends (G-39)', () => {
  it('as soon as everyone has answered — results go to every phone at once', () => {
    const game = started();
    openAnswering(game);
    for (const c of [C.mikko, C.aino, C.ville]) submit(game, c);
    expect(game.state.phase).toBe('QUESTION');
    const effects = submit(game, C.sanna);
    expect(types(broadcasts(effects))).toEqual(['playerReady', 'roundResults']);
    expect(game.state.phase).toBe('RESULTS');
    expect(game.state.deadlines.roundEnd).toBeUndefined();
    const { results } = only(broadcasts(effects), 'roundResults');
    expect(results.outcome).toBe('ranked');
    expect(results.answerCount).toBe(4);
  });

  it('the results are computed once — the old alarm finds nothing to do', () => {
    const game = started();
    const due = game.state.deadlines.roundEnd ?? 0;
    playRound(game);
    const results = JSON.stringify(round(game).results);
    game.wait(due - game.now + 1);
    expect(game.deadline()).toEqual([]);
    expect(JSON.stringify(round(game).results)).toBe(results);
  });

  it('when time runs out, with the answers there are — and "missed" is counted', () => {
    const game = started();
    openAnswering(game);
    submit(game, C.mikko);
    submit(game, C.aino);
    game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
    const effects = game.deadline();
    const { results } = only(broadcasts(effects), 'roundResults');
    expect(results.outcome).toBe('ranked');
    expect(results.answerCount).toBe(2);
    expect(game.state.players[P.mikko]?.stats).toMatchObject({ answered: 1, missed: 0 });
    expect(game.state.players[P.ville]?.stats).toMatchObject({ answered: 0, missed: 1 });
  });

  it('the last unanswered player going offline ends the round at once', () => {
    const game = started();
    openAnswering(game);
    for (const c of [C.mikko, C.aino, C.ville]) submit(game, c);
    const effects = game.close(C.sanna);
    expect(types(broadcasts(effects))).toEqual(['playerConnection', 'roundResults']);
    expect(game.state.phase).toBe('RESULTS');
  });

  it('all phones locking during the intro does NOT end the round (nobody is "ready" yet)', () => {
    const game = started();
    for (const c of ALL) game.close(c);
    expect(game.state.phase).toBe('QUESTION');
    openAnswering(game);
    game.hello(conn('mikko-2'), 1);
    expect(game.state.phase).toBe('QUESTION'); // someone is back and being waited for
    game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
    const { results } = only(broadcasts(game.deadline()), 'roundResults');
    expect(results.outcome).toBe('nobodyAnswered'); // S-5
  });

  it('leaving during the round ends it if everyone else has answered; an answer already given still counts (G-41)', () => {
    const game = started();
    openAnswering(game);
    for (const c of [C.mikko, C.aino, C.ville]) submit(game, c);
    game.send(C.ville, { type: 'leave' }); // answered, then left
    expect(game.state.phase).toBe('QUESTION'); // Sanna is still being waited for
    const effects = submit(game, C.sanna);
    const { results } = only(broadcasts(effects), 'roundResults');
    expect(results.answerCount).toBe(4); // Ville's answer counts
  });

  it('exactly one answer is "not enough answers" (S-7): no ranking, nothing to reveal', () => {
    const game = started();
    openAnswering(game);
    submit(game, C.mikko);
    game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
    const { results } = only(broadcasts(game.deadline()), 'roundResults');
    expect(results.outcome).toBe('notEnoughAnswers');
    expect(results.revealEndsAt).toBe(results.revealStartsAt);
  });

  it('keeps per-player counters for the drinking rules: first, last, answered (U3)', () => {
    const game = started();
    const order = [...round(game).candidates];
    playRound(game); // everybody ranks the shown players in the same order
    const first = game.state.players[order[0] ?? P.mikko];
    const last = game.state.players[order[3] ?? P.mikko];
    expect(first?.stats).toMatchObject({ timesFirst: 1, timesLast: 0, answered: 1, missed: 0 });
    expect(last?.stats).toMatchObject({ timesFirst: 0, timesLast: 1, answered: 1, missed: 0 });
  });

  it('if everyone is tied nobody is "first of the last" — only the top step (G-50)', () => {
    const game = started();
    openAnswering(game);
    const order = [...round(game).candidates];
    submit(game, C.mikko, order);
    submit(game, C.aino, [...order].reverse()); // opposite rankings → all equal
    game.wait((game.state.deadlines.roundEnd ?? 0) - game.now);
    const { results } = only(broadcasts(game.deadline()), 'roundResults');
    if (results.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(results.steps.map((s) => s.kind)).toEqual(['top']);
    for (const player of Object.values(game.state.players))
      expect(player.stats).toMatchObject({ timesFirst: 1, timesLast: 0 });
  });
});

// ── Next / Finish ───────────────────────────────────────────────────────────

describe("the host's Next and Finish (G-45)", () => {
  it('Next starts the next question: new round, new candidates, everyone shown again', () => {
    const game = started();
    playRound(game);
    const effects = next(game);
    const { round: shown } = only(broadcasts(effects), 'roundStarted');
    expect(shown).toMatchObject({ roundId: 2, number: 2 });
    expect(shown.question).toEqual(game.state.questions[1]);
    expect(game.state.phase).toBe('QUESTION');
    expect(game.state.round?.answers).toEqual({});
    for (const player of Object.values(game.state.players)) expect(player.timesShown).toBe(2);
  });

  it('is accepted a little before the reveal ends (clock tolerance) but not much earlier', () => {
    const game = started();
    openAnswering(game);
    for (const c of ALL) submit(game, c);
    const ends = round(game).results?.revealEndsAt ?? 0;
    game.wait(ends - 600 - game.now);
    expect(next(game)).toEqual([]); // 600 ms early: ignored, still the results
    expect(game.state.phase).toBe('RESULTS');
    game.wait(200);
    expect(types(broadcasts(next(game)))).toEqual(['roundStarted']); // 400 ms early: fine
  });

  it('a double-tapped Next starts one question, not two', () => {
    const game = started();
    playRound(game);
    next(game);
    const before = JSON.stringify(game.state);
    expect(game.send(C.mikko, { type: 'advance', roundId: 1 })).toEqual([]); // the old round's Next
    expect(JSON.stringify(game.state)).toBe(before);
  });

  it('only the host can press Next (engine rule)', () => {
    const game = started();
    playRound(game);
    expect(reasonOf(sentTo(next(game, C.aino), C.aino))).toBe('NOT_ALLOWED');
  });

  it('a late joiner joins the next question and is then no longer waiting (G-15)', () => {
    const game = started();
    playRound(game);
    const effects = game.hello(conn('late'), 9, { nickname: 'Late' });
    expect(only(broadcasts(effects), 'playerJoined').player.waitingForNextRound).toBe(true);
    const { round: shown } = only(broadcasts(next(game)), 'roundStarted');
    const lateId = game.playerWithToken(9);
    expect(lateId).toBeDefined();
    expect(shown.participants).toContain(lateId);
    expect(shown.candidates).toContain(lateId); // five players: all of them are shown
  });

  it('after the last question: Finish ends the game and keeps it for late phones (G-45, G-48)', () => {
    const game = session(lobbyState());
    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 15, categories: ['mild', 'spicy'] },
    });
    game.send(C.mikko, { type: 'start' });
    const ids = new Set<string>();
    for (let n = 1; n <= 15; n++) {
      ids.add(game.state.questions[round(game).index]?.id ?? '');
      playRound(game);
      if (n < 15) expect(types(broadcasts(next(game)))).toEqual(['roundStarted']);
    }
    expect(ids.size).toBe(15); // no question twice (G-31)

    const effects = next(game); // "Finish"
    expect(broadcasts(effects)).toEqual([{ type: 'gameEnded', reason: 'finished', summary: null }]);
    expect(game.state).toMatchObject({ phase: 'ENDED', endReason: 'finished', round: null });
    expect(game.state.deadlines).toEqual({ retention: game.now + ENDED_RETENTION_MS });
  });

  it('Next is refused while paused — but Finish still works (G-42)', () => {
    const game = session(lobbyState());
    game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 15, categories: ['mild', 'spicy'] },
    });
    game.send(C.mikko, { type: 'start' });
    playRound(game);
    game.send(C.ville, { type: 'leave' });
    const paused = game.send(C.sanna, { type: 'leave' });
    expect(types(broadcasts(paused))).toContain('paused');
    expect(sentTo(next(game), C.mikko)).toEqual([
      { type: 'error', code: 'NOT_ALLOWED', for: 'advance' },
    ]);
    expect(game.state.phase).toBe('RESULTS');

    // The last question: Finish is allowed even though the game is paused.
    const last = session(lobbyState());
    last.send(C.mikko, { type: 'setSettings', settings: { gameLength: 15, categories: ['mild'] } });
    last.send(C.mikko, { type: 'start' });
    for (let n = 1; n < 15; n++) {
      playRound(last);
      next(last);
    }
    playRound(last);
    last.send(C.ville, { type: 'leave' });
    last.send(C.sanna, { type: 'leave' });
    expect(last.state.paused).toBe(true);
    expect(types(broadcasts(next(last)))).toEqual(['gameEnded']);
  });
});

// ── Pause ───────────────────────────────────────────────────────────────────

describe('too few players (G-42)', () => {
  it('a running round finishes normally; the pause lifts when enough players are back — Next never fires by itself', () => {
    const game = started();
    openAnswering(game);
    game.send(C.ville, { type: 'leave' });
    const paused = game.send(C.sanna, { type: 'leave' });
    expect(paused.some((e) => e.kind === 'broadcast' && e.message.type === 'paused')).toBe(true);
    expect(game.state.paused).toBe(true);

    // The two who are left answer; the round ends normally, candidates and all.
    submit(game, C.mikko);
    const closed = submit(game, C.aino);
    expect(types(broadcasts(closed))).toContain('roundResults');
    finishReveal(game);

    // 2 active players + 1 late joiner = 3: the pause lifts, but nothing starts by itself.
    const joined = game.hello(conn('late'), 9, { nickname: 'Late' });
    expect(types(broadcasts(joined))).toContain('resumed');
    expect(game.state.paused).toBe(false);
    expect(game.state.phase).toBe('RESULTS');
    expect(types(broadcasts(next(game)))).toEqual(['roundStarted']);
  });
});

// ── Ending ──────────────────────────────────────────────────────────────────

describe('ending the game (G-46, G-48)', () => {
  it('the host ends it mid-round: answers are dropped, retention starts, the game stays visible', () => {
    const game = started();
    openAnswering(game);
    submit(game, C.aino);
    const effects = game.send(C.mikko, { type: 'end' });
    expect(broadcasts(effects)).toEqual([
      { type: 'gameEnded', reason: 'hostEnded', summary: null },
    ]);
    expect(game.state).toMatchObject({ phase: 'ENDED', endReason: 'hostEnded', round: null });
    expect(game.state.deadlines).toEqual({ retention: game.now + ENDED_RETENTION_MS });
    game.wait(ENDED_RETENTION_MS);
    expect(game.deadline()).toEqual([{ kind: 'deleteGame' }]);
  });

  it('the host can end the game from the lobby too', () => {
    const game = session(lobbyState());
    game.send(C.mikko, { type: 'end' });
    expect(game.state).toMatchObject({ phase: 'ENDED', endReason: 'hostEnded' });
  });

  it('only the host can end it (engine rule)', () => {
    const game = started();
    expect(reasonOf(sentTo(game.send(C.aino, { type: 'end' }), C.aino))).toBe('NOT_ALLOWED');
    expect(game.state.phase).toBe('QUESTION');
  });

  it('a pending "That\'s me" is answered with "no" — nobody can approve it any more (G-44)', () => {
    const game = session(lobbyWithReclaimState());
    const effects = game.send(C.mikko, { type: 'end' });
    expect(sentTo(effects, C.requester)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(toHostMessages(effects)).toEqual([
      { type: 'reclaimClosed', requestId: expect.any(String) as string },
    ]);
    expect(game.state.reclaims).toEqual({});
  });

  it('a started game nobody is in is deleted after IDLE_STARTED_MS, not before (CLAUDE.md §6)', () => {
    const game = started();
    for (const c of ALL) game.close(c);
    game.wait(IDLE_STARTED_MS - 1);
    expect(game.deadline().some((e) => e.kind === 'deleteGame')).toBe(false); // food break: still there
    game.wait(1);
    expect(game.deadline()).toContainEqual({ kind: 'deleteGame' });
  });
});
