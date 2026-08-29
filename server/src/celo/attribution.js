import { facilitatorStatus } from './facilitator.js';

/**
 * ERC-8021 attribution
 * --------------------
 * The tag is applied client-side, by whoever signs the payment — Encode
 * can't add it after the fact. This module's job is therefore narrow: know
 * whether Encode is registered at all, and expose the tag so it can be
 * published in the 402 quote for clients to include.
 *
 * A settlement without the tag still moves real value; it just doesn't
 * appear on the hackathon leaderboard. That's worth a loud warning and an
 * honest field on the incident record — not a silent assumption that it
 * counted.
 */

export function attributionTag() {
  return process.env.ERC8021_AT
    || process.env.ERC8021_ATTRIBUTION_TAG
    || null;
}

export function isRegistered() {
  return Boolean(attributionTag() && process.env.ERC8004_AGENT_ID);
}

/**
 * Recorded against each incident so the dashboard can report attributed vs
 * unattributed volume separately, rather than claiming credit for both.
 */
export function attributionRecord(txHash) {
  const tag = attributionTag();
  if (!tag) {
    return { tag: null, attributed: false, reason: 'encode_not_registered' };
  }
  if (!txHash) {
    return { tag, attributed: false, reason: 'no_tx_hash' };
  }
  // Whether the tag actually rode along on-chain depends on the client's
  // signing integration. Encode reports what it knows and doesn't guess.
  return { tag, attributed: null, reason: 'client_side_tag_unconfirmed', txHash };
}

/** Startup diagnostic — surfaces the two ways this quietly goes wrong. */
export async function attributionStatus() {
  return {
    agentId: process.env.ERC8004_AGENT_ID || null,
    attributionTag: attributionTag(),
    registered: isRegistered(),
    settlementKeyPresent: Boolean(process.env.X402_API_KEY),
    facilitator: await facilitatorStatus(),
  };
}
