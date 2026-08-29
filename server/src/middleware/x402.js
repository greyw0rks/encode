/**
 * x402 middleware
 * ----------------
 * Gates a route behind an on-chain stablecoin payment.
 *
 * Three steps, in order, because the facilitator separates them:
 *   1. No X-PAYMENT header → 402 with the price and payment requirements.
 *   2. Header present → POST /verify (off-chain: signature valid, funds
 *      exist). This moves no money.
 *   3. Verified → POST /settle (on-chain: EIP-3009 transferWithAuthorization
 *      submitted, facilitator pays gas, funds go payer → Encode directly).
 *
 * Step 3 is the one that matters and the one that's easy to skip: /verify
 * returning isValid feels like success, but nothing has been paid. Encode
 * does not proceed to diagnosis on a verified-but-unsettled payment.
 *
 * Header casing: the spec says `X-PAYMENT`; Express lowercases inbound
 * header names, so `x-payment` is what's read. `PAYMENT-SIGNATURE` is
 * accepted as an alias since Celo's own docs use that name.
 */

import {
  verifyPayment,
  settlePayment,
  buildPaymentRequirements,
  toBaseUnits,
  assetAddress,
  assetDomain,
} from '../celo/facilitator.js';
import { paymentConfig, warnIfUnattributed } from '../celo/paymentConfig.js';

/**
 * @param {(req) => { amount: string, asset?: string, tier?: string }} priceFn
 *   Returns the quoted price for this specific request. A function, not a
 *   constant, so /v1/incidents can quote "triage" vs "fix" differently.
 */
export function requirePayment(priceFn) {
  return async function x402Middleware(req, res, next) {
    const config = paymentConfig();

    // Serving a quote Encode can't honour is worse than refusing: a client
    // would sign a payment to `undefined` and lose it.
    if (!config.ready) {
      console.error(`[x402] refusing to quote — missing config: ${config.missing.join(', ')}`);
      return res.status(503).json({
        error: 'payment_not_configured',
        message: 'Encode is not currently able to accept payments.',
        missing: config.missing,
      });
    }

    const { amount, asset = 'USDC', tier } = priceFn(req);
    if (!amount || Number.isNaN(Number(amount))) {
      return res.status(500).json({ error: 'price_unresolved', tier });
    }

    const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const description = tier ? `Encode ${tier} tier` : 'Encode incident';

    let paymentRequirements;
    try {
      paymentRequirements = buildPaymentRequirements({
        amountUsd: amount,
        asset,
        payTo: config.payTo,
        resource,
        description,
      });
    } catch (err) {
      return res.status(500).json({ error: 'requirements_unbuildable', message: err.message });
    }

    const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];

    if (!paymentHeader) {
      return res
        .status(402)
        .set('X-Accept-Payment', 'x402')
        .json({
          x402Version: 1,
          error: 'payment_required',
          accepts: [paymentRequirements],
          facilitator: config.facilitator,
          extra: { attributionTag: config.attributionTag },
          // Human-facing mirror — amounts above are base units (6dp).
          quote: { usd: amount, asset, assetAddress: assetAddress(asset), baseUnits: toBaseUnits(amount) },
          // The EIP-712 domain the payer must sign against. Published
          // because it can't reliably be discovered on-chain: USDT exposes
          // no version() getter, and a client that guesses produces a
          // signature that verifies against nothing.
          eip712: {
            primaryType: 'TransferWithAuthorization',
            domain: assetDomain(asset),
            types: {
              TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
              ],
            },
          },
        });
    }

    let verification;
    try {
      verification = await verifyPayment({ header: paymentHeader, paymentRequirements });
    } catch (err) {
      console.error(`[x402] facilitator unreachable during verify: ${err.message}`);
      return res.status(502).json({ error: 'facilitator_unreachable', message: err.message });
    }

    if (!verification.valid) {
      return res.status(402).json({
        error: 'payment_invalid',
        reason: verification.reason,
        detail: verification.detail,
      });
    }

    warnIfUnattributed();

    // Verified is not paid. Settle before delivering anything.
    let settlement;
    try {
      settlement = await settlePayment({ header: paymentHeader, paymentRequirements });
    } catch (err) {
      console.error(`[x402] facilitator unreachable during settle: ${err.message}`);
      return res.status(502).json({ error: 'facilitator_unreachable', message: err.message });
    }

    if (!settlement.settled) {
      console.error(`[x402] settlement failed: ${settlement.reason}`);
      return res.status(402).json({
        error: 'settlement_failed',
        reason: settlement.reason,
        // Distinguish "your payment is bad" from "Encode's key/credits are
        // the problem" — the payer can't fix the latter.
        fault: ['missing_x402_api_key', 'facilitator_unauthorized', 'facilitator_credits_exhausted'].includes(
          settlement.reason
        )
          ? 'server'
          : 'client',
      });
    }

    const payer = settlement.payerAddress || verification.payerAddress;
    if (!payer) {
      // Without a payer address there's no signer to count and no way to
      // audit independence — the number every track is actually gated on.
      console.error('[x402] settled but no payer address returned');
      return res.status(502).json({ error: 'facilitator_response_incomplete', missing: 'payer' });
    }

    // Paying yourself is a real on-chain settlement and completely worthless
    // as evidence: it moves value between two wallets one party controls.
    // The hackathon rules exclude it by rule rather than judgement, so it is
    // recorded as self-funded and kept out of uniqueSigners — see AGENTS.md
    // on never producing numbers that could be mistaken for real activity.
    const selfFunded = payer.toLowerCase() === config.payTo.toLowerCase();
    if (selfFunded) {
      console.warn(
        `[x402] payer ${payer} is Encode's own payout address — recording this settlement as self-funded. It will not count toward uniqueSigners.`
      );
    }

    req.payer = payer;
    req.settlement = {
      txHash: settlement.txHash,
      amount,
      asset,
      network: settlement.network ?? paymentRequirements.network,
      selfFunded,
      settledAt: new Date().toISOString(),
    };

    next();
  };
}
