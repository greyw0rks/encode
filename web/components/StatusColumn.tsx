import type { ReactNode } from 'react';
import type { Dashboard, Result, Status } from '@/lib/api';
import { Dot, Eyebrow, Metric, Panel, TextLink } from './primitives';
import { CardIcon, ClockIcon, DollarIcon, ShieldIcon, WarningIcon } from './icons';
import { AGENT, FACILITATOR_HEALTH_URL } from '@/lib/facts';

/**
 * The right column: what a payer needs to check before signing anything.
 *
 * Every row here either links to the thing that proves it or is read live from
 * the API. Claims a visitor can't check don't belong in this column — that rule
 * is the whole reason it's narrow.
 */
export function StatusColumn({
  status,
  dashboard,
}: {
  status: Result<Status>;
  dashboard: Result<Dashboard>;
}) {
  const network = status.ok ? status.data.payment.network : null;
  const networkLabel = !network ? 'Celo mainnet' : network === 'mainnet' ? 'Celo mainnet' : `Celo ${network}`;
  const ready = status.ok && status.data.canTakeRealPayments;
  const stats = dashboard.ok ? dashboard.data.stats : null;
  const owed = stats?.unfulfilledPaid ?? 0;

  return (
    <Panel className="flex-1">
      <div className="flex items-center gap-[11px] border-b border-line pb-4">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink font-brand text-[0.72rem] font-extrabold text-white"
        >
          EN
        </span>
        <span>
          <span className="block text-[0.78rem] font-semibold">Encode · agent {AGENT.id}</span>
          <span className="block text-[0.72rem] text-muted">{networkLabel}</span>
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Eyebrow>Live status</Eyebrow>
        {/* Green would be a lie while anything is blocking, and the accent dot is
            the page's only status colour — so it's dimmed rather than recoloured. */}
        <Dot dim={!ready} />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Insight icon={<ClockIcon />} label="Accepting payment">
          <AcceptingPayment status={status} networkLabel={networkLabel} />
        </Insight>

        <Insight icon={<ShieldIcon />} label="Identity">
          ERC-8004{' '}
          <TextLink href={AGENT.registryUrl} external>
            agent {AGENT.id}
          </TextLink>
          , minted on Celo mainnet and resolving to a registration file in the repo.
        </Insight>

        <Insight icon={<CardIcon />} label="Settlement">
          USDC over x402 via the{' '}
          <TextLink href={FACILITATOR_HEALTH_URL} external>
            Celo facilitator
          </TextLink>
          . Payment lands before any work runs.
        </Insight>

        <Insight icon={<WarningIcon />} label="What Encode can't do">
          It can&apos;t merge and it can&apos;t deploy. The command whitelist rejects push and deploy, and the push
          step lives outside the model&apos;s control.
        </Insight>

        {owed > 0 ? (
          <Insight icon={<DollarIcon />} label="Refunds owed">
            {owed} paid incident{owed === 1 ? '' : 's'} never produced a delivered fix. Payment is taken up front,
            so {owed === 1 ? 'that is a refund' : 'those are refunds'} owed — there is no automatic refund path yet.
          </Insight>
        ) : null}
      </div>

      {/*
       * `—` rather than `0` when the API couldn't be read: a zero reads as a
       * fact, and "no settlements yet" is a different statement from "we
       * couldn't ask".
       */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Metric value={stats?.uniqueSigners ?? '—'} label="Independent signers" />
        <Metric value={stats ? `$${stats.totalValueProcessed}` : '—'} label="Settled" />
        <Metric value={stats?.resolved ?? '—'} label="Incidents resolved" />
        <Metric value={stats?.unfulfilledPaid ?? '—'} label="Paid, not delivered" flag={owed > 0} />
      </div>
    </Panel>
  );
}

function AcceptingPayment({ status, networkLabel }: { status: Result<Status>; networkLabel: string }) {
  if (!status.ok) return <>Unknown — {status.reason}.</>;

  if (status.data.canTakeRealPayments) {
    return <>Yes — quoting and settling on {networkLabel}. Settlement key and attribution are on file.</>;
  }

  return <>Not right now: {status.data.blockers[0] || 'the API reports it cannot take payments'}.</>;
}

function Insight({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-[11px]">
      <span aria-hidden className="mt-0.5 shrink-0 [&_svg]:size-[15px] [&_svg]:stroke-faint">
        {icon}
      </span>
      <div>
        <span className="mb-1 block font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-faint">
          {label}
        </span>
        <p className="text-[0.75rem] leading-[1.6] text-muted">{children}</p>
      </div>
    </div>
  );
}
