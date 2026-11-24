// The drinking rules of one round (D-1…D-9): one number per reveal step, drawn once by the server
// when the results are made (D-2) — every phone and every reconnect sees the same numbers. Ties
// share their step's number (D-3); a place without a reveal step has no rule (D-4).
import { DRINK_RULES, drawSips } from '../../shared/drinkRules';
import type { RevealStep } from '../../shared/protocol';

export function withDrinkRules(steps: readonly RevealStep[], random: () => number): RevealStep[] {
  return steps.map((step) => {
    const range = DRINK_RULES[step.kind];
    return { ...step, rule: { action: range.action, sips: drawSips(range, random) } };
  });
}
