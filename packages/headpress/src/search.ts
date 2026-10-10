/**
 * Product search (Headpress `search` module): suggestions as the shopper types, result pages,
 * popular searches and the analytics beacon.
 *
 * Items come with the storefront `path`, live prices (normalized to `Money` here) and `highlight`
 * ranges of the matched words; `highlightSegments()` turns them into text runs to render.
 */
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import { decodeHtmlEntities } from "./seo.js";
import type { Transport } from "./transport.js";

/** `[start, end)` in Unicode code points. */
export type HighlightRange = readonly [number, number];

export interface SearchImage {
  src: string;
  srcset: string;
  alt: string;
}

export interface SearchPrices {
  price: Money;
  regularPrice: Money;
  salePrice: Money;
  range: { min: Money; max: Money } | null;
}

export interface SearchProduct {
  kind: "product";
  id: number;
  /** `variation` when a variation's SKU or GTIN was searched. */
  type: "product" | "variation";
  parentId: number;
  name: string;
  slug: string;
  path: string | null;
  sku: string;
  image: SearchImage | null;
  prices: SearchPrices | null;
  onSale: boolean;
  inStock: boolean;
  rating: number;
  highlight: { name?: HighlightRange[] };
  raw: Record<string, unknown>;
}

export interface SearchTerm {
  kind: "term";
  id: number;
  taxonomy: string;
  name: string;
  slug: string;
  path: string | null;
  count: number;
  image: SearchImage | null;
  breadcrumbs: { id: number; name: string }[];
  highlight: { name?: HighlightRange[] };
  raw: Record<string, unknown>;
}

export interface SearchPost {
  kind: "post";
  id: number;
  postType: string;
  title: string;
  path: string | null;
  excerpt: string;
  image: SearchImage | null;
  highlight: { title?: HighlightRange[] };
  raw: Record<string, unknown>;
}

export type SearchItem = SearchProduct | SearchTerm | SearchPost;

export interface SuggestResult {
  query: { q: string; normalized: string };
  /** "Did you mean" phrase, when the search needed a typo fix or matched partially. */
  suggestion: string | null;
  /** Where a merchandising rule sends this phrase (path or URL). */
  redirect: string | null;
  total: number;
  partial: boolean;
  groups: { type: string; total: number; items: SearchItem[] }[];
}

export interface SearchResult {
  items: SearchItem[];
  total: number;
  totalPages: number;
  page: number;
  partial: boolean;
  suggestion: string | null;
  redirect: string | null;
}

export type SearchOrderBy = "relevance" | "price" | "price_desc" | "date" | "popularity" | "rating";

export type SearchEvent =
  | { type: "search"; q: string; context: "suggest" | "results"; results: number; items?: readonly number[] }
  | { type: "click"; q: string; object_type: "product" | "term" | "post"; object_id: number; position: number }
  | { type: "view"; object_id: number }
  | { type: "add_to_cart"; q?: string; object_id: number };

export interface Search {
  suggest(q: string, options?: { types?: readonly string[]; limit?: number; lang?: string; signal?: AbortSignal }): Promise<SuggestResult>;
  search(
    q: string,
    options?: { type?: string; orderby?: SearchOrderBy; page?: number; perPage?: number; lang?: string; signal?: AbortSignal },
  ): Promise<SearchResult>;
  popular(options?: { limit?: number; lang?: string; signal?: AbortSignal }): Promise<{ phrase: string; searches: number }[]>;
  /**
   * Send analytics events (≤ 20 per call). Only call it when the shopper consented, if the store
   * requires it (`config.modules.search.tracking.require_consent`).
   */
  track(
    events: readonly SearchEvent[],
    options: { session: string; consent?: { categories: readonly string[] } },
  ): Promise<{ accepted: number; rejected: { index: number; reason: string }[] }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function imageOf(value: unknown): SearchImage | null {
  const data = record(value);
  return typeof data.src === "string" && data.src ? { src: data.src, srcset: str(data.srcset), alt: decodeHtmlEntities(str(data.alt)) } : null;
}

function ranges(value: unknown): HighlightRange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (range): range is [number, number] =>
      Array.isArray(range) && range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]),
  );
}

function pricesOf(value: unknown): SearchPrices | null {
  const data = record(value);
  if (typeof data.currency_code !== "string") return null;
  const currency: CurrencyInfo = { code: data.currency_code, minor_unit: Number(data.currency_minor_unit ?? 2) };
  const price = moneyFromMinor(data.price, currency);
  if (!price) return null;
  const range = record(data.price_range);
  const min = moneyFromMinor(range.min_amount, currency);
  const max = moneyFromMinor(range.max_amount, currency);
  return {
    price,
    regularPrice: moneyFromMinor(data.regular_price, currency) ?? price,
    salePrice: moneyFromMinor(data.sale_price, currency) ?? price,
    range: min && max ? { min, max } : null,
  };
}

/** Normalize one search item, whatever its kind. */
export function normalizeSearchItem(value: unknown): SearchItem {
  const raw = record(value);
  const highlight = record(raw.highlight);
  const path = typeof raw.path === "string" ? raw.path : null;

  if (typeof raw.taxonomy === "string") {
    return {
      kind: "term",
      id: Number(raw.id) || 0,
      taxonomy: raw.taxonomy,
      name: decodeHtmlEntities(str(raw.name)),
      slug: str(raw.slug),
      path,
      count: Number(raw.count) || 0,
      image: imageOf(raw.image),
      breadcrumbs: Array.isArray(raw.breadcrumbs)
        ? raw.breadcrumbs.map((crumb) => ({ id: Number(record(crumb).id) || 0, name: decodeHtmlEntities(str(record(crumb).name)) }))
        : [],
      highlight: { name: ranges(highlight.name) },
      raw,
    };
  }
  if (typeof raw.post_type === "string") {
    return {
      kind: "post",
      id: Number(raw.id) || 0,
      postType: raw.post_type,
      title: decodeHtmlEntities(str(raw.title)),
      path,
      excerpt: decodeHtmlEntities(str(raw.excerpt)),
      image: imageOf(raw.image),
      highlight: { title: ranges(highlight.title) },
      raw,
    };
  }
  return {
    kind: "product",
    id: Number(raw.id) || 0,
    type: raw.type === "variation" ? "variation" : "product",
    parentId: Number(raw.parent_id) || 0,
    name: decodeHtmlEntities(str(raw.name)),
    slug: str(raw.slug),
    path,
    sku: str(raw.sku),
    image: imageOf(raw.image),
    prices: pricesOf(raw.prices),
    onSale: raw.on_sale === true,
    inStock: raw.in_stock !== false,
    rating: Number(raw.rating) || 0,
    highlight: { name: ranges(highlight.name) },
    raw,
  };
}

/**
 * Split text into runs by highlight ranges (code points, as Headpress counts them).
 *
 * @example highlightSegments("Anel de ouro", [[0, 4]]) // [{ text: "Anel", match: true }, { text: " de ouro", match: false }]
 */
export function highlightSegments(text: string, highlight: readonly HighlightRange[] | undefined): { text: string; match: boolean }[] {
  const chars = Array.from(text);
  if (!highlight?.length) return text ? [{ text, match: false }] : [];
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const [start, end] of highlight) {
    for (let i = Math.max(0, start); i < Math.min(chars.length, end); i++) marked[i] = true;
  }
  const segments: { text: string; match: boolean }[] = [];
  chars.forEach((char, index) => {
    const match = marked[index] === true;
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += char;
    else segments.push({ text: char, match });
  });
  return segments;
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createSearch(transport: Transport): Search {
  return {
    async suggest(q, options = {}) {
      const data = record(
        await transport.request<unknown>("/store/search/suggest", {
          query: { q, types: options.types, limit: options.limit, lang: options.lang },
          module: "search",
          cacheTags: ["search"],
          signal: options.signal,
        }),
      );
      const query = record(data.query);
      return {
        query: { q: str(query.q) || q, normalized: str(query.normalized) },
        suggestion: str(data.suggestion) || null,
        redirect: str(data.redirect) || null,
        total: Number(data.total) || 0,
        partial: data.partial === true,
        groups: (Array.isArray(data.groups) ? data.groups : []).map((group) => {
          const entry = record(group);
          return {
            type: str(entry.type),
            total: Number(entry.total) || 0,
            items: (Array.isArray(entry.items) ? entry.items : []).map(normalizeSearchItem),
          };
        }),
      };
    },

    async search(q, options = {}) {
      const page = options.page ?? 1;
      const response = await transport.raw<unknown[]>("/store/search", {
        query: { q, type: options.type, orderby: options.orderby, page, per_page: options.perPage, lang: options.lang },
        module: "search",
        cacheTags: ["search"],
        signal: options.signal,
      });
      const items = (Array.isArray(response.data) ? response.data : []).map(normalizeSearchItem);
      return {
        items,
        total: Number(response.headers.get("X-WP-Total") ?? items.length) || 0,
        totalPages: Number(response.headers.get("X-WP-TotalPages") ?? 1) || 0,
        page,
        partial: response.headers.get("X-Headpress-Partial") === "1",
        suggestion: decodeHeader(response.headers.get("X-Headpress-Suggestion")),
        redirect: decodeHeader(response.headers.get("X-Headpress-Redirect")),
      };
    },

    async popular(options = {}) {
      const data = await transport.request<unknown>("/store/search/popular", {
        query: { limit: options.limit, lang: options.lang },
        module: "search",
        cacheTags: ["search"],
        signal: options.signal,
      });
      return (Array.isArray(data) ? data : []).map((entry) => ({
        phrase: str(record(entry).phrase),
        searches: Number(record(entry).searches) || 0,
      }));
    },

    async track(events, options) {
      const data = record(
        await transport.request<unknown>("/store/search/events", {
          method: "POST",
          body: { session: options.session, events: events.slice(0, 20), ...(options.consent ? { consent: options.consent } : {}) },
          headers: { "X-Headpress-Search-Session": options.session },
          module: "search",
          fetchOptions: { keepalive: true },
        }),
      );
      return {
        accepted: Number(data.accepted) || 0,
        rejected: Array.isArray(data.rejected)
          ? data.rejected.map((entry) => ({ index: Number(record(entry).index) || 0, reason: str(record(entry).reason) }))
          : [],
      };
    },
  };
}

/**
 * A random id for the search analytics session, kept for the browser session (`sessionStorage`).
 * Headpress stores only an HMAC of it.
 */
export function searchSessionId(storageKey = "hp_search_session"): string {
  const create = (): string => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  try {
    if (typeof sessionStorage === "undefined") return create();
    const existing = sessionStorage.getItem(storageKey);
    if (existing && /^[a-f0-9]{16}$/.test(existing)) return existing;
    const id = create();
    sessionStorage.setItem(storageKey, id);
    return id;
  } catch {
    return create();
  }
}
