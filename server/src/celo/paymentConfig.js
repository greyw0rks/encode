/**
 * Payment configuration
 * ---------------------
 * A 402 response is a promise: pay this amount, to this address, via this
 * facilitator. If any of those are missing, the correct behaviour is to
 * refuse the request loudly — not to serve a quote a client can't act on,
 * or worse, one that resolves to `undefined` and looks free.
 *
 * X402_API_KEY is required too, and for a less obvious reason: without it
 * POST /settle returns 401, so a payer would sign a valid authorization
 * that Encode can never submit. Quoting in that state takes a client's
 * signature and gives nothing back.
 */

import { facilitatorUrl, networkEnv } from './facilitator.js';

const REQUIRED = ['ENCODE_WALLET_ADDRESS', 'PRICE_TRIAGE', 'PRICE_FIX', 'X402_API_KEY'];

export function paymentConfig() {
  const missing = REQUIRED.filter((key) => !process.env[key]);

  return {
    payTo: process.env.ENCODE_WALLET_ADDRESS,
    facilitator: facilitatorUrl(),
    network: networkEnv(),
    attributionTag: process.env.ERC8021_ATTRIBUTION_TAG || null,
    prices: { triage: process.env.PRICE_TRIAGE, fix: process.env.PRICE_FIX },
    missing,
    ready: missing.length === 0,
  };
}

/**
 * The attribution tag is deliberately NOT in REQUIRED: Encode can take a
 * real payment without it, it just won't count toward the hackathon
 * leaderboard. That's a warning, not a hard failure — but it should never
 * be a silent one.
 */
export function warnIfUnattributed() {
  if (!process.env.ERC8021_ATTRIBUTION_TAG) {
    console.warn(
      '[x402] ERC8021_ATTRIBUTION_TAG is unset — this settlement will not be attributed to Encode.'
    );
  }
}
