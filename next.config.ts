import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  devIndicators: false,
  // Set RAP_WATCH_POLL_MS (for example 1000) when the system's file-change events are
  // unavailable and edits do not reload. Polling uses more CPU, so it is off by default.
  ...(Number(process.env.RAP_WATCH_POLL_MS) > 0 ? { watchOptions: { pollIntervalMs: Number(process.env.RAP_WATCH_POLL_MS) } } : {}),
};

export default config;
