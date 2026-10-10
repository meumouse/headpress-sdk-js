import { describe, expect, it } from "vitest";

import { cartEventParams, productEventParams, type Tracker } from "../src/analytics/index.js";
import type { Cart, Product } from "../src/index.js";

describe("analytics types", () => {
  it("accepts the item helpers' results directly", () => {
    // Compile-time check: these calls must type-check without spreading.
    const use = (tracker: Tracker, product: Product, cart: Cart) => {
      tracker.track("add_to_cart", productEventParams(product, { quantity: 1 }));
      tracker.track("view_cart", cartEventParams(cart));
      tracker.track("begin_checkout", cartEventParams(cart));
    };
    expect(typeof use).toBe("function");
  });
});
