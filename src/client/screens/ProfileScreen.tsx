// Screen 1 — Profile (G-1, G-2, G-3, G-7): nickname, ready-made avatar, theme. Shown on the first
// visit and from "Edit profile". The photo buttons arrive with 5D (photo pipeline).
import { useState } from 'preact/hooks';
import type { PresetId } from '../../shared/avatars';
import { NICKNAME_MAX_GRAPHEMES, NICKNAME_MAX_INPUT_CHARS } from '../../shared/constants';
import { validateNickname } from '../../shared/nickname';
import type { Profile, Storage } from '../storage';
import { STRINGS } from '../strings';
import { Button, TextInput } from '../ui/Controls';
import { AvatarPicker, Avatar } from '../ui/Game';
import { Center, Screen, Stack } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';
import { ThemePicker } from './parts';

export function ProfileScreen(props: {
  initial: Profile;
  submitLabel: string;
  onSave: (profile: Profile) => void;
  onCancel?: () => void;
  storage: Storage | null;
}) {
  const [nickname, setNickname] = useState(props.initial.nickname);
  const [presetId, setPresetId] = useState<PresetId>(props.initial.presetId);
  const [touched, setTouched] = useState(false);
  const result = validateNickname(nickname);
  const error =
    touched && !result.ok
      ? result.reason === 'empty'
        ? STRINGS.profile.nicknameEmpty
        : STRINGS.profile.nicknameTooLong(NICKNAME_MAX_GRAPHEMES)
      : null;

  return (
    <Screen label={STRINGS.profile.title}>
      <Stack gap="2">
        <Heading level={1}>{STRINGS.profile.title}</Heading>
        <Text variant="muted">{STRINGS.profile.intro}</Text>
      </Stack>
      <Center>
        <Avatar presetId={presetId} size="xl" />
      </Center>
      <TextInput
        label={STRINGS.profile.nickname}
        value={nickname}
        hint={STRINGS.profile.nicknameHint(NICKNAME_MAX_GRAPHEMES)}
        error={error}
        maxLength={NICKNAME_MAX_INPUT_CHARS}
        enterKeyHint="done"
        onInput={(value) => {
          setNickname(value);
          setTouched(true);
        }}
      />
      <Stack gap="2">
        <Text variant="label">{STRINGS.profile.picture}</Text>
        <AvatarPicker label={STRINGS.profile.picture} value={presetId} onChange={setPresetId} />
        <Text variant="small">{STRINGS.profile.photoSoon}</Text>
      </Stack>
      <Stack gap="2">
        <Text variant="label">{STRINGS.theme.label}</Text>
        <ThemePicker storage={props.storage} />
      </Stack>
      <Stack gap="2">
        <Button
          size="lg"
          block
          disabled={!result.ok}
          onClick={() => {
            if (result.ok) props.onSave({ nickname: result.nickname, presetId });
            else setTouched(true);
          }}
        >
          {props.submitLabel}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" block onClick={props.onCancel}>
            {STRINGS.common.cancel}
          </Button>
        )}
      </Stack>
    </Screen>
  );
}
