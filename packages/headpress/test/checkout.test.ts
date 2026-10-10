import { describe, expect, it } from "vitest";

import {
  createHeadpress,
  definePaymentAdapter,
  memoryCartToken,
  normalizeOrderPayments,
  paymentInstructions,
  resolvePaymentData,
} from "../src/index.js";
import { BASE, json, mockFetch, storeConfig, wpError } from "./helpers.js";

const PIX_CODE = "00020126580014BR.GOV.BCB.PIX0136e2e-local-1235204000053039865802BR5913CAMILA MAEHLER6009SAO PAULO62070503***6304ABCD".replace(/ /g, "");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("paymentInstructions", () => {
  it("reads Pix from Mercado Pago, Asaas and unknown keys, never a value in the wrong place", () => {
    expect(paymentInstructions({ details: [{ key: "pix_qr_code", value: PIX_CODE }, { key: "pix_qr_code_base64", value: PNG }, { key: "pix_expires_at", value: "2026-10-10 18:00:00" }] })).toEqual({
      type: "pix",
      code: PIX_CODE,
      imageBase64: PNG,
      expiresAt: "2026-10-10T18:00:00",
    });
    expect(paymentInstructions({ details: { asaas_pix_payload: PIX_CODE, asaas_pix_qr_code: `data:image/png;base64,${PNG}` } })).toMatchObject({ type: "pix", imageBase64: PNG });
    expect(paymentInstructions({ details: { gateway_pix_emv: PIX_CODE } })).toMatchObject({ type: "pix", code: PIX_CODE });
    // A non-EMV value under a Pix-looking key is not a Pix code.
    expect(paymentInstructions({ details: { pix_qr_code: "not a code" } })).toBeNull();
  });

  it("reads bank slips and ignores cards", () => {
    expect(paymentInstructions({ details: { boleto_url: "https://bank.test/slip/1", digitable_line: "23793.38128 60000.000003 00000.000400 1 84340000010000" } })).toEqual({
      type: "boleto",
      url: "https://bank.test/slip/1",
      barcode: "23793.38128 60000.000003 00000.000400 1 84340000010000",
    });
    expect(paymentInstructions({ details: {}, kind: "boleto", redirectUrl: "https://bank.test/2" })).toMatchObject({ url: "https://bank.test/2" });
    expect(paymentInstructions({ details: { pix_qr_code: PIX_CODE }, kind: "card" })).toBeNull();
  });
});

describe("ledger", () => {
  it("normalizes the order payment summary with instructions only while pending", () => {
    const summary = normalizeOrderPayments({
      order_id: 123,
      order_number: "123",
      order_status: "partial_paid",
      currency: "BRL",
      total: 21400,
      paid: 10000,
      pending: 11400,
      remaining: 11400,
      state: "partial",
      is_split: true,
      needs_payment: true,
      payments: [
        { id: 51, gateway_id: "asaas-pix", title: "Pix", kind: "pix", amount: 11400, status: "pending", payment_details: { asaas_pix_payload: PIX_CODE }, payment_order: { id: 124, key: "wc_order_x" }, pay_url: "https://wp.test/pay" },
        { id: 50, gateway_id: "card", title: "Cartão", kind: "card", amount: 10000, status: "paid", payment_details: { pix_qr_code: PIX_CODE } },
      ],
      methods: [{ id: "asaas-pix", title: "Pix", kind: "pix", discount: { type: "percentage", amount: 5 } }, { id: "x", title: "X", kind: "cash", discount: { type: "fixed", amount: 500 } }],
    });
    expect(summary.remaining.amount).toBe(11400);
    expect(summary.payments[0]?.instructions).toMatchObject({ type: "pix" });
    expect(summary.payments[0]?.paymentOrder).toEqual({ id: 124, key: "wc_order_x" });
    expect(summary.payments[1]?.instructions).toBeNull();
    expect(summary.methods[0]?.discount).toEqual({ type: "percentage", percent: 5 });
    expect(summary.methods[1]?.discount).toEqual({ type: "fixed", amount: { amount: 500, currency: "BRL", minorUnit: 2 } });
  });
});

describe("checkout resource", () => {
  it("takes the kind from the server and never guesses one", async () => {
    const { fetch } = mockFetch(() =>
      json([
        { id: "woo-mercado-pago-pix", title: "Pix", supports: ["products"], config: { kind: "pix", discount_rule: { type: "percent", percent: 5 }, installments: null } },
        { id: "woo-mercado-pago-custom", title: "Cartão", config: { kind: "card", installments: { max: 12, interest_free_up_to: 3, monthly_rate_percent: 1.99 }, publishable_key: "APP_USR-x" } },
        { id: "some-unknown-pix-gateway", title: "Pix?", config: {} },
      ]),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ commerce: { currency: { code: "BRL", minor_unit: 2 } } as never }) } });
    const methods = await hp.checkout.paymentMethods();
    expect(methods[0]).toMatchObject({ kind: "pix", discount: { type: "percentage", percent: 5 }, installments: null });
    expect(methods[1]).toMatchObject({ kind: "card", installments: { max: 12, interestFreeUpTo: 3, monthlyRatePercent: 1.99 }, publishableKey: "APP_USR-x" });
    expect(methods[2]?.kind).toBe("other");
  });

  it("builds extensions.headpress and reads the payment result", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({
        order_id: 4746,
        order_key: "wc_order_abc",
        status: "pending",
        payment_result: { payment_status: "pending", payment_details: [{ key: "pix_qr_code", value: PIX_CODE }], redirect_url: "https://shop.test/checkout/order-received?order_id=4746&key=wc_order_abc" },
        extensions: {},
      }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("cart") });
    const order = await hp.checkout.place({
      billingAddress: { first_name: "Ana", email: "ana@example.com", country: "BR" },
      paymentMethod: "woo-mercado-pago-pix",
      paymentData: { mp_device: "abc" },
      fields: { billing_cpf: "52998224725" },
      attribution: { utm_source: "instagram" },
      consent: { version: 2, categories: ["necessary", "analytics"] },
      captcha: "cap",
      extensions: { cm_checkout: { note: "x" } },
    });

    const body = await calls[0]!.json();
    expect(new URL(calls[0]!.url).pathname).toBe("/wp-json/wc/store/v1/checkout");
    expect(calls[0]?.headers.get("Cart-Token")).toBe("cart");
    expect(body.shipping_address).toEqual(body.billing_address);
    expect(body.payment_data).toEqual([{ key: "mp_device", value: "abc" }]);
    expect(body.extensions).toEqual({
      cm_checkout: { note: "x" },
      headpress: {
        checkout_fields: { values: { billing_cpf: "52998224725" } },
        attribution: { utm_source: "instagram" },
        consent: { version: 2, categories: ["necessary", "analytics"] },
        captcha: { token: "cap" },
      },
    });
    expect(order).toMatchObject({ orderId: 4746, orderKey: "wc_order_abc", paymentStatus: "pending", instructions: { type: "pix", code: PIX_CODE } });
  });

  it("sends split legs in minor units and retries a failed order with another method", async () => {
    const { fetch, calls } = mockFetch(() => json({ order_id: 1, payment_result: { payment_status: "success", payment_details: [] } }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("cart") });
    await hp.checkout.place({
      billingAddress: {},
      paymentMethod: "headpress_split",
      splitLegs: [{ gatewayId: "asaas-pix", amount: 12000 }, { gatewayId: "asaas-credit-card", amount: { amount: 10000, currency: "BRL", minorUnit: 2 }, paymentData: [{ key: "t", value: "v" }] }],
    });
    expect((await calls[0]!.json()).extensions.headpress.split_payments.legs).toEqual([
      { gateway_id: "asaas-pix", amount: 12000 },
      { gateway_id: "asaas-credit-card", amount: 10000, payment_data: [{ key: "t", value: "v" }] },
    ]);

    await hp.checkout.retryPayment(1, { key: "wc_order_x", paymentMethod: "woo-mercado-pago-pix" });
    expect(new URL(calls[1]!.url).pathname).toBe("/wp-json/wc/store/v1/checkout/1");
    expect(await calls[1]!.json()).toEqual({ key: "wc_order_x", payment_method: "woo-mercado-pago-pix", payment_data: [] });
  });

  it("asks the server for split quotes, shipping quotes and installments", async () => {
    const { fetch, calls } = mockFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/split-payments/quote"))
        return json({ currency: "BRL", total: 22000, legs: [{ gateway: "asaas-pix", kind: "pix", amount: 12000, discount: 600, charge: 11400 }], discount_total: 600, charge_total: 21400, valid: true });
      if (path.endsWith("/shipping/quote"))
        return json({ currency: "BRL", rates: [{ id: "flat_rate:1", method_id: "flat_rate", instance_id: 1, label: "PAC", cost: 2201, taxes: 0, delivery_time: { min: 3, max: 7, unit: "days" }, meta: {} }], free_shipping: { threshold: 59900, remaining: 30000 } });
      return json({ product_id: 9, price: 30000, installments: [{ count: 3, amount: 10000, total: 30000, interest_fee: 0, has_interest: false }], best_without_interest: { count: 3, amount: 10000, total: 30000, interest_fee: 0, has_interest: false }, best_with_interest: null });
    });
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("cart") });

    const quote = await hp.checkout.quoteSplit([{ gatewayId: "asaas-pix", amount: 12000 }]);
    expect(quote.legs[0]).toMatchObject({ gatewayId: "asaas-pix", charge: { amount: 11400 } });
    expect(await calls[0]!.json()).toEqual({ legs: [{ gateway: "asaas-pix", amount: 12000 }] });

    const shipping = await hp.checkout.shippingQuote({ productId: 9, postcode: "01310-100" });
    expect(shipping.rates[0]).toMatchObject({ label: "PAC", cost: { amount: 2201 }, deliveryTime: { min: 3, max: 7 } });
    expect(shipping.freeShipping?.remaining.amount).toBe(30000);

    const plans = await hp.checkout.installments(9);
    expect(plans.bestWithoutInterest).toMatchObject({ count: 3, amount: { amount: 10000 }, hasInterest: false });
    expect(plans.bestWithInterest).toBeNull();
  });
});

describe("payments resource", () => {
  it("answers null for an unknown order and pays balances and links", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.includes("/orders/404/")
        ? wpError(404, "headpress_not_found")
        : json({ payment: { id: 52, kind: "pix", amount: 11400, status: "pending", payment_details: { pix_qr_code: PIX_CODE } }, result: { status: "pending", payment_details: { pix_qr_code: PIX_CODE } }, summary: { currency: "BRL", total: 21400 } }, { status: 201 }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    expect(await hp.payments.summary(404, { key: "x" })).toBeNull();
    const attempt = await hp.payments.payBalance(123, { gatewayId: "asaas-pix" }, { key: "wc_order_x" });
    expect(attempt.result.instructions).toMatchObject({ type: "pix" });
    expect(calls[1]?.url).toContain("key=wc_order_x");
    expect(await calls[1]!.json()).toEqual({ gateway_id: "asaas-pix" });
  });
});

describe("payment adapters", () => {
  it("picks the first adapter that matches the server's kind", async () => {
    const card = definePaymentAdapter<{ number: string }>({
      match: (method) => method.kind === "card",
      paymentData: async (input) => [{ key: "token", value: `tok_${input.number.slice(-4)}` }],
    });
    const method = { id: "gw", kind: "card", publishableKey: null, config: {} };
    expect(await resolvePaymentData([card], method, { number: "4242424242424242" })).toEqual([{ key: "token", value: "tok_4242" }]);
    expect(await resolvePaymentData([card], { ...method, kind: "pix" }, { number: "" })).toEqual([]);
  });
});
