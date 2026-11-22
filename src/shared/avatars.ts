// Ready-made avatars (G-2). Placeholder style: emoji on a colored circle — the final style is
// decided later (user task U2), and only this list and the Avatar component change then.
//
// Colors are NOT defined here: `tone` refers to the design tokens --avatar-tone-1 … --avatar-tone-8
// in client/styles/tokens.css (raw colors live only there — CLAUDE.md §7 "UI architecture").

export const AVATAR_TONE_COUNT = 8;

export type AvatarPreset = {
  /** Stable id stored in profiles and game state — never rename an existing id. */
  readonly id: string;
  readonly emoji: string;
  /** 1…AVATAR_TONE_COUNT → CSS token --avatar-tone-N */
  readonly tone: number;
};

// Well-established emoji only (supported on old phones too).
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
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
];

export const AVATAR_PRESET_IDS: readonly string[] = AVATAR_PRESETS.map((preset) => preset.id);

export function isAvatarPresetId(id: string): boolean {
  return AVATAR_PRESET_IDS.includes(id);
}

export function getAvatarPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((preset) => preset.id === id);
}
