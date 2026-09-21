/**
 * Typed reads of the Encode API.
 *
 * Two rules carried over from the page this replaces, both about not lying:
 *
 *  1. Nothing on the site is invented. Every number comes from the API and
 *     every claim links to the transaction, the registry, or the PR that
 *     proves it.
 *  2. When the API is unreachable the site says so and shows `—`. A zero
 *     reads as a fact — "no settlements yet" and "we couldn't ask" are
 *     different statements and must not render identically.
 *
 * So every fetch here resolves to a discriminated union rather than throwing
 * or defaulting: callers have to handle `unreachable` to get at the data.
 */

/** One row of the public settlement ledger — `ledgerRow()` in the API. */
export type LedgerRow = {
  id: string;
  summary: string;
  status: IncidentStatus;
  tier: Tier;
  payer: string | null;
  amount?: string;
  txHash?: string;
  attributed: boolean;
  selfFunded: boolean;
  verificationDepth: VerificationDepth | null;
  prUrl: string | null;
  createdAt: string;
};

export type Tier = 'triage' | 'fix';

export type IncidentStatus =
  | 'detected'
  | 'diagnosing'
  | 'fix_drafted'
  | 'resolved'
  | 'failed'
  | 'interrupted';

/**
 * `repro-confirmed` is the only strong result: the reported failure was
 * reproduced before the patch and no longer reproduces after it. `tests-only`
 * means the suite passed, which is weaker and is reported as such rather than
 * rounded up.
 */
export type VerificationDepth = 'repro-confirmed' | 'tests-only' | 'none';

export type DashboardStats = {
  totalJobs: number;
  resolved: number;
  failed: number;
  interrupted: number;
  /** Paid for, terminal, never delivered — money owed, not work done. */
  unfulfilledPaid: number;
  uniqueSigners: number;
  /** Pre-formatted to 2dp by the API; kept as a string so it isn't re-rounded. */
  totalValueProcessed: string;
  settledPayments: number;
  attributedPayments: number;
  selfFundedPayments: number;
  testPayments: number;
};

export type Dashboard = { stats: DashboardStats; recent: LedgerRow[] };

export type Status = {
  service: string;
  llm: {
    provider: string;
    baseUrl: string;
    diagnosisModel: string;
    codingModel: string;
    codingStrategy: 'claude-agent-sdk' | 'encode-tool-loop';
  };
  payment: {
    ready: boolean;
    missing: string[];
    payTo?: string;
    network?: string;
  };
  attribution: {
    agentId: string | null;
    agentUri: string | null;
    attributionTag: string | null;
    agentWallet: string | null;
    registered: boolean;
    settlementKeyPresent: boolean;
    facilitator: { url: string; network: string; health: unknown; supported: unknown };
  };
  store: { durable: boolean; note: string };
  canTakeRealPayments: boolean;
  blockers: string[];
  warnings: string[];
};

export type Incident = {
  id: string;
  summary: string;
  repo: { owner: string; name: string } | null;
  tier: Tier;
  status: IncidentStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  payer: string | null;
  settlement: {
    txHash: string;
    amount: string;
    asset: string;
    network: string;
    selfFunded: boolean;
    settledAt: string;
  } | null;
  attribution: { tag: string | null; attributable: boolean } | null;
  diagnosis: {
    isActionable: boolean;
    severity: string;
    probableCause: string;
    affectedFiles: string[];
    repairPlan: string;
    reproCommand: string | null;
    confidence: number;
  } | null;
  patch: {
    branch: string;
    strategy: string;
    model: string;
    submitted: boolean;
    diffSummary: string | null;
    prDescription: string | null;
    testsPassed: boolean | null;
    rootCauseConfirmed: boolean | null;
  } | null;
  verification: {
    testsPassed: boolean | null;
    reproCommand: string | null;
    reproPassesOnFix: boolean | null;
    reproFailedOnBaseline: boolean | null;
    /** `null` means unknown, and must never be collapsed into `true`. */
    originalFailureResolved: boolean | null;
    verificationDepth: VerificationDepth;
    notes: string | null;
    testOutputExcerpt: string | null;
    verifiedAt: string;
  } | null;
  pr: { url: string; number: number } | null;
  humanReview: unknown;
};

/** Either the data, or an explicit "we couldn't ask" that callers must handle. */
export type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Server-side base URL. `ENCODE_API_URL` is read at request time rather than
 * baked in, so the same image can be promoted between environments.
 */
export function apiBase(): string {
  const url = process.env.ENCODE_API_URL || process.env.NEXT_PUBLIC_ENCODE_API_URL || '';
  return url.replace(/\/$/, '');
}

async function read<T>(path: string, revalidate: number): Promise<Result<T>> {
  const base = apiBase();
  if (!base) return { ok: false, reason: 'no API URL configured for this deployment' };

  try {
    // A hung API would otherwise hold a page render open until the platform
    // times it out, turning "ledger unavailable" into a 504 for the whole site.
    const res = await fetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate },
    });
    if (!res.ok) return { ok: false, reason: `the API returned ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'the API did not respond in time' : "the API isn't reachable from here";
    return { ok: false, reason };
  }
}

/**
 * Revalidation windows are short because both endpoints are the live evidence
 * the site is built on — a cached "no settlements yet" that outlives the first
 * real payment is the one staleness that actually matters here. `/v1/status`
 * gets the longer window: the API rate-limits it to 10/min because it fans out
 * to the facilitator twice per call.
 */
export const getDashboard = () => read<Dashboard>('/v1/dashboard', 30);
export const getStatus = () => read<Status>('/v1/status', 60);

export async function getIncident(id: string): Promise<Result<Incident>> {
  return read<Incident>(`/v1/incidents/${encodeURIComponent(id)}`, 15);
}

/** Only settled rows belong in a settlement ledger. */
export function settledRows(rows: LedgerRow[]): LedgerRow[] {
  return rows.filter((row) => Boolean(row.txHash && row.amount));
}

export const celoscanTx = (txHash: string) => `https://celoscan.io/tx/${encodeURIComponent(txHash)}`;

export function shortHash(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return '—';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
