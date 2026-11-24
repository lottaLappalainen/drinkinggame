// Surfaces & feedback (CLAUDE.md §7): Card, Modal, ConfirmDialog, Banner, Toast, Badge, Spinner.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { STRINGS } from '../strings';
import { Button } from './Controls';
import { cx } from './cx';
import { Row } from './Layout';
import { Heading, Text } from './Text';
import styles from './Feedback.module.css';

export function Card(props: {
  children: ComponentChildren;
  tone?: 'surface' | 'accent';
  label?: string;
}) {
  return (
    <section
      class={cx(styles.card, props.tone === 'accent' && styles.cardAccent)}
      aria-label={props.label}
    >
      {props.children}
    </section>
  );
}

/**
 * A modal sheet on the native <dialog> (focus trap, Esc, backdrop for free). `onClose` runs for
 * Esc too; the parent decides `open`.
 */
export function Modal(props: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      class={styles.dialog}
      aria-label={props.label}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      {props.open && <div class={styles.dialogBody}>{props.children}</div>}
    </dialog>
  );
}

/** "Are you sure?" — for End game, Remove player, Leave. */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={props.open} label={props.title} onClose={props.onCancel}>
      <Heading level={2}>{props.title}</Heading>
      <Text>{props.message}</Text>
      <Row gap="2" justify="end" wrap>
        <Button variant="ghost" onClick={props.onCancel}>
          {STRINGS.common.cancel}
        </Button>
        <Button variant={props.danger === true ? 'danger' : 'primary'} onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </Row>
    </Modal>
  );
}

export type Tone = 'info' | 'warning' | 'danger';

const BANNER_TONE: Record<Tone, string | undefined> = {
  info: styles.bannerInfo,
  warning: styles.bannerWarning,
  danger: styles.bannerDanger,
};

export function Banner(props: {
  children: ComponentChildren;
  tone?: Tone;
  action?: ComponentChildren;
}) {
  return (
    <div class={cx(styles.banner, BANNER_TONE[props.tone ?? 'info'])} role="status">
      <div class={styles.bannerText}>{props.children}</div>
      {props.action}
    </div>
  );
}

/** A short message at the bottom (a refused request); dismissible. */
export function Toast(props: { message: string; onDismiss: () => void }) {
  return (
    <div class={styles.toast} role="alert">
      <span class={styles.toastText}>{props.message}</span>
      <button
        type="button"
        class={styles.toastClose}
        aria-label={STRINGS.common.dismiss}
        onClick={props.onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success';

const BADGE_TONE: Record<BadgeTone, string | undefined> = {
  neutral: styles.badgeNeutral,
  primary: styles.badgePrimary,
  accent: styles.badgeAccent,
  success: styles.badgeSuccess,
};

export function Badge(props: { children: ComponentChildren; tone?: BadgeTone }) {
  return (
    <span class={cx(styles.badge, BADGE_TONE[props.tone ?? 'neutral'])}>{props.children}</span>
  );
}

export function Spinner(props: { label?: string; size?: 'md' | 'inline' }) {
  return (
    <span
      class={cx(styles.spinner, props.size === 'inline' && styles.spinnerInline)}
      role={props.label !== undefined ? 'status' : undefined}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? true : undefined}
    />
  );
}

/** A thin strip at the top: "Reconnecting…" / "Updating…" over whatever screen is showing. */
export function StatusStrip(props: { children: ComponentChildren }) {
  return (
    <div class={styles.strip} role="status">
      <Spinner size="inline" />
      {props.children}
    </div>
  );
}
