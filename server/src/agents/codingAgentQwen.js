/**
 * Coding Agent tool loop (provider-agnostic)
 * ------------------------------------------
 * Used when the Claude Agent SDK isn't available — i.e. anytime Encode is
 * pointed at Qwen's Anthropic-compatible endpoint rather than Anthropic
 * itself. Same contract as the SDK path (see codingAgent.js): investigate,
 * patch, test, commit to a branch, describe the PR. Never push, never
 * deploy.
 *
 * The tool surface here is deliberately narrower than the Agent SDK's:
 * read_file, write_file, run_bash (whitelisted prefixes only), and
 * submit_fix to terminate. Everything is path-confined to the incident's
 * own clone — see resolveInside().
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'path';
import { llmClient, modelFor } from '../llm/provider.js';
import { ALLOWED_BASH_PREFIXES, checkBashCommand } from './bashPolicy.js';

const execFileAsync = promisify(execFile);

const MAX_TURNS = 40;
const MAX_FILE_BYTES = 120_000;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 12_000;

/**
 * Confines every filesystem tool call to the incident's clone. Returning an
 * error string rather than throwing keeps a bad path a recoverable model
 * mistake instead of a failed incident.
 */
function resolveInside(repoPath, requested) {
  const target = isAbsolute(requested) ? requested : resolve(repoPath, requested);
  const rel = relative(repoPath, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

function truncate(text = '') {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

const TOOLS = [
  {
    name: 'read_file',
    description:
      'Read a UTF-8 file from the repository. Paths are relative to the repo root. Returns the file contents with line numbers.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the repo root.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write the FULL new contents of a file, overwriting whatever was there. There is no partial-edit tool — read the file first, then write it back complete.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the repo root.' },
        content: { type: 'string', description: 'Complete new file contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_bash',
    description: `Run a shell command in the repo root. Only these command prefixes are permitted: ${ALLOWED_BASH_PREFIXES.join(
      ', '
    )}. Pushing, deploying, and force operations are blocked and will be refused.`,
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'submit_fix',
    description:
      'Call this once, last, after the patch is committed. Ends the run. Do not call it if you have not committed anything.',
    input_schema: {
      type: 'object',
      properties: {
        diffSummary: { type: 'string', description: 'What changed, in one or two sentences.' },
        prDescription: {
          type: 'string',
          description: 'PR body: what broke, why, what changed, how it was verified.',
        },
        testsPassed: {
          type: 'boolean',
          description: 'Whether the test suite passed on your final commit. Report honestly.',
        },
        rootCauseConfirmed: {
          type: 'boolean',
          description: 'Whether the repair plan\'s stated cause actually matched what you found.',
        },
      },
      required: ['diffSummary', 'prDescription', 'testsPassed'],
    },
  },
];

async function runTool({ name, input, repoPath }) {
  if (name === 'read_file') {
    const path = resolveInside(repoPath, input.path);
    if (!path) return `error: path escapes the repository: ${input.path}`;
    try {
      const raw = await readFile(path, 'utf8');
      const body = raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) : raw;
      const numbered = body
        .split('\n')
        .map((line, i) => `${i + 1}\t${line}`)
        .join('\n');
      return raw.length > MAX_FILE_BYTES
        ? `${numbered}\n...[file truncated at ${MAX_FILE_BYTES} bytes]`
        : numbered;
    } catch (err) {
      return `error: ${err.message}`;
    }
  }

  if (name === 'write_file') {
    const path = resolveInside(repoPath, input.path);
    if (!path) return `error: path escapes the repository: ${input.path}`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.content, 'utf8');
      return `wrote ${input.content.length} bytes to ${input.path}`;
    } catch (err) {
      return `error: ${err.message}`;
    }
  }

  if (name === 'run_bash') {
    const command = (input.command || '').trim();
    const policy = checkBashCommand(command);
    if (!policy.allowed) {
      return `refused: ${policy.reason}. Allowed prefixes: ${ALLOWED_BASH_PREFIXES.join(', ')}`;
    }
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
        cwd: repoPath,
        timeout: BASH_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      return truncate(`exit 0\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`);
    } catch (err) {
      // Non-zero exit is normal and informative here (a failing test run is
      // a result, not a crash) — hand it back rather than aborting the loop.
      return truncate(
        `exit ${err.code ?? 'unknown'}\n${err.stdout || ''}${err.stderr ? `\n[stderr]\n${err.stderr}` : ''}${
          !err.stdout && !err.stderr ? err.message : ''
        }`
      );
    }
  }

  return `error: unknown tool ${name}`;
}

const SYSTEM_PROMPT = `You are Encode's Coding Agent. You fix a single reported incident in a
repository you have already been given a local clone of, on a branch that
already exists and is checked out.

Rules:
- Write the smallest correct patch. No unrelated refactors, no reformatting,
  no dependency bumps that the incident doesn't require.
- Match the surrounding code's style, naming, and idiom.
- Run the existing test suite. If nothing covers the failure, add a test
  that would have caught it.
- Commit your work with git. NEVER push, NEVER deploy, NEVER touch main.
- write_file replaces a whole file: read it first, then write it back
  complete. There is no partial-edit tool.
- If the repair plan turns out to be wrong, say so in your submission
  rather than forcing a patch that matches the plan but not the bug.
- When you're done and committed, call submit_fix exactly once.`;

export async function draftFixWithToolLoop({
  incidentId,
  repoPath,
  repairPlan,
  affectedFiles,
  branch,
  onEvent = () => {},
}) {
  const client = llmClient();
  const model = modelFor('coding');

  const messages = [
    {
      role: 'user',
      content: `Incident ${incidentId}.

Repair plan from triage:
${repairPlan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Affected files (a starting point from triage, not exhaustive):
${affectedFiles?.length ? affectedFiles.join(', ') : '(none identified)'}

Repo root: ${repoPath}
Branch (already checked out): ${branch}

Investigate, patch, test, commit to that branch, then call submit_fix.`,
    },
  ];

  const transcript = [];
  let submission = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (text) {
      transcript.push({ type: 'text', turn, text });
      onEvent({ type: 'text', turn, text });
    }

    if (toolUses.length === 0) {
      // Model stopped without submitting. Nudge once per remaining turn
      // rather than silently returning an empty fix.
      if (response.stop_reason === 'end_turn') {
        messages.push({
          role: 'user',
          content:
            'You stopped without calling submit_fix. If the work is committed, call submit_fix now. If not, continue.',
        });
        continue;
      }
      break;
    }

    const results = [];
    for (const use of toolUses) {
      if (use.name === 'submit_fix') {
        submission = use.input;
        results.push({ type: 'tool_result', tool_use_id: use.id, content: 'submission recorded' });
        transcript.push({ type: 'submit_fix', turn, input: use.input });
        onEvent({ type: 'submit_fix', turn, input: use.input });
        continue;
      }

      const output = await runTool({ name: use.name, input: use.input, repoPath });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: output });
      transcript.push({ type: 'tool', turn, name: use.name, input: use.input, output });
      onEvent({ type: 'tool', turn, name: use.name, input: use.input });
    }

    messages.push({ role: 'user', content: results });

    if (submission) break;
  }

  return {
    branch,
    strategy: 'encode-tool-loop',
    model,
    diffSummary: submission?.diffSummary ?? null,
    prDescription: submission?.prDescription ?? null,
    testsPassed: submission?.testsPassed ?? false,
    rootCauseConfirmed: submission?.rootCauseConfirmed ?? null,
    submitted: Boolean(submission),
    transcript,
  };
}
