/**
 * The icon set the page actually uses, inlined.
 *
 * These are 1.8–2.5 stroke-weight outline glyphs sharing a 24×24 box, sized by
 * the caller through `className`. `stroke="currentColor"` is what lets a pill
 * or card recolour its icon on hover without a second rule per icon.
 *
 * All of them are decorative — the surrounding text carries the meaning — so
 * they're `aria-hidden` at the source rather than at every call site.
 */

type IconProps = { className?: string };

const outline = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function BoltIcon({ className }: IconProps) {
  // The brand mark, and the only filled glyph — it reads as a shape, not a line.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...outline} strokeWidth={2.5} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...outline} strokeWidth={2} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M3 10.5 12 3l9 7.5V21H3z" />
    </svg>
  );
}

export function DocIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M4 4h11l5 5v11H4z" />
      <path d="M15 4v5h5" />
    </svg>
  );
}

export function LedgerIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function CodeIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="m9 18-6-6 6-6M15 6l6 6-6 6" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function WrenchIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="m4 20 4-1 9-9-3-3-9 9-1 4Z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function BranchIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M6 8.5v7M8.5 6h7" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" />
    </svg>
  );
}

export function CardIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M4 7h16v12H4z" />
      <path d="M4 11h16" />
    </svg>
  );
}

export function WarningIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function DollarIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7" />
    </svg>
  );
}

export function TargetIcon({ className }: IconProps) {
  return (
    <svg {...outline} strokeWidth={2} className={className}>
      <path d="M11 3a8 8 0 1 0 8 8h-8V3Z" />
    </svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <svg {...outline} className={className}>
      <path d="M3 5h18v14H3z" />
      <path d="m7 10 2.5 2L7 14M12.5 14H17" />
    </svg>
  );
}
