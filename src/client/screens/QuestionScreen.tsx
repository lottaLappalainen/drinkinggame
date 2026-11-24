// Screens 4a–4c — a question round (G-34…G-40, G-49). The step (intro → answering → waiting →
// time's up) comes from the round's timestamps and the synced clock (shared/timeline.ts), with ONE
// timer to the next boundary — a phone that comes back mid-round lands on the right step.
import { useState } from 'preact/hooks';
import type { PlayerId, PublicPlayer, SnapshotOf } from '../../shared/protocol';
import { placeLabel } from '../../shared/questionLabels';
import { isWaitingForNextRound } from '../../shared/ready';
import { isPartialRanking } from '../../shared/spots';
import { nextRoundStepAt, roundStep } from '../../shared/timeline';
import { dragStartFor, isComplete, type Placement } from '../ranking/gesture';
import { RankingBoard } from '../ranking/RankingBoard';
import { STRINGS } from '../strings';
import { Button } from '../ui/Controls';
import { Countdown, ReadyList, readyCountOf } from '../ui/Game';
import { Center, Dock, Screen, Spacer, Stack } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';
import { useEnv, useNowUntil } from './env';
import { GameMenu, PausedBanner, photoSource, ReclaimPrompts, RoundHeader } from './parts';

export function QuestionScreen(props: { snapshot: SnapshotOf<'QUESTION'> }) {
  const { snapshot } = props;
  const env = useEnv();
  const { round } = snapshot;
  const me = snapshot.you.playerId;
  const source = photoSource(snapshot);
  const at = env.serverNow();
  const now = useNowUntil(nextRoundStepAt(at, round, snapshot.you.submitted));
  const step = roundStep(now, round, snapshot.you.submitted);
  const mine = snapshot.players.find((p) => p.playerId === me);
  // The snapshot always lists its own viewer (checkSnapshotInvariants).
  if (mine === undefined) throw new Error('the snapshot does not list its viewer');
  const watching = isWaitingForNextRound(me, mine.status, round);
  const counter = readyCountOf(round, snapshot.players);

  if (step === 'intro')
    return (
      <Screen center label={STRINGS.round.number(round.number, round.total)}>
        <RoundHeader round={round} />
        <Center grow>
          <Text variant="questionLarge" center>
            {round.question.text}
          </Text>
        </Center>
        <PausedBanner paused={snapshot.paused} />
        <ReclaimPrompts snapshot={snapshot} />
        <GameMenu snapshot={snapshot} />
      </Screen>
    );

  const countdown = (
    <Countdown
      startsAt={round.answerStartsAt}
      endsAt={round.endsAt}
      now={now}
      frozen={env.frozen}
    />
  );
  const readyLine = (
    <Text variant="small" center live>
      {STRINGS.round.readyCount(counter.ready, counter.total)}
    </Text>
  );

  if (step === 'answering' && !watching)
    return (
      <Screen label={STRINGS.round.number(round.number, round.total)}>
        <Stack gap="2">
          <RoundHeader round={round} />
          <Text variant="question">{round.question.text}</Text>
          {countdown}
        </Stack>
        <Answer key={round.roundId} snapshot={snapshot} />
        {readyLine}
        <PausedBanner paused={snapshot.paused} />
        <ReclaimPrompts snapshot={snapshot} />
        <GameMenu snapshot={snapshot} />
      </Screen>
    );

  // Waiting for the others, time's up, or a late joiner watching (G-19).
  return (
    <Screen label={STRINGS.round.number(round.number, round.total)}>
      <Stack gap="2">
        <RoundHeader round={round} />
        <Text variant="question">{round.question.text}</Text>
        {step === 'closed' ? <Text variant="muted">{STRINGS.round.timeUp}</Text> : countdown}
      </Stack>
      {watching ? (
        <Text variant="muted" center>
          {STRINGS.round.notThisRound}
        </Text>
      ) : (
        <Heading level={2}>{STRINGS.round.waitingTitle}</Heading>
      )}
      {readyLine}
      <ReadyList
        participants={round.participants}
        ready={round.ready}
        players={snapshot.players}
        source={source}
        me={me}
      />
      <PausedBanner paused={snapshot.paused} />
      <ReclaimPrompts snapshot={snapshot} />
      <Spacer />
      <GameMenu snapshot={snapshot} />
    </Screen>
  );
}

/** The ranking board (drag or tap) + Ready (G-36, G-37). */
function Answer(props: { snapshot: SnapshotOf<'QUESTION'> }) {
  const env = useEnv();
  const { round } = props.snapshot;
  const byId = new Map(props.snapshot.players.map((p) => [p.playerId, p]));
  const candidates = round.candidates
    .map((id) => byId.get(id))
    .filter((p): p is PublicPlayer => p !== undefined);
  const [placement, setPlacement] = useState<Placement>(() =>
    Array<PlayerId | null>(round.spots).fill(null),
  );
  const partial = isPartialRanking(round.spots, round.candidates.length);
  const labels = round.question.labels;
  const captionFor = (spot: number): string | null => {
    // Partial (Podium): every spot is a podium place — never "least". Full: the two ends (G-36).
    if (partial) return placeLabel(labels, spot + 1, null);
    if (spot === 0 || spot === round.spots - 1) return placeLabel(labels, spot + 1, round.spots);
    return null;
  };
  const sending = env.pending.has('submit');

  return (
    <Stack gap="4">
      <Stack gap="1" align="center">
        <Text variant="label" center>
          {partial ? STRINGS.round.placeTop(round.spots) : STRINGS.round.placeAll}
        </Text>
        <Text variant="small" center>
          {STRINGS.ranking.howTo[dragStartFor(candidates.length)]}
        </Text>
      </Stack>
      <RankingBoard
        candidates={candidates}
        spots={round.spots}
        captionFor={captionFor}
        placement={placement}
        onChange={setPlacement}
        source={photoSource(props.snapshot)}
        disabled={sending}
      />
      {/* Pinned to the bottom: with a long Podium list, Ready must not hide below it. */}
      <Dock>
        <Button
          size="lg"
          block
          variant="accent"
          disabled={!isComplete(placement)}
          busy={sending}
          onClick={() => {
            if (isComplete(placement)) env.actions.submit(placement);
          }}
        >
          {STRINGS.round.ready}
        </Button>
      </Dock>
    </Stack>
  );
}
