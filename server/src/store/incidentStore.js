import { nanoid } from 'nanoid';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Incident lifecycle: detected -> diagnosing -> fix_drafted -> resolved -> failed
 *                     (any non-terminal status -> interrupted, on restart)
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

  // Test/dry-run markers are deliberately excluded rather than filtered at
  // display time — see AGENTS.md on not producing numbers that could be
  // mistaken for real leaderboard activity.
  const isSettled = (i) => i.payer && !/TEST|DRYRUN|LIVERUN/i.test(i.payer) && i.settlement?.txHash;

  // A settlement from Encode's own payout address is a real on-chain
  // transaction and no evidence of anything — it's value moving between two
  // wallets one party controls. Counted separately, never in uniqueSigners.
  const isIndependent = (i) => isSettled(i) && !i.settlement?.selfFunded;

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
    // number that represents money owed rather than work done.
    unfulfilledPaid: all.filter((i) => isIndependent(i) && (i.status === 'interrupted' || i.status === 'failed')).length,
    uniqueSigners: uniquePayers.size,
    totalValueProcessed: totalValue.toFixed(2),
    settledPayments: independent.length,
    attributedPayments: attributed.length,
    selfFundedPayments: settled.length - independent.length,
    testPayments: all.filter((i) => i.payer && !isSettled(i)).length,
  };
}
