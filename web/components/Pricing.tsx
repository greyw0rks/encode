import { Panel, SectionHead } from './primitives';
import { Tabs } from './Tabs';
import { TierCard, TierCards } from './TierCard';
import { BranchIcon, CheckIcon, CrossIcon, DocIcon, SearchIcon, TargetIcon, WrenchIcon } from './icons';
import { TIERS } from '@/lib/facts';

const [triage, fix] = TIERS;

/**
 * The pricing section. The segmented switch selects which tier the three cards
 * below describe — the same control the reference uses, doing something real.
 */
export function Pricing() {
  return (
    <Panel id="how">
      <SectionHead title="Two tiers. Both quoted up front." eyebrow="pricing" />

      <div className="mt-4">
        <Tabs
          label="Pricing tier"
          items={[
            {
              id: triage.id,
              label: (
                <>
                  <TargetIcon className="hidden size-3.5 sm:block" />
                  {triage.label} <span className="font-mono text-[0.7rem] tracking-normal opacity-75">{triage.price}</span>
                </>
              ),
              panel: (
                <TierCards>
                  <TierCard icon={<DocIcon />} badge="what you get" title="A cause, not a guess">
                    Encode reads the relevant code and logs and tells you what broke and why — with a severity
                    rating and the files involved.
                  </TierCard>
                  <TierCard icon={<SearchIcon />} title="A repro command">
                    The exact command that demonstrates the failure, so you can confirm the diagnosis yourself
                    rather than take it on faith.
                  </TierCard>
                  <TierCard icon={<CrossIcon />} title="No patch, no PR">
                    Nothing is written to your repo at this tier. If the incident turns out not to be real,
                    Encode says so instead of inventing a fix.
                  </TierCard>
                </TierCards>
              ),
            },
            {
              id: fix.id,
              label: (
                <>
                  {fix.label} <span className="font-mono text-[0.7rem] tracking-normal opacity-75">{fix.price}</span>
                </>
              ),
              panel: (
                <TierCards>
                  <TierCard icon={<WrenchIcon />} badge="everything in triage, plus" title="A patch, with your tests run">
                    Encode writes the fix on a branch and runs your own suite against it. A failing suite is
                    reported as failing, never rounded up.
                  </TierCard>
                  <TierCard icon={<CheckIcon />} title="The original failure re-checked">
                    The repro is run against the <em>unpatched</em> commit too. If it passes on both, that proves
                    nothing — and Encode reports it as unconfirmed.
                  </TierCard>
                  <TierCard icon={<BranchIcon />} title="A PR you review">
                    The branch is pushed and a pull request opened. Encode cannot merge and cannot deploy — the
                    terminal action is always &ldquo;PR opened&rdquo;.
                  </TierCard>
                </TierCards>
              ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
