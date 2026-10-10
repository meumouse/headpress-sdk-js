import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAddressForm,
  createCartController,
  createOtpFlow,
  createReviewForm,
  createSearchBox,
  createShippingQuote,
  createSplitBuilder,
} from "../src/controllers/index.js";
import { createHeadpress, memoryCartToken, memorySession, money } from "../src/index.js";
import { storeCart } from "./fixtures.js";
import { BASE, json, mockFetch, storeConfig, wpError } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("cart controller", () => {
  it("follows every cart answer while subscribed and tracks pending lines", async () => {
    const { fetch } = mockFetch(() => json(storeCart()));
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("t") });
    const cart = createCartController(hp);
    const seen: string[] = [];
    const unsubscribe = cart.subscribe(() => seen.push(cart.getState().pending.join(",")));

    const pending = cart.actions.updateItem("abc123", 3);
    expect(cart.getState().pending).toEqual(["abc123"]);
    await pending;
    expect(cart.getState().pending).toEqual([]);
    expect(cart.getState().cart?.itemsCount).toBe(2);

    // A change made elsewhere on the page reaches the controller too.
    await hp.cart.get();
    expect(cart.getState().status).toBe("ready");
    unsubscribe();
  });

  it("keeps errors in state instead of throwing", async () => {
    const { fetch } = mockFetch(() => wpError(400, "woocommerce_rest_cart_coupon_error", "Cupom inválido"));
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("t") });
    const cart = createCartController(hp);
    expect(await cart.actions.applyCoupon("x")).toBeNull();
    expect(cart.getState().error?.code).toBe("woocommerce_rest_cart_coupon_error");
    cart.actions.clearError();
    expect(cart.getState().error).toBeNull();
  });
});

describe("search box", () => {
  it("waits for min_chars, debounces and drops stale answers", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = mockFetch((request) => json({ query: { q: new URL(request.url).searchParams.get("q") }, total: 1, groups: [] }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ modules: { search: { enabled: true, min_chars: 3 } as never } }) } });
    const box = createSearchBox(hp, { debounceMs: 100 });

    box.actions.setQuery("an");
    expect(box.getState().status).toBe("too_short");
    box.actions.setQuery("ane");
    box.actions.setQuery("anel");
    expect(box.getState().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toHaveLength(1);
    expect(box.getState().result?.query.q).toBe("anel");
    expect(box.getState().status).toBe("ready");
    box.actions.clear();
    expect(box.getState()).toMatchObject({ query: "", status: "idle", result: null });
  });
});

describe("otp flow", () => {
  it("goes start → code → wrong code → signed in", async () => {
    let attempt = 0;
    const { fetch } = mockFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/otp/start")) return json({ challenge_id: "c1", channel: "email", masked_recipient: "a***@x.com", expires_in: 300, resend_in: 30 });
      if (path.endsWith("/otp/verify")) {
        attempt++;
        return attempt === 1
          ? wpError(400, "headpress_otp_invalid", "Wrong", { attempts_left: 4 })
          : json({ access_token: "jwt", expires_in: 900, refresh_token: "r", cart_token: "c", customer: { id: 1 } });
      }
      return json({});
    });
    let clock = 1_000;
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    const flow = createOtpFlow(hp, { now: () => clock });

    expect(await flow.actions.start({ channel: "email", recipient: "a@x.com" })).toBe(true);
    expect(flow.getState()).toMatchObject({ step: "code_sent", resendAt: 31_000 });
    expect(await flow.actions.resend()).toBe(false); // too early
    expect(await flow.actions.verify("123 456")).toBe(false);
    expect(flow.getState()).toMatchObject({ step: "code_sent", attemptsLeft: 4, error: { code: "headpress_otp_invalid" } });
    expect(await flow.actions.verify("654321")).toBe(true);
    expect(flow.getState().step).toBe("signed_in");
    expect(flow.getState().result?.customer).toEqual({ id: 1 });
    clock = 0;
  });

  it("offers fallback channels and handles new recipients", async () => {
    const { fetch } = mockFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/otp/start") && request.headers.get("X-Headpress-Captcha") === "x")
        return wpError(424, "headpress_channel_unavailable", "No WhatsApp", { fallback_channels: ["email"] });
      if (path.endsWith("/otp/start")) return json({ challenge_id: "c2", channel: "email", masked_recipient: "", expires_in: 300, resend_in: null });
      if (path.endsWith("/otp/verify")) return json({ needs_registration: true, registration_token: "reg", expires_in: 900 });
      return json({ access_token: "jwt", expires_in: 900, customer: { id: 2 } }, { status: 201 });
    });
    const hp = createHeadpress({ baseUrl: BASE, fetch, session: memorySession() });
    const flow = createOtpFlow(hp);
    await flow.actions.start({ channel: "whatsapp", recipient: "+5551999999999" }, { captcha: "x" });
    expect(flow.getState()).toMatchObject({ step: "idle", fallbackChannels: ["email"] });
    await flow.actions.start({ channel: "email", recipient: "new@x.com" });
    expect(flow.getState().resendAt).toBeNull();
    await flow.actions.verify("111111");
    expect(flow.getState()).toMatchObject({ step: "needs_registration", registrationToken: "reg" });
    expect(await flow.actions.register({ email: "new@x.com" })).toBe(true);
    expect(flow.getState().step).toBe("signed_in");
  });
});

describe("review form", () => {
  const config = storeConfig({
    modules: {
      reviews: {
        enabled: true,
        rating_enabled: true,
        rating_required: true,
        title_max_length: 80,
        content_required: true,
        content_min_length: 10,
        content_max_length: 2000,
        media: { image: { enabled: true, max_files: 1, max_size: 100, types: ["image/jpeg"] }, video: { enabled: false } },
      } as never,
    },
  });

  it("checks fields and files against the store config before sending", async () => {
    const { fetch, calls } = mockFetch((request) =>
      new URL(request.url).pathname.endsWith("/store/reviews/media")
        ? json({ id: 9, type: "image", url: "u", token: "tok", expires_at: "" }, { status: 201 })
        : json({ status: "pending", review: { id: 1, content: "ok", author: {} } }, { status: 201 }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: config } });
    const form = createReviewForm(hp, 57);

    expect(await form.actions.submit()).toBe(false);
    expect(form.getState().fieldErrors).toMatchObject({ rating: "rating_required", content: "content_length" });

    await form.actions.addFiles([
      new Blob(["x"], { type: "image/png" }),
      new Blob(["x".repeat(200)], { type: "image/jpeg" }),
      new Blob(["ok"], { type: "image/jpeg" }),
      new Blob(["ok"], { type: "image/jpeg" }),
    ]);
    expect(form.getState().files).toHaveLength(1);
    expect(form.getState().files[0]?.status).toBe("uploaded");
    expect(form.getState().fieldErrors.media).toBeDefined();

    form.actions.set({ rating: 5, content: "Muito bonito, recomendo!" });
    expect(await form.actions.submit({ captcha: "c" })).toBe(true);
    expect(form.getState().status).toBe("submitted");
    expect(await calls.at(-1)!.json()).toMatchObject({ rating: 5, media: [{ id: 9, token: "tok" }] });
  });
});

describe("split builder", () => {
  it("checks the plan locally and asks the server for the amounts", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = mockFetch(() =>
      json({ currency: "BRL", total: 22000, legs: [{ gateway: "pix", kind: "pix", amount: 12000, discount: 600, charge: 11400 }, { gateway: "card", kind: "card", amount: 10000, discount: 0, charge: 10000 }], discount_total: 600, charge_total: 21400 }),
    );
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch,
      cartToken: memoryCartToken("t"),
      config: { initial: storeConfig({ modules: { split_payments: { enabled: true, min_legs: 2, max_legs: 3, min_leg_amount: 100, methods: [{ id: "pix" }, { id: "card" }] } as never } }) },
    });
    const total = money(22000, "BRL");
    const split = createSplitBuilder(hp, { total }, { debounceMs: 50 });
    expect(split.getState().problems).toContain("too_few_legs");

    split.actions.addLeg("pix");
    split.actions.setLeg(0, { amount: money(12000, "BRL") });
    split.actions.addLeg("card");
    expect(split.getState().unassigned.amount).toBe(0);
    expect(split.getState().problems).toEqual([]);
    expect(split.getState().status).toBe("quoting");
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toHaveLength(1);
    expect(split.getState().quote?.chargeTotal.amount).toBe(21400);

    split.actions.setLeg(1, { gatewayId: "boleto" });
    expect(split.getState().problems).toEqual(["unknown_method"]);
    expect(split.getState().quote).toBeNull();
  });
});

describe("shipping quote and address form", () => {
  it("validates the CEP before asking", async () => {
    const { fetch, calls } = mockFetch(() => json({ currency: "BRL", rates: [], free_shipping: null }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const quote = createShippingQuote(hp);
    quote.actions.setPostcode("0131");
    expect(await quote.actions.quote({ productId: 1 })).toBeNull();
    expect(calls).toHaveLength(0);
    quote.actions.setPostcode("01310100");
    expect(quote.getState().postcode).toBe("01310-100");
    expect(await quote.actions.quote({ productId: 1 })).toEqual({ rates: [], freeShipping: null });
  });

  it("fills empty fields from the CEP and builds checkout fields", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" }))) as typeof globalThis.fetch;
    const form = createAddressForm({ city: "Sampa" }, { fetch });
    form.actions.set({ postcode: "01310100" });
    await form.actions.lookupPostcode();
    expect(form.getState()).toMatchObject({ lookup: "found", values: { address_1: "Avenida Paulista", city: "Sampa", state: "SP" } });
    expect(form.actions.validate()).toBe(false);
    expect(form.getState().fieldErrors).toMatchObject({ first_name: "required", number: "required" });
    form.actions.set({ first_name: "Ana", last_name: "S", number: "1000", document: "529.982.247-25", phone: "51999998888" });
    expect(form.actions.validate()).toBe(true);
    expect(form.actions.checkoutFields()).toMatchObject({ billing_cpf: "52998224725", billing_number: "1000", billing_neighborhood: "Bela Vista" });
  });
});
