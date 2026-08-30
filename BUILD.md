# BUILD.md — Setup & Run Guide

## Prerequisites

- Node.js 20+ (repo uses ESM `type: module` and top-level `fetch`)
- An API key for either real Anthropic **or** Qwen's Anthropic-compatible endpoint
- A GitHub personal access token with repo write access (only needed for `--live-pr` runs)
- An `X402_API_KEY` from the Celo x402 dashboard (only needed to actually take payment — see step 4)
- A Celo wallet, funded, with pre-existing on-chain activity (needed once you're testing real settlement)

## 1. Install

```bash
cd server
cp .env.example .env
npm install
```

Fill in `.env`. The LLM provider is inferred from `ANTHROPIC_BASE_URL`:

```
# Real Anthropic — Coding Agent uses the Claude Agent SDK
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=

# ...or Qwen — Coding Agent uses Encode's own tool loop
ANTHROPIC_API_KEY=<qwen key>
ANTHROPIC_BASE_URL=<qwen Anthropic-compatible endpoint>
LLM_MODEL_DIAGNOSIS=qwen3.7-plus
LLM_MODEL_CODING=qwen3.7-max
```

Model defaults come from the provider (`claude-haiku-4-5` / `claude-sonnet-4-6`, or `qwen3.7-plus` / `qwen3.7-max`). On DashScope the plain `qwen-plus` / `qwen-max` aliases return `400 Model not exist.` — use the versioned IDs.

`.env` **wins over ambient environment variables**, unlike stock `dotenv`. If your shell already exports `ANTHROPIC_BASE_URL` (Claude Code does), stock dotenv would silently keep it and you'd debug the wrong endpoint. `src/config/env.js` overrides and logs what it overrode.

Leave the Celo/x402 vars blank until step 4.

## 2. Confirm the logic works (no keys, no network egress beyond the facilitator)

```bash
npm test
```

Two harnesses, both offline:

- **`test:verify`** — builds a real throwaway git repo with a genuinely failing test, then checks that `verify.js` reports resolved only when it should. Includes the case that matters: a repro command that passes both before *and* after the patch must be reported as unconfirmed, not as a fix.
- **`test:loop`** — stands up a local server speaking the Anthropic `/v1/messages` shape, returns scripted tool calls, and exercises the real tool dispatch. Asserts that `git push` is refused, that path escapes are refused, and that a model which stops without calling `submit_fix` does not produce a reported fix.

```bash
npm run test:facilitator
```

Hits the **real** facilitator at `api.x402.celo.org`. Confirms `/health` and `/supported`, and sends a structurally-correct-but-worthless payload to `/verify` — the expected result is `insufficient_funds`, which proves Encode is building the right request shape. `invalid_format` would mean `facilitator.js` is wrong. It attempts no settlement and moves no money.

```bash
npm run dry
```

Clones a real public repo and runs the full state machine with the LLM calls mocked. If the clone step fails it's a network/git issue, not an LLM issue.

## 3. Confirm the LLM calls actually work

Cheapest check first — does the endpoint support Anthropic-shaped tool use at all?

```bash
node scripts/probeToolUse.js
```

Two turns: the model must emit a `tool_use` block, and must use the `tool_result` you feed back. If this fails, nothing downstream will work and the problem is the endpoint, not Encode.

Then the full pipeline:

```bash
node scripts/liveRun.js --repo yourname/your-repo --summary "describe a real bug" --logs "..." --tier fix [--keep] [--live-pr]
```

Prints the resolved provider and strategy first, then streams each tool call as it happens. Without `--live-pr` it stops after verification. Watch for:

- Does `diagnose()` return valid JSON, and does it identify a usable `reproCommand`?
- Does the Coding Agent's loop terminate with `submit_fix`?
- Does verification reach `repro-confirmed`, or only `tests-only`? `tests-only` with a note about the bash policy means the repro command was refused — check `bashPolicy.js`.

`--keep` leaves the clone on disk so a failed run can be inspected. `--live-pr` pushes and opens a real PR — only against a repo you own.

A known-good target: [`greyw0rks/encore-testbed`](https://github.com/greyw0rks/encore-testbed) contains a deliberate off-by-one with a passing test suite and a failing `npm run repro`, which is exactly the shape that exercises baseline verification.

## 4. Get paid (both steps required)

**a) Settlement API key.** Go to `https://x402.celo.org`, connect a wallet, create an API key (signs an off-chain message, no gas), and put it in `.env` as `X402_API_KEY`.

This is not optional and it fails quietly: `POST /verify` is open, so everything looks healthy without a key — right up until the first `POST /settle` returns `401` and no payment can complete. New accounts get free credits; more are bought by depositing USDC at ~$0.001 per settlement.

**b) Hackathon registration.**

```bash
npx skills add https://celobuilders.xyz
```

Then ask your agent: *"Help me register for the Agents at Work Hackathon."* You'll get an `ERC8004_AGENT_ID` and `ERC8021_ATTRIBUTION_TAG` — put both in `.env`, along with `ENCODE_WALLET_ADDRESS`.

**Do both before processing a single real payment.** Unattributed settlements don't appear on the leaderboard at all, and unsettled payments aren't payments.

Check where you stand:

```bash
npm start
curl localhost:8787/v1/status
```

`canTakeRealPayments` is `true` only when nothing is blocking; `blockers` names anything that is.

## 5. Run the API server

```bash
npm start        # or: npm run dev  (auto-restart on change)
```

Defaults to `:8787`.

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /v1/status` | LLM path, facilitator health, and what's blocking real payments |
| `GET /v1/dashboard` | ledger + `uniqueSigners` (gates every track that counts anything) |
| `POST /v1/incidents` | x402-gated; unpaid requests get a 402 quote |
| `GET /v1/incidents/:id` | incident status |

An unpaid `POST /v1/incidents` returns the quote as `accepts[]`, with **base-unit** amounts — `$0.50` is `"500000"` (USDC is 6 decimals) — plus an `eip712` block giving the exact domain to sign against.

## 6. Pay Encode (the client side)

`server/src/client/x402Client.js` is the payer's half of the flow — ~200 lines, one dependency (`ethers`), no Encode server code. A prospective payer can copy it into their own project.

```bash
# See the price without paying — safe to run against production
npm run pay -- --url https://encode.example/v1/incidents --tier fix

# Sign and submit. THIS MOVES REAL MONEY.
PAYER_PRIVATE_KEY=0x... npm run pay -- \
  --url https://encode.example/v1/incidents \
  --repo you/your-app --summary "..." --tier triage --max-usd 2 --pay
```

What a payer signs is an EIP-3009 `TransferWithAuthorization`: permission for one pull, of one amount, before an expiry. Signing costs no gas and moves nothing — the facilitator submits it on-chain and pays that gas.

Two guards, because both are ways to lose money by accident:

- `--max-usd` caps what will be signed. Without it, a compromised or buggy server could quote anything and the client would sign it.
- A second 402 after paying is **not** retried. Retrying would sign a second authorization for the same work.

```bash
npm run test:client
```

Signs with a freshly generated throwaway wallet and sends it to the **real** `/verify`. The expected result is `insufficient_funds` — which proves the facilitator recovered the signer and matched the EIP-712 domain, reaching the balance check. `invalid_signature` or `invalid_format` would mean the client signs wrong. Nothing is funded, so nothing can settle.

It also asserts the detail most likely to be got wrong: **USDC's EIP-712 domain version is `2`, USDT's is `1`**, and USDT exposes no `version()` getter to discover it from. Signing USDT under USDC's domain yields a signature that verifies against nothing. Every domain in `ASSETS` was confirmed by computing `hashDomain()` and comparing it to the token's own on-chain `DOMAIN_SEPARATOR()`.

## 7. Landing page

`landing-page.html` is a static single file — no build step. It reads `GET /v1/dashboard` and `GET /v1/status` same-origin; override with `?api=https://your-api` when serving it separately (which is the normal case, and why the API sets permissive CORS on the read endpoints).

Built to a supplied reference design: three-column workspace, bone canvas, off-white nested panels, one orange accent, Instrument Serif display. **Depth comes from surface separation and 1px hairlines — there are no drop shadows on purpose.** Adding one back is what makes it look like every other dashboard.

Two things to keep in mind when editing it:

- **Nothing on the page is invented.** Every number comes from the API and every claim in the left and right columns links to the transaction, the agent registry, or the PR that proves it. If the API is unreachable the page says so and shows `—` rather than zeros, because a zero reads as a fact.
- The reference's de-emphasised grey (`#94928A`) fails WCAG AA on these surfaces at ~2.6:1. `--faint` is `#67655E` instead, and the visual hierarchy is carried by uppercase mono and letter-spacing rather than lightness. Don't lighten it back.

## Deploy notes (not production-ready — flag before assuming otherwise)

- **Mount a volume at `/app/data`, or the store is not durable.** Incidents live in SQLite at `ENCODE_DB_PATH` (`/app/data/encode.db` in the image). On a container platform without a volume that path is erased on every redeploy, taking the record that someone paid with it. The process can't tell whether a volume is mounted, so `GET /v1/status` reports the path as durable and warns that it only survives *if* mounted — check the platform, don't trust the flag. On Railway: `railway volume add --mount-path /app/data`.
  - Two platform-specific things bit this and will bite again. Railway **rejects a Dockerfile containing `VOLUME`** outright (`docker VOLUME at Line N is not supported, use Railway Volumes`) — declare the mount on the service instead. And a mounted volume *replaces* the image's directory at runtime, arriving owned by root, so the `chown` baked into the image applies to a directory that no longer exists: a container that had already dropped to `USER encode` crashed with a bare `unable to open database file`. `docker-entrypoint.sh` starts as root, chowns only the data directory, and `exec setpriv`s to `encode` — the Node process is still never root, and it's still PID 1 so `SIGTERM` reaches the graceful-shutdown handler.
  - Because the entrypoint switches users and `setpriv` leaves `HOME` alone, the agent's git identity is in the **system** gitconfig, not a `--global` one. A `--global` config written at build time is invisible after the switch, and the Coding Agent's commit then fails on "please tell me who you are".
- `POST /v1/incidents` settles payment, returns `202`, then runs the incident. A crash mid-incident still means the payer paid and got nothing: there is **no retry and no refund path**. The record now survives it — `reconcileInterrupted()` marks orphaned runs `interrupted` at boot, and `/v1/status` reports `unfulfilledPaid` — so the debt is visible, but settling it is manual.
- **Deploy somewhere with no global git credential helper.** On a dev machine with `gh auth git-credential` configured, the incident clone can push on its own — Encode's "the model can't push" guarantee then rests only on the bash denylist, not on the absence of credentials.
- `verify.js` runs `npm install` in the baseline worktree, and the bash whitelist permits `npm run <script>`. Both execute code the target repo controls. Fine for trusted repos; not for arbitrary ones.
- `GITHUB_TOKEN` as used needs write access to whatever repos Encode patches — fine for your own, not viable for arbitrary client repos without a GitHub App / installation-token flow.
