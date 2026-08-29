const GITHUB_API = 'https://api.github.com';

/**
 * Opens a PR from the Coding Agent's branch. This — not a merge, not a
 * deploy — is Encode's terminal action. Everything past this point is a
 * human decision.
 */
export async function openPullRequest({ owner, repo, branch, base = 'main', title, body }) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ title, body, head: branch, base }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`github_pr_failed: ${res.status} ${detail}`);
  }

  const data = await res.json();
  return { url: data.html_url, number: data.number };
}
