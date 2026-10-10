/**
 * Abandoned-cart capture: `POST /store/cart/abandonment` (`woocommerce` module).
 *
 * Sends who to contact about the cart the `Cart-Token` names; Headpress reads the cart lines and
 * totals itself. When no order follows within the store's delay, Headpress emits `cart.abandoned`
 * for automations (a reminder message sent by another module), which must check the marketing
 * consent recorded here.
 *
 * `consent` is required on purpose: messaging a shopper needs an explicit opt-in (LGPD, WhatsApp
 * Business policy), so every call states it — `{ marketing: false }` when the shopper did not opt in.
 * Never throws: this must not get in the way of someone paying.
 */
import type { HeadpressClient } from "../client.js";

export interface AbandonedCartInput {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  /** Whether the shopper explicitly accepted marketing messages (e.g. the checkout opt-in). */
  consent: { marketing: boolean };
  signal?: AbortSignal;
}

/**
 * Capture the shopper's contact for the current cart. Resolves true when Headpress stored it, and
 * false — without calling Headpress — when abandoned carts are off (`modules.woocommerce.abandoned_cart`),
 * there is no Cart-Token, no email or phone, or no explicit consent value.
 */
export async function captureAbandonedCart(
  hp: Pick<HeadpressClient, "request" | "config" | "capabilities" | "cartToken">,
  input: AbandonedCartInput,
): Promise<boolean> {
  try {
    if (typeof input?.consent?.marketing !== "boolean") return false;
    const contact: Record<string, string> = {};
    for (const key of ["email", "phone", "first_name", "last_name"] as const) {
      const raw = input[key];
      if (typeof raw === "string" && raw.trim() !== "") contact[key] = raw.trim();
    }
    if (!contact.email && !contact.phone) return false;
    if (!hp.cartToken?.get()) return false;
    if (!hp.capabilities.known()) await hp.config.get();
    if (hp.capabilities.get("woocommerce")?.abandoned_cart !== true) return false;

    const data = await hp.request<{ captured?: boolean }>("/store/cart/abandonment", {
      method: "POST",
      module: "woocommerce",
      cartToken: true,
      body: { ...contact, consent: { marketing: input.consent.marketing } },
      signal: input.signal,
      fetchOptions: { cache: "no-store" },
    });
    return data?.captured === true;
  } catch {
    // 404 (off), 429, an expired token, a network error: not captured this time.
    return false;
  }
}
