import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Without this, Turbopack walks up past encode/ looking for a lockfile and
  // finds the one in the home directory, which is a separate git repo.
  turbopack: { root: import.meta.dirname },
  // Nothing here is user-uploaded and there are no remote images, so the
  // optimizer would only add a runtime dependency for no benefit.
  images: { unoptimized: true },
};

export default nextConfig;
