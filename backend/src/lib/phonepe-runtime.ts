// Builds the real PhonePe provider from Secrets Manager config. The only module that turns
// credentials into an SDK client; handlers get back a provider (plus its non-secret
// `environment`) and never see the credentials themselves.

import { Env, StandardCheckoutClient } from '@phonepe-pg/pg-sdk-node';
import { loadPhonePeConfig } from './phonepe-config';
import { PhonePePaymentProvider } from './phonepe-payment-provider';

let provider: PhonePePaymentProvider | null = null;

/** `returnUrl` is the customer redirect target (the future payment-return page); optional because
 *  start-payment can pass one per request. */
export async function getPhonePePaymentProvider(returnUrl?: string): Promise<PhonePePaymentProvider> {
  const config = await loadPhonePeConfig();
  if (provider && provider.environment === config.environment) {
    return provider;
  }
  // shouldPublishEvents=false: no SDK telemetry to PhonePe (the SDK only sends it in PRODUCTION
  // anyway). StandardCheckoutClient is a process-wide singleton inside the SDK.
  const client = StandardCheckoutClient.getInstance(
    config.clientId,
    config.clientSecret,
    config.clientVersion,
    Env[config.environment],
    false,
  );
  provider = new PhonePePaymentProvider(client, { environment: config.environment, returnUrl });
  return provider;
}
