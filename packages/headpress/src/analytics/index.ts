/**
 * `@meumouse/headpress/analytics`: consent, canonical events, providers (GA4, Meta Pixel,
 * Pinterest), Headpress' Conversions API relay, purchase tracking, order attribution, abandoned
 * carts and recovery links.
 *
 * Framework-agnostic and safe to import on the server: nothing touches the browser at import time,
 * and every browser API is guarded. Functions that call Headpress take the client as a parameter.
 *
 * ```ts
 * import { createConsent, createTracker, createRelay, providersFromConfig } from "@meumouse/headpress/analytics";
 *
 * const config = await hp.config.get();
 * const consent = createConsent({ config: () => hp.capabilities.get("consent") });
 * const tracker = createTracker({ consent, providers: providersFromConfig(config, { load: true }), relay: createRelay(hp) });
 * tracker.track("page_view", { page_location: location.href });
 * ```
 */
export {
  checkoutConsent,
  consentModeCategory,
  consentModeDefaults,
  consentModeState,
  createConsent,
  DEFAULT_CONSENT_CATEGORIES,
  DEFAULT_CONSENT_MODE,
  knownCategories,
  recordConsent,
  requiredCategories,
  type Consent,
  type ConsentConfigSource,
  type ConsentModeDefaults,
  type ConsentModeState,
  type ConsentModeType,
  type ConsentOptions,
  type ConsentSignal,
  type ConsentState,
  type RecordConsentOptions,
} from "./consent.js";

export {
  cartEventParams,
  itemFromCartItem,
  itemFromProduct,
  productEventParams,
  type AnalyticsIdentity,
  type AnalyticsItem,
  type AnyEventParams,
  type CanonicalEvent,
  type EcommerceParams,
  type EventParams,
  type EventParamsMap,
  type ItemOptions,
  type ListParams,
} from "./events.js";

export { eventId, purchaseEventId } from "./event-id.js";

export {
  createTracker,
  type AnalyticsProvider,
  type EventContext,
  type ProviderContext,
  type RelayDraft,
  type TrackArgs,
  type Tracker,
  type TrackerOptions,
  type TrackOptions,
} from "./tracker.js";

export { cleanIdentity, localIdentity, memoryIdentity, type IdentityStore, type LocalIdentityOptions } from "./identity.js";

export { ga4Provider, type Ga4ProviderOptions, type GoogleAdsConversion } from "./ga4.js";
export { META_EVENTS, metaParams, metaPixelProvider, type MetaPixelProviderOptions } from "./meta-pixel.js";
export {
  PINTEREST_EVENTS,
  PINTEREST_RELAY_EVENTS,
  pinterestProvider,
  type PinterestProviderOptions,
} from "./pinterest.js";
export { providersFromConfig, type ProvidersFromConfigOptions } from "./providers.js";

export {
  createRelay,
  type Relay,
  type RelayEvent,
  type RelayIdentity,
  type RelayOptions,
  type RelayParams,
  type RelayProvider,
  type RelayResult,
} from "./relay.js";

export { getOrderAnalytics, trackPurchase, type OrderAnalytics, type TrackPurchaseInput } from "./purchase.js";

export {
  browserIds,
  captureClickIds,
  parseGaClientId,
  parseGaSessionId,
  type BrowserIds,
  type BrowserIdsOptions,
} from "./browser-ids.js";

export {
  checkoutAttribution,
  createAttribution,
  type Attribution,
  type AttributionOptions,
  type AttributionSnapshot,
  type CheckoutAttributionOptions,
  type SourceType,
} from "./attribution.js";

export { captureAbandonedCart, type AbandonedCartInput } from "./abandoned-cart.js";

export { consumeRecoveryToken, withoutParam } from "./recovery.js";
