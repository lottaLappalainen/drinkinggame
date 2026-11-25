// Every piece of UI text, in one module (GAME_DESCRIPTION Q-5: English only, but kept in one place
// so another language could be added later). Place words (the top / 2nd / 3rd / bottom labels) are NOT here: they come
// from the question's label set via shared/questionLabels.ts `placeLabel` (Q-8). Category names
// come from shared/questionCategories.ts.
import type { ErrorCode } from '../shared/protocol';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** "Drink" / "Give out", or "You drink" / "You give out" (D-6). */
function drinkWords(action: 'drink' | 'give', you: boolean): string {
  if (action === 'drink') return you ? 'You drink' : 'Drink';
  return you ? 'You give out' : 'Give out';
}

export const STRINGS = {
  appName: 'drinkinggame', // working title (GAME_DESCRIPTION: final name not decided)
  common: {
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    close: 'Close',
    home: 'Home',
    loading: 'Loading…',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    updating: 'Updating…',
    you: 'you',
    host: 'Host',
    offline: 'Offline',
  },
  theme: {
    label: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },
  profile: {
    title: 'Who are you?',
    intro: 'Pick a name and a picture. Your friends will rank you by them.',
    nickname: 'Nickname',
    nicknameHint: (max: number) => `Up to ${String(max)} characters. Emoji count as one.`,
    nicknameEmpty: 'Pick a nickname.',
    nicknameTooLong: (max: number) => `That's more than ${String(max)} characters.`,
    picture: 'Picture',
    pickAvatar: (emoji: string) => `Avatar ${emoji}`,
    takeSelfie: 'Take selfie',
    choosePhoto: 'Choose photo',
    photoOr: 'Or use a photo:',
    photoInUse: 'Using your photo. Tap an emoji to use it instead.',
    photoUnreadable: "This phone can't read that picture. Try another one, or keep the emoji.",
    photoFailed: "Couldn't use that picture. Try another one, or keep the emoji.",
    save: 'Save',
    saveAndJoin: 'Save and join',
    edit: 'Edit profile',
  },
  home: {
    host: 'Host a game',
    hostHint: 'You get a key and a QR code your friends can scan.',
    joinTitle: 'Join a game',
    keyLabel: 'Game key',
    join: 'Join',
    returnTo: (key: string) => `Return to game ${key}`,
    hello: (name: string) => `Hi, ${name}!`,
    createFailed: "Couldn't create a game. Check the connection and try again.",
  },
  inAppBrowser: {
    title: 'Open in your browser',
    body: 'Chat apps open links in their own browser, which forgets you. Open this page in Safari or Chrome (⋯ menu → Open in browser), or scan the QR code with your camera.',
  },
  lobby: {
    keyLabel: 'Game key',
    shareHint: 'Scan to join, or open the link:',
    players: (n: number) => plural(n, 'player', 'players'),
    settings: 'Game settings',
    length: 'Questions',
    categoriesTitle: 'Extra questions',
    categoryHint: {
      spicy: 'Adds the spicy questions',
      luuppi: 'Adds the Luuppi questions',
    },
    mode: 'Game mode',
    modeNames: { spotlight: 'Spotlight', podium: 'Podium' },
    modeHints: {
      spotlight: 'A few players per question. Rank them all.',
      podium: 'Everyone, every question. Pick your top 3.',
    },
    podiumNeedsPlayers: (n: number) => `Podium needs ${String(n)}+ players`,
    start: 'Start game',
    needPlayers: (n: number) => `Start needs ${String(n)} players`,
    waitingForHost: 'Waiting for the host to start…',
    leave: 'Leave game',
    remove: 'Remove',
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: "They can't come back as themselves.",
    leaveTitle: 'Leave this game?',
    leaveBody: "You can't come back as yourself. Joining again makes you a new player.",
    reclaimTitle: (name: string) => `Someone says they are ${name}`,
    reclaimBody: 'Their phone lost its login. Let them continue as this player?',
    approve: "Yes, it's them",
    deny: 'No',
  },
  round: {
    /** Stands in for a "[player]" name the phone can't find (shouldn't happen, G-51). */
    someone: 'someone',
    number: (n: number, total: number) => `${String(n)} / ${String(total)}`,
    ready: 'Ready',
    readyCount: (ready: number, total: number) => `${String(ready)} / ${String(total)} ready`,
    placeAll: 'Place everyone to continue',
    placeTop: (n: number) => `Pick your top ${String(n)}`,
    waitingTitle: 'Waiting for the others…',
    answering: 'Answering…',
    readyMark: 'Ready ✓',
    notThisRound: "You'll join from the next question",
    timeUp: "Time's up",
    secondsLeft: (s: number) => `${String(s)} seconds left`,
    /** Screen-reader label of the intro bar (never shown). */
    startsSoon: 'Answering starts in a moment',
  },
  ranking: {
    /** How to place, by how a drag starts (ranking/gesture.ts DragStart). */
    howTo: {
      immediate: 'Drag players into the spots, or tap a player and then a spot.',
      hold: 'Hold a player to drag them, or tap a player and then a spot.',
    },
    spots: 'Your ranking',
    pool: 'Players to place',
    dropToRemove: 'Drop here to take them out',
  },
  results: {
    revealing: 'And the group says…',
    podiumSoFar: 'Revealed so far',
    fullRanking: 'The full ranking',
    notEnough: 'Not enough answers',
    notEnoughBody: (min: number) =>
      `At least ${String(min)} people need to answer for a group ranking.`,
    nobody: 'Nobody answered',
    nobodyBody: 'No ranking this time.',
    onlyTop: 'Only the top places are shown when few people answered.',
    next: 'Next question',
    finish: 'Finish',
    waitingForHost: 'Waiting for the host…',
  },
  // Drinking rules (D-1…D-9): the number comes from the server; the words live here.
  drinks: {
    sips: (n: number) => (n === 1 ? 'sip' : 'sips'),
    /** The words before the number: "Drink" / "Give out", or "You drink" / "You give out". */
    words: drinkWords,
    each: 'each',
    /** Full sentences for screen readers and the "you" banner: "Drink 5 sips", "You give out 1 sip". */
    sentence: (action: 'drink' | 'give', n: number, you = false) =>
      `${drinkWords(action, you)} ${String(n)} ${n === 1 ? 'sip' : 'sips'}`,
    /** Compact chip on the full ranking: "drinks 5", "gives out 7". */
    chip: (action: 'drink' | 'give', n: number) =>
      `${action === 'drink' ? 'drinks' : 'gives out'} ${String(n)}`,
  },
  paused: {
    title: 'Waiting for players',
    body: (n: number) => `The game needs ${String(n)} active players to continue.`,
  },
  ended: {
    title: 'Thanks for playing!',
    finished: 'That was the last question.',
    hostEnded: 'The host ended the game.',
    updatedTitle: 'The game was updated',
    updated: 'Please start a new game.',
    backHome: 'Back to home',
    playAgain: 'Play again',
    playAgainHint: 'Everyone comes along to a new lobby, with the same settings.',
    waitingForPlayAgain: 'The host can start a new game with everyone.',
    endGame: 'End game',
    menu: 'Game menu',
    players: 'Players',
    endTitle: 'End the game for everyone?',
    endBody: 'Answers of the current question are lost.',
  },
  exit: {
    notFound: {
      title: 'Game not found',
      body: 'Check the key. The game may also have ended already.',
    },
    left: { title: 'You left this game', body: 'Joining again makes you a new player.' },
    removed: {
      title: 'You were removed from this game',
      body: 'Joining again makes you a new player.',
    },
    reclaimed: {
      title: 'Your spot was continued on another phone',
      body: 'Someone continued as you on another phone, with the host’s OK.',
    },
    replaced: {
      title: 'Opened somewhere else',
      body: 'This game is open in another tab or browser.',
    },
    refresh: { title: 'Please refresh the page', body: 'A new version is available.' },
    useHere: 'Use here',
    joinAgain: 'Join again',
    refreshButton: 'Refresh',
  },
  join: {
    nameTaken: 'Name taken',
    nameTakenBody: 'Someone in this game already uses that name. Pick another one for this game.',
    thatsMe: "That's me",
    thatsMeHint: 'Lost your login? Ask the host to let you continue as yourself.',
    tryName: 'Use this name',
    gameFull: 'Game is full',
    gameFullBody: (max: number) => `This game already has ${String(max)} players.`,
    invalidName: 'That name doesn’t work. Try another one.',
    reclaimWaiting: 'Waiting for the host…',
    reclaimWaitingBody: 'The host has to confirm that it is you.',
    reclaimDenied: 'The host said no',
    reclaimDeniedBody: 'You can still join under another name.',
  },
  notices: {
    NOT_ALLOWED: "That isn't possible right now.",
    NOT_ENOUGH_PLAYERS: 'Not enough players for that. Someone may have just left.',
    PAUSED: 'Waiting for players before the next question.',
    INVALID: 'Something went wrong. Please try again.',
    NOT_ENOUGH_QUESTIONS: 'Not enough questions for that length.',
    RECLAIM_UNAVAILABLE: "That player is back or can't be taken over right now.",
    NOT_FOUND: 'That player is no longer in the game.',
    INVALID_NICKNAME: 'That name doesn’t work. Try another one.',
    TOO_EARLY: 'One moment, then try again.',
    CREATE_FAILED: "Couldn't create a game.",
  } satisfies Partial<Record<ErrorCode, string>>,
  fallbackNotice: 'Something went wrong.',
  dev: {
    ui: 'Component gallery',
    screens: 'Screen gallery',
    ranking: 'Ranking test',
  },
} as const;

/** The toast text for a refused request. */
export function noticeText(code: ErrorCode): string {
  return (STRINGS.notices as Partial<Record<ErrorCode, string>>)[code] ?? STRINGS.fallbackNotice;
}
