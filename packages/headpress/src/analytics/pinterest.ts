/**
 * Pinterest tag (`pintrk`), plus the relayed copy for Headpress' Conversions API relay.
 *
 * Pinterest accepts a fixed set of event names; canonical events are mapped onto them and the rest
 * are not sent. Every event carries `event_id` = the tracker's id (the purchase: `purchase_<order id>`,
 * the id Headpress sends from the paid order), so Pinterest deduplicates browser and server copies.
 *
 * The tag reads `line_items` / `order_quantity`; the Conversions API (relay) reads `content_ids` /
 * `contents` / `num_items`. Each gets its own format.
 *
 * `load: true` injects the official `core.js` loader once marketing consent is granted. With
 * `enhancedMatch`, the identified email is passed to the tag (`em`), which hashes it in the browser.
 */
import { browserWindow, injectScript } from "./env.js";
import type { AnalyticsIdentity, AnalyticsItem, AnyEventParams, CanonicalEvent } from "./events.js";
import type { AnalyticsProvider } from "./tracker.js";

export interface PinterestProviderOptions {
  tagId: string;
  /** Pass the identified email to the tag (`modules.pinterest.enhanced_match`). Defaults to false. */
  enhancedMatch?: boolean;
  /** Inject the tag once the category is granted. Defaults to false. */
  load?: boolean;
  /** Consent category. Defaults to `marketing`. */
  category?: string;
}

type Pintrk = ((...args: unknown[]) => void) & { queue?: unknown[]; version?: string };

/** Canonical event → Pinterest tag event. */
export const PINTEREST_EVENTS: Partial<Record<CanonicalEvent, string>> = {
  page_view: "pagevisit",
  view_item: "pagevisit",
  view_item_list: "viewcategory",
  add_to_cart: "addtocart",
  purchase: "checkout",
  search: "search",
  sign_up: "signup",
  generate_lead: "lead",
};

/** Canonical event → name Headpress' relay accepts for Pinterest. No purchase: the server sends it. */
export const PINTEREST_RELAY_EVENTS: Partial<Record<CanonicalEvent, string>> = {
  page_view: "page_visit",
  view_item: "page_visit",
  view_item_list: "view_category",
  add_to_cart: "add_to_cart",
  search: "search",
  sign_up: "signup",
  generate_lead: "lead",
};

const catalogId = (item: AnalyticsItem): string => item.catalog_id || item.item_id;

function enhancedMatch(identity: AnalyticsIdentity): Record<string, string> {
  return identity.email ? { em: identity.email.trim().toLowerCase() } : {};
}

export function pinterestProvider(options: PinterestProviderOptions): AnalyticsProvider {
  let loaded = false;

  const pintrk = (): Pintrk | undefined => {
    const win = browserWindow() as (Window & { pintrk?: Pintrk }) | undefined;
    return typeof win?.pintrk === "function" ? win.pintrk : undefined;
  };

  return {
    name: "pinterest",
    category: options.category ?? "marketing",

    start(context) {
      if (!options.load || loaded) return;
      const win = browserWindow() as (Window & { pintrk?: Pintrk }) | undefined;
      if (!win) return;
      loaded = true;
      if (typeof win.pintrk !== "function") {
        // Pinterest's official bootstrap: queue calls until core.js takes over.
        const stub = function pintrk() {
          // eslint-disable-next-line prefer-rest-params
          stub.queue!.push(Array.prototype.slice.call(arguments));
        } as Pintrk;
        stub.queue = [];
        stub.version = "3.0";
        win.pintrk = stub;
        injectScript("https://s.pinimg.com/ct/core.js");
      }
      win.pintrk?.("load", options.tagId, options.enhancedMatch ? enhancedMatch(context.identity) : {});
      win.pintrk?.("page");
    },

    identify(identity) {
      if (!options.enhancedMatch) return;
      const match = enhancedMatch(identity);
      if (Object.keys(match).length > 0) pintrk()?.("set", match);
    },

    track(event, params, context) {
      const name = PINTEREST_EVENTS[event];
      const send = pintrk();
      if (!name || !send) return;
      const items = params.items ?? [];
      const payload: Record<string, unknown> = { event_id: context.eventId };
      if (params.value !== undefined) payload.value = params.value;
      if (params.currency !== undefined) payload.currency = params.currency;
      if (items.length > 0) {
        payload.line_items = items.map((item) => {
          const line: Record<string, unknown> = {
            product_id: catalogId(item),
            product_name: item.item_name,
            product_quantity: item.quantity ?? 1,
          };
          if (item.price !== undefined) line.product_price = item.price;
          if (item.item_category) line.product_category = item.item_category;
          if (item.item_variant) line.product_variant = item.item_variant;
          if (item.item_brand) line.product_brand = item.item_brand;
          return line;
        });
        payload.order_quantity = items.reduce((total, item) => total + (item.quantity ?? 1), 0);
      }
      if (params.transaction_id) payload.order_id = params.transaction_id;
      if (params.coupon) payload.promo_code = params.coupon;
      if (params.search_term) payload.search_query = params.search_term;
      send("track", name, payload);
    },

    relay(event, params: AnyEventParams) {
      const name = PINTEREST_RELAY_EVENTS[event];
      if (!name) return null;
      const items = params.items ?? [];
      return {
        provider: "pinterest",
        name,
        params: {
          currency: params.currency,
          value: params.value,
          content_ids: items.map(catalogId),
          contents: items.map((item) => ({
            id: catalogId(item),
            quantity: item.quantity ?? 1,
            ...(item.price !== undefined ? { item_price: item.price } : {}),
          })),
          num_items: items.length > 0 ? items.reduce((total, item) => total + (item.quantity ?? 1), 0) : undefined,
          content_name: items.length === 1 ? items[0]!.item_name : undefined,
          content_category: items.length === 1 ? items[0]!.item_category : undefined,
          content_brand: items.find((item) => item.item_brand)?.item_brand,
          search_string: params.search_term,
        },
      };
    },
  };
}
