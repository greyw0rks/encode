import type { ReactNode } from 'react';

/**
 * A dark code block with hand-marked syntax colours.
 *
 * No highlighter dependency: these samples are fixed, short, and hand-tuned to
 * the four-colour palette below. Shipping a tokenizer to colour a dozen lines of
 * HTTP that never change would be a runtime cost for nothing.
 *
 * Samples are written as plain template strings with inline spans marked
 * `[[k|text]]`, rather than as interleaved JSX. The JSX form needed every brace,
 * quote and newline escaped by hand, which made the samples hard to read and
 * easy to break — and a `//` comment sitting in JSX children isn't a comment at
 * all, it's rendered text.
 *
 *   k — keywords, headers, comments
 *   n — object keys and identifiers
 *   v — string and number values
 *   r — responses; the accent, used sparingly so it stays the eye's anchor
 */

const COLOURS = {
  k: 'text-[#8A8880]',
  n: 'text-[#F0A47E]',
  v: 'text-[#BFD8B4]',
  r: 'text-accent',
} as const;

type Kind = keyof typeof COLOURS;

const MARKER = /\[\[([knvr])\|([\s\S]*?)\]\]/g;

function highlight(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;

  for (const match of source.matchAll(MARKER)) {
    const [raw, kind, text] = match;
    if (match.index > cursor) out.push(source.slice(cursor, match.index));
    out.push(
      <span key={match.index} className={COLOURS[kind as Kind]}>
        {text}
      </span>
    );
    cursor = match.index + raw.length;
  }

  if (cursor < source.length) out.push(source.slice(cursor));
  return out;
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-card bg-code-bg px-5 py-5 font-mono text-[0.74rem] leading-[1.8] text-code-fg">
      <code>{highlight(children.trim())}</code>
    </pre>
  );
}
