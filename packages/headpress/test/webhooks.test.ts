import { describe, expect, it, vi } from "vitest";

import {
  createWebhookHandler,
  parseCacheTag,
  planRevalidation,
  readWebhook,
  signWebhook,
  WebhookError,
} from "../src/webhooks/index.js";

const SECRET = "whsec_test";
const NOW = 1_790_000_000;

async function delivery(body: object, options: { secret?: string; timestamp?: number; delivery?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? NOW;
  return new Request("https://shop.test/api/revalidate", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Headpress-Event": "product.updated",
      "X-Headpress-Delivery": options.delivery ?? "evt_1",
      "X-Headpress-Timestamp": String(timestamp),
      "X-Headpress-Signature": await signWebhook(options.secret ?? SECRET, timestamp, raw),
    },
  });
}

const payload = {
  id: "evt_1",
  event: "product.updated",
  events: ["product.updated"],
  tags: ["product:123", "product:slug:anel", "product:list"],
  paths: ["/produto/anel/"],
  sent_at: "2026-10-10T12:00:00+00:00",
};
const now = () => NOW * 1000;

describe("readWebhook", () => {
  it("verifies and parses a delivery", async () => {
    const result = await readWebhook(await delivery(payload), { secret: SECRET, now });
    expect(result).toMatchObject({ id: "evt_1", deliveryId: "evt_1", tags: payload.tags, paths: payload.paths, timestamp: NOW });
  });

  it("rejects a wrong secret, a stale timestamp, a missing signature and a bad body", async () => {
    await expect(readWebhook(await delivery(payload, { secret: "other" }), { secret: SECRET, now })).rejects.toMatchObject({
      reason: "invalid_signature",
      status: 401,
    });
    await expect(readWebhook(await delivery(payload, { timestamp: NOW - 301 }), { secret: SECRET, now })).rejects.toMatchObject({
      reason: "expired",
    });
    const unsigned = new Request("https://shop.test", { method: "POST", body: "{}" });
    await expect(readWebhook(unsigned, { secret: SECRET, now })).rejects.toBeInstanceOf(WebhookError);

    const raw = "not json";
    const bad = new Request("https://shop.test", {
      method: "POST",
      body: raw,
      headers: { "X-Headpress-Timestamp": String(NOW), "X-Headpress-Signature": await signWebhook(SECRET, NOW, raw) },
    });
    await expect(readWebhook(bad, { secret: SECRET, now })).rejects.toMatchObject({ reason: "invalid_body", status: 400 });
  });

  it("refuses everything without a secret", async () => {
    await expect(readWebhook(await delivery(payload), { secret: "", now })).rejects.toMatchObject({ reason: "missing_secret", status: 500 });
  });
});

describe("planRevalidation", () => {
  it("adds path tags and derived tags", () => {
    const plan = planRevalidation(payload);
    expect(plan.tags).toEqual(expect.arrayContaining(["product:123", "path:/produto/anel", "seo:sitemap"]));
    expect(plan.paths).toEqual(["/produto/anel/"]);
    expect(plan.config).toBe(false);

    const seo = planRevalidation({ tags: ["seo:redirects", "headpress:config"], paths: [] });
    expect(seo.tags).toContain("seo:head");
    expect(seo.redirects).toBe(true);
    expect(seo.config).toBe(true);
  });

  it("parses the tag vocabulary", () => {
    expect(parseCacheTag("product:123")).toEqual({ kind: "post", postType: "product", id: 123 });
    expect(parseCacheTag("page:slug:about")).toEqual({ kind: "post_slug", postType: "page", slug: "about" });
    expect(parseCacheTag("product:list")).toEqual({ kind: "post_list", postType: "product" });
    expect(parseCacheTag("term:product_cat:slug:aneis")).toEqual({ kind: "term_slug", taxonomy: "product_cat", slug: "aneis" });
    expect(parseCacheTag("term:product_cat:7")).toEqual({ kind: "term", taxonomy: "product_cat", id: 7 });
    expect(parseCacheTag("menu:primary")).toEqual({ kind: "menu", location: "primary" });
    expect(parseCacheTag("reviews:product:9")).toEqual({ kind: "reviews", productId: 9 });
    expect(parseCacheTag("acf:options:footer")).toEqual({ kind: "acf", page: "footer", name: "options" });
    expect(parseCacheTag("headpress:config")).toEqual({ kind: "config" });
    expect(parseCacheTag("weird tag")).toEqual({ kind: "other", tag: "weird tag" });
  });
});

describe("createWebhookHandler", () => {
  it("calls onDelivery once per delivery id and answers 200 to retries", async () => {
    const onDelivery = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, now, onDelivery });
    expect((await handler(await delivery(payload))).status).toBe(200);
    const again = await handler(await delivery(payload));
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(onDelivery).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when onDelivery throws, so Headpress retries, and handles the retry later", async () => {
    let fail = true;
    const onDelivery = vi.fn(() => {
      if (fail) throw new Error("purge failed");
    });
    const handler = createWebhookHandler({ secret: SECRET, now, onDelivery });
    expect((await handler(await delivery(payload, { delivery: "evt_2" }))).status).toBe(500);
    fail = false;
    expect((await handler(await delivery(payload, { delivery: "evt_2" }))).status).toBe(200);
    expect(onDelivery).toHaveBeenCalledTimes(2);
  });

  it("answers 401 to a bad signature and 405 to GET", async () => {
    const handler = createWebhookHandler({ secret: SECRET, now, onDelivery: vi.fn() });
    expect((await handler(await delivery(payload, { secret: "x" }))).status).toBe(401);
    expect((await handler(new Request("https://shop.test"))).status).toBe(405);
  });
});
