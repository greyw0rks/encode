import { Note, Panel, SectionHead, TextLink } from './primitives';
import { Code } from './Code';
import { Tabs } from './Tabs';
import { AGENT, CELO_CHAIN_ID, PROOF, TIERS, USDC } from '@/lib/facts';

const [, fix] = TIERS;

/**
 * The integration section: what the 402 exchange looks like on the wire, and
 * what paying it from your own code takes.
 *
 * The values in the samples are the real ones — mainnet USDC, the real payout
 * address, USDC's actual EIP-712 domain version — because a payer checks the
 * `payTo` in the quote against what Encode publishes, and a doctored example is
 * how that check gets trained away. They're interpolated from `lib/facts` so a
 * change to the payout address can't leave a stale copy here.
 */
const HTTP_EXCHANGE = `
[[k|POST]] /v1/incidents [[k|HTTP/1.1]]

[[r|← 402 Payment Required]]
{
  [[n|"x402Version"]]: [[v|1]],
  [[n|"accepts"]]: [{
    [[n|"scheme"]]: [[v|"exact"]],
    [[n|"network"]]: [[v|"celo"]],
    [[n|"maxAmountRequired"]]: [[v|"${fix.baseUnits}"]],
    [[n|"asset"]]: [[v|"${USDC.address.slice(0, 6)}…${USDC.address.slice(-4)}"]],
    [[n|"payTo"]]: [[v|"${AGENT.payTo.slice(0, 6)}…${AGENT.payTo.slice(-4)}"]]
  }],
  [[n|"quote"]]: { [[n|"usd"]]: [[v|"0.50"]], [[n|"asset"]]: [[v|"USDC"]] },
  [[n|"eip712"]]: {
    [[n|"primaryType"]]: [[v|"TransferWithAuthorization"]],
    [[n|"domain"]]: { [[n|"name"]]: [[v|"USDC"]], [[n|"version"]]: [[v|"${USDC.eip712Version}"]],
                [[n|"chainId"]]: [[v|${CELO_CHAIN_ID}]] }
  }
}

[[k|POST]] /v1/incidents [[k|HTTP/1.1]]
[[k|X-PAYMENT:]] [[k|<base64 signed authorization>]]

[[r|← 202 Accepted]]
{
  [[n|"id"]]: [[v|"inc_8Kd2mQ…"]],
  [[n|"status"]]: [[v|"detected"]],
  [[n|"statusUrl"]]: [[v|"/v1/incidents/inc_8Kd2mQ…"]]
}
`;

const SIGN_EXAMPLE = `
[[k|import]] { Wallet } [[k|from]] [[v|'ethers']];
[[k|import]] { payAndRequest } [[k|from]] [[v|'./x402Client.js']];

[[k|// Quote, sign, retry — one call.]]
[[k|const]] result = [[k|await]] [[n|payAndRequest]]({
  url: [[v|'https://encode-api-production.up.railway.app/v1/incidents']],
  body: {
    summary: [[v|'Export job emits duplicate rows']],
    repo: { owner: [[v|'you']], name: [[v|'your-app']] },
    tier: [[v|'fix']],
  },
  signer: [[k|new]] [[n|Wallet]](process.env.[[n|PRIVATE_KEY]]),

  [[k|// Refuses to sign above this. Without it, a]]
  [[k|// buggy server could quote any amount.]]
  maxAmountUsd: [[v|1]],
});

console.[[n|log]](result.body.statusUrl);
[[r|→ /v1/incidents/inc_8Kd2mQ…]]
`;

export function DocsSection() {
  return (
    <Panel id="docs">
      <SectionHead title="An x402 endpoint. Any agent can hire it." eyebrow="docs" />

      <p className="mt-3 max-w-[64ch] text-[0.86rem] leading-[1.6] text-muted">
        No account, no API key negotiation. Send a request; if payment is required you get a 402 carrying the
        price, the payout address, and the exact EIP-712 domain to sign against. What you sign is an EIP-3009
        authorization — one pull, one amount, inside a window you set. Signing costs no gas and moves nothing on
        its own; the facilitator submits it and pays that gas.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Tabs
          label="Integration examples"
          variant="chips"
          items={[
            { id: 'http', label: '402 exchange', panel: <Code>{HTTP_EXCHANGE}</Code> },
            { id: 'sign', label: 'Pay it', panel: <Code>{SIGN_EXAMPLE}</Code> },
          ]}
        />
      </div>

      <Note>
        The authorization is single-use and expires in 10 minutes by default. A second 402 after paying is never
        retried — retrying would sign twice for the same work. The client is{' '}
        <TextLink href={PROOF.clientSource} external>
          ~200 lines with one dependency
        </TextLink>
        ; full walkthrough in <TextLink href="/pay">the payment guide</TextLink>.
      </Note>
    </Panel>
  );
}
