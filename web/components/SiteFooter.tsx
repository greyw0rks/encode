import { REPO_URL } from '@/lib/facts';
import { TextLink } from './primitives';

export function SiteFooter() {
  return (
    <div className="mt-[18px] flex flex-wrap items-center justify-between gap-3.5 px-1.5 font-mono text-[0.64rem] text-faint">
      <span>Built for Celo Agents at Work · x402 on Celo</span>
      <span>
        <TextLink href={REPO_URL} external>
          Source
        </TextLink>
      </span>
    </div>
  );
}
