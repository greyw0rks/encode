import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { celoscanTx, getDashboard, getIncident, getStatus, shortHash, type Incident } from '@/lib/api';
import { Eyebrow, Note, Panel, SectionHead, TextLink, Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Timeline } from '@/components/Timeline';
import { StatusColumn } from '@/components/StatusColumn';
import { C, Lede, P, Table } from '@/components/prose';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const incident = await getIncident(id);

  return {
    title: incident.ok ? `Incident ${id}` : 'Incident',
    description: incident.ok
      ? `Settlement and verification record for incident ${id}.`
      : 'Settlement and verification record for a single Encode incident.',
    // A per-incident page has no business in search results — it's a record
    // someone follows a link to, not a page to be discovered.
    robots: { index: false, follow: false },
  };
}

/**
 * The public record of one incident.
 *
 * Deliberately narrower than what the API returns. `GET /v1/incidents/:id`
 * responds with the payer's full view — including `diagnosis.probableCause` and
 * `repairPlan`, which the payer bought — and the ledger publishes incident ids.
 * Rendering those fields here would turn "readable by whoever holds the id"
 * into "published", so this page shows settlement and verification facts only,
 * matching the boundary `ledgerRow()` draws on the API side.
 */
export default async function IncidentPage({ params }: Params) {
  const { id } = await params;
  const [incident, dashboard, status] = await Promise.all([getIncident(id), getDashboard(), getStatus()]);

  // Only a definite 404 is a missing incident. An unreachable API is a
  // different failure and must not be rendered as "no such incident".
  if (!incident.ok && incident.reason.includes('404')) notFound();

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
        !incident.ok ? (
          <Panel>
            <SectionHead title="This record can't be read right now." eyebrow="unavailable" />
            <P>{incident.reason}. Nothing is asserted about this incident either way.</P>
            <Note>
              <TextLink href="/ledger">Back to the ledger</TextLink>
            </Note>
          </Panel>
        ) : (
          <IncidentRecord incident={incident.data} />
        )
      }
    />
  );
}

function IncidentRecord({ incident }: { incident: Incident }) {
  const { settlement, verification } = incident;

  return (
    <>
      <Panel>
        <Eyebrow>incident · {incident.id}</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-normal leading-[1.15] tracking-[-0.01em]">
          {incident.summary}
        </h1>
        <div className="mt-3">
          <Lede>
            <StatusSentence incident={incident} />
          </Lede>
        </div>
      </Panel>

      <Panel>
        <SectionHead title="Settlement." eyebrow="payment" />
        {settlement ? (
          <Table
            rows={[
              [
                'Transaction',
                <TextLink key="tx" href={celoscanTx(settlement.txHash)} external>
                  {shortHash(settlement.txHash, 10, 8)} ↗
                </TextLink>,
              ],
              ['Amount', `$${Number(settlement.amount).toFixed(2)} ${settlement.asset}`],
              ['Payer', <C key="p">{shortHash(incident.payer, 6, 6)}</C>],
              ['Network', settlement.network],
              [
                'Counted as traction',
                settlement.selfFunded
                  ? 'No — self-funded. Encode signed this to its own payout address, so it is excluded from signer and volume counts.'
                  : 'Yes — an independent signer.',
              ],
            ]}
          />
        ) : (
          <P>No settlement is recorded against this incident.</P>
        )}
      </Panel>

      <Panel>
        <SectionHead title="Verification." eyebrow="what was proven" />
        {verification ? (
          <>
            <Table
              rows={[
                ['Depth', <C key="d">{verification.verificationDepth}</C>],
                [
                  'Your suite',
                  verification.testsPassed === null
                    ? 'Not established.'
                    : verification.testsPassed
                      ? 'Passed against the patch.'
                      : 'Failed. Reported as failing, not rounded up.',
                ],
                [
                  'Original failure',
                  verification.originalFailureResolved === null
                    ? 'Unknown — never collapsed into "resolved" to make the run look successful.'
                    : verification.originalFailureResolved
                      ? 'Reproduced before the patch, and no longer reproduces after it.'
                      : 'Still reproduces. Not resolved.',
                ],
                ...(verification.reproCommand
                  ? [['Repro command', <C key="r">{verification.reproCommand}</C>] as [string, React.ReactNode]]
                  : []),
              ]}
            />
            {verification.notes ? <Note>{verification.notes}</Note> : null}
          </>
        ) : (
          <NoVerification incident={incident} />
        )}
      </Panel>

      {incident.pr ? (
        <Panel>
          <SectionHead title="The pull request." eyebrow="deliverable" />
          <P>
            Encode&apos;s terminal action is always &ldquo;PR opened&rdquo;. It cannot merge and cannot deploy — a
            human reviews this.
          </P>
          <Note>
            <TextLink href={incident.pr.url} external>
              {incident.pr.url} ↗
            </TextLink>
          </Note>
        </Panel>
      ) : null}

      <Panel>
        <SectionHead title="What isn't shown here." eyebrow="scope" />
        <P>
          The diagnosis and repair plan are the deliverable the payer bought, so they aren&apos;t published on this
          page — only the settlement and what verification established. The payer polls{' '}
          <C>GET /v1/incidents/{incident.id}</C> for the full record.
        </P>
        <Note>
          <TextLink href="/ledger">Back to the ledger</TextLink>
        </Note>
      </Panel>
    </>
  );
}

/**
 * Absent verification means two different things and they must not read alike:
 * at the `triage` tier there was never anything to verify, whereas a `fix` with
 * no record is a run that never got that far — which, since payment settled
 * first, is a debt.
 */
function NoVerification({ incident }: { incident: Incident }) {
  // Checked before the tier, because a recovered row has no tier to read: the
  // record that would have said which one was bought is the thing that was
  // lost, and inferring "fix" from a $0.50 settlement would be a guess.
  if (incident.status === 'recovered') {
    return (
      <P>
        No verification record, and none is claimed. The incident record behind this settlement did not survive an
        earlier deployment, so there is no tier, no diagnosis and nothing that says what the payer received. The
        payment itself is the only surviving fact about it.
      </P>
    );
  }

  if (incident.tier === 'triage') {
    return (
      <P>
        No verification record. At the <C>triage</C> tier nothing is patched, so there is nothing to verify.
      </P>
    );
  }

  return (
    <P>
      No verification record. This was paid for at the <C>fix</C> tier, so the run never reached verification —
      nothing was proven about the reported failure either way.
    </P>
  );
}

/** One sentence that doesn't overstate a settled-but-undelivered run. */
function StatusSentence({ incident }: { incident: Incident }) {
  switch (incident.status) {
    case 'resolved':
      return (
        <>
          Resolved at the <C>{incident.tier}</C> tier.{' '}
          {incident.verification?.verificationDepth === 'repro-confirmed'
            ? 'The reported failure was reproduced before the patch and no longer reproduces after it.'
            : 'Verified by test suite — the original failure was not independently proven gone.'}
        </>
      );
    case 'interrupted':
      return (
        <>
          Paid for and never delivered. The run was cut short by a restart, so this is money owed rather than work
          done. There is no automatic refund path.
        </>
      );
    case 'failed':
      return (
        <>
          Paid for and produced no fix. {incident.error ? <C>{incident.error}</C> : null} Payment is taken up front,
          so this is a refund owed.
        </>
      );
    case 'recovered':
      return (
        <>
          Paid, and settled on Celo — but the incident record behind this payment did not survive an earlier
          deployment, so nothing is claimed about what was delivered. The transaction is real and checkable by
          anyone; the outcome is unknown, and this is counted as neither resolved nor unpaid.
        </>
      );
    default:
      return (
        <>
          In progress at the <C>{incident.tier}</C> tier — currently <C>{incident.status}</C>.
        </>
      );
  }
}
