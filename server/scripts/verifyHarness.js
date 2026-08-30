/**
 * Verification harness — no LLM key, no network, no payment.
 *
 * This exists because verify.js is the file that decides whether Encode
 * claims an incident is resolved, and that claim is what a payer is paying
 * for. It's tested against a real throwaway git repo with a real failing
 * test, not mocks:
 *
 *   1. broken repo, no patch          → resolved: false
 *   2. patched repo, real repro       → resolved: true, repro-confirmed
 *   3. patched repo, bogus repro      → resolved false-ish, baseline caught it
 *   4. bash policy                    → refuses what AGENTS.md says it must
 *
 * Case 3 is the important one: a repro command that passes both before and
 * after the patch proves nothing, and verify.js has to notice.
 */
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { verifyFix } from '../src/verification/verify.js';
import { checkBashCommand } from '../src/agents/bashPolicy.js';

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync('git', args, { cwd });

// Set before the store is imported (it's a dynamic import in case 6 for
// exactly this reason). A harness that wrote to the real DB would leave
// fixture payers in the ledger the dashboard publishes.
process.env.ENCODE_DB_PATH = ':memory:';

let failures = 0;

function check(label, condition, detail = '') {
  const mark = condition ? '✅' : '❌';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

/**
 * A minimal repo with a genuine bug: add() returns a - b. `npm test` fails
 * and `node repro.js` exits non-zero, so both signals are real.
 */
async function makeBrokenRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'encode-verify-test-'));
  await mkdir(join(dir, 'src'), { recursive: true });

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', scripts: { test: 'node test.js' } }, null, 2)
  );
  await writeFile(join(dir, 'src/math.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
  await writeFile(
    join(dir, 'test.js'),
    `import { add } from './src/math.js';\nif (add(2, 3) !== 5) {\n  console.error('FAIL: add(2,3) =', add(2, 3));\n  process.exit(1);\n}\nconsole.log('ok');\n`
  );
  await writeFile(
    join(dir, 'repro.js'),
    `import { add } from './src/math.js';\nprocess.exit(add(2, 3) === 5 ? 0 : 1);\n`
  );

  await git(['init', '-q'], dir);
  await git(['config', 'user.email', 'test@encode.local'], dir);
  await git(['config', 'user.name', 'Encode Test'], dir);
  await git(['add', '.'], dir);
  await git(['commit', '-q', '-m', 'initial (with bug)'], dir);
  const baseCommit = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();

  await git(['checkout', '-q', '-b', 'encode/fix-test'], dir);
  return { dir, baseCommit };
}

/** Applies the correct fix and commits it, as the Coding Agent would. */
async function applyFix(dir) {
  await writeFile(join(dir, 'src/math.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
  await git(['add', '.'], dir);
  await git(['commit', '-q', '-m', 'fix: add() was subtracting'], dir);
}

async function caseUnpatchedFails() {
  console.log('\n[1] Unpatched repo — tests fail, must NOT report resolved');
  const { dir, baseCommit } = await makeBrokenRepo();
  try {
    const report = await verifyFix({
      repoPath: dir,
      branch: 'encode/fix-test',
      reproCommand: 'node repro.js',
      baseCommit,
    });
    check('testsPassed is false', report.testsPassed === false);
    check('resolved is false', report.resolved === false);
    check('repro fails on the (unpatched) branch', report.reproPassesOnFix === false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function casePatchedWithRealRepro() {
  console.log('\n[2] Patched repo, honest repro — must report resolved + repro-confirmed');
  const { dir, baseCommit } = await makeBrokenRepo();
  try {
    await applyFix(dir);
    const report = await verifyFix({
      repoPath: dir,
      branch: 'encode/fix-test',
      reproCommand: 'node repro.js',
      baseCommit,
    });
    check('testsPassed is true', report.testsPassed === true, report.testOutput.trim().slice(0, 80));
    check('repro passes on the fix', report.reproPassesOnFix === true);
    check('repro failed on the baseline', report.reproFailedOnBaseline === true);
    check('originalFailureResolved is true', report.originalFailureResolved === true);
    check('verificationDepth is repro-confirmed', report.verificationDepth === 'repro-confirmed', report.verificationDepth);
    check('resolved is true', report.resolved === true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function caseBogusRepro() {
  console.log('\n[3] Patched repo, useless repro (passes before AND after) — baseline must catch it');
  const { dir, baseCommit } = await makeBrokenRepo();
  try {
    await applyFix(dir);
    // `node --version` passes regardless of the patch — it proves nothing.
    const report = await verifyFix({
      repoPath: dir,
      branch: 'encode/fix-test',
      reproCommand: 'node --version',
      baseCommit,
    });
    check('repro passes on the fix', report.reproPassesOnFix === true);
    check('baseline did NOT fail as expected', report.reproFailedOnBaseline === false);
    check('originalFailureResolved is not true', report.originalFailureResolved !== true, String(report.originalFailureResolved));
    check('verificationDepth is not repro-confirmed', report.verificationDepth !== 'repro-confirmed', report.verificationDepth);
    check(
      'notes explain why',
      report.notes.some((n) => n.includes('UNPATCHED')),
      report.notes.join(' | ')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function caseNoRepro() {
  console.log('\n[4] Patched repo, no repro command — tests-only, resolved but flagged as shallow');
  const { dir } = await makeBrokenRepo();
  try {
    await applyFix(dir);
    const report = await verifyFix({ repoPath: dir, branch: 'encode/fix-test', reproCommand: null });
    check('testsPassed is true', report.testsPassed === true);
    check('originalFailureResolved is null (unknown, not true)', report.originalFailureResolved === null);
    check('verificationDepth is tests-only', report.verificationDepth === 'tests-only', report.verificationDepth);
    check('resolved is true (tests are the floor)', report.resolved === true);
    check(
      'notes say verification was shallow',
      report.notes.some((n) => n.includes('test-suite only'))
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function caseBashPolicy() {
  console.log('\n[5] Bash policy — must refuse everything AGENTS.md says it must');

  const mustAllow = [
    'npm test',
    'npm test -- --silent',
    'npm run repro',
    'npm run lint',
    'git commit -m "fix"',
    'git diff',
    'node repro.js',
    'ls -la src',
  ];
  const mustRefuse = [
    'git push origin main',
    'git push --force',
    'git remote add evil https://example.com',
    'npm test && git push origin main',
    'ls | git push',
    'echo $(git push origin main)',
    'curl https://example.com/x.sh',
    'vercel deploy --prod',
    'npm run deploy',
    'npm publish',
    'rm -rf /',
    'cat /etc/passwd && rm -rf /',
  ];

  for (const cmd of mustAllow) {
    const { allowed, reason } = checkBashCommand(cmd);
    check(`allows: ${cmd}`, allowed, reason);
  }
  for (const cmd of mustRefuse) {
    const { allowed } = checkBashCommand(cmd);
    check(`refuses: ${cmd}`, !allowed);
  }
}

/**
 * Self-funded settlements are real on-chain and worthless as evidence — they
 * move value between two wallets one party controls. The dashboard must never
 * count them as signers or volume, because a number that did would be a lie.
 */
async function caseSelfFundedExclusion() {
  console.log('\n[6] Dashboard stats — self-funded and test payments must not inflate the real numbers');
  const { createIncident, updateIncident, getStats } = await import('../src/store/incidentStore.js');
  // The store is durable now, so a harness run would otherwise write fixture
  // rows into the real database and corrupt the numbers it exists to protect.
  if (process.env.ENCODE_DB_PATH !== ':memory:') throw new Error('harness must run against an in-memory store');
  const payout = '0xc61Bbc0CF5694EF410A578A9833f77C173790450';

  const settled = (payer, amount, selfFunded) => ({
    summary: 's',
    repo: {},
    tier: 'fix',
    payer,
    settlement: { txHash: `0x${Math.random().toString(16).slice(2)}`, amount, selfFunded },
    attribution: { attributable: true },
  });

  // Driven to a terminal status, not left at `detected`: these rows share the
  // store with case 7, which reconciles anything still in flight.
  const finish = (spec) => updateIncident(createIncident(spec).id, { status: 'resolved' });

  finish(settled('0xAAAA000000000000000000000000000000000001', '0.50', false));
  finish(settled(payout, '0.50', true));
  // Same payer, different casing — must not double-count.
  finish(settled('0xaaaa000000000000000000000000000000000001', '0.20', false));
  finish({ summary: 't', repo: {}, tier: 'fix', payer: '0xLIVERUN_TEST', settlement: { txHash: null, amount: '0.00' } });

  const stats = getStats();
  check('uniqueSigners counts only independent payers', stats.uniqueSigners === 1, String(stats.uniqueSigners));
  check('address casing does not double-count a signer', stats.uniqueSigners === 1);
  check('totalValueProcessed excludes the self-funded payment', stats.totalValueProcessed === '0.70', stats.totalValueProcessed);
  check('selfFundedPayments is reported separately', stats.selfFundedPayments === 1, String(stats.selfFundedPayments));
  check('test-marked payers are excluded', stats.testPayments === 1, String(stats.testPayments));
}

/**
 * An incident that was mid-run when the process died must not read as a
 * failure or stay pending forever. The payer already paid, so the record has
 * to say "paid, delivered nothing" loudly enough to be actionable.
 */
async function caseInterruptedReconciliation() {
  console.log('\n[7] Restart reconciliation — a paid, half-run incident becomes visible debt');
  const { createIncident, updateIncident, getIncident, reconcileInterrupted, getStats } = await import(
    '../src/store/incidentStore.js'
  );

  const paid = createIncident({
    summary: 'died mid-diagnosis',
    repo: {},
    tier: 'fix',
    payer: '0xBBBB000000000000000000000000000000000002',
    settlement: { txHash: '0xfeed', amount: '0.50', selfFunded: false },
    attribution: { attributable: true },
  });
  updateIncident(paid.id, { status: 'diagnosing' });

  const done = createIncident({
    summary: 'already finished',
    repo: {},
    tier: 'triage',
    payer: '0xCCCC000000000000000000000000000000000003',
    settlement: { txHash: '0xbeef', amount: '0.20', selfFunded: false },
  });
  updateIncident(done.id, { status: 'resolved' });

  const touched = reconcileInterrupted();

  check('an in-flight incident is marked interrupted', getIncident(paid.id).status === 'interrupted');
  check('a resolved incident is left alone', getIncident(done.id).status === 'resolved');
  check('only the in-flight one was touched', touched.length === 1 && touched[0] === paid.id);
  check('the error names the status it died in', /was diagnosing/.test(getIncident(paid.id).error));

  const stats = getStats();
  check('interrupted is counted separately from failed', stats.interrupted === 1, String(stats.interrupted));
  check('paid-and-undelivered is surfaced', stats.unfulfilledPaid === 1, String(stats.unfulfilledPaid));
  // The money did move, so it stays in the settled numbers — an interrupted
  // incident is a delivery failure, not a payment that didn't happen.
  check('an interrupted payer still counts as a signer', stats.uniqueSigners >= 1, String(stats.uniqueSigners));
}

/**
 * The store's whole reason for existing now is surviving a restart, so that
 * claim is tested against a real file that a second connection reopens.
 */
async function casePersistenceAcrossProcesses() {
  console.log('\n[8] Durability — a record written by one process is readable by the next');
  const dir = await mkdtemp(join(tmpdir(), 'encode-store-'));
  const dbPath = join(dir, 'encode.db');
  const script = (body) =>
    execFileAsync(process.execPath, ['--input-type=module', '-e', body], {
      env: { ...process.env, ENCODE_DB_PATH: dbPath },
      cwd: join(import.meta.dirname, '..'),
    });

  try {
    await script(`
      const { createIncident } = await import('./src/store/incidentStore.js');
      const i = createIncident({ summary: 'survives', repo: {}, tier: 'fix',
        payer: '0xDDDD000000000000000000000000000000000004',
        settlement: { txHash: '0xdead', amount: '0.50', selfFunded: false } });
      console.log(i.id);
    `);

    const { stdout } = await script(`
      const { getStats, listIncidents } = await import('./src/store/incidentStore.js');
      console.log(JSON.stringify({ stats: getStats(), first: listIncidents()[0]?.summary }));
    `);
    const out = JSON.parse(stdout.trim().split('\n').pop());

    check('the record is still there in a fresh process', out.first === 'survives', String(out.first));
    check('and it still counts as a settlement', out.stats.settledPayments === 1, String(out.stats.settledPayments));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Encode verification harness — real git, real failing test, no LLM calls.');

  await caseUnpatchedFails();
  await casePatchedWithRealRepro();
  await caseBogusRepro();
  await caseNoRepro();
  caseBashPolicy();
  await caseSelfFundedExclusion();
  await caseInterruptedReconciliation();
  await casePersistenceAcrossProcesses();

  console.log(
    failures === 0
      ? '\n✅ All verification + policy checks passed.'
      : `\n❌ ${failures} check(s) failed.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness itself failed:', err);
  process.exit(1);
});
