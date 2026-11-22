// Ready-made avatars (G-2). Placeholder style: emoji on a colored circle — the final style is
// decided later (user task U2), and only this list and the Avatar component change then.
//
// Colors are NOT defined here: `tone` refers to the design tokens --avatar-tone-1 … --avatar-tone-8
// in client/styles/tokens.css (raw colors live only there — CLAUDE.md §7 "UI architecture").
//
// NEVER REMOVE OR RENAME a preset id — only add new ones (and only change emoji/tone). Ids are
// stored in phones' profiles and in saved games: removing one makes such a saved game fail its
// schema check (→ ended as 'updated') and such a phone's hello invalid. The client still falls
// back to a random preset if its stored id is unknown (Phase 5C), as a second line of defence.

export const AVATAR_TONE_COUNT = 8;
/** 1…AVATAR_TONE_COUNT → CSS token --avatar-tone-N */
export type AvatarTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type PresetDefinition = { readonly id: string; readonly emoji: string; readonly tone: AvatarTone };

// Well-established emoji only (supported on old phones too).
export const AVATAR_PRESETS = [
  { id: 'fox', emoji: '🦊', tone: 1 },
  { id: 'cat', emoji: '🐱', tone: 2 },
  { id: 'dog', emoji: '🐶', tone: 3 },
  { id: 'panda', emoji: '🐼', tone: 4 },
  { id: 'frog', emoji: '🐸', tone: 5 },
  { id: 'owl', emoji: '🦉', tone: 6 },
  { id: 'octopus', emoji: '🐙', tone: 7 },
  { id: 'unicorn', emoji: '🦄', tone: 8 },
  { id: 'monkey', emoji: '🐵', tone: 1 },
  { id: 'penguin', emoji: '🐧', tone: 2 },
  { id: 'lion', emoji: '🦁', tone: 3 },
  { id: 'tiger', emoji: '🐯', tone: 4 },
  { id: 'koala', emoji: '🐨', tone: 5 },
  { id: 'pig', emoji: '🐷', tone: 6 },
  { id: 'bear', emoji: '🐻', tone: 7 },
  { id: 'rabbit', emoji: '🐰', tone: 8 },
  { id: 'chick', emoji: '🐥', tone: 1 },
  { id: 'turtle', emoji: '🐢', tone: 2 },
  { id: 'whale', emoji: '🐳', tone: 3 },
  { id: 'dolphin', emoji: '🐬', tone: 4 },
  { id: 'butterfly', emoji: '🦋', tone: 5 },
  { id: 'bee', emoji: '🐝', tone: 6 },
  { id: 'crab', emoji: '🦀', tone: 7 },
  { id: 'dragon', emoji: '🐲', tone: 8 },
  { id: 'alien', emoji: '👽', tone: 1 },
  { id: 'robot', emoji: '🤖', tone: 2 },
  { id: 'ghost', emoji: '👻', tone: 3 },
  { id: 'clown', emoji: '🤡', tone: 4 },
  { id: 'cactus', emoji: '🌵', tone: 5 },
  { id: 'pizza', emoji: '🍕', tone: 6 },
] as const satisfies readonly PresetDefinition[];

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export type PresetId = AvatarPreset['id'];

export const AVATAR_PRESET_IDS = AVATAR_PRESETS.map((preset) => preset.id) as [
  PresetId,
  ...PresetId[],
];

export function isAvatarPresetId(id: string): id is PresetId {
  return (AVATAR_PRESET_IDS as readonly string[]).includes(id);
}

export function getAvatarPreset(id: PresetId): AvatarPreset {
  const preset = AVATAR_PRESETS.find((p) => p.id === id);
  // Safe: PresetId is the literal union of exactly these ids.
  if (preset === undefined) throw new Error(`Unknown avatar preset ${id}`);
  return preset;
}
