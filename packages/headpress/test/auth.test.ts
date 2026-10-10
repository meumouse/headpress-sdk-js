import { afterEach, describe, expect, it, vi } from "vitest";

import { bffSession, createHeadpress, memoryCartToken, memorySession, SdkErrorCode } from "../src/index.js";
import { BASE, json, mockFetch, rejection, wpError } from "./helpers.js";

const customer = { id: 7, email: "ana@example.com", first_name: "Ana", last_name: "", display_name: "Ana", avatar_url: "", billing: {}, shipping: {} };
const sessionBody = {
  access_token: "jwt-1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "7.refresh",
  refresh_expires_in: 2_592_000,
  cart_token: "customer-cart",
  customer,
};

describe("auth (direct)", () => {
  it("signs in, stores both tokens and the customer's cart token", async () => {
    const { fetch, calls } = mockFetch(() => json(sessionBody));
    const session = memorySession();
    const cartToken = memoryCartToken("guest-cart");
    const hp = createHeadpress({ baseUrl: BASE, fetch, session, cartToken });

    const result = await hp.auth.login({ login: "ana@example.com", password: "secret123" }, { captcha: "tok" });
    expect(result).toEqual({ customer, cartToken: "customer-cart" });
    expect(session.getAccessToken()).toBe("jwt-1");
    expect(session.getRefreshToken()).toBe("7.refresh");
    expect(cartToken.get()).toBe("customer-cart");
    // The guest cart token goes along so Headpress merges the carts.
    expect(calls[0]?.headers.get("Cart-Token")).toBe("guest-cart");
    expect(calls[0]?.headers.get("X-Headpress-Captcha")).toBe("tok");
    expect(hp.auth.isSignedIn()).toBe(true);
  });

  it("tells a new recipient apart after a code is verified", async () => {
    const { fetch } = mockFetch(() => json({ needs_registration: true, registration_token: "reg-1", expires_in: 900 }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    expect(await hp.auth.otp.verify({ challengeId: "c1", code: "123456" })).toEqual({
      status: "needs_registration",
      registrationToken: "reg-1",
      expiresIn: 900,
    });
  });

  it("signs in from a verified code with the grant", async () => {
    const { fetch, calls } = mockFetch(() => json({ ...sessionBody, purpose: "recovery", grant: { expires_in: 600 } }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    const result = await hp.auth.otp.verify({ challengeId: "c1", code: "123456" });
    expect(result).toMatchObject({ status: "signed_in", purpose: "recovery", grant: { expires_in: 600 } });
    expect(await calls[0]?.json()).toEqual({ challenge_id: "c1", code: "123456" });
  });

  it("starts codes with the login purpose by default and surfaces channel fallbacks", async () => {
    const { fetch, calls } = mockFetch(() => wpError(424, "headpress_channel_unavailable", "No WhatsApp", { fallback_channels: ["email"] }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    const error = await rejection(hp.auth.otp.start({ channel: "whatsapp", recipient: "+5551999999999" }, { captcha: "c" }));
    expect(error.data.fallback_channels).toEqual(["email"]);
    expect(await calls[0]?.json()).toEqual({ purpose: "login", channel: "whatsapp", recipient: "+5551999999999" });
  });

  it("logs out this session, clearing tokens and the cart token even when Headpress fails", async () => {
    const { fetch, calls } = mockFetch(() => new Response("", { status: 500 }));
    const session = memorySession();
    session.setTokens({ accessToken: "jwt", expiresIn: 900, refreshToken: "7.rt" });
    const cartToken = memoryCartToken("customer-cart");
    const hp = createHeadpress({ baseUrl: BASE, fetch, session, cartToken });
    await expect(hp.auth.logout()).rejects.toMatchObject({ status: 500 });
    expect(await calls[0]?.json()).toEqual({ refresh_token: "7.rt" });
    expect(session.getAccessToken()).toBeNull();
    expect(cartToken.get()).toBeNull();
  });

  it("needs a session store to sign in", async () => {
    const hp = createHeadpress({ baseUrl: BASE });
    expect((await rejection(hp.auth.login({ login: "a", password: "b" }))).code).toBe(SdkErrorCode.notAuthenticated);
  });
});

describe("bffSession", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.document;
  });

  it("renews through the BFF, retrying once after a concurrent rotation", async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? json({ code: "headpress_unauthorized", message: "rotated", data: { status: 401 } }, { status: 401 })
        : json({ access_token: "jwt-2", expires_in: 900, customer });
    }) as unknown as typeof globalThis.fetch;
    const session = bffSession({ fetch });
    expect(await session.refresh()).toBe("jwt-2");
    expect(calls).toBe(2);
    expect(session.customer()).toEqual(customer);
    expect(session.getAccessToken()).toBe("jwt-2");
  });

  it("forgets the session after a definitive 401", async () => {
    const fetch = vi.fn(async () => json({ code: "headpress_unauthorized", message: "no", data: { status: 401 } }, { status: 401 })) as unknown as typeof globalThis.fetch;
    const session = bffSession({ fetch });
    expect(await session.refresh()).toBeNull();
    expect(session.hasSession()).toBe(false);
  });

  it("reads the marker cookie to know whether a session exists", () => {
    g.document = { cookie: "other=1; hp_session=1" };
    expect(bffSession().hasSession()).toBe(true);
    g.document = { cookie: "other=1" };
    expect(bffSession().hasSession()).toBe(false);
  });

  it("routes hp.auth through the BFF with the cart token and captcha headers", async () => {
    const requests: Request[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "https://shop.test"), init));
      return json({ access_token: "jwt-3", expires_in: 900, cart_token: "customer-cart", customer });
    }) as typeof globalThis.fetch;
    const cartToken = memoryCartToken("guest-cart");
    const session = bffSession({ fetch });
    const hp = createHeadpress({ baseUrl: BASE, session, cartToken });
    const result = await hp.auth.login({ login: "ana", password: "x" }, { captcha: "cap" });

    expect(new URL(requests[0]!.url).pathname).toBe("/api/auth/login");
    expect(requests[0]?.headers.get("Cart-Token")).toBe("guest-cart");
    expect(requests[0]?.headers.get("X-Headpress-Captcha")).toBe("cap");
    expect(result.customer).toEqual(customer);
    expect(session.getAccessToken()).toBe("jwt-3");
    expect(cartToken.get()).toBe("customer-cart");
  });
});
