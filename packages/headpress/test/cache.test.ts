import { describe, expect, it, vi } from "vitest";

import { memoryCache, redisCache, swr } from "../src/server/index.js";

describe("swr", () => {
  it("serves fresh entries without calling the producer", async () => {
    let clock = 0;
    const store = memoryCache({ now: () => clock });
    const producer = vi.fn(async () => ({ name: "anel" }));
    const options = { ttl: 60, grace: 600, now: () => clock };

    expect(await swr(store, "k", options, producer)).toEqual({ ok: true, value: { name: "anel" }, stale: false });
    clock = 30_000;
    expect(await swr(store, "k", options, producer)).toEqual({ ok: true, value: { name: "anel" }, stale: false });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("serves stale entries at once and refreshes in the background", async () => {
    let clock = 0;
    const store = memoryCache({ now: () => clock });
    let version = 1;
    const producer = vi.fn(async () => version);
    const options = { ttl: 60, grace: 600, now: () => clock };

    await swr(store, "k", options, producer);
    clock = 120_000;
    version = 2;
    expect(await swr(store, "k", options, producer)).toEqual({ ok: true, value: 1, stale: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await swr(store, "k", options, producer)).toEqual({ ok: true, value: 2, stale: false });
  });

  it("keeps serving the stale copy when the background refresh fails, and tells nothing-at-all apart", async () => {
    let clock = 0;
    const store = memoryCache({ now: () => clock });
    const options = { ttl: 60, grace: 600, now: () => clock };
    await swr(store, "k", options, async () => "good");
    clock = 120_000;
    const failing = vi.fn(async (): Promise<string> => {
      throw new Error("down");
    });
    expect(await swr(store, "k", options, failing)).toEqual({ ok: true, value: "good", stale: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await swr(store, "k", options, failing)).toEqual({ ok: true, value: "good", stale: true });

    const outcome = await swr(store, "other", options, failing);
    expect(outcome.ok).toBe(false);
    // A producer answering null is a value, not a failure.
    expect(await swr(store, "null", options, async () => null)).toEqual({ ok: true, value: null, stale: false });
  });

  it("runs one producer for concurrent misses", async () => {
    const producer = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 1;
    });
    const store = memoryCache();
    await Promise.all([1, 2, 3].map(() => swr(store, "flight", { ttl: 60, grace: 60 }, producer)));
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("goes straight to the producer without a store", async () => {
    expect(await swr(null, "k", { ttl: 1, grace: 1 }, async () => 5)).toEqual({ ok: true, value: 5, stale: false });
  });
});

describe("stores", () => {
  it("memoryCache expires, evicts and deletes by pattern", async () => {
    let clock = 0;
    const store = memoryCache({ maxEntries: 2, now: () => clock });
    await store.set("a:1", "1", 10);
    await store.set("a:2", "2", 10);
    await store.set("b:1", "3", 10);
    expect(await store.get("a:1")).toBeNull();
    await store.deletePattern?.("a:*");
    expect(await store.get("a:2")).toBeNull();
    expect(await store.get("b:1")).toBe("3");
    clock = 11_000;
    expect(await store.get("b:1")).toBeNull();
  });

  it("redisCache talks to an ioredis-like client", async () => {
    const data = new Map<string, string>();
    const client = {
      get: vi.fn(async (key: string) => data.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (...keys: string[]) => keys.forEach((key) => data.delete(key))),
      scan: vi.fn(async (_cursor: string | number) => ["0", Array.from(data.keys()).filter((key) => key.startsWith("hp:wc:"))] as [string, string[]]),
    };
    const store = redisCache(client, { prefix: "hp:" });
    await store.set("wc:1", "x", 30.4);
    expect(client.set).toHaveBeenCalledWith("hp:wc:1", "x", "EX", 31);
    expect(await store.get("wc:1")).toBe("x");
    await store.deletePattern?.("wc:*");
    expect(client.scan).toHaveBeenCalledWith("0", "MATCH", "hp:wc:*", "COUNT", 200);
    expect(data.size).toBe(0);
  });
});
