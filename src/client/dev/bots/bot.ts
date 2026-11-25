// One test bot = one real WebSocket player: the phone's own connection manager (reconnect, ping,
// clock sync) + the pure bot brain. Its token lives in memory only — never localStorage — so a bot
// can never touch the tester's own saved login for this game.
import type { PresetId } from '../../../shared/avatars';
import { WS_CLOSE } from '../../../shared/constants';
import type { ClientMessage, GameKey } from '../../../shared/protocol';
import { createClock } from '../../net/clock';
import { createConnection, type ConnectionDeps } from '../../net/connection';
import {
  due,
  hello,
  newBot,
  receive,
  type AnswerSpeed,
  type BotState,
  type Scheduled,
} from './brain';

export type BotDeps = Omit<ConnectionDeps, 'clock'> & {
  readonly random: () => number;
  /** Read when each question starts, so a speed change applies from the next question. */
  readonly speed: () => AnswerSpeed;
  readonly takeName: () => string | null;
  readonly newToken: () => string;
  /** Something about this bot changed (for the panel). */
  readonly onChange: () => void;
};

/** Close codes after which reconnecting makes no sense. */
const FINAL_CLOSE: ReadonlyMap<number, string> = new Map([
  [WS_CLOSE.REPLACED, 'opened somewhere else'],
  [WS_CLOSE.GAME_DELETED, 'the game was deleted'],
  [WS_CLOSE.PROTOCOL_MISMATCH, 'the app was updated: reload the page'],
  [WS_CLOSE.NOT_FOUND, 'game not found'],
  [WS_CLOSE.TOO_MANY_CONNECTIONS, 'too many connections'],
]);

export type Bot = ReturnType<typeof createBot>;

/** The stop reason after a confirmed leave (the fleet drops such bots from its list). */
export const LEFT = 'left the game';

export function createBot(key: GameKey, name: string, presetId: PresetId, deps: BotDeps) {
  const clock = createClock(deps.now);
  let state: BotState = newBot(deps.newToken(), name, presetId);
  /** Taken offline on purpose by the tester (not stopped: it can come back). */
  let offline = false;
  /** Leave as soon as the server has let us in again (asked to leave while offline). */
  let leaveWhenBack = false;
  const pending = new Set<number>();

  const clearPending = () => {
    for (const id of pending) deps.timers.clearTimeout(id);
    pending.clear();
  };
  const send = (message: ClientMessage) => connection.send(message);

  const connection = createConnection(
    { ...deps, clock },
    {
      onOpen: () => {
        if (state.stopped === null) send(hello(state));
      },
      onMessage: (message) => {
        const step = receive(state, message, {
          random: deps.random,
          speed: deps.speed(),
          now: clock.serverNow(),
          takeName: deps.takeName,
        });
        state = step.state;
        if (message.type === 'welcome') {
          connection.resetBackoff();
          if (leaveWhenBack) {
            leaveWhenBack = false;
            send({ type: 'leave' });
          }
        }
        for (const out of step.send) send(out);
        for (const item of step.schedule) schedule(item);
        if (state.stopped !== null) finish();
        deps.onChange();
      },
      onClose: (code) => {
        const reason = FINAL_CLOSE.get(code);
        if (reason !== undefined) {
          state = { ...state, stopped: reason };
          finish();
        }
        deps.onChange();
      },
    },
  );
  connection.onStatus(() => {
    deps.onChange();
  });

  function schedule(item: Scheduled) {
    const wait = Math.max(0, item.at - clock.serverNow());
    const id = deps.timers.setTimeout(() => {
      pending.delete(id);
      const result = due(state, item);
      state = result.state;
      if (result.send !== null) send(result.send);
      deps.onChange();
    }, wait);
    pending.add(id);
  }

  function finish() {
    clearPending();
    connection.stop();
  }

  connection.connect(key);

  return {
    get state(): BotState {
      return state;
    },
    get offline(): boolean {
      return offline;
    },
    get connected(): boolean {
      return connection.status === 'open';
    },
    /** Leave the game for good (frees the name); the bot stops when the server confirms. */
    leave(): void {
      if (state.stopped !== null) return;
      if (state.playerId === null) {
        // Never got in: nothing to leave on the server.
        state = { ...state, stopped: LEFT };
        finish();
      } else if (!send({ type: 'leave' })) {
        // Offline or reconnecting: leave right after the next welcome.
        leaveWhenBack = true;
        if (offline) {
          offline = false;
          connection.connect(key);
        }
      }
      deps.onChange();
    },
    /** Like a phone whose screen locked: the socket closes, the player stays in the game. */
    goOffline(): void {
      if (state.stopped !== null || offline) return;
      offline = true;
      clearPending();
      connection.stop();
      deps.onChange();
    },
    comeBack(): void {
      if (state.stopped !== null || !offline) return;
      offline = false;
      connection.connect(key);
      deps.onChange();
    },
    dispose(): void {
      clearPending();
      connection.dispose();
    },
  };
}
