/**
 * x402 payment client for Encode
 * ------------------------------
 * The missing half of the payment path. Encode's server can quote, verify
 * and settle — but until this existed, a payer had no practical way to
 * produce the `X-PAYMENT` header those steps consume, so nobody could pay
 * Encode at all.
 *
 * What a payer signs is an EIP-3009 `TransferWithAuthorization`: an
 * off-chain authorization letting a specific recipient pull a specific
 * amount, once, within a time window. Signing costs no gas and moves
 * nothing. The transfer only happens when the x402 facilitator submits the
 * authorization on-chain, and the facilitator pays that gas.
 *
 * Deliberately dependency-light: one import (`ethers`), no framework, no
 * Encode server code. A payer should be able to copy this file into their
 * own project — or read it in two minutes and decide it's safe to sign
 * with. It works against any x402 `exact`-scheme endpoint, not just Encode.
 *
 * Usage:
 *
 *   import { Wallet } from 'ethers';
 *   import { payAndRequest } from './x402Client.js';
 *
 *   const result = await payAndRequest({
 *     url: 'https://encode-production.up.railway.app/v1/incidents',
 *     body: { summary: '...', repo: { owner: 'me', name: 'my-app' }, tier: 'fix' },
 *     signer: new Wallet(process.env.PRIVATE_KEY),
 *   });
 *
 * See scripts/payDemo.js for a runnable end-to-end example.
 */

import { getAddress, hexlify, randomBytes, TypedDataEncoder } from 'ethers';

/** EIP-3009. The struct a payer signs — not a transaction. */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * EIP-712 domains for Celo's EIP-3009 stablecoins, keyed by lowercased
 * contract address. Each was verified by computing hashDomain() and
 * comparing against the token's own DOMAIN_SEPARATOR() on-chain.
 *
 * USDT is why this table exists rather than a runtime lookup: it exposes no
 * `version()` getter, so a client that discovers the domain dynamically
 * either fails or guesses "2" (USDC's value) and produces a signature the
 * token rejects. Its actual version is "1".
 */
const KNOWN_DOMAINS = {
  // Celo mainnet
  '0xceba9300f2b948710d2653dd7b07f33a8b32118c': { name: 'USDC', version: '2' },
  '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e': { name: 'Tether USD', version: '1' },
  // Celo Sepolia
  '0x01c5c0122039549ad1493b8220cabedd739bc44e': { name: 'USDC', version: '2' },
};

const CHAIN_IDS = { celo: 42220, 'celo-sepolia': 11142220 };

/** Accepts CAIP-2 (`eip155:42220`) or the x402 v1 short name (`celo`). */
function resolveChainId(network) {
  if (typeof network === 'number') return network;
  const caip2 = /^eip155:(\d+)$/.exec(network ?? '');
  if (caip2) return Number(caip2[1]);
  const known = CHAIN_IDS[network];
  if (!known) throw new Error(`x402: unrecognised network "${network}"`);
  return known;
}

/**
 * A 402 response can offer several payment options. Pick one we can
 * actually sign for: `exact` scheme, on a chain we know, in a token whose
 * EIP-712 domain we have. Returning null rather than throwing lets the
 * caller report *why* nothing matched.
 */
export function selectRequirement(accepts, { asset, network } = {}) {
  const options = Array.isArray(accepts) ? accepts : [];

  return (
    options.find((option) => {
      if (option.scheme !== 'exact') return false;
      if (!KNOWN_DOMAINS[option.asset?.toLowerCase()]) return false;
      if (asset && option.asset?.toLowerCase() !== asset.toLowerCase()) return false;
      if (network && option.network !== network) return false;
      try {
        resolveChainId(option.network);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * Signs an EIP-3009 authorization and encodes it as an `X-PAYMENT` header.
 *
 * Gas-free and non-custodial: this produces a signature, not a transaction.
 * The authorization is single-use (`nonce` is random, and EIP-3009 records
 * spent nonces on-chain) and expires at `validBefore`, so an unsubmitted
 * one becomes worthless rather than lingering.
 *
 * @param {object} requirement One entry from the 402 response's `accepts[]`.
 * @param {import('ethers').Signer} signer Must support signTypedData.
 * @param {number} [validForSeconds] Authorization lifetime. Default 10 min.
 */
export async function signPaymentHeader({ requirement, signer, validForSeconds = 600 }) {
  const { asset, payTo, maxAmountRequired, network } = requirement;

  if (!asset || !payTo || !maxAmountRequired) {
    throw new Error('x402: requirement is missing asset, payTo, or maxAmountRequired');
  }

  const knownDomain = KNOWN_DOMAINS[asset.toLowerCase()];
  if (!knownDomain) {
    // Signing against a guessed domain yields a signature that verifies
    // against nothing — fail loudly instead.
    throw new Error(`x402: no known EIP-712 domain for asset ${asset}. Refusing to guess.`);
  }

  const from = await signer.getAddress();
  const now = Math.floor(Date.now() / 1000);

  const authorization = {
    from: getAddress(from),
    to: getAddress(payTo),
    // Base units, not dollars. The server quotes them this way for exactly
    // this reason: no float rounding between quote and signature.
    value: String(maxAmountRequired),
    // 60s of backdating absorbs clock skew between payer and chain.
    validAfter: String(now - 60),
    validBefore: String(now + validForSeconds),
    nonce: hexlify(randomBytes(32)),
  };

  const domain = {
    ...knownDomain,
    chainId: resolveChainId(network),
    verifyingContract: getAddress(asset),
  };

  const signature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);

  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: { signature, authorization },
  };

  return {
    header: Buffer.from(JSON.stringify(payload)).toString('base64'),
    payload,
    // The struct hash the signature commits to — lets a caller verify
    // locally, or debug a rejection, without re-deriving it.
    digest: TypedDataEncoder.hash(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization),
  };
}

/** Requests a 402 quote without paying. Useful for showing a price first. */
export async function fetchQuote({ url, body, method = 'POST', headers = {} }) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status !== 402) {
    return { paymentRequired: false, status: res.status, body: await res.json().catch(() => null) };
  }

  const quote = await res.json();
  return { paymentRequired: true, status: 402, quote, accepts: quote.accepts ?? [] };
}

/**
 * The whole flow: request → 402 → sign → retry with X-PAYMENT.
 *
 * Two deliberate refusals, because both are ways a payer loses money by
 * accident:
 *   - `maxAmountUsd` caps what will be signed. Without it a compromised or
 *     buggy server could quote any amount and this would sign it.
 *   - A second 402 after paying is NOT retried. Retrying would sign a
 *     second authorization for the same work.
 */
export async function payAndRequest({
  url,
  body,
  signer,
  method = 'POST',
  headers = {},
  maxAmountUsd = null,
  asset,
  network,
  validForSeconds = 600,
  onQuote = () => {},
}) {
  const first = await fetchQuote({ url, body, method, headers });
  if (!first.paymentRequired) return { paid: false, ...first };

  const requirement = selectRequirement(first.accepts, { asset, network });
  if (!requirement) {
    throw new Error(
      `x402: no payable option in the 402 response. Offered: ${JSON.stringify(first.accepts)}`
    );
  }

  const quotedUsd = first.quote?.quote?.usd ?? null;
  onQuote({ requirement, quote: first.quote, usd: quotedUsd });

  if (maxAmountUsd !== null) {
    if (quotedUsd === null) {
      throw new Error('x402: server did not state a USD amount, and maxAmountUsd was set. Refusing to sign.');
    }
    if (Number(quotedUsd) > Number(maxAmountUsd)) {
      throw new Error(`x402: quoted $${quotedUsd} exceeds your maxAmountUsd of $${maxAmountUsd}. Not signing.`);
    }
  }

  const { header, payload, digest } = await signPaymentHeader({ requirement, signer, validForSeconds });

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT': header, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseBody = await res.json().catch(() => null);

  if (res.status === 402) {
    // Paid request still refused. Do not sign again — surface it.
    throw new Error(
      `x402: payment rejected (${responseBody?.reason ?? 'no reason given'}${
        responseBody?.fault ? `, fault: ${responseBody.fault}` : ''
      })`
    );
  }

  return {
    paid: true,
    status: res.status,
    body: responseBody,
    settlement: { authorization: payload.payload.authorization, digest },
  };
}
