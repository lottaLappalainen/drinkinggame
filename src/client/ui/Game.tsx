// Game pieces (CLAUDE.md §7): Avatar, PlayerChip, PlayerList, Countdown, ReadyList, RevealStep,
// DrinkBadge / DrinkChip (drinking rules, D-6), QuestionText ("[player]" questions, G-51).
// (QrCode lives in its own file: its library is loaded lazily, lobby only.)
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AVATAR_PRESETS, getAvatarPreset, type PresetId } from '../../shared/avatars';
import { DRINK_RULES, type DrinkRange } from '../../shared/drinkRules';
import type {
  DrinkRule,
  GameId,
  GameKey,
  PlayerId,
  PublicPlayer,
  RevealStepKind,
} from '../../shared/protocol';
import { questionParts } from '../../shared/questionSubject';
import { readyCounter } from '../../shared/ready';
import { STRINGS } from '../strings';
import { cx } from './cx';
import { Badge } from './Feedback';
import styles from './Game.module.css';
import { useFlip } from './motion';
import { Text } from './Text';

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
 * `intro`: the quick bar of the question-only screen (G-49) — it FILLS up instead of draining, and
 * doesn't pulse; full = answering opens.
 */
export function Countdown(props: {
  startsAt: number;
  endsAt: number;
  now: number;
  frozen?: boolean;
  intro?: boolean;
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
    <div
      class={styles.countdown}
      role="timer"
      aria-label={props.intro === true ? STRINGS.round.startsSoon : STRINGS.round.secondsLeft(left)}
    >
      <div
        class={cx(
          styles.countdownBar,
          props.intro === true && styles.countdownIntro,
          props.frozen === true && styles.countdownFrozen,
        )}
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

/**
 * One reveal step: the place's words, everyone at that place (ties together, S-4), then the
 * drinking rule (D-6) a beat after the names.
 */
export function RevealStep(props: {
  label: string;
  players: readonly PublicPlayer[];
  source?: PhotoSource | undefined;
  /** The final "most likely" moment gets the biggest entrance. */
  top?: boolean;
  /** The rule and its step kind (for the roll range); omitted = no rule shown. */
  rule?: { kind: RevealStepKind; rule: DrinkRule; appearInMs: number } | undefined;
  /** The viewer is in this step: "You drink 5 sips". */
  you?: boolean;
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
      {props.rule !== undefined && (
        <DrinkBadge
          rule={props.rule.rule}
          range={DRINK_RULES[props.rule.kind]}
          appearInMs={props.rule.appearInMs}
          shared={props.players.length > 1}
          you={props.you === true}
        />
      )}
    </section>
  );
}

// ── Drinking rules (D-6) ─────────────────────────────────────────────────────

const RULE_EMOJI = { drink: '🍺', give: '👉' } as const;
/** At least this many numbers flick past before the drawn one lands. */
const ROLL_MIN_NUMBERS = 8;

/**
 * The numbers the roll shows: the rule's range over and over, ending on the drawn number — the
 * same on every phone, so they all land on it together.
 */
export function rollNumbers(range: DrinkRange, sips: number): number[] {
  const span = range.max - range.min + 1;
  const count = Math.max(ROLL_MIN_NUMBERS, span);
  return [...Array.from({ length: count }, (_, i) => range.min + (i % span)), sips];
}

/**
 * "🍺 Drink 5 sips": appears `appearInMs` from now (the server timeline decides when — a phone
 * that comes back mid-step gets a negative value and shows the badge at once), then its number
 * rolls through the rule's range and lands on the drawn one. Both are CSS animations with a delay
 * captured ONCE (a delay recomputed on re-render would restart them — see Countdown).
 */
export function DrinkBadge(props: {
  rule: DrinkRule;
  range: DrinkRange;
  appearInMs?: number;
  /** Several players share the place: "each" (D-3). */
  shared?: boolean;
  you?: boolean;
}) {
  const { rule } = props;
  const delay = useRef(props.appearInMs ?? 0).current;
  const numbers = rollNumbers(props.range, rule.sips);
  const you = props.you === true;
  useEffect(() => {
    // A short buzz on the phone that has to drink / give, as the badge lands (where supported).
    if (!you || delay < 0 || typeof navigator.vibrate !== 'function') return;
    const timer = setTimeout(() => navigator.vibrate(40), delay);
    return () => {
      clearTimeout(timer);
    };
  }, [you, delay]);
  const sentence = STRINGS.drinks.sentence(rule.action, rule.sips, you);
  return (
    <div
      class={cx(
        styles.rule,
        rule.action === 'drink' ? styles.ruleDrink : styles.ruleGive,
        you && styles.ruleYou,
      )}
      role="status"
      aria-label={props.shared === true ? `${sentence} ${STRINGS.drinks.each}` : sentence}
      // eslint-disable-next-line no-restricted-syntax -- runtime timing + roll length, as CSS variables only (CLAUDE.md §7 allows this)
      style={{ '--rule-delay': `${String(delay)}ms`, '--roll-end': String(numbers.length - 1) }}
    >
      <span aria-hidden="true">{RULE_EMOJI[rule.action]}</span>
      <span class={styles.ruleWords} aria-hidden="true">
        {STRINGS.drinks.words(rule.action, you)}
      </span>
      <span class={styles.roll} aria-hidden="true">
        <span class={styles.rollStrip}>
          {numbers.map((n, i) => (
            <span key={i} class={styles.rollNumber}>
              {n}
            </span>
          ))}
        </span>
      </span>
      <span class={styles.ruleWords} aria-hidden="true">
        {STRINGS.drinks.sips(rule.sips)}
        {props.shared === true && ` ${STRINGS.drinks.each}`}
      </span>
    </div>
  );
}

/**
 * Compact rule next to a place in the full ranking: "🍺 5" / "👉 7" (the colour and emoji tell drink
 * from give out; the full words are read out). Narrow on purpose: names must keep their room.
 */
export function DrinkChip(props: { rule: DrinkRule }) {
  const { rule } = props;
  const words = STRINGS.drinks.chip(rule.action, rule.sips);
  return (
    <span
      class={cx(styles.ruleChip, rule.action === 'drink' ? styles.ruleDrink : styles.ruleGive)}
      role="img"
      aria-label={words}
      title={words}
    >
      {`${RULE_EMOJI[rule.action]} ${String(rule.sips)}`}
    </span>
  );
}

// ── Question text (G-51) ─────────────────────────────────────────────────────

/**
 * A question, with the subject's name highlighted in place of "[player]" (G-51) — as plain text,
 * never HTML. The intro (`large`) also shows the subject's picture, so everyone sees at a glance
 * who it's about.
 */
export function QuestionText(props: {
  text: string;
  subject: PublicPlayer | null | undefined;
  large?: boolean;
  center?: boolean;
  source?: PhotoSource | undefined;
}) {
  const variant = props.large === true ? 'questionLarge' : 'question';
  const center = props.center === true;
  const parts = questionParts(props.text);
  if (parts === null)
    return (
      <Text variant={variant} center={center}>
        {props.text}
      </Text>
    );
  const name = props.subject?.nickname ?? STRINGS.round.someone;
  const text = (
    <Text variant={variant} center={center}>
      {parts.before}
      <mark class={styles.subject}>{name}</mark>
      {parts.after}
    </Text>
  );
  if (props.large !== true || props.subject == null) return text;
  return (
    <div class={styles.questionWithSubject}>
      <PlayerAvatar player={props.subject} source={props.source} size="lg" />
      {text}
    </div>
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
