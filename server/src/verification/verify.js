import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkBashCommand } from '../agents/bashPolicy.js';

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
    testsPassed: false,
    testOutput: '',
    reproCommand: null,
    reproPassesOnFix: null,
    reproFailedOnBaseline: null,
    originalFailureResolved: null,
    verificationDepth: 'tests-only',
    notes: [],
    verifiedAt: new Date().toISOString(),
  };

  const testResult = await runStep('npm test --silent', repoPath);
  report.testsPassed = testResult.passed;
  report.testOutput = testResult.output.slice(0, 8000);
  if (testResult.timedOut) report.notes.push(`test run timed out after ${STEP_TIMEOUT_MS}ms`);

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

  // Tests passing is the floor. A confirmed repro upgrades confidence; a
  // repro that's known-failing on the patch blocks the PR outright.
  report.resolved = report.testsPassed && report.originalFailureResolved !== false;
  return report;
}
