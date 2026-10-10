/**
 * The browser side of a purchase, on the order confirmation page.
 *
 * Headpress sends the purchase to GA4, Meta and Pinterest from the server when the order is paid,
 * with `event_id` = `purchase_<order id>` and `transaction_id` = the order number. The browser event
 * reads the same payload (`GET /store/orders/{id}/analytics?key=`) so it carries the order's real
 * totals and the ids the platforms deduplicate on, and fires at most once per order per browser.
 *
 * Call it when the payment is confirmed (a Pix that is never paid is not a sale): the SDK does not
 * decide that, the order status the server reports does.
 */
import type { HeadpressClient } from "../client.js";
import { isBrowserEnv, readJson, writeJson } from "./env.js";
import { purchaseEventId } from "./event-id.js";
import type { AnalyticsItem } from "./events.js";
import type { Tracker } from "./tracker.js";

/** `GET /store/orders/{id}/analytics` — amounts in major units, as the platforms expect. */
export interface OrderAnalytics {
  order_id: number;
  transaction_id: string;
  event_id: string;
  currency: string;
  value: number;
  tax: number;
  shipping: number;
  coupon: string;
  payment_method: string;
  items: {
    item_id: string;
    item_name: string;
    item_variant?: string;
    item_category?: string;
    price: number;
    discount?: number;
    quantity: number;
  }[];
}

export interface TrackPurchaseInput {
  orderId: number | string;
  /** The order key (`wc_order_…`) from the confirmation URL. */
  key: string;
  /** localStorage key of the orders already tracked. Defaults to `hp_tracked_orders`. */
  storageKey?: string;
}

const MAX_REMEMBERED = 50;
// Orders tracked on this page, for browsers whose storage is blocked.
const trackedThisPage = new Set<string>();

/** The order's purchase payload, or null when Headpress cannot give it. Never throws. */
export async function getOrderAnalytics(
  hp: Pick<HeadpressClient, "request">,
  orderId: number | string,
  key: string,
): Promise<OrderAnalytics | null> {
  try {
    const id = String(orderId).trim();
    if (!/^[1-9]\d*$/.test(id) || !key) return null;
    const data = await hp.request<OrderAnalytics>(`/store/orders/${id}/analytics`, {
      query: { key },
      fetchOptions: { cache: "no-store" },
    });
    return data && typeof data === "object" && typeof data.value === "number" ? data : null;
  } catch {
    return null;
  }
}

function remembered(storageKey: string): string[] {
  const stored = readJson("local", storageKey);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Track `purchase` for a paid order, at most once per order per browser. Resolves whether it
 * tracked (false when already tracked, or when Headpress could not give the order).
 *
 * The order counts as tracked as soon as the event is handed to the tracker, even when it waits for
 * a consent decision: losing a browser copy is cheap (the server sends its own), counting a purchase
 * twice is not.
 */
export async function trackPurchase(
  hp: Pick<HeadpressClient, "request">,
  tracker: Pick<Tracker, "track">,
  input: TrackPurchaseInput,
): Promise<boolean> {
  try {
    // Browser only: the guard lives in the shopper's browser, and the tracker sends nothing on a server.
    if (!isBrowserEnv()) return false;
    const storageKey = input.storageKey ?? "hp_tracked_orders";
    const id = String(input.orderId).trim();
    const eventId = purchaseEventId(id);
    if (trackedThisPage.has(id) || remembered(storageKey).includes(id)) return false;

    const order = await getOrderAnalytics(hp, id, input.key);
    if (!order) return false;
    // A second call may have finished while this one waited.
    if (trackedThisPage.has(id) || remembered(storageKey).includes(id)) return false;

    trackedThisPage.add(id);
    writeJson("local", storageKey, [...remembered(storageKey), id].slice(-MAX_REMEMBERED));

    const items: AnalyticsItem[] = (order.items ?? []).map((line) => {
      const item: AnalyticsItem = { item_id: String(line.item_id), item_name: line.item_name, price: line.price, quantity: line.quantity };
      if (line.item_variant) item.item_variant = line.item_variant;
      if (line.item_category) item.item_category = line.item_category;
      if (line.discount) item.discount = line.discount;
      return item;
    });
    tracker.track(
      "purchase",
      {
        transaction_id: order.transaction_id || id,
        currency: order.currency,
        value: order.value,
        tax: order.tax,
        shipping: order.shipping,
        ...(order.coupon ? { coupon: order.coupon } : {}),
        items,
      },
      // The server sends its copies from the paid order: nothing goes to the relay.
      { eventId, browserOnly: true },
    );
    return true;
  } catch {
    return false;
  }
}
