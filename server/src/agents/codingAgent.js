/**
 * Coding Agent
 * ------------
 * Takes the Incident Agent's repair plan and does the actual work:
 * investigates the affected files, writes a patch, runs the test suite,
 * commits to a branch scoped to this incident.
 *
 * Two execution strategies, same contract:
 *   - Claude Agent SDK, when Encode is pointed at real Anthropic. The SDK
 *     drives its own tool loop.
 *   - Encode's own tool loop (agents/codingAgentQwen.js), when pointed at
 *     Qwen's Anthropic-compatible endpoint — the SDK's tool orchestration
 *     doesn't route through ANTHROPIC_BASE_URL, so it isn't usable there.
 *
 * Hard rule for both paths: tool access never includes push or deploy. The
 * only write target is a new branch; pushing and opening the PR happen in
 * routes/incidents.js, outside the model's control. See AGENTS.md.
 */

import { canUseAgentSdk, modelFor, providerSummary } from '../llm/provider.js';
import { draftFixWithToolLoop } from './codingAgentQwen.js';
import { DENIED_BASH_SUBSTRINGS } from './bashPolicy.js';

function buildPrompt({ incidentId, repoPath, repairPlan, affectedFiles, branch }) {
  return `You are Encode's Coding Agent working on incident ${incidentId}.

Repair plan from triage:
${repairPlan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Affected files (starting point, not exhaustive): ${
    affectedFiles?.length ? affectedFiles.join(', ') : '(none identified)'
  }

Working directory: ${repoPath}
Branch (already checked out): ${branch}

1. Investigate the affected files and confirm the root cause matches the plan.
2. Write the smallest correct patch — no unrelated refactors.
3. Run the existing test suite. If there's no relevant test, add one that
   would have caught this failure.
4. Commit to branch "${branch}". Do NOT push to main, do NOT deploy.
5. Finish with a short PR description: what broke, why, what changed — and
   state plainly whether the tests passed.`;
}

async function draftFixWithAgentSdk({ incidentId, repoPath, repairPlan, affectedFiles, branch }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const events = [];

  for await (const event of query({
    prompt: buildPrompt({ incidentId, repoPath, repairPlan, affectedFiles, branch }),
    options: {
      cwd: repoPath,
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
      // Second guardrail beyond simply not granting deploy tools — mirrors
      // the denylist the tool-loop path enforces.
      disallowedTools: DENIED_BASH_SUBSTRINGS.filter((s) => s.startsWith('git') || s.includes('deploy')).map(
        (s) => `Bash(${s.trim()})`
      ),
      model: modelFor('coding'),
      permissionMode: 'acceptEdits',
    },
  })) {
    events.push(event);
  }

  const result = events.find((e) => e.type === 'result');
  return {
    branch,
    strategy: 'claude-agent-sdk',
    model: modelFor('coding'),
    diffSummary: result?.diffSummary ?? result?.result ?? null,
    prDescription: result?.prDescription ?? result?.result ?? null,
    testsPassed: result?.testsPassed ?? false,
    submitted: Boolean(result),
    rawEvents: events,
  };
}

export async function draftFix({ incidentId, repoPath, repairPlan, affectedFiles, onEvent }) {
  const branch = `encode/fix-${incidentId}`;
  const args = { incidentId, repoPath, repairPlan, affectedFiles, branch };

  if (canUseAgentSdk()) {
    return draftFixWithAgentSdk(args);
  }

  return draftFixWithToolLoop({ ...args, onEvent });
}

export { providerSummary };
