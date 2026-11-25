// The 🤖 button and the "Test bots" sheet (step 10d, dev / staging only). Rendered by app.tsx next
// to the game screen — never inside a screen — and loaded with import() only outside production.
// Texts are dev-only, so they live here, not in client/strings.ts (still no em dashes).
import { useState } from 'preact/hooks';
import { MAX_PLAYERS } from '../../../shared/constants';
import type { GameKey, Snapshot } from '../../../shared/protocol';
import { Button, IconButton, SegmentedControl } from '../../ui/Controls';
import { Modal } from '../../ui/Feedback';
import { Row, Stack } from '../../ui/Layout';
import { Text } from '../../ui/Text';
import { ANSWER_SPEEDS, type AnswerSpeed } from './brain';
import styles from './BotPanel.module.css';
import { SHOW_TEST_BOTS } from './flag';
import { fleetFor } from './fleet';

const SPEED_LABELS: Record<AnswerSpeed, string> = {
  fast: 'Fast',
  normal: 'Normal',
  slow: 'Slow',
  never: 'Never',
};
const DEFAULT_COUNT = 5;

export function BotPanel(props: { gameKey: GameKey; snapshot: Snapshot }) {
  if (!SHOW_TEST_BOTS) return null;
  return <Panel {...props} />;
}

function Panel(props: { gameKey: GameKey; snapshot: Snapshot }) {
  const fleet = fleetFor(props.gameKey);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const bots = fleet.view.value;
  const offline = fleet.offlineCount.value;
  const active = props.snapshot.players.filter((p) => p.status === 'active');
  // Bots still joining aren't in the snapshot yet: count them too, so "Add" never overshoots.
  const joining = bots.filter((b) => b.status === 'joining…').length;
  const room = Math.max(0, MAX_PLAYERS - active.length - joining);
  const howMany = Math.min(count, room);

  const add = () => {
    fleet.add(howMany, new Set(props.snapshot.players.map((p) => p.nickname.toLowerCase())));
  };

  return (
    <>
      <button
        type="button"
        class={styles.fab}
        aria-label={`Test bots (${String(bots.length)})`}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span aria-hidden="true">🤖</span>
        {bots.length > 0 && <span class={styles.count}>{bots.length}</span>}
      </button>
      <Modal
        open={open}
        label="Test bots"
        title="Test bots"
        onClose={() => {
          setOpen(false);
        }}
      >
        <Stack gap="4">
          <Row gap="3">
            <Text variant="label">How many?</Text>
            <IconButton
              label="Fewer"
              onClick={() => {
                setCount((n) => Math.max(1, n - 1));
              }}
            >
              −
            </IconButton>
            <Text strong>{String(howMany)}</Text>
            <IconButton
              label="More"
              onClick={() => {
                setCount((n) => Math.min(MAX_PLAYERS - 1, n + 1));
              }}
            >
              +
            </IconButton>
          </Row>
          <SegmentedControl
            label="How they answer"
            options={ANSWER_SPEEDS.map((value) => ({ value, label: SPEED_LABELS[value] }))}
            value={fleet.speed.value}
            onChange={(value) => {
              fleet.speed.value = value;
            }}
          />
          <Text variant="small">
            Fast: 1 to 3 s. Normal: 3 to 20 s. Slow: some miss the timer. Never: no answers.
          </Text>
          <Button block disabled={howMany === 0} onClick={add}>
            {howMany === 1 ? 'Add 1 bot' : `Add ${String(howMany)} bots`}
          </Button>
          <Text variant="small">{`Room for ${String(room)} more players in this game.`}</Text>

          {bots.length > 0 && (
            <Stack gap="1">
              <Text variant="label">{`Bots in this game: ${String(bots.length)}`}</Text>
              {bots.map((bot) => (
                <Text key={bot.id} variant="small">{`🤖 ${bot.name}: ${bot.status}`}</Text>
              ))}
            </Stack>
          )}
          {bots.length > 0 && (
            <Row gap="2" wrap>
              <Button variant="secondary" onClick={fleet.takeOneOffline}>
                Take 1 offline
              </Button>
              {offline > 0 && (
                <Button variant="secondary" onClick={fleet.bringBackOffline}>
                  {`Bring back ${String(offline)}`}
                </Button>
              )}
              <Button variant="ghost" onClick={fleet.removeAll}>
                Remove all bots
              </Button>
            </Row>
          )}
          <Text variant="small">
            The bots run in this tab. If the screen locks or the tab closes, they go offline like
            real phones.
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
