// Screen 5 — Results (G-45, G-50, S-4…S-8). The reveal is driven by the server's timestamps
// (shared/reveal.ts): every phone shows the same step at the same moment, and a phone that comes
// back mid-reveal jumps to the current one. Places only — never vote counts (S-6). The words come
// from the question's label set (Q-8); a partial ranking (Podium) has no "least" and a "No votes"
// group. The host's Next unlocks exactly at revealEndsAt (never the server's early tolerance).
// Each step announces its drinking rule a beat after the names (D-6); the full ranking keeps the
// rules next to the revealed places until Next.
import type {
  DrinkRule,
  PlayerId,
  PublicPlayer,
  RankedResults,
  SnapshotOf,
} from '../../shared/protocol';
import { MIN_ANSWERS_FOR_RANKING, REVEAL_RULE_DELAY_MS } from '../../shared/constants';
import { DRINK_RULES } from '../../shared/drinkRules';
import { NO_VOTES_LABEL, placeLabel, rankingOrderLabel } from '../../shared/questionLabels';
import { nextRevealChangeAt, revealPosition, revealStepStartsAt } from '../../shared/reveal';
import { isPartialRanking } from '../../shared/spots';
import { STRINGS } from '../strings';
import { Button } from '../ui/Controls';
import { Card } from '../ui/Feedback';
import {
  DrinkBadge,
  DrinkChip,
  Drumroll,
  PlayerChip,
  PlayerList,
  QuestionText,
  RevealStep,
  type PhotoSource,
} from '../ui/Game';
import { Center, Row, Screen, Spacer, Stack } from '../ui/Layout';
import { PlaceNumber } from '../ui/PlaceNumber';
import { Heading, Text } from '../ui/Text';
import { useEnv, useNowUntil } from './env';
import { GameMenu, PausedBanner, photoSource, ReclaimPrompts, RoundHeader } from './parts';

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
      </Stack>
    ) : null;

  return (
    <Screen label={STRINGS.results.revealing}>
      <Stack gap="2">
        <RoundHeader round={round} />
        <QuestionText
          text={round.question.text}
          subject={snapshot.players.find((p) => p.playerId === round.subjectId)}
        />
      </Stack>
      <PausedBanner paused={snapshot.paused} />
      <ReclaimPrompts snapshot={snapshot} />
      {results.outcome === 'ranked' ? (
        <Ranked snapshot={snapshot} results={results} position={position} now={now} />
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
              : STRINGS.results.notEnoughBody(MIN_ANSWERS_FOR_RANKING)}
          </Text>
        </Center>
      )}
      <Spacer />
      {footer}
      <GameMenu snapshot={snapshot} />
    </Screen>
  );
}

function Ranked(props: {
  snapshot: SnapshotOf<'RESULTS'>;
  results: RankedResults;
  position: ReturnType<typeof revealPosition>;
  now: number;
}) {
  const { snapshot, results, position } = props;
  const me = snapshot.you.playerId;
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
      // The rule shows a beat after the names, timed from the server's step start (D-6).
      const stepStartsAt = revealStepStartsAt(
        results.revealStartsAt,
        results.steps.length,
        position.index,
      );
      return (
        <Center grow>
          <RevealStep
            key={position.index}
            label={placeLabel(labels, step.place, lastPlace)}
            players={players(step.playerIds)}
            source={source}
            top={step.kind === 'top'}
            rule={
              step.rule === null
                ? undefined
                : {
                    kind: step.kind,
                    rule: step.rule,
                    appearInMs: stepStartsAt + REVEAL_RULE_DELAY_MS - props.now,
                  }
            }
            you={step.playerIds.includes(me)}
          />
        </Center>
      );
    }
    case 'done':
      return (
        <FullRanking
          results={results}
          orderLabel={rankingOrderLabel(labels, partial)}
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

/** Long past: a badge shown without its entrance or roll (the full ranking's "you" line). */
const SETTLED_MS = -60_000;

/**
 * After the reveal: everyone with a place (revealed places keep their drinking rule, D-6), then
 * (Podium) the "No votes" group. If the viewer has a rule, it's repeated on top. Each row starts
 * with its place number (medals for 1–3, ties share them); a line under the heading says which way
 * the list runs, so the rows need no place words.
 */
function FullRanking(props: {
  results: RankedResults;
  /** "From most likely to least likely" — shared/questionLabels.ts `rankingOrderLabel`. */
  orderLabel: string;
  players: (ids: readonly PlayerId[]) => PublicPlayer[];
  source: PhotoSource;
  me: PlayerId;
}) {
  const { results } = props;
  // Each ranking entry with its player (entries name players of this game — invariants).
  const ranked = results.ranking.flatMap((entry) =>
    props.players([entry.playerId]).map((player) => ({ player, place: entry.place })),
  );
  const noVotes = results.noVotes === null ? [] : props.players(results.noVotes);
  // Who has which rule: everyone in a reveal step (middle places and "No votes" have none, D-4).
  const rules = new Map<PlayerId, DrinkRule>();
  const myStep = results.steps.find((step) => step.playerIds.includes(props.me));
  for (const step of results.steps)
    if (step.rule !== null) for (const id of step.playerIds) rules.set(id, step.rule);
  return (
    <Stack gap="3">
      {myStep?.rule != null && (
        <Center>
          <DrinkBadge
            rule={myStep.rule}
            range={DRINK_RULES[myStep.kind]}
            appearInMs={SETTLED_MS}
            you
          />
        </Center>
      )}
      <Stack gap="1">
        <Heading level={2}>{STRINGS.results.fullRanking}</Heading>
        <Text variant="small">{props.orderLabel}</Text>
      </Stack>
      <PlayerList
        label={STRINGS.results.fullRanking}
        items={ranked.map(({ player, place }) => {
          const rule = rules.get(player.playerId);
          return {
            key: player.playerId,
            content: (
              <Row gap="3">
                <PlaceNumber place={place} />
                <Stack grow gap="0">
                  <PlayerChip
                    player={player}
                    source={props.source}
                    isYou={player.playerId === props.me}
                    meta={rule !== undefined && <DrinkChip rule={rule} />}
                  />
                </Stack>
              </Row>
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
