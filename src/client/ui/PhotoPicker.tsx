// The two photo buttons of the Profile screen (G-2, CLAUDE.md §6 "Avatars — photos"): "Take selfie"
// opens the front camera directly (`capture="user"`), "Choose photo" opens the gallery / picker
// (`capture` would skip it). The file inputs are invisible; the buttons open them. What happens to
// the picked file (media/photo.ts) is the caller's business.
import { useRef } from 'preact/hooks';
import { STRINGS } from '../strings';
import { Button } from './Controls';
import { Row, Stack } from './Layout';
import styles from './PhotoPicker.module.css';

export function PhotoPicker(props: {
  onFile: (file: File) => void;
  /** Reading / shrinking a picked photo. */
  busy?: boolean;
  /** Why the last photo couldn't be used (the preset stays). */
  error?: string | null;
}) {
  const selfie = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const onChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // picking the same file again must fire `change` again
    if (file !== undefined) props.onFile(file);
  };
  return (
    <Stack gap="2">
      <Row gap="2" wrap>
        <Button
          variant="secondary"
          busy={props.busy === true}
          onClick={() => selfie.current?.click()}
        >
          {STRINGS.profile.takeSelfie}
        </Button>
        <Button
          variant="secondary"
          busy={props.busy === true}
          onClick={() => gallery.current?.click()}
        >
          {STRINGS.profile.choosePhoto}
        </Button>
      </Row>
      <input
        ref={selfie}
        class={styles.fileInput}
        type="file"
        accept="image/*"
        capture="user"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
      <input
        ref={gallery}
        class={styles.fileInput}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
      {props.error != null && (
        <p class={styles.error} role="alert">
          {props.error}
        </p>
      )}
    </Stack>
  );
}
