/**
 * Live run — exercises the actual production code paths (not mocks):
 * real Claude calls for diagnosis and patching, real `npm test`, and
 * optionally a real PR push. Payment is still skipped — this is for
 * testing the fix pipeline itself, not a full x402 dry run, so it fabricates
 * a settlement record rather than hitting the facilitator.
 *
 * Requires in .env: ANTHROPIC_API_KEY. GITHUB_TOKEN + push access only
 * needed if you pass --live-pr.
 *
 * Usage:
 *   node scripts/liveRun.js --repo yourname/your-repo --summary "..." [--tier fix|triage] [--logs "..."] [--live-pr] [--keep]
 *
 * Without --live-pr: clones, diagnoses, patches, runs tests, prints the
 * diff/PR description, then stops — nothing is pushed anywhere.
 * With --live-pr: also pushes the branch and opens a real PR. Only pass
 * this against a repo you actually own and are fine getting a PR on.
 * With --keep: leaves the clone on disk so a failed run can be inspected.
 */
import '../src/config/env.js';
import { cloneRepo, getRepoTree, getHeadCommit, cleanupRepo, repoGit } from '../src/repo/clone.js';
import { diagnose } from '../src/agents/incidentAgent.js';
import { draftFix } from '../src/agents/codingAgent.js';
import { providerSummary } from '../src/llm/provider.js';
import { verifyFix } from '../src/verification/verify.js';
import { openPullRequest } from '../src/verification/openPR.js';

// A live run's settlement is fabricated (payment is the one mocked step), so
// it must not land in the durable store alongside real ones. The LIVERUN payer
// marker already excludes it from the stats; this keeps the row out entirely.
process.env.ENCODE_DB_PATH = ':memory:';
const { createIncident, updateIncident, getIncident } = await import('../src/store/incidentStore.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback = undefined) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  const repoArg = get('--repo');
  if (!repoArg || !repoArg.includes('/')) {
    console.error('Usage: node scripts/liveRun.js --repo owner/name --summary "..." [--tier fix|triage] [--logs "..."] [--live-pr]');
    process.exit(1);
  }
  const [owner, name] = repoArg.split('/');
  return {
    repo: { owner, name },
    summary: get('--summary', 'Manually reported incident via liveRun.js'),
    logs: get('--logs', '(no logs provided)'),
    tier: get('--tier', 'fix'),
    livePr: args.includes('--live-pr'),
    keep: args.includes('--keep'),
  };
}

function log(step, data) {
  console.log(`\n[${step}]`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set. Add it to .env before running this.');
    process.exit(1);
  }

  const { repo, summary, logs, tier, livePr, keep } = parseArgs();

  log('0. LLM provider', providerSummary());

  if (livePr && !process.env.GITHUB_TOKEN) {
    console.error('❌ --live-pr requires GITHUB_TOKEN in .env.');
    process.exit(1);
  }

  const cleanup = async (path) => {
    if (keep) {
      console.log(`\n📂 --keep set, leaving the clone in place: ${path}`);
      return;
    }
    await cleanupRepo(path);
  };

  const incident = createIncident({
    summary,
    repo,
    logsRef: logs,
    tier,
    payer: '0xLIVERUN_TEST_NOT_A_REAL_SETTLEMENT',
    settlement: { txHash: null, amount: '0.00', asset: 'TEST', settledAt: new Date().toISOString() },
  });
  log('1. incident created (test settlement — not a real x402 payment)', { id: incident.id });

  updateIncident(incident.id, { status: 'diagnosing' });
  const repoLocalPath = await cloneRepo({ incidentId: incident.id, repo });
  const repoTree = await getRepoTree(repoLocalPath);
  const baseCommit = await getHeadCommit(repoLocalPath).catch(() => null);
  updateIncident(incident.id, { repoLocalPath, repoTreeCache: repoTree, baseCommit });
  log('2. cloned + tree built', { path: repoLocalPath, fileCount: repoTree.split('\n').length, baseCommit });

  console.log('\n⏳ Calling Incident Agent (real LLM call)...');
  const diagnosis = await diagnose({ summary, logsExcerpt: logs, repoTree });
  updateIncident(incident.id, { diagnosis });
  log('3. diagnosis (real)', diagnosis);

  if (!diagnosis.isActionable) {
    console.log('\n⚠️  Incident Agent judged this not actionable — stopping here, nothing to patch.');
    await cleanup(repoLocalPath);
    return;
  }

  if (tier === 'triage') {
    console.log('\n✅ Triage-only run complete — diagnosis above is the deliverable.');
    await cleanup(repoLocalPath);
    return;
  }

  updateIncident(incident.id, { status: 'fix_drafted', repairPlan: diagnosis.repairPlan });
  console.log(`\n⏳ Calling Coding Agent (${providerSummary().codingStrategy} — this can take a few minutes)...`);
  const fix = await draftFix({
    incidentId: incident.id,
    repoPath: repoLocalPath,
    repairPlan: diagnosis.repairPlan,
    affectedFiles: diagnosis.affectedFiles,
    onEvent: (event) => {
      if (event.type === 'tool') {
        const detail = event.name === 'run_bash' ? event.input.command : event.input.path;
        console.log(`   · [turn ${event.turn}] ${event.name}: ${String(detail).slice(0, 120)}`);
      } else if (event.type === 'submit_fix') {
        console.log(`   · [turn ${event.turn}] submit_fix (testsPassed: ${event.input.testsPassed})`);
      }
    },
  });
  updateIncident(incident.id, { patch: fix });
  log('4. patch (real)', {
    branch: fix.branch,
    strategy: fix.strategy,
    model: fix.model,
    submitted: fix.submitted,
    diffSummary: fix.diffSummary,
    testsPassed: fix.testsPassed,
  });

  if (!fix.submitted) {
    console.log('\n❌ Coding Agent never called submit_fix — it ran out of turns or bailed. Not verifying.');
    await cleanup(repoLocalPath);
    return;
  }

  console.log('\n⏳ Running verification (real test suite + repro check against the patched clone)...');
  const verification = await verifyFix({
    repoPath: repoLocalPath,
    branch: fix.branch,
    reproCommand: diagnosis.reproCommand,
    baseCommit,
  });
  updateIncident(incident.id, { verification });
  log('5. verification (real)', verification);

  if (!verification.resolved) {
    console.log('\n❌ Verification failed — not pushing or opening a PR.');
    console.log(`   Clone: ${repoLocalPath}${keep ? '' : ' (about to be deleted — re-run with --keep to inspect)'}`);
    await cleanup(repoLocalPath);
    return;
  }

  if (!livePr) {
    console.log('\n✅ Fix verified. Stopping before push/PR since --live-pr was not passed.');
    console.log(`   Branch: ${fix.branch}`);
    console.log(`   Verification depth: ${verification.verificationDepth}`);
    console.log(`   Local clone: ${repoLocalPath}`);
    await cleanup(repoLocalPath);
    return;
  }

  console.log('\n⏳ --live-pr set — pushing branch and opening a real PR...');
  await repoGit(repoLocalPath).push('origin', fix.branch, ['--set-upstream']);
  const pr = await openPullRequest({
    owner: repo.owner,
    repo: repo.name,
    branch: fix.branch,
    title: `Encode fix: ${summary}`,
    body: fix.prDescription ?? 'Automated fix from Encode.',
  });
  updateIncident(incident.id, { status: 'resolved', pr });
  log('6. PR opened (real)', pr);

  await cleanup(repoLocalPath);
  console.log(`\n✅ Live run complete. Final state:`);
  log('final incident', getIncident(incident.id));
}

main().catch((err) => {
  console.error('\n❌ Live run failed:', err);
  process.exit(1);
});
