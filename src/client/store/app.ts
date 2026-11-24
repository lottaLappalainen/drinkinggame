// Builds the connection + store pair. The connection needs the store's handlers and the store needs
// the connection, so the handlers are passed through a late-bound reference. `browserApp()` wires
// them to the real browser; tests call `createApp()` with fakes.
//
// No import-time side effects (package.json "sideEffects", CLAUDE.md §2 Tree-shaking): the browser
// instance is created on the first `appStore()` call, from an entry point.
import { PROTOCOL_VERSION } from '../../shared/constants';
import { createClock } from '../net/clock';
import { createConnection, type ConnectionDeps } from '../net/connection';
import { newToken } from '../net/token';
import { browserStore, createStorage, type Storage } from '../storage';
import { createStore, type Store, type StoreDeps } from './store';

export type AppDeps = Omit<ConnectionDeps, 'clock'> &
  Omit<StoreDeps, 'connection' | 'clock' | 'storage'> & { readonly storage: Storage };

export function createApp(deps: AppDeps): Store {
  const clock = createClock(deps.now);
  let store: Store | null = null;
  const connection = createConnection(
    { ...deps, clock },
    {
      onOpen: () => store?.handlers.onOpen(),
      onMessage: (message) => store?.handlers.onMessage(message),
      onClose: (code) => store?.handlers.onClose(code),
    },
  );
  store = createStore({ ...deps, connection, clock });
  return store;
}

let deps: AppDeps | null = null;
let instance: Store | null = null;

/** The app's store (created on first use, in the browser). */
export function appStore(): Store {
  deps ??= browserDeps();
  instance ??= createApp(deps);
  return instance;
}

/** The same storage the store uses (profile, theme, saved games). */
export function appStorage(): Storage {
  deps ??= browserDeps();
  return deps.storage;
}

function browserDeps(): AppDeps {
  return {
    createSocket: (url) => new WebSocket(url),
    socketUrl: (key) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${location.host}/ws/${key}?v=${String(PROTOCOL_VERSION)}`;
    },
    timers: {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (id) => {
        window.clearTimeout(id);
      },
    },
    now: () => Date.now(),
    onVisible: (callback) => {
      const listener = () => {
        if (document.visibilityState === 'visible') callback();
      };
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
    storage: createStorage(browserStore('localStorage'), browserStore('sessionStorage')),
    fetch: (input, init) => fetch(input, init),
    newToken: () => newToken(),
    reload: () => {
      location.reload();
    },
  };
}
