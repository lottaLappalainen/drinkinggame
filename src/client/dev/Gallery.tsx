// Dev galleries (5A) — included in dev and staging builds, dropped from production (app.tsx only
// imports this when MODE !== 'production'). `/dev/ui`: every component × variant, light and dark
// side by side — the living style guide. `/dev/screens`: every screen fixture (test/fixtures)
// rendered by the REAL screens with a frozen clock at the fixture's `now`.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { MESSAGE_FIXTURES, type MessageFixture } from '../../../test/fixtures/messages';
import { SCREEN_FIXTURES } from '../../../test/fixtures/snapshots';
import { manyPlayers, P, T0 } from '../../../test/fixtures/common';
import { PhaseScreen } from '../app';
import { RankingBoard, type Placement } from '../ranking/RankingBoard';
import { navigate } from '../router';
import { FROZEN_ACTIONS, ScreenEnvContext, type ScreenEnv } from '../screens/env';
import { HomeScreen } from '../screens/HomeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import {
  ConnectingScreen,
  EndedScreen,
  ExitScreen,
  JoinProblemScreen,
  ReclaimScreen,
} from '../screens/StatusScreens';
import { ThemePicker } from '../screens/parts';
import { appStorage } from '../store/app';
import { errorOutcome } from '../store/errors';
import { STRINGS } from '../strings';
import { Button, IconButton, SegmentedControl, TextInput, Toggle } from '../ui/Controls';
import { Badge, Banner, Card, Spinner, StatusStrip, Toast } from '../ui/Feedback';
import { Avatar, Countdown, Drumroll, PlayerChip, ReadyList, RevealStep } from '../ui/Game';
import { Row, Stack } from '../ui/Layout';
import { QrCode } from '../ui/QrCode';
import { Heading, Text } from '../ui/Text';
import styles from './Gallery.module.css';

export function Gallery(props: { page: 'ui' | 'screens' }) {
  return (
    <div class={styles.page}>
      <div class={styles.bar}>
        <Button
          variant={props.page === 'ui' ? 'primary' : 'ghost'}
          onClick={() => {
            navigate('/dev/ui');
          }}
        >
          {STRINGS.dev.gallery}
        </Button>
        <Button
          variant={props.page === 'screens' ? 'primary' : 'ghost'}
          onClick={() => {
            navigate('/dev/screens');
          }}
        >
          {STRINGS.dev.screens}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            navigate('/');
          }}
        >
          {STRINGS.common.home}
        </Button>
        {/* The screen gallery in either theme (the component gallery shows both side by side). */}
        <ThemePicker storage={appStorage()} />
      </div>
      {props.page === 'ui' ? <ComponentGallery /> : <ScreenGallery />}
    </div>
  );
}

// ── /dev/ui ──────────────────────────────────────────────────────────────────

function ComponentGallery() {
  return (
    <div class={styles.themes}>
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} data-theme={theme} class={styles.themeColumn}>
          <Heading level={1}>{theme}</Heading>
          <Components />
        </div>
      ))}
    </div>
  );
}

function Section(props: { title: string; children: ComponentChildren }) {
  return (
    <section class={styles.section}>
      <Text variant="label">{props.title}</Text>
      {props.children}
    </section>
  );
}

const SIX = manyPlayers(6);
const noop = () => undefined;

function Components() {
  const [text, setText] = useState('Mikko');
  const [segment, setSegment] = useState<15 | 25 | 35>(25);
  const [toggle, setToggle] = useState(true);
  const [placement, setPlacement] = useState<Placement>([P.aino, null, null]);
  return (
    <>
      <Section title="Colors">
        <div class={styles.swatches}>
          {[
            styles.swatchPrimary,
            styles.swatchSecondary,
            styles.swatchAccent,
            styles.swatchSurface,
            styles.swatchIndicator,
            styles.swatchFocus,
          ].map((swatch, i) => (
            <div key={i} class={`${styles.swatch ?? ''} ${swatch ?? ''}`} />
          ))}
        </div>
      </Section>
      <Section title="Typography">
        <Heading level={1}>Heading 1</Heading>
        <Heading level={2}>Heading 2</Heading>
        <Heading level={3}>Heading 3</Heading>
        <Text>Body text</Text>
        <Text variant="muted">Muted text</Text>
        <Text variant="small">Small text</Text>
        <Text variant="label">Label</Text>
        <Text variant="question">Who is most likely to sing at the party?</Text>
        <Text variant="key">ABCDE</Text>
      </Section>
      <Section title="Buttons">
        <Stack gap="2">
          {(['primary', 'secondary', 'accent', 'ghost', 'danger'] as const).map((variant) => (
            <Row key={variant} gap="2" wrap>
              <Button variant={variant}>{variant}</Button>
              <Button variant={variant} size="lg">
                large
              </Button>
              <Button variant={variant} disabled>
                disabled
              </Button>
              <Button variant={variant} busy>
                busy
              </Button>
            </Row>
          ))}
          <IconButton label="Close" onClick={noop}>
            ×
          </IconButton>
        </Stack>
      </Section>
      <Section title="Inputs">
        <TextInput label="Nickname" value={text} onInput={setText} hint="Up to 16 characters" />
        <TextInput label="With error" value="" onInput={noop} error="Pick a name" />
        <TextInput label="Game key" variant="key" value="ABCDE" onInput={noop} />
        <SegmentedControl
          label="Length"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 15, label: '15' },
            { value: 25, label: '25' },
            { value: 35, label: '35', disabled: true },
          ]}
        />
        <Toggle
          label="🌶️ Spicy"
          hint="Adds the spicy questions"
          checked={toggle}
          onChange={setToggle}
        />
        <Toggle label="Disabled" checked={false} onChange={noop} disabled />
      </Section>
      <Section title="Feedback">
        <Card>
          <Heading level={3}>Card</Heading>
          <Text>Surface card</Text>
        </Card>
        <Card tone="accent">
          <Text strong>Accent card</Text>
        </Card>
        <Banner>Info banner</Banner>
        <Banner tone="warning">Warning banner</Banner>
        <Banner tone="danger" action={<Button variant="ghost">Action</Button>}>
          Danger banner
        </Banner>
        <Row gap="2" wrap>
          <Badge>neutral</Badge>
          <Badge tone="primary">primary</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="success">Ready ✓</Badge>
          <Spinner label="Loading" />
        </Row>
      </Section>
      <Section title="Avatars">
        <Row gap="2" wrap>
          <Avatar presetId="fox" size="sm" />
          <Avatar presetId="cat" size="md" />
          <Avatar presetId="owl" size="lg" />
          <Avatar presetId="unicorn" size="xl" />
          <Avatar presetId="frog" faded />
        </Row>
      </Section>
      <Section title="Players">
        {SIX.slice(0, 3).map((player, i) => (
          <PlayerChip key={player.playerId} player={player} isHost={i === 0} isYou={i === 1} />
        ))}
        <ReadyList
          participants={SIX.map((p) => p.playerId)}
          ready={[P.aino, P.ville]}
          players={SIX}
          me={P.mikko}
        />
      </Section>
      <Section title="Countdown (frozen at 60 % and in the last seconds)">
        <Countdown startsAt={T0} endsAt={T0 + 30_000} now={T0 + 18_000} frozen />
        <Countdown startsAt={T0} endsAt={T0 + 30_000} now={T0 + 27_000} frozen />
      </Section>
      <Section title="Reveal">
        <RevealStep label="Least likely" players={SIX.slice(5)} />
        <RevealStep label="Most likely" players={SIX.slice(0, 2)} top />
        <Drumroll />
      </Section>
      <Section title="Ranking board (interim, tap to place)">
        <RankingBoard
          candidates={SIX.slice(0, 5)}
          spots={3}
          captionFor={(spot) => ['Most likely', '2nd most likely', '3rd most likely'][spot] ?? null}
          placement={placement}
          onChange={setPlacement}
        />
      </Section>
      <Section title="QR code">
        <QrCode value="https://example.com/g/ABCDE" label="Join ABCDE" />
      </Section>
      <Section title="Toast & status strip (fixed — shown in place here)">
        <div>
          <Toast message="Not enough players for that." onDismiss={noop} />
        </div>
        <StatusStrip>{STRINGS.common.reconnecting}</StatusStrip>
      </Section>
    </>
  );
}

// ── /dev/screens ─────────────────────────────────────────────────────────────

function frozenEnv(now: number): ScreenEnv {
  return { serverNow: () => now, frozen: true, actions: FROZEN_ACTIONS, pending: new Set() };
}

function Frame(props: { name: string; screen: string; children: ComponentChildren }) {
  return (
    <div class={styles.frameWrap}>
      <Text variant="label">{props.name}</Text>
      <Text variant="small">{props.screen}</Text>
      <div class={styles.frame}>{props.children}</div>
    </div>
  );
}

function ScreenGallery() {
  return (
    <div class={styles.frames}>
      <Frame name="profile" screen="1 Profile (first visit)">
        <ProfileScreen
          initial={{ nickname: '', presetId: 'fox' }}
          submitLabel="Save"
          onSave={noop}
          storage={null}
        />
      </Frame>
      <Frame name="home" screen="2 Home with a game to return to">
        <HomeScreen
          profile={{ nickname: 'Mikko', presetId: 'fox' }}
          savedGames={['ABCDE' as never]}
          creating={false}
          createError={null}
          onHost={noop}
          onJoin={noop}
          onReturn={noop}
          onEditProfile={noop}
        />
      </Frame>
      <Frame name="connecting" screen="Connecting / reconnecting">
        <ConnectingScreen reconnecting updating={false} onHome={noop} />
      </Frame>
      {SCREEN_FIXTURES.map((fixture) => (
        <Frame key={fixture.name} name={fixture.name} screen={fixture.screen}>
          <ScreenEnvContext.Provider value={frozenEnv(fixture.now)}>
            <PhaseScreen snapshot={fixture.snapshot} onHome={noop} storage={null} />
          </ScreenEnvContext.Provider>
        </Frame>
      ))}
      {MESSAGE_FIXTURES.map((fixture) => (
        <Frame key={fixture.name} name={fixture.name} screen={fixture.screen}>
          <MessageScreen fixture={fixture} />
        </Frame>
      ))}
    </div>
  );
}

/** What the store shows for a message — via the store's own error table, so they can't differ. */
function MessageScreen(props: { fixture: MessageFixture }) {
  const { message } = props.fixture;
  const exitProps = { onHome: noop, onUseHere: noop, onJoinAgain: noop, onRefresh: noop };
  switch (message.type) {
    case 'gameEnded':
      return <EndedScreen reason={message.reason} onHome={noop} />;
    case 'reclaimPending':
      return <ReclaimScreen state={{ status: 'pending' }} onCancel={noop} onHome={noop} />;
    case 'reclaimResult':
      return <ReclaimScreen state={{ status: 'denied' }} onCancel={noop} onHome={noop} />;
    case 'error': {
      const outcome = errorOutcome(message, false);
      switch (outcome.kind) {
        case 'exit':
          return <ExitScreen exit={{ kind: outcome.exit }} {...exitProps} />;
        case 'reload':
          return <ExitScreen exit={{ kind: 'refresh' }} {...exitProps} />;
        case 'updating':
          return <ConnectingScreen reconnecting updating onHome={noop} />;
        case 'joinError':
          return (
            <JoinProblemScreen
              error={outcome.joinError}
              nickname="Emma"
              onRetry={noop}
              onThatsMe={noop}
              onHome={noop}
            />
          );
        case 'leftDone':
        case 'resyncClock':
          return null;
        case 'reclaimUnavailable':
        case 'notice':
          return <Toast message={outcome.notice.code} onDismiss={noop} />;
        default: {
          const unknown: never = outcome;
          return unknown;
        }
      }
    }
    default:
      return <Text>{message.type}</Text>;
  }
}
