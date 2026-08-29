# Encode

Automated incident diagnosis and fix agent. Pay per resolved incident, settled in stablecoins over x402 on Celo. Built for the Celo **Agents at Work Hackathon** (primary track: Real World Adoption; secondary: Value Moved), submissions close **Sept 14, 09:00 UTC**.

Read these in order before touching code:

1. **`PROJECT.md`** — mission, what "done" looks like, hackathon scoring rules that constrain the design
2. **`AGENTS.md`** — hard rules for anyone (human or agent) working in this repo, plus verified facts about the x402 facilitator. Read before writing code, not after.
3. **`BUILD.md`** — environment setup, how to run the test harnesses, deploy notes
4. **`todo.md`** — current checklist. Keep it updated as you go; it's the source of truth for what's left, not this README.

## Repo structure

```
encode/
├── README.md, PROJECT.md, AGENTS.md, BUILD.md   ← read these first
├── todo.md                                       ← what's left
├── landing-page.html                             ← public marketing site
└── server/                                       ← the actual agent + API
    ├── .env.example
    ├── package.json
    ├── scripts/
    │   ├── verifyHarness.js       ← offline: verification logic vs a real failing test
    │   ├── toolLoopHarness.js     ← offline: Coding Agent tool loop vs a scripted model
    │   ├── facilitatorHarness.js  ← live x402 API, settles nothing
    │   ├── probeToolUse.js        ← cheap check: does this endpoint do tool use at all?
    │   ├── dryRun.js              ← full pipeline, LLM calls mocked
    │   └── liveRun.js             ← full pipeline, real LLM calls
    └── src/
        ├── index.js
        ├── agents/         (incidentAgent.js, codingAgent.js, codingAgentQwen.js, bashPolicy.js)
        ├── celo/           (facilitator.js, attribution.js, paymentConfig.js)
        ├── config/env.js
        ├── dashboard/routes.js
        ├── llm/provider.js
        ├── middleware/     (auth.js, x402.js)
        ├── repo/clone.js
        ├── routes/incidents.js
        ├── store/incidentStore.js
        └── verification/   (verify.js, openPR.js)
```

## Current state

**The fix pipeline works end to end against a real repo.** Verified 2026-08-29 on [`greyw0rks/encore-testbed`](https://github.com/greyw0rks/encore-testbed) — a throwaway repo containing a real off-by-one in cursor pagination. Encode cloned it, diagnosed the cause, ran the repro, patched it, added two regression tests, committed, pushed, and opened [PR #1](https://github.com/greyw0rks/encore-testbed/pull/1) (+27/-2). Verification reached `repro-confirmed`: the repro command failed on the pre-patch commit and passes on the branch. Real Qwen calls throughout. Payment was the only mocked step.

**Also working, tested offline** (`cd server && npm test`):

- Coding Agent on two backends — Claude Agent SDK on real Anthropic, Encode's own tool loop on Qwen — with a bash whitelist that rejects push/deploy, chained commands, command substitution, and path escapes.
- x402 client matching the live facilitator's actual wire format (`npm run test:facilitator` re-confirms against the real API without settling anything).

**Registered.** ERC-8004 agent identity minted on Celo mainnet — [agent 9794](https://www.8004scan.io/agents/celo/9794), owner `0xc61Bbc0CF5694EF410A578A9833f77C173790450`, resolving to [`agent-registration.json`](agent-registration.json). Registered at celobuilders.xyz with attribution tag `celo_4bec1b4754cb`. `GET /v1/status` reports `canTakeRealPayments: true` with no blockers: the settlement key is in place and verified against the live facilitator.

**Not yet real:**

- **No client-side signing snippet.** The server can quote, verify and settle, but a payer has no practical way to produce an `X-PAYMENT` header — so nobody has paid Encode yet. This is the only thing in the way.
- The celobuilders submission is a **draft**. Publishing needs the X/Twitter post URL and happens before Sept 14, 09:00 UTC; drafts show on the leaderboard flagged as not eligible.
- No real users and no real settlement. Every track that counts anything is gated on distinct independent signers.
- Storage is in-memory. Settlement records don't survive a restart.

## Four things that were wrong and are worth knowing

Two found by probing the live facilitator, one only by a real run, one by reading the hackathon's own API:

1. The facilitator API is at **`api.x402.celo.org`**. `x402.celo.org` is the dashboard SPA and returns HTML for `/verify`.
2. **`POST /verify` does not move money.** It's an off-chain signature and balance check; settlement is a separate authenticated `POST /settle`. Encode previously treated verification as payment, which would have meant delivering paid work for free.
3. **`dotenv` does not override ambient environment variables.** An ambient `ANTHROPIC_BASE_URL` silently beat `.env` and produced a 403 from an endpoint that appeared in no config file. `src/config/env.js` now loads with `override: true` and logs what it overrode — import that, never `dotenv/config`.
4. **An x402 settlement can't carry an attribution tag.** The facilitator's relayer submits it, so neither Encode nor the payer controls the calldata. Settlements are attributed by the registered agent wallet instead, which makes `ENCODE_WALLET_ADDRESS` load-bearing in a way the tag isn't.

See "Facts about the facilitator" and "Verified against a real run" in `AGENTS.md` before writing anything near the payment path or the LLM config.
