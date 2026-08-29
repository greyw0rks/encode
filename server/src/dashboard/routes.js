import { Router } from 'express';
import { listIncidents, getStats } from '../store/incidentStore.js';
import { attributionStatus } from '../celo/attribution.js';
import { providerSummary } from '../llm/provider.js';
import { paymentConfig } from '../celo/paymentConfig.js';

const router = Router();

/**
 * GET /v1/dashboard
 * Backs the landing page's ledger section. uniqueSigners is surfaced at
 * the same weight as totalValueProcessed on purpose — Track 1 is judged
 * on distinct signers, not raw volume, so this number needs to be
 * impossible to miss, not buried under a bigger dollar figure.
 */
router.get('/v1/dashboard', (req, res) => {
  const stats = getStats();
  const recent = listIncidents({ limit: 20 }).map((i) => ({
    id: i.id,
    summary: i.summary,
    status: i.status,
    tier: i.tier,
    payer: i.payer,
    amount: i.settlement?.amount,
    txHash: i.settlement?.txHash,
    attributed: Boolean(i.attribution?.tag),
    verificationDepth: i.verification?.verificationDepth ?? null,
    prUrl: i.pr?.url ?? null,
    createdAt: i.createdAt,
  }));

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

  const blockers = [];
  if (!payment.ready) blockers.push(`payment config incomplete: ${payment.missing.join(', ')}`);
  if (!attribution.settlementKeyPresent) blockers.push('X402_API_KEY unset — POST /settle will 401, no payment can complete');
  if (!attribution.registered) blockers.push('not registered at celobuilders.xyz — settlements will not count on the leaderboard');

  res.json({
    service: 'encode-api',
    llm: providerSummary(),
    payment: { ready: payment.ready, missing: payment.missing, payTo: payment.payTo, network: payment.network },
    attribution,
    canTakeRealPayments: blockers.length === 0,
    blockers,
  });
});

export default router;
