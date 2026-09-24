import type { Metadata } from 'next';
import { getDashboard, getStatus, settledRows } from '@/lib/api';
import { Metric, Note, Panel, SectionHead, TextLink, Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Timeline } from '@/components/Timeline';
import { StatusColumn } from '@/components/StatusColumn';
import { PageHeader } from '@/components/PageHeader';
import { Ledger } from '@/components/Ledger';
import { C, Lede, P } from '@/components/prose';

export const metadata: Metadata = {
  title: 'Settlement ledger',
  description:
    'Every x402 settlement paid to Encode, with the transaction on Celoscan and what verification did or did not establish for each one. Self-funded payments are excluded from the counts.',
};

/** Per-request, not prerendered — see the note in `app/page.tsx`. */
export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const [dashboard, status] = await Promise.all([getDashboard(), getStatus()]);
  const stats = dashboard.ok ? dashboard.data.stats : null;
  const settled = dashboard.ok ? settledRows(dashboard.data.recent) : [];

  return (
    <Workspace
      left={
        <>
          <SideNav current="ledger" />
          <Timeline dashboard={dashboard} />
        </>
      }
      right={<StatusColumn status={status} dashboard={dashboard} />}
      main={
        <>
          <PageHeader eyebrow="on-chain evidence" title="Every payment, settled and visible.">
            <Lede>
              Read live from <C>GET /v1/dashboard</C>. Each row links to its transaction on Celoscan, so nothing here
              rests on Encode&apos;s word for it. An empty table means no settlements yet; it never means the API
              couldn&apos;t be reached — that failure is stated in place of the numbers, because the two are
              different claims.
            </Lede>
          </PageHeader>

          <Panel>
            <SectionHead title="The numbers, and what they exclude." eyebrow="counts" />
            {/* `—` rather than `0` when the read failed: a zero reads as a fact. */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              <Metric value={stats?.settledPayments ?? '—'} label="Settlements" />
              <Metric value={stats?.uniqueSigners ?? '—'} label="Independent signers" />
              <Metric
                value={stats?.unfulfilledPaid ?? '—'}
                label="Paid, not delivered"
                flag={(stats?.unfulfilledPaid ?? 0) > 0}
              />
            </div>

            <P>
              <b className="font-semibold text-ink-2">Independent signers</b> counts distinct wallets that are not
              Encode&apos;s own payout address. A settlement Encode signs to itself is a real on-chain transaction and
              no evidence of anything, so it&apos;s recorded as <C>selfFunded</C> and excluded here — as are test and
              dry-run markers, which are filtered in the store rather than at display time.
            </P>
            <P>
              <b className="font-semibold text-ink-2">Paid, not delivered</b> is the one number that represents money
              owed rather than work done. Payment settles before the work runs, so a run cut short by a restart leaves
              a payer holding nothing. Those rows are flagged, and settling them is manual.
            </P>
            {stats ? (
              <Note>
                {stats.selfFundedPayments} self-funded and {stats.testPayments} test payment
                {stats.testPayments === 1 ? '' : 's'} are excluded from the figures above.
              </Note>
            ) : null}
          </Panel>

          <Ledger dashboard={dashboard} />

          {settled.length > 0 ? (
            <Panel>
              <SectionHead title="Reading a row." eyebrow="how to check" />
              <P>
                Follow the settlement link to Celoscan and check the recipient against the payout address Encode
                publishes on the{' '}
                <TextLink href="/pay">payment page</TextLink>. The amount on-chain is in base units — USDC has 6
                decimals, so $0.50 appears as <C>500000</C>.
              </P>
              <P>
                A row flagged <C>paid · not delivered</C> settled successfully and produced no fix. That distinction
                is the difference between a delivery and a debt, so it&apos;s stated on the row rather than left for
                you to work out.
              </P>
            </Panel>
          ) : null}
        </>
      }
    />
  );
}
