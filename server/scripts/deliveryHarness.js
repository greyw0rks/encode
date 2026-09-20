/**
 * Delivery harness — how a fix reaches a repo Encode doesn't own.
 *
 * Two halves, deliberately split, because they prove different things:
 *
 *   offline (always)  — the decision logic: which strategy applies to a given
 *                       repo, and what to do about a fork namespace. Pure
 *                       functions, no token, no network.
 *   live (--live)     — the part that actually breaks: forking a real repo,
 *                       pushing a branch into the fork, and confirming the
 *                       branch landed. Nothing offline can prove a git push.
 *
 * The live cases use repos Encode's token has `pull: true, push: false` on —
 * exactly the shape that used to die at `push_failed`. They create a real fork
 * under the token's account and clean up their branches afterwards.
 *
 *   node scripts/deliveryHarness.js              # offline only
 *   node scripts/deliveryHarness.js --live       # + real fork and push
 *   node scripts/deliveryHarness.js --live-pr    # + a real cross-repo PR, closed again
 *
 * The offline half runs as part of `npm test`; the live halves are opt-in
 * because they touch GitHub.
 */
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { simpleGit } from 'simple-git';
import { chooseDeliveryMode, classifyForkCandidate, prHead, resolveDelivery } from '../src/repo/delivery.js';
import { openPullRequest } from '../src/verification/openPR.js';

const LIVE_PR = process.argv.includes('--live-pr');
const LIVE = process.argv.includes('--live') || LIVE_PR;
const LIVE_REPO = { owner: 'Elchapie', repo: 'Portfolio' };
// A throwaway repo the operator owns, so opening a real PR on it is harmless.
// The token has no push access here either, so this goes through the fork path.
const LIVE_PR_REPO = { owner: 'greyw0rks', repo: 'encore-testbed' };

let failures = 0;

function check(label, condition, detail = '') {
  const mark = condition ? '✅' : '❌';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

/** Throws if `fn` does not throw — used for the cases that must refuse. */
function checkThrows(label, fn, codeFragment) {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    check(label, err.code === codeFragment, `code=${err.code} :: ${err.message.slice(0, 90)}`);
  }
}

/**
 * The whole point of the feature: a repo you don't own has to be deliverable
 * without asking its owner for anything.
 */
function caseModeSelection() {
  console.log('\n[1] Strategy selection — push access wins, public falls back to fork');

  check('push access → direct', chooseDeliveryMode({ canPush: true, isPrivate: false }) === 'direct');
  check('push access on a private repo → still direct', chooseDeliveryMode({ canPush: true, isPrivate: true }) === 'direct');
  check('no push, public → fork', chooseDeliveryMode({ canPush: false, isPrivate: false }) === 'fork');

  // Not a degradation, an impossibility: you cannot fork a private repo, and
  // the operator needs to be told that rather than shown a stack trace.
  checkThrows(
    'no push, private → refuses, naming the collaborator path',
    () => chooseDeliveryMode({ canPush: false, isPrivate: true }),
    'delivery_unavailable'
  );
}

function caseForkNamespace() {
  console.log('\n[2] Fork namespace — reuse our own fork, refuse anyone else\'s');

  const owner = 'Elchapie';
  const repo = 'Portfolio';

  check(
    'nothing there → create',
    classifyForkCandidate({ existing: null, owner, repo }) === 'create'
  );
  check(
    'our own earlier fork → reuse',
    classifyForkCandidate({
      existing: { fork: true, parent: { full_name: 'Elchapie/Portfolio' } },
      owner,
      repo,
    }) === 'reuse'
  );
  check(
    'casing differences still reuse',
    classifyForkCandidate({
      existing: { fork: true, parent: { full_name: 'elchapie/portfolio' } },
      owner,
      repo,
    }) === 'reuse'
  );
  // Pushing a branch into an unrelated repo would be worse than failing.
  check(
    'same name, not a fork of the target → conflict',
    classifyForkCandidate({
      existing: { fork: true, parent: { full_name: 'someone/else' } },
      owner,
      repo,
    }) === 'conflict'
  );
  check(
    'same name, not a fork at all → conflict',
    classifyForkCandidate({ existing: { fork: false }, owner, repo }) === 'conflict'
  );
}

/**
 * GitHub wants `owner:branch` for a cross-repo PR and a bare branch for a
 * same-repo one. Getting it wrong is a 422 at the very last step, after the
 * payer has been charged — the worst possible place to discover it.
 */
function casePrHead() {
  console.log('\n[3] PR head — cross-repo only when the branch is in a fork');

  check(
    'same repo → bare branch',
    prHead({ headOwner: null, branch: 'encode/fix-abc' }) === 'encode/fix-abc'
  );
  check(
    'forked → owner:branch',
    prHead({ headOwner: 'encodebot-ai', branch: 'encode/fix-abc' }) === 'encodebot-ai:encode/fix-abc'
  );
}

/** Git-over-HTTPS needs Basic, not Bearer — REST takes Bearer, the transport doesn't. */
function authConfig() {
  const basic = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64');
  return [`http.extraHeader=Authorization: Basic ${basic}`];
}

async function github(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function caseLiveForkAndPush() {
  console.log(`\n[4] Live — fork ${LIVE_REPO.owner}/${LIVE_REPO.repo} and push a branch into the fork`);

  if (!process.env.GITHUB_TOKEN) {
    check('GITHUB_TOKEN is set', false, 'set it to run the live case');
    return;
  }

  const delivery = await resolveDelivery(LIVE_REPO);
  check('strategy is fork', delivery.mode === 'fork', delivery.mode);
  check('head owner is the token\'s own account', Boolean(delivery.headOwner), delivery.headOwner);
  check('push remote is the fork, not origin', delivery.remoteName === 'fork', delivery.remoteName);
  check('clone url points at the fork', delivery.cloneUrl === `https://github.com/${delivery.headOwner}/${LIVE_REPO.repo}.git`, delivery.cloneUrl);
  check('default branch was read, not assumed', Boolean(delivery.defaultBranch), delivery.defaultBranch);

  const branch = `encode/harness-${Date.now()}`;
  const dir = await mkdtemp(join(tmpdir(), 'encode-delivery-'));
  const git = simpleGit({ baseDir: dir, config: authConfig() });

  try {
    // Mirrors production exactly: cloneRepo takes the *upstream*, and the fork
    // is added as a second remote at push time. Cloning the fork directly
    // would be easier but would skip the addRemote step — and pushing a
    // shallow branch to a second remote is precisely what could not work.
    await git.clone(`https://github.com/${LIVE_REPO.owner}/${LIVE_REPO.repo}.git`, dir, ['--depth', '1']);
    const local = simpleGit({ baseDir: dir, config: authConfig() });
    await local.checkoutLocalBranch(branch);
    await writeFile(join(dir, 'ENCODE_HARNESS.txt'), 'throwaway branch from the delivery harness\n');
    await local.add('ENCODE_HARNESS.txt');
    await local.addConfig('user.email', 'harness@encode.local');
    await local.addConfig('user.name', 'Encode Harness');
    await local.commit('chore: delivery harness throwaway commit');
    await local.addRemote(delivery.remoteName, delivery.cloneUrl);
    await local.push(delivery.remoteName, branch, ['--set-upstream']);
    check('pushed to the fork without error', true, `${delivery.headOwner}:${branch}`);

    // The push reporting success is not the same as the branch existing.
    const ref = await github(`/repos/${delivery.headOwner}/${LIVE_REPO.repo}/branches/${encodeURIComponent(branch)}`);
    check('branch actually exists on the fork', ref.ok, `GET branches → ${ref.status}`);
  } finally {
    await github(`/repos/${delivery.headOwner}/${LIVE_REPO.repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' });
    const gone = await github(`/repos/${delivery.headOwner}/${LIVE_REPO.repo}/branches/${encodeURIComponent(branch)}`);
    check('throwaway branch cleaned up', gone.status === 404, `GET branches → ${gone.status}`);
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    '\n  note: this case stops at the push. The PR itself is opened, and\n' +
    '  closed again, by [5] under --live-pr.'
  );
}

/**
 * The last link, and the one that fails *after* the payer has been charged:
 * GitHub only accepts a cross-repo head as `owner:branch`. Asserting that
 * string offline does not prove GitHub accepts it, so this opens a real PR —
 * on the operator's own throwaway repo, not a client's — and closes it again.
 */
async function caseLiveCrossRepoPr() {
  console.log(
    `\n[5] Live PR — open a real cross-repo PR on ${LIVE_PR_REPO.owner}/${LIVE_PR_REPO.repo}, then close it`
  );

  if (!process.env.GITHUB_TOKEN) {
    check('GITHUB_TOKEN is set', false, 'set it to run the live case');
    return;
  }

  const delivery = await resolveDelivery(LIVE_PR_REPO);
  check('strategy is fork (the token cannot push here either)', delivery.mode === 'fork', delivery.mode);
  check("targeting the fork under the token's account", Boolean(delivery.headOwner), delivery.headOwner);

  const branch = `encode/harness-pr-${Date.now()}`;
  const dir = await mkdtemp(join(tmpdir(), 'encode-pr-'));
  let pr = null;

  try {
    const git = simpleGit({ baseDir: dir, config: authConfig() });
    await git.clone(`https://github.com/${LIVE_PR_REPO.owner}/${LIVE_PR_REPO.repo}.git`, dir, ['--depth', '1']);
    const local = simpleGit({ baseDir: dir, config: authConfig() });
    await local.checkoutLocalBranch(branch);
    await writeFile(join(dir, 'ENCODE_HARNESS.md'), 'Throwaway file from the delivery harness PR probe.\n');
    await local.add('ENCODE_HARNESS.md');
    await local.addConfig('user.email', 'harness@encode.local');
    await local.addConfig('user.name', 'Encode Harness');
    await local.commit('chore: delivery harness cross-repo PR probe');
    await local.addRemote(delivery.remoteName, delivery.cloneUrl);
    await local.push(delivery.remoteName, branch, ['--set-upstream']);
    check('branch pushed to the fork', true, `${delivery.headOwner}:${branch}`);

    // The actual assertion: does GitHub accept "owner:branch" as a head?
    pr = await openPullRequest({
      owner: LIVE_PR_REPO.owner,
      repo: LIVE_PR_REPO.repo,
      branch,
      headOwner: delivery.headOwner,
      base: delivery.defaultBranch,
      title: 'Encode delivery harness — cross-repo PR probe',
      body: 'Opened by `scripts/deliveryHarness.js --live-pr` to prove the cross-repo head format is accepted. Closed immediately.',
    });
    check('GitHub accepted the cross-repo head and returned a PR', Boolean(pr.url), pr.url);
    check('PR number came back', typeof pr.number === 'number', String(pr.number));

    const fetched = await github(`/repos/${LIVE_PR_REPO.owner}/${LIVE_PR_REPO.repo}/pulls/${pr.number}`);
    check(
      'the PR head really is the fork',
      fetched.body?.head?.repo?.full_name === `${delivery.headOwner}/${LIVE_PR_REPO.repo}`,
      fetched.body?.head?.repo?.full_name
    );
    check('the PR is open', fetched.body?.state === 'open', fetched.body?.state);
  } finally {
    if (pr?.number) {
      const closed = await github(`/repos/${LIVE_PR_REPO.owner}/${LIVE_PR_REPO.repo}/pulls/${pr.number}`, {
        method: 'PATCH',
        body: { state: 'closed' },
      });
      check('probe PR closed again', closed.body?.state === 'closed', closed.body?.state);
    }
    await github(`/repos/${delivery.headOwner}/${LIVE_PR_REPO.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'DELETE',
    });
    const gone = await github(`/repos/${delivery.headOwner}/${LIVE_PR_REPO.repo}/branches/${encodeURIComponent(branch)}`);
    check('probe branch cleaned up', gone.status === 404, `GET branches → ${gone.status}`);
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Encode delivery harness — strategy selection, fork namespace, PR head shape.');
  if (!LIVE) console.log('(offline only; --live forks + pushes, --live-pr also opens and closes a real PR)');

  caseModeSelection();
  caseForkNamespace();
  casePrHead();

  if (LIVE) {
    await caseLiveForkAndPush();
  }
  if (LIVE_PR) {
    await caseLiveCrossRepoPr();
  }

  console.log(
    failures === 0
      ? '\n✅ All delivery checks passed.'
      : `\n❌ ${failures} check(s) failed.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness itself failed:', err);
  process.exit(1);
});
