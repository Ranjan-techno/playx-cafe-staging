// Environment-driven payment tunables. These are OUR policy knobs, not PhonePe constraints — this
// codebase does not assume any PhonePe-side minimum/maximum order expiry (the installed SDK
// passes `expireAfter` straight through without validating it). Bounds below only keep a
// misconfigured env var from producing a nonsensical hold.

export const DEFAULT_CHECKOUT_HOLD_MINUTES = 20;
const MIN_CHECKOUT_HOLD_MINUTES = 5;
const MAX_CHECKOUT_HOLD_MINUTES = 60;

/** Minutes a simulator hold (and the aligned PhonePe order) lives once checkout starts. */
export function getCheckoutHoldMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PAYMENT_CHECKOUT_HOLD_MINUTES;
  if (raw === undefined || raw === '') {
    return DEFAULT_CHECKOUT_HOLD_MINUTES;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CHECKOUT_HOLD_MINUTES || value > MAX_CHECKOUT_HOLD_MINUTES) {
    throw new Error(
      `PAYMENT_CHECKOUT_HOLD_MINUTES must be an integer between ${MIN_CHECKOUT_HOLD_MINUTES} and ${MAX_CHECKOUT_HOLD_MINUTES}`,
    );
  }
  return value;
}
