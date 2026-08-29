/**
 * Environment loading
 * -------------------
 * `dotenv` does NOT override variables already present in the process
 * environment. That's the right default for most apps and the wrong one
 * here: a developer machine with an ambient `ANTHROPIC_BASE_URL` (very
 * likely, since Claude Code itself sets one) silently wins over the `.env`
 * this project told you to fill in, and Encode ends up calling a completely
 * different endpoint than the file says.
 *
 * That cost real debugging time — a 403 from an endpoint that wasn't in any
 * config file. So `.env` wins, and anything it overrode is logged, because
 * a silent override is how you end up debugging the wrong endpoint.
 *
 * Import this once, first, instead of `dotenv/config`.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

const NOISY_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'LLM_PROVIDER'];

function ambientKeys(envPath) {
  try {
    const parsed = dotenv.parse(readFileSync(envPath));
    return Object.keys(parsed).filter((key) => process.env[key] && process.env[key] !== parsed[key]);
  } catch {
    return [];
  }
}

const envPath = resolve(process.cwd(), '.env');
const overridden = ambientKeys(envPath);

dotenv.config({ path: envPath, override: true });

if (overridden.length > 0) {
  console.warn(`[env] .env overrode ambient values for: ${overridden.join(', ')}`);
  for (const key of overridden.filter((k) => NOISY_KEYS.includes(k))) {
    // Values of the non-secret ones are worth showing — the whole point is
    // to make "which endpoint am I actually calling" impossible to get wrong.
    if (key.includes('KEY')) continue;
    console.warn(`[env]   ${key} → ${process.env[key]}`);
  }
}
