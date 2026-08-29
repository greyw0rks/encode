# Encode

Automated incident diagnosis and fix agent. Pay per resolved incident, settled in stablecoins over x402 on Celo. No retainer, no subscription.

Built for the Celo **Agents at Work Hackathon** — targeting **Track 1 (Value Moved)**, with `AskBots` (Track 3) and `Buy` beta feedback (Track 5) as secondary.

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
| Triage | $1.50 | Root cause + severity, no patch |
| Fix & PR | $8.00 | Triage + tested patch + opened PR |

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

Register with Celo before your first real settlement:

```bash
npx skills add https://celobuilders.xyz
# then ask your agent: "Help me register for the Agents at Work Hackathon"
```

This gets you `ERC8021_ATTRIBUTION_TAG` and an `ERC8004_AGENT_ID` for `.env` — every settled transaction needs the tag or it doesn't count on the leaderboard.

## Track 1 fit — what counts, what doesn't

- Payer wallet must be **independent**: not one you registered, not first-funded by you, with Celo activity from before Aug 28. `req.payer` is captured at payment-verification time specifically so this can be audited.
- Volume is **signer-gated**. `GET /v1/dashboard` surfaces `uniqueSigners` at equal weight to `totalValueProcessed` for this reason — a handful of wallets moving a lot doesn't place.
- Distribution beats a general-purpose pitch: point this at a Discord/Telegram of real Celo builders who'd actually pay to have their incidents triaged, rather than a demo-only flow.

## Not built yet (explicitly out of scope for v1)

- Persistent storage (currently in-memory; swap `src/store/incidentStore.js` for Postgres before this needs to survive a restart)
- Escrow-style settlement (v1 is pay-then-deliver; a dispute-adjudication variant is a natural v2 if that's ever needed)
- Private repo support beyond a bearer-token auth header (no GitHub App / fine-grained install token flow yet)
