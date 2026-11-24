// Screen 2 — Home: host or join; "Return to game" for games this phone is still in (G-17).
import { useState } from 'preact/hooks';
import { GAME_KEY_LENGTH } from '../../shared/constants';
import type { GameKey } from '../../shared/protocol';
import { isGameKey, type Profile } from '../storage';
import { STRINGS } from '../strings';
import { Button, TextInput } from '../ui/Controls';
import { Card } from '../ui/Feedback';
import { Avatar } from '../ui/Game';
import { Row, Screen, Spacer, Stack } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';

export function HomeScreen(props: {
  profile: Profile;
  savedGames: readonly GameKey[];
  creating: boolean;
  createError: string | null;
  onHost: () => void;
  onJoin: (key: GameKey) => void;
  onReturn: (key: GameKey) => void;
  onEditProfile: () => void;
}) {
  const [key, setKey] = useState('');
  const normalized = key.trim().toUpperCase();
  const valid = isGameKey(normalized);

  return (
    <Screen label={STRINGS.appName}>
      <Row gap="3">
        <Avatar presetId={props.profile.presetId} size="lg" />
        <Stack gap="0" grow>
          <Heading level={2}>{STRINGS.home.hello(props.profile.nickname)}</Heading>
        </Stack>
        <Button variant="ghost" onClick={props.onEditProfile}>
          {STRINGS.profile.edit}
        </Button>
      </Row>

      {props.savedGames.map((saved) => (
        <Button
          key={saved}
          variant="accent"
          size="lg"
          block
          onClick={() => {
            props.onReturn(saved);
          }}
        >
          {STRINGS.home.returnTo(saved)}
        </Button>
      ))}

      <Card>
        <Heading level={2}>{STRINGS.home.host}</Heading>
        <Text variant="muted">{STRINGS.home.hostHint}</Text>
        <Button size="lg" block busy={props.creating} onClick={props.onHost}>
          {STRINGS.home.host}
        </Button>
        {props.createError !== null && <Text variant="small">{STRINGS.home.createFailed}</Text>}
      </Card>

      <Card>
        <Heading level={2}>{STRINGS.home.joinTitle}</Heading>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) props.onJoin(normalized);
          }}
        >
          <Stack gap="3">
            <TextInput
              label={STRINGS.home.keyLabel}
              variant="key"
              value={key}
              maxLength={GAME_KEY_LENGTH}
              enterKeyHint="go"
              onInput={setKey}
            />
            <Button type="submit" variant="secondary" size="lg" block disabled={!valid}>
              {STRINGS.home.join}
            </Button>
          </Stack>
        </form>
      </Card>
      <Spacer />
    </Screen>
  );
}
