// Screens without a game snapshot: Game Over (6), the exits (not found, left, removed, reclaimed,
// opened somewhere else, please refresh), join problems (name taken / "That's me", full, invalid),
// "That's me" waiting, and connecting / reconnecting / updating.
import type { EndReason } from '../../shared/protocol';
import type { Exit, JoinError, ReclaimState } from '../store/types';
import { STRINGS } from '../strings';
import { Button, TextInput } from '../ui/Controls';
import { Banner, Spinner } from '../ui/Feedback';
import { Center, Screen, Spacer, Stack } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';
import { useEnv } from './env';
import { useState } from 'preact/hooks';
import { validateNickname } from '../../shared/nickname';
import { MAX_PLAYERS, NICKNAME_MAX_INPUT_CHARS } from '../../shared/constants';

const END_REASON_TEXT: Record<EndReason, string> = {
  finished: STRINGS.ended.finished,
  hostEnded: STRINGS.ended.hostEnded,
  updated: STRINGS.ended.updated,
};

/**
 * Screen 6 — Game Over (G-47). The summary arrives with U3. The host can take the same group back
 * to a fresh lobby ("Play again", G-52); the others are told so. Not after an update: that game
 * was replaced and has nobody to bring along.
 */
export function EndedScreen(props: { reason: EndReason; isHost: boolean; onHome: () => void }) {
  const env = useEnv();
  const canPlayAgain = props.reason !== 'updated';
  return (
    <Screen center label={STRINGS.ended.title}>
      <Center grow>
        <Stack gap="3" align="center">
          <Heading level={1} center>
            {props.reason === 'updated' ? STRINGS.ended.updatedTitle : STRINGS.ended.title}
          </Heading>
          <Text variant="muted" center>
            {END_REASON_TEXT[props.reason]}
          </Text>
        </Stack>
      </Center>
      <Stack gap="2">
        {canPlayAgain && props.isHost && (
          <>
            <Button
              size="lg"
              block
              busy={env.pending.has('playAgain')}
              onClick={env.actions.playAgain}
            >
              {STRINGS.ended.playAgain}
            </Button>
            <Text variant="small" center>
              {STRINGS.ended.playAgainHint}
            </Text>
          </>
        )}
        {canPlayAgain && !props.isHost && (
          <Text variant="muted" center live>
            {STRINGS.ended.waitingForPlayAgain}
          </Text>
        )}
        <Button
          size="lg"
          block
          variant={canPlayAgain && props.isHost ? 'ghost' : 'primary'}
          onClick={props.onHome}
        >
          {STRINGS.ended.backHome}
        </Button>
      </Stack>
    </Screen>
  );
}

/** Out of the game for this phone — one screen per reason (store/types.ts Exit). */
export function ExitScreen(props: {
  exit: Exit;
  onHome: () => void;
  onUseHere: () => void;
  onJoinAgain: () => void;
  onRefresh: () => void;
}) {
  const text = STRINGS.exit[props.exit.kind];
  return (
    <Screen center label={text.title}>
      <Center grow>
        <Stack gap="3" align="center">
          <Heading level={1} center>
            {text.title}
          </Heading>
          <Text variant="muted" center>
            {text.body}
          </Text>
        </Stack>
      </Center>
      <Stack gap="2">
        {props.exit.kind === 'replaced' && (
          <Button size="lg" block onClick={props.onUseHere}>
            {STRINGS.exit.useHere}
          </Button>
        )}
        {props.exit.kind === 'refresh' && (
          <Button size="lg" block onClick={props.onRefresh}>
            {STRINGS.exit.refreshButton}
          </Button>
        )}
        {(props.exit.kind === 'left' || props.exit.kind === 'removed') && (
          <Button size="lg" block variant="secondary" onClick={props.onJoinAgain}>
            {STRINGS.exit.joinAgain}
          </Button>
        )}
        <Button size="lg" block variant="ghost" onClick={props.onHome}>
          {STRINGS.common.home}
        </Button>
      </Stack>
    </Screen>
  );
}

/** A refused join (G-13, G-14, G-44): try another name, or "That's me" for an offline owner. */
export function JoinProblemScreen(props: {
  error: JoinError;
  nickname: string;
  onRetry: (nickname: string) => void;
  onThatsMe: () => void;
  onHome: () => void;
}) {
  const [name, setName] = useState(props.nickname);
  const result = validateNickname(name);
  if (props.error.code === 'GAME_FULL')
    return (
      <Screen center label={STRINGS.join.gameFull}>
        <Center grow>
          <Heading level={1} center>
            {STRINGS.join.gameFull}
          </Heading>
          <Text variant="muted" center>
            {STRINGS.join.gameFullBody(MAX_PLAYERS)}
          </Text>
        </Center>
        <Button size="lg" block onClick={props.onHome}>
          {STRINGS.common.home}
        </Button>
      </Screen>
    );
  const reclaimable =
    props.error.code === 'NAME_TAKEN' && props.error.reclaimPlayerId !== undefined;
  return (
    <Screen label={STRINGS.join.nameTaken}>
      <Stack gap="2">
        <Heading level={1}>
          {props.error.code === 'NAME_TAKEN' ? STRINGS.join.nameTaken : STRINGS.join.invalidName}
        </Heading>
        {props.error.code === 'NAME_TAKEN' && (
          <Text variant="muted">{STRINGS.join.nameTakenBody}</Text>
        )}
      </Stack>
      {reclaimable && (
        <Banner
          action={
            <Button variant="secondary" onClick={props.onThatsMe}>
              {STRINGS.join.thatsMe}
            </Button>
          }
        >
          <Text variant="small">{STRINGS.join.thatsMeHint}</Text>
        </Banner>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (result.ok) props.onRetry(result.nickname);
        }}
      >
        <Stack gap="3">
          <TextInput
            label={STRINGS.profile.nickname}
            value={name}
            maxLength={NICKNAME_MAX_INPUT_CHARS}
            enterKeyHint="go"
            onInput={setName}
          />
          <Button type="submit" size="lg" block disabled={!result.ok}>
            {STRINGS.join.tryName}
          </Button>
        </Stack>
      </form>
      <Spacer />
      <Button variant="ghost" block onClick={props.onHome}>
        {STRINGS.common.home}
      </Button>
    </Screen>
  );
}

/** "That's me" sent: waiting for the host (G-44). */
export function ReclaimScreen(props: {
  state: ReclaimState;
  onCancel: () => void;
  onHome: () => void;
}) {
  const denied = props.state.status === 'denied';
  return (
    <Screen center label={STRINGS.join.reclaimWaiting}>
      <Center grow>
        <Stack gap="3" align="center">
          {!denied && <Spinner label={STRINGS.join.reclaimWaiting} />}
          <Heading level={1} center>
            {denied ? STRINGS.join.reclaimDenied : STRINGS.join.reclaimWaiting}
          </Heading>
          <Text variant="muted" center>
            {denied ? STRINGS.join.reclaimDeniedBody : STRINGS.join.reclaimWaitingBody}
          </Text>
        </Stack>
      </Center>
      <Button size="lg" block variant="ghost" onClick={denied ? props.onHome : props.onCancel}>
        {denied ? STRINGS.common.home : STRINGS.common.cancel}
      </Button>
    </Screen>
  );
}

/** No snapshot yet: connecting, reconnecting, or the server is being updated. */
export function ConnectingScreen(props: {
  reconnecting: boolean;
  updating: boolean;
  onHome: () => void;
}) {
  const text = props.updating
    ? STRINGS.common.updating
    : props.reconnecting
      ? STRINGS.common.reconnecting
      : STRINGS.common.connecting;
  return (
    <Screen center label={text}>
      <Center grow>
        <Stack gap="3" align="center">
          <Spinner label={text} />
          <Text variant="muted" center live>
            {text}
          </Text>
        </Stack>
      </Center>
      <Button variant="ghost" block onClick={props.onHome}>
        {STRINGS.common.home}
      </Button>
    </Screen>
  );
}
