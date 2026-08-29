import { facilitatorStatus } from './facilitator.js';

/**
 * Attribution
 * -----------
 * How hackathon credit actually works here, established from
 * celobuilders.xyz's own API rather than assumed:
 *
 * x402 settlements are submitted on-chain by the *facilitator's relayer*,
 * not by Encode and not by the payer. Neither party controls that
 * transaction's calldata, so **the ERC-8021 tag cannot ride along on an
 * x402 settlement at all.** Those settlements are attributed by the
 * registered agent wallet instead — which is why ENCODE_WALLET_ADDRESS
 * being on file at celobuilders is load-bearing, and why every leaderboard
 * reads zero until it is. Attribution is retroactive once the wallet is
 * registered, but invisible before then.
 *
 * The tag still matters for any transaction Encode signs itself, and it's
 * published in the 402 quote so a client signing its own tx can include it.
 * For the payment path Encode actually has, the wallet is the mechanism.
 *
 * Recording that honestly, rather than assuming a settlement counted, is the
 * point — see AGENTS.md on not producing numbers that overstate leaderboard
 * activity.
 */

export function attributionTag() {
  return process.env.ERC8021_ATTRIBUTION_TAG || null;
}

/** The wallet facilitator-relayed settlements are attributed by. */
export function attributionWallet() {
  return process.env.ENCODE_WALLET_ADDRESS || null;
}

/**
 * Registered means celobuilders has the agent identity, the tag, and the
 * payout wallet on file. Missing any one of them means settlements don't
 * show up.
 */
export function isRegistered() {
  return Boolean(attributionTag() && process.env.ERC8004_AGENT_ID && attributionWallet());
}

/**
 * Recorded against each incident so the dashboard can separate "settled and
 * attributable" from "settled but invisible to the leaderboard."
 */
export function attributionRecord(txHash) {
  const tag = attributionTag();
  const wallet = attributionWallet();

  if (!wallet) {
    return { tag, wallet: null, attributable: false, reason: 'no_agent_wallet_on_file', txHash: txHash ?? null };
  }
  if (!tag) {
    return { tag: null, wallet, attributable: false, reason: 'encode_not_registered', txHash: txHash ?? null };
  }
  if (!txHash) {
    return { tag, wallet, attributable: false, reason: 'no_tx_hash' };
  }

  // Attributable by wallet — the mechanism for facilitator-relayed
  // settlements. Not a claim that the leaderboard has counted it.
  return { tag, wallet, attributable: true, mechanism: 'agent_wallet', txHash };
}

/** Startup and /v1/status diagnostic — surfaces each way this goes quiet. */
export async function attributionStatus() {
  return {
    agentId: process.env.ERC8004_AGENT_ID || null,
    agentUri: process.env.ERC8004_AGENT_URI || null,
    attributionTag: attributionTag(),
    agentWallet: attributionWallet(),
    registered: isRegistered(),
    settlementKeyPresent: Boolean(process.env.X402_API_KEY),
    facilitator: await facilitatorStatus(),
  };
}
