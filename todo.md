# tasks/todo.md

Keep this updated as work happens — check items off, add new ones as they're discovered. This is the source of truth for what's left, not the READMEs.

## Blocking — needed before this is a real submission

- [ ] **Get an `X402_API_KEY` from the dashboard at `x402.celo.org`** (connect wallet → create API key → sign an off-chain message, no gas). Without it `POST /settle` returns 401 and **no payment can complete** — `/verify` works fine without a key, so this breaks silently. `GET /v1/status` reports it as a blocker. This is the last code-side blocker.
- [ ] Register at `celobuilders.xyz` for `ERC8021_ATTRIBUTION_TAG`. Needs `projectName`, public `githubUrl`, personal `telegram` handle, `primaryTrack` (`value-moved`), `erc8004Url` (done — agent 9794) and `agentWalletAddress` (done). Only the Telegram handle and the track confirmation are missing.
- [ ] Ship a client-side snippet that signs an EIP-3009 authorization. **This is the real Track 1 blocker** — even with everything above done, a payer has no practical way to pay Encode.
- [ ] Test one real x402 payment end-to-end (needs a funded independent wallet with pre-28-Aug Celo history)

## Done

- [x] **ERC-8004 agent identity minted on Celo mainnet.** `agentId 9794`, owner `0xc61Bbc0C…0450`, tx [`0xd5e2e7e9…`](https://celoscan.io/tx/0xd5e2e7e9925d422f11c6e8d162cf49231445df579405d7e6dc9c4079c0215ca6), cost 0.037 CELO. The token's `agentURI` is `agent-registration.json` in this repo, which resolves. Re-runnable via `npm run register:identity` — simulates unless `--broadcast`, and refuses if `ERC8004_AGENT_ID` is already set.
- [x] **Encode is in git and public**: [`greyw0rks/encode`](https://github.com/greyw0rks/encode), verified 200. The rules require the repo public *at registration*, not at submission.
- [x] `ENCODE_WALLET_ADDRESS` = `0xc61Bbc0C…0450` (the Arcadia deployer — genuine pre-28-Aug Celo history, nonce 96). **This is the address x402 settlements are attributed by**, since the facilitator's relayer submits the settlement tx and no tag can ride along. It must be the `agentWalletAddress` given at registration, or every leaderboard reads zero.
- [x] **The full fix pipeline works against a real repo, end to end.** Verified 2026-08-29 on `greyw0rks/encore-testbed` (a throwaway repo with a real off-by-one in cursor pagination): real Qwen calls, real patch, real tests, real push, real PR — [encore-testbed#1](https://github.com/greyw0rks/encore-testbed/pull/1), +27/-2 across 2 files, `verificationDepth: repro-confirmed`. The Coding Agent read the code, ran the repro, fixed `start = index` → `start = index + 1`, added two regression tests that walk page boundaries, and wrote an accurate PR description. Payment was the only mocked step.
- [x] Confirmed the Qwen tool loop works against Qwen's *actual* tool-calling behaviour, not just a scripted stand-in. `scripts/probeToolUse.js` is the cheap two-turn check; run it first when an endpoint misbehaves.
- [x] Verified `facilitator.js` against the live API by probing it (`npm run test:facilitator`). Two real bugs found and fixed:
  - API host is `api.x402.celo.org`; `x402.celo.org` is the dashboard SPA and returns **HTML** for `/verify`. The old `.env.example` pointed at the wrong one.
  - `/verify` **does not move money** — it's an off-chain signature + balance check. Settlement is a separate authenticated `POST /settle`. Encode was previously treating verification as payment, i.e. it would have delivered work for free.
- [x] Implemented `originalFailureCheck` — replaced with `reproCommand` + baseline comparison in `verify.js`. The Incident Agent returns a repro command; verification runs it on the patch **and** on the pre-patch commit in a throwaway git worktree. A repro that passes on both proves nothing and is reported as unconfirmed rather than resolved.
- [x] Provider abstraction (`src/llm/provider.js`) — Anthropic or Qwen, inferred from `ANTHROPIC_BASE_URL`. Coding Agent uses the Claude Agent SDK on Anthropic and Encode's own tool loop on Qwen (the SDK's tool orchestration doesn't route through a custom base URL).
- [x] Wrote `ALLOWED_BASH_PREFIXES` (`src/agents/bashPolicy.js`) — referenced by AGENTS.md but never actually existed. Validates every segment of a chained command, rejects command substitution, denylists push/deploy.
- [x] Four harnesses, all passing: `test:verify`, `test:loop`, `test:facilitator`, and `probeToolUse.js`.
- [x] `GET /v1/status` — reports the LLM path, facilitator health, and the specific blockers preventing real payments.
- [x] Dashboard stats now exclude test/dry-run payers from `uniqueSigners` and `totalValueProcessed`, and count attributable vs unattributable separately.

### Facts that corrected the earlier plan

- **x402 settlements cannot carry an ERC-8021 tag.** The facilitator's relayer submits them, so neither Encode nor the payer controls the calldata. They're attributed by the registered agent wallet instead — which is why that address is required *at registration*, and why attribution is retroactive but invisible until it's on file. Documented in `src/celo/attribution.js`.
- The prize pool is **$5,000 in CELO** across five tracks, not $2,000 for Track 1 alone.
- ERC-8004 registration is a **real mainnet transaction** (~0.04 CELO), not a free signature, and it has to happen before celobuilders registration, which requires the agent ID.
- Testnet activity counts for nothing in every track.

### Bugs the live run caught that no offline test could

- [x] `dotenv` doesn't override ambient env vars, so an ambient `ANTHROPIC_BASE_URL` silently beat `.env` — a 403 from an endpoint in no config file. `src/config/env.js` now loads with `override: true` and logs what it overrode.
- [x] GitHub git-over-HTTPS rejects `Authorization: Bearer` with "invalid credentials"; the git transport needs `Basic`. REST API accepts Bearer, which is why this looked fine until the first clone.
- [x] `qwen-plus` / `qwen-max` return `400 Model not exist.` on the DashScope endpoint. Working IDs: `qwen3.7-plus`, `qwen3.7-max`.
- [x] The bash whitelist enumerated `npm run lint|build|typecheck` but not `npm run repro`, so `verify.js` refused the very repro command triage had identified and silently degraded to `tests-only`. `npm run` is now a permitted prefix with deploy-ish script names denied.

## Correctness gaps

- [ ] `POST /v1/incidents` settles payment, then returns `202` and runs the incident **after** responding. If the process dies mid-incident the payer has paid for nothing and there's no retry — needs either a durable job record or a refund path before this takes real money at volume.
- [ ] **The "Coding Agent can't push" guarantee currently rests on the bash denylist alone.** On a machine with a global git credential helper (this one has `gh auth git-credential`), the incident clone can push without Encode supplying a token — confirmed by probing it. Deploy Encode where no ambient helper exists, or make the clone explicitly credential-less and pass auth only at push time.
- [ ] Decide GitHub auth model for patching repos Encode doesn't own (PAT only works for your own repos — GitHub App needed for real clients)
- [ ] Swap `src/store/incidentStore.js` from in-memory to Postgres/SQLite before this needs to survive a restart. Now more urgent than it was: settlements are real money and the only record of them is in RAM.
- [ ] No rate limiting. `/v1/incidents` is payment-gated so abuse is self-limiting, but `/v1/status` and `/v1/dashboard` are open and `/v1/status` makes two upstream calls per request.
- [ ] `verify.js` runs `npm install` in the baseline worktree, and the bash whitelist permits `npm run <script>` — both execute code the target repo controls. Acceptable for repos Encode's operator trusts, not for arbitrary client repos.
- [ ] The Coding Agent's `run_bash` accepts absolute paths outside the clone (it used `ls /tmp/claude-1000` during the live run). `read_file`/`write_file` are confined; bash isn't. Worth confining the cwd or rejecting absolute paths that escape.

## Landing page

- [x] Initial marketing site built (hero, how it works, pricing, ledger, docs)
- [x] Wired the ledger to real `GET /v1/dashboard` data — mock settlement rows removed. Empty state says "no settlements yet," which is honest and currently true. Override the API origin with `?api=https://...` when the page is served separately.
- [x] Docs snippet updated to the real 402 shape (`accepts[]`, base-unit amounts, `X-PAYMENT`)
- [x] Removed the false "ERC-8004 registered" footer badge — restore it once registration actually happens
- [x] Corrected copy that claimed pay-on-verification and continuous monitoring; both were wrong (payment is up front, monitoring isn't built)
- [ ] Reskin to the new reference design (cream/paper background, serif headline, teal highlight, isometric illustration) — in progress
- [ ] "Standing watch" tier is marked "not yet live" — either build endpoint monitoring or drop the tier before submission

## Distribution (Track 1 needs real independent signers)

- [ ] Identify real Celo dev communities/Discords to offer Encode to
- [ ] Get at least a few genuinely independent wallets (pre-Aug-28 Celo history, not funded by us) to actually pay for a real incident
- [ ] Ship a client-side snippet that signs an EIP-3009 authorization — right now a payer has no easy way to actually pay Encode, which is the real distribution blocker

## Submission

- [ ] File through the `celobuilders` skill before **Sept 14, 09:00 UTC**
- [ ] Confirm repo is public and resolves (rule: two entries got disqualified last hackathon for a 404'ing repo) — note the code currently isn't in git at all
- [ ] Publish the required X/Twitter post tagging @CeloDevs + @Celo with the ERC-8004 registry link
- [ ] `greyw0rks/encore-testbed` and its PR #1 are the demo artifact — a real Encode-authored fix on a real repo. Keep both public and link them in the submission.
