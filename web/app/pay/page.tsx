import type { Metadata } from 'next';
import { getDashboard, getStatus } from '@/lib/api';
import { Note, Panel, SectionHead, TextLink, Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Timeline } from '@/components/Timeline';
import { StatusColumn } from '@/components/StatusColumn';
import { PageHeader } from '@/components/PageHeader';
import { DocsSection } from '@/components/DocsSection';
import { Code } from '@/components/Code';
import { C, Callout, H3, LI, Lede, P, Step, Table, UL } from '@/components/prose';
import { AGENT, API_URL, CELO_CHAIN_ID, PROOF, TIERS, USDC } from '@/lib/facts';

export const metadata: Metadata = {
  title: 'Paying Encode',
  description:
    'The payer’s walkthrough: what you need, what you sign, what the guards do, and what each refusal means. You are signing an EIP-3009 authorization, not sending a transaction.',
};

const [triage, fix] = TIERS;

/*
 * The quote output is interpolated from `lib/facts` rather than transcribed, so
 * the address a reader is told to check against can't drift from the one the
 * rest of the site publishes. Same for the API URL: every command on this page
 * is meant to be copy-pasteable, and a command pointing at a host that no
 * longer answers is worse than no command at all.
 */
const QUOTE_OUTPUT = `
[[r|402 Payment Required]]
  Price:      [[v|${fix.price} USDC]]
  Base units: [[v|${fix.baseUnits}]]
  Asset:      [[v|${USDC.address}]]
  Pay to:     [[v|${AGENT.payTo}]]
  Network:    [[v|celo]]
  EIP-712:    [[v|USDC v${USDC.eip712Version} on chain ${CELO_CHAIN_ID}]]
`;

const PAY_COMMAND = `
[[k|PAYER_PRIVATE_KEY]]=0x... npm run pay -- \\
  --url ${API_URL}/v1/incidents \\
  --repo you/your-app \\
  --summary [[v|"Nightly export job emits duplicate rows"]] \\
  --logs [[v|"export.job: collected 27 records, 25 exist; dupes r10, r19"]] \\
  --tier fix \\
  --max-usd 1 \\
  --pay
`;

/**
 * Per-request, not prerendered — see the note in `app/page.tsx`. It matters more
 * here than anywhere: this page tells a payer to check the quoted `payTo`
 * against a live reading of `/v1/status`, and a build-time snapshot of that
 * would defeat the check.
 */
export const dynamic = 'force-dynamic';

export default async function PayPage() {
  const [dashboard, status] = await Promise.all([getDashboard(), getStatus()]);
  const payTo = status.ok ? status.data.payment.payTo : null;

  return (
    <Workspace
      left={
        <>
          <SideNav current="pay" />
          <Timeline dashboard={dashboard} />
        </>
      }
      right={<StatusColumn status={status} dashboard={dashboard} />}
      main={
        <>
          <PageHeader eyebrow="the payer's walkthrough" title="You have a wallet. You have a repo with a bug.">
            <Lede>
              This is how those meet. Nothing here is theoretical — every command below has been run, and where a
              step hasn&apos;t been exercised end to end, it says so.
            </Lede>
          </PageHeader>

          <Panel>
            <SectionHead title="What you're agreeing to." eyebrow="terms" />
            <Table
              head={['Tier', 'You get']}
              rows={[
                [
                  <span key="t">
                    <C>{triage.id}</C> · {triage.price}
                  </span>,
                  'Root cause, severity, affected files, and a repro command. No patch, nothing written to your repo.',
                ],
                [
                  <span key="f">
                    <C>{fix.id}</C> · {fix.price}
                  </span>,
                  'Triage, plus a patch with your tests run against it, plus an opened PR.',
                ],
              ]}
            />
            <P>
              Payment settles <em>before</em> the work runs. Encode&apos;s terminal action is always &ldquo;PR
              opened&rdquo; — it never merges and never deploys. You review.
            </P>

            <H3>Two honest caveats before you spend anything</H3>
            <UL>
              <LI>
                <b className="font-semibold text-ink-2">Encode fixes repositories, not running websites.</b> It needs
                a GitHub repo it can clone, a test suite, and ideally a command that reproduces the bug. If your site
                is broken but the cause isn&apos;t in a repo Encode can read, it will diagnose from your description
                and logs alone — much weaker.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">
                  <C>fix</C> opens a PR. It never merges and never deploys.
                </b>{' '}
                Where Encode&apos;s token has no push access to your repo, Encode forks the repo into its own
                account, pushes the branch there and opens a cross-repo PR back into yours — no collaborator grant,
                nothing asked of you. A private repo cannot be forked, so there <C>fix</C> needs write access and is
                refused up front without it.
              </LI>
            </UL>
          </Panel>

          <Panel>
            <SectionHead title="What you need." eyebrow="prerequisites" />
            <UL>
              <LI>
                <b className="font-semibold text-ink-2">A Celo wallet with USDC.</b> Mainnet. {triage.price} for
                triage, {fix.price} for a fix, plus nothing for gas.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">No CELO required.</b> You are signing an authorization, not
                sending a transaction. This surprises people; it&apos;s the point of EIP-3009, and the facilitator
                pays the gas.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">A public GitHub repo</b> with a bug and a test suite.
              </LI>
            </UL>
            <Note>
              USDC on Celo mainnet is <C>{USDC.address}</C> — {USDC.decimals} decimals, so {fix.price} is{' '}
              <C>{fix.baseUnits}</C> base units. The trailing zero is load-bearing at sub-dollar prices.
            </Note>
          </Panel>

          <Panel>
            <SectionHead title="Four steps." eyebrow="walkthrough" />

            <div className="mt-5">
              <Step n={1} title="See the price, pay nothing" />
              <P>Prints the quote and stops. Safe to run against production; it signs nothing.</P>
              <Code>{`[[k|cd]] server\nnpm run pay -- --url ${API_URL}/v1/incidents --tier fix`}</Code>
              <Code>{QUOTE_OUTPUT}</Code>
              <Callout tone="warn">
                Check <C>Pay to</C> against the address Encode publishes:{' '}
                <C>{payTo ?? AGENT.payTo}</C>. If it doesn&apos;t match, stop.
                {payTo && payTo.toLowerCase() !== AGENT.payTo.toLowerCase() ? (
                  <>
                    {' '}
                    <b className="font-semibold">
                      The live API is currently quoting a different address than this page has on file — trust neither
                      until that&apos;s explained.
                    </b>
                  </>
                ) : null}
              </Callout>

              <Step n={2} title="Describe the incident properly" />
              <P>
                This is where a paid run succeeds or wastes your money. Encode&apos;s diagnosis is only as good as
                the signal you give it. Include, if you have them:
              </P>
              <UL>
                <LI>
                  <b className="font-semibold text-ink-2">What broke, concretely.</b> &ldquo;Nightly export emits
                  duplicate rows&rdquo; beats &ldquo;the export is broken.&rdquo;
                </LI>
                <LI>
                  <b className="font-semibold text-ink-2">A log excerpt</b> with the actual error or symptom.
                </LI>
                <LI>
                  <b className="font-semibold text-ink-2">A repro command</b> in the repo — <C>npm run repro</C>, a
                  failing test, anything that exits non-zero because of this bug and zero once it&apos;s fixed.
                </LI>
              </UL>
              <P>
                That last one matters more than it looks. Encode runs your repro against the patch <em>and</em>{' '}
                against the pre-patch commit. Fails before, passes after, and you get{' '}
                <C>verificationDepth: repro-confirmed</C> — proof the reported failure is actually gone. Without a
                repro, verification falls back to &ldquo;your test suite passes,&rdquo; which is weaker and reported
                as such.
              </P>

              <Step n={3} title="Pay" />
              <Code>{PAY_COMMAND}</Code>
              <Callout tone="warn">
                <C>--pay</C> moves real money. Always pass <C>--max-usd</C>: without it, a compromised or buggy
                server could quote any amount and the client would sign it. With it, the client refuses. Use a wallet
                funded with roughly what the job costs — not your main wallet.
              </Callout>
              <P>
                What you sign is an EIP-3009 <C>TransferWithAuthorization</C>: permission for <b>one</b> pull, of{' '}
                <b>one</b> amount, expiring in 10 minutes. It&apos;s single-use — the nonce is random and spent
                nonces are recorded on-chain, so an authorization that&apos;s never submitted becomes worthless
                rather than lingering.
              </P>

              <Step n={4} title="Watch it work" />
              <Code>{`curl ${API_URL}/v1/incidents/inc_8Kd2mQ… | jq`}</Code>
              <P>
                Status moves <C>detected → diagnosing → fix_drafted → resolved</C> (or <C>failed</C>). Read these
                fields when it lands:
              </P>
              <Table
                rows={[
                  [<C key="a">diagnosis.probableCause</C>, 'What Encode thinks broke, alongside its confidence.'],
                  [
                    <C key="b">verification.verificationDepth</C>,
                    <>
                      <C>repro-confirmed</C> is the strong result. <C>tests-only</C> means your suite passed but the
                      original failure was never proven gone.
                    </>,
                  ],
                  [<C key="c">verification.notes</C>, 'Why verification came up short, if it did.'],
                  [<C key="d">pr.url</C>, 'The pull request.'],
                ]}
              />
            </div>
          </Panel>

          <DocsSection />

          <Panel>
            <SectionHead title="If payment is refused." eyebrow="errors" />
            <P>
              <C>fault</C> exists so you can tell &ldquo;your payment is bad&rdquo; from &ldquo;Encode is
              broken.&rdquo; Only the second is worth retrying later.
            </P>
            <Table
              head={['Response', 'Meaning']}
              rows={[
                [<C key="a">insufficient_funds</C>, "The signing wallet doesn't hold enough USDC."],
                [
                  <C key="b">invalid_signature</C>,
                  <>
                    The EIP-712 domain is wrong. USDC is version <C>2</C>; USDT is version <C>1</C>, and exposes no{' '}
                    <C>version()</C> getter to discover it from.
                  </>,
                ],
                [
                  <span key="c">
                    <C>settlement_failed</C>, <C>fault: server</C>
                  </span>,
                  "Encode's problem — its API key or settlement credits. You have not paid.",
                ],
                [
                  <span key="d">
                    <C>settlement_failed</C>, <C>fault: client</C>
                  </span>,
                  'Your authorization was rejected on-chain.',
                ],
                [
                  <C key="e">payment_not_configured</C>,
                  "Encode is refusing to quote rather than take a payment it can't settle.",
                ],
              ]}
            />

            <H3>Verify Encode is real before paying it</H3>
            <Code>{`curl ${API_URL}/v1/status | jq [[v|'{canTakeRealPayments, blockers}']]`}</Code>
            <P>
              <C>canTakeRealPayments: false</C> means Encode itself knows it can&apos;t complete a settlement, and{' '}
              <C>blockers</C> says why. Don&apos;t pay a server that reports that — the right column of this page
              reads the same endpoint live.
            </P>
          </Panel>

          <Panel>
            <SectionHead title="Paying yourself doesn't prove anything." eyebrow="self-funding" />
            <P>
              If you sign with Encode&apos;s own payout address, the settlement is real on-chain and worth nothing as
              evidence — it&apos;s value moving between two wallets one party controls. Encode detects this, logs it,
              and records <C>settlement.selfFunded: true</C>. Those payments are excluded from <C>uniqueSigners</C>{' '}
              and <C>totalValueProcessed</C> and reported separately.
            </P>
            <P>
              This is deliberate. A dashboard that counted them would be lying. To test the full payment path with
              your own money, use a <em>different</em> wallet than Encode&apos;s payout address.
            </P>
            <Note>
              Full source walkthrough:{' '}
              <TextLink href={PROOF.payingDoc} external>
                PAYING.md
              </TextLink>
              . The client is{' '}
              <TextLink href={PROOF.clientSource} external>
                x402Client.js
              </TextLink>{' '}
              — copy it; it has no Encode dependencies.
            </Note>
          </Panel>
        </>
      }
    />
  );
}
