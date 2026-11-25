// All test bots of one game, kept per game key so they survive screen changes (lobby → question →
// results) while the tab stays open. The panel reads `view` and calls the actions.
import { signal, type Signal } from '@preact/signals';
import { AVATAR_PRESETS, type PresetId } from '../../../shared/avatars';
import { PROTOCOL_VERSION } from '../../../shared/constants';
import type { GameKey } from '../../../shared/protocol';
import { newToken } from '../../net/token';
import type { AnswerSpeed, BotState } from './brain';
import { createBot, LEFT, type Bot } from './bot';
import { freeBotName } from './names';

export type BotView = {
  readonly id: number;
  readonly name: string;
  readonly status: string;
};

export type Fleet = {
  readonly view: Signal<readonly BotView[]>;
  readonly speed: Signal<AnswerSpeed>;
  /** Add `count` bots. `takenNames` = nicknames already in the game (lowercase). */
  readonly add: (count: number, takenNames: ReadonlySet<string>) => void;
  readonly removeAll: () => void;
  readonly takeOneOffline: () => void;
  readonly bringBackOffline: () => void;
  readonly offlineCount: Signal<number>;
};

const fleets = new Map<string, Fleet>();

export function fleetFor(key: GameKey): Fleet {
  let fleet = fleets.get(key);
  if (fleet === undefined) {
    fleet = createFleet(key);
    fleets.set(key, fleet);
  }
  return fleet;
}

/** What the panel says about one bot. */
export function botStatus(state: BotState, connected: boolean, offline: boolean): string {
  if (state.stopped !== null) return `stopped: ${state.stopped}`;
  if (offline) return 'offline (taken offline)';
  if (!connected) return state.playerId === null ? 'joining…' : 'reconnecting…';
  if (state.playerId === null) return 'joining…';
  const host = state.hostId === state.playerId ? ' (host)' : '';
  switch (state.phase) {
    case 'LOBBY':
      return `in the lobby${host}`;
    case 'QUESTION':
      return (state.submitted ? 'answered' : 'answering…') + host;
    case 'RESULTS':
      return `watching the results${host}`;
    case 'ENDED':
      return 'game over';
    case null:
      return 'joining…';
    default: {
      const unknown: never = state.phase;
      return unknown;
    }
  }
}

function createFleet(key: GameKey): Fleet {
  const bots: { id: number; bot: Bot }[] = [];
  const view = signal<readonly BotView[]>([]);
  const speed = signal<AnswerSpeed>('normal');
  const offlineCount = signal(0);
  let nextId = 1;
  /** Names in the game as last told by the panel (people + bots), lowercase. */
  let gameNames: ReadonlySet<string> = new Set();

  const refresh = () => {
    // Bots that have left are gone from the game: drop them from the list too.
    for (let i = bots.length - 1; i >= 0; i--) {
      const entry = bots[i];
      if (entry?.bot.state.stopped === LEFT) {
        entry.bot.dispose();
        bots.splice(i, 1);
      }
    }
    view.value = bots.map(({ id, bot }) => ({
      id,
      name: bot.state.name,
      status: botStatus(bot.state, bot.connected, bot.offline),
    }));
    offlineCount.value = bots.filter(({ bot }) => bot.offline && bot.state.stopped === null).length;
  };
  const active = () => bots.filter(({ bot }) => bot.state.stopped === null);
  /** Every name in use: the game's and our own bots' (also those still joining). */
  const takenNames = () =>
    new Set([...gameNames, ...active().map(({ bot }) => bot.state.name.toLowerCase())]);
  const takeName = () => freeBotName(takenNames());

  const deps = {
    createSocket: (url: string) => new WebSocket(url),
    socketUrl: (gameKey: string) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${location.host}/ws/${gameKey}?v=${String(PROTOCOL_VERSION)}`;
    },
    timers: {
      setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
      clearTimeout: (id: number) => {
        window.clearTimeout(id);
      },
    },
    now: () => Date.now(),
    // Bots reconnect on their own backoff; they don't need "the page became visible".
    onVisible: () => () => undefined,
    random: () => Math.random(),
    speed: () => speed.peek(),
    takeName,
    newToken: () => newToken(),
    onChange: refresh,
  };

  const randomPreset = (): PresetId => {
    const preset = AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)];
    return preset?.id ?? AVATAR_PRESETS[0].id;
  };

  return {
    view,
    speed,
    offlineCount,
    add(count, names) {
      gameNames = names;
      for (let i = 0; i < count; i++) {
        const name = takeName();
        if (name === null) break;
        // Created one by one, so each sees the names of those before it.
        bots.push({ id: nextId++, bot: createBot(key, name, randomPreset(), deps) });
      }
      refresh();
    },
    removeAll() {
      // Each bot goes from the list once the server confirms its leave (offline ones come back first).
      for (const { bot } of bots) bot.leave();
      // Bots that had already stopped (game full, …) are simply forgotten.
      for (let i = bots.length - 1; i >= 0; i--) {
        const entry = bots[i];
        if (
          entry !== undefined &&
          entry.bot.state.stopped !== null &&
          entry.bot.state.stopped !== LEFT
        ) {
          entry.bot.dispose();
          bots.splice(i, 1);
        }
      }
      refresh();
    },
    takeOneOffline() {
      active()
        .find(({ bot }) => !bot.offline)
        ?.bot.goOffline();
      refresh();
    },
    bringBackOffline() {
      for (const { bot } of active()) if (bot.offline) bot.comeBack();
      refresh();
    },
  };
}
