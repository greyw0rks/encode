# Encode — Project Mission

## What this is

Encode is an agent that watches a website, diagnoses real incidents, drafts a tested fix, and opens a PR — and only gets paid, per incident, for doing it. No retainer, no subscription. Payment settles in stablecoins over x402 on Celo before the work starts, and the incident is only reported resolved if verification can show the original failure is actually gone.

## Why this shape, specifically

The Celo "Agents at Work" hackathon doesn't reward agents that merely *use* AI — it rewards agents that **move real value between independent parties**. An SRE bot that emails you a diagnosis is a dev tool. An SRE agent that a stranger's wallet pays, on-chain, for a resolved incident is an economic actor. That distinction is the entire point of this build — every architecture decision (pay-then-deliver, PR-opened-not-merged pricing, attribution tagging) exists to make the payment real and auditable, not just a UI mockup.

## Hackathon target

- **Primary: Track 1, Value Moved** ($2,000 pool). Win condition: most value moved between independent parties during Aug 28 – Sep 14. Independent means: not our wallet, not first-funded by us, has Celo activity from before Aug 28.
- **Secondary: Track 3, AskBots** (free to enter, just register + get reviewed twice) and **Track 5, "Buy" beta feedback** (only if Encode itself pays for its own inference through the Buy marketplace — not required, opportunistic).
- **Not pursuing:** Track 2 (Real World Adoption) unless a real distribution channel materializes — don't build for it speculatively.

## What "done" looks like

Not "the code runs." Specifically:

1. A real, independent wallet (not ours, pre-existing Celo history) pays Encode for a real incident on a real repo, over x402, and the settlement is tagged with our ERC-8021 attribution code so it counts on the leaderboard. "Pays" means `POST /settle` returned a transaction — a verified-but-unsettled authorization is not a payment.
2. Encode's diagnosis is correct enough that the resulting PR is mergeable, not just "technically opened."
3. The dashboard (`GET /v1/dashboard`) truthfully shows `uniqueSigners` — that's the number that decides Track 1, not `totalValueProcessed`. Test and dry-run payers are excluded from it.
4. Submission is filed through the `celobuilders` skill before Sept 14, 09:00 UTC, with the repo public and resolving.

## Explicit non-goals

- **No GenLayer integration.** This was considered and dropped — Celo only, no dispute-adjudication layer, no cross-chain anything.
- **No auto-merge, no auto-deploy.** Encode's terminal action is always "PR opened." A human merges. This is a hard rule, not a v2 nice-to-have — see `AGENTS.md`.
- **Not optimizing for volume from wallets we control.** Farmed volume from self-funded wallets is explicitly excluded by the hackathon rules and gets audited out — don't build growth hacks around this.
- **No reporting a fix Encode can't stand behind.** `verify.js` distinguishes "the repro failed before and passes now" from "the tests happen to pass." The second is not a verified fix and isn't reported as one. Charging for work whose success can't be demonstrated is the failure mode this whole product is arguing against.
