import { llmClient, modelFor } from '../llm/provider.js';

/**
 * Incident Agent
 * --------------
 * Reads the incident report + logs + a read-only view of the repo, and
 * decides: is this real, how severe, and what's the probable cause.
 * Deliberately kept separate from the Coding Agent — this step is a
 * judgment call over noisy signals, not code generation, and keeping it on
 * the cheaper model means triage-only requests stay priced at $1.50 without
 * subsidizing a full reasoning pass.
 *
 * Output is a structured repair plan, not prose — the Coding Agent consumes
 * this directly instead of re-parsing free text.
 */

const SYSTEM_PROMPT = `You are Encode's Incident Agent. Given an incident summary, a log
excerpt, and a repo file tree, determine whether this is a real, actionable
issue and produce a structured repair plan. Respond ONLY with JSON matching:
{
  "isActionable": boolean,
  "severity": "low" | "medium" | "high" | "critical",
  "probableCause": string,
  "affectedFiles": string[],
  "repairPlan": string[],   // ordered steps, plain language
  "reproCommand": string | null, // a command from the repo that should FAIL before the fix and pass after, or null if you can't identify one
  "confidence": number      // 0-1
}
If the incident looks like noise (transient blip, already self-resolved,
insufficient evidence), set isActionable to false and explain why in
probableCause instead of guessing.
No prose, no markdown fences — JSON only.`;

/**
 * Models pointed at an Anthropic-compatible endpoint don't all honour
 * "JSON only" — some wrap it in a fenced block or add a sentence. Pull the
 * outermost JSON object rather than failing the whole incident on it.
 */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(`incident_agent_unparseable_response: ${candidate.slice(0, 300)}`);
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/** Guards against a malformed-but-parseable response reaching the pipeline. */
function normalize(raw) {
  return {
    isActionable: Boolean(raw.isActionable),
    severity: ['low', 'medium', 'high', 'critical'].includes(raw.severity) ? raw.severity : 'medium',
    probableCause: typeof raw.probableCause === 'string' ? raw.probableCause : '(none given)',
    affectedFiles: Array.isArray(raw.affectedFiles) ? raw.affectedFiles.filter((f) => typeof f === 'string') : [],
    repairPlan: Array.isArray(raw.repairPlan) ? raw.repairPlan.filter((s) => typeof s === 'string') : [],
    reproCommand: typeof raw.reproCommand === 'string' && raw.reproCommand.trim() ? raw.reproCommand.trim() : null,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
  };
}

export async function diagnose({ summary, logsExcerpt, repoTree }) {
  const response = await llmClient().messages.create({
    model: modelFor('diagnosis'),
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `INCIDENT SUMMARY:\n${summary}\n\nLOG EXCERPT:\n${logsExcerpt}\n\nREPO TREE:\n${repoTree}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  const diagnosis = normalize(extractJson(text));

  // An "actionable" verdict with no plan is not actionable in practice —
  // the Coding Agent has nothing to work from.
  if (diagnosis.isActionable && diagnosis.repairPlan.length === 0) {
    diagnosis.isActionable = false;
    diagnosis.probableCause = `${diagnosis.probableCause} (downgraded: no repair plan returned)`;
  }

  return diagnosis;
}
