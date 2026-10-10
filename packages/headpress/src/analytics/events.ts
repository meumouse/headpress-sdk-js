/**
 * The canonical events: GA4 e-commerce names and parameters, which every provider translates to its
 * own vocabulary (Meta standard events, Pinterest events…). Call sites deal with one API.
 *
 * Amounts are in **major units** (`199.9`), as GA4, Meta and Pinterest expect — the one place the
 * SDK leaves `Money`. Build them from `Money` with `toMajor()`, or with the item helpers below,
 * never by hand-dividing cents.
 *
 * Reference: https://developers.google.com/analytics/devguides/collection/ga4/reference/events
 */
import type { Cart, CartItem } from "../cart.js";
import type { Product } from "../catalog.js";
import { multiplyMoney, sumMoney, toMajor, type Money } from "../money.js";

export type CanonicalEvent =
  | "page_view"
  | "view_item"
  | "view_item_list"
  | "select_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "view_cart"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info"
  | "purchase"
  | "search"
  | "sign_up"
  | "login"
  | "generate_lead";

export interface AnalyticsItem {
  /** The id GA4 groups by. The item helpers use Headpress' rule (SKU, else the product or variation id). */
  item_id: string;
  item_name: string;
  /**
   * The id the store's Meta / Pinterest catalogs list the item under, when it differs from
   * `item_id`. Those providers use it for `content_ids`; GA4 never sees it.
   */
  catalog_id?: string;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_variant?: string;
  item_list_id?: string;
  item_list_name?: string;
  affiliation?: string;
  coupon?: string;
  /** Unit price, major units. */
  price?: number;
  /** Unit discount, major units. */
  discount?: number;
  quantity?: number;
  index?: number;
  [key: string]: unknown;
}

export interface EcommerceParams {
  /** ISO 4217. */
  currency?: string;
  /** Major units. */
  value?: number;
  items?: AnalyticsItem[];
}

export interface ListParams {
  item_list_id?: string;
  item_list_name?: string;
}

/** Parameters of each canonical event. Any extra key is passed through to the providers that read it. */
export interface EventParamsMap {
  page_view: { page_location?: string; page_path?: string; page_title?: string; page_referrer?: string };
  view_item: EcommerceParams;
  view_item_list: EcommerceParams & ListParams;
  select_item: EcommerceParams & ListParams;
  add_to_cart: EcommerceParams;
  remove_from_cart: EcommerceParams;
  view_cart: EcommerceParams;
  begin_checkout: EcommerceParams & { coupon?: string };
  add_shipping_info: EcommerceParams & { coupon?: string; shipping_tier?: string };
  add_payment_info: EcommerceParams & { coupon?: string; payment_type?: string };
  purchase: EcommerceParams & {
    transaction_id: string;
    currency: string;
    value: number;
    tax?: number;
    shipping?: number;
    coupon?: string;
  };
  search: { search_term: string };
  sign_up: { method?: string };
  login: { method?: string };
  generate_lead: { currency?: string; value?: number; lead_source?: string };
}

export type EventParams<E extends CanonicalEvent = CanonicalEvent> = EventParamsMap[E] & { [key: string]: unknown };

/** Loose params, as providers receive them. */
export type AnyEventParams = EcommerceParams & {
  transaction_id?: string;
  tax?: number;
  shipping?: number;
  coupon?: string;
  search_term?: string;
  [key: string]: unknown;
};

export interface AnalyticsIdentity {
  /** The store's customer id. */
  user_id?: string;
  /** Stable pseudonymous id of the visitor (sent as `external_id` to the Conversions APIs). */
  external_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ItemOptions {
  quantity?: number;
  /** Override the item id (defaults to Headpress' rule: SKU, else the product or variation id). */
  itemId?: string;
  catalogId?: string;
  listId?: string;
  listName?: string;
  index?: number;
  /** Override the brand (defaults to the product's first brand). */
  brand?: string;
  /** Override the category (defaults to the product's categories, in order). */
  category?: string;
  affiliation?: string;
}

function variantFromLabel(label: string): string {
  // WooCommerce labels read "Color: Green, Size: M"; Headpress' order payload sends "Green, M".
  return label
    .split(",")
    .map((part) => {
      const index = part.indexOf(":");
      return (index === -1 ? part : part.slice(index + 1)).trim();
    })
    .filter(Boolean)
    .join(", ");
}

function withListAndIndex(item: AnalyticsItem, options: ItemOptions): AnalyticsItem {
  if (options.catalogId) item.catalog_id = options.catalogId;
  if (options.listId) item.item_list_id = options.listId;
  if (options.listName) item.item_list_name = options.listName;
  if (options.index !== undefined) item.index = options.index;
  if (options.affiliation) item.affiliation = options.affiliation;
  return item;
}

/**
 * An item from a catalog `Product` (or a variation of one). The id follows Headpress' order payload
 * (SKU, else the product or variation id), so browser events and the server purchase name the item
 * the same way.
 */
export function itemFromProduct(product: Product, options: ItemOptions = {}): AnalyticsItem {
  const item: AnalyticsItem = {
    item_id: options.itemId ?? (product.sku || String(product.id)),
    item_name: product.name,
    price: toMajor(product.price),
    quantity: options.quantity ?? 1,
  };
  const brand = options.brand ?? product.brands[0]?.name;
  if (brand) item.item_brand = brand;
  const categories = options.category ? [options.category] : product.categories.map((category) => category.name);
  const keys = ["item_category", "item_category2", "item_category3", "item_category4", "item_category5"] as const;
  categories.slice(0, keys.length).forEach((name, index) => {
    if (name) item[keys[index]!] = name;
  });
  const variant = product.variationLabel ? variantFromLabel(product.variationLabel) : "";
  if (variant) item.item_variant = variant;
  return withListAndIndex(item, options);
}

/** An item from a cart line: unit price and quantity as the Store API computed them. */
export function itemFromCartItem(line: CartItem, options: ItemOptions = {}): AnalyticsItem {
  const item: AnalyticsItem = {
    item_id: options.itemId ?? (line.sku || String(line.id)),
    item_name: line.name,
    price: toMajor(line.unitPrice),
    quantity: options.quantity ?? line.quantity,
  };
  const variant = line.variation.map((entry) => entry.value).filter(Boolean).join(", ");
  if (variant) item.item_variant = variant;
  if (options.brand) item.item_brand = options.brand;
  if (options.category) item.item_category = options.category;
  return withListAndIndex(item, options);
}

/**
 * `{ currency, value, items, coupon }` for `view_cart`, `begin_checkout`, `add_shipping_info` and
 * `add_payment_info`, from the server's cart: `value` is the sum of the line totals after discounts.
 */
export function cartEventParams(cart: Cart, options: { item?: (line: CartItem) => ItemOptions } = {}): EcommerceParams & { coupon?: string } {
  const totals: Money[] = cart.items.map((line) => line.total);
  const value = totals.length > 0 ? toMajor(sumMoney(totals)) : 0;
  const params: EcommerceParams & { coupon?: string } = {
    currency: cart.currency.code,
    value,
    items: cart.items.map((line) => itemFromCartItem(line, options.item?.(line))),
  };
  const coupon = cart.coupons.map((entry) => entry.code).join(",");
  if (coupon) params.coupon = coupon;
  return params;
}

/** `{ currency, value, items }` for one product (`view_item`, `add_to_cart`…): value = price × quantity. */
export function productEventParams(product: Product, options: ItemOptions = {}): EcommerceParams {
  const item = itemFromProduct(product, options);
  // Integer maths in minor units, then one conversion: no float drift on the total.
  return { currency: product.price.currency, value: toMajor(multiplyMoney(product.price, item.quantity ?? 1)), items: [item] };
}
