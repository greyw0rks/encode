/**
 * Coding Agent tool-loop harness — no API key, no network egress.
 *
 * Stands up a tiny local server that speaks the Anthropic /v1/messages
 * shape and returns *scripted* tool_use blocks, then points
 * ANTHROPIC_BASE_URL at it. That makes the loop under test real — the tool
 * dispatch, the path confinement, the bash policy, the tool_result
 * threading, the submit_fix termination — while the model's decisions are
 * fixed, so a failure here is a bug in Encode, not model variance.
 *
 * What this catches that liveRun.js can't: whether the loop handles a
 * refused command, a path escape, and an early stop without silently
 * reporting a fix that doesn't exist.
 */
import { createServer } from 'http';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync('git', args, { cwd });

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

/** Collects what the loop actually asked the "model" for, in order. */
const seenRequests = [];

/**
 * Scripted responses, consumed one per turn. Each is an array of content
 * blocks as the real API would return them.
 */
let script = [];
let scriptIndex = 0;

function startMockServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        seenRequests.push(parsed);

        const content = script[scriptIndex] ?? [{ type: 'text', text: 'out of script' }];
        scriptIndex++;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_mock_${scriptIndex}`,
            type: 'message',
            role: 'assistant',
            model: parsed.model,
            content,
            stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          })
        );
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'encode-loop-test-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', scripts: { test: 'node test.js' } }, null, 2)
  );
  await writeFile(join(dir, 'src/math.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
  await writeFile(
    join(dir, 'test.js'),
    `import { add } from './src/math.js';\nif (add(2, 3) !== 5) { process.exit(1); }\nconsole.log('ok');\n`
  );
  await git(['init', '-q'], dir);
  await git(['config', 'user.email', 'test@encode.local'], dir);
  await git(['config', 'user.name', 'Encode Test'], dir);
  await git(['add', '.'], dir);
  await git(['commit', '-q', '-m', 'initial'], dir);
  await git(['checkout', '-q', '-b', 'encode/fix-loop'], dir);
  return dir;
}

async function run(dir, draftFixWithToolLoop) {
  const events = [];
  const result = await draftFixWithToolLoop({
    incidentId: 'loop_test',
    repoPath: dir,
    repairPlan: ['Fix the sign error in add()'],
    affectedFiles: ['src/math.js'],
    branch: 'encode/fix-loop',
    onEvent: (e) => events.push(e),
  });
  return { result, events };
}

async function main() {
  const server = await startMockServer();
  const { port } = server.address();

  // Set before importing anything that builds an LLM client — the client is
  // lazy, but the env has to be right by first use.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = 'mock-key-not-real';
  process.env.LLM_PROVIDER = 'qwen';
  process.env.LLM_MODEL_CODING = 'mock-model';

  const { draftFixWithToolLoop } = await import('../src/agents/codingAgentQwen.js');
  const { resolveProvider, canUseAgentSdk } = await import('../src/llm/provider.js');

  console.log('Encode Coding Agent tool-loop harness — scripted model, real tool dispatch.\n');

  console.log('[0] Provider resolution');
  check('non-Anthropic base URL resolves to qwen', resolveProvider() === 'qwen', resolveProvider());
  check('Agent SDK path is correctly unavailable', canUseAgentSdk() === false);

  // ---- Case 1: the happy path, end to end ----
  console.log('\n[1] Happy path — read, write, test, commit, submit');
  {
    const dir = await makeRepo();
    script = [
      [toolUse('t1', 'read_file', { path: 'src/math.js' })],
      [toolUse('t2', 'write_file', { path: 'src/math.js', content: 'export function add(a, b) {\n  return a + b;\n}\n' })],
      [toolUse('t3', 'run_bash', { command: 'npm test' })],
      [toolUse('t4', 'run_bash', { command: 'git add -A' })],
      [toolUse('t5', 'run_bash', { command: 'git commit -m "fix: add() was subtracting"' })],
      [
        toolUse('t6', 'submit_fix', {
          diffSummary: 'add() returned a - b; now returns a + b.',
          prDescription: 'Sign error in add(). Fixed and covered by the existing test.',
          testsPassed: true,
          rootCauseConfirmed: true,
        }),
      ],
    ];
    scriptIndex = 0;

    try {
      const { result, events } = await run(dir, draftFixWithToolLoop);
      check('submitted', result.submitted === true);
      check('testsPassed reported true', result.testsPassed === true);
      check('strategy is encode-tool-loop', result.strategy === 'encode-tool-loop', result.strategy);
      check('file was actually rewritten', (await readFile(join(dir, 'src/math.js'), 'utf8')).includes('a + b'));
      check(
        'commit landed on the branch',
        (await git(['log', '--oneline', '-1'], dir)).stdout.includes('subtracting')
      );
      check('read_file output was line-numbered', result.transcript[0].output.startsWith('1\t'));
      check('onEvent fired for each tool call', events.filter((e) => e.type === 'tool').length === 5, String(events.length));
      check(
        'tools were advertised to the model',
        seenRequests.at(-1).tools?.map((t) => t.name).includes('submit_fix')
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // ---- Case 2: policy + confinement violations are refused, not fatal ----
  console.log('\n[2] Refusals — blocked command and path escape come back as recoverable errors');
  {
    const dir = await makeRepo();
    script = [
      [toolUse('t1', 'run_bash', { command: 'git push origin main' })],
      [toolUse('t2', 'run_bash', { command: 'npm test && git push origin main' })],
      [toolUse('t3', 'read_file', { path: '../../../etc/passwd' })],
      [toolUse('t4', 'write_file', { path: '/tmp/encode-escape-canary', content: 'should never be written' })],
      [
        toolUse('t5', 'submit_fix', {
          diffSummary: 'nothing',
          prDescription: 'nothing',
          testsPassed: false,
        }),
      ],
    ];
    scriptIndex = 0;

    try {
      const { result } = await run(dir, draftFixWithToolLoop);
      const outputs = result.transcript.filter((t) => t.type === 'tool').map((t) => t.output);
      check('git push refused', outputs[0].startsWith('refused:'), outputs[0].slice(0, 70));
      check('chained git push refused', outputs[1].startsWith('refused:'), outputs[1].slice(0, 70));
      check('path escape on read refused', outputs[2].startsWith('error: path escapes'), outputs[2].slice(0, 70));
      check('path escape on write refused', outputs[3].startsWith('error: path escapes'), outputs[3].slice(0, 70));
      check(
        'canary file was never created outside the repo',
        await readFile('/tmp/encode-escape-canary', 'utf8').then(() => false).catch(() => true)
      );
      check('loop still terminated cleanly', result.submitted === true);
      check('honest testsPassed:false passthrough', result.testsPassed === false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm('/tmp/encode-escape-canary', { force: true });
    }
  }

  // ---- Case 3: model stops without submitting ----
  console.log('\n[3] Model stops without submit_fix — must NOT report a fix');
  {
    const dir = await makeRepo();
    script = [
      [toolUse('t1', 'read_file', { path: 'src/math.js' })],
      [{ type: 'text', text: 'I think I am done here.' }],
      [{ type: 'text', text: 'Still nothing to add.' }],
    ];
    // Truncate the loop quickly by letting it run out of script — every
    // subsequent turn returns text, and the loop re-nudges each time.
    scriptIndex = 0;

    try {
      const { result } = await run(dir, draftFixWithToolLoop);
      check('submitted is false', result.submitted === false);
      check('testsPassed defaults to false, not true', result.testsPassed === false);
      check('no PR description fabricated', result.prDescription === null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  server.close();
  console.log(failures === 0 ? '\n✅ All tool-loop checks passed.' : `\n❌ ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Harness itself failed:', err);
  process.exit(1);
});
