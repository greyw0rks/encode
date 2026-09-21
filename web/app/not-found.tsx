import type { Metadata } from 'next';
import { Panel, TextLink, Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Eyebrow } from '@/components/primitives';
import { P } from '@/components/prose';

export const metadata: Metadata = { title: 'Not found' };

/**
 * No API reads here. This renders for a bad URL, and a 404 shouldn't fan out to
 * the API or the facilitator — the status column would be noise on a page whose
 * only job is to point back at something real.
 */
export default function NotFound() {
  return (
    <Workspace
      left={<SideNav />}
      main={
        <Panel>
          <Eyebrow>404</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.7rem,3vw,2.4rem)] font-normal leading-[1.15] tracking-[-0.015em]">
            There&apos;s nothing at this address.
          </h1>
          <P>
            If you followed a link to an incident, the id may be wrong — incidents are only listed on the{' '}
            <TextLink href="/ledger">settlement ledger</TextLink> once their payment has settled.
          </P>
          <P>
            Otherwise: <TextLink href="/">the home page</TextLink>,{' '}
            <TextLink href="/how-it-works">how it works</TextLink>, or{' '}
            <TextLink href="/pay">how to pay</TextLink>.
          </P>
        </Panel>
      }
    />
  );
}
