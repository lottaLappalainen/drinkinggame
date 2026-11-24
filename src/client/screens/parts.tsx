// Pieces several screens share — compositions of ui/ components only (no styling here).
import { useState } from 'preact/hooks';
import { MIN_PLAYERS } from '../../shared/constants';
import { categoryById } from '../../shared/questionCategories';
import type { PublicRound, Snapshot } from '../../shared/protocol';
import type { Storage } from '../storage';
import { STRINGS } from '../strings';
import { setTheme, themeChoice, type Theme } from '../theme';
import { Button, SegmentedControl } from '../ui/Controls';
import { Badge, Banner, ConfirmDialog } from '../ui/Feedback';
import type { PhotoSource } from '../ui/Game';
import { Row } from '../ui/Layout';
import { Text } from '../ui/Text';
import { useEnv } from './env';

/** System / Light / Dark (G-7) — on the Profile screen and in the lobby. */
export function ThemePicker(props: { storage: Storage | null }) {
  const choice = themeChoice.value;
  return (
    <SegmentedControl<Theme>
      label={STRINGS.theme.label}
      value={choice}
      options={[
        { value: 'system', label: STRINGS.theme.system },
        { value: 'light', label: STRINGS.theme.light },
        { value: 'dark', label: STRINGS.theme.dark },
      ]}
      onChange={(next) => {
        if (props.storage !== null) setTheme(props.storage, next);
        else themeChoice.value = next;
      }}
    />
  );
}

/** "7 / 25" and the category tag. */
export function RoundHeader(props: { round: PublicRound }) {
  const category = categoryById(props.round.question.category);
  return (
    <Row justify="between">
      <Text variant="label">{STRINGS.round.number(props.round.number, props.round.total)}</Text>
      <Badge tone="accent">
        {category.emoji} {category.name}
      </Badge>
    </Row>
  );
}

/** G-42: shown while the game waits for players. */
export function PausedBanner(props: { paused: boolean }) {
  if (!props.paused) return null;
  return (
    <Banner tone="warning">
      <Text strong>{STRINGS.paused.title}</Text>
      <Text variant="small">{STRINGS.paused.body(MIN_PLAYERS)}</Text>
    </Banner>
  );
}

/** Where this game's photos come from. */
export function photoSource(snapshot: Snapshot): PhotoSource {
  return { key: snapshot.key, gameId: snapshot.gameId };
}

/** The host's "End game" with "Are you sure?" (G-46). */
export function EndGameButton(props: { isHost: boolean }) {
  const env = useEnv();
  const [confirming, setConfirming] = useState(false);
  if (!props.isHost) return null;
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {STRINGS.ended.endGame}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={STRINGS.ended.endTitle}
        message={STRINGS.ended.endBody}
        confirmLabel={STRINGS.ended.endGame}
        danger
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          env.actions.endGame();
        }}
      />
    </>
  );
}
