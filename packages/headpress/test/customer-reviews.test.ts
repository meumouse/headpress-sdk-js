import { describe, expect, it } from "vitest";

import { createHeadpress, memorySession } from "../src/index.js";
import { BASE, json, mockFetch, storeConfig } from "./helpers.js";

function signedIn(fetch: typeof globalThis.fetch) {
  const session = memorySession();
  session.setTokens({ accessToken: "jwt", expiresIn: 900, refreshToken: "7.rt" });
  return { session, hp: createHeadpress({ baseUrl: BASE, fetch, session }) };
}

describe("customer", () => {
  it("lists orders with money and totals from the headers", async () => {
    const { fetch, calls } = mockFetch(() =>
      json([{ id: 1, number: "1001", status: "processing", status_label: "Processando", date_created: null, currency: "BRL", total: 34183, item_count: 2, needs_payment: false, order_key: "wc_order_x" }], {
        headers: { "X-WP-Total": "11", "X-WP-TotalPages": "2" },
      }),
    );
    const { hp } = signedIn(fetch);
    const page = await hp.customer.orders.list({ page: 1, perPage: 10, status: ["processing", "completed"] });
    expect(page.total).toBe(11);
    expect(page.items[0]?.total).toEqual({ amount: 34183, currency: "BRL", minorUnit: 2 });
    expect(calls[0]?.url).toContain("status=processing%2Ccompleted");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("normalizes order details and wishlists", async () => {
    const { fetch } = mockFetch((request) =>
      request.url.includes("wishlist")
        ? json({ count: 1, ids: [57], products: [{ id: 57, name: "Ring", prices: { currency_code: "BRL", price: 19990, regular_price: 24990, sale_price: 19990 } }] })
        : json({
            id: 1,
            currency: "BRL",
            total: 1000,
            totals: { subtotal: 900, discount: 0, shipping: 100, tax: 0, fees: 0, total: 1000, refunded: 0 },
            shipping_lines: [{ method_id: "flat_rate", title: "PAC", total: 100 }],
            items: [{ id: 3, name: "Ring", quantity: 1, subtotal: 900, total: 900, meta: [] }],
          }),
    );
    const { hp } = signedIn(fetch);
    const order = await hp.customer.orders.get(1);
    expect(order.totals.shipping.amount).toBe(100);
    expect(order.items[0]?.total.amount).toBe(900);
    expect(order.shipping_lines[0]?.total.amount).toBe(100);
    const wishlist = await hp.customer.wishlist.add(57);
    expect(wishlist.products[0]?.price?.amount).toBe(19990);
  });

  it("rotates the tokens after a direct password change", async () => {
    const { fetch } = mockFetch(() => json({ access_token: "jwt-2", expires_in: 900, refresh_token: "7.rt2", customer: { id: 7 } }));
    const { hp, session } = signedIn(fetch);
    expect(await hp.customer.changePassword({ password: "newpass123", current_password: "old" })).toEqual({ id: 7 });
    expect(session.getAccessToken()).toBe("jwt-2");
    expect(session.getRefreshToken()).toBe("7.rt2");
  });

  it("fails fast when the store has the module off", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const session = memorySession();
    session.setTokens({ accessToken: "jwt", expiresIn: 900 });
    const hp = createHeadpress({ baseUrl: BASE, fetch, session, config: { initial: storeConfig() } });
    await expect(hp.customer.wishlist.get()).rejects.toMatchObject({ code: "headpress_module_disabled" });
    expect(calls).toHaveLength(0);
  });
});

describe("reviews", () => {
  it("reads lists without the customer's token and votes with the voter id", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.includes("/votes")
        ? json({ review_ids: [812] })
        : json([{ id: 812, product_id: 57, rating: 5, title: "Top", content: "Amei", author: { name: "Maria S.", anonymous: false, avatar: null }, verified: true, created_at: "", media: [], helpful_count: 3, reply: null }], {
            headers: { "X-WP-Total": "9", "X-WP-TotalPages": "1" },
          }),
    );
    const { hp } = signedIn(fetch);
    const page = await hp.reviews.list(57, { rating: [4, 5], sort: "most_helpful" });
    expect(page.items[0]?.author.name).toBe("Maria S.");
    expect(page.total).toBe(9);
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
    expect(calls[0]?.url).toContain("rating=4%2C5&sort=most_helpful");

    expect(await hp.reviews.votes(57)).toEqual([812]);
    expect(calls[1]?.headers.get("X-Headpress-Voter")).toMatch(/^[a-f0-9]{32}$/);
    expect(calls[1]?.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("uploads media as multipart and submits with tokens", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.endsWith("/store/reviews/media")
        ? json({ id: 990, type: "image", url: "u", token: "Zq3", expires_at: "" }, { status: 201 })
        : json({ status: "approved", review: { id: 913, rating: 5, content: "ok", author: {} } }, { status: 201 }),
    );
    const { hp } = signedIn(fetch);
    const upload = await hp.reviews.uploadMedia(new Blob(["x"], { type: "image/jpeg" }), { filename: "a.jpg" });
    expect(calls[0]?.headers.get("Content-Type")).toMatch(/multipart\/form-data/);
    const result = await hp.reviews.create(57, { rating: 5, title: "Top", content: "Amei muito", media: [{ id: upload.id, token: upload.token }] }, { captcha: "c" });
    expect(result.status).toBe("approved");
    expect(result.review.author).toEqual({ name: null, anonymous: false, avatar: null });
    expect(await calls[1]?.json()).toMatchObject({ media: [{ id: 990, token: "Zq3" }] });
  });
});
