import Link from 'next/link';
import { Panel, Pill } from './primitives';
import { AGENT, REPO_URL } from '@/lib/facts';
import { BoltIcon, CodeIcon, DocIcon, HomeIcon, LedgerIcon, PlusIcon } from './icons';

/**
 * The left column's identity + navigation panel.
 *
 * The original single page used in-page anchors for all of these. Now that
 * pricing, docs and the ledger are real routes, they're real links — but the
 * home page keeps its anchors for the sections that live on it, so a visitor
 * who lands there can still move around without a navigation.
 */
export function SideNav({ current }: { current?: 'home' | 'how' | 'pay' | 'ledger' }) {
  const items = [
    { href: '/how-it-works', id: 'how', label: 'How it works', icon: <HomeIcon /> },
    { href: '/pay', id: 'pay', label: 'Docs & payment', icon: <DocIcon /> },
    { href: '/ledger', id: 'ledger', label: 'Settlement ledger', icon: <LedgerIcon /> },
  ] as const;

  return (
    <Panel>
      <Link href="/" className="mb-4 flex items-center gap-2 font-brand text-[0.78rem] font-extrabold uppercase tracking-[0.2em]">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink">
          <BoltIcon className="size-[11px]" />
        </span>
        Encode
      </Link>

      <Pill href="/pay" emphasis icon={<PlusIcon />} className="mb-3">
        File an incident
      </Pill>

      <nav aria-label="Sections" className="flex flex-col gap-2">
        {items.map((item) => (
          <Pill
            key={item.href}
            href={item.href}
            icon={item.icon}
            // The current page is still a link — it's a route, and marking it
            // is what tells a screen reader where it already is.
            className={current === item.id ? 'border-faint text-ink' : ''}
          >
            {item.label}
          </Pill>
        ))}
        <Pill href={REPO_URL} icon={<CodeIcon />} external>
          Source
        </Pill>
      </nav>

      <p className="mt-4 border-t border-line pt-4 font-mono text-[0.62rem] leading-[1.6] text-faint">
        ERC-8004 agent {AGENT.id} on Celo mainnet.
      </p>
    </Panel>
  );
}
