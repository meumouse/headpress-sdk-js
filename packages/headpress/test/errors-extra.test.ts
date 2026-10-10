import { describe, expect, it } from "vitest";

import { createHeadpress } from "../src/index.js";
import { createConsent } from "../src/analytics/index.js";
import { BASE, mockFetch, rejection, wpError } from "./helpers.js";

describe("server messages", () => {
  it("decodes HTML entities WordPress leaves in error messages", async () => {
    const { fetch } = mockFetch(() => wpError(400, "woocommerce_rest_cart_coupon_error", "Cupom &quot;X&quot; n&atilde;o pode ser usado."));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    expect((await rejection(hp.request("/x"))).message).toBe('Cupom "X" não pode ser usado.');
  });
});

describe("consent snapshot", () => {
  it("returns the same object until the decision changes", () => {
    let cookie: string | null = null;
    const consent = createConsent({ read: () => cookie, write: (value) => void (cookie = value) });
    const first = consent.get();
    expect(consent.get()).toBe(first);
    consent.acceptAll();
    const decided = consent.get();
    expect(decided).not.toBe(first);
    expect(consent.get()).toBe(decided);
  });
});
