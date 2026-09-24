import { getDashboard, getStatus } from '@/lib/api';
import { Workspace } from '@/components/primitives';
import { SideNav } from '@/components/SideNav';
import { Hero } from '@/components/Hero';
import { Pricing } from '@/components/Pricing';
import { Ledger } from '@/components/Ledger';
import { DocsSection } from '@/components/DocsSection';
import { Timeline } from '@/components/Timeline';
import { StatusColumn } from '@/components/StatusColumn';

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The ledger is the live evidence the whole page rests on, and a static
 * prerender bakes in whatever the API said during the build — which for a build
 * run against an empty or unreachable API means shipping "no settlements yet",
 * or "unavailable", as a permanent fact. The API isn't hammered for it: the
 * fetches in `lib/api.ts` carry their own revalidate windows, so the Data Cache
 * still collapses this to one call per window.
 */
export const dynamic = 'force-dynamic';

/**
 * Both reads happen server-side and in parallel, so the ledger's real numbers
 * are in the first HTML rather than arriving after a client round-trip — which
 * also means a visitor with JS blocked sees the same figures. Neither call can
 * throw: an unreachable API resolves to `{ ok: false, reason }` and the
 * components render "unavailable" instead of zeros.
 */
export default async function HomePage() {
  const [dashboard, status] = await Promise.all([getDashboard(), getStatus()]);

  return (
    <Workspace
      left={
        <>
          <SideNav current="home" />
          <Timeline dashboard={dashboard} />
        </>
      }
      main={
        <>
          <Hero />
          <Pricing />
          <Ledger dashboard={dashboard} limit={8} />
          <DocsSection />
        </>
      }
      right={<StatusColumn status={status} dashboard={dashboard} />}
    />
  );
}
