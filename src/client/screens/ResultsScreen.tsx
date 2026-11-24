// Screen 5 — Results (G-45, G-50, S-4…S-8). The reveal is driven by the server's timestamps
// (shared/reveal.ts): every phone shows the same step at the same moment, and a phone that comes
// back mid-reveal jumps to the current one. Places only — never vote counts (S-6). The words come
// from the question's label set (Q-8); a partial ranking (Podium) has no "least" and a "No votes"
// group. The host's Next unlocks exactly at revealEndsAt (never the server's early tolerance).
import type { PlayerId, PublicPlayer, RankedResults, SnapshotOf } from '../../shared/protocol';
import { NO_VOTES_LABEL, placeLabel } from '../../shared/questionLabels';
import { nextRevealChangeAt, revealPosition } from '../../shared/reveal';
import { isPartialRanking } from '../../shared/spots';
import { STRINGS } from '../strings';
import { Button } from '../ui/Controls';
import { Card } from '../ui/Feedback';
import { Drumroll, PlayerChip, PlayerList, RevealStep, type PhotoSource } from '../ui/Game';
import { Center, Row, Screen, Spacer, Stack } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';
import { useEnv, useNowUntil } from './env';
import { EndGameButton, PausedBanner, photoSource, RoundHeader } from './parts';

export function ResultsScreen(props: { snapshot: SnapshotOf<'RESULTS'> }) {
  const { snapshot } = props;
  const env = useEnv();
  const { round, results } = snapshot;
  const me = snapshot.you.playerId;
  const isHost = snapshot.hostId === me;
  const stepCount = results.outcome === 'ranked' ? results.steps.length : 0;
  const at = env.serverNow();
  const now = useNowUntil(nextRevealChangeAt(at, results.revealStartsAt, stepCount));
  const position = revealPosition(now, results.revealStartsAt, stepCount);
  const isLast = round.number >= round.total;
  // Finish is allowed while paused; Next is not (G-42, G-45).
  const nextBlocked = snapshot.paused && !isLast;

  const footer =
    position.kind === 'done' ? (
      <Stack gap="2">
        {isHost ? (
          <Button
            size="lg"
            block
            disabled={nextBlocked}
            busy={env.pending.has('advance')}
            onClick={env.actions.advance}
          >
            {isLast ? STRINGS.results.finish : STRINGS.results.next}
          </Button>
        ) : (
          <Text variant="muted" center live>
            {STRINGS.results.waitingForHost}
          </Text>
        )}
        <Row justify="center">
          <EndGameButton isHost={isHost} />
        </Row>
      </Stack>
    ) : null;

  return (
    <Screen label={STRINGS.results.revealing}>
      <Stack gap="2">
        <RoundHeader round={round} />
        <Text variant="question">{round.question.text}</Text>
      </Stack>
      <PausedBanner paused={snapshot.paused} />
      {results.outcome === 'ranked' ? (
        <Ranked snapshot={snapshot} results={results} position={position} />
      ) : (
        <Center grow>
          <Heading level={2} center>
            {results.outcome === 'nobodyAnswered'
              ? STRINGS.results.nobody
              : STRINGS.results.notEnough}
          </Heading>
          <Text variant="muted" center>
            {results.outcome === 'nobodyAnswered'
              ? STRINGS.results.nobodyBody
              : STRINGS.results.notEnoughBody}
          </Text>
        </Center>
      )}
      <Spacer />
      {footer}
    </Screen>
  );
}

function Ranked(props: {
  snapshot: SnapshotOf<'RESULTS'>;
  results: RankedResults;
  position: ReturnType<typeof revealPosition>;
}) {
  const { snapshot, results, position } = props;
  const source = photoSource(snapshot);
  const labels = snapshot.round.question.labels;
  const partial = isPartialRanking(snapshot.round.spots, snapshot.round.candidates.length);
  const lastPlace = partial ? null : Math.max(...results.ranking.map((e) => e.place));
  const byId = new Map(snapshot.players.map((p) => [p.playerId, p]));
  const players = (ids: readonly PlayerId[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is PublicPlayer => p !== undefined);

  switch (position.kind) {
    case 'pending':
      return (
        <Center grow>
          <Heading level={2} center>
            {STRINGS.results.revealing}
          </Heading>
        </Center>
      );
    case 'drumroll':
      return (
        <Center grow>
          <Drumroll />
        </Center>
      );
    case 'step': {
      const step = results.steps[position.index];
      if (step === undefined) return null;
      return (
        <Center grow>
          <RevealStep
            key={position.index}
            label={placeLabel(labels, step.place, lastPlace)}
            players={players(step.playerIds)}
            source={source}
            top={step.kind === 'top'}
          />
        </Center>
      );
    }
    case 'done':
      return (
        <FullRanking
          results={results}
          labelOf={(place) => placeLabel(labels, place, lastPlace)}
          players={players}
          source={source}
          me={snapshot.you.playerId}
        />
      );
    default: {
      const unknown: never = position;
      return unknown;
    }
  }
}

/** After the reveal: everyone with a place, then (Podium) the "No votes" group. */
function FullRanking(props: {
  results: RankedResults;
  labelOf: (place: number) => string;
  players: (ids: readonly PlayerId[]) => PublicPlayer[];
  source: PhotoSource;
  me: PlayerId;
}) {
  const { results } = props;
  const ranked = props.players(results.ranking.map((e) => e.playerId));
  const placeOf = new Map(results.ranking.map((e) => [e.playerId, e.place]));
  const noVotes = results.noVotes === null ? [] : props.players(results.noVotes);
  return (
    <Stack gap="3">
      <Heading level={2}>{STRINGS.results.fullRanking}</Heading>
      <PlayerList
        label={STRINGS.results.fullRanking}
        items={ranked.map((player) => {
          const place = placeOf.get(player.playerId) ?? 0;
          return {
            key: player.playerId,
            content: (
              <PlayerChip
                player={player}
                source={props.source}
                isYou={player.playerId === props.me}
                meta={<Text variant="small">{`${String(place)}. ${props.labelOf(place)}`}</Text>}
              />
            ),
          };
        })}
      />
      {noVotes.length > 0 && (
        <Card label={NO_VOTES_LABEL}>
          <Text variant="label">{NO_VOTES_LABEL}</Text>
          <PlayerList
            label={NO_VOTES_LABEL}
            items={noVotes.map((player) => ({
              key: player.playerId,
              content: (
                <PlayerChip
                  player={player}
                  source={props.source}
                  isYou={player.playerId === props.me}
                />
              ),
            }))}
          />
        </Card>
      )}
      {results.noVotes === null && <Text variant="small">{STRINGS.results.onlyTop}</Text>}
    </Stack>
  );
}
