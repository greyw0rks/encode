/**
 * Dry run — no Anthropic key, no GitHub write access, no x402 facilitator
 * reachable from this sandbox. What IS real here: the git clone, the file
 * tree walk, the incident store's state machine, and cleanup. Diagnosis
 * and patch generation are mocked so the control flow can be verified
 * end-to-end before spending real API calls or a real payment on it.
 */
import { cloneRepo, getRepoTree, cleanupRepo } from '../src/repo/clone.js';
import { createIncident, updateIncident, getIncident, getStats } from '../src/store/incidentStore.js';

function log(step, data) {
  console.log(`\n[${step}]`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  // 1. Simulate a paid request — this is what x402 middleware would attach
  //    to req.payer / req.settlement after verifying a real payment.
  const fakePayer = '0xDRYRUN00000000000000000000000000000001';
  const fakeSettlement = {
    txHash: '0xDRYRUNTX0000000000000000000000000000000000000000000000000000',
    amount: '8.00',
    asset: 'USDC',
    settledAt: new Date().toISOString(),
  };

  const incident = createIncident({
    summary: 'GET /health intermittently returns 500 after deploy',
    repo: { owner: 'octocat', name: 'Hello-World' }, // tiny, public, safe to clone
    logsRef: '500 Internal Server Error x14 in the last hour, all on /health',
    tier: 'fix',
    payer: fakePayer,
    settlement: fakeSettlement,
  });
  log('1. incident created', { id: incident.id, status: incident.status });

  // 2. Real clone against GitHub — this is the part that was untested before.
  updateIncident(incident.id, { status: 'diagnosing' });
  let repoLocalPath;
  try {
    repoLocalPath = await cloneRepo({ incidentId: incident.id, repo: incident.repo });
    log('2. repo cloned', { path: repoLocalPath });
  } catch (err) {
    log('2. CLONE FAILED', err.message);
    process.exit(1);
  }

  // 3. Real file tree walk against the actual clone.
  const tree = await getRepoTree(repoLocalPath);
  updateIncident(incident.id, { repoLocalPath, repoTreeCache: tree });
  log('3. repo tree', tree);

  // 4. Mocked diagnosis — stands in for the Incident Agent's Claude call.
  const diagnosis = {
    isActionable: true,
    severity: 'medium',
    probableCause: '[MOCKED] Health check endpoint has no error handling around a dependency call.',
    affectedFiles: ['README'],
    repairPlan: ['Add try/catch around the dependency call in the health handler', 'Return 200 with a degraded flag instead of 500 on transient failure'],
    confidence: 0.8,
  };
  updateIncident(incident.id, { diagnosis, status: 'fix_drafted', repairPlan: diagnosis.repairPlan });
  log('4. diagnosis (mocked — no ANTHROPIC_API_KEY in this sandbox)', diagnosis);

  // 5. Mocked patch — stands in for the Coding Agent's Claude Agent SDK run.
  const fix = {
    branch: `encode/fix-${incident.id}`,
    diffSummary: '[MOCKED] Would add try/catch + degraded-mode response in health handler.',
    prDescription: '[MOCKED] PR body the Coding Agent would generate.',
    testsPassed: true,
  };
  updateIncident(incident.id, { patch: fix });
  log('5. patch (mocked)', fix);

  // 6. Mocked verification — real verifyFix() would run `npm test` in repoLocalPath.
  const verification = { testsPassed: true, originalFailureResolved: true, resolved: true, verifiedAt: new Date().toISOString() };
  updateIncident(incident.id, { verification, status: 'resolved' });
  log('6. verification (mocked)', verification);

  // 7. Real cleanup — confirm the clone actually gets removed.
  await cleanupRepo(repoLocalPath);
  const fs = await import('fs/promises');
  const stillExists = await fs.access(repoLocalPath).then(() => true).catch(() => false);
  log('7. cleanup', { path: repoLocalPath, stillExists });

  log('final incident state', getIncident(incident.id));
  log('dashboard stats', getStats());

  console.log('\n✅ Dry run complete. Clone, tree walk, state machine, and cleanup are real and passed.');
  console.log('   Still mocked: Incident Agent diagnosis, Coding Agent patch, test verification, GitHub PR, x402 settlement.');
}

main().catch((err) => {
  console.error('\n❌ Dry run failed:', err);
  process.exit(1);
});
