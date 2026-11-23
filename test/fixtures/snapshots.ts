// Snapshots for EVERY screen (GAME_DESCRIPTION §4.0), each with the `now` at which to render it.
// Used by the client's dev screen gallery (Phase 5A) and by tests. A test validates every
// snapshot against SnapshotSchema and checkSnapshotInvariants, and Phase 3 compares them with real
// engine output, so these can't silently drift from the protocol.
import {
  ANSWER_GRACE_MS,
  QUESTION_INTRO_MS,
  REVEAL_DRUMROLL_MS,
  REVEAL_STEP_MS,
  ROUND_MS,
} from '../../src/shared/constants';
import type {
  EndReason,
  PlayerId,
  PublicPlayer,
  PublicRound,
  RankedResults,
  RoundResults,
  Snapshot,
  SnapshotOf,
} from '../../src/shared/protocol';
import { revealEndsAt, revealStepStartsAt } from '../../src/shared/reveal';
import {
  GAME_ID,
  GAME_KEY,
  P,
  REQUEST_ID,
  REVEAL_STARTS_AT,
  T0,
  player,
  preset,
  sixPlayers,
} from './common';

export type ScreenFixture = {
  readonly name: string;
  /** Which screen / state this shows (GAME_DESCRIPTION §4.0 numbering). */
  readonly screen: string;
  readonly now: number;
  readonly snapshot: Snapshot;
};

// ── Building blocks ─────────────────────────────────────────────────────────

const ROUND_STARTED_AT = T0 + 10_000;

/** Fields every phase has. */
type Common = Omit<SnapshotOf<'LOBBY'>, 'phase' | 'questionCounts'>;

/** Matches the placeholder bank (20 mild, 10 spicy, 10 personal). */
const QUESTION_COUNTS = { mild: 20, spicy: 10, personal: 10 } as const;

function common(overrides: Partial<Common> = {}): Common {
  return {
    key: GAME_KEY,
    gameId: GAME_ID,
    hostId: P.mikko,
    settings: { gameLength: 25, categories: ['mild', 'spicy'] },
    players: sixPlayers(),
    you: { playerId: P.mikko },
    reclaims: [],
    ...overrides,
  };
}

function lobby(overrides: Partial<Common> = {}): SnapshotOf<'LOBBY'> {
  return { ...common(overrides), phase: 'LOBBY', questionCounts: { ...QUESTION_COUNTS } };
}

function round(overrides: Partial<PublicRound> = {}): PublicRound {
  const answerStartsAt = ROUND_STARTED_AT + QUESTION_INTRO_MS;
  return {
    roundId: 7,
    number: 7,
    total: 25,
    question: {
      id: 'q0007',
      text: '[placeholder 07] Who is most likely to …?',
      category: 'mild',
      labels: 'likely',
    },
    candidates: [P.mikko, P.aino, P.ville, P.sanna, P.juho, P.emma],
    participants: [P.mikko, P.aino, P.ville, P.sanna, P.juho, P.emma],
    answerStartsAt,
    endsAt: answerStartsAt + ROUND_MS,
    ready: [],
    ...overrides,
  };
}

function question(
  roundOverrides: Partial<PublicRound>,
  you: { playerId: PlayerId; submitted: boolean },
  overrides: { players?: PublicPlayer[]; paused?: boolean } = {},
): SnapshotOf<'QUESTION'> {
  const { players, paused = false } = overrides;
  return {
    ...common(players ? { players } : {}),
    phase: 'QUESTION',
    paused,
    you,
    round: round(roundOverrides),
  };
}

const DEFAULT_ROUND = round();
const ANSWERING_AT = DEFAULT_ROUND.answerStartsAt + 8_000;

function ranked(
  r: Omit<RankedResults, 'outcome' | 'revealStartsAt' | 'revealEndsAt'>,
): RankedResults {
  return {
    ...r,
    outcome: 'ranked',
    revealStartsAt: REVEAL_STARTS_AT,
    revealEndsAt: revealEndsAt(REVEAL_STARTS_AT, r.steps.length),
  };
}

function unranked(
  outcome: 'notEnoughAnswers' | 'nobodyAnswered',
  answerCount: number,
): RoundResults {
  return {
    roundId: 7,
    outcome,
    answerCount,
    revealStartsAt: REVEAL_STARTS_AT,
    revealEndsAt: REVEAL_STARTS_AT, // nothing to reveal
  };
}

function resultsSnapshot(
  res: RoundResults,
  roundOverrides: Partial<PublicRound> = {},
  overrides: Partial<Common> & { paused?: boolean } = {},
): SnapshotOf<'RESULTS'> {
  const { paused = false, ...rest } = overrides;
  const r = round({ roundId: res.roundId, number: res.roundId, ...roundOverrides });
  return {
    ...common(rest),
    phase: 'RESULTS',
    paused,
    round: { ...r, ready: r.participants.filter((id) => id !== P.emma) },
    results: res,
  };
}

function ended(endReason: EndReason, you: PlayerId): SnapshotOf<'ENDED'> {
  return { ...common({ you: { playerId: you } }), phase: 'ENDED', endReason, summary: null };
}

// Six candidates, five answers: a clear 1st, tie for 2nd, a last place.
function rankedSix(roundId: number): RankedResults {
  return ranked({
    roundId,
    answerCount: 5,
    ranking: [
      { playerId: P.juho, place: 1 },
      { playerId: P.aino, place: 2 },
      { playerId: P.ville, place: 2 },
      { playerId: P.sanna, place: 4 },
      { playerId: P.mikko, place: 5 },
      { playerId: P.emma, place: 6 },
    ],
    steps: [
      { kind: 'leastLikely', place: 6, playerIds: [P.emma], rule: null },
      // place 3 is absorbed by the tie at 2 ("1, 2, 2, 4") → no separate 3rd step
      { kind: 'second', place: 2, playerIds: [P.aino, P.ville], rule: null },
      { kind: 'mostLikely', place: 1, playerIds: [P.juho], rule: null },
    ],
    // 5 answers ≥ MIN_ANSWERS_FOR_STATS → stats are included (S-6)
    stats: [
      { playerId: P.juho, averageSpot: 1.4, firstVotes: 4 },
      { playerId: P.aino, averageSpot: 2.6, firstVotes: 1 },
      { playerId: P.ville, averageSpot: 2.6, firstVotes: 0 },
      { playerId: P.sanna, averageSpot: 4, firstVotes: 0 },
      { playerId: P.mikko, averageSpot: 4.8, firstVotes: 0 },
      { playerId: P.emma, averageSpot: 5.6, firstVotes: 0 },
    ],
  });
}
const RANKED = rankedSix(7);

// Tie at first place; only 3 answers → no stats.
const TIE_FIRST = ranked({
  roundId: 7,
  answerCount: 3,
  ranking: [
    { playerId: P.aino, place: 1 },
    { playerId: P.sanna, place: 1 },
    { playerId: P.mikko, place: 3 },
    { playerId: P.ville, place: 4 },
  ],
  steps: [
    { kind: 'leastLikely', place: 4, playerIds: [P.ville], rule: null },
    { kind: 'third', place: 3, playerIds: [P.mikko], rule: null },
    { kind: 'mostLikely', place: 1, playerIds: [P.aino, P.sanna], rule: null },
  ],
  stats: null,
});

// Three candidates: "least likely" IS 3rd → steps least likely → 2nd → most likely (G-50).
const THREE_CANDIDATES = ranked({
  roundId: 3,
  answerCount: 3,
  ranking: [
    { playerId: P.ville, place: 1 },
    { playerId: P.mikko, place: 2 },
    { playerId: P.aino, place: 3 },
  ],
  steps: [
    { kind: 'leastLikely', place: 3, playerIds: [P.aino], rule: null },
    { kind: 'second', place: 2, playerIds: [P.mikko], rule: null },
    { kind: 'mostLikely', place: 1, playerIds: [P.ville], rule: null },
  ],
  stats: null,
});

const RANKED_SNAPSHOT = resultsSnapshot(RANKED);
const stepAt = (i: number) => revealStepStartsAt(REVEAL_STARTS_AT, RANKED.steps.length, i);
const AINO_WAITING = { playerId: P.aino, submitted: false };

// ── The fixtures ────────────────────────────────────────────────────────────

export const SCREEN_FIXTURES: readonly ScreenFixture[] = [
  // 3. Lobby
  { name: 'lobby-host', screen: '3 Lobby (host view)', now: T0, snapshot: lobby() },
  {
    name: 'lobby-player',
    screen: '3 Lobby (player view)',
    now: T0,
    snapshot: lobby({ you: { playerId: P.aino } }),
  },
  {
    name: 'lobby-two-players',
    screen: '3 Lobby — Start disabled (< 3 active, G-21)',
    now: T0,
    snapshot: lobby({
      players: [player(P.mikko, 'Mikko'), player(P.aino, 'Aino', { avatar: preset('cat') })],
    }),
  },
  {
    name: 'lobby-reclaim-pending',
    screen: '3 Lobby — host sees a "That\'s me" request (G-44)',
    now: T0,
    snapshot: lobby({
      reclaims: [
        {
          requestId: REQUEST_ID,
          targetPlayerId: P.emma,
          nickname: 'Emma',
          presetId: 'unicorn',
          createdAt: T0 - 20_000,
          expiresAt: T0 + 280_000,
        },
      ],
    }),
  },
  {
    name: 'lobby-host-vacant',
    screen: '3 Lobby — host role vacant (host left, nobody else online)',
    now: T0,
    snapshot: lobby({ hostId: null, you: { playerId: P.aino } }),
  },
  {
    name: 'lobby-not-enough-questions',
    screen: '3 Lobby — only Personal chosen: 25 and 35 disabled, Start disabled (G-22, G-23)',
    now: T0,
    snapshot: lobby({ settings: { gameLength: 25, categories: ['personal'] } }),
  },

  // 4a–4c. Question round
  {
    name: 'question-intro',
    screen: '4a Question intro (G-49)',
    now: ROUND_STARTED_AT + 1_000,
    snapshot: question({}, AINO_WAITING),
  },
  {
    name: 'question-answering',
    screen: '4b Answering — ranking + timer (G-36)',
    now: ANSWERING_AT,
    snapshot: question({ ready: [P.ville, P.juho] }, AINO_WAITING),
  },
  {
    name: 'question-answering-most-labels',
    screen: '4b Answering — a "the most" question: spots say Most / Least (Q-8)',
    now: ANSWERING_AT,
    snapshot: question(
      {
        question: {
          id: 'q0027',
          text: '[placeholder 27] Who would you … the most?',
          category: 'spicy',
          labels: 'most',
        },
      },
      AINO_WAITING,
    ),
  },
  {
    name: 'question-answering-last-seconds',
    screen: '4b Answering — last seconds (countdown pulse)',
    now: DEFAULT_ROUND.endsAt - 3_000,
    snapshot: question({ ready: [P.mikko, P.ville, P.sanna, P.juho] }, AINO_WAITING),
  },
  {
    name: 'question-waiting',
    screen: '4c Waiting — live ready list, Emma offline (G-38)',
    now: ANSWERING_AT + 4_000,
    snapshot: question({ ready: [P.aino, P.ville, P.juho] }, { playerId: P.aino, submitted: true }),
  },
  {
    name: 'question-closed',
    screen: '4 Time is up, results on their way',
    now: DEFAULT_ROUND.endsAt + ANSWER_GRACE_MS / 2,
    snapshot: question(
      { ready: [P.aino, P.ville, P.juho] },
      { playerId: P.sanna, submitted: false },
    ),
  },
  {
    name: 'question-late-joiner',
    screen: '4 Late joiner watching their first round (G-19)',
    now: ANSWERING_AT,
    snapshot: question(
      { ready: [P.ville] },
      { playerId: P.late, submitted: false },
      {
        players: [...sixPlayers(), player(P.late, 'Late Lauri', { waitingForNextRound: true })],
      },
    ),
  },
  {
    name: 'question-paused',
    screen: '4 Round finishing while paused — too few players for the next one (G-42)',
    now: ANSWERING_AT,
    snapshot: question({ ready: [P.mikko] }, AINO_WAITING, {
      paused: true,
      players: sixPlayers().map((p) =>
        p.playerId === P.mikko || p.playerId === P.aino ? p : { ...p, status: 'left' as const },
      ),
    }),
  },

  // 5. Results — the same results at every point of the reveal (G-50)
  {
    name: 'results-pending',
    screen: '5 Results received, reveal about to start',
    now: REVEAL_STARTS_AT - 100,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-step-least-likely',
    screen: '5 Reveal step: LEAST LIKELY',
    now: stepAt(0) + 500,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-step-second',
    screen: '5 Reveal step: 2nd (tie, 3rd absorbed)',
    now: stepAt(1) + 500,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-drumroll',
    screen: '5 Drumroll before MOST LIKELY',
    now: stepAt(2) - REVEAL_DRUMROLL_MS / 2,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-step-most-likely',
    screen: '5 Reveal step: MOST LIKELY',
    now: stepAt(2) + 500,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-done-host',
    screen: '5 Full ranking + stats (≥ 5 answers), host sees Next',
    now: RANKED.revealEndsAt + 1_000,
    snapshot: RANKED_SNAPSHOT,
  },
  {
    name: 'results-done-player',
    screen: '5 Full ranking, player waits for the host',
    now: RANKED.revealEndsAt + 1_000,
    snapshot: resultsSnapshot(RANKED, {}, { you: { playerId: P.aino } }),
  },
  {
    name: 'results-tie-first',
    screen: '5 Tie for MOST LIKELY, no stats (< 5 answers)',
    now: TIE_FIRST.revealEndsAt + 1_000,
    snapshot: resultsSnapshot(TIE_FIRST, {
      candidates: [P.mikko, P.aino, P.ville, P.sanna],
      participants: [P.mikko, P.aino, P.ville, P.sanna],
    }),
  },
  {
    name: 'results-three-candidates',
    screen: '5 Three candidates: least likely = 3rd',
    now: REVEAL_STARTS_AT + REVEAL_STEP_MS / 2,
    snapshot: resultsSnapshot(
      THREE_CANDIDATES,
      { candidates: [P.mikko, P.aino, P.ville], participants: [P.mikko, P.aino, P.ville] },
      { players: sixPlayers().slice(0, 3) },
    ),
  },
  {
    name: 'results-not-enough-answers',
    screen: '5 "Not enough answers" (S-7)',
    now: REVEAL_STARTS_AT + 1_000,
    snapshot: resultsSnapshot(unranked('notEnoughAnswers', 1)),
  },
  {
    name: 'results-nobody-answered',
    screen: '5 "Nobody answered" (S-5)',
    now: REVEAL_STARTS_AT + 1_000,
    snapshot: resultsSnapshot(unranked('nobodyAnswered', 0)),
  },
  {
    name: 'results-last-question',
    screen: '5 After the last question: host sees Finish',
    now: RANKED.revealEndsAt + 1_000,
    snapshot: resultsSnapshot(rankedSix(25)),
  },

  // Pause (G-42)
  {
    name: 'paused-results',
    screen: 'Paused — waiting for players (need 3)',
    now: RANKED.revealEndsAt + 1_000,
    snapshot: resultsSnapshot(
      RANKED,
      {},
      {
        paused: true,
        players: sixPlayers().map((p) =>
          p.playerId === P.mikko || p.playerId === P.aino ? p : { ...p, status: 'left' as const },
        ),
      },
    ),
  },

  // 6. Game over
  {
    name: 'ended-finished',
    screen: '6 Game over — all questions played',
    now: T0 + 3_600_000,
    snapshot: ended('finished', P.mikko),
  },
  {
    name: 'ended-host-ended',
    screen: '6 Game over — host ended the game',
    now: T0 + 600_000,
    snapshot: ended('hostEnded', P.aino),
  },
];
