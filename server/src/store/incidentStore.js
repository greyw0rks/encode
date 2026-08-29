import { nanoid } from 'nanoid';

/**
 * Incident lifecycle: detected -> diagnosing -> fix_drafted -> resolved -> failed
 * Kept in-memory for the hackathon build. Swap for Postgres (the leaderboard doesn't
 * care about your storage layer, only the on-chain settlement trail) once
 * this needs to survive a restart.
 */
const incidents = new Map();

export function createIncident({ summary, repo, logsRef, tier, payer, settlement, attribution }) {
  const id = `inc_${nanoid(10)}`;
  const record = {
    id,
    summary,
    repo,
    logsRef,
    tier, // 'triage' | 'fix'
    status: 'detected',
    payer,
    settlement, // { txHash, amount, asset, network, settledAt }
    attribution: attribution ?? null,
    diagnosis: null,
    repairPlan: null,
    baseCommit: null,
    patch: null,
    pr: null,
    verification: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  incidents.set(id, record);
  return record;
}

export function getIncident(id) {
  return incidents.get(id) || null;
}

export function updateIncident(id, patch) {
  const record = incidents.get(id);
  if (!record) return null;
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  return record;
}

export function listIncidents({ limit = 50 } = {}) {
  return [...incidents.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Dashboard aggregates. `uniqueSigners` is the number the leaderboard actually
 * judges on, so it's counted from settled payments only — a 402'd or failed
 * request never created an incident, but a test-marked payer must not
 * inflate it either.
 */
export function getStats() {
  const all = [...incidents.values()];
  const resolved = all.filter((i) => i.status === 'resolved');
  const failed = all.filter((i) => i.status === 'failed');

  // Test/dry-run markers are deliberately excluded rather than filtered at
  // display time — see AGENTS.md on not producing numbers that could be
  // mistaken for real leaderboard activity.
  const isRealPayment = (i) =>
    i.payer && !/TEST|DRYRUN|LIVERUN/i.test(i.payer) && i.settlement?.txHash;

  const realPayments = all.filter(isRealPayment);
  const uniquePayers = new Set(realPayments.map((i) => i.payer));
  const totalValue = realPayments.reduce((sum, i) => sum + Number(i.settlement?.amount || 0), 0);
  const attributed = realPayments.filter((i) => i.attribution?.attributable);

  return {
    totalJobs: all.length,
    resolved: resolved.length,
    failed: failed.length,
    uniqueSigners: uniquePayers.size,
    totalValueProcessed: totalValue.toFixed(2),
    settledPayments: realPayments.length,
    attributedPayments: attributed.length,
    testPayments: all.filter((i) => i.payer && !isRealPayment(i)).length,
  };
}
