'use client';

import { useId, useRef, useState, type ReactNode } from 'react';

export type TabItem = { id: string; label: ReactNode; panel: ReactNode };

/**
 * A tablist. Two visual variants, one behaviour.
 *
 * The original page rendered every panel into the DOM and toggled `hidden`, so
 * the content stayed reachable with JS off. That trade doesn't survive the move
 * to React — an interactive component needs its JS either way — so the panels
 * are mounted conditionally instead. What replaces it is that no panel is the
 * only route to its information: pricing is also on /how-it-works and the
 * integration examples are also in PAYING.md, both linked in plain text.
 *
 * Roving tabindex + arrow keys, because that's what a tablist is expected to do
 * and the reference's segmented switch reads as one.
 */
export function Tabs({
  items,
  label,
  variant = 'switch',
}: {
  items: TabItem[];
  label: string;
  variant?: 'switch' | 'chips';
}) {
  const [active, setActive] = useState(items[0]?.id);
  const base = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (from: string, delta: number) => {
    const index = items.findIndex((item) => item.id === from);
    const next = items[(index + delta + items.length) % items.length];
    setActive(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const isSwitch = variant === 'switch';

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        className={
          isSwitch
            ? 'grid grid-cols-2 gap-1 rounded-full border border-line bg-surface-2 p-1'
            : 'flex flex-wrap gap-1.5'
        }
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-controls={`${base}-panel-${item.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') move(item.id, 1);
                else if (event.key === 'ArrowLeft') move(item.id, -1);
                else return;
                event.preventDefault();
              }}
              className={
                isSwitch
                  ? // `whitespace-nowrap`: "Fix & PR" wrapped onto two lines at
                    // 390px and made the two halves different heights.
                    `flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-2.5 py-3 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.05em] transition-colors sm:text-[0.7rem] sm:tracking-[0.09em] ${
                      selected ? 'bg-ink text-white' : 'text-faint hover:text-ink-2'
                    }`
                  : `cursor-pointer rounded-full border px-3.5 py-[7px] font-mono text-[0.66rem] font-semibold uppercase tracking-[0.08em] transition-colors ${
                      selected
                        ? 'border-ink bg-ink text-white'
                        : 'border-line bg-surface-2 text-muted hover:text-ink-2'
                    }`
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) =>
        item.id === active ? (
          <div
            key={item.id}
            role="tabpanel"
            id={`${base}-panel-${item.id}`}
            aria-labelledby={`${base}-tab-${item.id}`}
            tabIndex={0}
          >
            {item.panel}
          </div>
        ) : null
      )}
    </>
  );
}
