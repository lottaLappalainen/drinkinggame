import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AVATAR_PRESETS, AVATAR_PRESET_IDS, AVATAR_TONE_COUNT } from '../../src/shared/avatars';
import { MAX_CANDIDATES } from '../../src/shared/constants';
import {
  ClientMessageSchema,
  CreateGameRequestSchema,
  GameKeySchema,
  ServerMessageSchema,
  SnapshotSchema,
} from '../../src/shared/protocol';

const TOKEN = 'abcdefghijklmnopqrstuv'; // 22 base64url chars = 132 bits

describe('client messages are strictly validated', () => {
  it('accepts a resume hello and a join hello', () => {
    expect(
      v.safeParse(ClientMessageSchema, { type: 'hello', protocolVersion: 1, token: TOKEN }).success,
    ).toBe(true);
    expect(
      v.safeParse(ClientMessageSchema, {
        type: 'hello',
        protocolVersion: 1,
        token: TOKEN,
        nickname: 'Aino',
        presetId: 'cat',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown types, unknown fields and bad values', () => {
    const bad: unknown[] = [
      { type: 'hack' },
      { type: 'start', extra: 1 }, // strictObject: unknown field
      { type: 'hello', protocolVersion: 1, token: 'short' }, // token too short
      { type: 'hello', protocolVersion: 1, token: TOKEN, presetId: 'not-a-preset' },
      { type: 'setGameLength', length: 20 }, // only 15/25/35 (G-20)
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
