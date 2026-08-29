/**
 * Payment client harness.
 *
 * Proves the client produces a signature the *real* facilitator accepts as
 * well-formed and correctly signed — without moving money, and without
 * needing a funded wallet.
 *
 * The trick that makes this safe: sign with a random throwaway key that
 * holds nothing. A valid signature over an unfunded authorization gets
 * rejected by /verify with `insufficient_funds`. That rejection is the
 * proof — it means the facilitator recovered the signer, matched the
 * EIP-712 domain, and got all the way to the balance check. Any signing
 * bug instead yields `invalid_signature` or `invalid_format`, which is
 * exactly the failure this harness exists to catch.
 *
 *   node scripts/payClientHarness.js
 */
import '../src/config/env.js';
import { Wallet, verifyTypedData, TypedDataEncoder } from 'ethers';
import { signPaymentHeader, selectRequirement } from '../src/client/x402Client.js';
import { buildPaymentRequirements, verifyPayment, assetDomain, assetAddress } from '../src/celo/facilitator.js';

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const PAY_TO = '0x1111111111111111111111111111111111111111';

function requirementFor(asset = 'USDC', amountUsd = '8.00') {
  return buildPaymentRequirements({
    amountUsd,
    asset,
    payTo: PAY_TO,
    resource: 'https://encode.test/v1/incidents',
    description: 'client harness — signed by an empty wallet',
  });
}

async function main() {
  console.log('Encode payment-client harness — real signatures, empty wallet, no value moved.\n');

  // A key that exists only for this process. It holds nothing on any chain,
  // so no signature it produces can move funds.
  const payer = Wallet.createRandom();
  console.log(`Throwaway signer: ${payer.address} (holds nothing)\n`);

  console.log('[1] Signature is locally valid and recovers to the payer');
  const requirement = requirementFor();
  const { header, payload, digest } = await signPaymentHeader({ requirement, signer: payer });

  const { authorization, signature } = payload.payload;
  const domain = assetDomain('USDC');
  const recovered = verifyTypedData(domain, TYPES, authorization, signature);

  check('recovers to the signing wallet', recovered.toLowerCase() === payer.address.toLowerCase(), recovered);
  check('authorization.from is the payer', authorization.from.toLowerCase() === payer.address.toLowerCase());
  check('authorization.to is the quoted payTo', authorization.to.toLowerCase() === PAY_TO.toLowerCase());
  check('value is base units, not dollars', authorization.value === '8000000', authorization.value);
  check('nonce is 32 bytes', /^0x[0-9a-f]{64}$/i.test(authorization.nonce));
  check('validBefore is in the future', Number(authorization.validBefore) > Math.floor(Date.now() / 1000));
  check('validAfter is already past (clock-skew tolerant)', Number(authorization.validAfter) <= Math.floor(Date.now() / 1000));
  check('reported digest matches a fresh hash', digest === TypedDataEncoder.hash(domain, TYPES, authorization));

  console.log('\n[2] Header encodes the x402 exact-scheme envelope');
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  check('base64 decodes to JSON', typeof decoded === 'object');
  check('scheme is exact', decoded.scheme === 'exact', decoded.scheme);
  check('network matches the requirement', decoded.network === requirement.network, decoded.network);
  check('x402Version is 1', decoded.x402Version === 1);

  console.log('\n[3] Each asset signs against its own EIP-712 domain');
  // USDT's domain version is "1" while USDC's is "2", and USDT has no
  // version() getter to discover it from. Signing USDT with USDC's domain
  // is the exact bug this asserts against.
  const usdtRequirement = requirementFor('USDT', '8.00');
  const usdt = await signPaymentHeader({ requirement: usdtRequirement, signer: payer });
  const usdtDomain = assetDomain('USDT');
  check('USDC domain version is 2', assetDomain('USDC').version === '2');
  check('USDT domain version is 1 (not 2)', usdtDomain.version === '1', usdtDomain.version);
  check('USDT domain name is "Tether USD"', usdtDomain.name === 'Tether USD');
  check(
    'USDT signature recovers under the USDT domain',
    verifyTypedData(usdtDomain, TYPES, usdt.payload.payload.authorization, usdt.payload.payload.signature).toLowerCase() ===
      payer.address.toLowerCase()
  );
  check(
    'USDT signature does NOT recover under the USDC domain',
    verifyTypedData(domain, TYPES, usdt.payload.payload.authorization, usdt.payload.payload.signature).toLowerCase() !==
      payer.address.toLowerCase()
  );

  console.log('\n[4] Requirement selection refuses what it cannot sign');
  check(
    'picks the exact-scheme USDC option',
    selectRequirement([{ scheme: 'exact', network: 'celo', asset: assetAddress('USDC'), payTo: PAY_TO }])?.asset ===
      assetAddress('USDC')
  );
  check(
    'refuses an unknown asset rather than guessing its domain',
    selectRequirement([
      { scheme: 'exact', network: 'celo', asset: '0x000000000000000000000000000000000000dEaD', payTo: PAY_TO },
    ]) === null
  );
  check(
    'refuses a non-exact scheme',
    selectRequirement([{ scheme: 'upto', network: 'celo', asset: assetAddress('USDC'), payTo: PAY_TO }]) === null
  );
  check('refuses an empty accepts list', selectRequirement([]) === null);
  const refusedUnknownAsset = await signPaymentHeader({
    requirement: { ...requirement, asset: '0x000000000000000000000000000000000000dEaD' },
    signer: payer,
  })
    .then(() => false)
    .catch((err) => err.message.includes('Refusing to guess'));
  check('signing refuses an asset with no known domain', refusedUnknownAsset);

  console.log('\n[5] Live /verify — the facilitator accepts the signature and rejects only the funding');
  const result = await verifyPayment({ header, paymentRequirements: requirement });
  check('verify returns invalid (the wallet is empty, as intended)', result.valid === false);
  check(
    'rejected on funds, NOT on signature or format',
    result.reason === 'insufficient_funds',
    `reason: ${result.reason}${result.detail ? ` / ${result.detail}` : ''}`
  );
  if (result.reason === 'invalid_signature' || result.reason === 'invalid_exact_evm_payload_signature') {
    console.log('     ↳ The facilitator could not recover the signer. The EIP-712 domain or struct is wrong.');
  }
  if (result.reason === 'invalid_format') {
    console.log('     ↳ The envelope shape is wrong — compare against facilitator.js.');
  }

  console.log(
    failures === 0
      ? '\n✅ The client produces signatures the live facilitator accepts. No funds were moved.'
      : `\n❌ ${failures} check(s) failed.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness failed:', err);
  process.exit(1);
});
