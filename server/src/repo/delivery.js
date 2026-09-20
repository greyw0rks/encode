/**
 * Delivery strategy — how a fix gets from Encode's clone into a PR.
 *
 * Encode's terminal action is opening a PR, and GitHub will only open one from
 * a branch that exists on the remote. That means the branch has to be pushed
 * somewhere first, which needs write access to the target repo. A personal
 * access token only has that for repos its owner controls, so on anyone else's
 * repo the fix pipeline used to die at `push_failed` — the diagnosis and patch
 * were computed and then thrown away.
 *
 * There are two ways out, and which one applies is discovered, not configured:
 *
 *   direct — the token can push to the target repo. Push there, open a
 *            same-repo PR. This is the only option for a *private* repo, which
 *            cannot be forked.
 *   fork   — it can't. Fork the repo into the token's own account, push the
 *            branch there, and open a cross-repo PR back into the original.
 *            Needs no action from the repo owner, which is the entire point:
 *            no inbound request, no collaborator grant, no trust ask.
 *
 * The alternative to forking is asking the owner for write access, which is a
 * much bigger ask than it sounds (write access to the default branch), and the
 * GitHub App / installation-token flow that would do it properly is still an
 * open decision in todo.md. Forking covers the public case today.
 *
 * Note what this deliberately does NOT change: the push still happens in
 * operator code (routes/incidents.js), never through the Coding Agent's tool
 * whitelist. AGENTS.md rule 1 keeps the model unable to reach a remote.
 */

const GITHUB_API = 'https://api.github.com';

/** Matches openPR.js — Bearer for REST, and the JSON media type. */
function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set — cannot resolve delivery');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

async function gh(path, { method = 'GET' } = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, { method, headers: headers() });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null; // an HTML error page, or an empty 202 — callers use `text`
  }
  return { ok: res.ok, status: res.status, body, text };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Which strategy applies. Pure and network-free so the harness can walk every
 * combination without a token, a repo, or a fork.
 *
 * There is no third option to return: a private repo with no push access is
 * not "harder", it is impossible, and saying so here beats discovering it at
 * the push step after the patch has already been paid for.
 */
export function chooseDeliveryMode({ canPush, isPrivate }) {
  if (canPush) return 'direct';
  if (isPrivate) {
    throw fail(
      'delivery_unavailable',
      'private repo and no push access — a private repo cannot be forked; add the Encode account as a collaborator with write access instead'
    );
  }
  return 'fork';
}

/**
 * What to do about the `<login>/<repo>` namespace before pushing to it.
 * Pure, for the same reason as `chooseDeliveryMode`.
 *
 * A collision here is not hypothetical: a repo of the same name may already
 * exist in Encode's account — a previous fork of something else, or a fork of
 * this repo made by someone else. Reusing the wrong one would push a branch
 * into an unrelated repository, so it is refused rather than guessed at.
 */
export function classifyForkCandidate({ existing, owner, repo }) {
  if (!existing) return 'create';
  const isForkOfTarget =
    existing.fork === true &&
    existing.parent?.full_name?.toLowerCase() === `${owner}/${repo}`.toLowerCase();
  return isForkOfTarget ? 'reuse' : 'conflict';
}

/**
 * The `head` value for the PR. GitHub wants `owner:branch` when the branch
 * lives in a fork and a bare branch name when it lives in the target repo.
 * Getting this wrong is a 422 from the PR API, not a silent failure.
 */
export function prHead({ headOwner, branch }) {
  return headOwner ? `${headOwner}:${branch}` : branch;
}

/**
 * A fork is created asynchronously. `POST /forks` returns promptly, but the
 * new repo 200s on `/repos/...` before its refs exist — and pushing into a
 * fork with no refs fails. Waiting on the repo endpoint alone races; the
 * default branch appearing is the signal that actually matters.
 */
async function waitForBranch({ login, repo, branch, pollMs, pollTimeoutMs }) {
  const deadline = Date.now() + pollTimeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    const res = await gh(`/repos/${login}/${repo}/branches/${encodeURIComponent(branch)}`);
    if (res.ok) return;
    last = res.status;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw fail(
    'fork_not_ready',
    `fork ${login}/${repo} did not expose branch "${branch}" within ${pollTimeoutMs}ms (last status ${last})`
  );
}

async function ensureFork({ owner, repo, defaultBranch, pollMs, pollTimeoutMs }) {
  const me = await gh('/user');
  if (!me.ok) throw fail('github_user_lookup_failed', `GET /user → ${me.status} ${me.text.slice(0, 200)}`);
  const login = me.body.login;

  const existing = await gh(`/repos/${login}/${repo}`);

  if (existing.status !== 404 && !existing.ok) {
    throw fail('github_fork_lookup_failed', `GET /repos/${login}/${repo} → ${existing.status} ${existing.text.slice(0, 200)}`);
  }

  const action = classifyForkCandidate({
    existing: existing.ok ? existing.body : null,
    owner,
    repo,
  });

  if (action === 'conflict') {
    throw fail(
      'fork_name_conflict',
      `${login}/${repo} already exists and is not a fork of ${owner}/${repo} — refusing to push into an unrelated repo`
    );
  }

  if (action === 'create') {
    // 202 Accepted is the documented success for a fork that is still being
    // built, so it is not treated as a failure here.
    const created = await gh(`/repos/${owner}/${repo}/forks`, { method: 'POST' });
    if (!created.ok) {
      throw fail('github_fork_failed', `POST /repos/${owner}/${repo}/forks → ${created.status} ${created.text.slice(0, 200)}`);
    }
  }

  await waitForBranch({ login, repo, branch: defaultBranch, pollMs, pollTimeoutMs });

  return { owner: login, cloneUrl: `https://github.com/${login}/${repo}.git` };
}

/**
 * Resolve how this incident's fix will be delivered, creating a fork if that
 * is what it takes. Called once per `fix` run, before any expensive work.
 *
 * @returns {Promise<{mode: 'direct'|'fork', remoteName: string, cloneUrl: string|null, headOwner: string|null, defaultBranch: string}>}
 */
export async function resolveDelivery({ owner, repo, pollMs = 1500, pollTimeoutMs = 30000 }) {
  const target = await gh(`/repos/${owner}/${repo}`);

  if (target.status === 404) {
    throw fail('repo_not_found', `${owner}/${repo} not found, or the token cannot see it`);
  }
  if (!target.ok) {
    throw fail('github_repo_lookup_failed', `GET /repos/${owner}/${repo} → ${target.status} ${target.text.slice(0, 200)}`);
  }

  const { permissions, private: isPrivate } = target.body;
  // Used as the PR `base` too — the hardcoded 'main' this replaces was wrong
  // for any repo whose default branch is named something else.
  const defaultBranch = target.body.default_branch || 'main';

  const mode = chooseDeliveryMode({ canPush: Boolean(permissions?.push), isPrivate });

  if (mode === 'direct') {
    return { mode, remoteName: 'origin', cloneUrl: null, headOwner: null, defaultBranch };
  }

  const fork = await ensureFork({ owner, repo, defaultBranch, pollMs, pollTimeoutMs });
  return { mode, remoteName: 'fork', cloneUrl: fork.cloneUrl, headOwner: fork.owner, defaultBranch };
}
