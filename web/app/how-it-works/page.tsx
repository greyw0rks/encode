import type { Metadata } from 'next';
import { getDashboard, getStatus } from '@/lib/api';
import { Panel, SectionHead, TextLink, Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Timeline } from '@/components/Timeline';
import { StatusColumn } from '@/components/StatusColumn';
import { PageHeader } from '@/components/PageHeader';
import { Pricing } from '@/components/Pricing';
import { C, Callout, H3, LI, Lede, P, Step, Table, UL } from '@/components/prose';
import { PROOF } from '@/lib/facts';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'What Encode does to a repo, in order: clone, diagnose, patch, run your tests, re-check the original failure, open a PR. And what it deliberately cannot do.',
};

/** Per-request, not prerendered — see the note in `app/page.tsx`. */
export const dynamic = 'force-dynamic';

export default async function HowItWorksPage() {
  const [dashboard, status] = await Promise.all([getDashboard(), getStatus()]);

  return (
    <Workspace
      left={
        <>
          <SideNav current="how" />
          <Timeline dashboard={dashboard} />
        </>
      }
      right={<StatusColumn status={status} dashboard={dashboard} />}
      main={
        <>
          <PageHeader eyebrow="the pipeline" title="What actually happens after you pay">
            <Lede>
              Six steps, in this order, with the honest failure mode of each one named. Nothing here is aspirational —
              the pipeline below is what ran against{' '}
              <TextLink href={PROOF.firstPr} external>
                encore-testbed#1
              </TextLink>
              .
            </Lede>
          </PageHeader>

          <Panel>
            <SectionHead title="The run, step by step." eyebrow="pipeline" />

            <div className="mt-5">
              <Step n={1} title="Payment settles" />
              <P>
                Settlement happens before any work starts, and &ldquo;settled&rdquo; means the facilitator&apos;s{' '}
                <C>POST /settle</C> returned a transaction — not merely that <C>/verify</C> said the signature was
                valid. Verification moves no money; treating it as payment would mean doing the work for free.
              </P>
              <Callout tone="warn">
                Because payment is taken up front, a crash mid-run means you paid and got nothing. There is no
                automatic refund path. What exists instead is visibility: the record is durable, interrupted runs are
                marked at boot, and they appear flagged on the ledger as <C>paid · not delivered</C>.
              </Callout>

              <Step n={2} title="The repo is cloned" />
              <P>
                Encode needs a GitHub repo it can read, a test suite, and ideally a command that reproduces the bug.
                It fixes repositories, not running websites — if your site is down but the cause isn&apos;t in a repo
                Encode can clone, it can only diagnose from your description and logs, which is much weaker.
              </P>

              <Step n={3} title="The Incident Agent diagnoses" />
              <P>
                It reads the relevant code and your log excerpt and returns a probable cause, a severity, the
                affected files, a repair plan, a confidence score, and — if it can find one — a repro command.
              </P>
              <P>
                If it judges the report too thin to act on it sets <C>isActionable: false</C> and stops rather than
                inventing a plausible-looking fix. That is the intended behaviour, and you were still charged, which
                is the argument for spending $0.20 on triage first when you&apos;re unsure your report is strong
                enough.
              </P>

              <Step n={4} title="The Coding Agent patches" />
              <P>
                Only at the <C>fix</C> tier. The agent works on a branch with three tools: read a file, write a file,
                and run a whitelisted bash command. The whitelist is the enforcement mechanism, not a formality — it
                rejects push, deploy, chained commands, command substitution, and path escapes.{' '}
                <TextLink href={PROOF.bashPolicySource} external>
                  Read the policy
                </TextLink>
                .
              </P>

              <Step n={5} title="Verification re-checks the original failure" />
              <P>
                Your suite is run against the patch. Then — and this is the part that makes the result worth
                anything — the repro command is run against the <em>unpatched</em> commit as well.
              </P>
              <Table
                head={['Verification depth', 'What it means']}
                rows={[
                  [
                    <C key="c">repro-confirmed</C>,
                    'The repro failed before the patch and passes after it. The reported failure is demonstrably gone. This is the only strong result.',
                  ],
                  [
                    <C key="t">tests-only</C>,
                    'Your suite passes, but the original failure was never proven to have existed or to be gone. Reported as such rather than dressed up.',
                  ],
                  [
                    <C key="n">originalFailureResolved: null</C>,
                    'Unknown. Never collapsed into true to make a run look successful — the honesty of this field is the product.',
                  ],
                ]}
              />

              <Step n={6} title="A PR is opened" />
              <P>
                The branch is pushed and a pull request opened with the diagnosis and what verification did and
                didn&apos;t establish. That is the terminal action. You review and you merge.
              </P>
            </div>
          </Panel>

          <Panel>
            <SectionHead title="What Encode deliberately cannot do." eyebrow="limits" />
            <UL>
              <LI>
                <b className="font-semibold text-ink-2">Merge.</b> There is no merge capability anywhere in the
                codebase, and the terminal state is always &ldquo;PR opened&rdquo;.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">Deploy.</b> Deploy-adjacent commands are denied by the bash
                policy, and the push step lives outside the model&apos;s control entirely — in the route, not in a
                tool the agent can call.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">Work on a chain other than Celo.</b> Not an abstraction gap;
                a deliberate scope decision.
              </LI>
              <LI>
                <b className="font-semibold text-ink-2">Count its own money as traction.</b> A settlement signed by
                Encode&apos;s own payout address is real on-chain and worthless as evidence, so it&apos;s recorded as{' '}
                <C>selfFunded</C> and excluded from signer and volume counts.
              </LI>
            </UL>

            <H3>Two things to know before trusting it with a repo</H3>
            <P>
              Verification runs <C>npm install</C> in a worktree and the whitelist permits <C>npm run</C>, so both
              execute code your repo controls. That&apos;s fine for a repo you trust and not fine for an arbitrary
              one.
            </P>
            <P>
              And the <C>fix</C> tier needs write access to open a PR, which today means Encode&apos;s operator holds
              a token with access to your repo. For a repo you don&apos;t control that&apos;s a real trust ask — the
              honest answer is to use triage, or fork.
            </P>
          </Panel>

          <Pricing />
        </>
      }
    />
  );
}
