import { describe, expect, it } from "vitest";

import { createHeadpress, normalizeProduct, productQueryString } from "../src/index.js";
import { storeProduct, BRL } from "./fixtures.js";
import { BASE, json, mockFetch, storeConfig, wpError } from "./helpers.js";

describe("normalizeProduct", () => {
  it("decodes names, turns prices into Money and reads stock and quantity rules", () => {
    const product = normalizeProduct(storeProduct());
    expect(product.name).toBe("Anel “Solitário” & Cia");
    expect(product.price).toEqual({ amount: 19990, currency: "BRL", minorUnit: 2 });
    expect(product.regularPrice.amount).toBe(24990);
    expect(product.salePrice?.amount).toBe(19990);
    expect(product.currency.prefix).toBe("R$ ");
    expect(product.images[0]?.alt).toBe("Anel & caixa");
    expect(product.categories[0]).toEqual({ id: 7, name: "Anéis", slug: "aneis", path: null });
    expect(product.rating).toEqual({ average: 4.5, count: 8 });
    expect(product.stock).toEqual({ inStock: true, onBackorder: false, purchasable: true, lowStockRemaining: 2, availability: "Apenas 2 em estoque" });
    // 9999 is WooCommerce's "no limit".
    expect(product.quantity).toEqual({ min: 1, max: null, step: 1, soldIndividually: false });
    expect(normalizeProduct(storeProduct({ sold_individually: true })).quantity.max).toBe(1);
    expect(normalizeProduct(storeProduct({ add_to_cart: { text: "", description: "", url: "", minimum: 2, maximum: 10, multiple_of: 2 } })).quantity).toEqual({
      min: 2,
      max: 10,
      step: 2,
      soldIndividually: false,
    });
    expect(normalizeProduct(storeProduct({ on_sale: false })).salePrice).toBeNull();
  });

  it("builds storefront paths from the route map", () => {
    const hp = createHeadpress({ baseUrl: BASE, config: { initial: storeConfig() } });
    const product = normalizeProduct(storeProduct(), { routes: hp.routes });
    expect(product.path).toBe("/produto/anel-solitario");
    expect(product.categories[0]?.path).toBe("/aneis");
  });

  it("reads the server's price preview and never invents one", () => {
    expect(normalizeProduct(storeProduct()).pricePreview).toBeNull();
    const preview = normalizeProduct(
      storeProduct({
        extensions: {
          headpress: {
            installments: {
              price_preview: {
              price: 19990,
              currency: "BRL",
              pix: { price: 18990, discount: 1000, percent: 5 },
              ticket: null,
              installments: { count: 3, amount: 6663, total: 19990, interest_free: true },
              min_installment: 5000,
              },
            },
          },
        },
      }),
    ).pricePreview;
    expect(preview?.pix).toEqual({
      price: { amount: 18990, currency: "BRL", minorUnit: 2 },
      discount: { amount: 1000, currency: "BRL", minorUnit: 2 },
      percent: 5,
    });
    expect(preview?.installments).toMatchObject({ count: 3, interestFree: true, amount: { amount: 6663 } });
    expect(preview?.minInstallment?.amount).toBe(5000);
  });

  it("reads variable price ranges", () => {
    const product = normalizeProduct(storeProduct({ type: "variable", prices: { ...BRL, price: "14000", regular_price: "14000", sale_price: "14000", price_range: { min_amount: "14000", max_amount: "15000" } } }));
    expect(product.priceRange?.max.amount).toBe(15000);
  });
});

describe("productQueryString", () => {
  it("serializes filters the way the Store API reads them", () => {
    const query = new URLSearchParams(
      productQueryString({
        page: 2,
        perPage: 12,
        category: ["aneis", 9],
        minPrice: 10000,
        maxPrice: { amount: 50000, currency: "BRL", minorUnit: 2 },
        stockStatus: ["instock"],
        attributes: [{ attribute: "pa_cor", terms: ["ouro", "prata"], operator: "in" }, { attribute: "pa_tamanho", terms: [16] }],
        orderby: "price",
        order: "asc",
      }),
    );
    expect(query.get("category")).toBe("aneis,9");
    expect(query.get("min_price")).toBe("10000");
    expect(query.get("max_price")).toBe("50000");
    expect(query.get("stock_status[0]")).toBe("instock");
    expect(query.get("attributes[0][slug][1]")).toBe("prata");
    expect(query.get("attributes[0][operator]")).toBe("in");
    expect(query.get("attributes[1][term_id][0]")).toBe("16");
    expect(query.get("per_page")).toBe("12");
  });
});

describe("catalog resource", () => {
  it("lists with totals from the headers and tags reads", async () => {
    const { fetch, calls } = mockFetch(() => json([storeProduct()], { headers: { "X-WP-Total": "40", "X-WP-TotalPages": "4" } }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const page = await hp.catalog.list({ perPage: 10, page: 2 });
    expect(page).toMatchObject({ total: 40, totalPages: 4, page: 2, perPage: 10 });
    expect(calls[0]?.url).toBe(`${BASE}/wp-json/wc/store/v1/products?page=2&per_page=10`);
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
  });

  it("gets by slug or id and answers null for unknown products", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.endsWith("/nope")
        ? wpError(404, "woocommerce_rest_product_invalid_id")
        : json(request.url.includes("/products?") ? [storeProduct()] : storeProduct()),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    expect((await hp.catalog.get("anel-solitario"))?.id).toBe(12);
    expect(await hp.catalog.get("nope")).toBeNull();
    await hp.catalog.variations(59);
    expect(decodeURIComponent(calls[2]?.url ?? "")).toContain("type=variation&parent[0]=59");
  });

  it("reads facets with money ranges and numeric counts", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({
        price_range: { ...BRL, min_price: "14000", max_price: "45000" },
        attribute_counts: [{ term: 3, count: "5" }],
        rating_counts: null,
        stock_status_counts: [{ status: "instock", count: "104" }],
        taxonomy_counts: null,
      }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const facets = await hp.catalog.facets({ category: "aneis" }, { attributes: [{ taxonomy: "pa_cor" }], stock: true });
    expect(facets.priceRange?.min.amount).toBe(14000);
    expect(facets.attributeCounts).toEqual([{ term: 3, count: 5 }]);
    expect(facets.stockStatusCounts).toEqual([{ status: "instock", count: 104 }]);
    const url = decodeURIComponent(calls[0]?.url ?? "");
    expect(url).toContain("calculate_attribute_counts[0][taxonomy]=pa_cor");
    expect(url).toContain("category=aneis");
  });
});
