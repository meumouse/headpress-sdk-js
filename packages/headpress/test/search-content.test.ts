import { afterEach, describe, expect, it } from "vitest";

import { createHeadpress, createRecentlyViewed, highlightSegments, normalizeSearchItem, searchSessionId } from "../src/index.js";
import { BASE, json, mockFetch, wpError } from "./helpers.js";

describe("search", () => {
  it("normalizes products, terms and posts", () => {
    const product = normalizeSearchItem({
      id: 41,
      type: "product",
      parent_id: 0,
      name: "Anel &amp; Cia",
      slug: "anel",
      path: "/produto/anel",
      sku: "A1",
      image: { src: "https://wp.test/a.jpg", srcset: "", alt: "" },
      prices: { currency_code: "BRL", currency_minor_unit: 2, price: 45000, regular_price: 50000, sale_price: 45000, price_range: null },
      on_sale: true,
      in_stock: true,
      rating: 5,
      highlight: { name: [[0, 4]] },
    });
    expect(product).toMatchObject({ kind: "product", name: "Anel & Cia", path: "/produto/anel", prices: { price: { amount: 45000 }, regularPrice: { amount: 50000 } } });

    expect(normalizeSearchItem({ id: 7, taxonomy: "product_cat", name: "Anéis", slug: "aneis", path: "/aneis", count: 3, breadcrumbs: [{ id: 1, name: "Joias" }] })).toMatchObject({
      kind: "term",
      breadcrumbs: [{ id: 1, name: "Joias" }],
    });
    expect(normalizeSearchItem({ id: 9, post_type: "post", title: "Guia", path: "/blog/guia", excerpt: "" })).toMatchObject({ kind: "post", postType: "post" });
  });

  it("splits highlights by code point", () => {
    expect(highlightSegments("Anel de ouro", [[0, 4], [8, 12]])).toEqual([
      { text: "Anel", match: true },
      { text: " de ", match: false },
      { text: "ouro", match: true },
    ]);
    // Emoji count as one code point, as Headpress counts them.
    expect(highlightSegments("💍 Anel", [[2, 6]])).toEqual([
      { text: "💍 ", match: false },
      { text: "Anel", match: true },
    ]);
    expect(highlightSegments("x", undefined)).toEqual([{ text: "x", match: false }]);
  });

  it("reads result pages with the X-Headpress headers", async () => {
    const { fetch, calls } = mockFetch(() =>
      json([{ id: 1, type: "product", name: "A", prices: null }], {
        headers: { "X-WP-Total": "31", "X-WP-TotalPages": "3", "X-Headpress-Partial": "1", "X-Headpress-Suggestion": "anel%20dourado", "X-Headpress-Redirect": "%2Faneis" },
      }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const result = await hp.search.search("anel dorado", { page: 2, perPage: 12, orderby: "price" });
    expect(result).toMatchObject({ total: 31, totalPages: 3, page: 2, partial: true, suggestion: "anel dourado", redirect: "/aneis" });
    expect(calls[0]?.url).toContain("q=anel+dorado&orderby=price&page=2&per_page=12");
  });

  it("sends tracking events with the session header", async () => {
    const { fetch, calls } = mockFetch(() => json({ accepted: 1, rejected: [{ index: 1, reason: "invalid_type" }] }, { status: 202 }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const result = await hp.search.track([{ type: "view", object_id: 41 }], { session: "f3a9c1d2e8b74a10", consent: { categories: ["analytics"] } });
    expect(result).toEqual({ accepted: 1, rejected: [{ index: 1, reason: "invalid_type" }] });
    expect(calls[0]?.headers.get("X-Headpress-Search-Session")).toBe("f3a9c1d2e8b74a10");
  });

  it("makes a 16-hex session id", () => {
    expect(searchSessionId()).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("content", () => {
  it("resolves by path and answers null when nothing is published", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.includes("nada") ? wpError(404, "headpress_not_found") : json({ kind: "post", post: { id: 5, title: "Oi" }, cache_tags: ["post:5"] }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    expect((await hp.content.get({ path: "/blog/oi/" }))?.post?.title).toBe("Oi");
    expect(calls[0]?.url).toContain("path=%2Fblog%2Foi");
    expect(await hp.content.get({ path: "/nada" })).toBeNull();
    await hp.content.get({ type: "post", id: 5 }, { previewToken: "tok" });
    expect(calls[2]?.url).toContain("preview_token=tok");
  });
});

describe("recently viewed", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.localStorage;
  });

  it("keeps ids newest first, unique and capped", () => {
    const data = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
    const recent = createRecentlyViewed({ max: 3 });
    recent.add(1);
    recent.add(2);
    recent.add(1);
    recent.add(3);
    recent.add(4);
    expect(recent.ids()).toEqual([4, 3, 1]);
    recent.remove(3);
    expect(recent.ids()).toEqual([4, 1]);
  });
});
