/**
 * Registers Encode's ERC-8004 agent identity on Celo mainnet.
 *
 * This is a REAL mainnet transaction spending real CELO. It mints an
 * ERC-721 from the Identity Registry whose tokenURI is Encode's
 * registration file. The resulting agentId is what celobuilders.xyz wants
 * as `erc8004Url`, and registration there is gated on it.
 *
 * Run once. Registering twice mints a second identity and wastes gas —
 * the script refuses if AGENT_ID is already set in .env.
 *
 *   node scripts/registerAgentIdentity.js          # simulate, costs nothing
 *   node scripts/registerAgentIdentity.js --broadcast
 *
 * The private key is read from the path in DEPLOYER_ENV_PATH (or the
 * Arcadia contracts env by default) rather than copied into this repo's
 * .env — one funded Celo key, one place it lives.
 */
import '../src/config/env.js';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';

const IDENTITY_REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REGISTRY_ABI = [
  'function register(string agentURI) returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const DEFAULT_KEY_PATH = '/home/greyw0rks/Arcadia/arcadia-contracts/celo/.env';
const AGENT_URI =
  process.env.ERC8004_AGENT_URI ||
  'https://raw.githubusercontent.com/greyw0rks/encode/main/agent-registration.json';

function loadPrivateKey() {
  const path = process.env.DEPLOYER_ENV_PATH || DEFAULT_KEY_PATH;
  const match = readFileSync(path, 'utf8').match(/^PRIVATE_KEY=(.+)$/m);
  if (!match) throw new Error(`PRIVATE_KEY not found in ${path}`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

async function main() {
  const broadcast = process.argv.includes('--broadcast');

  if (process.env.ERC8004_AGENT_ID) {
    console.error(
      `❌ ERC8004_AGENT_ID is already set to ${process.env.ERC8004_AGENT_ID}. Encode is already registered — remove it from .env only if you genuinely want a second identity.`
    );
    process.exit(1);
  }

  // The registration file has to actually resolve before minting — the
  // agentURI is immutable-ish (updatable, but only by another tx) and a
  // 404 makes the identity useless to anyone reading it.
  const res = await fetch(AGENT_URI);
  if (!res.ok) {
    console.error(`❌ agentURI does not resolve (${res.status}): ${AGENT_URI}`);
    process.exit(1);
  }
  const registration = await res.json();
  console.log(`✅ agentURI resolves: ${registration.name} — x402Support: ${registration.x402Support}`);

  const provider = new ethers.JsonRpcProvider('https://forno.celo.org');
  const wallet = new ethers.Wallet(loadPrivateKey(), provider);
  const registry = new ethers.Contract(IDENTITY_REGISTRY, REGISTRY_ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  const gas = await registry.register.estimateGas(AGENT_URI);
  const fee = await provider.getFeeData();
  const cost = gas * (fee.gasPrice ?? 0n);

  console.log(`\nRegistry:  ${IDENTITY_REGISTRY} (Celo mainnet)`);
  console.log(`Owner:     ${wallet.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} CELO`);
  console.log(`agentURI:  ${AGENT_URI}`);
  console.log(`Gas:       ${gas} @ ${ethers.formatUnits(fee.gasPrice ?? 0n, 'gwei')} gwei`);
  console.log(`Est. cost: ${ethers.formatEther(cost)} CELO`);

  if (balance < cost * 2n) {
    console.error(`\n❌ Balance too low — want at least 2× the estimate as headroom.`);
    process.exit(1);
  }

  if (!broadcast) {
    console.log('\n🔍 Simulation only. Re-run with --broadcast to actually register (spends real CELO).');
    return;
  }

  console.log('\n⏳ Broadcasting...');
  const tx = await registry.register(AGENT_URI);
  console.log(`   tx: ${tx.hash}`);
  console.log(`   https://celoscan.io/tx/${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`   mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

  // agentId comes off the Registered event — it's assigned by the
  // registry, not chosen, so the event is the only source of truth.
  const registered = receipt.logs
    .map((log) => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === 'Registered');

  if (!registered) {
    console.error('\n⚠️  Transaction mined but no Registered event found. Check the tx on Celoscan.');
    process.exit(1);
  }

  const agentId = registered.args.agentId.toString();
  console.log(`\n✅ Registered. agentId: ${agentId}`);
  console.log(`   8004scan:  https://www.8004scan.io/agents/celo/${agentId}`);
  console.log(`   Celoscan:  https://celoscan.io/nft/${IDENTITY_REGISTRY}/${agentId}`);
  console.log(`\nAdd to .env:`);
  console.log(`   ERC8004_AGENT_ID=${agentId}`);
  console.log(`   ENCODE_WALLET_ADDRESS=${wallet.address}`);
}

main().catch((err) => {
  console.error('\n❌ Registration failed:', err.shortMessage || err.message);
  process.exit(1);
});
