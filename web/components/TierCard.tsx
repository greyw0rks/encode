import type { ReactNode } from 'react';
import { Badge } from './primitives';

/**
 * One of the three cards under a pricing tier. `badge` only appears on the
 * first card of a tier, which is where the reference puts its label.
 */
export function TierCard({
  icon,
  badge,
  title,
  children,
}: {
  icon: ReactNode;
  badge?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col justify-between gap-3 rounded-card border border-line bg-surface-2 p-4 transition-colors hover:border-faint sm:gap-[22px]">
      <div className="flex items-center justify-between gap-2">
        <span
          aria-hidden
          className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-line bg-[#F1F0EC] [&_svg]:size-[15px] [&_svg]:stroke-muted"
        >
          {icon}
        </span>
        {badge ? <Badge>{badge}</Badge> : null}
      </div>
      <p className="text-[0.78rem] leading-[1.62] text-muted">
        <strong className="mb-1.5 block text-[0.82rem] font-semibold text-ink">{title}</strong>
        {children}
      </p>
    </article>
  );
}

export function TierCards({ children }: { children: ReactNode }) {
  // Stacked, the cards are as wide as the panel, so the gap that balanced a tall
  // narrow column just reads as a hole — hence the tighter card gap on mobile.
  return <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">{children}</div>;
}
