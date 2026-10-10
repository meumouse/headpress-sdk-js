import { describe, expect, it, vi } from "vitest";

import {
  createHeadpress,
  createRedirectResolver,
  decodeHtmlEntities,
  definePlugin,
  normalizeRedirectRules,
  renderSitemap,
  renderSitemapIndex,
  resolveRedirect,
  sitemapIndexEntries,
  type RedirectRule,
} from "../src/index.js";
import { BASE, json, mockFetch, wpError } from "./helpers.js";

const rule = (overrides: Partial<RedirectRule>): RedirectRule => ({
  id: 1,
  comparison: "exact",
  pattern: "old",
  ignoreCase: false,
  destination: "/new",
  status: 301,
  ...overrides,
});

describe("seo resource", () => {
  it("asks for a head by path with path and seo tags, and answers null on 404", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.includes("missing") ? wpError(404, "headpress_not_found") : json({ target: {}, cache_tags: [], head: { title: "T" } }),
    );
    const seen: (readonly string[] | undefined)[] = [];
    const hp = createHeadpress({
      baseUrl: BASE,
      fetch,
      plugins: [definePlugin({ name: "spy", onRequest: ({ options }) => void seen.push(options.cacheTags) })],
    });

    const response = await hp.seo.head({ path: "/produto/anel/?x=1" });
    expect(response?.head.title).toBe("T");
    expect(calls[0]?.url).toBe(`${BASE}/wp-json/headpress/v1/store/seo/head?path=%2Fproduto%2Fanel`);
    expect(seen[0]).toEqual(["seo:head", "path:/produto/anel"]);

    await hp.seo.head({ type: "post", id: 12, postType: "product" });
    expect(calls[1]?.url).toContain("type=post&id=12");
    expect(seen[1]).toEqual(["seo:head", "product:12"]);

    await expect(hp.seo.head({ path: "/missing" })).resolves.toBeNull();
  });

  it("returns null for a sitemap type that has none", async () => {
    const { fetch } = mockFetch(() => wpError(404, "headpress_not_found"));
    const hp = createHeadpress({ baseUrl: BASE, fetch });
    await expect(hp.seo.sitemap("portfolio")).resolves.toBeNull();
  });
});

describe("redirect rules", () => {
  it("normalizes current and 1.0 rows and drops malformed ones", () => {
    expect(
      normalizeRedirectRules([
        { source: "Promo", destination: "/sale", status: 302, match: "regex", id: 12, comparison: "contains", pattern: "Promo", ignore_case: true },
        { source: "/old-shirt/", destination: "/shirt", status: 301, match: "exact" },
        { source: "/blog/", destination: "/news", status: 301, match: "prefix" },
        { source: "", destination: "/x", status: 301, match: "exact" },
        "garbage",
      ]),
    ).toEqual([
      { id: 12, comparison: "contains", pattern: "Promo", ignoreCase: true, destination: "/sale", status: 302 },
      { id: null, comparison: "exact", pattern: "old-shirt", ignoreCase: false, destination: "/shirt", status: 301 },
      { id: null, comparison: "start", pattern: "/blog", ignoreCase: false, destination: "/news", status: 301 },
    ]);
  });

  it("matches with Rank Math semantics", () => {
    expect(resolveRedirect([rule({})], "/old/")).toEqual({ destination: "/new", status: 301 });
    expect(resolveRedirect([rule({})], "/OLD")).toBeNull();
    expect(resolveRedirect([rule({ ignoreCase: true })], "/OLD")).toEqual({ destination: "/new", status: 301 });
    expect(resolveRedirect([rule({ comparison: "contains", pattern: "promo" })], "/super-promo-x")?.destination).toBe("/new");
    expect(resolveRedirect([rule({ comparison: "start", pattern: "categoria" })], "/categoria/aneis")?.destination).toBe("/new");
    expect(resolveRedirect([rule({ comparison: "end", pattern: ".html" })], "/page.html")?.destination).toBe("/new");
    expect(
      resolveRedirect([rule({ comparison: "regex", pattern: "^produto-antigo/(.+)$", destination: "/produto/$1" })], "/produto-antigo/anel"),
    ).toEqual({ destination: "/produto/anel", status: 301 });
  });

  it("keeps the first match, carries the query, maps own hosts and handles 410", () => {
    const rules = [rule({ destination: "https://wp.test/novo/" }), rule({ destination: "/second" })];
    expect(resolveRedirect(rules, "/old", "?utm=x", { sameHosts: ["https://wp.test"] })).toEqual({
      destination: "/novo/?utm=x",
      status: 301,
    });
    expect(resolveRedirect([rule({ destination: "https://other.example/x" })], "/old")?.destination).toBe("https://other.example/x");
    expect(resolveRedirect([rule({ status: 410, destination: "" })], "/old")).toEqual({ destination: null, status: 410 });
    expect(resolveRedirect([rule({ status: 999 })], "/old")?.status).toBe(301);
    expect(resolveRedirect([rule({ destination: "/old" })], "/old")).toBeNull();
    // Invalid JavaScript regex: skipped, not fatal.
    expect(resolveRedirect([rule({ comparison: "regex", pattern: "(?<x" }), rule({})], "/old")?.destination).toBe("/new");
  });

  it("caches rules, falls back to the last set on failure and refetches after invalidate()", async () => {
    let fail = false;
    const redirects = vi.fn(async () => {
      if (fail) throw new Error("down");
      return [rule({})];
    });
    const resolver = createRedirectResolver({ redirects }, { key: "test-resolver" });
    expect(await resolver.resolve("http://shop.test/old")).toEqual({ destination: "/new", status: 301 });
    await resolver.resolve(new URL("http://shop.test/other"));
    expect(redirects).toHaveBeenCalledTimes(1);

    fail = true;
    resolver.invalidate();
    expect(await resolver.resolve("/old")).toEqual({ destination: "/new", status: 301 });
    expect(redirects).toHaveBeenCalledTimes(2);

    // A second resolver with the same key shares the cache (middleware and route handler bundles).
    const twin = createRedirectResolver({ redirects }, { key: "test-resolver" });
    twin.invalidate();
    fail = false;
    await resolver.resolve("/old");
    expect(redirects).toHaveBeenCalledTimes(3);
  });
});

describe("sitemap XML", () => {
  it("renders an index and a urlset with images, escaping and dates", () => {
    const index = sitemapIndexEntries(
      { per_page: 1000, types: [{ type: "product", kind: "post_type", count: 1500, pages: 2, lastmod: "2026-09-28T04:33:06+00:00" }] },
      (type, page) => `https://shop.test/${type}-sitemap${page > 1 ? page : ""}.xml`,
    );
    expect(index.map((entry) => entry.loc)).toEqual(["https://shop.test/product-sitemap.xml", "https://shop.test/product-sitemap2.xml"]);
    const xml = renderSitemapIndex(index, { stylesheet: "/main-sitemap.xsl" });
    expect(xml).toContain('<?xml-stylesheet type="text/xsl" href="/main-sitemap.xsl"?>');
    expect(xml).toContain("<lastmod>2026-09-28T04:33:06.000Z</lastmod>");

    const urlset = renderSitemap([{ loc: "https://shop.test/p?a=1&b=2", lastmod: null, image: "https://wp.test/i.jpg" }]);
    expect(urlset).toContain("<loc>https://shop.test/p?a=1&amp;b=2</loc>");
    expect(urlset).toContain("<image:loc>https://wp.test/i.jpg</image:loc>");
    expect(urlset).not.toContain("<lastmod>");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities and leaves unknown ones", () => {
    expect(decodeHtmlEntities("Anéis &amp; Alianças &#8211; Joias &#x2014; &rsquo;x&rsquo; &bogus;")).toBe(
      "Anéis & Alianças – Joias — ’x’ &bogus;",
    );
    expect(decodeHtmlEntities("Solit&aacute;rio &Aacute; &ccedil;&atilde;o &nbsp;&copy; &AMP;")).toBe("Solitário Á ção  © &");
  });
});
