// Controls (CLAUDE.md §7): Button, IconButton, TextInput, SegmentedControl, Toggle.
// Variations are props (variant, size) mapped to classes — never one-off copies.
import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from './cx';
import styles from './Controls.module.css';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: styles.secondary,
  accent: styles.accent,
  ghost: styles.ghost,
  danger: styles.danger,
};

export function Button(props: {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  /** Full width. */
  block?: boolean;
  disabled?: boolean;
  /** Waiting for the server: disabled, with a spinner. */
  busy?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={props.type ?? 'button'}
      class={cx(
        styles.button,
        BUTTON_VARIANT[props.variant ?? 'primary'],
        props.size === 'lg' && styles.large,
        props.block === true && styles.block,
      )}
      disabled={props.disabled === true || props.busy === true}
      aria-busy={props.busy === true}
      onClick={props.onClick}
    >
      {props.busy === true && <Spinner size="inline" />}
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  label: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={styles.iconButton}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <span aria-hidden="true">{props.children}</span>
    </button>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  /** A game key: uppercase, spaced out, centered. */
  variant?: 'text' | 'key';
  hint?: string;
  error?: string | null;
  maxLength?: number;
  autoFocus?: boolean;
  enterKeyHint?: 'done' | 'go';
}) {
  const id = useId();
  const key = props.variant === 'key';
  const message = props.error ?? props.hint;
  return (
    <div class={styles.field}>
      <label class={styles.fieldLabel} for={id}>
        {props.label}
      </label>
      <input
        id={id}
        class={cx(styles.input, key && styles.inputKey, props.error != null && styles.inputInvalid)}
        value={props.value}
        maxLength={props.maxLength}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- one field per screen; the keyboard is the point of it
        autoFocus={props.autoFocus}
        autoComplete="off"
        autoCapitalize={key ? 'characters' : 'words'}
        autoCorrect="off"
        spellcheck={false}
        enterKeyHint={props.enterKeyHint}
        aria-invalid={props.error != null}
        aria-describedby={message != null ? `${id}-message` : undefined}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
      />
      {message != null && (
        <span
          id={`${id}-message`}
          class={props.error != null ? styles.fieldError : styles.fieldHint}
          role={props.error != null ? 'alert' : undefined}
        >
          {message}
        </span>
      )}
    </div>
  );
}

export type SegmentOption<T extends string | number> = {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
};

/** Pick one of a few options (theme, game length, game mode). */
export function SegmentedControl<T extends string | number>(props: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div class={styles.segmented} role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            class={cx(styles.segment, selected && styles.segmentSelected)}
            disabled={props.disabled === true || option.disabled === true}
            onClick={() => {
              if (!selected) props.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label class={cx(styles.toggleRow, props.disabled === true && styles.toggleRowDisabled)}>
      <span class={styles.toggleText}>
        <span class={styles.fieldLabel}>{props.label}</span>
        {props.hint !== undefined && <span class={styles.fieldHint}>{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        class={styles.toggleInput}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.currentTarget.checked);
        }}
      />
      <span class={styles.toggleTrack} aria-hidden="true">
        <span class={styles.toggleThumb} />
      </span>
    </label>
  );
}
