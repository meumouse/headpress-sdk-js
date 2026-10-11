"use client";

/**
 * Consent, attribution and the tracker from `@meumouse.com/headpress/analytics`, one of each per page
 * load (module singletons, so React's StrictMode double renders never create a second tracker).
 *
 * - `createConsent()` follows `config.modules.consent` (version, categories, cookie lifetime).
 * - `createTracker()` gets its providers from the store config (`providersFromConfig`): GA4, Meta
 *   Pixel and Pinterest load only after the shopper allows their category; events wait until then.
 * - `createAttribution()` captures the visit on every navigation, for `checkoutAttribution()`.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { HeadpressClient, StoreConfig } from "@meumouse.com/headpress";
import {
  createAttribution,
  createConsent,
  createRelay,
  createTracker,
  providersFromConfig,
  type Attribution,
  type Consent,
  type Tracker,
} from "@meumouse.com/headpress/analytics";
import { useHeadpress, useStoreConfig } from "@meumouse.com/headpress/react";

export interface StorefrontAnalytics {
  consent: Consent;
  attribution: Attribution;
  /** Null on the server and until the store config is known. */
  tracker: Tracker | null;
}

let consentSingleton: Consent | null = null;
let attributionSingleton: Attribution | null = null;
let trackerSingleton: { version: string; tracker: Tracker } | null = null;

function consentFor(hp: HeadpressClient): Consent {
  consentSingleton ??= createConsent({ config: () => hp.capabilities.get("consent") });
  return consentSingleton;
}

function attributionSingletonGet(): Attribution {
  attributionSingleton ??= createAttribution();
  return attributionSingleton;
}

/** One tracker per config version: its providers come from `modules.ga4`, `modules.meta_pixel`… */
function trackerFor(hp: HeadpressClient, config: StoreConfig, consent: Consent): Tracker {
  if (trackerSingleton?.version === config.version) return trackerSingleton.tracker;
  trackerSingleton?.tracker.destroy();
  const tracker = createTracker({
    consent,
    providers: providersFromConfig(config, { load: true }),
    relay: createRelay(hp),
    currency: () => config.commerce?.currency.code,
  });
  trackerSingleton = { version: config.version, tracker };
  return tracker;
}

const AnalyticsContext = createContext<StorefrontAnalytics | null>(null);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const hp = useHeadpress();
  const config = useStoreConfig();
  const pathname = usePathname();

  const value = useMemo<StorefrontAnalytics>(() => {
    const consent = consentFor(hp);
    // Tags and pixels only ever start in the browser.
    const tracker = config && typeof window !== "undefined" ? trackerFor(hp, config, consent) : null;
    return { consent, attribution: attributionSingletonGet(), tracker };
  }, [hp, config]);

  // Every navigation: a page view and the attribution session.
  useEffect(() => {
    value.attribution.capture();
    value.tracker?.track("page_view", { page_location: window.location.href, page_title: document.title });
  }, [pathname, value]);

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): StorefrontAnalytics {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error("useAnalytics() needs <AnalyticsProvider> above it.");
  return value;
}
