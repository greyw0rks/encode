# Encode

Automated incident diagnosis and fix agent. Pay per resolved incident, settled in stablecoins over x402 on Celo. Built for the Celo **Agents at Work Hackathon** (primary track: Real World Adoption; secondary: Value Moved), submissions close **Sept 21, 09:00 UTC**.

**Want to pay Encode to fix something? Start with [`PAYING.md`](PAYING.md).**

Read these in order before touching code:

1. **`PROJECT.md`** — mission, what "done" looks like, hackathon scoring rules that constrain the design
2. **`AGENTS.md`** — hard rules for anyone (human or agent) working in this repo, plus verified facts about the x402 facilitator. Read before writing code, not after.
3. **`BUILD.md`** — environment setup, how to run the test harnesses, deploy notes
4. **`PAYING.md`** — the payer's walkthrough: what you need, what you're agreeing to, what refusals mean
5. **`todo.md`** — current checklist. Keep it updated as you go; it's the source of truth for what's left, not this README.

## Repo structure

```
encode/
├── README.md, PROJECT.md, AGENTS.md, BUILD.md   ← read these first
├── PAYING.md                                     ← how to actually pay Encode
├── agent-registration.json                       ← ERC-8004 registration file
├── todo.md                                       ← what's left
└── server/                                       ← the actual agent + API
    ├── .env.example
    ├── public/index.html                         ← public marketing site, served at /
    ├── package.json
    ├── scripts/
    │   ├── verifyHarness.js       ← offline: verification logic vs a real failing test
    │   ├── toolLoopHarness.js     ← offline: Coding Agent tool loop vs a scripted model
    │   ├── payClientHarness.js    ← live /verify, signs with an empty wallet
    │   ├── facilitatorHarness.js  ← live x402 API, settles nothing
    │   ├── probeToolUse.js        ← cheap check: does this endpoint do tool use at all?
    │   ├── registerAgentIdentity.js ← mints the ERC-8004 identity (real mainnet tx)
    │   ├── payDemo.js             ← what a payer runs: quote, then optionally pay
    │   ├── dryRun.js              ← full pipeline, LLM calls mocked
    │   └── liveRun.js             ← full pipeline, real LLM calls
    └── src/
        ├── index.js
        ├── agents/         (incidentAgent.js, codingAgent.js, codingAgentQwen.js, bashPolicy.js)
        ├── celo/           (facilitator.js, attribution.js, paymentConfig.js)
        ├── client/x402Client.js   ← the payer's side: signs EIP-3009 authorizations
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

**Payable.** `server/src/client/x402Client.js` is the payer's half — ~200 lines, one dependency, works against any x402 `exact` endpoint. Verified against the live facilitator with a throwaway empty wallet: it's rejected on funds, not on signature or format. `npm run pay` shows a quote without paying.

**Not yet real:**

- **The submission is published** (2026-09-17T23:04Z), as `real-world-adoption` plus a Value Moved declaration. Publishing it did not make either of the two points below less true, and it is not evidence of users: it means the entry is eligible, not that anyone has used it.
  - The deadline is **Sept 21, 09:00 UTC**, confirmed against `GET /hackathons/agents-at-work`. Every doc in this repo said Sept 14 until 2026-09-18 — that date was simply wrong, and it is worth knowing the repo asserted it confidently in four places while the live API disagreed.
- **No real users and no real settlement.** Every track that counts anything is gated on distinct independent signers, and Encode has none. The unexercised step is a signature from a wallet that actually holds USDC.
- **A crash mid-incident is not refunded.** Payment is taken up front, so a run cut short by a restart leaves the payer with nothing. The record survives now — orphaned runs are marked `interrupted` at boot and `/v1/status` reports `unfulfilledPaid` — but making the payer whole is a manual step, not a code path.

## Four things that were wrong and are worth knowing

Two found by probing the live facilitator, one only by a real run, one by reading the hackathon's own API:

1. The facilitator API is at **`api.x402.celo.org`**. `x402.celo.org` is the dashboard SPA and returns HTML for `/verify`.
2. **`POST /verify` does not move money.** It's an off-chain signature and balance check; settlement is a separate authenticated `POST /settle`. Encode previously treated verification as payment, which would have meant delivering paid work for free.
3. **`dotenv` does not override ambient environment variables.** An ambient `ANTHROPIC_BASE_URL` silently beat `.env` and produced a 403 from an endpoint that appeared in no config file. `src/config/env.js` now loads with `override: true` and logs what it overrode — import that, never `dotenv/config`.
4. **An x402 settlement can't carry an attribution tag.** The facilitator's relayer submits it, so neither Encode nor the payer controls the calldata. Settlements are attributed by the registered agent wallet instead, which makes `ENCODE_WALLET_ADDRESS` load-bearing in a way the tag isn't.

See "Facts about the facilitator" and "Verified against a real run" in `AGENTS.md` before writing anything near the payment path or the LLM config.
