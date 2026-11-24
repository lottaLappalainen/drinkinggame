// Game pieces (CLAUDE.md §7): Avatar, PlayerChip, PlayerList, Countdown, ReadyList, RevealStep.
// (QrCode lives in its own file: its library is loaded lazily, lobby only.)
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { AVATAR_PRESETS, getAvatarPreset, type PresetId } from '../../shared/avatars';
import type { GameId, GameKey, PlayerId, PublicPlayer } from '../../shared/protocol';
import { readyCounter } from '../../shared/ready';
import { STRINGS } from '../strings';
import { cx } from './cx';
import { Badge } from './Feedback';
import styles from './Game.module.css';
import { useFlip } from './motion';

// ── Avatar ───────────────────────────────────────────────────────────────────

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const AVATAR_SIZE: Record<AvatarSize, string | undefined> = {
  sm: styles.avatarSm,
  md: styles.avatarMd,
  lg: styles.avatarLg,
  xl: styles.avatarXl,
};
const TONE: readonly (string | undefined)[] = [
  styles.tone1,
  styles.tone2,
  styles.tone3,
  styles.tone4,
  styles.tone5,
  styles.tone6,
  styles.tone7,
  styles.tone8,
];

/** Where a player's photo is served (CLAUDE.md §5: gameId in the path, version in the query). */
export type PhotoSource = { readonly key: GameKey; readonly gameId: GameId };

export function photoUrl(source: PhotoSource, playerId: PlayerId, version: number): string {
  return `/api/games/${source.key}/${source.gameId}/photos/${playerId}?v=${String(version)}`;
}

/**
 * Emoji on a colored circle; a photo (if any) loads over it — the preset shows while it loads and
 * if it fails. Decorative: the name next to it is the accessible label.
 */
export function Avatar(props: {
  presetId: PresetId;
  photo?: string | null;
  size?: AvatarSize;
  faded?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // Typed all the way from the protocol / the checked stored profile — presets are never removed.
  const preset = getAvatarPreset(props.presetId);
  return (
    <span
      class={cx(
        styles.avatar,
        AVATAR_SIZE[props.size ?? 'md'],
        TONE[preset.tone - 1],
        props.faded === true && styles.avatarFaded,
      )}
      aria-hidden="true"
    >
      {preset.emoji}
      {props.photo != null && !failed && (
        <img
          class={styles.avatarPhoto}
          src={props.photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(true);
          }}
        />
      )}
    </span>
  );
}

/** The avatar of a public player (photo URL included when there is one). */
export function PlayerAvatar(props: {
  player: PublicPlayer;
  source?: PhotoSource | undefined;
  size?: AvatarSize;
  faded?: boolean;
}) {
  const { player, source } = props;
  const version = player.avatar.photoVersion;
  return (
    <Avatar
      presetId={player.avatar.presetId}
      photo={
        source !== undefined && version !== null ? photoUrl(source, player.playerId, version) : null
      }
      {...(props.size !== undefined && { size: props.size })}
      {...(props.faded !== undefined && { faded: props.faded })}
    />
  );
}

// ── Player chip & list ───────────────────────────────────────────────────────

export function PlayerChip(props: {
  player: PublicPlayer;
  source?: PhotoSource | undefined;
  isHost?: boolean;
  isYou?: boolean;
  /** Extra badges / status after the name. */
  meta?: ComponentChildren;
  /** A trailing action (e.g. the host's Remove). */
  action?: ComponentChildren;
}) {
  const { player } = props;
  return (
    <div class={styles.chip}>
      <PlayerAvatar player={player} source={props.source} faded={!player.online} />
      <span class={styles.chipName}>
        {player.nickname}
        {props.isYou === true && ` (${STRINGS.common.you})`}
      </span>
      <span class={styles.chipMeta}>
        {props.isHost === true && <Badge tone="primary">{STRINGS.common.host}</Badge>}
        {!player.online && <Badge>{STRINGS.common.offline}</Badge>}
        {props.meta}
      </span>
      {props.action}
    </div>
  );
}

/** A list of rows that glide when they reorder and pop in when someone joins. */
export function PlayerList(props: {
  items: readonly { key: string; content: ComponentChildren }[];
  label: string;
}) {
  const ref = useFlip<HTMLUListElement>();
  return (
    <ul ref={ref} class={styles.list} aria-label={props.label}>
      {props.items.map((item) => (
        <li key={item.key} data-flip={item.key} class={styles.listItem}>
          {item.content}
        </li>
      ))}
    </ul>
  );
}

// ── Countdown ────────────────────────────────────────────────────────────────

/** Last seconds, when the bar pulses. */
const PULSE_FROM_END_MS = 5_000;

/**
 * The answer timer: a CSS animation computed once from the timestamps (duration = whole answer
 * time, negative delay = time already gone) — no per-frame updates, and a phone that comes back
 * mid-round lands on the right width. Pulses in the last 5 s.
 */
export function Countdown(props: {
  startsAt: number;
  endsAt: number;
  now: number;
  frozen?: boolean;
}) {
  // Captured ONCE per round: a running CSS animation keeps its start time, so a delay recomputed on
  // every re-render (each playerReady) would push the bar forward by the time since it appeared.
  const timing = useRef<{ endsAt: number; elapsed: number } | null>(null);
  const total = Math.max(1, props.endsAt - props.startsAt);
  if (timing.current?.endsAt !== props.endsAt)
    timing.current = {
      endsAt: props.endsAt,
      elapsed: Math.min(total, Math.max(0, props.now - props.startsAt)),
    };
  const elapsed = timing.current.elapsed;
  const left = Math.max(0, Math.round((props.endsAt - props.now) / 1000));
  return (
    <div class={styles.countdown} role="timer" aria-label={STRINGS.round.secondsLeft(left)}>
      <div
        class={cx(styles.countdownBar, props.frozen === true && styles.countdownFrozen)}
        // eslint-disable-next-line no-restricted-syntax -- runtime timer values, as CSS variables only (CLAUDE.md §7 allows this)
        style={{
          '--countdown-duration': `${String(total)}ms`,
          '--countdown-delay': `${String(-elapsed)}ms`,
          '--countdown-pulse-delay': `${String(total - PULSE_FROM_END_MS - elapsed)}ms`,
        }}
      />
    </div>
  );
}

// ── Ready list (G-38) ────────────────────────────────────────────────────────

export function readyCountOf(
  round: {
    participants: readonly PlayerId[];
    ready: readonly PlayerId[];
  },
  players: readonly PublicPlayer[],
) {
  const online = new Set(players.filter((p) => p.online).map((p) => p.playerId));
  return readyCounter(round.participants, new Set(round.ready), (id) => online.has(id));
}

/** Everyone taking part: ✓ Ready / Answering… / Offline — never what they answered. */
export function ReadyList(props: {
  participants: readonly PlayerId[];
  ready: readonly PlayerId[];
  players: readonly PublicPlayer[];
  source?: PhotoSource | undefined;
  me: PlayerId;
}) {
  const byId = new Map(props.players.map((p) => [p.playerId, p]));
  const readySet = new Set(props.ready);
  const rank = (id: PlayerId) => (readySet.has(id) ? 0 : byId.get(id)?.online === true ? 1 : 2);
  const ordered = [...props.participants].sort((a, b) => rank(a) - rank(b));
  return (
    <PlayerList
      label={STRINGS.round.waitingTitle}
      items={ordered.flatMap((id) => {
        const player = byId.get(id);
        if (player === undefined) return [];
        const status = readySet.has(id) ? (
          <Badge tone="success">{STRINGS.round.readyMark}</Badge>
        ) : player.online ? (
          <Badge>{STRINGS.round.answering}</Badge>
        ) : null;
        return [
          {
            key: id,
            content: (
              <PlayerChip
                player={player}
                source={props.source}
                isYou={id === props.me}
                meta={status}
              />
            ),
          },
        ];
      })}
    />
  );
}

// ── Reveal step (G-50) ───────────────────────────────────────────────────────

/** One reveal step: the place's words and everyone at that place (ties together, S-4). */
export function RevealStep(props: {
  label: string;
  players: readonly PublicPlayer[];
  source?: PhotoSource | undefined;
  /** The final "most likely" moment gets the biggest entrance. */
  top?: boolean;
}) {
  return (
    <section class={cx(styles.reveal, props.top === true && styles.revealTop)} aria-live="polite">
      <p class={styles.revealLabel}>{props.label}</p>
      <div class={styles.revealPeople}>
        {props.players.map((player) => (
          <div key={player.playerId} class={styles.revealPerson}>
            <PlayerAvatar
              player={player}
              source={props.source}
              size={props.top === true ? 'xl' : 'lg'}
            />
            <span>{player.nickname}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The pause before the last step. */
export function Drumroll() {
  return (
    <div class={styles.drumroll} aria-label={STRINGS.results.revealing}>
      🥁
    </div>
  );
}

// ── Avatar picker (G-2) ──────────────────────────────────────────────────────

/** The ready-made avatars as a grid of radio buttons. */
export function AvatarPicker(props: {
  label: string;
  value: PresetId;
  onChange: (presetId: PresetId) => void;
}) {
  return (
    <ul class={styles.avatarGrid} role="radiogroup" aria-label={props.label}>
      {AVATAR_PRESETS.map((preset) => {
        const selected = preset.id === props.value;
        return (
          <li key={preset.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={STRINGS.profile.pickAvatar(preset.emoji)}
              class={cx(styles.avatarOption, selected && styles.avatarOptionSelected)}
              onClick={() => {
                props.onChange(preset.id);
              }}
            >
              <Avatar presetId={preset.id} size="md" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
