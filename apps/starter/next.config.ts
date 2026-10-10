import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@meumouse/headpress` is a workspace link in this monorepo; outside it, it is a normal dependency.
  // Images come from WordPress with their own srcset, so the starter renders plain <img> tags.

  // Keep `next dev` from writing an AGENTS.md into the app.
  agentRules: false,
};

export default nextConfig;
