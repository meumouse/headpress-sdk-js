import { afterEach, describe, expect, it } from "vitest";

import { SdkErrorCode } from "../src/index.js";
import * as browser from "../src/server/browser.js";
import { clientIp, createServerHeadpress } from "../src/server/index.js";
import { createHeadpress } from "../src/index.js";
import { BASE, json, mockFetch, rejection } from "./helpers.js";

describe("createServerHeadpress", () => {
  it("authenticates secret calls with the secret key, not the customer token", async () => {
    const { fetch, calls } = mockFetch(() => json({ exists: false }));
    const hp = createServerHeadpress({ baseUrl: BASE, fetch, secretKey: "hp_sk_1" });
    await hp.request("/server/cm/users/exists", { query: { email: "a@b.c" }, secret: true, accessToken: "jwt" });
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer hp_sk_1");
  });

  it("forwards the shopper IP with the secret, next to the customer token", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createServerHeadpress({ baseUrl: BASE, fetch, secretKey: "hp_sk_1" });
    await hp.request("/store/auth/login", { body: {}, clientIp: "203.0.113.9", accessToken: "jwt" });
    expect(calls[0]?.headers.get("X-Headpress-Secret")).toBe("hp_sk_1");
    expect(calls[0]?.headers.get("X-Headpress-Client-IP")).toBe("203.0.113.9");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("fails secret calls without a key, and on the browser client", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const noKey = createServerHeadpress({ baseUrl: BASE, fetch });
    expect((await rejection(noKey.request("/server/revalidate", { secret: true, body: {} }))).code).toBe(
      SdkErrorCode.secretMissing,
    );
    const plain = createHeadpress({ baseUrl: BASE, fetch });
    expect((await rejection(plain.request("/server/revalidate", { secret: true, body: {} }))).code).toBe(
      SdkErrorCode.secretMissing,
    );
    // Without a key the IP is not forwarded either.
    await noKey.request("/store/auth/login", { body: {}, clientIp: "203.0.113.9" });
    expect(calls.at(-1)?.headers.get("X-Headpress-Client-IP")).toBeNull();
  });

  describe("in a browser", () => {
    const g = globalThis as Record<string, unknown>;
    afterEach(() => {
      delete g.window;
      delete g.document;
    });

    it("refuses to run", () => {
      g.window = {};
      g.document = {};
      expect(() => createServerHeadpress({ baseUrl: BASE, secretKey: "hp_sk_1" })).toThrow(/browser/);
      expect(() => browser.createServerHeadpress()).toThrow(/browser/);
    });
  });
});

describe("clientIp", () => {
  const headers = (xff: string, real?: string) =>
    new Headers({ "x-forwarded-for": xff, ...(real ? { "x-real-ip": real } : {}) });

  it("takes the rightmost hop that is not a trusted proxy", () => {
    // A spoofed first hop is ignored; the private proxy hop is skipped.
    expect(clientIp(headers("6.6.6.6, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
    expect(clientIp(headers("203.0.113.9, 2606:4700::1"), {})).toBe("2606:4700::1");
    expect(clientIp(headers("203.0.113.9, 2606:4700::1"), { cloudflare: true })).toBe("203.0.113.9");
    expect(clientIp(headers("203.0.113.9, 198.51.100.7"), { trustedProxies: ["198.51.100.0/24"] })).toBe(
      "203.0.113.9",
    );
  });

  it("skips garbage and falls back to X-Real-IP", () => {
    expect(clientIp(headers("not-an-ip, 10.0.0.1", "203.0.113.5"))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(headers("::ffff:203.0.113.4"))).toBe("::ffff:203.0.113.4");
  });
});

describe("per-request server client", () => {
  it("forwards a default shopper IP on every call, a call's own IP winning", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const hp = createServerHeadpress({ baseUrl: BASE, fetch, secretKey: "hp_sk_1", clientIp: "203.0.113.1" });
    await hp.request("/store/config");
    await hp.request("/store/auth/login", { body: {}, clientIp: "203.0.113.2" });
    expect(calls[0]?.headers.get("X-Headpress-Client-IP")).toBe("203.0.113.1");
    expect(calls[1]?.headers.get("X-Headpress-Client-IP")).toBe("203.0.113.2");
  });
});
