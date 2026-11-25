// What the phone remembers (CLAUDE.md §7 Client). localStorage holds ONLY: `{token, gameId}` per
// game key, the pending-create token, the profile (nickname + preset), the last photo and the theme;
// sessionStorage holds only the outdated-reload timestamp. Every access is wrapped in try/catch
// (private mode, full storage, blocked site data), and everything read back is checked — stored
// data is as untrusted as anything else.
import { AVATAR_PRESET_IDS, isAvatarPresetId, type PresetId } from '../shared/avatars';
import { GAME_KEY_ALPHABET, GAME_KEY_LENGTH } from '../shared/constants';
import type { GameId, GameKey } from '../shared/protocol';

/** The part of the Web Storage API we use — injectable so tests need no browser. */
export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
};

/** This phone's login for one game key (CLAUDE.md §6 "Identity / rejoin"). */
export type GameEntry = {
  readonly token: string;
  /** The game this phone last saw under the key — absent until the first `welcome`. */
  readonly gameId?: GameId;
  /**
   * The game is over (Game Over screen). The login is kept, so a refresh still shows Game Over
   * during the retention window (G-48), but Home no longer offers "Return to game" for it.
   * Cleared again if the host taps "Play again" (G-52).
   */
  readonly ended?: true;
};

export type Profile = { readonly nickname: string; readonly presetId: PresetId };
export type Theme = 'system' | 'light' | 'dark';

const PREFIX = 'dg.';
const GAME_PREFIX = `${PREFIX}game.`;
const PENDING_CREATE = `${PREFIX}pendingCreate`;
const PROFILE = `${PREFIX}profile`;
const PHOTO = `${PREFIX}photo`;
const THEME = `${PREFIX}theme`;
const RELOADED_AT = `${PREFIX}reloadedAt`;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const ID_PATTERN = /^[0-9A-Za-z]{12}$/;
const KEY_PATTERN = new RegExp(`^[${GAME_KEY_ALPHABET}]{${String(GAME_KEY_LENGTH)}}$`);

export function isGameKey(value: string): value is GameKey {
  return KEY_PATTERN.test(value);
}

export type Storage = ReturnType<typeof createStorage>;

/**
 * @param local    usually `window.localStorage` (via `browserStore('localStorage')`)
 * @param session  usually `window.sessionStorage`
 * @param random   picks the fallback preset for a profile with an unknown preset id
 */
export function createStorage(
  local: KeyValueStore | null,
  session: KeyValueStore | null,
  random: () => number = Math.random,
) {
  const read = (store: KeyValueStore | null, key: string): unknown => {
    try {
      const raw = store?.getItem(key) ?? null;
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  };
  const write = (store: KeyValueStore | null, key: string, value: unknown): void => {
    try {
      store?.setItem(key, JSON.stringify(value));
    } catch {
      // Full or blocked storage: the game still works for this page load.
    }
  };
  const remove = (store: KeyValueStore | null, key: string): void => {
    try {
      store?.removeItem(key);
    } catch {
      // ignore
    }
  };
  const asEntry = (value: unknown): GameEntry | null => {
    if (typeof value !== 'object' || value === null) return null;
    const { token, gameId, ended } = value as Record<string, unknown>;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    return {
      token,
      ...(typeof gameId === 'string' && ID_PATTERN.test(gameId) && { gameId: gameId as GameId }),
      ...(ended === true && { ended: true as const }),
    };
  };

  return {
    // ── Games ──────────────────────────────────────────────────────────────
    loadGame(key: GameKey): GameEntry | null {
      return asEntry(read(local, GAME_PREFIX + key));
    },
    /** Saved BEFORE the token is ever sent (CLAUDE.md §3 "Phone-generated tokens"). */
    saveGame(key: GameKey, entry: GameEntry): void {
      write(local, GAME_PREFIX + key, entry);
    },
    forgetGame(key: GameKey): void {
      remove(local, GAME_PREFIX + key);
    },
    /** Every RUNNING game this phone has a login for (Home's "Return to game", G-17) — not ended ones. */
    savedGameKeys(): GameKey[] {
      const keys: GameKey[] = [];
      try {
        for (let i = 0; i < (local?.length ?? 0); i++) {
          const name = local?.key(i) ?? '';
          const key = name.slice(GAME_PREFIX.length);
          if (!name.startsWith(GAME_PREFIX) || !isGameKey(key)) continue;
          const entry = this.loadGame(key);
          if (entry !== null && entry.ended !== true) keys.push(key);
        }
      } catch {
        // ignore
      }
      return keys.sort();
    },

    // ── The pending-create slot (CLAUDE.md §5 HTTP) ────────────────────────
    /** The host's token while POST /api/games is in flight — the key isn't known yet. */
    savePendingCreate(token: string): void {
      write(local, PENDING_CREATE, { token });
    },
    loadPendingCreate(): string | null {
      return asEntry(read(local, PENDING_CREATE))?.token ?? null;
    },
    clearPendingCreate(): void {
      remove(local, PENDING_CREATE);
    },

    // ── Profile, photo, theme ──────────────────────────────────────────────
    /**
     * The saved profile. An unknown preset id (only possible if a preset was ever removed, which
     * the rules forbid) gets a random preset instead of being sent (Phase 2 review).
     */
    loadProfile(): Profile | null {
      const value = read(local, PROFILE);
      if (typeof value !== 'object' || value === null) return null;
      const { nickname, presetId } = value as Record<string, unknown>;
      if (typeof nickname !== 'string' || nickname.trim() === '') return null;
      const preset =
        typeof presetId === 'string' && isAvatarPresetId(presetId)
          ? presetId
          : randomPreset(random);
      return { nickname, presetId: preset };
    },
    saveProfile(profile: Profile): void {
      write(local, PROFILE, profile);
    },
    /** The last photo as a data URL (offered again on the next join). */
    loadPhoto(): string | null {
      const value = read(local, PHOTO);
      return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
    },
    savePhoto(dataUrl: string | null): void {
      if (dataUrl === null) remove(local, PHOTO);
      else write(local, PHOTO, dataUrl);
    },
    loadTheme(): Theme {
      const value = read(local, THEME);
      return value === 'light' || value === 'dark' ? value : 'system';
    },
    saveTheme(theme: Theme): void {
      write(local, THEME, theme);
    },

    // ── sessionStorage: the outdated-reload cap ────────────────────────────
    loadReloadedAt(): number | null {
      const value = read(session, RELOADED_AT);
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    },
    saveReloadedAt(at: number): void {
      write(session, RELOADED_AT, at);
    },
  };
}

export function randomPreset(random: () => number): PresetId {
  const index = Math.min(
    AVATAR_PRESET_IDS.length - 1,
    Math.floor(random() * AVATAR_PRESET_IDS.length),
  );
  // Safe: index is within the non-empty preset list.
  return AVATAR_PRESET_IDS[index] ?? AVATAR_PRESET_IDS[0];
}

/** `window.localStorage` / `sessionStorage`, or null where touching it throws (privacy settings). */
export function browserStore(name: 'localStorage' | 'sessionStorage'): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window[name];
  } catch {
    return null;
  }
}
