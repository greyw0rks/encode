/**
 * Minimal probe: does the configured LLM endpoint support Anthropic-shaped
 * tool use at all, and does it terminate a two-turn tool exchange cleanly?
 *
 * This is deliberately smaller than liveRun.js. If the Coding Agent loop
 * misbehaves against a third-party endpoint, the first question is whether
 * the endpoint honours `tools` and returns well-formed `tool_use` blocks —
 * not whether Encode's pipeline logic is wrong. One cheap call answers it.
 *
 *   node scripts/probeToolUse.js
 */
import '../src/config/env.js';
import { llmClient, modelFor, providerSummary } from '../src/llm/provider.js';

const TOOL = {
  name: 'get_file_length',
  description: 'Returns the number of lines in a file. Call this rather than guessing.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Path to the file.' } },
    required: ['path'],
  },
};

async function main() {
  console.log('Provider:', JSON.stringify(providerSummary(), null, 2));

  const client = llmClient();
  const model = modelFor('coding');
  const messages = [{ role: 'user', content: 'How many lines are in src/math.js? Use the tool, then state the number.' }];

  console.log(`\n[turn 1] asking ${model} to call the tool...`);
  const first = await client.messages.create({
    model,
    max_tokens: 1000,
    tools: [TOOL],
    messages,
  });

  console.log('  stop_reason:', first.stop_reason);
  console.log('  block types:', first.content.map((b) => b.type).join(', '));

  const use = first.content.find((b) => b.type === 'tool_use');
  if (!use) {
    console.error('\n❌ No tool_use block. This endpoint either ignores `tools` or emits a different shape.');
    console.error('   Raw content:', JSON.stringify(first.content).slice(0, 600));
    process.exit(1);
  }

  console.log(`  ✅ tool_use: ${use.name}(${JSON.stringify(use.input)}) id=${use.id}`);
  if (use.name !== TOOL.name) {
    console.error(`\n❌ Called "${use.name}" instead of "${TOOL.name}" — tool names aren't round-tripping.`);
    process.exit(1);
  }

  // Feed a result back — this is the half that tends to break on
  // compatibility layers, since it requires tool_use_id to be echoed.
  messages.push({ role: 'assistant', content: first.content });
  messages.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: use.id, content: '42' }],
  });

  console.log('\n[turn 2] feeding tool_result back...');
  const second = await client.messages.create({ model, max_tokens: 1000, tools: [TOOL], messages });

  console.log('  stop_reason:', second.stop_reason);
  const text = second.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  console.log('  text:', text.slice(0, 300));

  if (!text.includes('42')) {
    console.error('\n⚠️  The model did not use the tool result. The loop may work but the model ignores tool output.');
    process.exit(1);
  }

  console.log('\n✅ Endpoint supports Anthropic-shaped tool use, both directions.');
}

main().catch((err) => {
  console.error('\n❌ Probe failed:', err.status ? `${err.status} ${err.message}` : err.message);
  if (err.error) console.error('   detail:', JSON.stringify(err.error).slice(0, 500));
  process.exit(1);
});
