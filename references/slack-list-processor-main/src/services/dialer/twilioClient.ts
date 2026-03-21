/**
 * Twilio SDK Client Wrapper
 * Initializes Twilio REST client and provides AccessToken generation
 * for browser-based WebRTC calling via the Twilio Voice SDK.
 */

import twilio from 'twilio';

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_TWIML_APP_SID,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn('[TwilioClient] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
}

/** Twilio REST client for calls, conferences, recordings APIs. */
export const twilioRestClient = twilio(TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!);

/** Token TTL: 1 hour (3600 seconds). */
const TOKEN_TTL = 3600;

/**
 * Generate a Twilio AccessToken with VoiceGrant for a BDR.
 * The token allows the browser's Twilio Device to make outbound calls
 * via the configured TwiML App.
 *
 * @param identity - Unique BDR identifier (e.g., BDR UUID)
 * @returns AccessToken JWT string and the identity used
 */
export function generateAccessToken(identity: string): { token: string; identity: string } {
  if (!TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_TWIML_APP_SID) {
    throw new Error('Missing Twilio API Key, Secret, or TwiML App SID for token generation');
  }

  const token = new AccessToken(
    TWILIO_ACCOUNT_SID!,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
    { identity, ttl: TOKEN_TTL }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: false,
  });

  token.addGrant(voiceGrant);

  return {
    token: token.toJwt(),
    identity,
  };
}

/**
 * Validate a Twilio webhook request signature.
 * Used in webhook middleware to verify requests actually came from Twilio.
 *
 * @param signature - X-Twilio-Signature header value
 * @param url - Full request URL
 * @param params - Request body parameters
 * @returns true if signature is valid
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(TWILIO_AUTH_TOKEN!, signature, url, params);
}

// --- Circuit Breaker (T112) ---

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000; // 60 seconds

/**
 * Simple circuit breaker for Twilio API calls.
 * CLOSED  -> normal operation; failures increment counter
 * OPEN    -> all calls rejected until cooldown expires
 * HALF_OPEN -> single test call; success resets, failure reopens
 */
class TwilioCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureAt = 0;

  /** Check if the circuit allows a request. Throws if OPEN. */
  checkCircuit(): void {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureAt >= COOLDOWN_MS) {
        this.state = 'HALF_OPEN';
        return; // allow one test call
      }
      throw new Error('Twilio circuit breaker OPEN — calls temporarily blocked');
    }
  }

  /** Record a successful Twilio call. Resets the breaker. */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  /** Record a failed Twilio call. May trip the breaker. */
  recordFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    if (this.failures >= FAILURE_THRESHOLD || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }

  /** Get current circuit state for monitoring. */
  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

export const twilioCircuitBreaker = new TwilioCircuitBreaker();

/**
 * Wrap a Twilio API call with the circuit breaker.
 * @param fn - async function that makes the Twilio API call
 * @returns the result of fn
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  twilioCircuitBreaker.checkCircuit();
  try {
    const result = await fn();
    twilioCircuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    twilioCircuitBreaker.recordFailure();
    throw error;
  }
}
