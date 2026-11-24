// The app shell: route → Profile / Home / a game (G-17). Inside a game the SCREEN comes from the
// store (exit → join problem → "That's me" → connecting → the snapshot's phase), never from the
// URL — so refresh and Back always land correctly.
import type { ComponentType } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GameKey, Snapshot } from '../shared/protocol';
import { isInAppBrowser, useWakeLock } from './device';
import { gamePath, navigate, navigationCause, route, type Route } from './router';
import type { DevGalleryPage } from './dev/Gallery';
import { ScreenEnvContext, type ScreenEnv } from './screens/env';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import {
  ConnectingScreen,
  EndedScreen,
  ExitScreen,
  JoinProblemScreen,
  ReclaimScreen,
} from './screens/StatusScreens';
import { randomPreset, type Profile, type Storage } from './storage';
import { appStorage, appStore } from './store/app';
import { noticeText, STRINGS } from './strings';
import { StatusStrip, Toast } from './ui/Feedback';

export function App() {
  const storage = appStorage();
  const [profile, setProfile] = useState<Profile | null>(() => storage.loadProfile());
  const [editing, setEditing] = useState(false);
  const current = route.value;

  if (current.name === 'devUi' || current.name === 'devScreens' || current.name === 'devRanking')
    return <DevPage route={current} />;

  if (profile === null || editing) {
    const store = appStore();
    // In a game, edit how you appear THERE (a name picked after "Name taken" is for this game only,
    // G-14) — not the saved profile's values.
    const me = editing && current.name === 'game' ? store.me.value : null;
    const initial: Profile =
      me !== null
        ? { nickname: me.nickname, presetId: me.avatar.presetId }
        : (profile ?? { nickname: '', presetId: randomPreset(Math.random) });
    return (
      <ProfileScreen
        initial={initial}
        initialPhoto={storage.loadPhoto()}
        submitLabel={
          current.name === 'game' && profile === null
            ? STRINGS.profile.saveAndJoin
            : STRINGS.profile.save
        }
        storage={storage}
        {...(profile !== null && {
          onCancel: () => {
            setEditing(false);
          },
        })}
        onSave={(next, photo) => {
          const photoChanged = photo !== storage.loadPhoto();
          storage.saveProfile(next);
          storage.savePhoto(photo);
          setProfile(next);
          setEditing(false);
          // In a lobby, the game hears about the new name / picture too (G-5). A new photo goes up
          // over HTTP (the store decides whether this game may still take it).
          if (store.snapshot.value?.phase === 'LOBBY') store.updateProfile(next);
          if (photoChanged) store.photoChanged(photo);
        }}
      />
    );
  }

  if (current.name === 'game')
    return (
      <Game
        key={current.key}
        gameKey={current.key}
        profile={profile}
        onEditProfile={() => {
          setEditing(true);
        }}
      />
    );
  return (
    <Home
      profile={profile}
      onEditProfile={() => {
        setEditing(true);
      }}
    />
  );
}

function Home(props: { profile: Profile; onEditProfile: () => void }) {
  const store = appStore();
  const storage = appStorage();
  return (
    <HomeScreen
      profile={props.profile}
      savedGames={storage.savedGameKeys()}
      creating={store.creating.value}
      createError={store.createError.value}
      onEditProfile={props.onEditProfile}
      onReturn={(key) => {
        navigate(gamePath(key));
      }}
      onJoin={(key) => {
        navigate(gamePath(key));
      }}
      onHost={() => {
        void store.hostGame(props.profile).then((ok) => {
          const key = store.gameKey.value;
          if (ok && key !== null) navigate(gamePath(key));
        });
      }}
    />
  );
}

function Game(props: { gameKey: GameKey; profile: Profile; onEditProfile: () => void }) {
  const store = appStore();
  const storage = appStorage();
  const { gameKey: key, profile } = props;
  const open = store.gameKey.value;
  const started = useRef(false);

  // Open this game once per visit: resume this phone's login, or join (opening a join link with a
  // profile joins right away, §4.2). When the store closes the game (Leave, Home), go Home.
  useEffect(() => {
    if (open === key) {
      started.current = true;
      return;
    }
    if (started.current) {
      navigate('/', { replace: true });
      return;
    }
    if (store.resume(key)) return;
    // No login for this key. Joining needs an explicit act — opening the link or tapping Join /
    // Host — never Back / Forward onto an old game URL (after LEFT / REMOVED that would silently
    // make a new player, CLAUDE.md §5).
    if (navigationCause.peek() === 'history') navigate('/', { replace: true });
    else store.joinGame(key, profile);
  }, [key, open, profile, store]);

  const snapshot = store.snapshot.value;
  const exit = store.exit.value;
  const joinError = store.joinError.value;
  const reclaim = store.reclaim.value;
  const notice = store.notice.value;
  const status = store.connectionStatus.value;
  useWakeLock(snapshot !== null && snapshot.phase !== 'ENDED');

  // Replace, not push: Back must not land on this game's URL again.
  const goHome = () => {
    store.goHome();
    navigate('/', { replace: true });
  };
  const env = useMemo<ScreenEnv>(
    () => ({
      serverNow: store.serverNow,
      frozen: false,
      pending: store.pending.value,
      actions: {
        updateProfile: store.updateProfile,
        setSettings: store.setSettings,
        start: store.start,
        submit: store.submit,
        advance: store.advance,
        endGame: store.endGame,
        leave: store.leave,
        removePlayer: store.removePlayer,
        answerReclaim: store.answerReclaim,
        goHome,
        editProfile: props.onEditProfile,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's intents never change; pending does
    [store.pending.value],
  );

  let screen;
  if (exit !== null)
    screen = (
      <ExitScreen
        exit={exit}
        onHome={goHome}
        onUseHere={store.useHere}
        onJoinAgain={() => {
          store.joinAgain(key, profile);
        }}
        onRefresh={() => {
          location.reload();
        }}
      />
    );
  else if (reclaim !== null)
    screen = <ReclaimScreen state={reclaim} onCancel={store.cancelReclaim} onHome={goHome} />;
  else if (joinError !== null)
    screen = (
      <JoinProblemScreen
        error={joinError}
        nickname={profile.nickname}
        onRetry={(nickname) => {
          store.retryJoin({ nickname, presetId: profile.presetId });
        }}
        onThatsMe={() => {
          if (joinError.reclaimPlayerId !== undefined)
            store.reclaimPlayer(joinError.reclaimPlayerId, profile);
        }}
        onHome={goHome}
      />
    );
  else if (snapshot === null)
    screen = (
      <ConnectingScreen
        reconnecting={status === 'waiting'}
        updating={store.updating.value}
        onHome={goHome}
      />
    );
  else screen = <PhaseScreen snapshot={snapshot} onHome={goHome} storage={storage} />;

  return (
    <ScreenEnvContext.Provider value={env}>
      {snapshot !== null && exit === null && (status !== 'open' || store.updating.value) && (
        <StatusStrip>
          {store.updating.value ? STRINGS.common.updating : STRINGS.common.reconnecting}
        </StatusStrip>
      )}
      {screen}
      {notice !== null && (
        <Toast message={noticeText(notice.code)} onDismiss={store.dismissNotice} />
      )}
    </ScreenEnvContext.Provider>
  );
}

/** The game screen for the snapshot's phase (a variant — no checks for fields a phase lacks). */
export function PhaseScreen(props: {
  snapshot: Snapshot;
  onHome: () => void;
  storage: Storage | null;
}) {
  const { snapshot } = props;
  switch (snapshot.phase) {
    case 'LOBBY':
      return (
        <LobbyScreen
          snapshot={snapshot}
          joinUrl={`${location.origin}${gamePath(snapshot.key)}`}
          storage={props.storage}
          inAppBrowser={isInAppBrowser(navigator.userAgent)}
        />
      );
    case 'QUESTION':
      return <QuestionScreen snapshot={snapshot} />;
    case 'RESULTS':
      return <ResultsScreen snapshot={snapshot} />;
    case 'ENDED':
      return <EndedScreen reason={snapshot.endReason} onHome={props.onHome} />;
    default: {
      const unknown: never = snapshot;
      return unknown;
    }
  }
}

/** The dev galleries — dev and staging builds only (production drops this import entirely). */
const DEV_PAGES = { devUi: 'ui', devScreens: 'screens', devRanking: 'ranking' } as const;

function DevPage(props: { route: Extract<Route, { name: keyof typeof DEV_PAGES }> }) {
  const [Gallery, setGallery] = useState<ComponentType<{ page: DevGalleryPage }> | null>(null);
  useEffect(() => {
    if (import.meta.env.MODE !== 'production') {
      void import('./dev/Gallery').then((module) => {
        setGallery(() => module.Gallery);
      });
    }
  }, []);
  if (Gallery === null) return null;
  return <Gallery page={DEV_PAGES[props.route.name]} />;
}
