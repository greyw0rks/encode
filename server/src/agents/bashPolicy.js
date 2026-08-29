/**
 * Bash command whitelist for the Coding Agent.
 *
 * HARD RULE (see AGENTS.md): do not add anything push/deploy-adjacent.
 * `git push`, `git push --force`, and anything that reaches a remote or a
 * deploy target stays out. The push step lives in routes/incidents.js,
 * deliberately outside the model's control.
 *
 * Prefix matching, not exact matching — so `npm test -- --silent` passes on
 * the `npm test` prefix. That means order/specificity matters less than
 * making sure no prefix here is a prefix of something dangerous.
 */
export const ALLOWED_BASH_PREFIXES = [
  // Inspection
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'find',
  'grep',
  'rg',
  'pwd',
  'node --version',
  'npm --version',

  // Running the project's own code — needed for repro scripts, which are
  // the whole basis of verify.js's baseline check. This is not a real
  // escalation: the agent can already write a file and have `npm test`
  // execute it, so containment here is at the process level (a scoped
  // clone, a timeout, the denylist below), not the command level.
  'node ',
  'python ',
  'python3 ',
  'go run',
  'cargo run',

  // Test / build / lint.
  //
  // `npm run <script>` is allowed generally rather than script-by-script: a
  // repro command is usually a project-specific script (`npm run repro`),
  // and whitelisting only known names meant verify.js couldn't run the very
  // command the Incident Agent identified. Deploy-ish script NAMES are
  // denied below — but be honest about what that buys: `npm test` already
  // executes whatever the repo's package.json says, so blocking
  // `npm run deploy` signals intent rather than providing containment.
  // Real containment is the scoped clone, the timeout, and the fact that
  // Encode's own push step is outside the model's reach.
  'npm test',
  'npm run',
  'npm ci',
  'npm install',
  'pnpm test',
  'pnpm run',
  'pnpm install',
  'yarn test',
  'yarn run',
  'yarn install',
  'npx jest',
  'npx vitest',
  'npx tsc',
  'npx eslint',
  'pytest',
  'python -m pytest',
  'go test',
  'cargo test',
  'make test',

  // Local git only — no remote-touching subcommands.
  'git status',
  'git diff',
  'git log',
  'git add',
  'git commit',
  'git checkout',
  'git branch',
  'git show',
  'git stash',
  'git restore',
  'git rev-parse',
];

/**
 * Denied even if some prefix above would otherwise match. Belt-and-braces
 * against a whitelist entry accidentally opening a remote-write path
 * (e.g. `git push` sneaking in behind a future `git p...` prefix).
 */
export const DENIED_BASH_SUBSTRINGS = [
  'git push',
  'git remote',
  'push --force',
  '--force-with-lease',
  'gh pr merge',
  'gh release',
  'run deploy',
  'run release',
  'run publish',
  'npm publish',
  'vercel',
  'railway',
  'fly deploy',
  'kubectl',
  'terraform apply',
  'rm -rf /',
  'curl ',
  'wget ',
];

/**
 * Command substitution can smuggle an arbitrary command past a
 * prefix check, so it's rejected outright rather than parsed.
 */
const SUBSTITUTION_PATTERNS = ['$(', '`', '<(', '>('];

/**
 * Every segment of a chained/piped command is validated independently —
 * otherwise `ls | git push` would pass on the `ls` prefix alone.
 */
function splitSegments(cmd) {
  return cmd
    .split(/\|\||&&|;|\||\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** @returns {{ allowed: boolean, reason?: string }} */
export function checkBashCommand(command) {
  const cmd = (command || '').trim();
  if (!cmd) return { allowed: false, reason: 'empty command' };

  const substitution = SUBSTITUTION_PATTERNS.find((needle) => cmd.includes(needle));
  if (substitution) {
    return { allowed: false, reason: `command substitution ("${substitution}") is not permitted` };
  }

  const denied = DENIED_BASH_SUBSTRINGS.find((needle) => cmd.includes(needle));
  if (denied) return { allowed: false, reason: `contains blocked pattern "${denied}"` };

  for (const segment of splitSegments(cmd)) {
    const matched = ALLOWED_BASH_PREFIXES.some((prefix) => segment.startsWith(prefix));
    if (!matched) {
      return { allowed: false, reason: `"${segment}" is not on the allowed command list` };
    }
  }

  return { allowed: true };
}
