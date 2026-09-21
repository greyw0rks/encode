import { Eyebrow, Pill } from './primitives';
import { ArrowRightIcon, BoltIcon } from './icons';

/**
 * The hero. Same copy as the page this replaces, because the claim it makes is
 * exactly the product's scope: it opens a PR, and a human merges.
 */
export function Hero() {
  return (
    <section className="flex min-h-[230px] scroll-mt-6 flex-col justify-between gap-7 rounded-panel border border-line bg-surface p-5">
      <Eyebrow>x402 on Celo · pay per incident</Eyebrow>

      <div>
        <h1 className="font-display text-[clamp(1.9rem,3.6vw,3rem)] font-normal leading-[1.12] tracking-[-0.015em]">
          Something broke.
          <br />
          Get it fixed
          <span className="caret" aria-hidden />
        </h1>
        <p className="mt-3 max-w-[46ch] text-[0.86rem] leading-[1.6] text-muted">
          Encode reads your logs and your code, works out what actually broke, drafts a patch, runs your tests
          against it, and opens a PR. One payment, quoted before it starts. Nothing merges without you.
        </p>
      </div>

      <div className="flex items-end justify-between gap-5">
        <Pill href="/pay" icon={<ArrowRightIcon />} className="w-auto">
          <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.1em]">How to pay</span>
        </Pill>

        {/* The reference's accent action. Duplicates the link beside it, so it's
            hidden from AT rather than announced twice. */}
        <a
          href="/pay"
          aria-hidden
          tabIndex={-1}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent transition-colors hover:bg-[#E63F0B]"
        >
          <BoltIcon className="size-5 text-ink" />
        </a>
      </div>
    </section>
  );
}
