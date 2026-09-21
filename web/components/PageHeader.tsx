import type { ReactNode } from 'react';
import { Eyebrow, Panel } from './primitives';

/**
 * The header block every sub-page opens with. Keeps the display/eyebrow pairing
 * consistent with the home page's `SectionHead` without pulling the ledger's
 * baseline-aligned layout onto a page that has a lede under it.
 */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Panel>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-2 font-display text-[clamp(1.7rem,3vw,2.4rem)] font-normal leading-[1.15] tracking-[-0.015em]">
        {title}
      </h1>
      {children ? <div className="mt-3">{children}</div> : null}
    </Panel>
  );
}
