// Round timeline (G-39, G-40, G-49). Shared by server and phones: every screen change inside a
// round is derived from the timestamps the server sent once — no per-step messages.
import { ANSWER_GRACE_MS } from './constants';

export type RoundTimeline = {
  readonly answerStartsAt: number;
  readonly endsAt: number;
};

/**
 * What a phone shows during a round:
 * - intro:     question only (G-49)
 * - answering: ranking + timer
 * - waiting:   this player pressed Ready (G-38)
 * - closed:    time is up, results are on their way
 */
export type RoundStep = 'intro' | 'answering' | 'waiting' | 'closed';

export function roundStep(now: number, round: RoundTimeline, submitted: boolean): RoundStep {
  if (now < round.answerStartsAt) return 'intro';
  if (submitted) return 'waiting';
  if (now < round.endsAt) return 'answering';
  return 'closed';
}

/**
 * When roundStep() will next change for this phone, or null if it won't change by itself (the
 * phone is waiting, or the round is closed — the next change comes with a server message). Phones
 * set ONE timer to this instead of re-rendering every frame. The countdown bar is a CSS animation
 * computed from endsAt, not a per-frame re-render.
 */
export function nextRoundStepAt(
  now: number,
  round: RoundTimeline,
  submitted: boolean,
): number | null {
  if (now < round.answerStartsAt) return round.answerStartsAt;
  if (!submitted && now < round.endsAt) return round.endsAt;
  return null;
}

/** Server: whether an answer arriving at `now` is accepted (grace for last-moment answers). */
export function acceptsAnswers(now: number, round: RoundTimeline): boolean {
  return now >= round.answerStartsAt && now <= round.endsAt + ANSWER_GRACE_MS;
}

/** When the server closes the round at the latest (the round-end deadline). */
export function roundCloseDeadline(round: RoundTimeline): number {
  return round.endsAt + ANSWER_GRACE_MS;
}
