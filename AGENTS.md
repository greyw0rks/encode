# AGENTS.md — Directive for anyone (or anything) working in this repo

Read this before writing code. It applies to Claude Code, to future-you, and to anyone else who touches this repo.

## Non-negotiable rules

1. **Never add deploy or auto-merge capability.** Encode's Coding Agent tools are deliberately limited to `read_file`, `write_file`, `run_bash` (whitelisted commands only — see `ALLOWED_BASH_PREFIXES` in `src/agents/bashPolicy.js`). Do not extend that whitelist to include `git push origin main`, `git push --force`, or anything deploy-adjacent. The push step in `src/routes/incidents.js` is intentionally outside the model's control — keep it that way. `scripts/toolLoopHarness.js` asserts the refusals; if you change the policy, that harness should tell you.
2. **Never fabricate x402/Celo facts.** If you don't know whether the facilitator supports something, probe it or check the docs rather than guessing. The "Facts about the facilitator" section below was established by probing, not assumption — two of Encode's original assumptions were wrong, and one of them (treating `/verify` as payment) would have meant delivering work for free.
3. **Pay-then-deliver order stays as-is unless explicitly asked to change it.** Payment settles at `POST /v1/incidents`, before diagnosis runs — and "settles" means `POST /settle` returned a transaction, not just that `/verify` said `isValid`. Don't quietly move this to an escrow/release model without discussing it; it changes the trust model of the whole product.
4. **Independent-signer integrity matters more than volume.** Don't write code, seed data, or test scripts that could look like — or actually be — self-funded wallets generating fake volume. Test settlements use `payer: '0x...TEST...'` markers precisely so they're never mistaken for real leaderboard activity; `getStats()` filters on those markers, so keep the convention.
5. **Never report a fix Encode can't stand behind.** `verify.js` returns `originalFailureResolved: null` for "unknown" and only `true` when the repro command both passes on the patch and demonstrably failed before it. Don't collapse null into true to make a run look successful — the whole product is the honesty of that field.
6. **Celo only.** No GenLayer, no other chains, no "just in case" multi-chain abstraction layers. See `PROJECT.md` for why.

## Working style for this repo

- **Plan before non-trivial changes.** Anything touching more than one file or an architectural decision (storage swap, new provider, new track) gets a short plan first, not straight to code.
- **Update `tasks/todo.md` as you go.** Mark items done, add new ones you discover. It's the single source of truth for what's left — don't let it drift from reality.
- **Verify before claiming something works.** "I wrote the code" is not "it works." Run `npm test` (the offline harnesses: verification logic + Coding Agent tool loop) after any change to the incident pipeline. Run `npm run test:facilitator` after any change near payment. Run `npm run dry` after any change to the clone/state-machine path, and `scripts/liveRun.js` before claiming an LLM-facing change works. Don't mark something done without having actually run it.
- **If something breaks, stop and re-plan** rather than pushing forward with a workaround. A hacky fix to keep momentum here tends to compound, since the payment/verification chain depends on each step being trustworthy.
- **After a correction, note the pattern** somewhere durable (a comment, this file, or a new `tasks/lessons.md` if one doesn't exist yet) so the same mistake isn't repeated across sessions.
- **Prefer the smallest correct change.** This is true generally, but especially true near the payment path (`middleware/x402.js`, `celo/facilitator.js`) and the Coding Agent's tool whitelist — those are the places where "clever" is a liability, not a virtue.

## Known rough edges (don't be surprised by these)

- LLM calls can go through either real Anthropic or Qwen's Anthropic-compatible endpoint — resolved in `src/llm/provider.js` from `ANTHROPIC_BASE_URL`. The Claude Agent SDK only works on real Anthropic (it spawns the Claude Code binary, which doesn't honour a custom base URL for tool orchestration), so on Qwen the Coding Agent uses Encode's own tool loop in `src/agents/codingAgentQwen.js`. That loop is covered by `scripts/toolLoopHarness.js` against a scripted model — but it has **never run against Qwen's actual tool-calling behaviour**. If it errors on tool schemas or loops forever, that's still the first thing to suspect.
- `POST /v1/incidents` settles the payment, returns `202`, then runs the incident *after* responding. A crash mid-incident means the payer paid and got nothing, with no retry and no refund path. Real money, in-memory record.
- **The "Coding Agent can't push" guarantee is enforced by the bash denylist, not by credential absence.** On a dev machine with a global git credential helper (`gh auth git-credential` is configured on this one), the incident clone can push without Encode supplying a token at all — verified by probing it. So `DENIED_BASH_SUBSTRINGS` is load-bearing, not belt-and-braces. On a server with no ambient helper, credentials come only from `repoGit()`'s auth header, and the guarantee is doubly held.
- Storage is in-memory (`src/store/incidentStore.js`). Settlement records are lost on restart.
- `verify.js` runs `npm install` inside the baseline git worktree, which executes the target repo's install scripts. Fine for repos the operator trusts; not fine for arbitrary client repos. Same is true of `npm test` / `npm run <script>` — the bash whitelist permits `npm run`, and what those scripts do is the target repo's choice.

## Verified against a real run (2026-08-29, `greyw0rks/encore-testbed`)

The Qwen tool loop works end to end. It read the repo, ran the repro, patched `src/pagination.js`, added two regression tests, committed, and called `submit_fix` in 13 turns. Three real bugs surfaced only under a live run:

- **`dotenv` does not override ambient env vars.** An ambient `ANTHROPIC_BASE_URL` (Claude Code sets one) silently beat `.env`, producing a 403 from an endpoint that appeared in no config file. `src/config/env.js` now loads with `override: true` and logs what it overrode. Import it, not `dotenv/config`.
- **GitHub git-over-HTTPS needs `Authorization: Basic`, not `Bearer`.** Bearer works for the REST API and fails the git transport with "invalid credentials." See `authConfig()` in `repo/clone.js`.
- **`qwen-plus` / `qwen-max` do not exist on the DashScope endpoint** — they return `400 Model not exist.` The working IDs are `qwen3.7-plus` and `qwen3.7-max`.

Also caught: the bash whitelist enumerated `npm run lint|build|typecheck` but not `npm run repro`, so `verify.js` refused to run the very repro command the Incident Agent identified, silently degrading verification to `tests-only`. `npm run` is now allowed as a prefix with deploy-ish script names denied.

## Facts about the facilitator (verified 2026-08-29 by probing it — don't re-guess these)

- The API host is **`api.x402.celo.org`** (mainnet) / `api.x402.sepolia.celo.org` (Sepolia). `x402.celo.org` is the **dashboard SPA** — it returns HTML for `/verify` and `/supported`. Pointing a resource server at it is the documented trap.
- **`POST /verify` moves no money.** It's an off-chain signature + balance/simulation check. Settlement is a separate **`POST /settle`** that requires an `X-API-Key`. Verification succeeding is not payment.
- `/verify` is open; `/settle` returns `401` without a key, `402` when credits are exhausted, `429` on the free-tier rate limit. This means an integration looks completely healthy until its first real settlement.
- Amounts on the wire are **base units, not dollars**. USDC and USDT are both 6 decimals, so `$8.00` is `"8000000"`.
- Assets settle via EIP-3009 `transferWithAuthorization`, payer → payee directly. The facilitator never takes custody; it pays gas.
- Payload shape for scheme `exact`, confirmed field-by-field because `/verify` names each missing field: `{ x402Version, scheme, network, payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } } }`.
- If `/verify` returns `invalid_format`, Encode is building the wrong request — not the client's problem. `insufficient_funds` on a fake payload means the shape is right.
- Run `npm run test:facilitator` to re-confirm all of the above against the live API. It attempts no settlement.
