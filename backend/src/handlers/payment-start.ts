import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { DbClient } from '../lib/allocate-simulators';
import { getDb, resetDb } from '../lib/db';
import { errorResponse, jsonResponse } from '../lib/http';
import { PaymentProviderError } from '../lib/payment-errors';
import { isSafeCheckoutRedirect, mapPaymentError, parseBookingIdFromBody, readIdentity } from '../lib/payment-http';
import type { PaymentProviderAdapter } from '../lib/payment-provider';
import { findCustomerBooking } from '../lib/payment-repository';
import { getCheckoutHoldMinutes, getPaymentReturnUrl } from '../lib/payment-settings';
import type { PhonePeEnvironment } from '../lib/phonepe-config';
import { getPhonePePaymentProvider } from '../lib/phonepe-runtime';
import { assertPaymentStartAllowed } from '../lib/sandbox-access';
import { startPayment } from '../lib/start-payment';

// POST /payments/start — begins a PhonePe checkout for the caller's own pending booking.
//
// Cognito-JWT-protected (infra/lib/constructs/api.ts). The body carries ONLY { bookingId }; the
// amount comes from bookings.price_inr inside startPayment(), the environment and return URL from
// the Lambda's own config, and the customer from the verified `sub` — no price, status,
// environment, redirect URL, order id or simulator id is ever read from the request.
//
// Order of checks (cheapest/most-restrictive first, no provider or DB work before the gate):
//   401 no verified sub -> 400 bad bookingId -> SANDBOX tester gate (403) -> ownership (404) ->
//   startPayment() -> re-check the gate against the environment the secret ACTUALLY declares.

export interface PaymentStartDeps {
  getDb: () => Promise<DbClient>;
  resetDb: () => void;
  getProvider: (returnUrl?: string) => Promise<PaymentProviderAdapter & { environment: PhonePeEnvironment }>;
  env: NodeJS.ProcessEnv;
}

const defaultDeps: PaymentStartDeps = {
  getDb,
  resetDb,
  getProvider: getPhonePePaymentProvider,
  env: process.env,
};

/** PHONEPE_ENVIRONMENT from deploy config; anything but an explicit PRODUCTION is treated as
 *  SANDBOX so a missing/typo'd value lands on the stricter gate. */
function configuredEnvironment(env: NodeJS.ProcessEnv): PhonePeEnvironment {
  return env.PHONEPE_ENVIRONMENT === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

export function createHandler(deps: PaymentStartDeps = defaultDeps) {
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> => {
    const identity = readIdentity(event);
    if (!identity) {
      return errorResponse(401, 'unauthenticated', 'Missing subject claim');
    }
    const bookingId = parseBookingIdFromBody(event.body, event.isBase64Encoded);
    if (!bookingId) {
      return errorResponse(400, 'invalid_request', 'A valid bookingId is required');
    }

    try {
      assertPaymentStartAllowed(configuredEnvironment(deps.env), identity, deps.env.PHONEPE_SANDBOX_TESTERS);

      const db = await deps.getDb();
      const booking = await findCustomerBooking(db, bookingId, identity.sub);
      if (!booking) {
        // Not found and not-yours look identical on purpose.
        return errorResponse(404, 'booking_not_found', 'Booking not found');
      }

      const baseReturnUrl = getPaymentReturnUrl(deps.env);
      const provider = await deps.getProvider(baseReturnUrl);
      // The secret is the source of truth for which PhonePe environment we are really talking to.
      assertPaymentStartAllowed(provider.environment, identity, deps.env.PHONEPE_SANDBOX_TESTERS);

      let returnUrl: string | undefined;
      if (baseReturnUrl) {
        const url = new URL(baseReturnUrl);
        url.searchParams.set('bookingId', bookingId);
        returnUrl = url.toString();
      }

      const started = await startPayment(db, provider, {
        bookingId,
        environment: provider.environment,
        checkoutHoldMinutes: getCheckoutHoldMinutes(deps.env),
        returnUrl,
        description: booking.product_name,
      });

      if (!isSafeCheckoutRedirect(started.redirectUrl)) {
        console.error('POST /payments/start: provider returned an unexpected redirect host');
        throw new PaymentProviderError('Provider returned an unexpected redirect URL', false);
      }

      return jsonResponse(200, {
        bookingId,
        bookingNumber: booking.booking_number,
        paymentStatus: 'pending',
        redirectUrl: started.redirectUrl,
        expiresAt: started.expiresAt.toISOString(),
      });
    } catch (err) {
      const mapped = mapPaymentError(err);
      if (mapped) {
        // Message only: provider errors are already reduced to status/code by the adapter.
        console.error('POST /payments/start rejected', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
        return mapped;
      }
      deps.resetDb();
      console.error('POST /payments/start failed', err instanceof Error ? err.name : 'unknown');
      return errorResponse(500, 'internal_error', 'Failed to start payment');
    }
  };
}

export const handler = createHandler();
