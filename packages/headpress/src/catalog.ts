/**
 * The catalog, through the WooCommerce Store API (`wc/store/v1`): public, no admin keys needed.
 *
 * Products come back normalized: money as `Money`, names decoded, stock and quantity rules in one
 * place, the storefront path from the route map, and Headpress's server-computed price preview
 * (Pix price, best installment) when the store publishes it — never a preview computed here.
 *
 * Reads are tagged for framework caches with the Headpress vocabulary (`product:12`,
 * `product:slug:anel`, `product:list`, `term:product_cat:list`).
 */
import { isHeadpressError } from "./errors.js";
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import type { Routes } from "./routes.js";
import { decodeHtmlEntities } from "./seo.js";
import type { StoreCategory, StoreCurrency, StoreImage, StoreProduct } from "./store-api.js";
import type { Transport } from "./transport.js";

export interface ProductImage {
  id: number;
  src: string;
  thumbnail: string;
  srcset: string;
  sizes: string;
  alt: string;
  name: string;
}

export interface TermRef {
  id: number;
  name: string;
  slug: string;
  path: string | null;
}

export interface ProductAttribute {
  id: number;
  name: string;
  taxonomy: string | null;
  hasVariations: boolean;
  terms: { id: number; name: string; slug: string; isDefault: boolean }[];
}

/** Server-computed price preview (Headpress `extensions.headpress.price_preview`). */
export interface PricePreview {
  price: Money;
  pix: { price: Money; discount: Money; percent: number | null } | null;
  ticket: { price: Money; discount: Money; percent: number | null } | null;
  installments: { count: number; amount: Money; total: Money; interestFree: boolean } | null;
  minInstallment: Money | null;
}

export interface Product {
  id: number;
  /** The parent product for variations, else 0. */
  parentId: number;
  type: string;
  slug: string;
  name: string;
  sku: string;
  /** WordPress permalink (the backend). Prefer `path`. */
  permalink: string;
  /** Storefront path from the route map, or null when the store has no product route. */
  path: string | null;
  /** HTML. */
  shortDescription: string;
  /** HTML. */
  description: string;
  currency: CurrencyInfo;
  price: Money;
  regularPrice: Money;
  /** Set while on sale. */
  salePrice: Money | null;
  /** Lowest and highest variation price, for variable products. */
  priceRange: { min: Money; max: Money } | null;
  onSale: boolean;
  images: ProductImage[];
  categories: TermRef[];
  tags: TermRef[];
  brands: TermRef[];
  attributes: ProductAttribute[];
  /** For variable products: each variation's id and attribute values (`null` = any). */
  variations: { id: number; attributes: { name: string; value: string | null }[] }[];
  /** For variations, WooCommerce's label of the chosen attributes ("Cor: Verde"). */
  variationLabel: string;
  hasOptions: boolean;
  rating: { average: number; count: number };
  stock: {
    inStock: boolean;
    onBackorder: boolean;
    purchasable: boolean;
    lowStockRemaining: number | null;
    availability: string;
  };
  /** What the Store API will accept in the cart. */
  quantity: { min: number; max: number | null; step: number; soldIndividually: boolean };
  pricePreview: PricePreview | null;
  extensions: Record<string, unknown>;
  raw: StoreProduct;
}

/** WooCommerce's "no limit" maximum. */
const UNLIMITED = 9999;

export function currencyFromStore(source: StoreCurrency): CurrencyInfo {
  return {
    code: source.currency_code,
    minor_unit: source.currency_minor_unit,
    symbol: source.currency_symbol,
    decimal_separator: source.currency_decimal_separator,
    thousand_separator: source.currency_thousand_separator,
    prefix: source.currency_prefix,
    suffix: source.currency_suffix,
  };
}

/** A Store API minor-unit string as `Money`; zero when missing or malformed. */
export function storeMoney(value: unknown, currency: CurrencyInfo): Money {
  return moneyFromMinor(value, currency) ?? moneyFromMinor(0, currency)!;
}

function image(source: StoreImage): ProductImage {
  return {
    id: source.id,
    src: source.src,
    thumbnail: source.thumbnail,
    srcset: source.srcset,
    sizes: source.sizes,
    alt: decodeHtmlEntities(source.alt ?? ""),
    name: decodeHtmlEntities(source.name ?? ""),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Normalize `extensions.headpress.price_preview`, or null when absent or malformed. */
export function normalizePricePreview(value: unknown, fallback: CurrencyInfo): PricePreview | null {
  const preview = record(value);
  if (!preview) return null;
  const currency: CurrencyInfo =
    typeof preview.currency === "string" && preview.currency ? { ...fallback, code: preview.currency } : fallback;
  const price = moneyFromMinor(preview.price, currency);
  if (!price) return null;

  const discount = (entry: unknown): PricePreview["pix"] => {
    const data = record(entry);
    const amount = data && moneyFromMinor(data.price, currency);
    if (!data || !amount) return null;
    return { price: amount, discount: storeMoney(data.discount, currency), percent: percent(data.percent) };
  };
  const installments = record(preview.installments);
  const count = Number(installments?.count);
  const amount = installments && moneyFromMinor(installments.amount, currency);

  return {
    price,
    pix: discount(preview.pix),
    ticket: discount(preview.ticket),
    installments:
      installments && amount && Number.isInteger(count) && count > 0
        ? {
            count,
            amount,
            total: moneyFromMinor(installments.total, currency) ?? amount,
            interestFree: installments.interest_free === true,
          }
        : null,
    minInstallment: moneyFromMinor(preview.min_installment, currency),
  };
}

export interface NormalizeOptions {
  routes?: Pick<Routes, "path">;
}

function termRef(term: { id: number; name: string; slug: string }, route: string, options: NormalizeOptions): TermRef {
  return {
    id: term.id,
    name: decodeHtmlEntities(term.name),
    slug: term.slug,
    path: options.routes?.path(route, { slug: term.slug, path: term.slug }) ?? null,
  };
}

export function normalizeProduct(raw: StoreProduct, options: NormalizeOptions = {}): Product {
  const currency = currencyFromStore(raw.prices);
  const range = raw.prices.price_range;
  const maximum = raw.add_to_cart?.maximum;
  const headpress = record(raw.extensions?.headpress);

  return {
    id: raw.id,
    parentId: raw.parent ?? 0,
    type: raw.type,
    slug: raw.slug,
    name: decodeHtmlEntities(raw.name ?? ""),
    sku: raw.sku ?? "",
    permalink: raw.permalink,
    path: options.routes?.path("product", { slug: raw.slug }) ?? null,
    shortDescription: raw.short_description ?? "",
    description: raw.description ?? "",
    currency,
    price: storeMoney(raw.prices.price, currency),
    regularPrice: storeMoney(raw.prices.regular_price, currency),
    salePrice: raw.on_sale ? storeMoney(raw.prices.sale_price, currency) : null,
    priceRange: range ? { min: storeMoney(range.min_amount, currency), max: storeMoney(range.max_amount, currency) } : null,
    onSale: raw.on_sale === true,
    images: (raw.images ?? []).map(image),
    categories: (raw.categories ?? []).map((term) => termRef(term, "product_cat", options)),
    tags: (raw.tags ?? []).map((term) => termRef(term, "product_tag", options)),
    brands: (raw.brands ?? []).map((term) => termRef(term, "product_brand", options)),
    attributes: (raw.attributes ?? []).map((attribute) => ({
      id: attribute.id,
      name: decodeHtmlEntities(attribute.name),
      taxonomy: attribute.taxonomy,
      hasVariations: attribute.has_variations,
      terms: (attribute.terms ?? []).map((term) => ({
        id: term.id,
        name: decodeHtmlEntities(term.name),
        slug: term.slug,
        isDefault: term.default === true,
      })),
    })),
    variations: raw.variations ?? [],
    variationLabel: decodeHtmlEntities(raw.variation ?? ""),
    hasOptions: raw.has_options === true,
    rating: { average: Number(raw.average_rating) || 0, count: raw.review_count ?? 0 },
    stock: {
      inStock: raw.is_in_stock === true,
      onBackorder: raw.is_on_backorder === true,
      purchasable: raw.is_purchasable === true,
      lowStockRemaining: raw.low_stock_remaining ?? null,
      availability: decodeHtmlEntities(raw.stock_availability?.text ?? ""),
    },
    quantity: {
      min: raw.add_to_cart?.minimum ?? 1,
      max: raw.sold_individually ? 1 : typeof maximum === "number" && maximum < UNLIMITED ? maximum : null,
      step: raw.add_to_cart?.multiple_of ?? 1,
      soldIndividually: raw.sold_individually === true,
    },
    pricePreview: normalizePricePreview(headpress?.price_preview, currency),
    extensions: raw.extensions ?? {},
    raw,
  };
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  parentId: number;
  count: number;
  image: ProductImage | null;
  path: string | null;
  raw: StoreCategory;
}

export function normalizeCategory(raw: StoreCategory, taxonomyRoute: string, options: NormalizeOptions = {}): Category {
  return {
    id: raw.id,
    name: decodeHtmlEntities(raw.name),
    slug: raw.slug,
    description: raw.description ?? "",
    parentId: raw.parent ?? 0,
    count: raw.count ?? 0,
    image: raw.image ? image(raw.image) : null,
    path: options.routes?.path(taxonomyRoute, { slug: raw.slug, path: raw.slug }) ?? null,
    raw,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export type ProductOrderBy = "date" | "modified" | "id" | "include" | "title" | "slug" | "price" | "popularity" | "rating" | "menu_order";

export interface AttributeFilter {
  /** Attribute taxonomy, e.g. `pa_cor`. */
  attribute: string;
  /** Term ids or slugs. */
  terms: readonly (number | string)[];
  operator?: "in" | "not_in" | "and";
}

export interface ProductQuery {
  page?: number;
  perPage?: number;
  search?: string;
  /** Category ids or slugs. */
  category?: number | string | readonly (number | string)[];
  categoryOperator?: "in" | "not_in" | "and";
  /** Tag ids or slugs. */
  tag?: number | string | readonly (number | string)[];
  tagOperator?: "in" | "not_in" | "and";
  attributes?: readonly AttributeFilter[];
  attributeRelation?: "and" | "or";
  /** Price bounds as `Money` or minor units. */
  minPrice?: Money | number;
  maxPrice?: Money | number;
  onSale?: boolean;
  featured?: boolean;
  stockStatus?: readonly ("instock" | "outofstock" | "onbackorder")[];
  rating?: readonly number[];
  include?: readonly number[];
  exclude?: readonly number[];
  type?: string;
  sku?: string;
  slug?: string;
  parent?: readonly number[];
  orderby?: ProductOrderBy;
  order?: "asc" | "desc";
}

export interface ProductPage {
  items: Product[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface Facets {
  priceRange: { min: Money; max: Money } | null;
  attributeCounts: { term: number; count: number }[];
  ratingCounts: { rating: number; count: number }[];
  stockStatusCounts: { status: string; count: number }[];
}

export interface FacetOptions {
  /** Attribute taxonomies to count terms for, with how they combine (`or` counts as if unselected). */
  attributes?: readonly { taxonomy: string; queryType?: "or" | "and" }[];
  price?: boolean;
  ratings?: boolean;
  stock?: boolean;
}

export interface CatalogReadOptions {
  signal?: AbortSignal;
  revalidate?: number | false;
}

export interface Catalog {
  list(query?: ProductQuery, options?: CatalogReadOptions): Promise<ProductPage>;
  /** A product (or variation) by id or slug; null when it does not exist. */
  get(idOrSlug: number | string, options?: CatalogReadOptions): Promise<Product | null>;
  /** Variations of a variable product, with their own prices and stock. */
  variations(productId: number, options?: CatalogReadOptions): Promise<Product[]>;
  /** Counts for filters, for the same query as `list()`. */
  facets(query?: ProductQuery, facets?: FacetOptions, options?: CatalogReadOptions): Promise<Facets>;
  categories(query?: { parent?: number; hideEmpty?: boolean }, options?: CatalogReadOptions): Promise<Category[]>;
  tags(options?: CatalogReadOptions): Promise<Category[]>;
  attributes(options?: CatalogReadOptions): Promise<{ id: number; name: string; taxonomy: string; type: string; order: string; hasArchives: boolean; count: number }[]>;
  attributeTerms(attributeId: number, options?: CatalogReadOptions): Promise<{ id: number; name: string; slug: string; count: number; description: string }[]>;
}

function list(value: number | string | readonly (number | string)[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).join(",");
}

function minor(value: Money | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? value : value.amount;
}

/** Query string for the Store API products route (nested attribute filters included). */
export function productQueryString(query: ProductQuery = {}): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  };
  set("page", query.page);
  set("per_page", query.perPage);
  set("search", query.search);
  set("category", list(query.category));
  set("category_operator", query.categoryOperator);
  set("tag", list(query.tag));
  set("tag_operator", query.tagOperator);
  set("min_price", minor(query.minPrice));
  set("max_price", minor(query.maxPrice));
  set("on_sale", query.onSale);
  set("featured", query.featured);
  set("type", query.type);
  set("sku", query.sku);
  set("slug", query.slug);
  set("orderby", query.orderby);
  set("order", query.order);
  set("attribute_relation", query.attributeRelation);
  query.stockStatus?.forEach((status, index) => params.set(`stock_status[${index}]`, status));
  query.rating?.forEach((rating, index) => params.set(`rating[${index}]`, String(rating)));
  query.include?.forEach((id, index) => params.set(`include[${index}]`, String(id)));
  query.exclude?.forEach((id, index) => params.set(`exclude[${index}]`, String(id)));
  query.parent?.forEach((id, index) => params.set(`parent[${index}]`, String(id)));
  query.attributes?.forEach((filter, index) => {
    params.set(`attributes[${index}][attribute]`, filter.attribute);
    const numeric = filter.terms.every((term) => typeof term === "number" || /^\d+$/.test(String(term)));
    filter.terms.forEach((term, termIndex) =>
      params.set(`attributes[${index}][${numeric ? "term_id" : "slug"}][${termIndex}]`, String(term)),
    );
    if (filter.operator) params.set(`attributes[${index}][operator]`, filter.operator);
  });
  return params.toString();
}

function withQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

export function createCatalog(transport: Transport, routes: Pick<Routes, "path">): Catalog {
  const options: NormalizeOptions = { routes };

  async function page(query: ProductQuery, read: CatalogReadOptions, tags: string[]): Promise<ProductPage> {
    const response = await transport.raw<StoreProduct[]>(withQuery("/products", productQueryString(query)), {
      api: "store",
      cacheTags: tags,
      revalidate: read.revalidate,
      signal: read.signal,
    });
    const items = (Array.isArray(response.data) ? response.data : []).map((raw) => normalizeProduct(raw, options));
    return {
      items,
      total: Number(response.headers.get("X-WP-Total") ?? items.length) || 0,
      totalPages: Number(response.headers.get("X-WP-TotalPages") ?? 1) || 0,
      page: query.page ?? 1,
      perPage: query.perPage ?? 10,
    };
  }

  return {
    list: (query = {}, read = {}) => page(query, read, ["product:list"]),

    async get(idOrSlug, read = {}) {
      const key = typeof idOrSlug === "number" ? String(idOrSlug) : idOrSlug;
      const tag = typeof idOrSlug === "number" || /^\d+$/.test(key) ? `product:${key}` : `product:slug:${key}`;
      try {
        const raw = await transport.request<StoreProduct>(`/products/${encodeURIComponent(key)}`, {
          api: "store",
          cacheTags: [tag],
          revalidate: read.revalidate,
          signal: read.signal,
        });
        return normalizeProduct(raw, options);
      } catch (error) {
        if (isHeadpressError(error) && error.status === 404) return null;
        throw error;
      }
    },

    async variations(productId, read = {}) {
      const result = await page({ type: "variation", parent: [productId], perPage: 100 }, read, [`product:${productId}`]);
      return result.items;
    },

    async facets(query = {}, facets = {}, read = {}) {
      const params = new URLSearchParams(productQueryString({ ...query, page: undefined, perPage: undefined }));
      if (facets.price !== false) params.set("calculate_price_range", "true");
      if (facets.ratings) params.set("calculate_rating_counts", "true");
      if (facets.stock) params.set("calculate_stock_status_counts", "true");
      facets.attributes?.forEach((attribute, index) => {
        params.set(`calculate_attribute_counts[${index}][taxonomy]`, attribute.taxonomy);
        params.set(`calculate_attribute_counts[${index}][query_type]`, attribute.queryType ?? "or");
      });
      const data = await transport.request<{
        price_range: (StoreCurrency & { min_price: string; max_price: string }) | null;
        attribute_counts: { term: number; count: number | string }[] | null;
        rating_counts: { rating: number; count: number | string }[] | null;
        stock_status_counts: { status: string; count: number | string }[] | null;
      }>(withQuery("/products/collection-data", params.toString()), {
        api: "store",
        cacheTags: ["product:list"],
        revalidate: read.revalidate,
        signal: read.signal,
      });
      const range = data.price_range;
      const currency = range ? currencyFromStore(range) : null;
      return {
        priceRange: range && currency ? { min: storeMoney(range.min_price, currency), max: storeMoney(range.max_price, currency) } : null,
        attributeCounts: (data.attribute_counts ?? []).map((entry) => ({ term: entry.term, count: Number(entry.count) || 0 })),
        ratingCounts: (data.rating_counts ?? []).map((entry) => ({ rating: entry.rating, count: Number(entry.count) || 0 })),
        stockStatusCounts: (data.stock_status_counts ?? []).map((entry) => ({ status: entry.status, count: Number(entry.count) || 0 })),
      };
    },

    async categories(query = {}, read = {}) {
      const data = await transport.request<StoreCategory[]>("/products/categories", {
        api: "store",
        query: { parent: query.parent, hide_empty: query.hideEmpty },
        cacheTags: ["term:product_cat:list"],
        revalidate: read.revalidate,
        signal: read.signal,
      });
      return data.map((raw) => normalizeCategory(raw, "product_cat", options));
    },

    async tags(read = {}) {
      const data = await transport.request<StoreCategory[]>("/products/tags", {
        api: "store",
        cacheTags: ["term:product_tag:list"],
        revalidate: read.revalidate,
        signal: read.signal,
      });
      return data.map((raw) => normalizeCategory(raw, "product_tag", options));
    },

    async attributes(read = {}) {
      const data = await transport.request<
        { id: number; name: string; taxonomy: string; type: string; order: string; has_archives: boolean; count?: number }[]
      >("/products/attributes", { api: "store", cacheTags: ["product:list"], revalidate: read.revalidate, signal: read.signal });
      return data.map((attribute) => ({
        id: attribute.id,
        name: decodeHtmlEntities(attribute.name),
        taxonomy: attribute.taxonomy,
        type: attribute.type,
        order: attribute.order,
        hasArchives: attribute.has_archives,
        count: attribute.count ?? 0,
      }));
    },

    async attributeTerms(attributeId, read = {}) {
      const data = await transport.request<{ id: number; name: string; slug: string; count: number; description: string }[]>(
        `/products/attributes/${attributeId}/terms`,
        { api: "store", cacheTags: ["product:list"], revalidate: read.revalidate, signal: read.signal },
      );
      return data.map((term) => ({ ...term, name: decodeHtmlEntities(term.name) }));
    },
  };
}
