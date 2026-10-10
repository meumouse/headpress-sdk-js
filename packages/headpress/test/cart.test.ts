import { describe, expect, it, vi } from "vitest";

import { createHeadpress, memoryCartToken, memorySession, normalizeCart } from "../src/index.js";
import { storeCart, storeCartItem } from "./fixtures.js";
import { BASE, json, mockFetch, rejection, wpError } from "./helpers.js";

describe("normalizeCart", () => {
  it("normalizes items, totals, shipping and the free-shipping progress", () => {
    const cart = normalizeCart(storeCart());
    const item = cart.items[0]!;
    expect(item.name).toBe("Anel & Cia");
    expect(item.quantityLimits).toEqual({ min: 1, max: 5, step: 1, editable: true });
    expect(item.itemData).toEqual([{ name: "Gravação", value: "Ana" }]);
    expect(item.subtotal.amount).toBe(39980);
    expect(item.total.amount).toBe(35982);
    expect(cart.totals).toMatchObject({ subtotal: { amount: 39980 }, discount: { amount: 3998 }, fees: { amount: -1799 }, shipping: null, total: { amount: 34183 } });
    expect(cart.coupons[0]).toMatchObject({ code: "bemvinda", discount: { amount: 3998 } });
    expect(cart.shippingPackages[0]?.rates[0]).toMatchObject({ id: "flat_rate:1", price: { amount: 2201 }, selected: true, meta: { delivery_days: 5 } });
    expect(cart.freeShipping).toMatchObject({ threshold: { amount: 59900 }, remaining: { amount: 19920 }, qualifies: false });
    expect(normalizeCart(storeCart({ extensions: {} })).freeShipping).toBeNull();
  });
});

describe("cart resource", () => {
  it("fetches a token before the first mutation and sends it after", async () => {
    const { fetch, calls } = mockFetch((request) =>
      json(storeCart(), { headers: { "Cart-Token": request.headers.get("Cart-Token") ?? "issued-token" } }),
    );
    const cartToken = memoryCartToken();
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken });
    await hp.cart.addItem({ id: 12, quantity: 2, extensions: { cm_precheckout: { material: "gold_18_k" } } });

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /wp-json/wc/store/v1/cart",
      "POST /wp-json/wc/store/v1/cart/add-item",
    ]);
    expect(calls[1]?.headers.get("Cart-Token")).toBe("issued-token");
    expect(await calls[1]?.json()).toEqual({ id: 12, quantity: 2, extensions: { cm_precheckout: { material: "gold_18_k" } } });
    expect(cartToken.get()).toBe("issued-token");
  });

  it("replaces a token the Store API refuses and replays once", async () => {
    let tokenOk = false;
    const { fetch, calls } = mockFetch((request) => {
      if (request.method === "GET") {
        tokenOk = true;
        return json(storeCart({ items: [] }), { headers: { "Cart-Token": "fresh" } });
      }
      return tokenOk && request.headers.get("Cart-Token") === "fresh"
        ? json(storeCart())
        : wpError(401, "woocommerce_rest_missing_nonce", "Missing the Nonce header.");
    });
    const cartToken = memoryCartToken("stale");
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken });
    const cart = await hp.cart.applyCoupon(" bemvinda ");
    expect(cart.itemsCount).toBe(2);
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "POST"]);
    expect(await calls[2]?.json()).toEqual({ code: "bemvinda" });
  });

  it("keeps the cart an error answer carries and rethrows", async () => {
    const { fetch } = mockFetch(() =>
      json({ code: "woocommerce_rest_cart_coupon_error", message: "Cupom inválido", data: { status: 400, cart: storeCart({ coupons: [] }) } }, { status: 400 }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("t") });
    const listener = vi.fn();
    hp.cart.subscribe(listener);
    const error = await rejection(hp.cart.applyCoupon("x"));
    expect(error.code).toBe("woocommerce_rest_cart_coupon_error");
    expect(hp.cart.peek()?.coupons).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes on quantity 0, rejects fractions and refetches after clear()", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.method === "DELETE" ? json([]) : json(storeCart({ items: [storeCartItem({ quantity: 1 })] })),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("t") });
    await hp.cart.updateItem("abc123", 0);
    expect(new URL(calls[0]!.url).pathname).toBe("/wp-json/wc/store/v1/cart/remove-item");
    expect((await rejection(hp.cart.updateItem("abc123", 1.5))).code).toBe("headpress_invalid_param");
    await hp.cart.clear();
    expect(calls.slice(-2).map((call) => call.method)).toEqual(["DELETE", "GET"]);
  });

  it("sends the customer's token when signed in, and plugin cart actions", async () => {
    const { fetch, calls } = mockFetch(() => json(storeCart()));
    const session = memorySession();
    session.setTokens({ accessToken: "jwt", expiresIn: 900 });
    const hp = createHeadpress({ baseUrl: BASE, fetch, session, cartToken: memoryCartToken("t") });
    await hp.cart.action("headpress", { action: "address_book.apply", shipping_address_id: "a1" });
    await hp.cart.selectShippingRate(0, "flat_rate:1");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer jwt");
    expect(await calls[0]?.json()).toEqual({ namespace: "headpress", data: { action: "address_book.apply", shipping_address_id: "a1" } });
    expect(await calls[1]?.json()).toEqual({ package_id: 0, rate_id: "flat_rate:1" });
  });

  it("lets a store add renewal codes for its own plugins", async () => {
    let first = true;
    const { fetch } = mockFetch((request) => {
      if (request.method === "GET") return json(storeCart(), { headers: { "Cart-Token": "new" } });
      if (first) {
        first = false;
        return wpError(409, "cm_paypal_cart_token_invalid");
      }
      return json(storeCart());
    });
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch,
      cartToken: memoryCartToken("old"),
      cart: { renewTokenOn: ["woocommerce_rest_missing_nonce", "cm_paypal_cart_token_invalid"] },
    });
    await expect(hp.cart.removeCoupon("x")).resolves.toMatchObject({ itemsCount: 2 });
  });
});
