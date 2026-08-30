/**
 * Public projections of an incident record.
 *
 * The stored record is deliberately fat — it holds the Coding Agent's whole
 * transcript, the server-side clone path, and the repo tree — because that
 * detail is what makes a failure diagnosable after the fact. None of it
 * belongs in an HTTP response:
 *
 *   - `patch.transcript` contains verbatim file contents from the target
 *     repo. For a private repo that's the source code itself.
 *   - `repoLocalPath` / `repoTreeCache` describe the server's filesystem.
 *   - `logsRef` is whatever the payer pasted, which may include secrets
 *     from their own logs.
 *
 * So responses are built by naming what goes out, never by deleting what
 * shouldn't. A field added to the store later is private by default rather
 * than leaking on the next deploy.
 */

/** Full detail for the payer polling their own incident. */
export function publicIncident(incident) {
  if (!incident) return null;

  return {
    id: incident.id,
    summary: incident.summary,
    repo: incident.repo,
    tier: incident.tier,
    status: incident.status,
    error: incident.error ?? null,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,

    payer: incident.payer ?? null,
    settlement: incident.settlement
      ? {
          txHash: incident.settlement.txHash,
          amount: incident.settlement.amount,
          asset: incident.settlement.asset,
          network: incident.settlement.network,
          selfFunded: Boolean(incident.settlement.selfFunded),
          settledAt: incident.settlement.settledAt,
        }
      : null,
    attribution: incident.attribution
      ? { tag: incident.attribution.tag, attributable: incident.attribution.attributable }
      : null,

    // The deliverable at the triage tier — the payer bought this, so it
    // goes out in full.
    diagnosis: incident.diagnosis
      ? {
          isActionable: incident.diagnosis.isActionable,
          severity: incident.diagnosis.severity,
          probableCause: incident.diagnosis.probableCause,
          affectedFiles: incident.diagnosis.affectedFiles,
          repairPlan: incident.diagnosis.repairPlan,
          reproCommand: incident.diagnosis.reproCommand,
          confidence: incident.diagnosis.confidence,
        }
      : null,

    // Summary of the patch, not the transcript that produced it.
    patch: incident.patch
      ? {
          branch: incident.patch.branch,
          strategy: incident.patch.strategy,
          model: incident.patch.model,
          submitted: incident.patch.submitted,
          diffSummary: incident.patch.diffSummary,
          prDescription: incident.patch.prDescription,
          testsPassed: incident.patch.testsPassed,
          rootCauseConfirmed: incident.patch.rootCauseConfirmed ?? null,
        }
      : null,

    // verificationDepth and notes are the honest part of the product; test
    // output is truncated because it can be enormous and is a repo artifact.
    verification: incident.verification
      ? {
          testsPassed: incident.verification.testsPassed,
          reproCommand: incident.verification.reproCommand,
          reproPassesOnFix: incident.verification.reproPassesOnFix,
          reproFailedOnBaseline: incident.verification.reproFailedOnBaseline,
          originalFailureResolved: incident.verification.originalFailureResolved,
          verificationDepth: incident.verification.verificationDepth,
          notes: incident.verification.notes,
          testOutputExcerpt: incident.verification.testOutput?.slice(0, 2000) ?? null,
          verifiedAt: incident.verification.verifiedAt,
        }
      : null,

    pr: incident.pr ?? null,
    humanReview: incident.humanReview ?? null,
  };
}

/**
 * One row of the public ledger. Narrower than publicIncident: a stranger
 * browsing the dashboard has no claim on another payer's diagnosis or
 * repair plan, only on the fact that a settlement happened.
 */
export function ledgerRow(incident) {
  return {
    id: incident.id,
    summary: incident.summary,
    status: incident.status,
    tier: incident.tier,
    payer: incident.payer,
    amount: incident.settlement?.amount,
    txHash: incident.settlement?.txHash,
    attributed: Boolean(incident.attribution?.attributable),
    selfFunded: Boolean(incident.settlement?.selfFunded),
    verificationDepth: incident.verification?.verificationDepth ?? null,
    prUrl: incident.pr?.url ?? null,
    createdAt: incident.createdAt,
  };
}
