/**
 * Celo x402 facilitator client
 * ----------------------------
 * Verified against the live API on 2026-08-29 by probing it directly, not
 * from the docs page (which documents the `@x402/express` middleware, not
 * the wire format). Two corrections to what Encode previously assumed:
 *
 *   1. The API host is `api.x402.celo.org`. `x402.celo.org` is the
 *      dashboard SPA — it returns HTML for /verify and /supported, so a
 *      resource server pointed at it fails in a confusing way.
 *   2. /verify does NOT move money. It's an off-chain signature +
 *      balance/simulation check. Settlement is a separate authenticated
 *      POST /settle that needs an X-API-Key. Encode has to call both, in
 *      that order, or it delivers work for a payment that never landed.
 *
 * Live endpoint inventory (GET https://api.x402.celo.org/):
 *   POST /verify     open
 *   POST /settle     X-API-Key required (401 without, 402 out of credits, 429 rate-limited)
 *   GET  /supported  open
 *   GET  /health     open
 *
 * GET /supported reports: x402Version 1 scheme "exact" network "celo", and
 * x402Version 2 scheme "exact" network "eip155:42220".
 */

const MAINNET_API = 'https://api.x402.celo.org';
const TESTNET_API = 'https://api.x402.sepolia.celo.org';

/**
 * EIP-3009 `transferWithAuthorization` assets, both 6 decimals. Amounts on
 * the wire are base units, not dollars — 1000000 is $1.00.
 *
 * Addresses are EIP-55 checksummed — ethers rejects a mis-cased address with
 * "bad address checksum", so a lowercase copy-paste from a docs page breaks
 * any client that validates.
 *
 * `domain` is the EIP-712 domain a payer must sign against. Every value here
 * was confirmed by computing hashDomain() and comparing it to the token's
 * own DOMAIN_SEPARATOR() on-chain — not read off a docs page. USDT is the
 * reason this is spelled out: it has no `version()` getter, so the version
 * can't be discovered at runtime and a client that assumes "2" (USDC's
 * value) produces a signature the token rejects.
 */
export const ASSETS = {
  mainnet: {
    USDC: {
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      domain: { name: 'USDC', version: '2' },
      decimals: 6,
    },
    USDT: {
      address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
      domain: { name: 'Tether USD', version: '1' },
      decimals: 6,
    },
  },
  testnet: {
    USDC: {
      address: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
      domain: { name: 'USDC', version: '2' },
      decimals: 6,
    },
  },
};

const NETWORK_IDS = {
  mainnet: { v1: 'celo', caip2: 'eip155:42220', chainId: 42220 },
  testnet: { v1: 'celo-sepolia', caip2: 'eip155:11142220', chainId: 11142220 },
};

export function networkEnv() {
  return process.env.CELO_NETWORK_ENV === 'testnet' ? 'testnet' : 'mainnet';
}

export function chainId() {
  return NETWORK_IDS[networkEnv()].chainId;
}

export function facilitatorUrl() {
  if (process.env.X402_FACILITATOR_URL) return process.env.X402_FACILITATOR_URL.replace(/\/$/, '');
  return networkEnv() === 'testnet' ? TESTNET_API : MAINNET_API;
}

function assetConfig(ticker = 'USDC') {
  const config = ASSETS[networkEnv()]?.[ticker.toUpperCase()];
  if (!config) {
    throw new Error(`unsupported_asset: ${ticker} on ${networkEnv()}`);
  }
  return config;
}

/** Asset contract address for a ticker, on the configured network. */
export function assetAddress(ticker = 'USDC') {
  return assetConfig(ticker).address;
}

/**
 * The full EIP-712 domain a payer signs `TransferWithAuthorization` against.
 * Published in the 402 quote so a client doesn't have to guess it — getting
 * this wrong yields a signature that verifies against nothing.
 */
export function assetDomain(ticker = 'USDC') {
  const { address, domain } = assetConfig(ticker);
  return { ...domain, chainId: chainId(), verifyingContract: address };
}

/** USD string ("0.50") → base units string ("500000"). Both assets are 6dp. */
export function toBaseUnits(usd, decimals = 6) {
  const [whole, fraction = ''] = String(usd).split('.');
  const padded = fraction.padEnd(decimals, '0').slice(0, decimals);
  return `${BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')}`;
}

/**
 * The `paymentRequirements` object the facilitator validates a payload
 * against. Field names confirmed by probing /verify — it rejects with
 * `invalid_format` and names the missing field, so this shape is not a
 * guess.
 */
export function buildPaymentRequirements({ amountUsd, asset = 'USDC', payTo, resource, description }) {
  return {
    scheme: 'exact',
    network: NETWORK_IDS[networkEnv()].v1,
    maxAmountRequired: toBaseUnits(amountUsd),
    resource,
    description,
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 60,
    asset: assetAddress(asset),
  };
}

/**
 * The X-PAYMENT header is base64-encoded JSON of the paymentPayload. Shape
 * (v1, exact scheme, EIP-3009), every field confirmed required by probing:
 *
 *   { x402Version, scheme, network, payload: {
 *       signature,
 *       authorization: { from, to, value, validAfter, validBefore, nonce }
 *   }}
 */
export function decodePaymentHeader(header) {
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    return { ok: true, payload: JSON.parse(json) };
  } catch {
    // Some clients send raw JSON rather than base64.
    try {
      return { ok: true, payload: JSON.parse(header) };
    } catch {
      return { ok: false, reason: 'payment_header_undecodable' };
    }
  }
}

async function postJson(path, body, { apiKey } = {}) {
  const res = await fetch(`${facilitatorUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // An HTML body here almost always means X402_FACILITATOR_URL points at
    // the dashboard instead of the API — worth saying so explicitly.
    const hint = text.trimStart().startsWith('<')
      ? ' (got HTML — is X402_FACILITATOR_URL pointed at the dashboard instead of api.x402.celo.org?)'
      : '';
    throw new Error(`facilitator_non_json_response: ${res.status}${hint}`);
  }
  return { status: res.status, data };
}

/**
 * Off-chain check: is this signed authorization valid, and can it actually
 * be settled? Does NOT move money — see settlePayment.
 *
 * Response shape (live): { isValid, invalidReason, invalidReasonDetails, payer }
 */
export async function verifyPayment({ header, paymentRequirements }) {
  const decoded = decodePaymentHeader(header);
  if (!decoded.ok) return { valid: false, reason: decoded.reason };

  const { status, data } = await postJson('/verify', {
    x402Version: decoded.payload.x402Version ?? 1,
    paymentPayload: decoded.payload,
    paymentRequirements,
  });

  if (!data.isValid) {
    return {
      valid: false,
      reason: data.invalidReason || `facilitator_${status}`,
      detail: data.invalidReasonDetails,
      payerAddress: data.payer || null,
    };
  }

  return {
    valid: true,
    payerAddress: data.payer || decoded.payload?.payload?.authorization?.from || null,
    payload: decoded.payload,
  };
}

/**
 * Submits the authorization on-chain. This is the step that actually moves
 * value, so it's the step that counts for the hackathon — and the only one that
 * needs X402_API_KEY. Without a key the facilitator returns 401, which is
 * why an integration can look healthy until its first real settlement.
 */
export async function settlePayment({ header, paymentRequirements }) {
  const apiKey = process.env.X402_API_KEY;
  if (!apiKey) {
    return { settled: false, reason: 'missing_x402_api_key' };
  }

  const decoded = decodePaymentHeader(header);
  if (!decoded.ok) return { settled: false, reason: decoded.reason };

  const { status, data } = await postJson(
    '/settle',
    {
      x402Version: decoded.payload.x402Version ?? 1,
      paymentPayload: decoded.payload,
      paymentRequirements,
    },
    { apiKey }
  );

  if (status === 401) return { settled: false, reason: 'facilitator_unauthorized' };
  if (status === 402) return { settled: false, reason: 'facilitator_credits_exhausted' };
  if (status === 429) return { settled: false, reason: 'facilitator_rate_limited' };

  // x402 settle response: { success, transaction, network, payer, errorReason? }
  if (data.success === false || (!data.transaction && !data.txHash)) {
    return { settled: false, reason: data.errorReason || `facilitator_${status}`, raw: data };
  }

  return {
    settled: true,
    txHash: data.transaction || data.txHash,
    payerAddress: data.payer || decoded.payload?.payload?.authorization?.from || null,
    network: data.network,
    raw: data,
  };
}

/** Liveness + which (network, scheme) pairs the facilitator will accept. */
export async function facilitatorStatus() {
  const [health, supported] = await Promise.all([
    fetch(`${facilitatorUrl()}/health`).then((r) => r.json()).catch((e) => ({ error: e.message })),
    fetch(`${facilitatorUrl()}/supported`).then((r) => r.json()).catch((e) => ({ error: e.message })),
  ]);
  return { url: facilitatorUrl(), network: networkEnv(), health, supported };
}
