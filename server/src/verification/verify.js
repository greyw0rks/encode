import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, access, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkBashCommand } from '../agents/bashPolicy.js';
import { childEnv } from '../agents/childEnv.js';

const execFileAsync = promisify(execFile);

const STEP_TIMEOUT_MS = 180_000;

/**
 * Verification is what turns "a model wrote something" into "the incident is
 * actually resolved." Up to three checks:
 *
 *   1. The test suite passes on the patched branch.
 *   2. The repro command passes on the patched branch.
 *   3. The same repro command FAILS on the pre-patch baseline.
 *
 * (3) is the one that makes (2) mean anything. A repro command that passes
 * both before and after the patch didn't verify a fix — it verified nothing,
 * and Encode says so rather than reporting a resolved incident.
 *
 * Pricing note: Encode charges on "PR opened," not "merged" — but this
 * report is what makes the PR-opened claim honest instead of trusting the
 * Coding Agent's self-report.
 */

async function runStep(command, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd,
      // Scrubbed: this runs the target repo's scripts, which must never see
      // Encode's API keys. See agents/childEnv.js.
      env: childEnv(),
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true, exitCode: 0, output: stdout || stderr || '' };
  } catch (err) {
    return {
      passed: false,
      exitCode: err.code ?? null,
      output: err.stdout || err.stderr || err.message || '',
      timedOut: err.killed === true,
    };
  }
}

async function hasPackageJson(repoPath) {
  return access(join(repoPath, 'package.json'))
    .then(() => true)
    .catch(() => false);
}

/**
 * The repo's `npm test` command, or null when there is nothing real to run.
 *
 * This is the difference between "the suite failed" and "there is no suite":
 * `npm test` exits non-zero in BOTH cases (a missing test script hits npm's
 * placeholder `echo "Error: no test specified" && exit 1`), so a bare exit
 * code can't tell them apart. A repo with no runnable suite hasn't failed
 * verification — Encode simply has no test signal for it, which is a different
 * outcome with a different consequence (see verifyFix's `verifiable`).
 */
async function readTestScript(repoPath) {
  try {
    const pkg = JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf8'));
    const test = pkg?.scripts?.test;
    if (typeof test !== 'string' || test.trim() === '') return null;
    // npm's scaffolded placeholder is not a suite; treat it as absent.
    if (/no test specified/i.test(test)) return null;
    return test;
  } catch {
    return null;
  }
}

/**
 * Runs the repro command against the pre-patch tree in a throwaway worktree,
 * so the patched clone is never mutated to do it. Returns null when the
 * baseline can't be established (no base commit, or worktree setup failed) —
 * null means "unknown," which is treated differently from "didn't fail."
 */
async function checkBaseline({ repoPath, baseCommit, reproCommand }) {
  if (!baseCommit) return null;

  let worktreePath;
  try {
    worktreePath = await mkdtemp(join(tmpdir(), 'encode-baseline-'));
    await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, baseCommit], {
      cwd: repoPath,
      timeout: STEP_TIMEOUT_MS,
    });

    if (await hasPackageJson(worktreePath)) {
      // Dependencies aren't shared with the patched clone; a repro command
      // that needs them would fail for the wrong reason without this.
      await runStep('npm install --no-audit --no-fund', worktreePath);
    }

    const result = await runStep(reproCommand, worktreePath);
    return { failedAsExpected: !result.passed, exitCode: result.exitCode, output: result.output.slice(0, 4000) };
  } catch (err) {
    return { failedAsExpected: null, error: err.message };
  } finally {
    if (worktreePath) {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
      }).catch(() => {});
      await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function verifyFix({ repoPath, branch, reproCommand = null, baseCommit = null }) {
  const report = {
    branch,
    testsAvailable: null,
    testsPassed: null,
    testOutput: '',
    reproCommand: null,
    reproPassesOnFix: null,
    reproFailedOnBaseline: null,
    originalFailureResolved: null,
    verificationDepth: 'tests-only',
    verifiable: false,
    notes: [],
    verifiedAt: new Date().toISOString(),
  };

  // Absent tests are "no signal", not "failed". Running `npm test` on a repo
  // with no test script exits non-zero exactly as a failing suite does, so we
  // decide up front whether there is anything to run and record that fact —
  // otherwise a correct patch on a test-less repo is scored as a failure.
  const testScript = await readTestScript(repoPath);
  report.testsAvailable = testScript !== null;
  if (report.testsAvailable) {
    const testResult = await runStep('npm test --silent', repoPath);
    report.testsPassed = testResult.passed;
    report.testOutput = testResult.output.slice(0, 8000);
    if (testResult.timedOut) report.notes.push(`test run timed out after ${STEP_TIMEOUT_MS}ms`);
  } else {
    // testsPassed stays null: unknown, never silently false.
    report.notes.push('no runnable npm test script in the repo — no test-suite signal is available');
  }

  // A repro command from the model is still model input — it runs on this
  // machine, so it goes through the same policy as the agent's own bash.
  if (reproCommand) {
    const policy = checkBashCommand(reproCommand);
    if (!policy.allowed) {
      report.notes.push(`repro command rejected by bash policy: ${policy.reason}`);
    } else {
      report.reproCommand = reproCommand;

      const onFix = await runStep(reproCommand, repoPath);
      report.reproPassesOnFix = onFix.passed;
      if (!onFix.passed) report.notes.push(`repro command still fails on the patched branch (exit ${onFix.exitCode})`);

      const baseline = await checkBaseline({ repoPath, baseCommit, reproCommand });
      if (baseline === null) {
        report.notes.push('no base commit recorded — could not confirm the repro actually failed before the patch');
      } else if (baseline.failedAsExpected === null) {
        report.notes.push(`baseline check errored: ${baseline.error}`);
      } else {
        report.reproFailedOnBaseline = baseline.failedAsExpected;
        if (!baseline.failedAsExpected) {
          report.notes.push(
            'repro command passes on the UNPATCHED baseline too — it does not actually exercise the reported failure'
          );
        }
      }
    }
  } else {
    report.notes.push('no repro command identified during triage — verification is test-suite only');
  }

  // originalFailureResolved is only true when the repro both passes now and
  // demonstrably failed before. Anything less stays null (unknown), never
  // silently true.
  if (report.reproPassesOnFix === true && report.reproFailedOnBaseline === true) {
    report.originalFailureResolved = true;
    report.verificationDepth = 'repro-confirmed';
  } else if (report.reproPassesOnFix === false) {
    report.originalFailureResolved = false;
    report.verificationDepth = 'repro-attempted';
  } else if (report.reproCommand) {
    report.verificationDepth = 'repro-unconfirmed';
  }

  // "Verifiable" = Encode had at least one check it could actually run: a test
  // suite, or a repro command that executed on the patch. With neither, the
  // run produced no signal at all — that's `unverifiable`, and it's the case
  // that must not be billed as if a fix were attempted and found wanting.
  const reproRan = report.reproPassesOnFix !== null;
  report.verifiable = report.testsAvailable === true || reproRan;
  if (!report.verifiable) report.verificationDepth = 'unverifiable';

  // Deliver only on a positive signal that nothing contradicts:
  //   positive = tests passed, OR the repro is confirmed (failed before,
  //              passes after) — a confirmed repro stands on its own, so a
  //              repo with no test suite can still ship a verified fix.
  //   negative = a present test suite failed, OR the repro still fails on the
  //              patch. Either one blocks the PR outright.
  // Absent tests contribute neither: testsPassed is null, so a test-less repo
  // is no longer scored as a failure — it either clears on a confirmed repro
  // or falls through as `unverifiable`.
  const positive = report.testsPassed === true || report.verificationDepth === 'repro-confirmed';
  const negative = (report.testsAvailable === true && report.testsPassed === false)
    || report.originalFailureResolved === false;
  report.resolved = positive && !negative;
  return report;
}
