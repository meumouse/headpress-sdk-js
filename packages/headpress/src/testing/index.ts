/**
 * `@meumouse/headpress/testing`: helpers for testing a storefront built on the SDK, without a
 * WordPress site.
 *
 * ```ts
 * import { createHeadpress } from "@meumouse/headpress";
 * import { mockHeadpress, json, fixtures } from "@meumouse/headpress/testing";
 *
 * const server = mockHeadpress({
 *   "GET /headpress/v1/store/config": () => json(fixtures.storeConfig()),
 *   "GET /wc/store/v1/products": () => json([fixtures.storeProduct()], { headers: { "X-WP-Total": "1" } }),
 * });
 * const hp = createHeadpress({ baseUrl: "https://wp.test", fetch: server.fetch });
 * // … then assert on server.calls
 * ```
 */
import type { StoreCart, StoreCartItem, StoreCurrency, StoreProduct } from "../store-api.js";
import type { StoreConfig } from "../types.js";

export type MockHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

export interface MockHeadpress {
  fetch: typeof fetch;
  /** Every request received, in order (clones, so bodies can be read). */
  calls: Request[];
  /** Add or replace a route. */
  on(route: string, handler: MockHandler): void;
}

/** A JSON response. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** A WordPress REST error response. */
export function wpError(status: number, code: string, message = "Error", data: Record<string, unknown> = {}): Response {
  return json({ code, message, data: { status, ...data } }, { status });
}

function compile(route: string): { method: string; regex: RegExp; names: string[] } {
  const [method = "GET", path = "/"] = route.includes(" ") ? route.split(/\s+/, 2) : ["GET", route];
  const names: string[] = [];
  const source = path
    .replace(/^\/wp-json/, "")
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { method: method.toUpperCase(), regex: new RegExp(`^(?:/wp-json)?${source}/?$`), names };
}

/**
 * A fake WordPress REST API. Routes are `"METHOD /namespace/path"` with `:params`
 * (`"POST /wc/store/v1/cart/add-item"`, `"GET /headpress/v1/store/orders/:id/payments"`); the
 * query string is ignored when matching. Unmatched requests answer 404 `rest_no_route`, like
 * WordPress.
 */
export function mockHeadpress(routes: Record<string, MockHandler> = {}): MockHeadpress {
  const table = new Map<string, { method: string; regex: RegExp; names: string[]; handler: MockHandler }>();
  const add = (route: string, handler: MockHandler): void => {
    table.set(route, { ...compile(route), handler });
  };
  Object.entries(routes).forEach(([route, handler]) => add(route, handler));
  const calls: Request[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request.clone());
    const pathname = new URL(request.url).pathname;
    for (const entry of table.values()) {
      if (entry.method !== request.method) continue;
      const match = entry.regex.exec(pathname);
      if (!match) continue;
      const params = Object.fromEntries(entry.names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]));
      return entry.handler(request, params);
    }
    return wpError(404, "rest_no_route", "No route was found matching the URL and request method.");
  }) as typeof fetch;

  return { fetch: fetchImpl, calls, on: add };
}

const BRL: StoreCurrency = {
  currency_code: "BRL",
  currency_symbol: "R$",
  currency_minor_unit: 2,
  currency_decimal_separator: ",",
  currency_thousand_separator: ".",
  currency_prefix: "R$ ",
  currency_suffix: "",
};

/** Realistic payloads to start fixtures from; override what a test cares about. */
export const fixtures = {
  storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
    return {
      schema_version: 1,
      version: "fixture00001",
      generated_at: "2026-10-10T12:00:00+00:00",
      store: {
        name: "Test Store",
        description: "",
        language: "pt-BR",
        timezone: "-03:00",
        urls: { storefront: "https://shop.test", backend: "https://wp.test", rest: "https://wp.test/wp-json/", store_api: "https://wp.test/wp-json/wc/store/v1" },
      },
      routes: { home: "/", shop: "/shop", product: "/product/{slug}", product_cat: "/category/{slug}", cart: "/cart", checkout: "/checkout" },
      commerce: undefined,
      modules: { woocommerce: { enabled: true } as never },
      ...overrides,
    };
  },

  storeProduct(overrides: Partial<StoreProduct> = {}): StoreProduct {
    return {
      id: 12,
      name: "Gold ring",
      slug: "gold-ring",
      parent: 0,
      type: "simple",
      variation: "",
      permalink: "https://wp.test/product/gold-ring/",
      sku: "RING-1",
      short_description: "",
      description: "",
      on_sale: false,
      prices: { ...BRL, price: "19990", regular_price: "19990", sale_price: "19990", price_range: null },
      price_html: "",
      average_rating: "0",
      review_count: 0,
      images: [],
      categories: [],
      tags: [],
      brands: [],
      attributes: [],
      variations: [],
      has_options: false,
      is_purchasable: true,
      is_in_stock: true,
      is_on_backorder: false,
      low_stock_remaining: null,
      stock_availability: { text: "", class: "in-stock" },
      sold_individually: false,
      add_to_cart: { text: "Add to cart", description: "", url: "", minimum: 1, maximum: 9999, multiple_of: 1 },
      extensions: {},
      ...overrides,
    };
  },

  storeCartItem(overrides: Partial<StoreCartItem> = {}): StoreCartItem {
    return {
      key: "item1",
      id: 12,
      type: "simple",
      quantity: 1,
      quantity_limits: { minimum: 1, maximum: 9999, multiple_of: 1, editable: true },
      name: "Gold ring",
      short_description: "",
      description: "",
      sku: "RING-1",
      low_stock_remaining: null,
      backorders_allowed: false,
      show_backorder_badge: false,
      sold_individually: false,
      permalink: "https://wp.test/product/gold-ring/",
      images: [],
      variation: [],
      item_data: [],
      prices: { ...BRL, price: "19990", regular_price: "19990", sale_price: "19990", price_range: null },
      totals: { ...BRL, line_subtotal: "19990", line_subtotal_tax: "0", line_total: "19990", line_total_tax: "0" },
      extensions: {},
      ...overrides,
    };
  },

  storeCart(overrides: Partial<StoreCart> = {}): StoreCart {
    const empty = { first_name: "", last_name: "", company: "", address_1: "", address_2: "", city: "", state: "", postcode: "", country: "BR", phone: "" };
    return {
      items: [fixtures.storeCartItem()],
      coupons: [],
      fees: [],
      totals: {
        ...BRL,
        total_items: "19990",
        total_items_tax: "0",
        total_fees: "0",
        total_fees_tax: "0",
        total_discount: "0",
        total_discount_tax: "0",
        total_shipping: null,
        total_shipping_tax: null,
        total_price: "19990",
        total_tax: "0",
        tax_lines: [],
      },
      shipping_address: empty,
      billing_address: { ...empty, email: "" },
      needs_payment: true,
      needs_shipping: true,
      payment_requirements: ["products"],
      has_calculated_shipping: false,
      shipping_rates: [],
      items_count: 1,
      items_weight: 0,
      cross_sells: [],
      errors: [],
      payment_methods: [],
      extensions: {},
      ...overrides,
    };
  },
};
