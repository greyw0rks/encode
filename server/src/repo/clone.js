import { simpleGit } from 'simple-git';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Clones the target repo into a scoped, per-incident working directory.
 * Nothing else touches disk outside this path, and it's deleted once the
 * incident is resolved/failed — the Coding Agent never operates on a repo
 * that could be shared across concurrent incidents.
 *
 * `repo` shape: { owner, name, url?, branch? }
 * If `url` isn't given, defaults to the public GitHub HTTPS URL. Private
 * repos are reached with GITHUB_TOKEN via the auth header below.
 */
/**
 * Git-over-HTTPS auth header for GITHUB_TOKEN.
 *
 * Must be Basic, not Bearer. GitHub's git endpoint rejects
 * `Authorization: Bearer <token>` with "invalid credentials" for OAuth and
 * installation tokens — only the REST API accepts Bearer. The git transport
 * wants Basic with the token as the password and a dummy username. This
 * cost a full debugging cycle; don't "simplify" it back to Bearer.
 */
function authConfig() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return [`http.extraHeader=Authorization: Basic ${basic}`];
}

export async function cloneRepo({ incidentId, repo }) {
  const workDir = await mkdtemp(join(tmpdir(), `encode-${incidentId}-`));
  const cloneUrl =
    repo.url || `https://github.com/${repo.owner}/${repo.name}.git`;

  const git = simpleGit({ baseDir: workDir, config: authConfig() });

  await git.clone(cloneUrl, workDir, [
    '--depth', '1',
    ...(repo.branch ? ['--branch', repo.branch] : []),
  ]);

  // New branch for the fix, cut from the default branch tip. The auth
  // config is reattached because the push in routes/incidents.js runs
  // against this same clone and needs credentials too.
  const localGit = simpleGit({ baseDir: workDir, config: authConfig() });
  await localGit.checkoutLocalBranch(`encode/fix-${incidentId}`);

  return workDir;
}

/** A simple-git handle on an existing clone, carrying push credentials. */
export function repoGit(workDir) {
  return simpleGit({ baseDir: workDir, config: authConfig() });
}

/**
 * The commit the fix branch was cut from. Captured before the Coding Agent
 * runs so verification can re-run the repro command against the unpatched
 * tree — without a baseline, "the repro passes now" proves nothing.
 */
export async function getHeadCommit(workDir) {
  const git = simpleGit({ baseDir: workDir });
  return (await git.revparse(['HEAD'])).trim();
}

/**
 * Shallow file tree (paths only, depth-limited) for the Incident Agent's
 * context — deliberately not a full recursive dump, to keep the triage
 * prompt (and its cost) bounded regardless of repo size.
 */
export async function getRepoTree(workDir, { maxDepth = 3, maxEntries = 400 } = {}) {
  const ignore = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);
  const lines = [];

  async function walk(dir, prefix, depth) {
    if (lines.length >= maxEntries || depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (lines.length >= maxEntries) return;
      if (ignore.has(entry.name)) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      lines.push(entry.isDirectory() ? `${relPath}/` : relPath);
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relPath, depth + 1);
      }
    }
  }

  await walk(workDir, '', 0);
  return lines.join('\n');
}

/** Called once an incident is resolved or failed — no reason to keep the clone around. */
export async function cleanupRepo(workDir) {
  if (!workDir) return;
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
