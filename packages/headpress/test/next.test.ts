import { describe, expect, it, vi } from "vitest";

const { revalidateTag, revalidatePath } = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache.js", () => ({ revalidateTag, revalidatePath }));
vi.mock("next/headers.js", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createHeadpress, memorySession, type SeoHead } from "../src/index.js";
import { jsonLdScripts, nextCache, redirectResponse, seoMetadata, toNextMetadata, xmlResponse } from "../src/next/index.js";
import { createRevalidateRoute } from "../src/next/server.js";
import { signWebhook } from "../src/webhooks/index.js";
import { BASE, json, mockFetch, storeConfig } from "./helpers.js";

describe("nextCache", () => {
  it("tags public reads and leaves personal ones uncached", async () => {
    const inits: RequestInit[] = [];
    const { fetch } = mockFetch(() => json(storeConfig()));
    const spyFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init ?? {});
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const session = memorySession();
    session.setTokens({ accessToken: "jwt", expiresIn: 900 });
    const hp = createHeadpress({ baseUrl: BASE, fetch: spyFetch, session, plugins: [nextCache({ revalidate: 120 })] });

    await hp.config.get();
    await hp.request("/store/customers/me", { auth: "required", cacheTags: ["x"] });
    await hp.request("/store/consent", { body: {}, cacheTags: ["x"] });
    await hp.request("/store/search/popular", { cacheTags: ["search:popular"], revalidate: false });

    expect((inits[0] as { next?: unknown }).next).toEqual({ tags: ["headpress:config"], revalidate: 120 });
    expect(inits[1]?.cache).toBe("no-store");
    expect(inits[2]?.cache).toBe("no-store");
    expect((inits[3] as { next?: unknown }).next).toEqual({ tags: ["search:popular"], revalidate: false });
  });
});

describe("createRevalidateRoute", () => {
  it("expires tags and paths and drops the config and redirect caches", async () => {
    const invalidateConfig = vi.fn();
    const invalidateRedirects = vi.fn();
    const { POST } = createRevalidateRoute({
      secret: "s",
      config: { invalidate: invalidateConfig },
      redirects: { invalidate: invalidateRedirects },
    });
    const body = JSON.stringify({ id: "evt_9", event: "batch", events: [], tags: ["headpress:config", "seo:redirects"], paths: ["/loja?x=1"] });
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await POST(
      new Request("https://shop.test/api/revalidate", {
        method: "POST",
        body,
        headers: { "X-Headpress-Timestamp": String(timestamp), "X-Headpress-Signature": await signWebhook("s", timestamp, body), "X-Headpress-Delivery": "evt_9" },
      }),
    );
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("headpress:config", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("seo:head", { expire: 0 });
    expect(revalidatePath).toHaveBeenCalledWith("/loja");
    expect(invalidateConfig).toHaveBeenCalled();
    expect(invalidateRedirects).toHaveBeenCalled();
  });

  it("refuses deliveries when the secret is not configured", async () => {
    const { POST } = createRevalidateRoute({ secret: undefined });
    expect((await POST(new Request("https://shop.test", { method: "POST", body: "{}" }))).status).toBe(500);
  });
});

const head: SeoHead = {
  title: "Anel C152 &#8211; Camila",
  description: "",
  canonical: "https://shop.test/produto/anel",
  robots: { index: true, follow: true, max_snippet: -1, max_image_preview: "large", max_video_preview: -1 },
  open_graph: {
    type: "product",
    title: "OG &amp; title",
    description: "",
    url: "https://shop.test/produto/anel",
    site_name: "Camila",
    locale: "pt_BR",
    images: [{ url: "https://wp.test/a.jpg", width: 1200, height: 1200, type: "image/jpeg", alt: "" }],
    published_time: "",
    modified_time: "",
  },
  twitter: { card: "summary_large_image", title: "", description: "", image: "", site: "", creator: "" },
  json_ld: [{ "@context": "https://schema.org", name: "</script><script>alert(1)</script>" }],
  alternates: [],
  breadcrumbs: [],
};

describe("metadata", () => {
  it("maps the head over a fallback, keeping fallback fields the head leaves empty", () => {
    const metadata = toNextMetadata(head, { description: "Fallback description" }, {
      transformTitle: (title) => title.replace(/\s*–\s*Camila$/, ""),
    });
    expect(metadata.title).toBe("Anel C152");
    expect(metadata.description).toBe("Fallback description");
    expect(metadata.alternates).toEqual({ canonical: "https://shop.test/produto/anel" });
    expect(metadata.robots).toEqual({ index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 });
    expect(metadata.openGraph).toMatchObject({ title: "OG & title", images: [{ url: "https://wp.test/a.jpg", width: 1200 }] });
    expect(metadata.twitter).toBeUndefined();
  });

  it("falls back when Headpress fails", async () => {
    const hp = { seo: { head: vi.fn(async () => Promise.reject(new Error("down"))) } };
    expect(await seoMetadata(hp, { path: "/" }, { title: "Loja" })).toEqual({ title: "Loja" });
  });

  it("escapes JSON-LD for inline scripts", () => {
    const [script] = jsonLdScripts(head);
    expect(script).not.toContain("</script>");
    expect(JSON.parse(script as string).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("responses", () => {
  it("builds redirect, gone and XML responses", async () => {
    const redirect = redirectResponse({ destination: "/novo?x=1", status: 308 }, "https://shop.test/velho");
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("Location")).toBe("https://shop.test/novo?x=1");
    expect(redirectResponse({ destination: null, status: 410 }, "https://shop.test/x").status).toBe(410);
    const xml = xmlResponse("<urlset/>", { maxAge: 60 });
    expect(xml.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(await xml.text()).toBe("<urlset/>");
  });
});
