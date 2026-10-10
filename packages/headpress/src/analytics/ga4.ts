/**
 * Google Analytics 4 (and Google Ads conversions) through `gtag` / the data layer.
 *
 * - `mode: "gtag"` (default) sends `gtag('event', name, params)`. `mode: "dataLayer"` pushes GTM's
 *   e-commerce format (`{ ecommerce: null }`, then `{ event, event_id, ecommerce, … }`) for stores whose
 *   GA4 tag lives in a Google Tag Manager container.
 * - Google Consent Mode v2: the provider pushes `consent default` when the tracker is created and
 *   `consent update` on every decision, mapped through the consent module's `consent_mode`. For a
 *   container that loads before the tracker, call `gtag('consent', 'default', consentModeDefaults())`
 *   in an inline head script instead.
 * - `load: true` injects the official `gtag.js` loader, only once the provider's category is granted.
 *   Without it the store loads its own tag; the provider only talks to `gtag` / the data layer.
 * - Google Ads conversions fire for `purchase`, `begin_checkout`, `add_to_cart` and `generate_lead`
 *   when a label exists, under the advertising category.
 */
import type { ConsentModuleConfig } from "../types.js";
import { consentModeDefaults, consentModeState, type ConsentState } from "./consent.js";
import { browserWindow, injectScript } from "./env.js";
import type { AnalyticsItem, AnyEventParams, CanonicalEvent } from "./events.js";
import type { AnalyticsProvider } from "./tracker.js";

export type GoogleAdsConversion = "purchase" | "begin_checkout" | "add_to_cart" | "generate_lead";

export interface Ga4ProviderOptions {
  /** `G-XXXXXXX`. */
  measurementId: string;
  /** `AW-123456789`. */
  googleAdsId?: string;
  /** Conversion label per event (the part after the slash, or a full `AW-…/label`). Empty labels are skipped. */
  googleAdsLabels?: Partial<Record<GoogleAdsConversion, string>>;
  /** Data layer variable. Defaults to `dataLayer`. */
  dataLayerName?: string;
  /** `gtag` events (default) or GTM e-commerce data layer pushes. */
  mode?: "gtag" | "dataLayer";
  /** Inject gtag.js once the category is granted. Defaults to false. */
  load?: boolean;
  /** Consent category GA4 needs. Defaults to `analytics`; null lets Consent Mode alone decide. */
  category?: string | null;
  /** Consent category of Google Ads conversions. Defaults to `marketing`. */
  adsCategory?: string;
  /** Headpress sends the purchase with the Measurement Protocol (`ga4.server_side`): skip the browser one. */
  serverSidePurchase?: boolean;
  /** Push `gtag('consent', 'default', …)` when the tracker is created. Defaults to true. */
  consentDefaults?: boolean;
}

type Gtag = (...args: unknown[]) => void;

/** Keys of GTM's `ecommerce` object; the rest of the params go at the top level of the push. */
const ECOMMERCE_KEYS = new Set([
  "currency",
  "value",
  "items",
  "transaction_id",
  "tax",
  "shipping",
  "coupon",
  "payment_type",
  "shipping_tier",
  "item_list_id",
  "item_list_name",
]);

const ADS_EVENTS = new Set<CanonicalEvent>(["purchase", "begin_checkout", "add_to_cart", "generate_lead"]);

function ga4Items(items: AnalyticsItem[] | undefined): AnalyticsItem[] | undefined {
  // catalog_id is for the Meta / Pinterest catalogs; GA4 groups by item_id.
  return items?.map(({ catalog_id: _catalog, ...item }) => item as AnalyticsItem);
}

export function ga4Provider(options: Ga4ProviderOptions): AnalyticsProvider {
  const layerName = options.dataLayerName ?? "dataLayer";
  const mode = options.mode ?? "gtag";
  const adsCategory = options.adsCategory ?? "marketing";
  const labels = options.googleAdsLabels ?? {};
  let loaded = false;

  const dataLayer = (): unknown[] | undefined => {
    const win = browserWindow() as (Window & Record<string, unknown>) | undefined;
    if (!win) return undefined;
    if (!Array.isArray(win[layerName])) win[layerName] = [];
    return win[layerName] as unknown[];
  };

  /** `window.gtag`, defined like Google's snippet (it must push `arguments`, not an array). */
  const gtag = (): Gtag | undefined => {
    const win = browserWindow() as (Window & { gtag?: Gtag }) | undefined;
    const layer = dataLayer();
    if (!win || !layer) return undefined;
    if (typeof win.gtag !== "function") {
      win.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        layer.push(arguments);
      };
    }
    return win.gtag;
  };

  const pushConsent = (kind: "default" | "update", signals: Record<string, unknown>): void => {
    gtag()?.("consent", kind, signals);
  };

  const conversion = (event: CanonicalEvent, params: AnyEventParams): void => {
    const label = ADS_EVENTS.has(event) ? labels[event as GoogleAdsConversion]?.trim() : undefined;
    if (!label || !options.googleAdsId) return;
    const sendTo = label.includes("/") ? label : `${options.googleAdsId}/${label}`;
    const payload: Record<string, unknown> = { send_to: sendTo };
    if (params.value !== undefined) payload.value = params.value;
    if (params.currency !== undefined) payload.currency = params.currency;
    if (params.transaction_id !== undefined) payload.transaction_id = params.transaction_id;
    gtag()?.("event", "conversion", payload);
  };

  return {
    name: "ga4",
    category: options.category === undefined ? "analytics" : options.category,

    setup(context) {
      if (options.consentDefaults === false) return;
      pushConsent("default", consentModeDefaults(context.consentConfig));
      if (context.consent.decided) pushConsent("update", consentModeState(context.consent, context.consentConfig));
    },

    start() {
      if (!options.load || loaded) return;
      const send = gtag();
      if (!send) return;
      loaded = true;
      const id = options.measurementId || options.googleAdsId;
      if (!id) return;
      const layerParam = layerName === "dataLayer" ? "" : `&l=${encodeURIComponent(layerName)}`;
      injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}${layerParam}`);
      send("js", new Date());
      // Page views are explicit (`track("page_view")`), so client-side navigations count too.
      if (options.measurementId) send("config", options.measurementId, { send_page_view: false });
      if (options.googleAdsId) send("config", options.googleAdsId);
    },

    consent(state: ConsentState, config: ConsentModuleConfig | undefined) {
      pushConsent("update", consentModeState(state, config));
    },

    track(event, params, context) {
      const skipPurchase = event === "purchase" && options.serverSidePurchase === true;
      if (!skipPurchase) {
        const items = ga4Items(params.items);
        if (mode === "dataLayer") {
          const ecommerce: Record<string, unknown> = {};
          const extra: Record<string, unknown> = {};
          for (const [key, value] of Object.entries({ ...params, items })) {
            if (value === undefined) continue;
            (ECOMMERCE_KEYS.has(key) ? ecommerce : extra)[key] = value;
          }
          const isEcommerce = Object.keys(ecommerce).some((key) => key !== "currency");
          const layer = dataLayer();
          // Clear the previous ecommerce object: GTM merges pushes, and old items would leak in.
          if (isEcommerce) layer?.push({ ecommerce: null });
          layer?.push({ event, event_id: context.eventId, ...extra, ...(isEcommerce ? { ecommerce } : {}) });
        } else {
          const payload: Record<string, unknown> = { ...params, event_id: context.eventId };
          if (items) payload.items = items;
          for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
          gtag()?.("event", event, payload);
        }
      }
      if (ADS_EVENTS.has(event) && context.allowed(adsCategory)) conversion(event, params);
    },
  };
}
