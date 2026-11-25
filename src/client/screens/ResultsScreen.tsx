// Screen 5 — Results (G-45, G-50, S-4…S-8). The reveal is driven by the server's timestamps
// (shared/reveal.ts): every phone shows the same step at the same moment, and a phone that comes
// back mid-reveal jumps to the current one. Places only — never vote counts (S-6). The words come
// from the question's label set (Q-8); a partial ranking (Podium) has no "least", and the players
// nobody placed share the last place. The host's Next unlocks exactly at revealEndsAt (never the server's early tolerance).
// Each step announces its drinking rule a beat after the names (D-6); the full ranking keeps the
// rules next to the revealed places until Next.
import type { ComponentChildren } from 'preact';
import type {
  DrinkRule,
  PlayerId,
  PublicPlayer,
  RankedResults,
  SnapshotOf,
} from '../../shared/protocol';
import { MIN_ANSWERS_FOR_RANKING, REVEAL_RULE_DELAY_MS } from '../../shared/constants';
import { DRINK_RULES } from '../../shared/drinkRules';
import { placeLabel, rankingOrderLabel } from '../../shared/questionLabels';
import { nextRevealChangeAt, revealPosition, revealStepStartsAt } from '../../shared/reveal';
import { isPartialRanking } from '../../shared/spots';
import { STRINGS } from '../strings';
import { Button } from '../ui/Controls';
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
import { PodiumTray } from '../ui/Podium';
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

  // 3rd and 2nd place stay on screen in the podium tray once their own step is over (G-50). Every
  // reveal position below uses the same layout, so the tray stays mounted and its cards don't
  // replay their entrance at each step change.
  const revealedUpTo =
    position.kind === 'step'
      ? position.index - 1
      : position.kind === 'drumroll'
        ? position.afterStep
        : -1;
  // The tray's halves: silver left, bronze right — only the ones this reveal has (a tie or 3
  // players can leave one out); each stays empty (null) until its step is over.
  const podium = (['second', 'third'] as const).flatMap((kind) => {
    const index = results.steps.findIndex((step) => step.kind === kind);
    const step = results.steps[index];
    if (step === undefined) return [];
    return [index <= revealedUpTo ? { place: step.place, players: players(step.playerIds) } : null];
  });
  const withTray = (main: ComponentChildren) => (
    <Stack grow gap="5">
      <Center grow>{main}</Center>
      <PodiumTray slots={podium} source={source} label={STRINGS.results.podiumSoFar} />
    </Stack>
  );

  switch (position.kind) {
    case 'pending':
      return withTray(
        <Heading level={2} center>
          {STRINGS.results.revealing}
        </Heading>,
      );
    case 'drumroll':
      return withTray(<Drumroll />);
    case 'step': {
      const step = results.steps[position.index];
      if (step === undefined) return null;
      // The rule shows a beat after the names, timed from the server's step start (D-6).
      const stepStartsAt = revealStepStartsAt(
        results.revealStartsAt,
        results.steps.length,
        position.index,
      );
      return withTray(
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
        />,
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
 * After the reveal: everyone with a place (revealed places keep their drinking rule, D-6). In
 * Podium, players nobody placed simply share the last place at the bottom (user 2026-11-25: no
 * separate "No votes" group); they never have a rule (D-4). If the viewer has a rule, it's repeated on top. Each row starts
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
  // Nobody placed them: tied for the place after everyone who got points (1, 2, 2, 4 → 5).
  const lastPlace = ranked.length + 1;
  const unplaced = (results.noVotes === null ? [] : props.players(results.noVotes)).map(
    (player) => ({ player, place: lastPlace }),
  );
  // Who has which rule: everyone in a reveal step (middle places and the unplaced have none, D-4).
  const rules = new Map<PlayerId, DrinkRule>();
  const myStep = results.steps.find((step) => step.playerIds.includes(props.me));
  for (const step of results.steps)
    if (step.rule !== null) for (const id of step.playerIds) rules.set(id, step.rule);
  // Two blocks, spaced like the screen's own blocks (`Screen` gap = space 5): the viewer's own rule,
  // then the ranking, whose heading and rows sit closer together (space 3).
  return (
    <Stack gap="5">
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
      <Stack gap="3">
        <Stack gap="1">
          <Heading level={2}>{STRINGS.results.fullRanking}</Heading>
          <Text variant="small">{props.orderLabel}</Text>
        </Stack>
        <PlayerList
          label={STRINGS.results.fullRanking}
          entrance
          items={[...ranked, ...unplaced].map(({ player, place }) => {
            const rule = rules.get(player.playerId);
            return {
              key: player.playerId,
              winner: place === 1, // rises from where the gold card was (G-50)
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
        {results.noVotes === null && <Text variant="small">{STRINGS.results.onlyTop}</Text>}
      </Stack>
    </Stack>
  );
}
