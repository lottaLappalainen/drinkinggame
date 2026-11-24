// Layout primitives (CLAUDE.md §7): Screen, Stack, Row, Spacer, Center. Spacing between elements
// is a prop with a token value (`<Stack gap="3">`) — never an ad-hoc margin.
import type { ComponentChildren } from 'preact';
import { cx, type Space } from './cx';
import styles from './Layout.module.css';

type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'between' | 'end';

const GAP: Record<Space, string | undefined> = {
  '0': styles.gap0,
  '1': styles.gap1,
  '2': styles.gap2,
  '3': styles.gap3,
  '4': styles.gap4,
  '5': styles.gap5,
  '6': styles.gap6,
  '7': styles.gap7,
  '8': styles.gap8,
};
const ALIGN: Record<Align, string | undefined> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
};
const JUSTIFY: Record<Justify, string | undefined> = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  between: styles.justifyBetween,
  end: styles.justifyEnd,
};

/** The page frame: safe areas (notch, home bar — `viewport-fit=cover`), max width, padding. */
export function Screen(props: { children: ComponentChildren; center?: boolean; label?: string }) {
  return (
    <main
      class={cx(styles.screen, props.center === true && styles.screenCenter)}
      aria-label={props.label}
    >
      {props.children}
    </main>
  );
}

type FlexProps = {
  children: ComponentChildren;
  gap?: Space;
  align?: Align;
  justify?: Justify;
  /** Take the remaining space in the parent. */
  grow?: boolean;
  as?: 'div' | 'section' | 'ul' | 'ol' | 'li' | 'header' | 'footer';
  label?: string;
};

export function Stack({
  children,
  gap = '3',
  align = 'stretch',
  justify,
  grow,
  as,
  label,
}: FlexProps) {
  const Tag = as ?? 'div';
  return (
    <Tag
      class={cx(
        styles.stack,
        GAP[gap],
        ALIGN[align],
        justify && JUSTIFY[justify],
        grow === true && styles.grow,
      )}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

export function Row({
  children,
  gap = '2',
  align = 'center',
  justify,
  grow,
  wrap,
  as,
  label,
}: FlexProps & { wrap?: boolean }) {
  const Tag = as ?? 'div';
  return (
    <Tag
      class={cx(
        styles.row,
        GAP[gap],
        ALIGN[align],
        justify && JUSTIFY[justify],
        grow === true && styles.grow,
        wrap === true && styles.wrap,
      )}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

/** Pushes what follows to the end of a Stack / Row. */
export function Spacer() {
  return <div class={styles.spacer} aria-hidden="true" />;
}

export function Center(props: { children: ComponentChildren; grow?: boolean }) {
  return <div class={cx(styles.center, props.grow === true && styles.grow)}>{props.children}</div>;
}

/**
 * Keeps its content (a screen's main action) pinned to the bottom of the screen while the page
 * scrolls — e.g. Ready under a long Podium list. In normal flow when everything fits.
 */
export function Dock(props: { children: ComponentChildren }) {
  return <div class={styles.dock}>{props.children}</div>;
}
