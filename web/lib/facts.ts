/**
 * Facts about Encode that appear on more than one page, kept in one place so a
 * change to the payout address or agent id can't leave a stale copy behind.
 *
 * Everything here is checkable. If a value can't be linked to a transaction,
 * a registry entry, or a file in the repo, it doesn't belong in this file.
 */

export const REPO_URL = 'https://github.com/greyw0rks/encode';

export const AGENT = {
  /** ERC-8004 identity, minted on Celo mainnet. */
  id: '9794',
  registryUrl: 'https://www.8004scan.io/agents/celo/9794',
  /** Receives settlements, and is the wallet x402 payments are attributed by. */
  payTo: '0xc61Bbc0CF5694EF410A578A9833f77C173790450',
  registrationFileUrl: `${REPO_URL}/blob/main/agent-registration.json`,
} as const;

export const FACILITATOR_HEALTH_URL = 'https://api.x402.celo.org/health';

/**
 * USDC on Celo mainnet, 6 decimals — so `$0.50` is `500000` base units. Kept
 * EIP-55 checksummed: ethers rejects a mis-cased address outright.
 */
export const USDC = {
  address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  decimals: 6,
  /** EIP-712 domain version. USDC is `2`; USDT is `1`. Never guess this. */
  eip712Version: '2',
} as const;

export const CELO_CHAIN_ID = 42220;

export const TIERS = [
  {
    id: 'triage',
    label: 'Triage',
    price: '$0.20',
    baseUnits: '200000',
    blurb: 'A cause and a repro command. Nothing is written to your repo.',
  },
  {
    id: 'fix',
    label: 'Fix & PR',
    price: '$0.50',
    baseUnits: '500000',
    blurb: 'Triage, plus a patch with your tests run against it, plus an opened PR.',
  },
] as const;

export const PROOF = {
  testbedRepo: 'https://github.com/greyw0rks/encore-testbed',
  firstPr: 'https://github.com/greyw0rks/encore-testbed/pull/1',
  clientSource: `${REPO_URL}/blob/main/server/src/client/x402Client.js`,
  payingDoc: `${REPO_URL}/blob/main/PAYING.md`,
  bashPolicySource: `${REPO_URL}/blob/main/server/src/agents/bashPolicy.js`,
} as const;
