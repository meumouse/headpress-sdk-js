/**
 * Event ids: the key the ad platforms deduplicate on.
 *
 * The browser pixel and the server copy of an event (Headpress' Conversions API relay, or the
 * purchase Headpress sends from the paid order) must carry the same id, or the platform counts the
 * event twice. Headpress accepts 1–100 characters of `[A-Za-z0-9_.:-]`.
 */
import { randomSuffix } from "./env.js";

const SAFE = /[^a-z0-9]+/gi;

/**
 * A fresh, random event id: `<name>_<unix seconds>_<random>`, e.g. `add_to_cart_1790000000_k9x3ap2m`.
 * The name prefix only makes ids readable in the platforms' event logs.
 */
export function eventId(name = "event"): string {
  const prefix = name.replace(SAFE, "_").replace(/^_+|_+$/g, "").toLowerCase().slice(0, 60) || "event";
  return `${prefix}_${Math.floor(Date.now() / 1000)}_${randomSuffix(8)}`;
}

/**
 * The id of an order's purchase: `purchase_<order id>`.
 *
 * Headpress sends the purchase to GA4, Meta and Pinterest from the server with this exact id when
 * the order is paid; the browser event must use the same one. This is the only place the SDK builds
 * it — never write the string by hand.
 */
export function purchaseEventId(orderId: number | string): string {
  const id = typeof orderId === "number" ? String(Math.trunc(orderId)) : String(orderId).trim();
  if (!/^[1-9]\d*$/.test(id)) throw new TypeError(`Invalid order id: "${String(orderId)}".`);
  return `purchase_${id}`;
}
