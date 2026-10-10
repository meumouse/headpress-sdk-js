import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserIds,
  captureAbandonedCart,
  cartEventParams,
  checkoutAttribution,
  checkoutConsent,
  consentModeDefaults,
  consentModeState,
  consumeRecoveryToken,
  createAttribution,
  createConsent,
  createRelay,
  createTracker,
  eventId,
  ga4Provider,
  itemFromCartItem,
  itemFromProduct,
  localIdentity,
  metaPixelProvider,
  parseGaClientId,
  parseGaSessionId,
  pinterestProvider,
  productEventParams,
  providersFromConfig,
  purchaseEventId,
  recordConsent,
  trackPurchase,
  withoutParam,
  type AnalyticsProvider,
  type ConsentState,
} from "../src/analytics/index.js";
import { createHeadpress, memoryCartToken, normalizeCart, normalizeProduct, type ConsentModuleConfig } from "../src/index.js";
import { storeCart, storeProduct } from "./fixtures.js";
import { BASE, json, mockFetch, storeConfig, wpError } from "./helpers.js";

// ---------------------------------------------------------------------------------------------
// A minimal browser: window, document (cookies, scripts, listeners), storage. Removed after each test.
// ---------------------------------------------------------------------------------------------

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

interface BrowserOptions {
  url?: string;
  referrer?: string;
  blockStorage?: boolean;
  blockCookies?: boolean;
}

function installBrowser(options: BrowserOptions = {}) {
  const cookies = new Map<string, string>();
  const cookieWrites: string[] = [];
  const scripts: { src: string; async: boolean }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, listener: () => void): void => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
  };
  const off = (type: string, listener: () => void): void => {
    listeners.get(type)?.delete(listener);
  };
  const doc = {
    get cookie(): string {
      if (options.blockCookies) throw new Error("SecurityError");
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(value: string) {
      if (options.blockCookies) throw new Error("SecurityError");
      cookieWrites.push(value);
      const [pair = "", ...attributes] = value.split(";").map((part) => part.trim());
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const cookieValue = pair.slice(index + 1);
      const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith("max-age="));
      if (cookieValue === "" || (maxAge && Number(maxAge.split("=")[1]) <= 0)) cookies.delete(name);
      else cookies.set(name, cookieValue);
    },
    referrer: options.referrer ?? "",
    visibilityState: "visible",
    head: {
      appendChild: (element: { src: string; async: boolean }) => {
        scripts.push(element);
        return element;
      },
    },
    createElement: () => ({ src: "", async: false }),
    querySelector: (selector: string) => scripts.find((script) => selector.includes(`"${script.src}"`)) ?? null,
    addEventListener: on,
    removeEventListener: off,
  };
  const win: Record<string, unknown> = {
    location: new URL(options.url ?? "https://shop.test/"),
    navigator: { userAgent: "TestAgent/1.0" },
    addEventListener: on,
    removeEventListener: off,
    document: doc,
  };
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  if (options.blockStorage) {
    Object.defineProperty(win, "localStorage", { get: () => { throw new Error("SecurityError"); } });
    Object.defineProperty(win, "sessionStorage", { get: () => { throw new Error("SecurityError"); } });
  } else {
    win.localStorage = local;
    win.sessionStorage = session;
  }
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return {
    win,
    doc,
    cookies,
    cookieWrites,
    scripts,
    local,
    session,
    navigate(url: string) {
      win.location = new URL(url);
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function consentConfig(overrides: Partial<ConsentModuleConfig> = {}): ConsentModuleConfig {
  return {
    enabled: true,
    version: 1,
    cookie_days: 180,
    categories: [
      { id: "necessary", label: "Necessary", required: true },
      { id: "analytics", label: "Analytics", required: false },
      { id: "marketing", label: "Marketing", required: false },
    ],
    texts: { message: "", accept_all: "", reject_all: "", customize: "", save: "", policy_link: "" },
    consent_mode: {
      ad_storage: "marketing",
      ad_user_data: "marketing",
      ad_personalization: "marketing",
      analytics_storage: "analytics",
      functionality_storage: "necessary",
      personalization_storage: "preferences",
      security_storage: "necessary",
    },
    wait_for_update: 500,
    record_endpoint: `${BASE}/wp-json/headpress/v1/store/consent`,
    privacy_path: "/privacy",
    consent_defaults: { ad_storage: "denied", analytics_storage: "denied", functionality_storage: "granted" },
    ...overrides,
  };
}

const decided = (categories: string[], version = 1): ConsentState => ({ decided: true, version, categories, id: "c-1" });
const UNDECIDED: ConsentState = { decided: false, version: null, categories: ["necessary"], id: null };

/** A provider that records what it receives. */
function spyProvider(name: string, category: string | null): AnalyticsProvider & { events: { event: string; id: string; params: unknown }[]; starts: number } {
  const provider = {
    name,
    category,
    events: [] as { event: string; id: string; params: unknown }[],
    starts: 0,
    start() {
      provider.starts += 1;
    },
    track(event: string, params: unknown, context: { eventId: string }) {
      provider.events.push({ event, id: context.eventId, params });
    },
  };
  return provider as never;
}

// ---------------------------------------------------------------------------------------------

describe("consent", () => {
  it("starts undecided with the required categories and stores a decision in a first-party cookie", () => {
    const browser = installBrowser();
    const config = consentConfig({ cookie_days: 10 });
    const consent = createConsent({ config });
    expect(consent.get()).toEqual({ decided: false, version: null, categories: ["necessary"], id: null });
    expect(consent.has("necessary")).toBe(true);
    expect(consent.has("analytics")).toBe(false);

    const state = consent.grant(["analytics", "made_up"]);
    expect(state).toMatchObject({ decided: true, version: 1, categories: ["necessary", "analytics"] });
    expect(state.id).toMatch(/.{8,}/);
    expect(consent.has("analytics")).toBe(true);
    expect(consent.has("marketing")).toBe(false);
    expect(browser.cookieWrites[0]).toMatch(/^hp_consent=/);
    expect(browser.cookieWrites[0]).toContain(`Max-Age=${10 * 86_400}`);
    expect(browser.cookieWrites[0]).toContain("Secure");
    // A new instance (next page) reads the same decision.
    expect(createConsent({ config }).get()).toEqual(state);
  });

  it("treats a decision made under an older version as undecided", () => {
    installBrowser();
    let config = consentConfig({ version: 1 });
    const consent = createConsent({ config: () => config });
    consent.acceptAll();
    expect(consent.get()).toMatchObject({ decided: true, version: 1, categories: ["necessary", "analytics", "marketing"] });

    config = consentConfig({ version: 2 });
    expect(consent.get()).toEqual({ decided: false, version: null, categories: ["necessary"], id: null });
    expect(consent.has("marketing")).toBe(false);

    consent.rejectAll();
    expect(consent.get()).toMatchObject({ decided: true, version: 2, categories: ["necessary"] });
  });

  it("notifies subscribers, resets, reads a server cookie and survives blocked cookies", () => {
    installBrowser({ blockCookies: true });
    const consent = createConsent({ config: consentConfig() });
    const seen: ConsentState[] = [];
    const unsubscribe = consent.subscribe((state) => seen.push(state));
    consent.grant(["marketing"]);
    // Cookies throw, but the decision holds for this page.
    expect(consent.get()).toMatchObject({ decided: true, categories: ["necessary", "marketing"] });
    consent.reset();
    expect(consent.get().decided).toBe(false);
    unsubscribe();
    consent.acceptAll();
    expect(seen.map((state) => state.decided)).toEqual([true, false]);

    vi.unstubAllGlobals();
    const raw = encodeURIComponent(JSON.stringify({ id: "srv", version: 1, categories: ["analytics"], at: "" }));
    const server = createConsent({ config: consentConfig(), read: () => raw });
    expect(server.get()).toEqual({ decided: true, version: 1, categories: ["necessary", "analytics"], id: "srv" });
  });

  it("maps decisions to Google Consent Mode v2 through consent_mode and consent_defaults", () => {
    const config = consentConfig({ consent_mode: { ...consentConfig().consent_mode, analytics_storage: "statistics" } });
    expect(consentModeDefaults(config)).toEqual({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "granted",
      personalization_storage: "denied",
      security_storage: "granted",
      wait_for_update: 500,
    });
    expect(consentModeState(decided(["necessary", "statistics"]), config)).toMatchObject({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      functionality_storage: "granted",
    });
    expect(consentModeState(decided(["necessary", "analytics", "marketing"]), config)).toMatchObject({
      analytics_storage: "denied",
      ad_storage: "granted",
      ad_personalization: "granted",
    });
    expect(consentModeState(UNDECIDED, null).security_storage).toBe("granted");
    expect(checkoutConsent(decided(["necessary", "marketing"], 3))).toEqual({ version: 3, categories: ["necessary", "marketing"] });
    expect(checkoutConsent(UNDECIDED)).toEqual({ version: null, categories: ["necessary"] });
  });

  it("records explicit decisions in Headpress' consent log, never throwing", async () => {
    const { fetch, calls } = mockFetch(() => json({ consent_id: "c-1", recorded_at: "now" }, { status: 201 }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ modules: { consent: consentConfig() } as never }) } });
    expect(await recordConsent(hp, decided(["necessary", "analytics"]), { source: "settings" })).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/wp-json/headpress/v1/store/consent");
    expect(calls[0]?.keepalive).toBe(true);
    expect(await calls[0]?.json()).toEqual({ consent_id: "c-1", version: 1, categories: ["necessary", "analytics"], source: "settings" });

    expect(await recordConsent(hp, UNDECIDED)).toBe(false);
    const off = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ modules: { consent: consentConfig({ record_endpoint: null }) } as never }) } });
    expect(await recordConsent(off, decided(["necessary"]))).toBe(false);
    expect(calls).toHaveLength(1);

    const failing = mockFetch(() => wpError(429, "headpress_rate_limited"));
    const limited = createHeadpress({ baseUrl: BASE, fetch: failing.fetch, config: { initial: storeConfig({ modules: { consent: consentConfig() } as never }) } });
    expect(await recordConsent(limited, decided(["necessary"]))).toBe(false);
  });
});

describe("events and ids", () => {
  it("builds items from products and cart lines in major units, with Headpress' item id rule", () => {
    const product = normalizeProduct(storeProduct());
    expect(itemFromProduct(product, { listName: "Home", index: 2 })).toEqual({
      item_id: "AN-1",
      item_name: product.name,
      price: 199.9,
      quantity: 1,
      item_category: "Anéis",
      item_list_name: "Home",
      index: 2,
    });
    expect(productEventParams(product, { quantity: 3 })).toMatchObject({ currency: "BRL", value: 599.7 });
    expect(itemFromProduct(normalizeProduct(storeProduct({ sku: "" }))).item_id).toBe(String(product.id));

    const cart = normalizeCart(storeCart());
    const line = cart.items[0]!;
    expect(itemFromCartItem(line, { category: "Rings" })).toEqual({
      item_id: "AN-1",
      item_name: "Anel & Cia",
      price: 199.9,
      quantity: 2,
      item_variant: "16",
      item_category: "Rings",
    });
    expect(cartEventParams(cart)).toMatchObject({ currency: "BRL", value: 359.82, coupon: "bemvinda", items: [{ item_id: "AN-1" }] });
  });

  it("makes random event ids and one purchase id", () => {
    expect(eventId("add_to_cart")).toMatch(/^add_to_cart_\d{10}_[a-z0-9]{8}$/);
    expect(eventId("Add To Cart!")).toMatch(/^add_to_cart_/);
    expect(eventId()).not.toBe(eventId());
    expect(purchaseEventId(29)).toBe("purchase_29");
    expect(purchaseEventId(" 29 ")).toBe("purchase_29");
    expect(() => purchaseEventId("abc")).toThrow(TypeError);
    expect(() => purchaseEventId(0)).toThrow(TypeError);
  });
});

describe("tracker", () => {
  it("queues events until consent is decided, then delivers them only to allowed providers", () => {
    installBrowser();
    const consent = createConsent({ config: consentConfig() });
    const ga = spyProvider("ga", "analytics");
    const meta = spyProvider("meta", "marketing");
    const tracker = createTracker({ consent, providers: [ga, meta], currency: "BRL" });

    const first = tracker.track("page_view", { page_location: "https://shop.test/" });
    tracker.track("add_to_cart", { value: 10, items: [{ item_id: "1", item_name: "A", price: 10 }] });
    expect(tracker.pending()).toBe(2);
    expect(ga.events).toHaveLength(0);
    expect(ga.starts).toBe(0);

    consent.grant(["analytics"]);
    expect(tracker.pending()).toBe(0);
    expect(ga.starts).toBe(1);
    expect(ga.events.map((entry) => entry.event)).toEqual(["page_view", "add_to_cart"]);
    expect(ga.events[0]?.id).toBe(first);
    expect(ga.events[1]?.params).toMatchObject({ currency: "BRL", value: 10 });
    // Refused: dropped for good, even when marketing is granted later.
    expect(meta.events).toHaveLength(0);

    tracker.track("search", { search_term: "ring" });
    expect(meta.events).toHaveLength(0);
    consent.grant(["analytics", "marketing"]);
    expect(meta.starts).toBe(1);
    expect(meta.events).toHaveLength(0);
    tracker.track("search", { search_term: "gold" });
    expect(meta.events.map((entry) => entry.event)).toEqual(["search"]);
    expect(ga.events).toHaveLength(4);
  });

  it("delivers right away to providers without a category and caps the queue", () => {
    installBrowser();
    const consent = createConsent({ config: consentConfig() });
    const open = spyProvider("open", null);
    const gated = spyProvider("gated", "analytics");
    const tracker = createTracker({ consent, providers: [open, gated], maxQueue: 3 });
    for (let index = 0; index < 5; index += 1) tracker.track("search", { search_term: String(index) });
    expect(open.events).toHaveLength(5);
    expect(tracker.pending()).toBe(3);
    consent.acceptAll();
    expect(gated.events.map((entry) => (entry.params as { search_term: string }).search_term)).toEqual(["2", "3", "4"]);
  });

  it("does nothing on the server and returns the id", () => {
    const consent = createConsent({ config: consentConfig(), read: () => null });
    const provider = spyProvider("ga", null);
    const tracker = createTracker({ consent, providers: [provider] });
    expect(tracker.track("login", {}, { eventId: "login_1" })).toBe("login_1");
    expect(provider.events).toHaveLength(0);
    expect(tracker.pending()).toBe(0);
  });

  it("shares one event_id between the browser pixel and the relayed copy", async () => {
    const browser = installBrowser({ url: "https://shop.test/produto/anel" });
    browser.cookies.set("_fbp", "fb.1.1790000000000.1234567890");
    const fbq = vi.fn();
    browser.win.fbq = fbq;
    const { fetch, calls } = mockFetch(() => json({ queued: 1, rejected: [] }, { status: 202 }));
    const modules = { consent: consentConfig(), meta_pixel: { enabled: true, pixel_id: "123", conversions_api: true, relay_events: true } };
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ modules: modules as never }) } });
    const consent = createConsent({ config: () => hp.capabilities.get("consent") });
    consent.acceptAll();
    const relay = createRelay(hp);
    const tracker = createTracker({ consent, providers: providersFromConfig(hp.config.peek()), relay });
    tracker.identify({ email: "ana@example.com" });

    const id = tracker.track("add_to_cart", {
      currency: "BRL",
      value: 199.9,
      items: [{ item_id: "AN-1", item_name: "Anel", price: 199.9, quantity: 1, item_category: "Anéis" }],
    });
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "AddToCart",
      expect.objectContaining({ content_ids: ["AN-1"], value: 199.9, content_type: "product", num_items: 1 }),
      { eventID: id },
    );

    await relay.flush();
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe("/wp-json/headpress/v1/store/analytics/events");
    const body = (await calls[0]!.json()) as { events: Record<string, unknown>[] };
    expect(body.events).toEqual([
      {
        provider: "meta",
        name: "AddToCart",
        event_id: id,
        event_source_url: "https://shop.test/produto/anel",
        params: {
          currency: "BRL",
          value: 199.9,
          content_ids: ["AN-1"],
          contents: [{ id: "AN-1", quantity: 1, item_price: 199.9 }],
          content_type: "product",
          num_items: 1,
          content_name: "Anel",
          content_category: "Anéis",
        },
        identity: { email: "ana@example.com", fbp: "fb.1.1790000000000.1234567890", client_user_agent: "TestAgent/1.0" },
        consent: { categories: ["necessary", "analytics", "marketing"] },
      },
    ]);
  });

  it("never relays purchases or browser-only events, nor providers that do not relay", async () => {
    installBrowser();
    const { fetch, calls } = mockFetch(() => json({ queued: 0 }));
    const modules = { meta_pixel: { enabled: true, pixel_id: "1", relay_events: true }, pinterest: { enabled: true, tag_id: "2", relay_events: false } };
    const hp = createHeadpress({ baseUrl: BASE, fetch, config: { initial: storeConfig({ modules: modules as never }) } });
    const consent = createConsent({ config: null });
    consent.acceptAll();
    const relay = createRelay(hp);
    const tracker = createTracker({ consent, providers: providersFromConfig(hp.config.peek()), relay });
    tracker.track("purchase", { transaction_id: "9", currency: "BRL", value: 10 });
    tracker.track("search", { search_term: "x" }, { browserOnly: true });
    tracker.track("sign_up", { method: "email" });
    expect(relay.pending()).toBe(1);
    await relay.flush();
    const body = (await calls[0]!.json()) as { events: { provider: string; name: string }[] };
    expect(body.events.map((event) => `${event.provider}:${event.name}`)).toEqual(["meta:CompleteRegistration"]);
  });

  it("passes the identity only to allowed providers and starts clean for a different person", () => {
    const browser = installBrowser();
    const pintrk = vi.fn();
    browser.win.pintrk = pintrk;
    const consent = createConsent({ config: consentConfig() });
    const identity = localIdentity();
    const tracker = createTracker({ consent, providers: [pinterestProvider({ tagId: "1", enhancedMatch: true })], identity });
    tracker.identify({ email: "Ana@Example.com", phone: "+5541999999999" });
    expect(pintrk).not.toHaveBeenCalled();
    const firstExternal = tracker.identity().external_id;
    expect(firstExternal).toBeTruthy();

    consent.acceptAll();
    tracker.identify({ first_name: "Ana" });
    expect(pintrk).toHaveBeenCalledWith("set", { em: "ana@example.com" });
    expect(tracker.identity()).toMatchObject({ email: "Ana@Example.com", first_name: "Ana", external_id: firstExternal });

    tracker.identify({ email: "bia@example.com" });
    expect(tracker.identity().phone).toBeUndefined();
    expect(tracker.identity().external_id).not.toBe(firstExternal);
    tracker.reset();
    expect(tracker.identity().email).toBeUndefined();
  });
});

describe("relay", () => {
  function relayClient() {
    const mock = mockFetch(() => json({ queued: 1, rejected: [] }, { status: 202 }));
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch: mock.fetch,
      config: { initial: storeConfig({ modules: { meta_pixel: { enabled: true, pixel_id: "1", relay_events: true } } as never }) },
    });
    return { ...mock, hp };
  }
  const event = (index: number) => ({
    provider: "meta" as const,
    name: "PageView",
    event_id: `pv_${index}`,
    event_source_url: "https://shop.test/",
    params: {},
    identity: {},
    consent: { categories: ["necessary", "marketing"] },
  });

  it("sends at most 20 events per request, with keepalive", async () => {
    installBrowser();
    const { hp, calls } = relayClient();
    const relay = createRelay(hp, { maxBatch: 50 });
    for (let index = 0; index < 45; index += 1) relay.push(event(index));
    await relay.flush();
    const sizes = await Promise.all(calls.map(async (call) => ((await call.json()) as { events: unknown[] }).events.length));
    expect(sizes).toEqual([20, 20, 5]);
    expect(calls.every((call) => call.keepalive)).toBe(true);
  });

  it("flushes after a pause and when the page is hidden; refuses purchases and bad ids", async () => {
    vi.useFakeTimers();
    const browser = installBrowser();
    const { hp, calls } = relayClient();
    const relay = createRelay(hp, { flushDelayMs: 1000 });
    relay.push(event(1));
    relay.push({ ...event(2), name: "Purchase" });
    relay.push({ ...event(3), event_id: "bad id!" });
    expect(relay.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);

    relay.push(event(4));
    browser.fire("pagehide");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    relay.destroy();
  });

  it("is off for providers whose module does not relay and swallows errors", async () => {
    installBrowser();
    const failing = mockFetch(() => wpError(429, "headpress_rate_limited"));
    const hp = createHeadpress({ baseUrl: BASE, fetch: failing.fetch, config: { initial: storeConfig({ modules: { meta_pixel: { enabled: true, relay_events: true } } as never }) } });
    const relay = createRelay(hp);
    expect(relay.enabled("meta")).toBe(true);
    expect(relay.enabled("pinterest")).toBe(false);
    relay.push({ ...event(1), provider: "pinterest" });
    expect(relay.pending()).toBe(0);
    relay.push(event(2));
    await expect(relay.flush()).resolves.toBeUndefined();
  });
});

describe("providers", () => {
  it("GA4: Consent Mode default and update, gtag events, Ads conversions under marketing", () => {
    const browser = installBrowser();
    const config = consentConfig();
    const consent = createConsent({ config });
    const ga4 = ga4Provider({
      measurementId: "G-ABC",
      googleAdsId: "AW-1",
      googleAdsLabels: { purchase: "buy", add_to_cart: "" },
      load: true,
    });
    const tracker = createTracker({ consent, providers: [ga4] });
    const layer = () => (browser.win.dataLayer as ArrayLike<unknown>[]).map((entry) => Array.from(entry));

    expect(layer()[0]).toEqual(["consent", "default", consentModeDefaults(config)]);
    expect(browser.scripts).toHaveLength(0);

    consent.grant(["analytics"]);
    expect(layer()[1]).toEqual(["consent", "update", expect.objectContaining({ analytics_storage: "granted", ad_storage: "denied" })]);
    expect(browser.scripts.map((script) => script.src)).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-ABC"]);
    expect(layer()).toContainEqual(["config", "G-ABC", { send_page_view: false }]);

    const id = tracker.track("purchase", {
      transaction_id: "29",
      currency: "BRL",
      value: 219.9,
      items: [{ item_id: "AN-1", catalog_id: "12", item_name: "Anel", price: 199.9 }],
    });
    expect(layer()).toContainEqual([
      "event",
      "purchase",
      { transaction_id: "29", currency: "BRL", value: 219.9, items: [{ item_id: "AN-1", item_name: "Anel", price: 199.9 }], event_id: id },
    ]);
    // No marketing consent: no Ads conversion.
    expect(layer().some((entry) => entry[1] === "conversion")).toBe(false);

    consent.acceptAll();
    tracker.track("purchase", { transaction_id: "30", currency: "BRL", value: 10 });
    tracker.track("add_to_cart", { currency: "BRL", value: 10 });
    const conversions = layer().filter((entry) => entry[1] === "conversion");
    expect(conversions).toEqual([["event", "conversion", { send_to: "AW-1/buy", value: 10, currency: "BRL", transaction_id: "30" }]]);
  });

  it("GA4: GTM data layer format and server-side purchases", () => {
    const browser = installBrowser();
    const consent = createConsent({ config: consentConfig() });
    consent.acceptAll();
    const tracker = createTracker({
      consent,
      providers: [ga4Provider({ measurementId: "G-ABC", mode: "dataLayer", serverSidePurchase: true, consentDefaults: false })],
    });
    const id = tracker.track("add_to_cart", { currency: "BRL", value: 10, items: [{ item_id: "1", item_name: "A" }], list: "home" });
    tracker.track("purchase", { transaction_id: "1", currency: "BRL", value: 10 });
    tracker.track("login", { method: "otp" });
    expect(browser.win.dataLayer).toEqual([
      { ecommerce: null },
      { event: "add_to_cart", event_id: id, list: "home", ecommerce: { currency: "BRL", value: 10, items: [{ item_id: "1", item_name: "A" }] } },
      { event: "login", event_id: expect.any(String), method: "otp" },
    ]);
  });

  it("loads the official tags only after consent, and fires with the shared event id", () => {
    const browser = installBrowser();
    const consent = createConsent({ config: consentConfig() });
    const tracker = createTracker({
      consent,
      providers: [metaPixelProvider({ pixelId: "PX", load: true }), pinterestProvider({ tagId: "TG", load: true })],
    });
    tracker.track("page_view", {});
    expect(browser.scripts).toHaveLength(0);
    expect(browser.win.fbq).toBeUndefined();

    consent.acceptAll();
    expect(browser.scripts.map((script) => script.src)).toEqual([
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://s.pinimg.com/ct/core.js",
    ]);
    const fbqQueue = (browser.win.fbq as { queue: ArrayLike<unknown>[] }).queue.map((entry) => Array.from(entry));
    expect(fbqQueue[0]).toEqual(["init", "PX"]);
    expect(fbqQueue[1]).toEqual(["track", "PageView", {}, { eventID: expect.any(String) }]);
    const pinQueue = (browser.win.pintrk as { queue: unknown[][] }).queue;
    expect(pinQueue[0]).toEqual(["load", "TG", {}]);
    expect(pinQueue[1]).toEqual(["page"]);
    expect(pinQueue[2]).toEqual(["track", "pagevisit", { event_id: (fbqQueue[1]![3] as { eventID: string }).eventID }]);

    const id = tracker.track("purchase", {
      transaction_id: "29",
      currency: "BRL",
      value: 219.9,
      coupon: "X",
      items: [{ item_id: "AN-1", item_name: "Anel", price: 199.9, quantity: 1 }],
    }, { eventId: purchaseEventId(29) });
    expect(id).toBe("purchase_29");
    expect(pinQueue.at(-1)).toEqual([
      "track",
      "checkout",
      {
        event_id: "purchase_29",
        value: 219.9,
        currency: "BRL",
        line_items: [{ product_id: "AN-1", product_name: "Anel", product_quantity: 1, product_price: 199.9 }],
        order_quantity: 1,
        order_id: "29",
        promo_code: "X",
      },
    ]);
  });

  it("builds providers from the store config, skipping disabled modules and empty ids", () => {
    const config = storeConfig({
      modules: {
        consent: consentConfig({ consent_mode: { ...consentConfig().consent_mode, analytics_storage: "statistics", ad_storage: "ads" } }),
        ga4: { enabled: true, measurement_id: "G-1", google_ads_id: "", google_ads_labels: { purchase: "", begin_checkout: "", add_to_cart: "", generate_lead: "" }, server_side: true },
        meta_pixel: { enabled: true, pixel_id: "  ", conversions_api: false, relay_events: false },
        pinterest: { enabled: true, tag_id: "T", enhanced_match: true, conversions_api: false, relay_events: false },
      } as never,
    });
    const providers = providersFromConfig(config);
    expect(providers.map((provider) => `${provider.name}:${provider.category}`)).toEqual(["ga4:statistics", "pinterest:ads"]);
    expect(providersFromConfig(config, { ga4: false, pinterest: { category: "marketing" } }).map((provider) => provider.category)).toEqual(["marketing"]);
    expect(providersFromConfig(null)).toEqual([]);
  });
});

describe("trackPurchase", () => {
  function purchaseClient(order: Record<string, unknown> | null = null) {
    const mock = mockFetch((request) =>
      order
        ? json(order)
        : json({
            order_id: Number(new URL(request.url).pathname.split("/")[6]),
            transaction_id: "1029",
            event_id: "purchase_x",
            currency: "BRL",
            value: 219.9,
            tax: 0,
            shipping: 20,
            coupon: "",
            payment_method: "pix",
            items: [{ item_id: "AN-1", item_name: "Anel", item_variant: "", item_category: "Anéis", price: 199.9, discount: 0, quantity: 1 }],
          }),
    );
    return { ...mock, hp: createHeadpress({ baseUrl: BASE, fetch: mock.fetch }) };
  }

  it("tracks the server's purchase with purchase_<id>, once per order per browser, browser only", async () => {
    installBrowser();
    const { hp, calls } = purchaseClient();
    const track = vi.fn(() => "purchase_101");
    expect(await trackPurchase(hp, { track }, { orderId: 101, key: "wc_order_abc" })).toBe(true);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/wp-json/headpress/v1/store/orders/101/analytics");
    expect(url.searchParams.get("key")).toBe("wc_order_abc");
    expect(track).toHaveBeenCalledWith(
      "purchase",
      {
        transaction_id: "1029",
        currency: "BRL",
        value: 219.9,
        tax: 0,
        shipping: 20,
        items: [{ item_id: "AN-1", item_name: "Anel", price: 199.9, quantity: 1, item_category: "Anéis" }],
      },
      { eventId: "purchase_101", browserOnly: true },
    );

    expect(await trackPurchase(hp, { track }, { orderId: "101", key: "wc_order_abc" })).toBe(false);
    expect(calls).toHaveLength(1);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("guards concurrent calls and blocked storage, and resolves false when Headpress fails", async () => {
    installBrowser({ blockStorage: true });
    const { hp, calls } = purchaseClient();
    const track = vi.fn(() => "");
    const results = await Promise.all([
      trackPurchase(hp, { track }, { orderId: 102, key: "k" }),
      trackPurchase(hp, { track }, { orderId: 102, key: "k" }),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(track).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeLessThanOrEqual(2);

    const failing = mockFetch(() => wpError(404, "headpress_not_found"));
    const broken = createHeadpress({ baseUrl: BASE, fetch: failing.fetch });
    expect(await trackPurchase(broken, { track }, { orderId: 103, key: "k" })).toBe(false);
    expect(await trackPurchase(broken, { track }, { orderId: "abc", key: "k" })).toBe(false);
    vi.unstubAllGlobals();
    expect(await trackPurchase(hp, { track }, { orderId: 104, key: "k" })).toBe(false);
  });

  it("ends up in every provider with the same purchase id", async () => {
    const browser = installBrowser();
    const fbq = vi.fn();
    browser.win.fbq = fbq;
    const consent = createConsent({ config: consentConfig() });
    consent.acceptAll();
    const tracker = createTracker({ consent, providers: [metaPixelProvider({ pixelId: "1" })] });
    const { hp } = purchaseClient();
    expect(await trackPurchase(hp, tracker, { orderId: 105, key: "k" })).toBe(true);
    expect(fbq).toHaveBeenCalledWith("track", "Purchase", expect.objectContaining({ order_id: "1029", value: 219.9 }), { eventID: "purchase_105" });
  });
});

describe("browser ids", () => {
  it("parses GA cookies in both formats", () => {
    expect(parseGaClientId("GA1.1.1996991888.1789498255")).toBe("1996991888.1789498255");
    expect(parseGaClientId("junk")).toBeUndefined();
    expect(parseGaSessionId("GS1.1.1789498253.1.0.1789498253.0.0.0")).toBe("1789498253");
    expect(parseGaSessionId("GS2.1.s1789498253$o1$g0$t1789498253")).toBe("1789498253");
    expect(parseGaSessionId("")).toBeUndefined();
  });

  it("reads ids by consent category and builds fbc from the landing fbclid", () => {
    const browser = installBrowser({ url: "https://shop.test/?fbclid=AbCdEfGh123&epik=dj0yJnU9abcdef" });
    browser.cookies.set("_ga", "GA1.1.111.222");
    browser.cookies.set("_ga_ABC", "GS2.1.s1790000000$o1");
    browser.cookies.set("_fbp", "fb.1.1790000000000.987654321");

    expect(browserIds(UNDECIDED)).toEqual({});
    expect(browserIds(decided(["necessary", "analytics"]), { measurementId: "G-ABC" })).toEqual({ ga_client_id: "111.222", ga_session_id: "1790000000" });

    browser.navigate("https://shop.test/checkout");
    const ids = browserIds(decided(["necessary", "marketing"]));
    expect(ids.ga_client_id).toBeUndefined();
    expect(ids.fbp).toBe("fb.1.1790000000000.987654321");
    expect(ids.fbc).toMatch(/^fb\.1\.\d{13}\.AbCdEfGh123$/);
    expect(ids.epik).toBe("dj0yJnU9abcdef");
    expect(browser.cookies.get("hp_epik")).toBe(encodeURIComponent("dj0yJnU9abcdef"));
    // A pixel-written _fbc wins over the built one.
    browser.cookies.set("_fbc", "fb.1.1790000000001.FromPixel123");
    expect(browserIds(decided(["necessary", "marketing"])).fbc).toBe("fb.1.1790000000001.FromPixel123");
  });
});

describe("attribution", () => {
  it("captures the landing visit, counts pages and starts a new session after the timeout", () => {
    installBrowser({ url: "https://shop.test/produto/anel?utm_source=newsletter&utm_medium=email&gclid=G1&recover=tok.en.x", referrer: "" });
    let now = Date.parse("2026-10-01T12:00:00Z");
    const attribution = createAttribution({ sessionMinutes: 30, now: () => now });
    const first = attribution.capture()!;
    expect(first).toMatchObject({
      source_type: "utm",
      utm_source: "newsletter",
      utm_medium: "email",
      session_entry: "https://shop.test/produto/anel?utm_source=newsletter&utm_medium=email&gclid=G1",
      session_start_time: "2026-10-01T12:00:00.000Z",
      session_pages: 1,
      session_count: 1,
      user_agent: "TestAgent/1.0",
    });
    now += 10 * 60_000;
    expect(attribution.capture("https://shop.test/loja")?.session_pages).toBe(2);
    now += 31 * 60_000;
    const next = attribution.capture("https://shop.test/sobre", "https://www.google.com/search?q=anel")!;
    expect(next).toMatchObject({ source_type: "organic", session_pages: 1, session_count: 2, utm_source: "" });
    expect(attribution.capture("https://shop.test/x", "https://blog.example.org/post")?.session_count).toBe(2);
    // A new campaign click starts a session even within the timeout.
    expect(attribution.capture("https://shop.test/?utm_source=ig")).toMatchObject({ session_count: 3, utm_source: "ig" });
  });

  it("maps to Headpress' reserved keys and honours the order_attribution consent rules", () => {
    installBrowser();
    const attribution = createAttribution({ now: () => Date.parse("2026-10-01T12:30:00Z") });
    attribution.capture("https://shop.test/produto/camiseta?utm_source=newsletter&gclid=G1&fbclid=F1", "");
    const ids = { ga_client_id: "123456.7890", ga_session_id: "1790000000", fbp: "fb.1.1.2", epik: "dj0y" };
    expect(checkoutAttribution(attribution, ids)).toEqual({
      source_type: "utm",
      referrer: null,
      utm_source: "newsletter",
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      utm_id: null,
      utm_source_platform: null,
      utm_creative_format: null,
      utm_marketing_tactic: null,
      session_entry: "https://shop.test/produto/camiseta?utm_source=newsletter&gclid=G1&fbclid=F1",
      session_start_time: "2026-10-01T12:30:00.000Z",
      session_pages: "1",
      session_count: "1",
      gclid: "G1",
      fbclid: "F1",
      landing_path: "/produto/camiseta",
      user_agent: "TestAgent/1.0",
      ga_client_id: "123456.7890",
      ga_session_id: "1790000000",
      fbp: "fb.1.1.2",
      fbc: null,
      epik: "dj0y",
    });

    const rules = { order_attribution: { enabled: true, require_consent: true, consent_category: "marketing" } };
    expect(checkoutAttribution(attribution, ids, { woocommerce: rules, consent: UNDECIDED })).toBeNull();
    expect(checkoutAttribution(attribution, ids, { woocommerce: rules })).toBeNull();
    expect(checkoutAttribution(attribution, ids, { woocommerce: rules, consent: decided(["necessary", "analytics"]) })).toBeNull();
    expect(checkoutAttribution(attribution, ids, { woocommerce: rules, consent: decided(["necessary", "marketing"]) })).not.toBeNull();
    const loose = { order_attribution: { require_consent: false } };
    expect(checkoutAttribution(attribution, ids, { woocommerce: loose, consent: UNDECIDED })).not.toBeNull();
    expect(checkoutAttribution(attribution, ids, { woocommerce: loose, consent: decided(["necessary"]) })).toBeNull();
    expect(checkoutAttribution(null, {})).toMatchObject({ source_type: null, session_count: null, landing_path: null });
  });
});

describe("abandoned cart", () => {
  function abandonedClient(abandoned: boolean, token: string | null = "cart-token-1") {
    const mock = mockFetch(() => json({ captured: true }, { status: 202 }));
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch: mock.fetch,
      cartToken: memoryCartToken(token),
      config: { initial: storeConfig({ modules: { woocommerce: { enabled: true, order_attribution: {}, abandoned_cart: abandoned } } as never }) },
    });
    return { ...mock, hp };
  }

  it("posts the contact and the explicit consent with the Cart-Token", async () => {
    const { hp, calls } = abandonedClient(true);
    expect(await captureAbandonedCart(hp, { email: " ana@example.com ", phone: "", first_name: "Ana", consent: { marketing: false } })).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/wp-json/headpress/v1/store/cart/abandonment");
    expect(calls[0]?.headers.get("Cart-Token")).toBe("cart-token-1");
    expect(await calls[0]?.json()).toEqual({ email: "ana@example.com", first_name: "Ana", consent: { marketing: false } });
  });

  it("skips without calling Headpress when off, without a token, a contact or a consent value", async () => {
    const off = abandonedClient(false);
    expect(await captureAbandonedCart(off.hp, { email: "a@b.co", consent: { marketing: true } })).toBe(false);
    const tokenless = abandonedClient(true, null);
    expect(await captureAbandonedCart(tokenless.hp, { email: "a@b.co", consent: { marketing: true } })).toBe(false);
    const on = abandonedClient(true);
    expect(await captureAbandonedCart(on.hp, { first_name: "Ana", consent: { marketing: true } })).toBe(false);
    expect(await captureAbandonedCart(on.hp, { email: "a@b.co" } as never)).toBe(false);
    expect([...off.calls, ...tokenless.calls, ...on.calls]).toHaveLength(0);

    const failing = mockFetch(() => wpError(400, "headpress_invalid_param"));
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch: failing.fetch,
      cartToken: memoryCartToken("t"),
      config: { initial: storeConfig({ modules: { woocommerce: { enabled: true, abandoned_cart: true } } as never }) },
    });
    expect(await captureAbandonedCart(hp, { phone: "+5541999999999", consent: { marketing: true } })).toBe(false);
  });
});

describe("cart recovery", () => {
  it("stores the token and returns the URL without it", () => {
    const cartToken = memoryCartToken("old");
    expect(consumeRecoveryToken("https://shop.test/cart?recover=eyJ0.eyJ1.sig&utm_source=wa#top", cartToken)).toBe(
      "https://shop.test/cart?utm_source=wa#top",
    );
    expect(cartToken.get()).toBe("eyJ0.eyJ1.sig");
    expect(consumeRecoveryToken(new URL("https://shop.test/cart"), cartToken)).toBeNull();
    expect(consumeRecoveryToken("/cart?r=abc", cartToken, "r")).toBe("/cart");
    expect(cartToken.get()).toBe("abc");
    // A malformed token is removed from the URL but not stored.
    expect(consumeRecoveryToken("/cart?recover=<script>", cartToken)).toBe("/cart");
    expect(cartToken.get()).toBe("abc");
    expect(withoutParam("https://shop.test/?recover=x&a=1")).toBe("https://shop.test/?a=1");
  });
});
