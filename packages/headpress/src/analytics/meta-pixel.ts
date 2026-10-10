/**
 * Meta Pixel (`fbq`), plus the relayed copy for Headpress' Conversions API relay.
 *
 * Standard events only, each with `eventID` = the tracker's `event_id`, so Meta deduplicates the
 * pixel hit against the server copy (the relay, or the purchase Headpress sends from the paid order
 * with `purchase_<order id>`). Canonical events without a Meta standard equivalent are not sent.
 *
 * `load: true` injects the official `fbevents.js` loader once marketing consent is granted; without
 * it the store loads the pixel itself (and the provider skips events while `fbq` is absent — the relay
 * still gets them).
 */
import { browserWindow, injectScript } from "./env.js";
import type { AnalyticsItem, AnyEventParams, CanonicalEvent } from "./events.js";
import type { RelayParams } from "./relay.js";
import type { AnalyticsProvider } from "./tracker.js";

export interface MetaPixelProviderOptions {
  pixelId: string;
  /** Inject the pixel once the category is granted. Defaults to false. */
  load?: boolean;
  /** Consent category. Defaults to `marketing`. */
  category?: string;
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

/** Canonical event → Meta standard event. */
export const META_EVENTS: Partial<Record<CanonicalEvent, string>> = {
  page_view: "PageView",
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
  search: "Search",
  sign_up: "CompleteRegistration",
  generate_lead: "Lead",
};

const catalogId = (item: AnalyticsItem): string => item.catalog_id || item.item_id;

/** Meta `custom_data` from canonical params (used by the pixel and the relay). */
export function metaParams(params: AnyEventParams): RelayParams & { order_id?: string } {
  const items = params.items ?? [];
  const out: RelayParams & { order_id?: string } = {};
  if (params.currency !== undefined) out.currency = params.currency;
  if (params.value !== undefined) out.value = params.value;
  if (items.length > 0) {
    out.content_ids = items.map(catalogId);
    out.contents = items.map((item) => ({
      id: catalogId(item),
      quantity: item.quantity ?? 1,
      ...(item.price !== undefined ? { item_price: item.price } : {}),
    }));
    out.content_type = typeof params.content_type === "string" ? params.content_type : "product";
    out.num_items = items.reduce((total, item) => total + (item.quantity ?? 1), 0);
    if (items.length === 1) {
      out.content_name = items[0]!.item_name;
      if (items[0]!.item_category) out.content_category = items[0]!.item_category;
    }
  }
  if (params.search_term) out.search_string = params.search_term;
  if (params.transaction_id) out.order_id = params.transaction_id;
  return out;
}

export function metaPixelProvider(options: MetaPixelProviderOptions): AnalyticsProvider {
  let loaded = false;

  const fbq = (): Fbq | undefined => {
    const win = browserWindow() as (Window & { fbq?: Fbq }) | undefined;
    return typeof win?.fbq === "function" ? win.fbq : undefined;
  };

  return {
    name: "meta_pixel",
    category: options.category ?? "marketing",

    start() {
      if (!options.load || loaded) return;
      const win = browserWindow() as (Window & { fbq?: Fbq; _fbq?: Fbq }) | undefined;
      if (!win) return;
      loaded = true;
      if (typeof win.fbq !== "function") {
        // Meta's official bootstrap: queue calls until fbevents.js takes over.
        const stub = function fbq() {
          // eslint-disable-next-line prefer-rest-params
          if (stub.callMethod) stub.callMethod(...Array.from(arguments));
          // eslint-disable-next-line prefer-rest-params
          else stub.queue!.push(arguments);
        } as Fbq;
        stub.push = stub;
        stub.loaded = true;
        stub.version = "2.0";
        stub.queue = [];
        win.fbq = stub;
        if (!win._fbq) win._fbq = stub;
        injectScript("https://connect.facebook.net/en_US/fbevents.js");
      }
      win.fbq?.("init", options.pixelId);
    },

    track(event, params, context) {
      const name = META_EVENTS[event];
      const send = fbq();
      if (!name || !send) return;
      const payload = metaParams(params);
      send("track", name, payload, { eventID: context.eventId });
    },

    relay(event, params) {
      const name = META_EVENTS[event];
      if (!name || event === "purchase") return null;
      const { order_id: _order, ...custom } = metaParams(params);
      return { provider: "meta", name, params: custom };
    },
  };
}
