# Encode

Automated incident diagnosis and fix agent. Pay per resolved incident, settled in stablecoins over x402 on Celo. No retainer, no subscription.

Built for the Celo **Agents at Work Hackathon** — primary track **Real World Adoption**, with **Value Moved** secondary. Registered as ERC-8004 agent [9794](https://www.8004scan.io/agents/celo/9794) on Celo mainnet.

## Architecture

```
Client (dev/agent)
   │  POST /v1/incidents  (no X-Payment)
   ▼
Encode API  ──402──▶  price + payTo + facilitator
   │  POST /v1/incidents  (X-Payment: signed auth)
   ▼
x402 middleware ──verify──▶ Celo x402 facilitator ──▶ settled on-chain
   │
   ▼
Incident Agent (Haiku)  →  structured repair plan
   │
   ▼  (fix tier only)
Coding Agent (Sonnet, Claude Agent SDK)  →  patch on a branch, tests run
   │
   ▼
Verification  →  tests pass? + original failure actually gone?
   │
   ▼
GitHub PR opened  →  incident.status = resolved
```

Nothing past "PR opened" is automatic. A human merges.

## Layers, mapped to files

| Layer | File |
|---|---|
| Encode API | `src/routes/incidents.js`, `src/index.js` |
| x402 middleware | `src/middleware/x402.js` |
| Agent authentication | `src/middleware/auth.js` |
| Incident Agent | `src/agents/incidentAgent.js` |
| Coding Agent | `src/agents/codingAgent.js` |
| Verification | `src/verification/verify.js`, `src/verification/openPR.js` |
| Celo layer | `src/celo/facilitator.js`, `src/celo/attribution.js` |
| Dashboard | `src/dashboard/routes.js` |

## Pricing

| Tier | Price | Deliverable |
|---|---|---|
| Triage | $0.20 | Root cause + severity, no patch |
| Fix & PR | $0.50 | Triage + tested patch + opened PR |

Charged on **PR opened**, not merged — Encode doesn't control a human reviewer's timeline, so payment can't be gated on a step it doesn't own.

## Testing the pipeline before real payments

```bash
node scripts/dryRun.js
```
Clones a real throwaway public repo, runs the actual state machine and cleanup, but mocks the two Claude calls, test verification, and PR creation — nothing here needs API keys. Confirms the plumbing works.

```bash
node scripts/liveRun.js --repo yourname/your-repo --summary "checkout endpoint returning 500s" --logs "..." [--tier fix|triage] [--live-pr]
```
Same pipeline, but the Incident Agent and Coding Agent calls are real (needs `ANTHROPIC_API_KEY`). Without `--live-pr` it stops after verification and prints what it would have pushed — nothing touches GitHub. Only add `--live-pr` against a repo you own and are fine getting a real PR on (needs `GITHUB_TOKEN`). Payment is still skipped in both scripts; this tests the fix pipeline, not x402 settlement.

## Setup

```bash
cp .env.example .env   # fill in Anthropic key, Encode wallet, GitHub token
npm install
npm run dev
```

Registration order matters: mint the ERC-8004 identity first (`npm run register:identity`, a real Celo mainnet tx costing ~0.04 CELO), because celobuilders requires the agent ID.

```bash
npx skills add https://celobuilders.xyz
# then ask your agent: "Help me register for the Agents at Work Hackathon"
```

That returns `ERC8021_ATTRIBUTION_TAG`. **Settlements are attributed by `ENCODE_WALLET_ADDRESS`, not by the tag** — the facilitator's relayer submits the settlement transaction, so no tag can ride along on it. Register that exact address or every leaderboard reads zero.

## What counts, what doesn't

- Counterparties must be **independent**: not a wallet you registered, not first-funded by you or your dominant funder, and with Celo activity from before Aug 28. `req.payer` is captured at settlement time specifically so this can be audited.
- Everything is **signer-gated**. `GET /v1/dashboard` surfaces `uniqueSigners` at equal weight to `totalValueProcessed` for this reason — a handful of wallets moving a lot doesn't place.
- EIP-3009 authorisers and sponsored-relay signers count as users, not just gas payers. Gas paid by the facilitator's relayer is not builder contribution.
- Testnet activity counts for nothing, in every track.
- Distribution beats a general-purpose pitch: point this at a Discord/Telegram of real Celo builders with real repos, rather than a demo-only flow.

## Not built yet (explicitly out of scope for v1)

- Persistent storage (currently in-memory; swap `src/store/incidentStore.js` for Postgres before this needs to survive a restart)
- Escrow-style settlement (v1 is pay-then-deliver; a dispute-adjudication variant is a natural v2 if that's ever needed)
- Private repo support beyond a bearer-token auth header (no GitHub App / fine-grained install token flow yet)
