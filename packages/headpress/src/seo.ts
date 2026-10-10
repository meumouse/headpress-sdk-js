/**
 * SEO from Headpress (`seo` module): normalized heads, redirect rules and sitemaps, with every page
 * URL already pointing at the storefront.
 *
 * - `hp.seo.head(target)` — title, description, canonical, robots, Open Graph, Twitter, JSON-LD,
 *   alternates and breadcrumbs for one storefront page. Null when nothing published is there.
 * - `hp.seo.redirects()` + `resolveRedirect()` — the SEO plugin's redirect rules and Rank Math's
 *   own matching, for the storefront's middleware.
 * - `hp.seo.sitemapIndex()` / `hp.seo.sitemap(type, page)` + `renderSitemapIndex()` /
 *   `renderSitemap()` — sitemap data and the XML documents search engines expect.
 */
import { isHeadpressError } from "./errors.js";
import type { RequestOptions, Transport } from "./transport.js";

/** Which page to describe. */
export type SeoTarget =
  | { path: string }
  | { type: "post"; id: number; /** Post type, for the cache tag (`product:12`). */ postType?: string }
  | { type: "term"; taxonomy: string; id: number }
  | { type: "home" | "blog" };

export interface SeoImage {
  url: string;
  width: number | null;
  height: number | null;
  type: string;
  alt: string;
}

export interface SeoHead {
  title: string;
  description: string;
  canonical: string;
  robots: {
    index: boolean;
    follow: boolean;
    max_snippet: number | null;
    max_image_preview: string | null;
    max_video_preview: number | null;
  };
  open_graph: {
    type: string;
    title: string;
    description: string;
    url: string;
    site_name: string;
    locale: string;
    images: SeoImage[];
    published_time: string;
    modified_time: string;
  };
  twitter: {
    card: string;
    title: string;
    description: string;
    image: string;
    site: string;
    creator: string;
  };
  json_ld: Record<string, unknown>[];
  alternates: { hreflang: string; href: string }[];
  breadcrumbs: { name: string; url: string }[];
}

export interface SeoHeadResponse {
  target: { kind: string; id: number | null; type: string | null; taxonomy?: string | null; url: string };
  /** Tags Headpress revalidates when this page changes. */
  cache_tags: string[];
  head: SeoHead;
}

export type RedirectComparison = "exact" | "contains" | "start" | "end" | "regex";

/** One redirect rule, normalized from what Headpress lists. */
export interface RedirectRule {
  id: number | null;
  comparison: RedirectComparison;
  pattern: string;
  ignoreCase: boolean;
  destination: string;
  status: number;
}

export interface SitemapIndex {
  per_page: number;
  types: { type: string; kind: string; count: number; pages: number; lastmod: string | null }[];
}

export interface SitemapPage {
  type: string;
  kind: string;
  page: number;
  pages: number;
  entries: { loc: string; lastmod: string | null; image?: string | null }[];
}

export interface SeoRequestOptions {
  signal?: AbortSignal;
  /** Seconds a framework cache may keep the answer. */
  revalidate?: number | false;
  /** More cache tags for this read (e.g. the storefront path of the blog page). */
  cacheTags?: readonly string[];
}

export interface Seo {
  /** The head of one page, or null when nothing published matches (404). */
  head(target: SeoTarget, options?: SeoRequestOptions): Promise<SeoHeadResponse | null>;
  /** Active redirect rules, in the order they must be tried (first match wins). */
  redirects(options?: SeoRequestOptions & Pick<RequestOptions, "timeoutMs" | "fetchOptions">): Promise<RedirectRule[]>;
  sitemapIndex(options?: SeoRequestOptions): Promise<SitemapIndex>;
  /** One page of one sitemap, or null when the type has no sitemap (route turned off). */
  sitemap(type: string, page?: number, options?: SeoRequestOptions): Promise<SitemapPage | null>;
}

/** Storefront path normalized for cache tags: leading slash, no trailing slash, no query. */
export function normalizeSeoPath(path: string): string {
  let pathname = path;
  try {
    pathname = new URL(path, "http://x").pathname;
  } catch {
    pathname = path.split(/[?#]/)[0] ?? "";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed || "/" : `/${trimmed}`;
}

/** The cache tag of one storefront path; the revalidation webhook expires it from `paths`. */
export function pathTag(path: string): string {
  return `path:${normalizeSeoPath(path)}`;
}

function headQuery(target: SeoTarget): { query: Record<string, string | number>; tags: string[] } {
  if ("path" in target) {
    return { query: { path: normalizeSeoPath(target.path) }, tags: ["seo:head", pathTag(target.path)] };
  }
  if (target.type === "post") {
    return {
      query: { type: "post", id: target.id },
      tags: ["seo:head", ...(target.postType ? [`${target.postType}:${target.id}`] : [])],
    };
  }
  if (target.type === "term") {
    return {
      query: { type: "term", taxonomy: target.taxonomy, id: target.id },
      tags: ["seo:head", `term:${target.taxonomy}:${target.id}`],
    };
  }
  // The home page always lives at `/`; the blog's path depends on the route map, so callers add it.
  return { query: { type: target.type }, tags: ["seo:head", `seo:head:${target.type}`, ...(target.type === "home" ? ["path:/"] : [])] };
}

const COMPARISONS = new Set<RedirectComparison>(["exact", "contains", "start", "end", "regex"]);

/**
 * Normalize Headpress's redirect list. Uses `comparison`/`pattern`/`ignore_case` (Headpress 1.1+)
 * and falls back to the 1.0 fields (`source`/`match`). Malformed rows are dropped, never fatal.
 */
export function normalizeRedirectRules(data: unknown): RedirectRule[] {
  if (!Array.isArray(data)) return [];
  const rules: RedirectRule[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const destination = typeof record.destination === "string" ? record.destination : "";
    const status = Number(record.status);
    const id = typeof record.id === "number" ? record.id : null;

    let comparison: RedirectComparison | null = null;
    let pattern = "";
    if (typeof record.comparison === "string" && COMPARISONS.has(record.comparison as RedirectComparison)) {
      comparison = record.comparison as RedirectComparison;
      pattern = typeof record.pattern === "string" ? record.pattern : "";
    } else if (typeof record.source === "string") {
      const legacy = record.match;
      comparison = legacy === "exact" ? "exact" : legacy === "prefix" ? "start" : legacy === "regex" ? "regex" : null;
      pattern =
        comparison === "exact"
          ? record.source.replace(/^\/+|\/+$/g, "")
          : comparison === "start"
            ? record.source.replace(/\/+$/, "")
            : record.source;
    }
    if (!comparison || pattern.trim() === "") continue;

    rules.push({
      id,
      comparison,
      pattern,
      ignoreCase: record.ignore_case === true,
      destination,
      status: Number.isFinite(status) ? status : 301,
    });
  }
  return rules;
}

export interface RedirectResolution {
  /** Location to send, or null for 410/451 (no target). */
  destination: string | null;
  status: number;
}

export interface ResolveRedirectOptions {
  /**
   * Hosts whose absolute destinations become storefront-relative paths, so visitors stay on the
   * storefront (the WordPress host and the storefront host).
   */
  sameHosts?: readonly string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NO_TARGET_STATUSES = new Set([410, 451]);

const regexCache = new Map<string, RegExp | null>();

function compileRegex(pattern: string, ignoreCase: boolean): RegExp | null {
  const key = `${ignoreCase ? "i" : ""}:${pattern}`;
  const cached = regexCache.get(key);
  if (cached !== undefined) return cached;
  let regex: RegExp | null;
  try {
    regex = new RegExp(pattern, ignoreCase ? "i" : "");
  } catch {
    // PCRE syntax JavaScript cannot compile: the rule is skipped rather than breaking the set.
    regex = null;
  }
  regexCache.set(key, regex);
  return regex;
}

function ruleMatches(rule: RedirectRule, uri: string): boolean {
  if (rule.comparison === "regex") return compileRegex(rule.pattern, rule.ignoreCase)?.test(uri) ?? false;
  const subject = rule.ignoreCase ? uri.toLowerCase() : uri;
  const pattern = rule.ignoreCase ? rule.pattern.toLowerCase() : rule.pattern;
  switch (rule.comparison) {
    case "exact":
      return subject === pattern.replace(/^\/+|\/+$/g, "");
    case "contains":
      return subject.includes(pattern);
    case "start":
      return subject.startsWith(pattern);
    case "end":
      return subject.endsWith(pattern);
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  }
}

function normalizeDestination(raw: string, sameHosts: readonly string[]): string {
  const destination = raw.trim();
  if (destination === "") return "/";
  if (/^https?:\/\//i.test(destination)) {
    try {
      const target = new URL(destination);
      if (sameHosts.map(hostOf).includes(target.host)) {
        return `${target.pathname}${target.search}${target.hash}` || "/";
      }
    } catch {
      // Not a parseable URL: send it as written.
    }
    return destination;
  }
  return `/${destination.replace(/^\/+/, "")}`;
}

/**
 * Resolve a request against the redirect rules with Rank Math's semantics: the path is compared
 * without leading and trailing slashes; `exact` = equal, `contains` = substring, `start` = prefix,
 * `end` = suffix, `regex` = unanchored match (with `$1` back-references in the destination); all
 * case-sensitive unless `ignoreCase`. The first matching rule wins; the incoming query string is
 * carried over; a rule pointing at the same URL is ignored.
 *
 * @param search The raw query string with its `?`, or "".
 */
export function resolveRedirect(
  rules: readonly RedirectRule[],
  pathname: string,
  search = "",
  options: ResolveRedirectOptions = {},
): RedirectResolution | null {
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // Keep the raw path.
  }
  const uri = decoded.replace(/^\/+|\/+$/g, "");

  for (const rule of rules) {
    if (!ruleMatches(rule, uri)) continue;
    const status = REDIRECT_STATUSES.has(rule.status) || NO_TARGET_STATUSES.has(rule.status) ? rule.status : 301;
    if (NO_TARGET_STATUSES.has(status)) return { destination: null, status };

    let target = rule.destination;
    if (rule.comparison === "regex") {
      const regex = compileRegex(rule.pattern, rule.ignoreCase);
      if (regex) target = uri.replace(regex, rule.destination);
    }
    let destination = normalizeDestination(target, options.sameHosts ?? []);
    const query = search.replace(/^\?/, "");
    if (query) destination += `${destination.includes("?") ? "&" : "?"}${query}`;

    if (destination === `${pathname}${search}` || destination === pathname) return null;
    return { destination, status };
  }
  return null;
}

export interface RedirectResolverOptions extends ResolveRedirectOptions {
  /** Milliseconds a fetched rule set is trusted. Defaults to 60 000. */
  ttlMs?: number;
  /** Milliseconds before giving up on Headpress; middleware runs on every page view. Defaults to 1 500. */
  timeoutMs?: number;
  /**
   * Name of the shared rule cache. Middleware and route handlers are separate bundles in some
   * frameworks; the cache lives on `globalThis` under this name so `invalidate()` from the
   * revalidation route reaches the middleware's copy.
   */
  key?: string;
}

export interface RedirectResolver {
  /** The redirect for a URL, or null. Never throws: without rules, nothing redirects. */
  resolve(url: URL | string): Promise<RedirectResolution | null>;
  /** Refetch the rules on the next request (keeps the current set as the fallback). */
  invalidate(): void;
}

interface RedirectState {
  rules: RedirectRule[] | null;
  at: number;
  inflight: Promise<RedirectRule[]> | null;
}

/** Redirect rules with a short in-process cache, for middleware that runs on every request. */
export function createRedirectResolver(seo: Pick<Seo, "redirects">, options: RedirectResolverOptions = {}): RedirectResolver {
  const ttl = options.ttlMs ?? 60_000;
  const registry = globalThis as unknown as Record<symbol, RedirectState | undefined>;
  const slot = Symbol.for(`@meumouse/headpress/redirects:${options.key ?? "default"}`);
  const state: RedirectState = (registry[slot] ??= { rules: null, at: 0, inflight: null });

  const load = async (): Promise<RedirectRule[]> => {
    if (state.rules && Date.now() - state.at < ttl) return state.rules;
    state.inflight ??= seo
      .redirects({ timeoutMs: options.timeoutMs ?? 1_500, fetchOptions: { cache: "no-store" } })
      .then((rules) => {
        state.rules = rules;
        state.at = Date.now();
        return rules;
      })
      // Timeout, network error, SEO module off: keep the last set rather than drop every redirect.
      .catch(() => state.rules ?? [])
      .finally(() => {
        state.inflight = null;
      });
    return state.inflight;
  };

  return {
    async resolve(url) {
      const parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;
      const rules = await load();
      return rules.length ? resolveRedirect(rules, parsed.pathname, parsed.search, options) : null;
    },
    invalidate() {
      state.at = 0;
    },
  };
}

export function createSeo(transport: Transport): Seo {
  return {
    async head(target, options = {}) {
      const { query, tags } = headQuery(target);
      try {
        return await transport.request<SeoHeadResponse>("/store/seo/head", {
          query,
          module: "seo",
          cacheTags: [...tags, ...(options.cacheTags ?? [])],
          revalidate: options.revalidate,
          signal: options.signal,
        });
      } catch (error) {
        if (isHeadpressError(error, "headpress_not_found")) return null;
        throw error;
      }
    },
    async redirects(options = {}) {
      const data = await transport.request<unknown>("/store/seo/redirects", {
        module: "seo",
        cacheTags: ["seo:redirects"],
        revalidate: options.revalidate,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        fetchOptions: options.fetchOptions,
      });
      return normalizeRedirectRules(data);
    },
    sitemapIndex(options = {}) {
      return transport.request<SitemapIndex>("/store/seo/sitemap", {
        module: "seo",
        cacheTags: ["seo:sitemap"],
        revalidate: options.revalidate,
        signal: options.signal,
      });
    },
    async sitemap(type, page = 1, options = {}) {
      try {
        return await transport.request<SitemapPage>(`/store/seo/sitemap/${encodeURIComponent(type)}`, {
          query: { page },
          module: "seo",
          cacheTags: ["seo:sitemap", `seo:sitemap:${type}`],
          revalidate: options.revalidate,
          signal: options.signal,
        });
      } catch (error) {
        if (isHeadpressError(error, ["headpress_not_found", "rest_no_route"])) return null;
        throw error;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sitemap XML                                                         */
/* ------------------------------------------------------------------ */

export interface SitemapXmlOptions {
  /** URL of an XSL stylesheet, for a human-readable sitemap in browsers. */
  stylesheet?: string;
}

export interface SitemapIndexXmlEntry {
  loc: string;
  lastmod?: string | null;
}

export interface SitemapXmlEntry {
  loc: string;
  lastmod?: string | null;
  images?: readonly string[];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lastmod(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function prolog(options: SitemapXmlOptions): string {
  const stylesheet = options.stylesheet
    ? `<?xml-stylesheet type="text/xsl" href="${xmlEscape(options.stylesheet)}"?>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>${stylesheet}\n`;
}

/**
 * Entries of a sitemap index from Headpress's sitemap list: one per type and page.
 *
 * @param fileUrl Absolute URL of a sub-sitemap on the storefront, e.g.
 *                `(type, page) => \`https://shop.com/${type}-sitemap${page > 1 ? page : ""}.xml\``.
 */
export function sitemapIndexEntries(
  index: SitemapIndex,
  fileUrl: (type: string, page: number) => string,
): SitemapIndexXmlEntry[] {
  return index.types.flatMap((entry) =>
    Array.from({ length: Math.max(1, entry.pages) }, (_, i) => ({ loc: fileUrl(entry.type, i + 1), lastmod: entry.lastmod })),
  );
}

/** A `<sitemapindex>` document. */
export function renderSitemapIndex(entries: readonly SitemapIndexXmlEntry[], options: SitemapXmlOptions = {}): string {
  const items = entries
    .map((entry) => {
      const date = lastmod(entry.lastmod);
      return `\t<sitemap>\n\t\t<loc>${xmlEscape(entry.loc)}</loc>\n${date ? `\t\t<lastmod>${date}</lastmod>\n` : ""}\t</sitemap>\n`;
    })
    .join("");
  return `${prolog(options)}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}</sitemapindex>`;
}

/** A `<urlset>` document with image entries. Accepts Headpress sitemap entries as they come. */
export function renderSitemap(
  entries: readonly (SitemapXmlEntry | SitemapPage["entries"][number])[],
  options: SitemapXmlOptions = {},
): string {
  const items = entries
    .map((entry) => {
      const date = lastmod(entry.lastmod);
      const images = "images" in entry && entry.images ? entry.images : "image" in entry && entry.image ? [entry.image] : [];
      const imageXml = images
        .filter(Boolean)
        .map((image) => `\t\t<image:image>\n\t\t\t<image:loc>${xmlEscape(image)}</image:loc>\n\t\t</image:image>\n`)
        .join("");
      return `\t<url>\n\t\t<loc>${xmlEscape(entry.loc)}</loc>\n${date ? `\t\t<lastmod>${date}</lastmod>\n` : ""}${imageXml}\t</url>\n`;
    })
    .join("");
  return `${prolog(options)}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${items}</urlset>`;
}

export { decodeHtmlEntities } from "./text.js";
