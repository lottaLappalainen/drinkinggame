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
import type { Placement } from '../ranking/gesture';
import { RankingBoard } from '../ranking/RankingBoard';
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
import {
  Avatar,
  Countdown,
  DrinkBadge,
  DrinkChip,
  Drumroll,
  PlayerChip,
  QuestionText,
  ReadyList,
  RevealStep,
} from '../ui/Game';
import { DRINK_RULES } from '../../shared/drinkRules';
import { Dock, Row, Stack } from '../ui/Layout';
import { PhotoPicker } from '../ui/PhotoPicker';
import { PlaceNumber } from '../ui/PlaceNumber';
import { PodiumTray } from '../ui/Podium';
import { QrCode } from '../ui/QrCode';
import { Heading, Text } from '../ui/Text';
import styles from './Gallery.module.css';
import { RankingPrototype } from './RankingPrototype';

/** The dev pages: component gallery, screen gallery, ranking test page (5B, phone test U5). */
export type DevGalleryPage = 'ui' | 'screens' | 'ranking';

const PAGE_PATHS: Record<DevGalleryPage, string> = {
  ui: '/dev/ui',
  screens: '/dev/screens',
  ranking: '/dev/ranking',
};

export function Gallery(props: { page: DevGalleryPage }) {
  return (
    <div class={styles.page}>
      <div class={styles.bar}>
        {(['ui', 'screens', 'ranking'] as const).map((page) => (
          <Button
            key={page}
            variant={props.page === page ? 'primary' : 'ghost'}
            onClick={() => {
              navigate(PAGE_PATHS[page]);
            }}
          >
            {STRINGS.dev[page]}
          </Button>
        ))}
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
      {props.page === 'ui' && <ComponentGallery />}
      {props.page === 'screens' && <ScreenGallery />}
      {props.page === 'ranking' && <RankingPrototype />}
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
const TWELVE = manyPlayers(12);
const noop = () => undefined;

function Components() {
  const [text, setText] = useState('Mikko');
  const [segment, setSegment] = useState<15 | 25 | 35>(25);
  const [toggle, setToggle] = useState(true);
  const [placement, setPlacement] = useState<Placement>([P.aino, null, null, null, null]);
  const [podium, setPodium] = useState<Placement>([null, null, null]);
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
      <Section title="Photo buttons (idle / reading a photo / unreadable photo)">
        <PhotoPicker onFile={noop} />
        <PhotoPicker onFile={noop} busy />
        <PhotoPicker onFile={noop} error={STRINGS.profile.photoUnreadable} />
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
      <Section title="Countdown (frozen at 60 %, in the last seconds, and the intro bar filling up)">
        <Countdown startsAt={T0} endsAt={T0 + 30_000} now={T0 + 18_000} frozen />
        <Countdown startsAt={T0} endsAt={T0 + 30_000} now={T0 + 27_000} frozen />
        <Countdown startsAt={T0} endsAt={T0 + 4_000} now={T0 + 2_500} frozen intro />
      </Section>
      <Section title="Place numbers (full ranking: medals for 1 to 3, a tie shares one, plain below)">
        <Row gap="3" wrap>
          {[1, 1, 3, 4, 12].map((place, i) => (
            <PlaceNumber key={i} place={place} />
          ))}
        </Row>
      </Section>
      <Section title="Podium tray: silver left, bronze right (only bronze so far / both, a tie shares a card / only one slot, centred)">
        <PodiumTray
          label="Revealed so far"
          slots={[null, { place: 3, players: SIX.slice(3, 4) }]}
        />
        <PodiumTray
          label="Revealed so far"
          slots={[
            { place: 2, players: SIX.slice(1, 3) },
            { place: 3, players: SIX.slice(3, 4) },
          ]}
        />
        <PodiumTray label="Revealed so far" slots={[{ place: 2, players: SIX.slice(1, 2) }]} />
      </Section>
      <Section title="Reveal (with the drinking rule a beat after the names)">
        <RevealStep
          label="Least likely"
          players={SIX.slice(5)}
          rule={{ kind: 'bottom', rule: { action: 'drink', sips: 5 }, appearInMs: 700 }}
        />
        <RevealStep
          label="Most likely"
          players={SIX.slice(0, 2)}
          top
          rule={{ kind: 'top', rule: { action: 'give', sips: 7 }, appearInMs: 700 }}
        />
        <Drumroll />
      </Section>
      <Section title="Drinking rules (drink / give out / 1 sip / shared / you / chips)">
        <Row wrap>
          <DrinkBadge rule={{ action: 'drink', sips: 6 }} range={DRINK_RULES.bottom} />
          <DrinkBadge rule={{ action: 'give', sips: 10 }} range={DRINK_RULES.top} />
          <DrinkBadge rule={{ action: 'drink', sips: 1 }} range={DRINK_RULES.third} />
          <DrinkBadge rule={{ action: 'drink', sips: 3 }} range={DRINK_RULES.second} shared />
          <DrinkBadge rule={{ action: 'drink', sips: 4 }} range={DRINK_RULES.second} you />
          <DrinkBadge rule={{ action: 'give', sips: 2 }} range={DRINK_RULES.top} you />
        </Row>
        <Row wrap>
          <DrinkChip rule={{ action: 'drink', sips: 5 }} />
          <DrinkChip rule={{ action: 'give', sips: 7 }} />
        </Row>
      </Section>
      <Section title='Question about a player ("[player]", G-51)'>
        <QuestionText text="Who is the closest to [player]?" subject={SIX[1]} large center />
        <QuestionText text="Who is [player] most likely to kiss?" subject={SIX[2]} />
        <QuestionText text="Who is the funniest?" subject={null} />
      </Section>
      <Section title="Ranking board: Spotlight (drag or tap; full test page: /dev/ranking)">
        <RankingBoard
          candidates={SIX.slice(0, 5)}
          spots={5}
          captionFor={(spot) => (spot === 0 ? 'Most likely' : spot === 4 ? 'Least likely' : null)}
          placement={placement}
          onChange={setPlacement}
        />
      </Section>
      <Section title="Ranking board: Podium (12 players, hold to drag)">
        <RankingBoard
          candidates={TWELVE}
          spots={3}
          captionFor={(spot) => ['Most likely', '2nd most likely', '3rd most likely'][spot] ?? null}
          placement={podium}
          onChange={setPodium}
        />
      </Section>
      <Section title="Dock (the main action pinned to the bottom of a long page)">
        <Dock>
          <Button variant="accent" size="lg" block>
            Ready
          </Button>
        </Dock>
      </Section>
      <Section title="QR code">
        <QrCode value="https://example.com/g/ABCDE" label="Join ABCDE" />
      </Section>
      <Section title="Toast & status strip (fixed, shown in place here)">
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
          initialPhoto={null}
          submitLabel="Save"
          onSave={noop}
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
          storage={null}
        />
      </Frame>
      <Frame name="connecting" screen="Connecting / reconnecting">
        <ConnectingScreen reconnecting updating={false} onHome={noop} />
      </Frame>
      {SCREEN_FIXTURES.map((fixture) => (
        <Frame key={fixture.name} name={fixture.name} screen={fixture.screen}>
          <ScreenEnvContext.Provider value={frozenEnv(fixture.now)}>
            <PhaseScreen snapshot={fixture.snapshot} onHome={noop} />
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
      return <EndedScreen reason={message.reason} isHost={false} onHome={noop} />;
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
