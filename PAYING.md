# Paying Encode — a walkthrough

You have a wallet. You have a repo with a bug. This is how those meet.

Nothing here is theoretical: every command below has been run. Where a step
hasn't been exercised end to end, it says so.

## What you're actually agreeing to

Encode charges per incident, quoted before it starts:

| Tier | Price | You get |
|---|---|---|
| `triage` | $1.50 | Root cause, severity, affected files. No patch. |
| `fix` | $8.00 | Triage, plus a patch with your tests run against it, plus an opened PR. |

Payment settles **before** the work runs. Encode's terminal action is always
"PR opened" — it never merges and never deploys. You review.

Two honest caveats before you spend anything:

- **Encode fixes repositories, not running websites.** It needs a GitHub repo
  it can clone, a test suite, and ideally a command that reproduces the bug.
  If your site is broken but the cause isn't in a repo Encode can read, it
  will diagnose from your description and logs alone — much weaker.
- **`fix` needs write access to open a PR.** Today that means Encode's
  operator holds a token with access to your repo. For a repo you don't
  control that's a real trust ask, and the honest answer is: use `triage`, or
  fork, or wait for the GitHub App flow (see `todo.md`).

## What you need

1. **A Celo wallet with USDC.** Mainnet. `$1.50` for triage, `$8.00` for a
   fix, plus nothing for gas — the x402 facilitator pays the gas.
2. **No CELO required.** You are signing an authorization, not sending a
   transaction. This surprises people; it's the point of EIP-3009.
3. **A public GitHub repo** with a bug and a test suite.

USDC on Celo mainnet is `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (6
decimals — `$8.00` is `8000000` base units).

## Step 1 — see the price, pay nothing

```bash
cd server
npm run pay -- --url https://encode.example/v1/incidents --tier fix
```

Prints the quote and stops. Safe to run against production; it signs nothing.

```
402 Payment Required
  Price:      $8.00 USDC
  Base units: 8000000
  Asset:      0xcebA9300f2b948710d2653dD7B07f33A8B32118C
  Pay to:     0xc61Bbc0CF5694EF410A578A9833f77C173790450
  Network:    celo
  EIP-712:    USDC v2 on chain 42220
```

Check `Pay to` against the address Encode publishes. If it doesn't match,
stop.

## Step 2 — describe the incident properly

This is where a paid run succeeds or wastes your money. Encode's diagnosis is
only as good as the signal you give it.

Include, if you have them:

- **What broke, concretely.** "Nightly export emits duplicate rows" beats
  "the export is broken."
- **A log excerpt** with the actual error or symptom.
- **A repro command** in the repo — `npm run repro`, a failing test, anything
  that exits non-zero because of this bug and zero once it's fixed.

That last one matters more than it looks. Encode runs your repro against the
patch *and* against the pre-patch commit. If it fails before and passes after,
you get `verificationDepth: repro-confirmed` — proof the reported failure is
actually gone. Without a repro, verification falls back to "your test suite
passes," which is weaker and reported as such rather than dressed up.

## Step 3 — pay

```bash
PAYER_PRIVATE_KEY=0x... npm run pay -- \
  --url https://encode.example/v1/incidents \
  --repo you/your-app \
  --summary "Nightly export job emits duplicate rows" \
  --logs "export.job: collected 27 records, 25 exist; dupes r10, r19" \
  --tier fix \
  --max-usd 10 \
  --pay
```

**`--pay` moves real money.** Always pass `--max-usd`: without it, a
compromised or buggy server could quote any amount and the client would sign
it. With it, the client refuses.

Use a wallet funded with roughly what the job costs. Not your main wallet.

What you sign is an EIP-3009 `TransferWithAuthorization`: permission for
**one** pull, of **one** amount, expiring in 10 minutes. It's single-use — the
nonce is random and spent nonces are recorded on-chain. An authorization
that's never submitted becomes worthless rather than lingering.

You get back a job id:

```json
{ "id": "inc_8Kd2mQ…", "status": "detected", "statusUrl": "/v1/incidents/inc_8Kd2mQ…" }
```

## Step 4 — watch it work

```bash
curl https://encode.example/v1/incidents/inc_8Kd2mQ… | jq
```

Status moves `detected → diagnosing → fix_drafted → resolved` (or `failed`).
Read these fields when it lands:

- `diagnosis.probableCause` — what Encode thinks broke, and `confidence`
- `verification.verificationDepth` — `repro-confirmed` is the strong result;
  `tests-only` means your suite passed but the original failure was never
  proven gone
- `verification.notes` — why verification came up short, if it did
- `pr.url` — the pull request

If `diagnosis.isActionable` is false, Encode judged the report too thin to
act on and stopped rather than guessing. That's the intended behaviour, but
you were still charged: payment settles before diagnosis. Spend the $1.50 on
triage first if you're unsure the report is strong enough.

## What a real run looked like

[`encore-testbed#1`](https://github.com/greyw0rks/encore-testbed/pull/1) — a
genuine off-by-one in cursor pagination, where every page repeated the last
record of the previous one. Encode cloned the repo, ran the repro, found that
`start = index` made the cursor inclusive when the contract said exclusive,
changed it to `index + 1`, added two regression tests that walk page
boundaries, and opened the PR. +27/−2, `repro-confirmed`.

Payment was mocked in that run. The pipeline was not.

## Paying yourself doesn't prove anything

If you sign with Encode's own payout address, the settlement is real on-chain
and worth nothing as evidence — it's value moving between two wallets one
party controls. Encode detects this, logs it, and records
`settlement.selfFunded: true`. Those payments are excluded from
`uniqueSigners` and `totalValueProcessed` and reported separately as
`selfFundedPayments`.

This is deliberate. The hackathon rules exclude self-funded volume by rule
rather than judgement, and a dashboard that counted it would be lying. If you
want to test the full payment path with your own money, use a **different**
wallet than Encode's payout address — the numbers will then be honest, and
still won't count toward the hackathon (which requires a wallet you don't
control, with Celo history from before Aug 28).

## Doing it from your own code

`server/src/client/x402Client.js` has no Encode dependencies — copy it.

```js
import { Wallet } from 'ethers';
import { payAndRequest } from './x402Client.js';

const result = await payAndRequest({
  url: 'https://encode.example/v1/incidents',
  body: {
    summary: 'Checkout returns 500 for guest users',
    repo: { owner: 'you', name: 'your-app' },
    logsExcerpt: '...',
    tier: 'fix',
  },
  signer: new Wallet(process.env.PRIVATE_KEY),
  maxAmountUsd: 10,
});
```

It quotes, signs, and retries in one call. A second 402 after paying is never
retried — retrying would sign twice for the same job.

## If payment is refused

| Response | Meaning |
|---|---|
| `insufficient_funds` | The signing wallet doesn't hold enough USDC. |
| `invalid_signature` | The EIP-712 domain is wrong. USDC is version `2`; USDT is version `1`. |
| `settlement_failed`, `fault: server` | Encode's problem — its API key or settlement credits. You have not paid. |
| `settlement_failed`, `fault: client` | Your authorization was rejected on-chain. |
| `payment_not_configured` | Encode is refusing to quote rather than take a payment it can't settle. |

`fault` exists so you can tell "your payment is bad" from "Encode is broken."
Only the second is worth retrying later.

## Verify Encode is real before paying it

```bash
curl https://encode.example/v1/status | jq '{canTakeRealPayments, blockers, attribution}'
```

`canTakeRealPayments: false` means Encode itself knows it can't complete a
settlement, and `blockers` says why. Don't pay a server that reports that.

Encode's on-chain identity is
[ERC-8004 agent 9794](https://www.8004scan.io/agents/celo/9794) on Celo
mainnet, resolving to `agent-registration.json` in this repo.
