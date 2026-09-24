/**
 * Recovered-settlement harness — no LLM key, no network, no payment.
 *
 * `backfillRecoveredSettlements()` writes rows into the ledger that no
 * incident record stands behind. That is a claim about money, so it gets
 * tested like one:
 *
 *   1. the settlement imports once, with the chain's facts and nothing else
 *   2. re-running it changes nothing — a redeploy must not duplicate a payment
 *   3. it counts as a real payment, and never as an outcome (not `resolved`,
 *      not `unfulfilledPaid`): the record cannot support either claim
 *   4. alongside a normal delivered incident the counts stay separable
 *   5. the dashboard projection still carries the status, so the page can flag
 *      the row instead of rendering it as work that succeeded
 *
 * The failure this exists to catch is the tempting one: filling the missing
 * fields with something plausible. A recovered row with an invented summary or
 * a `resolved` status would make the ledger look better and be a lie.
 */
process.env.ENCODE_DB_PATH = ':memory:';

let failures = 0;

function check(label, condition, detail = '') {
  const mark = condition ? '✅' : '❌';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

async function main() {
  const { backfillRecoveredSettlements, getIncident, getStats, listIncidents, createIncident, updateIncident } =
    await import('../src/store/incidentStore.js');
  const { ledgerRow } = await import('../src/routes/publicView.js');

  // Both this harness and the existing one write fixtures; a real DB would end
  // up with them in the numbers the dashboard publishes.
  if (process.env.ENCODE_DB_PATH !== ':memory:') throw new Error('harness must run against an in-memory store');

  console.log('\n[1] A recovered settlement imports with the chain’s facts and nothing else');

  const imported = backfillRecoveredSettlements();
  check('exactly one settlement imported', imported.length === 1, imported.join(', '));

  const recovered = getIncident(imported[0]);
  check('status is `recovered`, not resolved or failed', recovered.status === 'recovered', recovered.status);
  check(
    'the settlement is the on-chain one',
    recovered.settlement.txHash === '0x1db5da61df9f00233cfce3325c251e59d0604b0dc43b4d02a984b353d65714af' &&
      recovered.settlement.amount === '0.50' &&
      recovered.settlement.network === 'celo',
    `${recovered.settlement.amount} ${recovered.settlement.asset} on ${recovered.settlement.network}`
  );
  check(
    'nothing invented to fill the gaps',
    recovered.diagnosis === null &&
      recovered.patch === null &&
      recovered.pr === null &&
      recovered.verification === null &&
      recovered.tier === null,
    'diagnosis, patch, pr, verification, tier all null'
  );
  check(
    'dated when the money moved, not when it was recovered',
    recovered.createdAt === recovered.settlement.settledAt,
    recovered.createdAt
  );
  check('the loss of the record is stated on the row itself', recovered.recovered?.incidentRecordLost === true);

  console.log('\n[2] Re-running is a no-op');

  const again = backfillRecoveredSettlements();
  check('nothing imported the second time', again.length === 0);
  check(
    'still exactly one recovered row',
    listIncidents().filter((i) => i.status === 'recovered').length === 1
  );

  console.log('\n[3] Counted as a payment, never as an outcome');

  let stats = getStats();
  check('uniqueSigners counts the payer', stats.uniqueSigners === 1, String(stats.uniqueSigners));
  check('totalValueProcessed counts the money', stats.totalValueProcessed === '0.50', stats.totalValueProcessed);
  check('settledPayments counts the settlement', stats.settledPayments === 1, String(stats.settledPayments));
  check('not counted as resolved', stats.resolved === 0, String(stats.resolved));
  check('not counted as paid-and-not-delivered', stats.unfulfilledPaid === 0, String(stats.unfulfilledPaid));
  check('not counted as self-funded', stats.selfFundedPayments === 0, String(stats.selfFundedPayments));

  console.log('\n[4] Alongside a delivered incident, the two stay separable');

  const delivered = createIncident({
    summary: 'fixture',
    repo: { owner: 'fixture', name: 'fixture' },
    tier: 'triage',
    payer: '0x5C8EbD332e3B2F76ee3cf0E5d9DC7C09428aE7D3',
    settlement: { txHash: `0x${'ab'.repeat(32)}`, amount: '0.20', asset: 'USDC', network: 'celo', selfFunded: false },
    attribution: { tag: 'fixture', attributable: true },
  });
  updateIncident(delivered.id, { status: 'resolved' });

  stats = getStats();
  check('two independent signers', stats.uniqueSigners === 2, String(stats.uniqueSigners));
  check('value sums both tiers', stats.totalValueProcessed === '0.70', stats.totalValueProcessed);
  check('resolved counts only the delivered incident', stats.resolved === 1, String(stats.resolved));
  check('the recovered row did not become a debt', stats.unfulfilledPaid === 0, String(stats.unfulfilledPaid));

  console.log('\n[5] The dashboard row carries what the page needs to flag it');

  const row = ledgerRow(getIncident(imported[0]));
  check('status survives the projection', row.status === 'recovered', row.status);
  check(
    'transaction and amount survive it',
    row.txHash === recovered.settlement.txHash && row.amount === '0.50',
    `${row.txHash?.slice(0, 12)}… $${row.amount}`
  );
  check('no verification depth is claimed', row.verificationDepth === null);
  check('not attributed on the payer’s behalf', row.attributed === false);

  console.log(failures === 0 ? '\n✅ All recovered-settlement checks passed.' : `\n❌ ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness itself failed:', err);
  process.exit(1);
});
