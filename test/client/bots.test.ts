// Test bots (step 10d, dev / staging only): the pure bot brain, driven with real snapshots from the
// fixtures — no sockets, no timers.
import { describe, expect, it } from 'vitest';
import {
  BOT_ADVANCE_AFTER_MS,
  ANSWER_DELAY_MS,
  due,
  hello,
  newBot,
  receive,
  type BotContext,
  type BotState,
  type Scheduled,
} from '../../src/client/dev/bots/brain';
import { botStatus } from '../../src/client/dev/bots/fleet';
import { BOT_NAMES, freeBotName } from '../../src/client/dev/bots/names';
import { MAX_PLAYERS } from '../../src/shared/constants';
import { validateNickname } from '../../src/shared/nickname';
import type { PlayerId, ServerMessage, Snapshot, SnapshotOf } from '../../src/shared/protocol';
import { GAME_ID, P } from '../fixtures/common';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';

const fixture = (name: string): Snapshot => {
  const found = SCREEN_FIXTURES.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found.snapshot;
};
const question = (name = 'question-answering') => fixture(name) as SnapshotOf<'QUESTION'>;

function ctx(overrides: Partial<BotContext> = {}): BotContext {
  let names = ['spare1', 'spare2'];
  return {
    random: () => 0.5,
    speed: 'normal',
    now: 0,
    takeName: () => {
      const [first, ...rest] = names;
      names = rest;
      return first ?? null;
    },
    ...overrides,
  };
}

/** A bot that has been welcomed as `playerId` into `snapshot` (its own view of the game). */
function welcomed(snapshot: Snapshot, playerId: PlayerId, c = ctx()) {
  const welcome: ServerMessage = {
    type: 'welcome',
    playerId,
    gameId: GAME_ID,
    snapshot: { ...snapshot, you: { ...snapshot.you, playerId } } as Snapshot,
    serverTime: 0,
  };
  return receive(newBot('token-1', 'anni1', 'fox'), welcome, c);
}

describe('test bots: joining', () => {
  it('asks to join until welcomed, then resumes with its token only (never re-joins)', () => {
    const bot = newBot('token-1', 'anni1', 'fox');
    expect(hello(bot)).toEqual({
      type: 'hello',
      token: 'token-1',
      join: { nickname: 'anni1', presetId: 'fox' },
    });
    const { state } = welcomed(fixture('lobby-host'), P.aino);
    expect(hello(state)).toEqual({ type: 'hello', token: 'token-1', gameId: GAME_ID });
  });

  it('"Name taken" → tries the next free name; none left → gives up', () => {
    const taken: ServerMessage = { type: 'error', code: 'NAME_TAKEN', for: 'hello' };
    const step = receive(newBot('t', 'anni1', 'fox'), taken, ctx());
    expect(step.state.name).toBe('spare1');
    expect(step.send).toEqual([hello(step.state)]);
    const none = receive(newBot('t', 'anni1', 'fox'), taken, ctx({ takeName: () => null }));
    expect(none.state.stopped).toBe('no free name left');
  });

  it.each([
    ['GAME_FULL', 'the game is full'],
    ['NOT_FOUND', 'game not found'],
    ['REMOVED', 'removed by the host'],
    ['OUTDATED_CLIENT', 'the app was updated: reload the page'],
  ] as const)('%s → stops with a reason', (code, reason) => {
    const step = receive(newBot('t', 'a', 'fox'), { type: 'error', code, for: 'hello' }, ctx());
    expect(step.state.stopped).toBe(reason);
  });
});

describe('test bots: answering', () => {
  it('a participant answers once, after answering opens, with exactly `spots` distinct shown players', () => {
    const snapshot = question();
    const step = welcomed(snapshot, P.aino);
    expect(step.schedule).toHaveLength(1);
    const [planned] = step.schedule;
    if (planned?.message.type !== 'submit') throw new Error('expected a submit');
    const [min, max] = ANSWER_DELAY_MS.normal;
    expect(planned.at).toBeGreaterThanOrEqual(snapshot.round.answerStartsAt + min);
    expect(planned.at).toBeLessThanOrEqual(snapshot.round.answerStartsAt + max);
    const { ranking } = planned.message;
    expect(ranking).toHaveLength(snapshot.round.spots);
    expect(new Set(ranking).size).toBe(ranking.length);
    for (const id of ranking) expect(snapshot.round.candidates).toContain(id);

    const first = due(step.state, planned);
    expect(first.send).toEqual(planned.message);
    expect(due(first.state, planned).send).toBeNull(); // never twice (G-37)
  });

  it('Podium: picks exactly 3 of the many shown players', () => {
    const snapshot = question('question-podium-25');
    const me = snapshot.round.participants[0];
    if (me === undefined) throw new Error('no participant');
    const [planned] = welcomed(snapshot, me).schedule;
    if (planned?.message.type !== 'submit') throw new Error('expected a submit');
    expect(planned.message.ranking).toHaveLength(3);
    expect(snapshot.round.candidates.length).toBeGreaterThan(3);
  });

  it('a reconnect after Ready does not answer again', () => {
    const snapshot = question();
    const submitted = { ...snapshot, you: { ...snapshot.you, submitted: true } };
    expect(welcomed(submitted, P.aino).schedule).toEqual([]);
  });

  it('a late joiner (not a participant) watches; "Never" bots never answer', () => {
    const snapshot = question();
    expect(welcomed(snapshot, 'Late00000099' as PlayerId).schedule).toEqual([]);
    expect(welcomed(snapshot, P.aino, ctx({ speed: 'never' })).schedule).toEqual([]);
  });

  it('a planned answer for an old round is dropped', () => {
    const { state, schedule } = welcomed(question(), P.aino);
    const [planned] = schedule;
    if (planned === undefined) throw new Error('nothing planned');
    const moved: BotState = { ...state, roundId: (state.roundId ?? 0) + 1 };
    expect(due(moved, planned).send).toBeNull();
  });

  it('TOO_EARLY on a submit → the same answer again a second later', () => {
    const { state, schedule } = welcomed(question(), P.aino);
    const [planned] = schedule;
    if (planned === undefined) throw new Error('nothing planned');
    const sent = due(state, planned).state;
    const retry = receive(
      sent,
      { type: 'error', code: 'TOO_EARLY', for: 'submit' },
      ctx({ now: 5 }),
    );
    expect(retry.state.submitted).toBe(false);
    expect(retry.schedule).toEqual([{ at: 1_005, message: planned.message }]);
  });
});

describe('test bots: holding the host role', () => {
  const results = () => fixture('results-done-host') as SnapshotOf<'RESULTS'>;

  it('a bot host presses Next after the reveal; a bot that is not host never does', () => {
    const snapshot = results();
    const asHost = welcomed({ ...snapshot, hostId: P.aino }, P.aino);
    expect(asHost.schedule).toEqual<Scheduled[]>([
      {
        at: snapshot.results.revealEndsAt + BOT_ADVANCE_AFTER_MS,
        message: { type: 'advance', roundId: snapshot.round.roundId },
      },
    ]);
    const notHost = welcomed({ ...snapshot, hostId: P.mikko }, P.aino);
    expect(notHost.schedule).toEqual([]);
    // …until the role lands on it (the real host was offline too long).
    const handed = receive(notHost.state, { type: 'hostChanged', hostId: P.aino }, ctx());
    expect(handed.schedule).toHaveLength(1);
  });

  it('stays in the game after Game over (the host may tap "Play again")', () => {
    const { state } = welcomed(question(), P.aino);
    const ended = receive(state, { type: 'gameEnded', reason: 'finished', summary: null }, ctx());
    expect(ended.state.stopped).toBeNull();
    expect(ended.state.phase).toBe('ENDED');
  });
});

describe('test bot names and status', () => {
  it('the user’s 25 names: unique, valid nicknames, enough for a full game', () => {
    expect(BOT_NAMES).toHaveLength(MAX_PLAYERS);
    expect(new Set(BOT_NAMES.map((n) => n.toLowerCase())).size).toBe(BOT_NAMES.length);
    for (const name of BOT_NAMES) expect(validateNickname(name).ok).toBe(true);
    expect(BOT_NAMES).toContain('lina');
    expect(BOT_NAMES).toContain('tomi');
  });

  it('takes names in order, skipping any already in the game (case-insensitive)', () => {
    expect(freeBotName(new Set())).toBe('anni1');
    expect(freeBotName(new Set(['anni1', 'anni4']))).toBe('iidalotta');
    expect(freeBotName(new Set(BOT_NAMES.map((n) => n.toLowerCase())))).toBeNull();
  });

  it('describes each bot for the panel', () => {
    const { state } = welcomed(question(), P.aino);
    expect(botStatus(state, true, false)).toBe('answering…');
    expect(botStatus(state, false, true)).toBe('offline (taken offline)');
    expect(botStatus({ ...state, stopped: 'the game is full' }, true, false)).toBe(
      'stopped: the game is full',
    );
  });
});
