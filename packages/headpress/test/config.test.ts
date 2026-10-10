import { describe, expect, it, vi } from "vitest";

import { compareVersions, createHeadpress, SdkErrorCode } from "../src/index.js";
import { BASE, json, mockFetch, storeConfig, rejection } from "./helpers.js";

describe("config store", () => {
  it("loads once, serves the copy while fresh and shares concurrent loads", async () => {
    const { fetch, calls } = mockFetch(() => json(storeConfig(), { headers: { ETag: '"v1"' } }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const [a, b] = await Promise.all([hp.config.get(), hp.config.get()]);
    await hp.config.get();
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
    expect(hp.config.etag).toBe('"v1"');
    expect(hp.capabilities.has("search")).toBe(true);
    expect(hp.capabilities.has("wishlist")).toBe(false);
  });

  it("revalidates with If-None-Match and keeps the copy on 304", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.headers.get("If-None-Match") === '"v1"'
        ? new Response(null, { status: 304 })
        : json(storeConfig(), { headers: { ETag: '"v1"' } }),
    );
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { ttlMs: 1_000 } });
    const first = await hp.config.get();
    const second = await hp.config.get({ force: true });
    expect(second).toBe(first);
    expect(calls[1]?.headers.get("If-None-Match")).toBe('"v1"');
  });

  it("rejects a payload that is not a store config", async () => {
    const { fetch } = mockFetch(() => json({ hello: "proxy" }));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const error = await rejection(hp.config.get());
    expect(error.code).toBe(SdkErrorCode.invalidConfig);
  });

  it("serves a stale copy when Headpress is down, with a warning", async () => {
    let down = false;
    const { fetch } = mockFetch(() => (down ? new Response("", { status: 503 }) : json(storeConfig())));
    const onWarning = vi.fn();
    const hp = createHeadpress({ baseUrl: BASE, fetch, onWarning });
    const good = await hp.config.get();
    down = true;
    await expect(hp.config.get({ force: true })).resolves.toBe(good);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ code: "config_stale" }));
  });

  it("warns once about a schema version it does not know", async () => {
    const { fetch } = mockFetch(() => json(storeConfig({ schema_version: 2 })));
    const onWarning = vi.fn();
    const hp = createHeadpress({ baseUrl: BASE, fetch, onWarning });
    await hp.config.get();
    await hp.config.get({ force: true });
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0].code).toBe("config_schema_version");
  });

  it("warns about a Headpress older than the minimum and compares versions numerically", async () => {
    const { fetch } = mockFetch(() => json(storeConfig({ store: { ...storeConfig().store, headpress_version: "1.1.9" } })));
    const onWarning = vi.fn();
    const hp = createHeadpress({ baseUrl: BASE, fetch, onWarning });
    await hp.config.get();
    expect(onWarning.mock.calls[0]?.[0].code).toBe("headpress_version");
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("1.3", "1.3.0")).toBe(0);
  });

  it("starts from a hydrated config without fetching", async () => {
    const { fetch, calls } = mockFetch(() => json(storeConfig()));
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig() } });
    expect(hp.capabilities.known()).toBe(true);
    expect(hp.locale()).toBe("pt-BR");
    await hp.config.get();
    expect(calls).toHaveLength(0);
  });

  it("notifies subscribers when the version changes", async () => {
    let version = "a";
    const { fetch } = mockFetch(() => json(storeConfig({ version })));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    const listener = vi.fn();
    hp.config.subscribe(listener);
    await hp.config.get();
    await hp.config.get({ force: true });
    version = "b";
    await hp.config.get({ force: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
