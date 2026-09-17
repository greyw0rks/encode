# Encode — Project Mission

## What this is

Encode is an agent that watches a website, diagnoses real incidents, drafts a tested fix, and opens a PR — and only gets paid, per incident, for doing it. No retainer, no subscription. Payment settles in stablecoins over x402 on Celo before the work starts, and the incident is only reported resolved if verification can show the original failure is actually gone.

## Why this shape, specifically

The Celo "Agents at Work" hackathon doesn't reward agents that merely *use* AI — it rewards agents that do real work for parties who don't control each other's wallets. An SRE bot that emails you a diagnosis is a dev tool. An SRE agent that a stranger's wallet pays, on-chain, for a resolved incident is an economic actor. That distinction is the entire point of this build — every architecture decision (pay-then-deliver, PR-opened-not-merged pricing, honest verification depth) exists to make the transaction real and auditable, not a UI mockup.

## Hackathon target

Registered 2026-08-29. Agent identity: ERC-8004 **9794** on Celo mainnet. Attribution tag: **`celo_4bec1b4754cb`**. Agent wallet: `0xc61Bbc0CF5694EF410A578A9833f77C173790450`.

- **Primary: Real World Adoption.** Measured on verified users (wallets with Celo activity from before Aug 28), returning users (active on 2+ distinct days), and distinct signers/authorisers — including EIP-3009 authorisers and sponsored-relay signers, not just gas payers. Nothing in this track is about money moved.
- **Secondary: Value Moved.** Ranked on adjusted volume between independent parties, gated on distinct signers. Encode's per-incident pricing makes it a natural fit, but volume needs paying strangers, and it's the harder ask. One line at submission on what Encode demonstrates here.
- **Opportunistic: Judges' Favorite** — no extra work; it's a panel choice over what's already built.
- **Not pursuing:** AskBots CLI Growth (needs two review rounds on askbots.ai, a separate product surface) and cPay feedback (buyer-side testing of a closed beta, unrelated to what Encode does).

Why the switch from Value Moved as primary: it's ranked on volume between independent wallets, and Encode has moved $0 with no client-side way for a payer to sign yet. Real World Adoption counts users and authorisers rather than dollars, which is reachable with the same distribution work — and doesn't require pretending self-funded volume is adoption. Note the pool is **$5,000 in CELO** across five tracks, not $2,000 for one.

## What "done" looks like

Not "the code runs." Specifically:

1. A real, independent wallet (not ours, pre-existing Celo history) pays Encode for a real incident on a real repo, over x402. "Pays" means `POST /settle` returned a transaction — a verified-but-unsettled authorization is not a payment. Settlement is credited to Encode via the registered agent wallet, since a facilitator-relayed transaction can't carry the attribution tag.
2. Encode's diagnosis is correct enough that the resulting PR is mergeable, not just "technically opened."
3. The dashboard (`GET /v1/dashboard`) truthfully shows `uniqueSigners` — distinct signers gate every track that counts anything. Test and dry-run payers are excluded from it.
4. Submission is filed through the `celobuilders` skill before **Sept 21, 09:00 UTC**, with the repo public and resolving. *Done — published 2026-09-17T23:04Z.*
   - The date was wrong in this file and three others until 2026-09-18: they all said Sept 14. The live value is `submissionDeadline: "2026-09-21T09:00:00.000Z"` from `GET /hackathons/agents-at-work`. Nothing was missed, but a repo that is this careful about on-chain facts was confidently wrong about its own deadline, which is its own kind of lesson.

## Explicit non-goals

- **No GenLayer integration.** This was considered and dropped — Celo only, no dispute-adjudication layer, no cross-chain anything.
- **No auto-merge, no auto-deploy.** Encode's terminal action is always "PR opened." A human merges. This is a hard rule, not a v2 nice-to-have — see `AGENTS.md`.
- **Not optimizing for volume from wallets we control.** Farmed volume from self-funded wallets is explicitly excluded by the hackathon rules and gets audited out — don't build growth hacks around this.
- **No reporting a fix Encode can't stand behind.** `verify.js` distinguishes "the repro failed before and passes now" from "the tests happen to pass." The second is not a verified fix and isn't reported as one. Charging for work whose success can't be demonstrated is the failure mode this whole product is arguing against.
