import type { ReactNode } from 'react';

/**
 * Prose primitives for the documentation pages.
 *
 * These exist instead of a `@tailwindcss/typography` dependency because the type
 * scale here is not a generic article scale — it's the same mono/serif/tracking
 * system the dashboard uses, and a plugin's defaults would have to be overridden
 * at nearly every level to match it.
 */

export function Lede({ children }: { children: ReactNode }) {
  return <p className="max-w-[64ch] text-[0.86rem] leading-[1.65] text-muted">{children}</p>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[70ch] text-[0.8rem] leading-[1.7] text-muted">{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 font-display text-[1.15rem] font-normal tracking-[-0.005em] text-ink first:mt-0">
      {children}
    </h3>
  );
}

/** A step heading — numbered in mono, so the sequence is scannable. */
export function Step({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="mt-7 flex items-baseline gap-3 first:mt-0">
      <span className="font-mono text-[0.7rem] font-semibold tracking-[0.08em] text-accent-ink">
        {String(n).padStart(2, '0')}
      </span>
      <span className="font-display text-[1.15rem] font-normal tracking-[-0.005em]">{title}</span>
    </h3>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 flex max-w-[70ch] list-none flex-col gap-2 text-[0.8rem] leading-[1.7] text-muted">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-[0.62em] before:size-1 before:rounded-full before:bg-line-2 before:content-['']">
      {children}
    </li>
  );
}

/** Inline code. Sized down slightly so it sits on the body baseline. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[5px] border border-line bg-surface-2 px-[5px] py-px font-mono text-[0.74rem] text-ink-2">
      {children}
    </code>
  );
}

/**
 * A callout. Used only for things that cost money to get wrong — the accent
 * variant is deliberately rare so it keeps its weight.
 */
export function Callout({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={`mt-4 max-w-[70ch] rounded-card border px-4 py-3.5 text-[0.78rem] leading-[1.65] ${
        tone === 'warn' ? 'border-accent bg-accent/5 text-ink-2' : 'border-line bg-surface-2 text-muted'
      }`}
    >
      {children}
    </div>
  );
}

/** A definition table. `head` is optional — some tables are two bare columns. */
export function Table({ head, rows }: { head?: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-[0.78rem]">
          {head ? (
            <thead>
              <tr>
                {head.map((cell) => (
                  <th
                    key={cell}
                    className="border-b border-line px-4 py-2.5 font-mono text-[0.63rem] font-medium uppercase tracking-[0.08em] text-faint"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody className="[&_tr:last-child_td]:border-b-0">
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="w-[38%] border-b border-line px-4 py-3 align-top text-ink-2">{row[0]}</td>
                <td className="border-b border-line px-4 py-3 align-top leading-[1.6] text-muted">{row[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
