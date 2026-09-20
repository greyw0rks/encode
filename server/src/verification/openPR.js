import { prHead } from '../repo/delivery.js';

const GITHUB_API = 'https://api.github.com';

/**
 * Opens a PR from the Coding Agent's branch. This — not a merge, not a
 * deploy — is Encode's terminal action. Everything past this point is a
 * human decision.
 *
 * `headOwner` names the account the branch was pushed to when that isn't the
 * target repo — i.e. Encode's own fork, on a repo it has no push access to
 * (see repo/delivery.js). GitHub wants a cross-repo head as `owner:branch`,
 * and a same-repo head as a bare branch name.
 *
 * `base` should be the repo's real default branch, which resolveDelivery
 * already looks up; the previous hardcoded 'main' was wrong for any repo
 * named otherwise.
 */
export async function openPullRequest({ owner, repo, branch, headOwner = null, base = 'main', title, body }) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ title, body, head: prHead({ headOwner, branch }), base }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`github_pr_failed: ${res.status} ${detail}`);
  }

  const data = await res.json();
  return { url: data.html_url, number: data.number };
}
