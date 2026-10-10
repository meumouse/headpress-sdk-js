"use client";

import type { ReactNode } from "react";

import type { StoreConfig } from "@meumouse/headpress";
import { HeadpressProvider } from "@meumouse/headpress/react";

import { hp } from "@/lib/headpress";
import { AnalyticsProvider } from "@/modules/analytics/analytics-provider";

/** The shared client, seeded with the config the server rendered with (no second fetch). */
export function Providers({ config, children }: { config: StoreConfig | null; children: ReactNode }) {
  return (
    <HeadpressProvider client={hp} initialConfig={config}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </HeadpressProvider>
  );
}
