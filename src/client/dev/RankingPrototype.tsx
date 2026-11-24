// `/dev/ranking` — the ranking test page for the phone checkpoint (5B, U5). It runs the REAL
// question screen (intro → answering with the real timer → waiting) on made-up players, so what is
// tried on a phone is exactly what a game shows. Knobs: player count, game mode, label words.
// After Ready it shows how long the answer took — the number that tells whether ROUND_SECONDS
// and the candidate counts work. Dev and staging builds only (like the galleries).
import { useMemo, useState } from 'preact/hooks';
import { AVATAR_PRESET_IDS } from '../../shared/avatars';
import {
  CANDIDATES_WHEN_MORE,
  PODIUM_MIN_PLAYERS,
  QUESTION_INTRO_MS,
  ROUND_MS,
  SHOW_ALL_UP_TO,
} from '../../shared/constants';
import type { PlayerId, PublicPlayer, SnapshotOf } from '../../shared/protocol';
import { placeLabel, type LabelSetId } from '../../shared/questionLabels';
import { spotsFor, type GameMode } from '../../shared/spots';
import { GAME_ID, GAME_KEY, guestId, player, preset } from '../../../test/fixtures/common';
import { FROZEN_ACTIONS, ScreenEnvContext, type ScreenEnv } from '../screens/env';
import { QuestionScreen } from '../screens/QuestionScreen';
import { Button, SegmentedControl } from '../ui/Controls';
import { Card } from '../ui/Feedback';
import { Stack } from '../ui/Layout';
import { Text } from '../ui/Text';

const NAMES = [
  'Mikko',
  'Aino',
  'Ville',
  'Sanna',
  'Juho',
  'Emma',
  'Onni',
  'Ella',
  'Leevi',
  'Helmi',
  'Eetu',
  'Iida',
  'Aleksi',
  'Venla',
  'Niko',
  'Pihla',
  'Joonas',
  'Maria-Kristiina',
  'Tuomas',
  'Linnea',
  'Kalle',
  'Sofia',
  'Teemu',
  'Anni',
  'Matias',
];
const COUNTS = [3, 4, 5, 6, 8, 12, 25] as const;
type Count = (typeof COUNTS)[number];

const QUESTIONS: Record<LabelSetId, string> = {
  likely: '[test] Who is most likely to sing at the party?',
  most: '[test] Who would you most want on a road trip?',
};

const PLAYERS: readonly PublicPlayer[] = NAMES.map((name, i) =>
  player(guestId(i + 1), name, {
    avatar: preset(AVATAR_PRESET_IDS[i % AVATAR_PRESET_IDS.length] ?? 'fox'),
  }),
);

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) throw new Error('shuffle index out of range');
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/** Who is shown — the same rule as the server's game/rounds/candidates.ts (G-34, G-24). */
function candidatesFor(mode: GameMode, players: readonly PublicPlayer[]): PlayerId[] {
  const ids = shuffled(players.map((p) => p.playerId));
  if (mode === 'podium' || ids.length <= SHOW_ALL_UP_TO) return ids;
  return ids.slice(0, CANDIDATES_WHEN_MORE);
}

type Setup = { count: Count; mode: GameMode; labels: LabelSetId };
type Attempt = { setup: Setup; seconds: number; ranking: readonly string[] };

function question(setup: Setup, roundId: number, startedAt: number): SnapshotOf<'QUESTION'> {
  const players = PLAYERS.slice(0, setup.count);
  const candidates = candidatesFor(setup.mode, players);
  const answerStartsAt = startedAt + QUESTION_INTRO_MS;
  const me = players[0];
  if (me === undefined) throw new Error('The test page needs at least one player');
  return {
    key: GAME_KEY,
    gameId: GAME_ID,
    hostId: me.playerId,
    settings: { gameLength: 15, categories: [], mode: setup.mode },
    players: [...players],
    reclaims: [],
    phase: 'QUESTION',
    paused: false,
    you: { playerId: me.playerId, submitted: false },
    round: {
      roundId,
      number: roundId,
      total: 15,
      question: {
        id: `test${String(roundId)}`,
        text: QUESTIONS[setup.labels],
        category: 'default',
        labels: setup.labels,
      },
      candidates,
      spots: spotsFor(setup.mode, candidates.length),
      participants: players.map((p) => p.playerId),
      answerStartsAt,
      endsAt: answerStartsAt + ROUND_MS,
      ready: [],
      subjectId: null,
    },
  };
}

export function RankingPrototype() {
  const [setup, setSetup] = useState<Setup>({ count: 6, mode: 'spotlight', labels: 'likely' });
  const [snapshot, setSnapshot] = useState(() => question(setup, 1, Date.now()));
  const [attempts, setAttempts] = useState<readonly Attempt[]>([]);

  const restart = (next: Setup) => {
    setSetup(next);
    setSnapshot(question(next, snapshot.round.roundId + 1, Date.now()));
  };

  const env = useMemo<ScreenEnv>(
    () => ({
      serverNow: () => Date.now(),
      frozen: false,
      pending: new Set(),
      actions: {
        ...FROZEN_ACTIONS,
        submit: (ranking) => {
          const names = new Map(snapshot.players.map((p) => [p.playerId, p.nickname]));
          const seconds = (Date.now() - snapshot.round.answerStartsAt) / 1000;
          setAttempts((list) => [
            { setup, seconds, ranking: ranking.map((id) => names.get(id) ?? id) },
            ...list.slice(0, 4),
          ]);
          setSnapshot({
            ...snapshot,
            you: { ...snapshot.you, submitted: true },
            round: { ...snapshot.round, ready: [snapshot.you.playerId] },
          });
          return true;
        },
      },
    }),
    [snapshot, setup],
  );

  const podiumAllowed = setup.count >= PODIUM_MIN_PLAYERS;
  return (
    <Stack gap="4">
      <Card label="Ranking test settings">
        <Text variant="label">Players</Text>
        <SegmentedControl<Count>
          label="Players"
          value={setup.count}
          options={COUNTS.map((n) => ({ value: n, label: String(n) }))}
          onChange={(count) => {
            const mode = count < PODIUM_MIN_PLAYERS ? 'spotlight' : setup.mode;
            restart({ ...setup, count, mode });
          }}
        />
        <Text variant="label">Mode</Text>
        <SegmentedControl<GameMode>
          label="Mode"
          value={setup.mode}
          options={[
            { value: 'spotlight', label: 'Spotlight' },
            { value: 'podium', label: 'Podium', disabled: !podiumAllowed },
          ]}
          onChange={(mode) => {
            restart({ ...setup, mode });
          }}
        />
        <Text variant="label">Words</Text>
        <SegmentedControl<LabelSetId>
          label="Words"
          value={setup.labels}
          options={[
            { value: 'likely', label: placeLabel('likely', 1, null) },
            { value: 'most', label: placeLabel('most', 1, null) },
          ]}
          onChange={(labels) => {
            restart({ ...setup, labels });
          }}
        />
        <Button
          variant="secondary"
          block
          onClick={() => {
            restart(setup);
          }}
        >
          New question
        </Button>
        {attempts.map((attempt, i) => (
          <Text key={i} variant="small">
            {`${attempt.seconds.toFixed(1)} s: ${String(attempt.setup.count)} players, ${attempt.setup.mode}: ${attempt.ranking.join(', ')}`}
          </Text>
        ))}
      </Card>
      <ScreenEnvContext.Provider value={env}>
        <QuestionScreen key={snapshot.round.roundId} snapshot={snapshot} />
      </ScreenEnvContext.Provider>
    </Stack>
  );
}
