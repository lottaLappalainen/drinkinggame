// Typography (CLAUDE.md §7): screens never style text themselves.
import type { ComponentChildren } from 'preact';
import { cx } from './cx';
import styles from './Text.module.css';

export function Heading(props: {
  level: 1 | 2 | 3;
  children: ComponentChildren;
  center?: boolean;
  id?: string;
}) {
  const Tag = props.level === 1 ? 'h1' : props.level === 2 ? 'h2' : 'h3';
  const size = props.level === 1 ? styles.h1 : props.level === 2 ? styles.h2 : styles.h3;
  return (
    <Tag id={props.id} class={cx(styles.heading, size, props.center === true && styles.center)}>
      {props.children}
    </Tag>
  );
}

export type TextVariant =
  | 'body'
  | 'muted'
  | 'small'
  | 'label'
  /** A question while answering / in the results. */
  | 'question'
  /** The question alone on the intro screen (G-49). */
  | 'questionLarge'
  /** The game key, big enough to read aloud (G-11). */
  | 'key';

const VARIANT: Record<TextVariant, string | undefined> = {
  body: styles.body,
  muted: styles.muted,
  small: styles.small,
  label: styles.label,
  question: styles.question,
  questionLarge: styles.questionLarge,
  key: styles.key,
};

export function Text(props: {
  children: ComponentChildren;
  variant?: TextVariant;
  center?: boolean;
  strong?: boolean;
  as?: 'p' | 'span' | 'div';
  live?: boolean;
}) {
  const Tag = props.as ?? 'p';
  return (
    <Tag
      class={cx(
        styles.text,
        VARIANT[props.variant ?? 'body'],
        props.center === true && styles.center,
        props.strong === true && styles.strong,
      )}
      aria-live={props.live === true ? 'polite' : undefined}
    >
      {props.children}
    </Tag>
  );
}
