import type { StoreConfig } from "../src/index.js";

export type Handler = (request: Request) => Response | Promise<Response>;

/** A `fetch` that hands each call to `handler` as a `Request` and records it. */
export function mockFetch(handler: Handler) {
  const calls: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request.clone());
    return handler(request);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function wpError(status: number, code: string, message = "Error", data: Record<string, unknown> = {}): Response {
  return json({ code, message, data: { status, ...data } }, { status });
}

export const BASE = "https://wp.test";

export function storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    schema_version: 1,
    version: "abc123def456",
    generated_at: "2026-10-10T12:00:00-03:00",
    store: {
      name: "Loja Teste",
      description: "",
      language: "pt-BR",
      timezone: "-03:00",
      urls: {
        storefront: "https://loja.test",
        backend: BASE,
        rest: `${BASE}/wp-json/`,
        store_api: `${BASE}/wp-json/wc/store/v1`,
      },
    },
    routes: {
      home: "/",
      page: "/{path}",
      shop: "/loja",
      product: "/produto/{slug}",
      product_cat: "/{slug}",
      order_received: "/checkout/order-received?order_id={order_id}&key={order_key}",
    },
    commerce: undefined,
    modules: {
      search: { enabled: true } as never,
      captcha: { enabled: true, header: "X-Headpress-Captcha" } as never,
    },
    ...overrides,
  };
}

/** The error a promise rejects with (typed loosely, for assertions). Fails if it resolves. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}
