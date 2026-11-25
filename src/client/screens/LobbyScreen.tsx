// Screen 3 — Lobby (G-5, G-20…G-24, G-41, G-43, G-44): the key, link + QR (the main way to join),
// the live player list, the settings (host changes them, everyone sees them), Start, Leave, and
// the host's tools: remove a player offline ≥ 2 min, answer "That's me" requests.
import { GAME_LENGTHS, MIN_PLAYERS, PODIUM_MIN_PLAYERS } from '../../shared/constants';
import type { Settings, SnapshotOf } from '../../shared/protocol';
import { ADD_ON_CATEGORY_IDS, categoryById } from '../../shared/questionCategories';
import { GAME_MODES, type GameMode } from '../../shared/spots';
import { STRINGS } from '../strings';
import { Button, SegmentedControl, Toggle } from '../ui/Controls';
import { Banner, Card } from '../ui/Feedback';
import { PlayerChip, PlayerList } from '../ui/Game';
import { Center, Row, Screen, Stack } from '../ui/Layout';
import { QrCode } from '../ui/QrCode';
import { Heading, Text } from '../ui/Text';
import { useEnv } from './env';
import { LeaveButton, photoSource, ReclaimPrompts, RemoveButton, useCanRemove } from './parts';

export function LobbyScreen(props: {
  snapshot: SnapshotOf<'LOBBY'>;
  joinUrl: string;
  inAppBrowser?: boolean;
}) {
  const { snapshot } = props;
  const env = useEnv();
  const me = snapshot.you.playerId;
  const isHost = snapshot.hostId === me;
  const active = snapshot.players.filter((p) => p.status === 'active');
  const source = photoSource(snapshot);
  const canRemove = useCanRemove(snapshot);

  const settings = snapshot.settings;
  const change = (patch: Partial<Settings>) => env.actions.setSettings({ ...settings, ...patch });
  const busy = env.pending.has('setSettings');
  const podiumAllowed = active.length >= PODIUM_MIN_PLAYERS;
  const startBlocked =
    active.length < MIN_PLAYERS
      ? STRINGS.lobby.needPlayers(MIN_PLAYERS)
      : settings.mode === 'podium' && !podiumAllowed
        ? STRINGS.lobby.podiumNeedsPlayers(PODIUM_MIN_PLAYERS)
        : null;

  return (
    <Screen label={STRINGS.lobby.keyLabel}>
      {props.inAppBrowser === true && (
        <Banner tone="warning">
          <Text strong>{STRINGS.inAppBrowser.title}</Text>
          <Text variant="small">{STRINGS.inAppBrowser.body}</Text>
        </Banner>
      )}

      <Center>
        <Text variant="label">{STRINGS.lobby.keyLabel}</Text>
        <Text variant="key">{snapshot.key}</Text>
        <QrCode value={props.joinUrl} label={STRINGS.lobby.shareHint} />
        <Text variant="small">{STRINGS.lobby.shareHint}</Text>
        <Text variant="small" strong>
          {props.joinUrl}
        </Text>
      </Center>

      <ReclaimPrompts snapshot={snapshot} />

      <Stack gap="2">
        <Heading level={2}>{STRINGS.lobby.players(active.length)}</Heading>
        <PlayerList
          label={STRINGS.lobby.players(active.length)}
          items={active.map((player) => ({
            key: player.playerId,
            content: (
              <PlayerChip
                player={player}
                source={source}
                isHost={player.playerId === snapshot.hostId}
                isYou={player.playerId === me}
                action={canRemove(player) ? <RemoveButton player={player} /> : null}
              />
            ),
          }))}
        />
      </Stack>

      <Card label={STRINGS.lobby.settings}>
        <Heading level={2}>{STRINGS.lobby.settings}</Heading>
        <Stack gap="2">
          <Text variant="label">{STRINGS.lobby.length}</Text>
          <SegmentedControl
            label={STRINGS.lobby.length}
            value={settings.gameLength}
            disabled={!isHost || busy}
            options={GAME_LENGTHS.map((n) => ({ value: n, label: String(n) }))}
            onChange={(gameLength) => change({ gameLength })}
          />
        </Stack>
        <Stack gap="1">
          <Text variant="label">{STRINGS.lobby.categoriesTitle}</Text>
          {ADD_ON_CATEGORY_IDS.map((id) => {
            const category = categoryById(id);
            const on = settings.categories.includes(id);
            return (
              <Toggle
                key={id}
                label={`${category.emoji} ${category.name}`}
                hint={STRINGS.lobby.categoryHint[id]}
                checked={on}
                disabled={!isHost || busy}
                onChange={(checked) =>
                  change({
                    categories: checked
                      ? [...settings.categories, id]
                      : settings.categories.filter((c) => c !== id),
                  })
                }
              />
            );
          })}
        </Stack>
        <Stack gap="2">
          <Text variant="label">{STRINGS.lobby.mode}</Text>
          <SegmentedControl<GameMode>
            label={STRINGS.lobby.mode}
            value={settings.mode}
            disabled={!isHost || busy}
            options={GAME_MODES.map((mode) => ({
              value: mode,
              label: STRINGS.lobby.modeNames[mode],
              // Switching TO Podium needs 7+ (G-24); a Podium choice already made stays selectable.
              disabled: mode === 'podium' && !podiumAllowed && settings.mode !== 'podium',
            }))}
            onChange={(mode) => change({ mode })}
          />
          <Text variant="small">
            {!podiumAllowed && settings.mode !== 'podium'
              ? STRINGS.lobby.podiumNeedsPlayers(PODIUM_MIN_PLAYERS)
              : STRINGS.lobby.modeHints[settings.mode]}
          </Text>
        </Stack>
      </Card>

      <Stack gap="2">
        {isHost ? (
          <>
            <Button
              size="lg"
              block
              disabled={startBlocked !== null}
              busy={env.pending.has('start')}
              onClick={env.actions.start}
            >
              {STRINGS.lobby.start}
            </Button>
            {startBlocked !== null && (
              <Text variant="small" center>
                {startBlocked}
              </Text>
            )}
          </>
        ) : (
          <Text variant="muted" center live>
            {STRINGS.lobby.waitingForHost}
          </Text>
        )}
        <Row gap="2" justify="between" wrap>
          <Button variant="ghost" onClick={env.actions.editProfile}>
            {STRINGS.profile.edit}
          </Button>
          <LeaveButton />
        </Row>
      </Stack>
    </Screen>
  );
}
