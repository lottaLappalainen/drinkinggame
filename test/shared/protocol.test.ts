import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AVATAR_PRESETS, AVATAR_PRESET_IDS, AVATAR_TONE_COUNT } from '../../src/shared/avatars';
import { MAX_CANDIDATES } from '../../src/shared/constants';
import {
  ClientMessageSchema,
  CreateGameRequestSchema,
  GameKeySchema,
  PresetIdSchema,
  RoundResultsSchema,
  ServerMessageSchema,
  SnapshotSchema,
} from '../../src/shared/protocol';

const TOKEN = 'abcdefghijklmnopqrstuv'; // 22 base64url chars = 132 bits

describe('client messages are strictly validated', () => {
  it('accepts a resume hello and a join hello', () => {
    expect(v.safeParse(ClientMessageSchema, { type: 'hello', token: TOKEN }).success).toBe(true);
    expect(
      v.safeParse(ClientMessageSchema, {
        type: 'hello',
        token: TOKEN,
        join: { nickname: 'Aino', presetId: 'cat' },
      }).success,
    ).toBe(true);
  });

  it('a join is ONE object — a nickname without a preset (or the reverse) cannot be sent', () => {
    for (const join of [{ nickname: 'Aino' }, { presetId: 'cat' }, {}]) {
      expect(v.safeParse(ClientMessageSchema, { type: 'hello', token: TOKEN, join }).success).toBe(
        false,
      );
    }
    // The old flat fields and the protocol version are gone (the version rides on the socket URL).
    for (const extra of [{ nickname: 'Aino', presetId: 'cat' }, { protocolVersion: 1 }]) {
      expect(
        v.safeParse(ClientMessageSchema, { type: 'hello', token: TOKEN, ...extra }).success,
      ).toBe(false);
    }
  });

  it('setSettings carries the whole settings: a known length and at least one known category', () => {
    const ok = { type: 'setSettings', settings: { gameLength: 25, categories: ['mild', 'spicy'] } };
    expect(v.safeParse(ClientMessageSchema, ok).success).toBe(true);
    for (const settings of [
      { gameLength: 20, categories: ['mild'] }, // only 15/25/35 (G-20)
      { gameLength: 25, categories: [] }, // at least one category (G-22)
      { gameLength: 25, categories: ['mild', 'mild'] }, // no duplicates
      { gameLength: 25, categories: ['wild'] }, // unknown category
      { gameLength: 25 }, // categories missing
    ]) {
      expect(
        v.safeParse(ClientMessageSchema, { type: 'setSettings', settings }).success,
        JSON.stringify(settings),
      ).toBe(false);
    }
  });

  it('rejects unknown types, unknown fields and bad values', () => {
    const bad: unknown[] = [
      { type: 'hack' },
      { type: 'start', extra: 1 }, // strictObject: unknown field
      { type: 'hello', token: 'short' }, // token too short
      { type: 'hello', token: TOKEN, join: { nickname: 'A', presetId: 'not-a-preset' } },
      { type: 'setGameLength', length: 20 }, // renamed to setSettings
      { type: 'submit', roundId: 0, ranking: ['Mikko0000001'] }, // roundId starts at 1
      { type: 'submit', roundId: 1, ranking: Array(MAX_CANDIDATES + 1).fill('Mikko0000001') },
      { type: 'submit', roundId: 1, ranking: ['not an id'] },
      { type: 'updateProfile', photoVersion: 3 }, // a phone can never claim a photo
    ];
    for (const message of bad) {
      expect(v.safeParse(ClientMessageSchema, message).success, JSON.stringify(message)).toBe(
        false,
      );
    }
  });

  it('validates the create-game request', () => {
    expect(
      v.safeParse(CreateGameRequestSchema, { nickname: 'Mikko', presetId: 'fox', token: TOKEN })
        .success,
    ).toBe(true);
    expect(
      v.safeParse(CreateGameRequestSchema, { nickname: 'Mikko', presetId: 'fox' }).success,
    ).toBe(false);
  });
});

describe('game keys (G-11)', () => {
  it('accepts 5 characters from the unambiguous alphabet only', () => {
    expect(v.safeParse(GameKeySchema, 'ABCDE').success).toBe(true);
    for (const bad of ['ABCD', 'ABCDEF', 'ABCD0', 'ABCDO', 'ABCD1', 'ABCDI', 'ABCDL', 'abcde']) {
      expect(v.safeParse(GameKeySchema, bad).success, bad).toBe(false);
    }
  });
});

// ── Vote secrecy & token safety: walk every outgoing schema ─────────────────

const FORBIDDEN_KEYS = [
  'answers',
  'token',
  'tokenHash',
  'requesterTokenHash',
  'reclaimTokenHash',
  'points',
];

/** Collects every object key reachable in a Valibot schema (objects, variants, arrays, …). */
function collectKeys(
  schema: unknown,
  seen = new Set<unknown>(),
  keys = new Set<string>(),
): Set<string> {
  if (schema === null || typeof schema !== 'object' || seen.has(schema)) return keys;
  seen.add(schema);
  const s = schema as Record<string, unknown>;
  if (s.entries && typeof s.entries === 'object') {
    for (const [key, child] of Object.entries(s.entries as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(child, seen, keys);
    }
  }
  for (const field of ['options', 'pipe', 'items'] as const) {
    if (Array.isArray(s[field]))
      for (const child of s[field] as unknown[]) collectKeys(child, seen, keys);
  }
  for (const field of ['item', 'wrapped', 'key', 'value'] as const)
    collectKeys(s[field], seen, keys);
  return keys;
}

describe('outgoing messages can never carry secrets (S-6, CLAUDE.md §5)', () => {
  it('the walker sees nested keys (sanity check)', () => {
    const keys = collectKeys(ServerMessageSchema);
    expect(keys).toContain('snapshot');
    expect(keys).toContain('ranking');
    expect(keys).toContain('averageSpot');
  });

  it('no server→client schema contains answers, tokens, token hashes or points', () => {
    const keys = collectKeys(ServerMessageSchema);
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it('strict schemas reject a smuggled secret in a snapshot', () => {
    const result = v.safeParse(SnapshotSchema, { tokenHash: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('avatar presets', () => {
  it('has ~30 presets with unique ids and valid tones', () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(AVATAR_PRESET_IDS).size).toBe(AVATAR_PRESET_IDS.length);
    for (const preset of AVATAR_PRESETS) {
      expect(preset.tone).toBeGreaterThanOrEqual(1);
      expect(preset.tone).toBeLessThanOrEqual(AVATAR_TONE_COUNT);
    }
  });
});

describe('variants make impossible states unrepresentable (Phase 2 review)', () => {
  const lobby = {
    phase: 'LOBBY',
    key: 'ABCDE',
    gameId: 'Game00000001',
    hostId: 'Mikko0000001',
    settings: { gameLength: 25, categories: ['mild', 'spicy'] },
    questionCounts: { mild: 20, spicy: 10, personal: 10 },
    players: [],
    you: { playerId: 'Mikko0000001' },
    reclaims: [],
  };

  it('a LOBBY snapshot cannot carry a round, results or a submitted flag', () => {
    expect(v.safeParse(SnapshotSchema, lobby).success).toBe(true);
    expect(v.safeParse(SnapshotSchema, { ...lobby, round: null }).success).toBe(false);
    expect(v.safeParse(SnapshotSchema, { ...lobby, results: null }).success).toBe(false);
    expect(
      v.safeParse(SnapshotSchema, { ...lobby, you: { playerId: 'Mikko0000001', submitted: true } })
        .success,
    ).toBe(false);
  });

  it('results without a ranking cannot carry steps or a ranking', () => {
    const nobody = {
      roundId: 1,
      outcome: 'nobodyAnswered',
      answerCount: 0,
      revealStartsAt: 1,
      revealEndsAt: 1,
    };
    expect(v.safeParse(RoundResultsSchema, nobody).success).toBe(true);
    expect(v.safeParse(RoundResultsSchema, { ...nobody, steps: [] }).success).toBe(false);
    expect(v.safeParse(RoundResultsSchema, { ...nobody, outcome: 'ranked' }).success).toBe(false);
  });

  it('only NAME_TAKEN errors may carry reclaimPlayerId; any error may name its request', () => {
    const ok = (message: unknown) => v.safeParse(ServerMessageSchema, message).success;
    expect(ok({ type: 'error', code: 'NAME_TAKEN', reclaimPlayerId: 'Emma00000006' })).toBe(true);
    expect(ok({ type: 'error', code: 'GAME_FULL', reclaimPlayerId: 'Emma00000006' })).toBe(false);
    expect(ok({ type: 'error', code: 'NOT_ALLOWED', for: 'advance' })).toBe(true);
    expect(ok({ type: 'error', code: 'NOT_ALLOWED', for: 'nonsense' })).toBe(false);
  });

  it('avatar presets are a closed list', () => {
    expect(v.safeParse(PresetIdSchema, 'fox').success).toBe(true);
    expect(v.safeParse(PresetIdSchema, 'not-a-preset').success).toBe(false);
  });
});
