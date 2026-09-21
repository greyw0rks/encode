import type { Dashboard, Result } from '@/lib/api';
import { settledRows } from '@/lib/api';
import { Dot, Panel, TextLink } from './primitives';
import { AGENT, PROOF } from '@/lib/facts';

/**
 * The left column's history panel.
 *
 * The reference has a chat history here. Encode has something better and real:
 * the things it has actually done and can be checked on. Every entry links to
 * on-chain or on-GitHub evidence — no invented activity.
 *
 * The "Open" group is the exception: it's derived from the live ledger, so it
 * can't go stale the way a hardcoded "no payer yet" would the moment one lands.
 */
export function Timeline({ dashboard }: { dashboard: Result<Dashboard> }) {
  return (
    <Panel className="flex-1">
      <Group title="August" meta="2026">
        <Entry>
          <b>Identity minted on Celo mainnet.</b> ERC-8004{' '}
          <TextLink href={AGENT.registryUrl} external>
            agent {AGENT.id}
          </TextLink>
          , resolving to a registration file in the repo.
        </Entry>
        <Entry>
          <b>First real fix, start to PR.</b> Found an off-by-one in cursor pagination, patched it, added two
          regression tests, opened{' '}
          <TextLink href={PROOF.firstPr} external>
            PR #1
          </TextLink>
          . <Meta>verified: repro-confirmed</Meta>
        </Entry>
        <Entry>
          <b>Payment path proven against the live facilitator.</b> Settlement key verified, EIP-712 domains checked
          against each token&apos;s own on-chain separator.
        </Entry>
      </Group>

      <Group title="Open" meta="now">
        <OpenState dashboard={dashboard} />
      </Group>
    </Panel>
  );
}

function OpenState({ dashboard }: { dashboard: Result<Dashboard> }) {
  if (!dashboard.ok) {
    return (
      <Entry>
        <b>Live state unknown.</b> {dashboard.reason} — so nothing here is claimed either way.
      </Entry>
    );
  }

  const { stats, recent } = dashboard.data;
  const settled = settledRows(recent);

  if (settled.length === 0) {
    return (
      <Entry>
        <b>No independent payer yet.</b> The ledger says so rather than showing zeros. It fills in from{' '}
        <Meta>GET /v1/dashboard</Meta> as real settlements land.
      </Entry>
    );
  }

  return (
    <>
      <Entry>
        <b>
          {stats.uniqueSigners} independent signer{stats.uniqueSigners === 1 ? '' : 's'}.
        </b>{' '}
        ${stats.totalValueProcessed} settled across {stats.settledPayments} payment
        {stats.settledPayments === 1 ? '' : 's'}.
      </Entry>
      {stats.unfulfilledPaid > 0 ? (
        <Entry>
          <b>
            {stats.unfulfilledPaid} paid incident{stats.unfulfilledPaid === 1 ? '' : 's'} never delivered.
          </b>{' '}
          Payment is taken up front, so that is a refund owed. There is no automatic refund path.
        </Entry>
      ) : null}
    </>
  );
}

function Group({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="[&:not(:first-child)]:mt-[22px]">
      <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
        <span className="flex items-center gap-[7px] font-mono text-[0.68rem] font-semibold uppercase tracking-[0.09em]">
          <Dot />
          {title}
        </span>
        <span className="font-mono text-[0.63rem] text-faint">{meta}</span>
      </div>
      <div className="[&>p:last-child]:border-b-0">{children}</div>
    </div>
  );
}

function Entry({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-dashed border-line py-[7px] text-[0.76rem] leading-[1.6] text-muted [&_b]:font-semibold [&_b]:text-ink-2">
      {children}
    </p>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[0.68rem] text-faint">{children}</span>;
}
