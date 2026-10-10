/**
 * Providers built from the store config: `modules.ga4`, `modules.meta_pixel`, `modules.pinterest`.
 * A module that is off, or has no id, gives no provider. Consent categories follow the consent
 * module's `consent_mode` map (`analytics_storage` for GA4, `ad_storage` for ads), so the store owner
 * decides them in Headpress.
 */
import type { StoreConfig } from "../types.js";
import { consentModeCategory } from "./consent.js";
import { text } from "./env.js";
import { ga4Provider, type Ga4ProviderOptions, type GoogleAdsConversion } from "./ga4.js";
import { metaPixelProvider, type MetaPixelProviderOptions } from "./meta-pixel.js";
import { pinterestProvider, type PinterestProviderOptions } from "./pinterest.js";
import type { AnalyticsProvider } from "./tracker.js";

export interface ProvidersFromConfigOptions {
  /** Inject the official loaders once consent allows (every provider). Defaults to false. */
  load?: boolean;
  /** Extra options per provider (they win over the config). False leaves the provider out. */
  ga4?: Partial<Ga4ProviderOptions> | false;
  metaPixel?: Partial<MetaPixelProviderOptions> | false;
  pinterest?: Partial<PinterestProviderOptions> | false;
}

/** The store's analytics providers. Pass the loaded config (`await hp.config.get()`). */
export function providersFromConfig(
  config: Pick<StoreConfig, "modules"> | null | undefined,
  options: ProvidersFromConfigOptions = {},
): AnalyticsProvider[] {
  const modules = config?.modules ?? {};
  const consent = modules.consent?.enabled ? modules.consent : undefined;
  const analyticsCategory = consentModeCategory("analytics_storage", consent) ?? "analytics";
  const adsCategory = consentModeCategory("ad_storage", consent) ?? "marketing";
  const providers: AnalyticsProvider[] = [];

  const ga4 = modules.ga4;
  const measurementId = text(ga4?.measurement_id);
  if (options.ga4 !== false && ga4?.enabled && measurementId) {
    const labels: Partial<Record<GoogleAdsConversion, string>> = {};
    for (const [event, label] of Object.entries(ga4.google_ads_labels ?? {})) {
      if (text(label)) labels[event as GoogleAdsConversion] = text(label);
    }
    providers.push(
      ga4Provider({
        measurementId,
        googleAdsId: text(ga4.google_ads_id) || undefined,
        googleAdsLabels: labels,
        serverSidePurchase: ga4.server_side === true,
        category: analyticsCategory,
        adsCategory,
        load: options.load,
        ...(options.ga4 ?? {}),
      }),
    );
  }

  const meta = modules.meta_pixel;
  const pixelId = text(meta?.pixel_id);
  if (options.metaPixel !== false && meta?.enabled && pixelId) {
    providers.push(metaPixelProvider({ pixelId, category: adsCategory, load: options.load, ...(options.metaPixel ?? {}) }));
  }

  const pinterest = modules.pinterest;
  const tagId = text(pinterest?.tag_id);
  if (options.pinterest !== false && pinterest?.enabled && tagId) {
    providers.push(
      pinterestProvider({
        tagId,
        enhancedMatch: pinterest.enhanced_match === true,
        category: adsCategory,
        load: options.load,
        ...(options.pinterest ?? {}),
      }),
    );
  }

  return providers;
}
