import { Router } from 'express';
import { requirePayment } from '../middleware/x402.js';
import { identifyAgent } from '../middleware/auth.js';
import { createIncident, getIncident, updateIncident } from '../store/incidentStore.js';
import { diagnose } from '../agents/incidentAgent.js';
import { draftFix } from '../agents/codingAgent.js';
import { verifyFix } from '../verification/verify.js';
import { openPullRequest } from '../verification/openPR.js';
import { attributionRecord } from '../celo/attribution.js';
import { cloneRepo, getRepoTree, getHeadCommit, cleanupRepo, repoGit } from '../repo/clone.js';
import { resolveDelivery } from '../repo/delivery.js';
import { publicIncident } from './publicView.js';

const router = Router();

const priceFor = (req) => {
  const tier = req.body?.tier === 'fix' ? 'fix' : 'triage';
  const amount = tier === 'fix' ? process.env.PRICE_FIX : process.env.PRICE_TRIAGE;
  return { amount, asset: 'USDC', tier };
};

/**
 * POST /v1/incidents
 * Gated by x402. Unpaid request gets a 402 quote; paid request creates the
 * incident and kicks off diagnosis (and, for the "fix" tier, the full
 * repair loop) synchronously enough to return a job id immediately.
 */
router.post('/v1/incidents', identifyAgent, requirePayment(priceFor), async (req, res) => {
  const { summary, repo, logsExcerpt, repoTree, tier = 'triage' } = req.body;

  if (!summary || !repo) {
    return res.status(400).json({ error: 'missing_fields', required: ['summary', 'repo'] });
  }

  const incident = createIncident({
    summary,
    repo,
    logsRef: logsExcerpt?.slice(0, 200),
    tier,
    payer: req.payer,
    settlement: req.settlement,
    // Recorded, not assumed: the tag is applied client-side, so Encode
    // stores what it knows rather than claiming leaderboard credit.
    attribution: attributionRecord(req.settlement?.txHash),
  });

  res.status(202).json({ id: incident.id, status: incident.status, statusUrl: `/v1/incidents/${incident.id}` });

  // Run diagnosis (and fix, if paid for) after responding — the client
  // polls GET /v1/incidents/:id or waits on the resolve webhook.
  runIncident(incident.id).catch((err) => {
    updateIncident(incident.id, { status: 'failed', error: err.message });
  });
});

async function runIncident(id) {
  const incident = getIncident(id);
  updateIncident(id, { status: 'diagnosing' });

  let repoLocalPath;
  try {
    repoLocalPath = await cloneRepo({ incidentId: id, repo: incident.repo });
  } catch (err) {
    updateIncident(id, { status: 'failed', error: `clone_failed: ${err.message}` });
    return;
  }

  const repoTree = await getRepoTree(repoLocalPath);
  const baseCommit = await getHeadCommit(repoLocalPath).catch(() => null);
  updateIncident(id, { repoLocalPath, repoTreeCache: repoTree, baseCommit });

  const diagnosis = await diagnose({
    summary: incident.summary,
    logsExcerpt: incident.logsRef ?? '',
    repoTree,
  });
  updateIncident(id, { diagnosis });

  if (!diagnosis.isActionable) {
    updateIncident(id, { status: 'resolved', repairPlan: null, verification: { note: 'not actionable' } });
    await cleanupRepo(repoLocalPath);
    return;
  }

  if (incident.tier === 'triage') {
    updateIncident(id, { status: 'resolved' }); // diagnosis IS the deliverable at this tier
    await cleanupRepo(repoLocalPath);
    return;
  }

  // Settle how the fix will reach the repo before doing any of the expensive
  // work. A repo Encode can neither push to nor fork is undeliverable, and
  // finding that out here costs one API call — finding it out at the push step
  // costs a patch, a verification run, and a target-repo `npm install`, all of
  // which the payer has already paid for.
  let delivery;
  try {
    delivery = await resolveDelivery({ owner: incident.repo.owner, repo: incident.repo.name });
  } catch (err) {
    updateIncident(id, { status: 'failed', error: `delivery_unavailable: ${err.message}` });
    await cleanupRepo(repoLocalPath);
    return;
  }

  updateIncident(id, { status: 'fix_drafted', repairPlan: diagnosis.repairPlan });

  const fix = await draftFix({
    incidentId: id,
    repoPath: repoLocalPath,
    repairPlan: diagnosis.repairPlan,
    affectedFiles: diagnosis.affectedFiles,
  });
  updateIncident(id, { patch: fix });

  const verification = await verifyFix({
    repoPath: repoLocalPath,
    branch: fix.branch,
    reproCommand: diagnosis.reproCommand,
    baseCommit,
  });
  updateIncident(id, { verification });

  if (!verification.resolved) {
    // Two very different terminal states share "no PR opened":
    //   - unverifiable: Encode had no test suite and no runnable repro, so it
    //     could not tell whether the patch works. The payer paid $0.50 and
    //     Encode delivered nothing it can stand behind — that's a debt, so the
    //     incident is flagged for refund (paid back by `refund.js --auto`).
    //   - verification_failed: Encode DID run a check and it came back negative
    //     (a present suite failed, or the repro still fails on the patch). Work
    //     was performed and the fix was shown not to hold; not a refund class.
    const unverifiable = verification.verifiable === false;
    updateIncident(id, {
      status: 'failed',
      error: `${unverifiable ? 'no_verification_signal' : 'verification_failed'}: ${verification.notes.join('; ')}`,
      ...(unverifiable ? { refundOwed: true, refundReason: 'no_verification_signal' } : {}),
    });
    await cleanupRepo(repoLocalPath);
    return;
  }

  // PR must be opened from a branch GitHub can see — push before opening it.
  // When Encode has no push access to the target repo, that branch goes to
  // Encode's own fork instead, and the PR is opened across repos. The remote
  // is added here rather than at clone time because triage never gets this
  // far, and forking on a diagnosis-only run would be a pure side effect.
  try {
    const git = repoGit(repoLocalPath);
    if (delivery.cloneUrl) await git.addRemote(delivery.remoteName, delivery.cloneUrl);
    await git.push(delivery.remoteName, fix.branch, ['--set-upstream']);
  } catch (err) {
    updateIncident(id, { status: 'failed', error: `push_failed: ${err.message}` });
    await cleanupRepo(repoLocalPath);
    return;
  }

  const pr = await openPullRequest({
    owner: incident.repo.owner,
    repo: incident.repo.name,
    branch: fix.branch,
    headOwner: delivery.headOwner,
    base: delivery.defaultBranch,
    title: `Encode fix: ${incident.summary}`,
    body: fix.prDescription ?? 'Automated fix from Encode. See verification report for details.',
  });

  updateIncident(id, { status: 'resolved', pr });
  await cleanupRepo(repoLocalPath);
}

router.get('/v1/incidents/:id', (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: 'not_found' });
  res.json(publicIncident(incident));
});

/**
 * GET /v1/incidents
 * Deliberately NOT a public list. The dashboard's ledger is the public
 * surface (settlement facts only); this would hand a stranger every
 * payer's diagnosis and repair plan. Callers poll their own incident by id,
 * which they got when they paid.
 */
router.get('/v1/incidents', (req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: 'No public incident list. Poll GET /v1/incidents/:id, or see GET /v1/dashboard for the settlement ledger.',
  });
});

/**
 * POST /v1/incidents/:id/resolve
 * Manual override — a human confirming a PR was merged (or rejecting a
 * proposed fix). Doesn't move money; settlement already happened at
 * creation time under the pay-then-deliver model.
 *
 * Anyone who knows an incident id can annotate it. That's tolerable because
 * the field is advisory and moves nothing, but it's the reason the response
 * is a projection rather than the raw record.
 */
router.post('/v1/incidents/:id/resolve', identifyAgent, (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: 'not_found' });

  const outcome = req.body?.outcome === 'merged' || req.body?.outcome === 'rejected' ? req.body.outcome : null;
  if (!outcome) {
    return res.status(400).json({ error: 'invalid_outcome', allowed: ['merged', 'rejected'] });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : null;
  const updated = updateIncident(req.params.id, {
    humanReview: { outcome, note, reviewedAt: new Date().toISOString() },
  });
  res.json(publicIncident(updated));
});

export default router;
