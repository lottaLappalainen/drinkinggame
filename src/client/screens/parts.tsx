// Pieces several screens share — compositions of ui/ components only (no styling here).
import { useState } from 'preact/hooks';
import { MIN_PLAYERS, REMOVE_OFFLINE_MIN_MS } from '../../shared/constants';
import { categoryById } from '../../shared/questionCategories';
import type { PublicPlayer, PublicRound, Snapshot } from '../../shared/protocol';
import type { Storage } from '../storage';
import { STRINGS } from '../strings';
import { setTheme, themeChoice, type Theme } from '../theme';
import { Button, SegmentedControl } from '../ui/Controls';
import { Badge, Banner, Card, ConfirmDialog, Modal } from '../ui/Feedback';
import { PlayerChip, PlayerList, type PhotoSource } from '../ui/Game';
import { Row } from '../ui/Layout';
import { Heading, Text } from '../ui/Text';
import { useEnv, useNowUntil } from './env';

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

// ── Host tools and Leave — in EVERY phase (the engine accepts them all game long) ──

/**
 * Who the host may remove right now (G-43: offline ≥ REMOVE_OFFLINE_MIN_MS, measured from the
 * saved offlineSince). Re-renders exactly when the next player crosses that line.
 */
export function useCanRemove(snapshot: Snapshot): (player: PublicPlayer) => boolean {
  const env = useEnv();
  const me = snapshot.you.playerId;
  const isHost = snapshot.hostId === me;
  const offlineSince = (p: PublicPlayer): number[] =>
    p.status === 'active' && !p.online && p.offlineSince !== null ? [p.offlineSince] : [];
  const removableAt = snapshot.players
    .flatMap(offlineSince)
    .map((since) => since + REMOVE_OFFLINE_MIN_MS);
  const at = env.serverNow();
  const future = removableAt.filter((moment) => moment > at);
  const now = useNowUntil(future.length === 0 ? null : Math.min(...future));
  return (player) =>
    isHost &&
    player.playerId !== me &&
    offlineSince(player).some((since) => now - since >= REMOVE_OFFLINE_MIN_MS);
}

/** The host's Remove for a ghost player, with "Are you sure?" (G-43). */
export function RemoveButton(props: { player: PublicPlayer }) {
  const env = useEnv();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        busy={env.pending.has('removePlayer')}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {STRINGS.lobby.remove}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={STRINGS.lobby.removeTitle(props.player.nickname)}
        message={STRINGS.lobby.removeBody}
        confirmLabel={STRINGS.lobby.remove}
        danger
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          env.actions.removePlayer(props.player.playerId);
        }}
      />
    </>
  );
}

/** "That's me" requests (G-44) — host only, shown on every screen: a phone dies mid-game. */
export function ReclaimPrompts(props: { snapshot: Snapshot }) {
  const env = useEnv();
  const { snapshot } = props;
  if (snapshot.hostId !== snapshot.you.playerId) return null;
  const busy = env.pending.has('answerReclaim');
  return (
    <>
      {snapshot.reclaims.map((request) => {
        const target = snapshot.players.find((p) => p.playerId === request.targetPlayerId);
        return (
          <Card key={request.requestId} tone="accent">
            <Heading level={3}>
              {STRINGS.lobby.reclaimTitle(target?.nickname ?? request.nickname)}
            </Heading>
            <Text>{STRINGS.lobby.reclaimBody}</Text>
            <Row gap="2" justify="end" wrap>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  env.actions.answerReclaim(request.requestId, false);
                }}
              >
                {STRINGS.lobby.deny}
              </Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => {
                  env.actions.answerReclaim(request.requestId, true);
                }}
              >
                {STRINGS.lobby.approve}
              </Button>
            </Row>
          </Card>
        );
      })}
    </>
  );
}

/** Leave for good (G-41), with "Are you sure?". */
export function LeaveButton() {
  const env = useEnv();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        busy={env.pending.has('leave')}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {STRINGS.lobby.leave}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={STRINGS.lobby.leaveTitle}
        message={STRINGS.lobby.leaveBody}
        confirmLabel={STRINGS.lobby.leave}
        danger
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          env.actions.leave();
        }}
      />
    </>
  );
}

/**
 * Mid-game tools in one sheet (question and results screens): everyone with the host's Remove for
 * ghosts (G-43), Leave (G-41) and the host's End game (G-46).
 */
export function GameMenu(props: { snapshot: Snapshot }) {
  const { snapshot } = props;
  const [open, setOpen] = useState(false);
  const canRemove = useCanRemove(snapshot);
  const me = snapshot.you.playerId;
  const isHost = snapshot.hostId === me;
  const source = photoSource(snapshot);
  const active = snapshot.players.filter((p) => p.status === 'active');
  return (
    <Row justify="center">
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {STRINGS.ended.menu}
      </Button>
      <Modal
        open={open}
        label={STRINGS.ended.menu}
        title={STRINGS.ended.players}
        onClose={() => {
          setOpen(false);
        }}
      >
        <PlayerList
          label={STRINGS.ended.players}
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
        <Row gap="2" justify="between" wrap>
          <LeaveButton />
          <EndGameButton isHost={isHost} />
        </Row>
      </Modal>
    </Row>
  );
}
