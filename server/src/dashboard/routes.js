import { Router } from 'express';
import { listIncidents, getStats, storeInfo } from '../store/incidentStore.js';
import { attributionStatus } from '../celo/attribution.js';
import { providerSummary } from '../llm/provider.js';
import { paymentConfig } from '../celo/paymentConfig.js';
import { ledgerRow } from '../routes/publicView.js';

const router = Router();

/**
 * GET /v1/dashboard
 * Backs the landing page's ledger section. uniqueSigners is surfaced at
 * the same weight as totalValueProcessed on purpose — every track is judged
 * on distinct signers, not raw volume, so this number needs to be
 * impossible to miss, not buried under a bigger dollar figure.
 *
 * Rows are settlement facts only. A stranger browsing this has no claim on
 * another payer's diagnosis or repair plan — see routes/publicView.js.
 */
router.get('/v1/dashboard', (req, res) => {
  const stats = getStats();
  const recent = listIncidents({ limit: 20 }).map(ledgerRow);

  res.json({ stats, recent });
});

/**
 * GET /v1/status
 * Operational truth, not marketing: which LLM path is live, whether the
 * facilitator is reachable, and — the two things that silently break a
 * submission — whether Encode is registered for attribution and whether it
 * holds a settlement API key. Both can be missing while every other
 * endpoint looks healthy.
 */
router.get('/v1/status', async (req, res) => {
  const payment = paymentConfig();
  const attribution = await attributionStatus();
  const store = storeInfo();
  const stats = getStats();

  const blockers = [];
  if (!payment.ready) blockers.push(`payment config incomplete: ${payment.missing.join(', ')}`);
  if (!attribution.settlementKeyPresent) blockers.push('X402_API_KEY unset — POST /settle will 401, no payment can complete');
  if (!attribution.agentWallet) {
    blockers.push('ENCODE_WALLET_ADDRESS unset — x402 settlements are attributed by agent wallet, so nothing would be credited');
  }
  if (!attribution.agentId) blockers.push('no ERC-8004 agent identity — required to register at celobuilders.xyz');
  if (!attribution.attributionTag) {
    blockers.push('not registered at celobuilders.xyz — no attribution tag, so settlements will not count on the leaderboard');
  }
  // Warnings, not blockers: Encode can still take a payment. Taking money
  // with no durable record of it is a different kind of wrong from not being
  // able to take it at all, and collapsing the two would make
  // canTakeRealPayments answer a question nobody asked.
  const warnings = [];
  if (!store.durable) warnings.push('incident store is in-memory — a restart would erase the record that a payer paid');
  if (stats.unfulfilledPaid > 0) {
    warnings.push(`${stats.unfulfilledPaid} paid incident(s) were never delivered — see GET /v1/dashboard`);
  }

  res.json({
    service: 'encode-api',
    llm: providerSummary(),
    payment: { ready: payment.ready, missing: payment.missing, payTo: payment.payTo, network: payment.network },
    attribution,
    // The path itself is server-side detail (see routes/publicView.js); what
    // a caller has a claim on is whether their payment would be recorded.
    store: { durable: store.durable, note: store.note },
    canTakeRealPayments: blockers.length === 0,
    blockers,
    warnings,
  });
});

export default router;
