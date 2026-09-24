import { nanoid } from 'nanoid';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Incident lifecycle: detected -> diagnosing -> fix_drafted -> resolved -> failed
 *                     (any non-terminal status -> interrupted, on restart)
 *                     recovered: imported from chain state, no record behind it
 *                     refunded: a paid-but-undelivered debt paid back on-chain
 *
 * Backed by SQLite, not a Map, because settlements are real money and the
 * record of them was previously only in RAM: a redeploy erased the evidence
 * that a payer had paid. `node:sqlite` is in the standard library, so this
 * costs no dependency and no separate service — the trade is that durability
 * now depends on the filesystem outliving the process, which on Railway means
 * a mounted volume. Without one this is exactly as durable as the Map was,
 * and openStore() says so out loud rather than quietly losing rows.
 *
 * The API stays synchronous. Every caller was written against a Map, and a
 * synchronous DB keeps `updateIncident` inside the incident pipeline free of
 * await points where a half-applied update could interleave.
 *
 * Shape: indexed columns for what's queried (status, payer, created_at,
 * settled), and the full record as JSON for everything else. The record is
 * wide and mostly write-once; normalising it would buy nothing at this scale.
 */

const DEFAULT_PATH = join(process.cwd(), 'data', 'encode.db');

let db = null;

function openStore() {
  if (db) return db;

  const path = process.env.ENCODE_DB_PATH || DEFAULT_PATH;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  db = new DatabaseSync(path);
  // Survive an unclean kill (SIGKILL, OOM) with the DB intact rather than
  // rolled back to whenever it was last flushed.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      status      TEXT NOT NULL,
      payer       TEXT,
      settled     INTEGER NOT NULL DEFAULT 0,
      record      TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS incidents_created_at ON incidents (created_at DESC)');

  if (path === ':memory:') {
    console.warn('[store] ENCODE_DB_PATH=:memory: — incidents will not survive this process.');
  }
  return db;
}

const parse = (row) => (row ? JSON.parse(row.record) : null);

/**
 * Where the record actually lives, for /v1/status. `durable` is deliberately
 * only "not :memory:" — whether the path is on a mounted volume is not
 * something the process can see, so this reports what it knows instead of
 * asserting a guarantee it can't check.
 */
export function storeInfo() {
  const path = process.env.ENCODE_DB_PATH || DEFAULT_PATH;
  return {
    path,
    durable: path !== ':memory:',
    note:
      path === ':memory:'
        ? 'in-memory — incident and settlement records are lost on restart'
        : 'on disk — survives a restart only if this path is on a mounted volume',
  };
}

function write(record) {
  openStore()
    .prepare(
      `INSERT INTO incidents (id, created_at, updated_at, status, payer, settled, record)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         status     = excluded.status,
         payer      = excluded.payer,
         settled    = excluded.settled,
         record     = excluded.record`
    )
    .run(
      record.id,
      record.createdAt,
      record.updatedAt,
      record.status,
      record.payer ?? null,
      record.settlement?.txHash ? 1 : 0,
      JSON.stringify(record)
    );
  return record;
}

export function createIncident({ summary, repo, logsRef, tier, payer, settlement, attribution }) {
  const now = new Date().toISOString();
  return write({
    id: `inc_${nanoid(10)}`,
    summary,
    repo,
    logsRef,
    tier, // 'triage' | 'fix'
    status: 'detected',
    payer,
    settlement, // { txHash, amount, asset, network, settledAt }
    attribution: attribution ?? null,
    diagnosis: null,
    repairPlan: null,
    baseCommit: null,
    patch: null,
    pr: null,
    verification: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function getIncident(id) {
  return parse(openStore().prepare('SELECT record FROM incidents WHERE id = ?').get(id));
}

export function updateIncident(id, patch) {
  const record = getIncident(id);
  if (!record) return null;
  return write(Object.assign(record, patch, { updatedAt: new Date().toISOString() }));
}

export function listIncidents({ limit = 50 } = {}) {
  return openStore()
    .prepare('SELECT record FROM incidents ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(parse);
}

function allIncidents() {
  return openStore().prepare('SELECT record FROM incidents').all().map(parse);
}

/**
 * A paid incident whose run was cut short by a restart. The payer has paid
 * and holds nothing, so this is a debt, not a failure — recorded under its
 * own status so it can't be read as "we tried and the fix didn't work".
 *
 * Called at boot: anything still non-terminal in the table is by definition
 * orphaned, because the only process that could have been advancing it is the
 * one that just died.
 */
export function reconcileInterrupted() {
  const inFlight = ['detected', 'diagnosing', 'fix_drafted'];
  const stale = openStore()
    .prepare(`SELECT record FROM incidents WHERE status IN (${inFlight.map(() => '?').join(',')})`)
    .all(...inFlight)
    .map(parse);

  for (const incident of stale) {
    write(
      Object.assign(incident, {
        status: 'interrupted',
        error: `interrupted_by_restart: was ${incident.status} when the process stopped`,
        updatedAt: new Date().toISOString(),
      })
    );
  }

  if (stale.length > 0) {
    const owed = stale.filter((i) => i.settlement?.txHash && !i.settlement?.selfFunded);
    console.warn(
      `[store] marked ${stale.length} interrupted incident(s) from a previous process` +
        (owed.length > 0
          ? ` — ${owed.length} of them were PAID and delivered nothing: ${owed.map((i) => i.id).join(', ')}`
          : '')
    );
  }
  return stale.map((i) => i.id);
}

/**
 * Settlements that survive only as chain state.
 *
 * These were paid to the earlier Encode deployment — `encode-api-production`,
 * the service the Vercel page used to point at. That app is gone (`Application
 * not found`) and so is its volume, so the incident records it wrote do not
 * exist anywhere: no summary, no diagnosis, no verification, and nothing that
 * says what the payer received for the money.
 *
 * The settlements themselves are still checkable by anyone, because they are
 * on Celo. So they are imported as `recovered`, a status that claims exactly
 * what the evidence supports and refuses to be read as anything else:
 *
 *   - Counted in `uniqueSigners` / `settledPayments` / `totalValueProcessed`.
 *     The USDC moved from a wallet Encode does not control, so it is a real
 *     independent payment, and dropping it would understate the one number
 *     every track is judged on.
 *   - Never counted as `resolved` — no record says the work landed.
 *   - Never counted as `unfulfilledPaid` either. "Paid, not delivered" is a
 *     debt, and a row with no record behind it cannot establish that nothing
 *     was delivered. Guessing either way would put a number on the ledger
 *     that no evidence stands behind.
 *
 * Append-only, and each entry is keyed by its transaction hash: re-running the
 * import is a no-op, so a redeploy can't duplicate a payment.
 */
const RECOVERED_SETTLEMENTS = [
  {
    // $0.50 USDC, the fix tier — the price Encode charged from 2026-08-30.
    txHash: '0x1db5da61df9f00233cfce3325c251e59d0604b0dc43b4d02a984b353d65714af',
    payer: '0x22bF1B846A91c81c24B8eD42544D6A6B749d21dF',
    amount: '0.50',
    block: 76394934,
    settledAt: '2026-09-01T20:48:12.000Z',
    summary: 'Settlement recovered from Celo — the incident record did not survive with it',
  },
];

/** Deterministic from the tx hash, so the same payment can never land twice. */
const recoveredId = (txHash) => `inc_recov_${txHash.slice(2, 10)}`;

export function backfillRecoveredSettlements() {
  const imported = [];

  for (const settlement of RECOVERED_SETTLEMENTS) {
    const id = recoveredId(settlement.txHash);
    if (getIncident(id)) continue;

    const now = new Date().toISOString();
    write({
      id,
      summary: settlement.summary,
      // Everything below is unknown rather than absent: null says "not
      // recorded", where a plausible guess would say "true" and be wrong.
      repo: null,
      logsRef: null,
      tier: null,
      status: 'recovered',
      payer: settlement.payer,
      settlement: {
        txHash: settlement.txHash,
        amount: settlement.amount,
        asset: 'USDC',
        network: 'celo',
        // Not the payout address, so not self-funded — but see the note on
        // `isIndependent`: this is a claim about who paid, nothing more.
        selfFunded: false,
        settledAt: settlement.settledAt,
      },
      attribution: null,
      diagnosis: null,
      repairPlan: null,
      baseCommit: null,
      patch: null,
      pr: null,
      verification: null,
      recovered: {
        source: 'celo',
        block: settlement.block,
        recoveredAt: now,
        incidentRecordLost: true,
      },
      // Dated when the money moved, not when it was recovered, so the ledger
      // orders by when each payment actually happened.
      createdAt: settlement.settledAt,
      updatedAt: now,
    });
    imported.push(id);
  }

  if (imported.length > 0) {
    console.warn(
      `[store] imported ${imported.length} recovered settlement(s) from Celo — ` +
        `paid, but with no surviving record of what was delivered: ${imported.join(', ')}`
    );
  }
  return imported;
}

// Test/dry-run markers are deliberately excluded rather than filtered at
// display time — see AGENTS.md on not producing numbers that could be
// mistaken for real leaderboard activity.
const isSettled = (i) => i.payer && !/TEST|DRYRUN|LIVERUN/i.test(i.payer) && i.settlement?.txHash;

// A settlement from Encode's own payout address is a real on-chain
// transaction and no evidence of anything — it's value moving between two
// wallets one party controls. Counted separately, never in uniqueSigners.
const isIndependent = (i) => isSettled(i) && !i.settlement?.selfFunded;

// Paid for, terminal, and never delivered — a debt. `refunded` is excluded:
// once the payer is made whole the debt is settled, not outstanding. A
// `recovered` row is excluded too, deliberately: no surviving record can
// establish that nothing was delivered (see backfillRecoveredSettlements).
const isUnfulfilledPaid = (i) =>
  isIndependent(i) && (i.status === 'interrupted' || i.status === 'failed') && !i.refund?.txHash;

/**
 * The payers Encode owes money: independent settlements that reached a
 * terminal non-delivery state and have not yet been refunded. This is the
 * list a refund run works from — never inferred from an address alone.
 */
export function listUnfulfilledPaid() {
  return allIncidents().filter(isUnfulfilledPaid);
}

/**
 * The subset of outstanding debts that are safe to pay back without a human
 * looking at each one: fix runs that failed specifically because Encode had no
 * verification signal to run (`refundReason === 'no_verification_signal'`), so
 * the payer got nothing Encode could stand behind. A `verification_failed`
 * debt is deliberately NOT here — Encode did run a check and the fix was shown
 * not to hold, which is a judgement call to refund, not an automatic one.
 */
export function listAutoRefundable() {
  return allIncidents().filter((i) => isUnfulfilledPaid(i) && i.refundReason === 'no_verification_signal');
}

/**
 * Record an outbound refund against an incident. Deliberately guarded rather
 * than a bare updateIncident: a refund moves real USDC, so the record must
 * refuse to (a) refund something that was never an outstanding debt, or
 * (b) refund twice. The on-chain send has already happened by the time this
 * is called — this is the durable memory of it, keyed so a re-run is a no-op.
 */
export function refundIncident(id, refund) {
  const record = getIncident(id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.refund?.txHash) return { ok: false, reason: 'already_refunded', record };
  if (!isUnfulfilledPaid(record)) return { ok: false, reason: 'not_an_outstanding_debt', record };

  return {
    ok: true,
    record: write(
      Object.assign(record, {
        status: 'refunded',
        refund: { ...refund, at: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      })
    ),
  };
}

/**
 * Dashboard aggregates. `uniqueSigners` is the number the leaderboard actually
 * judges on, so it's counted from settled payments only — a 402'd or failed
 * request never created an incident, but a test-marked payer must not
 * inflate it either.
 */
export function getStats() {
  const all = allIncidents();
  const resolved = all.filter((i) => i.status === 'resolved');
  const failed = all.filter((i) => i.status === 'failed');
  const interrupted = all.filter((i) => i.status === 'interrupted');
  const refunded = all.filter((i) => i.status === 'refunded');

  const settled = all.filter(isSettled);
  const independent = all.filter(isIndependent);
  const uniquePayers = new Set(independent.map((i) => i.payer.toLowerCase()));
  const totalValue = independent.reduce((sum, i) => sum + Number(i.settlement?.amount || 0), 0);
  const attributed = independent.filter((i) => i.attribution?.attributable);

  return {
    totalJobs: all.length,
    resolved: resolved.length,
    failed: failed.length,
    interrupted: interrupted.length,
    // Paid for, terminal, and never delivered. Surfaced because it's the one
    // number that represents money owed rather than work done. A refunded
    // row has dropped out of `failed`/`interrupted`, so it no longer counts.
    unfulfilledPaid: all.filter(isUnfulfilledPaid).length,
    // Debts that have been paid back — the counterpart to unfulfilledPaid, so
    // a run that made a payer whole is visible rather than just absent.
    refunded: refunded.length,
    uniqueSigners: uniquePayers.size,
    totalValueProcessed: totalValue.toFixed(2),
    settledPayments: independent.length,
    attributedPayments: attributed.length,
    selfFundedPayments: settled.length - independent.length,
    testPayments: all.filter((i) => i.payer && !isSettled(i)).length,
  };
}
