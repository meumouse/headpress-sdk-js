import { describe, expect, it, vi } from "vitest";

import {
  createHeadpress,
  isHeadpressError,
  memoryCartToken,
  memorySession,
  retryAfter,
  SdkErrorCode,
} from "../src/index.js";
import { BASE, json, mockFetch, storeConfig, wpError, rejection } from "./helpers.js";

describe("transport: URLs and headers", () => {
  it("builds headpress and Store API URLs with the query merged", async () => {
    const { fetch, calls } = mockFetch(() => json({ ok: true }));
    const hp = createHeadpress({ baseUrl: `${BASE}/`, fetch, publishableKey: "hp_pk_1" });

    await hp.request("/store/seo/head?path=%2F", { query: { type: "post", ids: [1, 2], skip: undefined, no: null } });
    await hp.request("/cart", { api: "store" });
    await hp.request("/products/1", { api: "cm-precheckout/v1" });

    expect(calls[0]?.url).toBe(`${BASE}/wp-json/headpress/v1/store/seo/head?path=%2F&type=post&ids=1%2C2`);
    expect(calls[1]?.url).toBe(`${BASE}/wp-json/wc/store/v1/cart`);
    expect(calls[2]?.url).toBe(`${BASE}/wp-json/cm-precheckout/v1/products/1`);
    // The publishable key goes to Headpress routes only.
    expect(calls[0]?.headers.get("X-Headpress-Key")).toBe("hp_pk_1");
    expect(calls[1]?.headers.get("X-Headpress-Key")).toBeNull();
  });

  it("sends JSON bodies with a JSON content type and POST by default", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    await hp.request("/store/consent", { body: { version: 2 } });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(await calls[0]?.json()).toEqual({ version: 2 });
  });

  it("leaves FormData alone so the boundary is set by fetch", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.jpg");
    await hp.request("/store/reviews/media", { body: form });
    expect(calls[0]?.headers.get("Content-Type")).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("never sends the access token on public calls", async () => {
    const { fetch, calls } = mockFetch(() => json([]));
    const session = memorySession();
    session.setTokens({ accessToken: "jwt-1", expiresIn: 900 });
    const hp = createHeadpress({ baseUrl: BASE, fetch, session });

    await hp.request("/store/products/1/reviews");
    await hp.request("/store/customers/me", { auth: "required" });
    await hp.request("/cart", { api: "store", auth: "optional" });

    expect(calls[0]?.headers.get("Authorization")).toBeNull();
    expect(calls[1]?.headers.get("Authorization")).toBe("Bearer jwt-1");
    expect(calls[2]?.headers.get("Authorization")).toBe("Bearer jwt-1");
  });

  it("uses the captcha header the store config names", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.endsWith("/store/config")
        ? json(storeConfig({ modules: { captcha: { enabled: true, header: "X-Custom-Captcha" } as never } }))
        : json({}),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    await hp.request("/store/auth/otp/start", { body: {}, captcha: "tok" });
    expect(calls[0]?.headers.get("X-Headpress-Captcha")).toBe("tok");

    await hp.config.get();
    await hp.request("/store/auth/otp/start", { body: {}, captcha: "tok2" });
    expect(calls[2]?.headers.get("X-Custom-Captcha")).toBe("tok2");
  });
});

describe("transport: Cart-Token", () => {
  it("sends the stored token and keeps the one that comes back", async () => {
    const { fetch, calls } = mockFetch(() => json({}, { headers: { "Cart-Token": "new-token" } }));
    const cartToken = memoryCartToken("old-token");
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken });

    await hp.request("/cart", { api: "store", cartToken: true });
    expect(calls[0]?.headers.get("Cart-Token")).toBe("old-token");
    expect(cartToken.get()).toBe("new-token");
  });

  it("does not touch the token on calls that do not ask for it", async () => {
    const { fetch, calls } = mockFetch(() => json({}, { headers: { "Cart-Token": "other" } }));
    const cartToken = memoryCartToken("mine");
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken });
    await hp.request("/store/config");
    expect(calls[0]?.headers.get("Cart-Token")).toBeNull();
    expect(cartToken.get()).toBe("mine");
  });
});

describe("transport: errors", () => {
  it("turns a WordPress error into a HeadpressError with code, status and data", async () => {
    const { fetch } = mockFetch(() => wpError(400, "headpress_otp_invalid", "Invalid code", { attempts_left: 2 }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const error = await rejection(hp.request("/store/auth/otp/verify", { body: {} }));

    expect(isHeadpressError(error, "headpress_otp_invalid")).toBe(true);
    if (isHeadpressError(error, "headpress_otp_invalid")) {
      expect(error.status).toBe(400);
      expect(error.data.attempts_left).toBe(2);
      expect(error.request).toEqual({ method: "POST", path: "/wp-json/headpress/v1/store/auth/otp/verify" });
    }
  });

  it("keeps the query string (order keys) out of the error", async () => {
    const { fetch } = mockFetch(() => wpError(404, "headpress_not_found"));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const error = await rejection(hp.request("/store/orders/1/payments", { query: { key: "wc_order_secret" } }));
    expect(JSON.stringify(error.request)).not.toContain("wc_order_secret");
  });

  it("codes a non-JSON 5xx as an upstream error and reads Retry-After", async () => {
    const { fetch } = mockFetch((request) =>
      request.url.includes("busy")
        ? new Response("slow down", { status: 429, headers: { "Retry-After": "30" } })
        : new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });

    const upstream = await rejection(hp.request("/store/config"));
    expect(upstream.code).toBe("headpress_upstream_error");
    expect(upstream.status).toBe(502);

    const limited = await rejection(hp.request("/busy"));
    expect(limited.code).toBe("headpress_unknown_error");
    expect(retryAfter(limited)).toBe(30);
  });

  it("tells a network failure, a timeout and a caller abort apart", async () => {
    const hpNetwork = createHeadpress({
      baseUrl: BASE,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect((await rejection(hpNetwork.request("/x"))).code).toBe(SdkErrorCode.network);

    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const hp = createHeadpress({ baseUrl: BASE, fetch: hang, timeoutMs: 20 });
    expect((await rejection(hp.request("/x"))).code).toBe(SdkErrorCode.timeout);

    const controller = new AbortController();
    const pending = rejection(hp.request("/x", { signal: controller.signal, timeoutMs: 5_000 }));
    controller.abort();
    expect((await pending).code).toBe(SdkErrorCode.aborted);
  });

  it("rejects a 2xx body that is not JSON, and resolves 204 with undefined", async () => {
    const { fetch } = mockFetch((request) =>
      request.url.endsWith("/empty") ? new Response(null, { status: 204 }) : new Response("<html>", { status: 200 }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    expect((await rejection(hp.request("/html"))).code).toBe(SdkErrorCode.invalidResponse);
    await expect(hp.request("/empty", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("transport: modules", () => {
  it("fails fast for a module the loaded config has off, without a request", async () => {
    const { fetch, calls } = mockFetch(() => json(storeConfig()));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    await hp.config.get();
    const error = await rejection(hp.request("/store/customers/me/wishlist", { module: "wishlist" }));
    expect(error.code).toBe(SdkErrorCode.moduleDisabled);
    expect(error.data.module).toBe("wishlist");
    expect(calls).toHaveLength(1);
  });

  it("lets the call through before the config loads and maps rest_no_route", async () => {
    const { fetch, calls } = mockFetch(() => wpError(404, "rest_no_route", "No route"));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const error = await rejection(hp.request("/store/customers/me/wishlist", { module: "wishlist" }));
    expect(calls).toHaveLength(1);
    expect(error.code).toBe(SdkErrorCode.moduleDisabled);
    expect(error.cause.code).toBe("rest_no_route");
  });

  it("keeps rest_no_route when the config says the module is on (the route is missing)", async () => {
    const { fetch } = mockFetch((request) =>
      request.url.endsWith("/store/config") ? json(storeConfig()) : wpError(404, "rest_no_route", "No route"),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    await hp.config.get();
    const error = await rejection(hp.request("/store/search/new-thing", { module: "search" }));
    expect(error.code).toBe("rest_no_route");
  });
});

describe("transport: session", () => {
  it("refreshes once on 401 and replays, sharing the refresh between parallel calls", async () => {
    const valid = "jwt-new";
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accessToken: "jwt-new", expiresIn: 900, refreshToken: "rt-2" };
    });
    const session = memorySession({ refresh });
    session.setTokens({ accessToken: "jwt-old", expiresIn: 900, refreshToken: "rt-1" });
    const { fetch, calls } = mockFetch((request) =>
      request.headers.get("Authorization") === `Bearer ${valid}`
        ? json({ id: 7 })
        : wpError(401, "headpress_unauthorized"),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, session });

    const [a, b] = await Promise.all([
      hp.request("/store/customers/me", { auth: "required" }),
      hp.request("/store/customers/me/orders", { auth: "required" }),
    ]);
    expect(a).toEqual({ id: 7 });
    expect(b).toEqual({ id: 7 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("rt-1");
    expect(calls).toHaveLength(4);
    expect(session.getRefreshToken()).toBe("rt-2");
  });

  it("renews an expired token before an optional call when a session exists", async () => {
    let clock = 0;
    const session = memorySession({
      now: () => clock,
      refresh: async () => ({ accessToken: "fresh", expiresIn: 900 }),
    });
    session.setTokens({ accessToken: "stale", expiresIn: 60, refreshToken: "rt" });
    clock = 61_000;
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session });
    await hp.request("/cart", { api: "store", auth: "optional" });
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer fresh");
  });

  it("fails a required call without a session, without a request", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    const error = await rejection(hp.request("/store/customers/me", { auth: "required" }));
    expect(error.code).toBe(SdkErrorCode.notAuthenticated);
    expect(calls).toHaveLength(0);
  });

  it("uses an explicit access token as given and never refreshes it", async () => {
    const refresh = vi.fn(async () => null);
    const { fetch, calls } = mockFetch(() => wpError(401, "headpress_unauthorized"));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession({ refresh }) });
    const error = await rejection(hp.request("/store/customers/me", { auth: "required", accessToken: "explicit" }));
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer explicit");
    expect(error.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });
});
