// Screen 1 — Profile (G-1, G-2, G-3, G-7): nickname, picture (ready-made avatar OR a photo), theme.
// Shown on the first visit and from "Edit profile". A picked photo is shrunk on the phone right away
// (media/photo.ts) and handed over on Save; picking an emoji afterwards drops it (G-2: one or the
// other).
import { useState } from 'preact/hooks';
import type { PresetId } from '../../shared/avatars';
import { NICKNAME_MAX_GRAPHEMES, NICKNAME_MAX_INPUT_CHARS } from '../../shared/constants';
import { validateNickname } from '../../shared/nickname';
import { preparePhoto } from '../media/photo';
import type { Profile } from '../storage';
import { STRINGS } from '../strings';
import { Button, TextInput } from '../ui/Controls';
import { AvatarPicker, Avatar } from '../ui/Game';
import { Center, Screen, Stack } from '../ui/Layout';
import { PhotoPicker } from '../ui/PhotoPicker';
import { Heading, Text } from '../ui/Text';

export function ProfileScreen(props: {
  initial: Profile;
  /** The saved photo (a data URL), if any. */
  initialPhoto: string | null;
  submitLabel: string;
  onSave: (profile: Profile, photo: string | null) => void;
  onCancel?: () => void;
}) {
  const [nickname, setNickname] = useState(props.initial.nickname);
  const [presetId, setPresetId] = useState<PresetId>(props.initial.presetId);
  const [photo, setPhoto] = useState<string | null>(props.initialPhoto);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const result = validateNickname(nickname);
  const error =
    touched && !result.ok
      ? result.reason === 'empty'
        ? STRINGS.profile.nicknameEmpty
        : STRINGS.profile.nicknameTooLong(NICKNAME_MAX_GRAPHEMES)
      : null;

  const onFile = (file: File) => {
    setPhotoBusy(true);
    setPhotoError(null);
    void preparePhoto(file).then((prepared) => {
      setPhotoBusy(false);
      if (prepared.ok) setPhoto(prepared.dataUrl);
      else
        setPhotoError(
          prepared.reason === 'unreadable'
            ? STRINGS.profile.photoUnreadable
            : STRINGS.profile.photoFailed,
        );
    });
  };

  return (
    <Screen label={STRINGS.profile.title}>
      <Stack gap="2">
        <Heading level={1}>{STRINGS.profile.title}</Heading>
        <Text variant="muted">{STRINGS.profile.intro}</Text>
      </Stack>
      <Center>
        <Avatar key={photo ?? ''} presetId={presetId} photo={photo} size="xl" />
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
        <AvatarPicker
          label={STRINGS.profile.picture}
          value={presetId}
          onChange={(next) => {
            setPresetId(next);
            setPhoto(null); // G-2: an emoji OR a photo
          }}
        />
        {photo !== null && <Text variant="small">{STRINGS.profile.photoInUse}</Text>}
        <Text variant="small">{STRINGS.profile.photoOr}</Text>
        <PhotoPicker onFile={onFile} busy={photoBusy} error={photoError} />
      </Stack>
      <Stack gap="2">
        <Button
          size="lg"
          block
          disabled={!result.ok || photoBusy}
          onClick={() => {
            if (result.ok) props.onSave({ nickname: result.nickname, presetId }, photo);
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
