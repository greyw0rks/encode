import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Layout and surface primitives.
 *
 * The design's depth comes from stepping surfaces (canvas → shell → surface →
 * surface-2) and 1px hairlines. There are deliberately no shadow utilities used
 * anywhere in here — see the note in `app/globals.css`.
 */

/** The floating master frame the whole page sits inside. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1400px] rounded-[20px] border border-line-2 bg-shell p-3 sm:rounded-frame sm:p-5">
      {children}
    </div>
  );
}

/**
 * The three-column workspace. Below 1120px the columns stop being columns, and
 * the order changes: the centre column carries the actual pitch, so it comes
 * first on mobile regardless of source order.
 */
export function Workspace({ left, main, right }: { left?: ReactNode; main: ReactNode; right?: ReactNode }) {
  return (
    <div className="grid items-start gap-[18px] grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,3fr)_minmax(0,6.5fr)_minmax(0,3fr)]">
      {left ? <aside className="order-2 flex min-w-0 flex-col gap-[18px] xl:order-1">{left}</aside> : null}
      <main id="main" className="order-1 flex min-w-0 flex-col gap-[18px] xl:order-2">
        {main}
      </main>
      {right ? <aside className="order-3 flex min-w-0 flex-col gap-[18px]">{right}</aside> : null}
    </div>
  );
}

export function Panel({
  children,
  id,
  className = '',
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      // `scroll-mt` keeps an in-page anchor from landing under the top of the
      // viewport, since the frame has its own padding above it.
      className={`min-w-0 scroll-mt-6 rounded-panel border border-line bg-surface p-5 ${className}`}
    >
      {children}
    </section>
  );
}

/** A small uppercase mono label. Carries hierarchy through tracking, not lightness. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[0.65rem] uppercase tracking-[0.11em] text-faint ${className}`}>
      {children}
    </span>
  );
}

export function SectionHead({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-4">
      <h2 className="font-display text-[clamp(1.4rem,2.4vw,1.9rem)] font-normal tracking-[-0.01em]">{title}</h2>
      <Eyebrow>{eyebrow}</Eyebrow>
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.09em] text-accent-ink">
      {children}
    </span>
  );
}

/** The accent status dot. Dimmed rather than recoloured — see StatusColumn. */
export function Dot({ dim = false }: { dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
      style={{ opacity: dim ? 0.35 : 1 }}
    />
  );
}

const PILL_BASE =
  'flex w-full items-center gap-2.5 rounded-full border border-line bg-surface-2 px-4 py-[11px] text-[0.8rem] font-medium text-ink-2 transition-colors hover:border-faint hover:text-ink';

/**
 * A pill link. `external` opens in a new tab with `rel=noopener`; `emphasis`
 * adds the accent-chip affordance the reference uses for its primary action.
 */
export function Pill({
  href,
  children,
  icon,
  emphasis = false,
  external = false,
  className = '',
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  emphasis?: boolean;
  external?: boolean;
  className?: string;
}) {
  const content = emphasis ? (
    <>
      <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.1em]">{children}</span>
      <span className="ml-auto flex size-6 items-center justify-center rounded-[7px] bg-accent/12 transition-colors group-hover:bg-accent [&_svg]:size-[13px] [&_svg]:stroke-accent group-hover:[&_svg]:stroke-white">
        {icon}
      </span>
    </>
  ) : (
    <>
      {icon ? <span className="[&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-muted group-hover:[&_svg]:stroke-ink">{icon}</span> : null}
      <span>{children}</span>
    </>
  );

  const classes = `group ${PILL_BASE} ${className}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener" className={classes}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}

/** An inline text link, underlined by a hairline that darkens on hover. */
export function TextLink({
  href,
  children,
  external = false,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  const classes = 'border-b border-line-2 text-ink-2 transition-colors hover:border-ink hover:text-ink';
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

/**
 * A single figure. `flag` turns the card accent — used only for "paid, not
 * delivered", where a non-zero value is the most important number on the page
 * and a zero is good news that shouldn't shout.
 */
export function Metric({ value, label, flag = false }: { value: ReactNode; label: string; flag?: boolean }) {
  return (
    <div className={`rounded-card border bg-surface-2 px-3.5 py-3 ${flag ? 'border-accent' : 'border-line'}`}>
      <div className={`font-display text-[1.5rem] leading-none ${flag ? 'text-accent-ink' : ''}`}>{value}</div>
      <div className="mt-1.5 font-mono text-[0.58rem] uppercase leading-[1.4] tracking-[0.07em] text-faint">
        {label}
      </div>
    </div>
  );
}

/** A mono footnote under a section. */
export function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mt-3 font-mono text-[0.66rem] leading-[1.7] text-faint ${className}`}>{children}</p>
  );
}
