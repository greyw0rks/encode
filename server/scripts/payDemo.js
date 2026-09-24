/**
 * End-to-end payment demo — the thing a prospective payer actually runs.
 *
 * Points the client at a live Encode instance, shows the quote, and (only
 * with --pay) signs and submits it. Without --pay it stops after printing
 * the price, so it's safe to run against production to see what Encode
 * charges.
 *
 * `--pay` MOVES REAL MONEY. The signed authorization lets Encode's
 * facilitator pull the quoted amount from the signing wallet, once.
 *
 *   node scripts/payDemo.js --url http://localhost:8787/v1/incidents
 *   node scripts/payDemo.js --url https://encode-production.up.railway.app/v1/incidents --pay \
 *     --repo owner/name --summary "..." --tier triage --max-usd 2
 *
 * The signing key comes from PAYER_PRIVATE_KEY, and is only read when --pay
 * is passed. Use a wallet funded with just enough for the incident.
 */
import '../src/config/env.js';
import { Wallet } from 'ethers';
import { fetchQuote, payAndRequest } from '../src/client/x402Client.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  const repo = get('--repo', 'greyw0rks/encore-testbed');
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    console.error('--repo must be owner/name');
    process.exit(1);
  }
  return {
    url: get('--url', 'http://localhost:8787/v1/incidents'),
    repo: { owner, name },
    summary: get('--summary', 'Nightly export job is producing duplicate rows'),
    logs: get('--logs', 'export.job: collected 27 records but only 25 exist'),
    tier: get('--tier', 'triage'),
    maxUsd: get('--max-usd', null),
    pay: args.includes('--pay'),
  };
}

async function main() {
  const { url, repo, summary, logs, tier, maxUsd, pay } = parseArgs();
  const body = { summary, repo, logsExcerpt: logs, tier };

  console.log(`Encode payment demo → ${url}`);
  console.log(`Incident: ${tier} tier on ${repo.owner}/${repo.name}\n`);

  const quote = await fetchQuote({ url, body });

  if (!quote.paymentRequired) {
    console.log(`Server did not ask for payment (HTTP ${quote.status}):`);
    console.log(JSON.stringify(quote.body, null, 2));
    return;
  }

  const option = quote.accepts[0] ?? {};
  console.log('402 Payment Required');
  console.log(`  Price:      $${quote.quote?.quote?.usd ?? '?'} ${quote.quote?.quote?.asset ?? ''}`);
  console.log(`  Base units: ${option.maxAmountRequired}`);
  console.log(`  Asset:      ${option.asset}`);
  console.log(`  Pay to:     ${option.payTo}`);
  console.log(`  Network:    ${option.network}`);
  if (quote.quote?.eip712?.domain) {
    const d = quote.quote.eip712.domain;
    console.log(`  EIP-712:    ${d.name} v${d.version} on chain ${d.chainId}`);
  }

  if (!pay) {
    console.log('\n🔍 Quote only. Re-run with --pay to sign and submit — that MOVES REAL MONEY.');
    return;
  }

  if (!process.env.PAYER_PRIVATE_KEY) {
    console.error('\n❌ --pay needs PAYER_PRIVATE_KEY in the environment.');
    process.exit(1);
  }

  const signer = new Wallet(process.env.PAYER_PRIVATE_KEY);
  console.log(`\n⏳ Signing as ${signer.address}...`);

  const result = await payAndRequest({
    url,
    body,
    signer,
    maxAmountUsd: maxUsd,
    onQuote: ({ usd }) => console.log(`   authorizing $${usd}`),
  });

  console.log(`\n✅ Paid. HTTP ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
  console.log(`\nAuthorization digest: ${result.settlement.digest}`);

  const statusUrl = result.body?.statusUrl;
  if (statusUrl) {
    const origin = new URL(url).origin;
    console.log(`Poll for progress: curl ${origin}${statusUrl}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Demo failed:', err.message);
  process.exit(1);
});
