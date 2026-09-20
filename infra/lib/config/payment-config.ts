/**
 * Per-environment PhonePe payment configuration for the Play X Cafe CDK app.
 *
 * Kept separate from the other per-concern config files (see api-config.ts). None of this is a
 * credential: the PhonePe client id/secret live only in the pre-existing Secrets Manager secret
 * named below, which CDK references by name and NEVER creates, reads or prints.
 */
export interface PaymentConfig {
  /** Name (not ARN) of the existing Secrets Manager secret holding the PhonePe credentials. */
  phonepeSecretName: string;
  /** Expected PhonePe environment; the backend cross-checks it against the secret's own value. */
  phonepeEnvironment: 'SANDBOX' | 'PRODUCTION';
  /** Minutes a simulator hold / PhonePe order lives once checkout starts (backend bounds: 5-60). */
  checkoutHoldMinutes: number;
  /** Customer return page PhonePe redirects to after checkout (UX only, never payment proof). */
  returnUrl: string;
}

export const paymentConfigs: Record<'dev' | 'prod', PaymentConfig> = {
  dev: {
    phonepeSecretName: 'playx/phonepe/sandbox',
    phonepeEnvironment: 'SANDBOX',
    checkoutHoldMinutes: 20,
    returnUrl: 'https://staging.playxcafe.com/payment-return.html',
  },
  prod: {
    // TODO: revisit before a prod stack exists (a production PhonePe secret + production return
    // URL). Not read by any stack this phase (see bin/infra.ts).
    phonepeSecretName: 'playx/phonepe/sandbox',
    phonepeEnvironment: 'SANDBOX',
    checkoutHoldMinutes: 20,
    returnUrl: 'https://staging.playxcafe.com/payment-return.html',
  },
};

/**
 * Who may start a SANDBOX payment: comma-separated Cognito subs and/or verified emails, supplied at
 * deploy time via `cdk deploy -c phonepeSandboxTesters=...` or the PHONEPE_SANDBOX_TESTERS
 * environment variable — never committed. Empty/absent is valid and FAILS CLOSED: the backend
 * (lib/sandbox-access.ts) then denies every payment start. The value is a plain Lambda environment
 * variable (visible to anyone who can read the function configuration); it holds no secret.
 */
export function resolveSandboxTesters(contextValue: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof contextValue === 'string' && contextValue.trim() !== '' ? contextValue : (env.PHONEPE_SANDBOX_TESTERS ?? '');
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join(',');
}
