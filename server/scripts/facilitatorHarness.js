/**
 * Facilitator harness — hits the REAL Celo x402 facilitator.
 *
 * No money moves: /verify is an off-chain check, and /settle is only probed
 * for its auth behaviour (401 without a key), never with a real signed
 * authorization. Nothing here can produce a settlement, so nothing here can
 * pollute the hackathon leaderboard.
 *
 * The point is to catch the class of bug that a mock can't: Encode's
 * assumptions about the facilitator's actual request/response shape. Every
 * assertion below was derived by probing the live API, so if this harness
 * starts failing, the API changed and facilitator.js is now wrong.
 *
 *   node scripts/facilitatorHarness.js
 */
import '../src/config/env.js';
import {
  facilitatorUrl,
  facilitatorStatus,
  buildPaymentRequirements,
  toBaseUnits,
  assetAddress,
  decodePaymentHeader,
  verifyPayment,
  settlePayment,
  ASSETS,
} from '../src/celo/facilitator.js';

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

/**
 * A structurally complete but economically worthless payload: correct
 * shape, real asset, a signature that is not real, and a `from` address
 * with no balance. The facilitator should get far enough to reject it on
 * funds/signature — which proves the shape is right.
 */
function fakePaymentHeader({ payTo, amountUsd }) {
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'celo',
    payload: {
      signature: `0x${'00'.repeat(65)}`,
      authorization: {
        from: '0x000000000000000000000000000000000000dEaD',
        to: payTo,
        value: toBaseUnits(amountUsd),
        validAfter: '0',
        validBefore: `${Math.floor(Date.now() / 1000) + 3600}`,
        nonce: `0x${'11'.repeat(32)}`,
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

async function main() {
  console.log(`Encode facilitator harness → ${facilitatorUrl()}`);
  console.log('No settlement is attempted with a real authorization. Nothing here moves value.\n');

  console.log('[1] Unit conversions and asset resolution (no network)');
  check('$8.00 → 8000000 base units', toBaseUnits('8.00') === '8000000', toBaseUnits('8.00'));
  check('$1.50 → 1500000', toBaseUnits('1.50') === '1500000', toBaseUnits('1.50'));
  check('$0.01 → 10000', toBaseUnits('0.01') === '10000', toBaseUnits('0.01'));
  check('integer "3" → 3000000', toBaseUnits('3') === '3000000', toBaseUnits('3'));
  check('over-precise 1.2345678 truncates to 6dp', toBaseUnits('1.2345678') === '1234567', toBaseUnits('1.2345678'));
  check('USDC address resolves', assetAddress('USDC') === ASSETS.mainnet.USDC || assetAddress('USDC') === ASSETS.testnet.USDC);
  check(
    'unknown asset throws rather than returning undefined',
    (() => {
      try {
        assetAddress('DOGE');
        return false;
      } catch {
        return true;
      }
    })()
  );

  console.log('\n[2] Payment header decoding');
  const header = fakePaymentHeader({ payTo: '0x1111111111111111111111111111111111111111', amountUsd: '8.00' });
  const decoded = decodePaymentHeader(header);
  check('base64 JSON decodes', decoded.ok === true);
  check('authorization.from survives the round trip', decoded.payload?.payload?.authorization?.from?.endsWith('dEaD'));
  const rawJson = decodePaymentHeader(JSON.stringify({ x402Version: 1 }));
  check('raw (non-base64) JSON also accepted', rawJson.ok === true);
  check('garbage is rejected, not thrown', decodePaymentHeader('!!!not-valid!!!').ok === false);

  console.log('\n[3] Live facilitator reachability');
  const status = await facilitatorStatus();
  check('GET /health responds ok', status.health?.status === 'ok', JSON.stringify(status.health).slice(0, 120));
  check('GET /supported lists the exact scheme', JSON.stringify(status.supported?.kinds || []).includes('"exact"'));
  check(
    'supported includes a celo network',
    JSON.stringify(status.supported?.kinds || []).includes('celo') ||
      JSON.stringify(status.supported?.kinds || []).includes('eip155:42220')
  );

  console.log('\n[4] Live POST /verify — shape is correct, payment is not');
  const requirements = buildPaymentRequirements({
    amountUsd: '8.00',
    asset: 'USDC',
    payTo: '0x1111111111111111111111111111111111111111',
    resource: 'https://encode.test/v1/incidents',
    description: 'harness probe — not a real request',
  });
  check('requirements carry base-unit amount', requirements.maxAmountRequired === '8000000', requirements.maxAmountRequired);
  check('requirements carry a contract address as asset', requirements.asset?.startsWith('0x'));

  const result = await verifyPayment({ header, paymentRequirements: requirements });
  check('verify returns invalid (as it must — the signature is fake)', result.valid === false);
  check(
    'rejection is on economics/signature, NOT invalid_format',
    result.reason !== 'invalid_format',
    `reason: ${result.reason}${result.detail ? ` / ${result.detail}` : ''}`
  );
  if (result.reason === 'invalid_format') {
    console.log('     ↳ invalid_format means Encode is building the wrong request shape — fix facilitator.js.');
  }

  console.log('\n[5] POST /settle auth behaviour');
  if (process.env.X402_API_KEY) {
    console.log('  ⏭  X402_API_KEY is set — skipping the unauthorized probe so no real settlement is attempted.');
  } else {
    const settled = await settlePayment({ header, paymentRequirements: requirements });
    check('settle refuses without an API key', settled.settled === false);
    check('reason names the missing key', settled.reason === 'missing_x402_api_key', settled.reason);
    console.log('     ↳ Encode short-circuits before calling /settle when no key is present, so no request was sent.');
  }

  console.log(
    failures === 0
      ? '\n✅ Facilitator client matches the live API.'
      : `\n❌ ${failures} check(s) failed — Encode's facilitator assumptions are out of date.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness failed:', err);
  process.exit(1);
});
