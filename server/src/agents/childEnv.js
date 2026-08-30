/**
 * Environment scrubbing for child processes.
 *
 * The Coding Agent runs model-chosen commands, and `verify.js` runs the
 * target repo's own test suite and install scripts. `execFile` inherits the
 * parent environment by default, which means a `package.json` test script in
 * a repo Encode was paid to fix could read `process.env` and walk off with
 * `X402_API_KEY` (spends Encode's settlement credits), `GITHUB_TOKEN` (write
 * access to repos), and the LLM key.
 *
 * The bash whitelist doesn't help here: `npm test` is the whole point of the
 * product, and what it executes is the target repo's choice. So the fix is
 * at the boundary — child processes get a deliberately minimal environment
 * and never see Encode's secrets.
 */

/**
 * Variables a build or test run legitimately needs. Everything else is
 * dropped rather than denied by name, so a credential added to Encode's
 * config later is excluded by default instead of leaking on the next deploy.
 */
const PASSTHROUGH = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'SHELL', 'USER', 'TMPDIR'];

export function childEnv(extra = {}) {
  const env = {};
  for (const key of PASSTHROUGH) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  // Node projects assume these exist; absent HOME/npm cache paths, npm
  // writes to unexpected places or fails outright.
  env.NODE_ENV = 'test';
  env.CI = 'true';
  // Nothing Encode runs should be prompting for input.
  env.npm_config_yes = 'true';

  return { ...env, ...extra };
}
