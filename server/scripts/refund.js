/**
 * Refund a paid-but-undelivered incident.
 *
 * Encode takes payment up front, so a run that fails or is interrupted leaves
 * the payer having paid for nothing. The debt is recorded (`unfulfilledPaid`)
 * but nothing in the request path pays it back — see PAYING.md and BUILD.md.
 * This is that missing step, run by hand and on purpose.
 *
 * A refund is a plain ERC-20 `transfer` of USDC from Encode's payout wallet
 * back to the payer. It is NOT gas-sponsored: the x402 facilitator only
 * relays inbound EIP-3009 authorizations, so this outbound transfer is a
 * normal transaction the payout wallet signs and pays CELO gas for.
 *
 * This is a REAL mainnet transaction spending real money. Simulation is the
 * default; nothing moves without --broadcast.
 *
 *   node scripts/refund.js --incident inc_xxx            # simulate, costs nothing
 *   node scripts/refund.js --incident inc_xxx --broadcast
 *   node scripts/refund.js --list                        # show who is owed
 *   node scripts/refund.js --auto                        # simulate refunding every
 *                                                        # no-verification-signal debt
 *   node scripts/refund.js --auto --broadcast            # ...and send them
 *
 * The recipient and amount come from the incident record, never from flags:
 * you refund what was actually charged, to whoever actually paid. The record
 * must be in this process's store (the production volume), which is why a
 * refund is run on the host that holds the DB, not against an empty local one.
 *
 * The payout key is read from PRIVATE_KEY / ENCODE_PAYOUT_PRIVATE_KEY in the
 * environment if set — which is how it's supplied inside the Railway container,
 * where the incident DB volume lives. Falling back to DEPLOYER_ENV_PATH (the
 * Arcadia contracts env) keeps the one funded key in one place when running on
 * a machine that has that file. Pass it inline for a single session rather than
 * persisting a funded mainnet key as a service variable.
 */
import '../src/config/env.js';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import { getIncident, listUnfulfilledPaid, listAutoRefundable, refundIncident } from '../src/store/incidentStore.js';
import { assetAddress, toBaseUnits } from '../src/celo/facilitator.js';

const DEFAULT_KEY_PATH = '/home/greyw0rks/Arcadia/arcadia-contracts/celo/.env';
const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const API_URL = (process.env.ENCODE_API_URL || 'https://encode-production.up.railway.app').replace(/\/$/, '');
const USDC_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function loadPrivateKey() {
  // In the container the key comes from the environment; on a dev box with the
  // Arcadia env file it comes from disk. Env wins so a one-off session can pass
  // it inline without touching persisted config.
  const fromEnv = process.env.PRIVATE_KEY || process.env.ENCODE_PAYOUT_PRIVATE_KEY;
  if (fromEnv) return fromEnv.trim().replace(/^['"]|['"]$/g, '');

  const path = process.env.DEPLOYER_ENV_PATH || DEFAULT_KEY_PATH;
  const match = readFileSync(path, 'utf8').match(/^PRIVATE_KEY=(.+)$/m);
  if (!match) throw new Error(`no PRIVATE_KEY in env and none found in ${path}`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function printOwed() {
  const owed = listUnfulfilledPaid();
  if (owed.length === 0) {
    console.log('No outstanding debts — nothing is paid-but-undelivered.');
    return;
  }
  console.log(`Owed (${owed.length}):`);
  for (const i of owed) {
    console.log(`  ${i.id}  ${i.payer}  $${i.settlement?.amount} ${i.settlement?.asset}  [${i.status}]`);
  }
}

/**
 * When the incident isn't in the local store, verify it against the live
 * production ledger instead of trusting flags. The dashboard is the same data
 * the store would hand back, served read-only over HTTPS, so it's a sound
 * source for "who paid, how much, and is this still owed" — but it can't be
 * written to, so a refund resolved this way records nothing and says so.
 */
async function resolveFromLedger(id) {
  const res = await fetch(`${API_URL}/v1/dashboard`);
  if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
  const { recent = [] } = await res.json();
  const row = recent.find((r) => r.id === id);
  if (!row) {
    throw new Error(`${id} is not in the live ledger at ${API_URL} either — check the id.`);
  }
  if (row.selfFunded) throw new Error(`${id} is self-funded — a wallet paying itself is not a debt.`);
  if (!['failed', 'interrupted'].includes(row.status)) {
    throw new Error(`${id} is '${row.status}', not a paid-but-undelivered debt — refusing.`);
  }
  if (!row.payer || !row.amount) throw new Error(`${id} has no payer/amount in the ledger.`);
  return { to: row.payer, usd: row.amount, status: row.status };
}

function buildWallet() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(loadPrivateKey(), provider);
  const token = new ethers.Contract(assetAddress('USDC'), USDC_ABI, wallet);
  return { provider, wallet, token };
}

/**
 * The on-chain half of a refund, shared by the single-incident flow and the
 * --auto sweep. Simulation is the default — nothing moves without `broadcast`.
 * The amount is always the incident's recorded settlement, never a flag, and
 * the send is recorded only when `canRecord` (the incident lives in the local
 * store). refundIncident refuses a second refund keyed on the first txHash, so
 * a re-run can't pay twice. Returns { ok, txHash? }; ok:false means a hard
 * stop (insufficient funds/gas) — the caller should not keep sending.
 */
async function executeRefund({ id, to, usd, canRecord, incident, broadcast, provider, wallet, token }) {
  const usdc = assetAddress('USDC');
  const baseUnits = toBaseUnits(usd);

  const [celo, usdcBalance, gas, fee] = await Promise.all([
    provider.getBalance(wallet.address),
    token.balanceOf(wallet.address),
    token.transfer.estimateGas(to, baseUnits),
    provider.getFeeData(),
  ]);
  const gasCost = gas * (fee.gasPrice ?? 0n);

  console.log(`\nRefund:     ${id}${incident ? ` (${incident.status})` : ' (from live ledger)'}`);
  console.log(`Asset:      USDC ${usdc} (Celo mainnet)`);
  console.log(`From:       ${wallet.address}`);
  console.log(`To (payer): ${to}`);
  console.log(`Amount:     $${usd}  (${baseUnits} base units)`);
  console.log(`USDC bal:   ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`CELO bal:   ${ethers.formatEther(celo)}`);
  console.log(`Gas:        ${gas} @ ${ethers.formatUnits(fee.gasPrice ?? 0n, 'gwei')} gwei`);
  console.log(`Gas cost:   ${ethers.formatEther(gasCost)} CELO`);

  if (usdcBalance < BigInt(baseUnits)) {
    console.error(`\n❌ USDC balance ${ethers.formatUnits(usdcBalance, 6)} < refund $${usd}.`);
    return { ok: false };
  }
  if (celo < gasCost * 2n) {
    console.error(`\n❌ CELO balance too low for gas — want at least 2× the estimate as headroom.`);
    return { ok: false };
  }

  if (!broadcast) {
    console.log('\n🔍 Simulation only. Re-run with --broadcast to send real USDC.');
    return { ok: true, simulated: true };
  }

  console.log('\n⏳ Broadcasting refund...');
  const tx = await token.transfer(to, baseUnits);
  console.log(`   tx: ${tx.hash}`);
  console.log(`   https://celoscan.io/tx/${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

  if (!canRecord) {
    console.log(
      `\n✅ Refund SENT: $${usd} USDC to ${to} (${tx.hash}).\n` +
        `⚠️  Recorded nothing — this ran against the live ledger, not the store. The\n` +
        `   production DB still shows this as an outstanding debt. Reconcile it on the\n` +
        `   host that holds the DB with the record-only command (this NEVER re-sends;\n` +
        `   do NOT re-run the plain refund, which would transfer a second time):\n` +
        `      node scripts/refund.js --incident ${id} --record ${tx.hash} --usd ${usd}`
    );
    return { ok: true, txHash: tx.hash, recorded: false };
  }

  const recorded = refundIncident(id, { txHash: tx.hash, amount: usd, asset: 'USDC', network: 'celo', to });
  if (!recorded.ok) {
    console.error(
      `\n⚠️  Refund SENT (${tx.hash}) but the record was not updated: ${recorded.reason}. ` +
        `The money moved — reconcile the incident by hand.`
    );
    return { ok: true, txHash: tx.hash, recorded: false };
  }
  console.log(`\n✅ ${id} refunded and recorded as 'refunded'.`);
  return { ok: true, txHash: tx.hash, recorded: true };
}

/**
 * Pay back every debt that's safe to settle without a human per case: fix runs
 * that failed purely because Encode had no verification signal to run. The
 * detection is automatic (the pipeline flags them); this is the sweep that
 * makes the payer whole. Simulation by default — `--auto --broadcast` sends.
 * Stops on the first hard failure (e.g. balance) rather than hammering a
 * wallet that can't cover the run.
 */
async function runAuto(broadcast) {
  const owed = listAutoRefundable();
  if (owed.length === 0) {
    console.log('No auto-refundable debts — nothing failed for lack of a verification signal.');
    return;
  }
  console.log(`Auto-refund: ${owed.length} incident(s) failed with no verification signal.`);
  if (!broadcast) console.log('🔍 Simulation only. Re-run with --auto --broadcast to send real USDC.');

  const { provider, wallet, token } = buildWallet();
  let sent = 0;
  for (const incident of owed) {
    const to = incident.payer;
    const usd = incident.settlement?.amount;
    if (!to || !usd) {
      console.error(`⚠️  Skipping ${incident.id}: no payer/amount on record.`);
      continue;
    }
    const result = await executeRefund({
      id: incident.id, to, usd, canRecord: true, incident, broadcast, provider, wallet, token,
    });
    if (!result.ok) {
      console.error(`\n⛔ Stopping the sweep at ${incident.id} — cannot cover this refund.`);
      break;
    }
    if (result.txHash) sent += 1;
  }
  if (broadcast) console.log(`\nDone. ${sent} refund(s) sent.`);
}

async function main() {
  if (process.argv.includes('--list')) {
    printOwed();
    return;
  }

  const broadcast = process.argv.includes('--broadcast');

  if (process.argv.includes('--auto')) {
    await runAuto(broadcast);
    return;
  }

  const id = argValue('--incident');
  if (!id) {
    console.error('❌ --incident inc_xxx is required. Run --list to see who is owed.');
    process.exit(1);
  }

  // Record-only reconciliation: the transfer already happened (e.g. it was
  // sent from a machine without the DB volume), and this just writes the
  // `refunded` status against the incident. It NEVER touches the wallet, so
  // it's the safe way to reconcile — re-running the full refund would send a
  // second transfer, because the only double-send guard is this very record.
  const recordTx = argValue('--record');
  if (recordTx) {
    const recorded = refundIncident(id, { txHash: recordTx, amount: argValue('--usd'), asset: 'USDC', network: 'celo' });
    if (!recorded.ok) {
      console.error(`❌ Could not record refund for ${id}: ${recorded.reason}`);
      process.exit(1);
    }
    console.log(`✅ ${id} marked 'refunded' (tx ${recordTx}). No money moved — record only.`);
    return;
  }

  // Prefer the local store (authoritative and writable). Fall back to the live
  // ledger so a refund can be signed on the machine that holds the key even
  // when the DB volume is only reachable inside the container.
  const incident = getIncident(id);
  let to, usd, canRecord;
  if (incident) {
    if (incident.refund?.txHash) {
      console.error(`❌ ${id} was already refunded: ${incident.refund.txHash}`);
      process.exit(1);
    }
    to = incident.payer;
    usd = incident.settlement?.amount;
    canRecord = true;
    if (!to || !usd) {
      console.error(`❌ ${id} has no payer/amount on record — cannot derive a refund.`);
      process.exit(1);
    }
  } else {
    console.log(`ℹ️  ${id} not in the local store — verifying against the live ledger at ${API_URL}.`);
    ({ to, usd } = await resolveFromLedger(id));
    canRecord = false;
  }

  const { provider, wallet, token } = buildWallet();
  const result = await executeRefund({ id, to, usd, canRecord, incident, broadcast, provider, wallet, token });
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ Refund failed:', err.shortMessage || err.message);
  process.exit(1);
});
