import Link from 'next/link';
import { celoscanTx, settledRows, shortHash, type Dashboard, type IncidentStatus, type LedgerRow, type Result } from '@/lib/api';
import { Note, Panel, SectionHead } from './primitives';

/**
 * Payment is taken before the work runs, so a settled row is not proof of
 * delivery. `interrupted` means the run was cut short by a restart and the payer
 * holds nothing — money owed, not work done. Saying so on the row is most of the
 * reason to publish a ledger at all.
 */
const FLAGS: Partial<Record<IncidentStatus, { owed: boolean; label: string }>> = {
  interrupted: { owed: true, label: 'paid · not delivered' },
  failed: { owed: true, label: 'paid · no fix' },
  detected: { owed: false, label: 'in progress' },
  diagnosing: { owed: false, label: 'in progress' },
  fix_drafted: { owed: false, label: 'in progress' },
};

function RowFlag({ status }: { status: IncidentStatus }) {
  const flag = FLAGS[status];
  if (!flag) return null;

  return (
    <span
      className={`ml-[7px] inline-block whitespace-nowrap rounded-full border px-[7px] py-px align-[1px] font-mono text-[0.6rem] uppercase tracking-[0.05em] ${
        flag.owed ? 'border-accent text-accent-ink' : 'border-line-2 text-muted'
      }`}
    >
      {flag.label}
    </span>
  );
}

const TH = 'border-b border-line px-4 py-[11px] text-left font-mono text-[0.63rem] font-medium uppercase tracking-[0.08em] text-faint';
const TD = 'border-b border-line px-4 py-[13px] text-muted';

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={4} className="px-4 py-[13px] font-mono text-faint">
        {children}
      </td>
    </tr>
  );
}

function Row({ row }: { row: LedgerRow }) {
  return (
    <tr>
      <td className={TD}>
        {/* The row links to the incident's own public view, which is narrower
            than the payer's — settlement facts and verification depth only. */}
        <Link href={`/incidents/${row.id}`} className="border-b border-line-2 text-ink-2 transition-colors hover:border-ink hover:text-ink">
          {row.summary}
        </Link>
        {row.prUrl ? (
          <a
            href={row.prUrl}
            target="_blank"
            rel="noopener"
            className="ml-2 border-b border-line-2 font-mono text-[0.74rem] text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            PR ↗
          </a>
        ) : null}
        <RowFlag status={row.status} />
      </td>
      <td className={`${TD} font-mono`}>{shortHash(row.payer, 4, 4)}</td>
      <td className={TD}>
        <a
          href={celoscanTx(row.txHash!)}
          target="_blank"
          rel="noopener"
          className="border-b border-line-2 font-mono text-[0.74rem] text-ink-2 transition-colors hover:border-ink hover:text-ink"
        >
          {shortHash(row.txHash)} ↗
        </a>
      </td>
      <td className={`${TD} font-mono font-semibold text-ink`}>${Number(row.amount).toFixed(2)}</td>
    </tr>
  );
}

/**
 * Explains what the rows do and don't prove. "Resolved" and "the original
 * failure was proven gone" are different claims and only the second is strong,
 * so the difference is stated rather than left to the reader to work out.
 */
function ledgerNote(rows: LedgerRow[], unfulfilled: number): string {
  const confirmed = rows.filter((row) => row.verificationDepth === 'repro-confirmed').length;

  let text =
    rows.length === 0
      ? 'When rows appear, "repro-confirmed" will mean the reported failure was reproduced before the patch and no longer reproduces after it. Verified by test suite alone counts as resolved but not confirmed.'
      : `${confirmed} of ${rows.length} settled incident${rows.length === 1 ? ' is' : 's are'} repro-confirmed — the reported failure was reproduced before the patch and no longer reproduces after it. Verified by test suite alone counts as resolved but not confirmed.`;

  if (unfulfilled > 0) {
    text += ` ${unfulfilled} row${unfulfilled === 1 ? ' is' : 's are'} flagged as paid and not delivered.`;
  }

  return text;
}

export function Ledger({ dashboard, limit }: { dashboard: Result<Dashboard>; limit?: number }) {
  const all = dashboard.ok ? settledRows(dashboard.data.recent) : [];
  const rows = limit ? all.slice(0, limit) : all;
  const unfulfilled = dashboard.ok ? dashboard.data.stats.unfulfilledPaid : 0;

  return (
    <Panel id="ledger">
      <SectionHead title="Every payment, settled and visible." eyebrow="on-chain ledger" />

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[0.79rem]">
            <caption className="sr-only">Settled x402 payments to Encode</caption>
            <thead>
              <tr>
                <th className={TH}>Incident</th>
                <th className={TH}>Payer</th>
                <th className={TH}>Settlement</th>
                <th className={TH}>Amount</th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child_td]:border-b-0">
              {!dashboard.ok ? (
                <Empty>Ledger unavailable — {dashboard.reason}.</Empty>
              ) : rows.length === 0 ? (
                <Empty>No settlements yet — this fills in as real payments land.</Empty>
              ) : (
                rows.map((row) => <Row key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nothing is asserted about the rows when they couldn't be read. */}
      {dashboard.ok ? <Note>{ledgerNote(all, unfulfilled)}</Note> : null}
    </Panel>
  );
}
