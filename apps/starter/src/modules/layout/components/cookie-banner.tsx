"use client";

import { useState } from "react";

import { recordConsent, type Consent, type ConsentState } from "@meumouse.com/headpress/analytics";
import { useHeadpress } from "@meumouse.com/headpress/react";

import { HeadpressCookieConsent } from "@/components/headpress-cookie-consent";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

/**
 * `consent.get()` builds a new object on every call, and the registry banner reads it through
 * `useSyncExternalStore`, which needs the same object until something changes — otherwise React
 * re-renders forever ("Maximum update depth exceeded"). This view caches the state and drops the
 * cache on every change, so the banner copy stays exactly as the shadcn CLI installed it.
 */
function stableConsent(consent: Consent): Consent {
  let cached: ConsentState | null = null;
  const fresh = <T,>(result: T): T => {
    cached = null;
    return result;
  };
  consent.subscribe(() => {
    cached = null;
  });
  return {
    ...consent,
    get: () => (cached ??= consent.get()),
    grant: (categories) => fresh(consent.grant(categories)),
    acceptAll: () => fresh(consent.acceptAll()),
    rejectAll: () => fresh(consent.rejectAll()),
    reset: () => fresh(consent.reset()),
  };
}

/** The registry banner on the shared `createConsent()`; each decision goes to Headpress's consent log. */
export function CookieBanner() {
  const hp = useHeadpress();
  const { consent } = useAnalytics();
  const [view] = useState(() => stableConsent(consent));
  return <HeadpressCookieConsent consent={view} onDecision={(state) => void recordConsent(hp, state)} />;
}
